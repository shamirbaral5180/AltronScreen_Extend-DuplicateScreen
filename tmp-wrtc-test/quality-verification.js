const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'quality-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const report = path.join(__dirname, 'quality-report.txt');
const log = (...p) => { const l = `${new Date().toISOString()} ${p.join(' ')}`; process.stdout.write(l + '\n'); fs.appendFileSync(report, l + '\n'); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await delay(100); }
  throw new Error('Timed out: ' + label);
}

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
global.virtualDisplayService.destroyDisplaySilently = async () => {};

app.whenReady().then(async () => {
  let viewer;
  try {
    for (const display of screen.getAllDisplays()) {
      const animation = new BrowserWindow({
        show: true, frame: false, alwaysOnTop: true,
        x: display.bounds.x + 20, y: display.bounds.y + 20,
        width: 220, height: 140,
        webPreferences: { backgroundThrottling: false },
      });
      await animation.loadURL('data:text/html,' + encodeURIComponent('<title>AltronScreen Playback Test</title><canvas id="c" width="200" height="120"></canvas><script>let n=0;setInterval(()=>{const x=c.getContext("2d");x.fillStyle=(++n%2)?"red":"blue";x.fillRect(0,0,200,120)},100)</script>'));
    }
    const host = await waitFor(() => { const w = altronscreenApp.mainWindow; return w && !w.webContents.isLoading() && w; }, 'host');
    const port = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-port')");
    const ip = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-local-lan-ip')");
    viewer = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await viewer.loadURL(`http://${ip}:${port}/`);
    await waitFor(() => viewer.webContents.executeJavaScript("(() => { const l = document.querySelector('[data-testid=connect-current-host]'); if (!l) return false; l.click(); return true; })()"), 'viewer request');
    await waitFor(() => global.connectedDevicesService.pendingConnectionDevice.id, 'pending');
    const sharing = global.sharingSessionService.waitingForConnectionSharingSession;
    const helper = sharing.peerConnectionHelperRenderer;
    await waitFor(() => !helper.webContents.isLoading(), 'helper');
    await global.desktopCapturerSourcesService.refreshDesktopCapturerSources();
    const source = global.desktopCapturerSourcesService.getScreenSources()[0];
    // Capture the real offer/peer connection the helper creates, without
    // touching production code.
    await helper.webContents.executeJavaScript(`(() => {
      window.__offers = [];
      const orig = RTCPeerConnection.prototype.createOffer;
      RTCPeerConnection.prototype.createOffer = function (...args) {
        window.__pc = this;
        const p = orig.apply(this, args);
        p.then((d) => { if (d && d.sdp) window.__offers.push(d.sdp); }).catch(() => {});
        return p;
      };
    })()`);
    helper.hide();
    await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('set-device-connected-status')");
    await sharing.setDesktopCapturerSourceID(source.id);
    await sharing.callPeer();
    await waitFor(() => viewer.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`), 'video');

    // Let the encoder settle so sender params and stats are populated.
    await delay(4000);

    // Outbound sender params + negotiated codec on the host (offerer).
    const hostStats = await helper.webContents.executeJavaScript(`(async () => {
      const pc = window.__pc;
      if (!pc) return { error: 'no pc' };
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      const params = sender ? sender.getParameters() : null;
      const stats = await pc.getStats();
      let out = null, codec = null;
      stats.forEach(r => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') out = r;
      });
      if (out && out.codecId) stats.forEach(r => { if (r.id === out.codecId) codec = r; });
      const sdp = window.__offers[0] || '';
      const videoLine = (sdp.match(/^m=video .*/m) || [''])[0];
      const payloadOrder = sdp.split('\\n').find(l => l.startsWith('a=fmtp') || false);
      const rtpmap = {};
      sdp.split('\\n').forEach(l => { const m = l.match(/^a=rtpmap:(\\d+) ([^ /]+)/); if (m) rtpmap[m[1]] = m[2]; });
      const videoPayloads = videoLine ? videoLine.split(' ').slice(3) : [];
      const videoCodecOrder = videoPayloads.map(pt => rtpmap[pt]).filter(Boolean);
      return {
        maxBitrate: params && params.encodings && params.encodings[0] ? params.encodings[0].maxBitrate : null,
        maxFramerate: params && params.encodings && params.encodings[0] ? params.encodings[0].maxFramerate : null,
        degradationPreference: params ? params.degradationPreference : null,
        codecMime: codec ? codec.mimeType : null,
        videoCodecOrder,
        framesPerSecond: out ? out.framesPerSecond : null,
        frameWidth: out ? out.frameWidth : null,
        frameHeight: out ? out.frameHeight : null,
        bitrateKbps: out && out.bytesSent ? Math.round(out.bytesSent * 8 / 1000) : null,
        qualityLimitationReason: out ? out.qualityLimitationReason : null,
      };
    })()`);
    log('HOST_SENDER=' + JSON.stringify(hostStats));

    // Inbound negotiated codec on the viewer side.
    const viewerStats = await viewer.webContents.executeJavaScript(`(async () => {
      const v = document.querySelector('video');
      if (!v || !v.srcObject) return { error: 'no stream' };
      return { width: v.videoWidth, height: v.videoHeight, time: v.currentTime };
    })()`);
    log('VIEWER_VIDEO=' + JSON.stringify(viewerStats));

    assert.ok(hostStats.codecMime, 'codec should be negotiated');
    log('NEGOTIATED_CODEC=' + hostStats.codecMime);
    assert.ok(hostStats.maxBitrate >= 1_000_000, 'bitrate cap should be applied');
    log('BITRATE_CAP_OK=' + hostStats.maxBitrate);
    assert.ok(hostStats.frameWidth > 0 && hostStats.frameHeight > 0, 'frames should be encoded');
    log('QUALITY_VERIFICATION_PASS');
    app.exit(0);
  } catch (error) {
    log('QUALITY_VERIFICATION_FAIL ' + String(error));
    app.exit(1);
  }
});

const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'caprate-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const report = path.join(__dirname, 'caprate-report.txt');
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
      const animation = new BrowserWindow({ show: true, frame: false, alwaysOnTop: true,
        x: display.bounds.x + 20, y: display.bounds.y + 20, width: 300, height: 200,
        webPreferences: { backgroundThrottling: false } });
      // 60 fps content so the capture is not content-limited.
      await animation.loadURL('data:text/html,' + encodeURIComponent('<title>60fps Content</title><canvas id="c" width="280" height="180"></canvas><script>let n=0;function f(){const x=c.getContext("2d");x.fillStyle=(++n%2)?"red":"blue";x.fillRect(0,0,280,180);requestAnimationFrame(f)}requestAnimationFrame(f)</script>'));
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
    await helper.webContents.executeJavaScript(`(() => {
      window.__samples = [];
      const orig = RTCPeerConnection.prototype.createOffer;
      RTCPeerConnection.prototype.createOffer = function (...args) { window.__pc = this; return orig.apply(this, args); };
    })()`);
    helper.hide();
    await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('set-device-connected-status')");
    await sharing.setDesktopCapturerSourceID(source.id);
    await sharing.callPeer();
    await waitFor(() => viewer.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`), 'video');
    await delay(3000);

    const trackSettings = await helper.webContents.executeJavaScript(`(() => {
      const stream = window.__hostStream;
      if (!stream) return { error: 'no stream' };
      const t = stream.getVideoTracks()[0];
      return { settings: t.getSettings(), constraints: t.getConstraints(), hint: t.contentHint };
    })()`);
    log('TRACK=' + JSON.stringify(trackSettings));

    const fpsSamples = [];
    for (let i = 0; i < 6; i++) {
      const s = await helper.webContents.executeJavaScript(`(async () => {
        const stats = await window.__pc.getStats();
        let out = null;
        stats.forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video') out = r; });
        return out ? { fps: out.framesPerSecond, w: out.frameWidth, h: out.frameHeight, qlr: out.qualityLimitationReason } : null;
      })()`);
      fpsSamples.push(s);
      await delay(1500);
    }
    log('ENCODER_FPS=' + JSON.stringify(fpsSamples));
    log('CAPRATE_PROBE_DONE');
    app.exit(0);
  } catch (error) {
    log('CAPRATE_PROBE_FAIL ' + String(error));
    app.exit(1);
  }
});

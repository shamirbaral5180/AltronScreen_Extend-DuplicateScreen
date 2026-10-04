const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'perf-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const report = path.join(__dirname, 'perf-report.txt');
const log = (...p) => { const l = `${new Date().toISOString()} ${p.join(' ')}`; process.stdout.write(l + '\n'); fs.appendFileSync(report, l + '\n'); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await delay(100); }
  throw new Error('Timed out: ' + label);
}
require('../out/main/bytecode-loader.cjs');
const electron = require('electron');
const { altronscreenApp } = require('../out/main/index.jsc');
let getSourcesCalls = 0;
let windowEnumerations = 0;
let screenOnlyEnumerations = 0;
let heavyStacks = [];
let captureStacks = false;
const originalGetSources = electron.desktopCapturer.getSources.bind(electron.desktopCapturer);
electron.desktopCapturer.getSources = (...args) => {
  getSourcesCalls += 1;
  const types = (args[0] && args[0].types) || [];
  if (types.includes('window')) {
    windowEnumerations += 1;
    if (captureStacks) heavyStacks.push(new Error('heavy').stack);
  } else screenOnlyEnumerations += 1;
  return originalGetSources(...args);
};
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
global.virtualDisplayService.destroyDisplaySilently = async () => {};

app.whenReady().then(async () => {
  let viewer;
  try {
    for (const display of screen.getAllDisplays()) {
      const animation = new BrowserWindow({
        show: true, frame: false, alwaysOnTop: true,
        x: display.bounds.x + 20, y: display.bounds.y + 20, width: 240, height: 160,
        webPreferences: { backgroundThrottling: false },
      });
      await animation.loadURL('data:text/html,' + encodeURIComponent('<title>Perf Content</title><canvas id="c" width="220" height="150"></canvas><script>let n=0;setInterval(()=>{const x=c.getContext("2d");x.fillStyle=(++n%2)?"red":"blue";x.fillRect(0,0,220,150)},50)</script>'));
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
      const orig = RTCPeerConnection.prototype.createOffer;
      RTCPeerConnection.prototype.createOffer = function (...args) { window.__pc = this; return orig.apply(this, args); };
    })()`);
    helper.hide();
    await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('set-device-connected-status')");
    await sharing.setDesktopCapturerSourceID(source.id);
    await sharing.callPeer();
    await waitFor(() => viewer.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`), 'video');
    await delay(3000);

    const samples = [];
    for (let i = 0; i < 6; i++) {
      const s = await helper.webContents.executeJavaScript(`(async () => {
        const pc = window.__pc;
        const stats = await pc.getStats();
        let out = null, codec = null, remoteIn = null;
        stats.forEach(r => {
          if (r.type === 'outbound-rtp' && r.kind === 'video') out = r;
          if (r.type === 'remote-inbound-rtp' && r.kind === 'video') remoteIn = r;
        });
        if (out && out.codecId) stats.forEach(r => { if (r.id === out.codecId) codec = r; });
        return {
          codec: codec ? codec.mimeType : null,
          encoder: out ? out.encoderImplementation : null,
          fps: out ? out.framesPerSecond : null,
          w: out ? out.frameWidth : null,
          h: out ? out.frameHeight : null,
          qlr: out ? out.qualityLimitationReason : null,
          qld: out ? out.qualityLimitationDurations : null,
          bytes: out ? out.bytesSent : null,
          nack: remoteIn ? remoteIn.nackCount : null,
          lost: remoteIn ? remoteIn.packetsLost : null,
          jitter: remoteIn ? remoteIn.jitter : null,
        };
      })()`);
      samples.push(s);
      await delay(1500);
    }
    log('SAMPLES=' + JSON.stringify(samples, null, 1));

    // Main-process responsiveness: how long an IPC round-trip takes (a proxy
    // for UI/mouse stalls caused by work on the main thread).
    const ipcLatencies = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-port')");
      ipcLatencies.push(Date.now() - t0);
      await delay(250);
    }
    ipcLatencies.sort((a, b) => a - b);
    log('IPC_LATENCY_MS=' + JSON.stringify({ min: ipcLatencies[0], p50: ipcLatencies[10], max: ipcLatencies[ipcLatencies.length - 1] }));

    // Count how many heavy full-enumeration calls happen during idle streaming.
    getSourcesCalls = 0;
    windowEnumerations = 0;
    screenOnlyEnumerations = 0;
    heavyStacks = [];
    captureStacks = true;
    await delay(12000);
    captureStacks = false;
    log('GETSOURCES_CALLS_IN_12S=' + getSourcesCalls + ' heavyWindowEnumerations=' + windowEnumerations + ' screenOnly=' + screenOnlyEnumerations);
    log('HEAVY_STACKS=' + JSON.stringify(heavyStacks.slice(0, 2)));
    log('PERF_PROBE_DONE');
    app.exit(0);
  } catch (error) {
    log('PERF_PROBE_FAIL ' + String(error));
    app.exit(1);
  }
});

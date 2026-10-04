const { app, BrowserWindow, screen } = require('electron');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'loop-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const report = path.join(__dirname, 'loop-report.txt');
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
let heavy = 0, light = 0;
const orig = electron.desktopCapturer.getSources.bind(electron.desktopCapturer);
electron.desktopCapturer.getSources = (...a) => { const t = a[0]?.types || []; if (t.includes('window')) heavy++; else light++; return orig(...a); };
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
global.virtualDisplayService.destroyDisplaySilently = async () => {};

function lagSnapshot(h) { return { max: +(h.max / 1e6).toFixed(1), p99: +(h.percentile(99) / 1e6).toFixed(1), mean: +(h.mean / 1e6).toFixed(2) }; }

app.whenReady().then(async () => {
  let viewer;
  try {
    for (const display of screen.getAllDisplays()) {
      const animation = new BrowserWindow({ show: true, frame: false, alwaysOnTop: true,
        x: display.bounds.x + 20, y: display.bounds.y + 20, width: 240, height: 160,
        webPreferences: { backgroundThrottling: false } });
      await animation.loadURL('data:text/html,' + encodeURIComponent('<title>Loop Content</title><canvas id="c" width="220" height="150"></canvas><script>let n=0;setInterval(()=>{const x=c.getContext("2d");x.fillStyle=(++n%2)?"red":"blue";x.fillRect(0,0,220,150)},50)</script>'));
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
    helper.hide();
    await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('set-device-connected-status')");
    await sharing.setDesktopCapturerSourceID(source.id);
    await sharing.callPeer();
    await waitFor(() => viewer.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`), 'video');
    await delay(2000);

    // Phase A: idle streaming with the fixed (light) background refresh.
    heavy = 0; light = 0;
    const hA = monitorEventLoopDelay({ resolution: 10 });
    hA.enable();
    await delay(12000);
    hA.disable();
    log('PHASE_A_FIXED_IDLE=' + JSON.stringify({ ...lagSnapshot(hA), heavy, light }));

    // Phase B: force the old behaviour (full window enumeration) and measure.
    heavy = 0; light = 0;
    const hB = monitorEventLoopDelay({ resolution: 10 });
    hB.enable();
    for (let i = 0; i < 3; i++) {
      await global.desktopCapturerSourcesService.refreshDesktopCapturerSources();
      await delay(3000);
    }
    hB.disable();
    log('PHASE_B_HEAVY=' + JSON.stringify({ ...lagSnapshot(hB), heavy, light }));
    log('LOOP_PROBE_DONE');
    app.exit(0);
  } catch (error) {
    log('LOOP_PROBE_FAIL ' + String(error));
    app.exit(1);
  }
});

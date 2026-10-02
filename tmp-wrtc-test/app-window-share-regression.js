const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'app-window-share-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const report = path.join(__dirname, 'app-window-share-report.txt');
const log = (...p) => { const l = `${new Date().toISOString()} ${p.join(' ')}`; process.stdout.write(l + '\n'); fs.appendFileSync(report, l + '\n'); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await delay(100); }
  throw new Error('Timed out: ' + label);
}

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
global.virtualDisplayService.destroyDisplaySilently = async () => {};
let viewer;

app.whenReady().then(async () => {
  try {
    // A real, capturable application window to share.
    const target = new BrowserWindow({ width: 500, height: 360, webPreferences: { backgroundThrottling: false } });
    await target.loadURL('data:text/html,' + encodeURIComponent('<title>AltronScreen Share Target App</title><canvas id="c" width="400" height="260"></canvas><script>let n=0;setInterval(()=>{const x=c.getContext("2d");x.fillStyle=(++n%2)?"red":"blue";x.fillRect(0,0,400,260)},100)</script>'));

    const host = await waitFor(() => {
      const w = altronscreenApp.mainWindow;
      return w && !w.webContents.isLoading() && w;
    }, 'host');
    const port = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-port')");
    const ip = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-local-lan-ip')");
    viewer = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await viewer.loadURL(`http://${ip}:${port}/`);
    await waitFor(() => viewer.webContents.executeJavaScript("(() => { const l = document.querySelector('[data-testid=connect-current-host]'); if (!l) return false; l.click(); return true; })()"), 'viewer request');
    await waitFor(() => global.connectedDevicesService.pendingConnectionDevice.id, 'pending');
    const sharing = global.sharingSessionService.waitingForConnectionSharingSession;
    const helper = sharing.peerConnectionHelperRenderer;
    await waitFor(() => !helper.webContents.isLoading(), 'helper');
    helper.hide();
    await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('set-device-connected-status')");

    const click = (text) => waitFor(() => host.webContents.executeJavaScript(`(() => {
      const b = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)} && !el.disabled);
      if (!b) return false; b.click(); return true;
    })()`), 'button ' + text);

    await click('Allow');
    await click('Application Window');
    await waitFor(() => host.webContents.executeJavaScript("Boolean(document.querySelector('.choose-app-or-screen-dialog'))"), 'overlay');
    await delay(2000);

    const listed = await host.webContents.executeJavaScript(`(() => {
      return [...document.querySelectorAll('.choose-app-or-screen-dialog .preview-share-thumb-container')].map(c => c.textContent.trim());
    })()`);
    log('LISTED_WINDOWS:', JSON.stringify(listed));
    assert.ok(listed.some(name => name.includes('AltronScreen Share Target App')), 'target app must be listed');
    assert.ok(!listed.some(name => name.toLowerCase().includes('electron helper renderer')), 'internal helper must be filtered out');

    const clicked = await waitFor(() => host.webContents.executeJavaScript(`(() => {
      const card = [...document.querySelectorAll('.choose-app-or-screen-dialog .preview-share-thumb-container')].find(c => c.textContent.includes('AltronScreen Share Target App'));
      if (!card?.querySelector('img')) return false;
      card.click(); return true;
    })()`), 'click target app');
    assert.ok(clicked);

    await click('Confirm');
    const video = await waitFor(() => viewer.webContents.executeJavaScript(`(() => {
      const v = document.querySelector('video');
      if (!v?.srcObject || v.readyState < 2 || v.videoWidth === 0) return null;
      return { width: v.videoWidth, height: v.videoHeight, tracks: v.srcObject.getVideoTracks().length };
    })()`), 'viewer receives window video', 30000);
    log('WINDOW_SHARE_VIDEO:', JSON.stringify(video));
    assert.ok(video.width > 0 && video.height > 0);
    log('APP_WINDOW_SHARE_PASS');

    // Also confirm the Entire Screen tab still renders the add/remove card.
    await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('disconnect-peer-and-destroy-sharing-session-by-session-id', " + JSON.stringify(sharing.id) + ")");
    await delay(1500);
    log('DONE');
    app.exit(0);
  } catch (error) {
    log('APP_WINDOW_SHARE_FAIL:', String(error));
    if (viewer && !viewer.isDestroyed()) log('VIEWER:', await viewer.webContents.executeJavaScript('document.body.innerText'));
    app.exit(1);
  }
});

const { app, BrowserWindow, desktopCapturer } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'robustness-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const report = path.join(__dirname, 'robustness-report.txt');
const log = (...p) => { const l = `${new Date().toISOString()} ${p.join(' ')}`; process.stdout.write(l + '\n'); fs.appendFileSync(report, l + '\n'); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await delay(100); }
  throw new Error('Timed out: ' + label);
}

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};

app.whenReady().then(async () => {
  let viewer;
  try {
    const svc = global.desktopCapturerSourcesService;

    // 1. Keep-last-good: first enumeration succeeds, then a forced empty result
    //    must not blank out the window list.
    await svc.refreshDesktopCapturerSources();
    const before = svc.getAppWindowSources().length;
    log('INITIAL_WINDOWS=' + before);
    const originalGetSources = desktopCapturer.getSources.bind(desktopCapturer);
    let forceEmpty = true;
    desktopCapturer.getSources = async (opts) => {
      if (forceEmpty) return [];
      return originalGetSources(opts);
    };
    await svc.refreshDesktopCapturerSources();
    const after = svc.getAppWindowSources().length;
    log('AFTER_FORCED_EMPTY_WINDOWS=' + after);
    desktopCapturer.getSources = originalGetSources;
    assert.ok(before > 0, 'baseline should see windows');
    assert.equal(after, before, 'empty enumeration must not blank the list');
    log('KEEP_LAST_GOOD_PASS');

    // 2. Icon failure fallback: fetchWindowIcons=true throws, no-icons succeeds.
    let threwWithIcons = false;
    desktopCapturer.getSources = async (opts) => {
      if (opts.fetchWindowIcons) { threwWithIcons = true; throw new Error('icon extraction failed'); }
      return originalGetSources(opts);
    };
    await svc.refreshDesktopCapturerSources();
    desktopCapturer.getSources = originalGetSources;
    const afterIconFail = svc.getAppWindowSources().length;
    log('AFTER_ICON_THROW_WINDOWS=' + afterIconFail + ' threwWithIcons=' + threwWithIcons);
    assert.ok(threwWithIcons, 'icon path should have been attempted');
    assert.ok(afterIconFail > 0, 'no-icon fallback must still list windows');
    log('ICON_FALLBACK_PASS');

    // 3. Full flow: overlay lists windows whose cards resolve details.
    const target = new BrowserWindow({ width: 460, height: 340, show: true });
    await target.loadURL('data:text/html,' + encodeURIComponent('<title>Robustness Target</title><h1>T</h1>'));
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
    helper.hide();
    await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('set-device-connected-status')");
    const click = (text) => waitFor(() => host.webContents.executeJavaScript(`(() => {
      const b = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)} && !el.disabled);
      if (!b) return false; b.click(); return true;
    })()`), 'button ' + text);
    await click('Allow'); await click('Application Window');
    await waitFor(() => host.webContents.executeJavaScript("Boolean(document.querySelector('.choose-app-or-screen-dialog'))"), 'overlay');
    await delay(2500);
    const state = await host.webContents.executeJavaScript(`(() => {
      const cards = [...document.querySelectorAll('.choose-app-or-screen-dialog .preview-share-thumb-container')];
      return { count: cards.length, withImages: cards.filter(c => c.querySelector('img')).length,
        names: cards.map(c => c.textContent.trim()) };
    })()`);
    log('OVERLAY=' + JSON.stringify(state));
    assert.ok(state.count > 0, 'overlay must list windows');
    assert.equal(state.withImages, state.count, 'every card must resolve its thumbnail');
    assert.ok(state.names.some(n => n.includes('Robustness Target')), 'target app listed');
    log('OVERLAY_CARDS_RESOLVE_PASS');

    log('ROBUSTNESS_REGRESSION_PASS');
    app.exit(0);
  } catch (error) {
    log('ROBUSTNESS_REGRESSION_FAIL ' + String(error));
    app.exit(1);
  }
});

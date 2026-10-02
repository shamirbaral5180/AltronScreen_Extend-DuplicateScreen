const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_, level, message) => {
    if (level >= 3) console.error('RENDERER:', message);
  });
});
require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
global.virtualDisplayService.destroyDisplaySilently = async () => {};
const phones = [];
let laptop;

app.whenReady().then(async () => {
  try {
    for (const display of screen.getAllDisplays()) {
      const animation = new BrowserWindow({ show: true, frame: false, alwaysOnTop: true,
        x: display.bounds.x + 20, y: display.bounds.y + 20, width: 220, height: 140,
        webPreferences: { backgroundThrottling: false } });
      await animation.loadURL('data:text/html,' + encodeURIComponent('<title>Multi Viewer Test</title><canvas id="c" width="200" height="120"></canvas><script>let n=0;setInterval(()=>{const x=c.getContext("2d");x.fillStyle=(++n%2)?"red":"blue";x.fillRect(0,0,200,120)},100)</script>'));
    }
    const host = await waitFor(() => {
      const win = altronscreenApp.mainWindow;
      return win && !win.webContents.isLoading() && win;
    }, 'host ready');
    const port = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-port')");
    const ip = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-local-lan-ip')");
    const url = `http://${ip}:${port}/`;
    await global.desktopCapturerSourcesService.refreshDesktopCapturerSources();
    const sources = global.desktopCapturerSourcesService.getScreenSources();
    assert.ok(sources.length > 0);
    const click = text => waitFor(() => host.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)} && !el.disabled);
      if (!button) return false;
      button.click(); return true;
    })()`), `button ${text}`);
    const openViewer = async (mobile = false) => {
      const viewer = new BrowserWindow({ show: false, width: mobile ? 390 : 1280,
        height: mobile ? 844 : 720, webPreferences: { backgroundThrottling: false } });
      if (mobile) viewer.webContents.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36');
      await viewer.loadURL(url);
      await waitFor(() => viewer.webContents.executeJavaScript("(() => { const link = document.querySelector('[data-testid=connect-current-host]'); if (!link) return false; link.click(); return true; })()"), 'viewer requests connection');
      return viewer;
    };
    const videoState = viewer => viewer.webContents.executeJavaScript(`(() => {
      const video = document.querySelector('video');
      if (!video?.srcObject) return null;
      for (let node = video; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return null;
      }
      const bounds = video.getBoundingClientRect();
      return { visible: bounds.width > 0 && bounds.height > 0,
        ready: video.readyState >= 2 && video.videoWidth > 0, time: video.currentTime,
        live: video.srcObject.getVideoTracks().every(track => track.readyState === 'live') };
    })()`);
    const readyVideo = viewer => waitFor(async () => {
      const state = await videoState(viewer);
      return state?.visible && state.ready && state.live && state;
    }, 'visible received video');
    const approve = async (sourceIndex = 0) => {
      await waitFor(() => {
        const device = global.connectedDevicesService.pendingConnectionDevice;
        return device.id && global.sharingSessionService.waitingForConnectionSharingSession?.id === device.sharingSessionID;
      }, 'approval request');
      const sharing = global.sharingSessionService.waitingForConnectionSharingSession;
      const helper = sharing.peerConnectionHelperRenderer;
      helper.hide();
      await helper.webContents.executeJavaScript(`(() => {
        const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = async (...args) => {
          const stream = await capture(...args);
          window.__capturedSource = stream.getVideoTracks()[0].getSettings().deviceId;
          return stream;
        };
      })()`);
      await click('Allow');
      await click('Entire Screen');
      await waitFor(() => host.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('.choose-app-or-screen-dialog .preview-share-thumb-container')];
        const card = cards[${sourceIndex}];
        if (!card?.querySelector('img')) return false;
        card.click(); return true;
      })()`), 'screen card');
      await click('Confirm');
      await waitFor(() => global.connectedDevicesService.getDevices().some(device => device.sharingSessionID === sharing.id), 'viewer accepted');
      return sharing;
    };

    laptop = await openViewer();
    const laptopSharing = await approve(Math.min(1, sources.length - 1));
    await readyVideo(laptop);
    assert.equal(global.connectedDevicesService.getDevices().length, 1);
    await waitFor(() => host.webContents.executeJavaScript("Boolean(document.getElementById('magnify-qr-code-button') && !document.getElementById('magnify-qr-code-button').disabled)"), 'QR remains available for additional viewers');

    const phone = await openViewer(true);
    phones.push(phone);
    await waitFor(() => global.connectedDevicesService.pendingConnectionDevice.deviceType === 'mobile', 'phone approval');
    const phonePendingID = global.connectedDevicesService.pendingConnectionDevice.sharingSessionID;
    const queued = await openViewer(true);
    phones.push(queued);
    await waitFor(() => global.connectedDevicesService.pendingDevices.size === 2, 'second request queued');
    assert.equal(global.connectedDevicesService.pendingConnectionDevice.sharingSessionID, phonePendingID);
    await readyVideo(laptop);
    assert.equal(global.connectedDevicesService.getDevices().length, 1);

    const phoneSharing = await approve(0);
    await readyVideo(phone);
    assert.equal(global.connectedDevicesService.getDevices().length, 2);
    assert.notEqual(phoneSharing.roomID, laptopSharing.roomID);
    console.log('TWO_VIEWERS_CONNECTED_PASS:', JSON.stringify({ laptop: laptopSharing.roomID, phone: phoneSharing.roomID }));

    const tabletSharing = await approve(0);
    await readyVideo(queued);
    assert.equal(global.connectedDevicesService.getDevices().length, 3);
    assert.notEqual(tabletSharing.roomID, phoneSharing.roomID);
    queued.close();
    await waitFor(() => global.connectedDevicesService.getDevices().length === 2, 'queued viewer disconnect leaves first two connected');
    const abandoned = await openViewer(true);
    phones.push(abandoned);
    await waitFor(() => global.connectedDevicesService.pendingDevices.size === 1, 'new pending request');
    abandoned.close();
    await waitFor(() => global.connectedDevicesService.pendingDevices.size === 0, 'abandoned approval cleaned up');
    await readyVideo(laptop);
    await readyVideo(phone);
    console.log('QUEUED_APPROVAL_AND_ABANDONMENT_PASS');

    // Simultaneous capture changes must use the source selected by each helper.
    await Promise.all([
      laptopSharing.setDesktopCapturerSourceID(sources[0].id),
      phoneSharing.setDesktopCapturerSourceID(sources[Math.min(1, sources.length - 1)].id),
    ]);
    const laptopSource = await laptopSharing.peerConnectionHelperRenderer.webContents.executeJavaScript('window.__capturedSource');
    const phoneSource = await phoneSharing.peerConnectionHelperRenderer.webContents.executeJavaScript('window.__capturedSource');
    assert.equal(laptopSource, sources[0].id);
    assert.equal(phoneSource, sources[Math.min(1, sources.length - 1)].id);
    console.log('INDEPENDENT_CONCURRENT_CAPTURE_PASS');

    const initialLaptop = await readyVideo(laptop);
    const initialPhone = await readyVideo(phone);
    for (let i = 0; i < 8; i++) {
      await delay(2000);
      const a = await readyVideo(laptop);
      const b = await readyVideo(phone);
      assert.ok(a.time > initialLaptop.time && b.time > initialPhone.time);
      assert.equal(global.connectedDevicesService.getDevices().length, 2);
    }
    console.log('SIMULTANEOUS_VISIBLE_PLAYBACK_PASS');

    const laptopBeforeClose = await readyVideo(laptop);
    phone.close();
    await waitFor(() => global.connectedDevicesService.getDevices().length === 1, 'phone disconnect removes only phone');
    await delay(1500);
    assert.ok((await readyVideo(laptop)).time > laptopBeforeClose.time);
    assert.ok(global.sharingSessionService.sharingSessions.has(laptopSharing.id));
    console.log('DISCONNECT_ISOLATION_PASS');

    const replacement = await openViewer(true);
    phones.push(replacement);
    const replacementSharing = await approve(0);
    await readyVideo(replacement);
    assert.equal(global.connectedDevicesService.getDevices().length, 2);
    assert.notEqual(replacementSharing.roomID, phoneSharing.roomID);
    await host.webContents.executeJavaScript(`window.electron.ipcRenderer.invoke('disconnect-peer-and-destroy-sharing-session-by-session-id', ${JSON.stringify(replacementSharing.id)})`);
    await waitFor(() => global.connectedDevicesService.getDevices().length === 1, 'host disconnects only replacement phone');
    await readyVideo(laptop);
    console.log('RECONNECT_AND_HOST_DISCONNECT_PASS');
    if (process.argv.includes('--report')) {
      fs.writeFileSync(path.join(__dirname, 'multi-viewer-admin-report.json'), JSON.stringify({ ok: true, simultaneousViewers: 2, independentCapture: true, queuedApprovals: true, sustainedSeconds: 16, disconnectIsolation: true, reconnect: true }, null, 2));
    }
    app.exit(0);
  } catch (error) {
    console.error('MULTI_VIEWER_REGRESSION_FAIL:', error);
    if (process.argv.includes('--report')) fs.writeFileSync(path.join(__dirname, 'multi-viewer-admin-report.json'), JSON.stringify({ ok: false, error: String(error) }, null, 2));
    const host = altronscreenApp.mainWindow;
    if (host && !host.isDestroyed()) console.log('HOST_TEXT:', await host.webContents.executeJavaScript('document.body.innerText'));
    for (const viewer of [laptop, ...phones]) {
      if (viewer && !viewer.isDestroyed()) console.log('VIEWER_TEXT:', await viewer.webContents.executeJavaScript('document.body.innerText'));
    }
    app.exit(1);
  }
});

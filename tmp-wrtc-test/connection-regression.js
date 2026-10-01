const { app, BrowserWindow, ipcMain, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, (...args) => {
  if (['destroy-sharing-session-by-id', 'unmark-room-id-as-taken', 'disconnect-device-by-id', 'reset-waiting-for-connection-sharing-session', 'create-waiting-for-connection-sharing-session'].includes(channel)) {
    console.log('IPC_TRACE:', channel, args[0].sender.id, JSON.stringify(args.slice(1)));
  }
  return listener(...args);
});
const { Socket } = require('socket.io');
const emit = Socket.prototype.emit;
Socket.prototype.emit = function(event, ...args) {
  if (['ROOM_LOCKED', 'NOT_ALLOWED', 'USER_ENTER', 'USER_EXIT'].includes(event)) {
    console.log('SERVER_EVENT:', event, this.id);
  }
  return emit.call(this, event, ...args);
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_, level, message) => {
    if (level >= 2) console.log('RENDERER:', message);
  });
  contents.on('preload-error', (_, preload, error) => console.error('PRELOAD:', preload, error));
});

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
// This regression tests sharing, not privileged driver installation.
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
global.virtualDisplayService.destroyDisplaySilently = async () => {};
const mark = global.roomIDService.markRoomIDAsTaken.bind(global.roomIDService);
global.roomIDService.markRoomIDAsTaken = id => { console.log('ROOM_MARK:', id); mark(id); };
const unmark = global.roomIDService.unmarkRoomIDAsTaken.bind(global.roomIDService);
global.roomIDService.unmarkRoomIDAsTaken = id => { console.log('ROOM_UNMARK:', id); unmark(id); };

app.whenReady().then(async () => {
  let viewer;
  try {
    // A static desktop can intentionally send no new frames (WebRTC zero-Hz mode).
    // Put moving content on each display so advancing playback is testable.
    for (const display of screen.getAllDisplays()) {
      const animation = new BrowserWindow({
        show: true, frame: false, alwaysOnTop: true,
        x: display.bounds.x + 20, y: display.bounds.y + 20,
        width: 220, height: 140,
        webPreferences: { backgroundThrottling: false },
      });
      await animation.loadURL('data:text/html,' + encodeURIComponent('<title>AltronScreen Playback Test</title><canvas id="c" width="200" height="120"></canvas><script>let n=0;setInterval(()=>{const x=c.getContext("2d");x.fillStyle=(++n%2)?"red":"blue";x.fillRect(0,0,200,120)},100)</script>'));
    }
    const host = await waitFor(() => {
      const win = altronscreenApp.mainWindow;
      return win && !win.webContents.isLoading() && win;
    }, 'host ready');
    const port = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-port')");
    const ip = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-local-lan-ip')");
    viewer = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await viewer.loadURL(`http://${ip}:${port}/`);
    await waitFor(() => global.connectedDevicesService.pendingConnectionDevice.id, 'viewer approval request');
    let sharing = global.sharingSessionService.waitingForConnectionSharingSession;
    let helper = sharing.peerConnectionHelperRenderer;
    await waitFor(() => !helper.webContents.isLoading(), 'helper ready');
    const preload = await helper.webContents.executeJavaScript('Boolean(window.electron?.ipcRenderer)');
    assert.equal(preload, true, 'helper preload available');
    await global.desktopCapturerSourcesService.refreshDesktopCapturerSources();
    const source = global.desktopCapturerSourcesService.getScreenSources()[0];
    assert.ok(source, 'screen capture source exists');

    // Deliberately delay capture; the old implementation loses call-peer here.
    await helper.webContents.executeJavaScript(`(() => {
      const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 1200));
        if (${process.argv.includes('--fail-capture')}) throw new Error('Simulated screen capture failure');
        return original(...args);
      };
      if (${process.argv.includes('--fail-connect')}) {
        const emit = SimplePeer.prototype.emit;
        SimplePeer.prototype.emit = function(event, ...args) {
          if (event === 'signal') return true;
          return emit.call(this, event, ...args);
        };
        const timeout = window.setTimeout.bind(window);
        window.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 30000 ? 1000 : ms, ...args);
      }
    })()`);
    helper.hide();
    const clickButton = async (text) => waitFor(() => host.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)} && !button.disabled);
      if (!button) return false;
      button.click(); return true;
    })()`), `host button ${text}`);
    const selectScreen = () => waitFor(() => host.webContents.executeJavaScript(`(() => {
      const cards = [...document.querySelectorAll('.choose-app-or-screen-dialog .preview-share-thumb-container')];
      const card = cards.find(card => card.textContent.includes('Screen 2')) || cards[0];
      if (!card?.querySelector('img')) return false;
      card.click(); return true;
    })()`), 'screen selection card');
    if (process.argv.includes('--ui')) {
      await clickButton('Allow');
      await clickButton('Entire Screen');
      await selectScreen();
      if (process.argv.includes('--fail-capture')) {
        const errorText = await waitFor(() => host.webContents.executeJavaScript("document.querySelector('[role=alert]')?.textContent"), 'visible source capture error');
        assert.ok(errorText.includes('Simulated screen capture failure'));
        assert.equal(global.connectedDevicesService.getDevices().length, 0);
        console.log('CAPTURE_FAILURE_UI_PASS:', errorText);
        app.exit(0);
        return;
      }
      await clickButton('Confirm');
      if (process.argv.includes('--fail-connect')) {
        const errorText = await waitFor(() => host.webContents.executeJavaScript("[...document.querySelectorAll('[role=alert]')].map(el => el.textContent).find(text => text.includes('WebRTC'))"), 'visible connection failure');
        assert.equal(global.connectedDevicesService.getDevices().length, 0);
        console.log('CONNECTION_FAILURE_UI_PASS:', errorText);
        viewer.reload();
        await waitFor(() => global.connectedDevicesService.pendingConnectionDevice.id, 'new viewer approval after failure');
        sharing = global.sharingSessionService.waitingForConnectionSharingSession;
        helper = sharing.peerConnectionHelperRenderer;
        await clickButton('Allow');
        await clickButton('Entire Screen');
        await selectScreen();
        await clickButton('Confirm');
        console.log('RECONNECTION_UI_SUBMITTED');
      }
    } else {
      await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('set-device-connected-status')");
      const preparing = sharing.setDesktopCapturerSourceID(source.id);
      const connecting = sharing.callPeer();
      await preparing;
      await connecting;
    }
    const video = await waitFor(() => viewer.webContents.executeJavaScript(`(() => {
      const video = document.querySelector('video');
      if (!video?.srcObject || video.readyState < 2 || video.videoWidth === 0) return null;
      return { width: video.videoWidth, height: video.videoHeight,
        tracks: video.srcObject.getVideoTracks().length, time: video.currentTime };
    })()`), 'browser receives and decodes screen video', 30000);
    console.log('CONNECTION_REGRESSION_PASS:', JSON.stringify(video));
    if (process.argv.includes('--ui')) {
      await waitFor(() => global.connectedDevicesService.getDevices().length === 1, 'confirmed viewer slot');
      assert.equal(global.sharingSessionService.waitingForConnectionSharingSession, null);
    }
    await delay(1000);
    const advanced = await viewer.webContents.executeJavaScript("document.querySelector('video').currentTime");
    assert.ok(advanced > video.time, 'video playback advances');
    console.log('PLAYBACK_PASS:', advanced);
    const visiblePlayback = () => viewer.webContents.executeJavaScript(`(() => {
      const video = document.querySelector('video');
      if (!video) return { visible: false, reason: 'video removed' };
      for (let node = video; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return { visible: false, reason: 'hidden ancestor', element: node.tagName, id: node.id, className: node.className };
        }
      }
      const rect = video.getBoundingClientRect();
      const tracks = video.srcObject?.getVideoTracks() || [];
      return { visible: rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.left < innerWidth,
        width: rect.width, height: rect.height, readyState: video.readyState, time: video.currentTime,
        tracksLive: tracks.length > 0 && tracks.every(track => track.readyState === 'live') };
    })()`);
    await delay(1500);
    const visibility = await visiblePlayback();
    assert.ok(visibility.visible, `player remains visible after startup: ${JSON.stringify(visibility)}`);
    console.log('PLAYER_VISIBILITY_PASS:', JSON.stringify(visibility));
    for (let i = 0; i < 2; i++) {
      await sharing.setDesktopCapturerSourceID(source.id);
      await delay(2500);
      const nextTime = await viewer.webContents.executeJavaScript("document.querySelector('video').currentTime");
      assert.ok(nextTime > advanced, 'repeated source switching preserves playback');
    }
    console.log('REPEATED_SOURCE_SWITCH_PASS');
    const sustained = [];
    for (const [width, height, nativePlayer] of [[1280, 720, false], [390, 844, false], [390, 844, true], [1280, 720, false]]) {
      viewer.setContentSize(width, height);
      await viewer.webContents.executeJavaScript(`(() => {
        const toggle = document.querySelector('input[type=checkbox]');
        if (!toggle) throw new Error('Player toggle missing');
        if (toggle.checked !== ${nativePlayer}) toggle.click();
      })()`);
      await waitFor(async () => {
        const state = await visiblePlayback();
        return state.visible && state.readyState >= 2 && state.tracksLive;
      }, 'visible player after viewport/player change');
      const initial = await visiblePlayback();
      for (let sample = 0; sample < 3; sample++) {
        await delay(2000);
        const state = await visiblePlayback();
        assert.ok(state.visible && state.readyState >= 2 && state.tracksLive, `sustained visible playback: ${JSON.stringify(state)}`);
        assert.ok(state.time > initial.time, 'moving capture continues playing after viewport/player change');
        sustained.push({ viewport: [width, height], nativePlayer, ...state });
      }
    }
    console.log('SUSTAINED_VISIBLE_PLAYBACK_PASS:', JSON.stringify({ samples: sustained.length, seconds: 24, desktopAndMobile: true, bothPlayers: true }));
    if (process.argv.includes('--report')) {
      fs.writeFileSync(path.join(__dirname, 'connection-admin-report.json'), JSON.stringify({ ok: true, video, playbackTime: advanced, repeatedSourceSwitch: true, sustained, captureFlags: app.commandLine.getSwitchValue('disable-features') }, null, 2));
    }
    app.exit(0);
  } catch (error) {
    console.error('CONNECTION_REGRESSION_FAIL:', error);
    if (process.argv.includes('--report')) {
      const viewerState = viewer && !viewer.isDestroyed() ? await viewer.webContents.executeJavaScript(`(() => {
        const video = document.querySelector('video');
        return { text: document.body.innerText, video: video && { readyState: video.readyState, paused: video.paused, width: video.videoWidth, srcObject: Boolean(video.srcObject), tracks: video.srcObject?.getTracks().map(track => ({ kind: track.kind, readyState: track.readyState, muted: track.muted })) } };
      })()`) : null;
      fs.writeFileSync(path.join(__dirname, 'connection-admin-report.json'), JSON.stringify({ ok: false, error: String(error), viewerState, captureFlags: app.commandLine.getSwitchValue('disable-features'), connected: global.connectedDevicesService.getDevices().length }, null, 2));
    }
    console.log('HOST_STATE:', JSON.stringify({ rooms: [...global.roomIDService.takenRoomIDs], waiting: global.sharingSessionService.waitingForConnectionSharingSession?.id, pending: global.connectedDevicesService.pendingConnectionDevice.id }));
    if (altronscreenApp.mainWindow) console.log('HOST_TEXT:', await altronscreenApp.mainWindow.webContents.executeJavaScript('document.body.innerText'));
    if (viewer) console.log('VIEWER_TEXT:', await viewer.webContents.executeJavaScript('document.body.innerText'));
    app.exit(1);
  }
});

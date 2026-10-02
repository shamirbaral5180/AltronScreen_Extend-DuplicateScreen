const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dgram = require('node:dgram');
const dataDir = path.join(__dirname, 'reconnect-settings-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await fn();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
global.virtualDisplayService.destroyDisplaySilently = async () => {};
let viewer;

app.whenReady().then(async () => {
  try {
    for (const display of screen.getAllDisplays()) {
      const animation = new BrowserWindow({ show: true, frame: false, alwaysOnTop: true,
        x: display.bounds.x + 20, y: display.bounds.y + 20, width: 220, height: 140,
        webPreferences: { backgroundThrottling: false } });
      await animation.loadURL('data:text/html,' + encodeURIComponent('<title>Reconnect Test</title><canvas id="c" width="200" height="120"></canvas><script>let n=0;setInterval(()=>{const x=c.getContext("2d");x.fillStyle=(++n%2)?"red":"blue";x.fillRect(0,0,200,120)},100)</script>'));
    }
    const host = await waitFor(() => altronscreenApp.mainWindow && !altronscreenApp.mainWindow.webContents.isLoading() && altronscreenApp.mainWindow, 'host');
    const port = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-port')");
    const ip = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-local-lan-ip')");
    const url = `http://${ip}:${port}`;
    const clickHost = text => waitFor(() => host.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)} && !el.disabled);
      if (!button) return false; button.click(); return true;
    })()`), `host ${text}`);
    const home = () => viewer.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=viewer-home]') && !document.querySelector('video') && !document.body.innerText.includes('Something went wrong'))");
    const request = () => waitFor(() => viewer.webContents.executeJavaScript("(() => { const link = document.querySelector('[data-testid=connect-current-host]'); if (!link) return false; link.click(); return true; })()"), 'request host');
    const video = () => viewer.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('video');
      if (!el?.srcObject || el.readyState < 2) return null;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && { time: el.currentTime, width: el.videoWidth, height: el.videoHeight };
    })()`);
    const approve = async () => {
      await waitFor(() => global.connectedDevicesService.pendingConnectionDevice.id, 'approval');
      const session = global.sharingSessionService.waitingForConnectionSharingSession;
      const helper = session.peerConnectionHelperRenderer;
      helper.hide();
      await helper.webContents.executeJavaScript(`(() => {
        const add = SimplePeer.prototype.addStream;
        SimplePeer.prototype.addStream = function(stream) { window.__hostPeer = this; window.__hostStream = stream; return add.call(this, stream); };
      })()`);
      await clickHost('Allow'); await clickHost('Entire Screen');
      await waitFor(() => host.webContents.executeJavaScript("(() => { const card = document.querySelector('.choose-app-or-screen-dialog .preview-share-thumb-container'); if (!card?.querySelector('img')) return false; card.click(); return true; })()"), 'screen');
      await clickHost('Confirm');
      await waitFor(video, 'video');
      return session;
    };
    viewer = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await viewer.loadURL(url);
    await waitFor(home, 'initial home');
    await delay(1500);
    assert.equal(global.sharingSessionService.sharingSessions.size, 0, 'home must not request access automatically');
    await viewer.webContents.executeJavaScript(`(() => {
      const Native = window.RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(Native, { construct(target, args) { const pc = new target(...args); window.__receiverPC = pc; return pc; } });
    })()`);

    // Exercise the actual host settings UI and check its persisted values.
    await host.webContents.executeJavaScript("document.getElementById('top-panel-settings-button').click()");
    await waitFor(() => host.webContents.executeJavaScript("Boolean(document.getElementById('stream-preset') && !document.getElementById('stream-preset').disabled)"), 'settings UI');
    await host.webContents.executeJavaScript("(() => { const el = document.getElementById('stream-preset'); el.value = 'speed'; el.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await clickHost('Save streaming settings');
    await waitFor(() => host.webContents.executeJavaScript("document.body.innerText.includes('Settings saved and applied')"), 'settings saved');
    const speed = await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-stream-settings')");
    assert.equal(speed.frameRate, 30); assert.equal(speed.resolutionScale, 0.5); assert.equal(speed.bitrateMbps, 3);
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'altronscreen-storage.json'), 'utf8'));
    assert.deepEqual(JSON.parse(persisted['stream-settings']), speed);
    await host.webContents.executeJavaScript("document.querySelector('#settings-overlay-inner #close-overlay-button').click()");

    // Receive an announcement over the real LAN UDP socket, not a fabricated UI list.
    const announcement = dgram.createSocket('udp4');
    await new Promise(resolve => announcement.bind(0, ip, resolve));
    await new Promise((resolve, reject) => announcement.send(Buffer.from(JSON.stringify({ app: 'altronscreen', version: 1, id: 'regression-host', name: 'Regression nearby computer', port: 42425 })), 31333, ip, error => error ? reject(error) : resolve()));
    await waitFor(async () => {
      const hosts = await viewer.webContents.executeJavaScript("fetch('/api/hosts').then(response => response.json())");
      return hosts.some(host => host.url === `http://${ip}:42425`);
    }, 'LAN discovery');
    announcement.close();
    console.log('PERSISTED_SETTINGS_AND_LAN_DISCOVERY_PASS');

    await request();
    const session = await approve();
    const senderState = () => session.peerConnectionHelperRenderer.webContents.executeJavaScript(`(() => {
      const track = window.__hostStream.getVideoTracks()[0];
      const sender = window.__hostPeer._pc.getSenders().find(sender => sender.track?.kind === 'video');
      return { capture: track.getSettings(), hint: track.contentHint, parameters: sender.getParameters() };
    })()`);
    await waitFor(async () => {
      const state = await senderState();
      return state.capture.frameRate === 30 && state.parameters.encodings[0].maxBitrate === 3000000 && state;
    }, 'saved defaults configure capture and encoder');
    assert.equal((await senderState()).parameters.encodings[0].maxFramerate, 30);

    const high = { frameRate: 60, resolutionScale: 1, bitrateMbps: 12, latency: 'smooth', contentHint: 'detail' };
    const applied = await host.webContents.executeJavaScript(`window.electron.ipcRenderer.invoke('set-stream-settings', ${JSON.stringify(high)})`);
    assert.equal(applied.updated, 1); assert.deepEqual(applied.warnings, []);
    const updated = await senderState();
    assert.equal(updated.capture.frameRate, 60);
    assert.equal(updated.parameters.encodings[0].maxBitrate, 12000000);
    assert.equal(updated.parameters.encodings[0].maxFramerate, 60);
    assert.equal(updated.parameters.degradationPreference, 'maintain-resolution');
    assert.equal(updated.hint, 'detail');
    const receiver = await waitFor(() => viewer.webContents.executeJavaScript("window.__receiverPC.getReceivers().find(receiver => receiver.track.kind === 'video')?.jitterBufferTarget"), 'receiver buffering preference');
    assert.equal(receiver, 150);
    assert.equal(global.connectedDevicesService.getDevices().length, 1);
    await waitFor(video, 'video remains playing after live settings update');
    let invalid = false;
    try { await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('set-stream-settings', { frameRate: 999 })"); } catch { invalid = true; }
    assert.ok(invalid);
    assert.deepEqual(await host.webContents.executeJavaScript("window.electron.ipcRenderer.invoke('get-stream-settings')"), high);
    console.log('LIVE_CAPTURE_ENCODER_AND_RECEIVER_SETTINGS_PASS');

    await host.webContents.executeJavaScript(`window.electron.ipcRenderer.invoke('disconnect-peer-and-destroy-sharing-session-by-session-id', ${JSON.stringify(session.id)})`);
    await waitFor(home, 'host disconnect returns home');
    await delay(1500);
    assert.equal(global.sharingSessionService.sharingSessions.size, 0, 'no automatic re-request');
    await request();
    await waitFor(() => global.connectedDevicesService.pendingConnectionDevice.id, 'new request after URL click');
    assert.notEqual(global.sharingSessionService.waitingForConnectionSharingSession.id, session.id);
    await clickHost('Deny');
    await waitFor(home, 'denial returns home');
    await delay(1500);
    assert.equal(global.sharingSessionService.sharingSessions.size, 0);
    await request();
    await approve();
    await viewer.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Disconnect').click()");
    await waitFor(home, 'viewer disconnect returns home');
    await waitFor(() => global.sharingSessionService.sharingSessions.size === 0, 'viewer teardown');
    console.log('HOME_MANUAL_RECONNECT_ALLOW_DENY_AND_VIEWER_DISCONNECT_PASS');
    if (process.argv.includes('--report')) fs.writeFileSync(path.join(__dirname, 'reconnect-settings-report.json'), JSON.stringify({ ok: true, discovery: true, persisted: true, captureAndEncoding: true, receiverBufferMs: receiver, manualReconnect: true, allowDeny: true, viewerDisconnect: true }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error('RECONNECT_SETTINGS_REGRESSION_FAIL:', error);
    const hostText = altronscreenApp.mainWindow && !altronscreenApp.mainWindow.isDestroyed() ? await altronscreenApp.mainWindow.webContents.executeJavaScript('document.body.innerText') : '';
    const viewerText = viewer && !viewer.isDestroyed() ? await viewer.webContents.executeJavaScript('document.body.innerText') : '';
    console.log('HOST:', hostText); console.log('VIEWER:', viewerText);
    if (process.argv.includes('--report')) fs.writeFileSync(path.join(__dirname, 'reconnect-settings-report.json'), JSON.stringify({ ok: false, error: String(error), hostText, viewerText }, null, 2));
    app.exit(1);
  }
});

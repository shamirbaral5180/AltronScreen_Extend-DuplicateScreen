const { app, BrowserWindow, desktopCapturer } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const results = [];
let elevated = '';

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
global.virtualDisplayService.destroyDisplaySilently = async () => {};

app.whenReady().then(async () => {
  let fixture;
  try {
    const flags = app.commandLine.getSwitchValue('disable-features').split(',');
    assert.ok(flags.includes('AllowWgcScreenCapturer'));
    assert.ok(flags.includes('AllowWgcWindowCapturer'));
    const admin = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],
      { encoding: 'utf8', windowsHide: true });
    elevated = admin.stdout.trim();
    console.log('ELEVATED:', elevated);
    console.log('CAPTURE_FLAGS:', flags.join(','));

    fixture = new BrowserWindow({ title: 'AltronScreen Capture Regression Target', width: 400, height: 300 });
    await fixture.loadURL('data:text/html,<title>AltronScreen Capture Regression Target</title><canvas id="c" width="320" height="240"></canvas><script>let n=0;setInterval(()=>{const x=c.getContext("2d");x.fillStyle=(++n%2)?"red":"blue";x.fillRect(0,0,320,240)},100)</script>');
    const helper = global.rendererWebrtcHelpersService.createPeerConnectionHelperRenderer();
    await new Promise((resolve) => helper.webContents.once('did-finish-load', resolve));
    helper.hide();
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
    const targets = sources.filter(source => source.id.startsWith('screen:') || source.name === 'AltronScreen Capture Regression Target');
    assert.ok(targets.some(source => source.id.startsWith('window:')));
    assert.ok(targets.some(source => source.id.startsWith('screen:')));
    for (const source of targets) {
      const result = await helper.webContents.executeJavaScript(`(async () => {
        let stream;
        const video = document.createElement('video');
        video.muted = true;
        document.body.appendChild(video);
        try {
          await window.electron.ipcRenderer.invoke('set-pending-display-source-id', ${JSON.stringify(source.id)});
          stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: 60, max: 60 } } });
          video.srcObject = stream;
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('No decoded capture frame; readyState=' + video.readyState + '; width=' + video.videoWidth)), 5000);
            video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
            video.play().catch(error => { clearTimeout(timer); reject(error); });
          });
          return { ok: true, width: video.videoWidth, height: video.videoHeight, settings: stream.getVideoTracks()[0].getSettings() };
        } catch (error) {
          return { ok: false, error: String(error) };
        } finally {
          stream?.getTracks().forEach(track => track.stop());
          video.remove();
        }
      })()`);
      results.push({ source: source.name, id: source.id, ...result });
      console.log('CAPTURE_RESULT:', JSON.stringify(results.at(-1)));
    }
    if (process.argv.includes('--report')) {
      fs.writeFileSync(path.join(__dirname, 'capture-admin-report.json'), JSON.stringify({ elevated, results }, null, 2));
    }
    assert.ok(results.every(result => result.ok && result.width > 0 && result.height > 0), 'all screens and the fixture window produce video frames');
    console.log('CAPTURE_BACKEND_REGRESSION_PASS');
    app.exit(0);
  } catch (error) {
    console.error('CAPTURE_BACKEND_REGRESSION_FAIL:', error);
    if (process.argv.includes('--report')) {
      fs.writeFileSync(path.join(__dirname, 'capture-admin-report.json'), JSON.stringify({ elevated, error: String(error), results }, null, 2));
    }
    app.exit(1);
  }
});

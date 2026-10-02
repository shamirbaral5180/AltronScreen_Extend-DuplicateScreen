const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const dataDir = path.join(__dirname, 'multi-display-quit-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const reportPath = path.join(__dirname, 'multi-display-quit-report.txt');
const log = (...parts) => {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`;
  process.stdout.write(`${line}\n`);
  fs.appendFileSync(reportPath, `${line}\n`);
};
const restarts = [];
const originalExecFile = childProcess.execFile;
childProcess.execFile = function (file, args, options, callback) {
  if (file === 'pnputil.exe') restarts.push(args.join(' '));
  return originalExecFile.call(this, file, args, options, callback);
};

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
const service = global.virtualDisplayService;
const helpers = global.rendererWebrtcHelpersService;
const captures = [];

app.whenReady().then(async () => {
  try {
    if (process.platform !== 'win32' || !service.isDriverInstalledSync()) {
      log('MULTI_DISPLAY_QUIT_SKIPPED: driver not installed');
      app.exit(0);
      return;
    }
    await service.setDisplayCount(0);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Add 3 virtual monitors, like clicking "+" three times.
    for (let count = 1; count <= 3; count++) {
      const ok = await service.setDisplayCount(count, { width: 1360, height: 768, refreshHz: 60 }, { restartDevice: count === 1 });
      assert.equal(ok, true, `add display ${count}`);
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
    const virtualDisplays = screen.getAllDisplays().filter(display => display.size.width === 1360 && display.size.height === 768);
    log('VIRTUAL_DISPLAYS_ACTIVE:', virtualDisplays.length);
    assert.ok(virtualDisplays.length >= 3, `expected at least 3 virtual displays, saw ${virtualDisplays.length}`);

    // Start 2 live captures of virtual displays (laptop + phone), like two viewers.
    await global.desktopCapturerSourcesService.refreshDesktopCapturerSources();
    const screenSources = global.desktopCapturerSourcesService.getScreenSources();
    const targets = screenSources.filter(source => virtualDisplays.some(display => `${display.id}` === global.desktopCapturerSourcesService.getSourceDisplayIDByDisplayCapturerSourceID(source.id)) || true).slice(0, 2);
    assert.ok(targets.length >= 2, 'need at least two capture sources');
    for (const source of targets) {
      const helper = helpers.createPeerConnectionHelperRenderer();
      await new Promise(resolve => helper.webContents.once('did-finish-load', resolve));
      helper.hide();
      const started = await helper.webContents.executeJavaScript(`(async () => {
        await window.electron.ipcRenderer.invoke('set-pending-display-source-id', ${JSON.stringify(source.id)});
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: 60, max: 60 } } });
        const video = document.createElement('video'); video.muted = true; video.srcObject = stream; document.body.appendChild(video);
        await video.play();
        return stream.getVideoTracks().length;
      })()`);
      assert.equal(started, 1, 'capture should start');
      captures.push(helper);
    }
    log('ACTIVE_CAPTURES:', captures.length);

    // Now quit while 3 displays and 2 captures are live, and measure it.
    const order = [];
    const originalCloseAll = helpers.closeAll.bind(helpers);
    helpers.closeAll = () => { order.push('closeCaptures'); originalCloseAll(); log('HELPER_WINDOWS_REMAINING:', helpers.helpers.size); };
    const originalDestroy = service.destroyDisplaySilently.bind(service);
    service.destroyDisplaySilently = async () => { order.push('removeDisplays'); await originalDestroy(); };
    const originalQuit = app.quit.bind(app);
    let resolvedQuit = false;
    app.quit = () => { resolvedQuit = true; log('QUIT_CALLED'); };

    const restartsBefore = restarts.length;
    const startedAt = Date.now();
    app.emit('before-quit', { preventDefault: () => {} });
    const deadline = Date.now() + 15000;
    while (!resolvedQuit && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const elapsed = Date.now() - startedAt;
    const newRestarts = restarts.slice(restartsBefore);

    helpers.closeAll = originalCloseAll;
    service.destroyDisplaySilently = originalDestroy;
    app.quit = originalQuit;

    assert.ok(resolvedQuit, 'quit must complete');
    assert.deepEqual(order, ['closeCaptures', 'removeDisplays'], `ordering wrong: ${JSON.stringify(order)}`);
    assert.equal(newRestarts.length, 0, `quit must not restart the display device: ${JSON.stringify(newRestarts)}`);
    assert.ok(elapsed < 10000, `quit took too long (${elapsed}ms), must stay responsive`);
    log('QUIT_ELAPSED_MS:', elapsed);
    log('MULTI_DISPLAY_QUIT_REGRESSION_PASS:', JSON.stringify({ virtualDisplays: virtualDisplays.length, captures: captures.length, order, newRestarts: newRestarts.length, elapsed }));

    await service.destroyDisplaySilently().catch(() => undefined);
    app.exit(0);
  } catch (error) {
    log('MULTI_DISPLAY_QUIT_REGRESSION_FAIL:', error);
    await service.destroyDisplaySilently().catch(() => undefined);
    app.exit(1);
  }
});

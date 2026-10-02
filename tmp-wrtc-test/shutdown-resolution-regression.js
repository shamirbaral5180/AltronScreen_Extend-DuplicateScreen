const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const dataDir = path.join(__dirname, 'shutdown-resolution-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const fixture = path.join(dataDir, 'vdd_settings.xml');
const restarts = [];
const originalExecFile = childProcess.execFile;
childProcess.execFile = function (file, args, options, callback) {
  if (file === 'pnputil.exe' || file === 'DisplaySwitch.exe') {
    restarts.push([file, args]);
    queueMicrotask(() => callback(null, '', ''));
    return {};
  }
  return originalExecFile.call(this, file, args, options, callback);
};

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
const service = global.virtualDisplayService;
service.resolveConfigPath = () => fixture;
let simulatedCount = 0;
service.getActiveDisplayCount = async () => simulatedCount;
service.sendCommand = async (command) => {
  simulatedCount = Number(command.split(' ')[1]);
  return '';
};

app.whenReady().then(async () => {
  try {
    fs.writeFileSync(fixture, '<vdd_settings><monitors><count>0</count></monitors></vdd_settings>');

    // 1. No virtual display active -> shutdown does no work at all.
    await service.destroyDisplaySilently();
    assert.equal(restarts.length, 0, 'inactive shutdown must not touch the device');

    // 2. Adding a display writes several resolutions and offers 1360x768 first.
    const added = await service.setDisplayCount(1, { width: 1360, height: 768, refreshHz: 60 });
    assert.equal(added, true);
    const xml = fs.readFileSync(fixture, 'utf8');
    const widths = [...xml.matchAll(/<width>(\d+)<\/width>/g)].map(match => Number(match[1]));
    assert.ok(widths.length >= 4, `expected several advertised resolutions, got ${widths.length}`);
    assert.equal(widths[0], 1360, '1360x768 must be first (default)');
    const heights = [...xml.matchAll(/<height>(\d+)<\/height>/g)].map(match => Number(match[1]));
    assert.equal(heights[0], 768);
    assert.ok(widths.includes(1920) && widths.includes(3840), 'standard sizes must be advertised');
    assert.equal(restarts.filter(([file]) => file === 'pnputil.exe').length, 0, 'adding a screen must never restart the display device');

    // 3. Shutdown removes the display WITHOUT restarting the device.
    const before = restarts.length;
    await service.destroyDisplaySilently();
    const afterRemoval = restarts.slice(before).filter(([file]) => file === 'pnputil.exe');
    assert.equal(afterRemoval.length, 0, 'shutdown must not run pnputil /restart-device');
    assert.equal(service.isActive(), false);

    // 4. Quit ordering: captures must stop BEFORE virtual displays are removed.
    const order = [];
    const originalCloseAll = global.rendererWebrtcHelpersService.closeAll.bind(global.rendererWebrtcHelpersService);
    global.rendererWebrtcHelpersService.closeAll = () => { order.push('closeCaptures'); };
    const originalDestroy = service.destroyDisplaySilently.bind(service);
    service.destroyDisplaySilently = async () => { order.push('removeDisplays'); };
    const originalQuit = app.quit.bind(app);
    let quitCalled = false;
    app.quit = () => { quitCalled = true; order.push('quit'); };

    // Ensure a display appears active so cleanup is exercised.
    await service.setDisplayCount(1, { width: 1360, height: 768, refreshHz: 60 }, {});
    let prevented = false;
    app.emit('before-quit', { preventDefault: () => { prevented = true; } });
    await new Promise(resolve => setTimeout(resolve, 1500));
    global.rendererWebrtcHelpersService.closeAll = originalCloseAll;
    service.destroyDisplaySilently = originalDestroy;
    app.quit = originalQuit;

    assert.ok(prevented, 'before-quit must defer the first quit to allow cleanup');
    assert.deepEqual(order, ['closeCaptures', 'removeDisplays', 'quit'], `captures must stop before displays are removed: ${JSON.stringify(order)}`);
    assert.ok(quitCalled, 'app must quit after cleanup');

    console.log('SHUTDOWN_ORDER_PASS:', JSON.stringify(order));
    console.log('SHUTDOWN_RESOLUTION_REGRESSION_PASS:', JSON.stringify({ advertised: widths, restarts: restarts.length, order }));
    app.exit(0);
  } catch (error) {
    console.error('SHUTDOWN_RESOLUTION_REGRESSION_FAIL:', error);
    console.log('RESTARTS:', JSON.stringify(restarts));
    app.exit(1);
  }
});

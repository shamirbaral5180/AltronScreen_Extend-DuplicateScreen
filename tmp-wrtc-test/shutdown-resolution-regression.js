const { app, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const dataDir = path.join(__dirname, 'shutdown-resolution-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const fixture = path.join(dataDir, 'vdd_settings.xml');
// Mock the device-level operations so this stays a fast unit test and never
// touches the real driver on the machine running it. The service's private
// helpers are replaced directly, which is robust regardless of how the bundle
// references child_process.
let devicePresent = false;
const deviceOps = [];
const originalExecFile = childProcess.execFile;
childProcess.execFile = function (file, args, options, callback) {
	if (file === 'pnputil.exe') {
		if (args.includes('/remove-device')) {
			deviceOps.push('remove');
			devicePresent = false;
		}
		queueMicrotask(() => callback(null, '', ''));
		return {};
	}
	if (file === 'DisplaySwitch.exe' || /devcon\.exe$/i.test(file)) {
		if (/devcon\.exe$/i.test(file)) devicePresent = true;
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
service.getActiveDisplayCount = async () => 0;
service.sendCommand = async () => '';
service.isDriverInstalled = async () => true;
service.isRootDevicePresent = async () => devicePresent;
// Record topology actions by wrapping the private helpers the service calls.
const origRecreate = service.recreateRootDevice.bind(service);
service.recreateRootDevice = async () => {
	deviceOps.push('create');
	devicePresent = true;
};
service.applyDisplayTopology = async (count) => {
	if (count <= 0) {
		if (devicePresent) {
			deviceOps.push('remove');
			devicePresent = false;
		}
	} else if (devicePresent) {
		deviceOps.push('restart');
	} else {
		deviceOps.push('create');
		devicePresent = true;
	}
};

app.whenReady().then(async () => {
	try {
		fs.writeFileSync(
			fixture,
			'<vdd_settings><monitors><count>0</count></monitors></vdd_settings>',
		);
		service.setPhysicalDisplayBaseline(screen.getAllDisplays().length);

		// 1. Adding a display writes several resolutions (1360x768 first) and
		//    recreates the device so the monitor actually appears.
		devicePresent = false;
		const added = await service.setDisplayCount(1, {
			width: 1360,
			height: 768,
			refreshHz: 60,
		});
		assert.equal(added, true);
		const xml = fs.readFileSync(fixture, 'utf8');
		const widths = [...xml.matchAll(/<width>(\d+)<\/width>/g)].map((m) =>
			Number(m[1]),
		);
		const heights = [...xml.matchAll(/<height>(\d+)<\/height>/g)].map((m) =>
			Number(m[1]),
		);
		assert.ok(widths.length >= 4, 'several resolutions must be advertised');
		assert.equal(widths[0], 1360, '1360x768 first');
		assert.equal(heights[0], 768);
		assert.ok(widths.includes(1920) && widths.includes(3840));
		assert.ok(
			deviceOps.includes('create'),
			'adding a display must recreate the device',
		);

		// 2. Removal removes the device, so the monitor is actually gone.
		devicePresent = true;
		const removed = await service.destroyDisplay();
		assert.equal(removed, true);
		assert.ok(deviceOps.includes('remove'), 'removal must remove the device');
		assert.equal(devicePresent, false, 'device must be absent after removal');
		assert.equal(service.isActive(), false);

		// 3. Quit ordering: captures must stop BEFORE displays are removed, and a
		//    virtual display must be detected from the display count even if the
		//    in-memory flag is clear.
		const order = [];
		const originalCloseAll = global.rendererWebrtcHelpersService.closeAll.bind(
			global.rendererWebrtcHelpersService,
		);
		global.rendererWebrtcHelpersService.closeAll = () => {
			order.push('closeCaptures');
		};
		const originalDestroy = service.destroyDisplaySilently.bind(service);
		service.destroyDisplaySilently = async () => {
			order.push('removeDisplays');
		};
		const originalQuit = app.quit.bind(app);
		let quitCalled = false;
		app.quit = () => {
			quitCalled = true;
			order.push('quit');
		};

		devicePresent = true;
		await service.setDisplayCount(1, {
			width: 1360,
			height: 768,
			refreshHz: 60,
		});
		// Simulate a lingering monitor: the device is present but the flag is clear.
		devicePresent = true;
		service.setPhysicalDisplayBaseline(0);
		service.virtualDisplayActive = false;
		let prevented = false;
		app.emit('before-quit', {
			preventDefault: () => {
				prevented = true;
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 2000));
		global.rendererWebrtcHelpersService.closeAll = originalCloseAll;
		service.destroyDisplaySilently = originalDestroy;
		app.quit = originalQuit;

		assert.ok(prevented, 'before-quit defers quit to allow cleanup');
		assert.deepEqual(
			order,
			['closeCaptures', 'removeDisplays', 'quit'],
			`ordering wrong: ${JSON.stringify(order)}`,
		);
		assert.ok(quitCalled, 'app quits after cleanup');

		console.log('SHUTDOWN_ORDER_PASS:', JSON.stringify(order));
		console.log(
			'SHUTDOWN_RESOLUTION_REGRESSION_PASS:',
			JSON.stringify({ advertised: widths, deviceOps, order }),
		);
		app.exit(0);
	} catch (error) {
		console.error('SHUTDOWN_RESOLUTION_REGRESSION_FAIL:', error);
		app.exit(1);
	}
});

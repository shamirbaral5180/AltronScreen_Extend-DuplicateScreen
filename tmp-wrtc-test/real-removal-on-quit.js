const { app, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'real-removal-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const reportPath = path.join(__dirname, 'real-removal-report.txt');
const log = (...parts) => {
	const line = `${new Date().toISOString()} ${parts.join(' ')}`;
	process.stdout.write(`${line}\n`);
	fs.appendFileSync(reportPath, `${line}\n`);
};
const labels = () =>
	screen
		.getAllDisplays()
		.map((d) => d.label || 'unknown')
		.join(', ');

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
const service = global.virtualDisplayService;
const helpers = global.rendererWebrtcHelpersService;

app.whenReady().then(async () => {
	try {
		if (process.platform !== 'win32' || !(await service.isDriverInstalled())) {
			log('REAL_REMOVAL_SKIPPED: driver package not installed');
			app.exit(0);
			return;
		}
		const baseline = screen.getAllDisplays().length;
		service.setPhysicalDisplayBaseline(baseline);
		log('BASELINE', baseline, labels());

		assert.equal(
			await service.setDisplayCount(1, {
				width: 1360,
				height: 768,
				refreshHz: 60,
			}),
			true,
		);
		for (let i = 0; i < 40 && screen.getAllDisplays().length <= baseline; i++)
			await new Promise((r) => setTimeout(r, 300));
		const afterCreate = screen.getAllDisplays().length;
		log('AFTER_CREATE', afterCreate, labels());
		assert.ok(afterCreate > baseline, 'virtual monitor must appear');

		// Start a live capture, then run the real quit path.
		await global.desktopCapturerSourcesService.refreshDesktopCapturerSources();
		const source = global.desktopCapturerSourcesService.getScreenSources()[0];
		const helper = helpers.createPeerConnectionHelperRenderer();
		await new Promise((r) => helper.webContents.once('did-finish-load', r));
		helper.hide();
		await helper.webContents.executeJavaScript(`(async () => {
      await window.electron.ipcRenderer.invoke('set-pending-display-source-id', ${JSON.stringify(source.id)});
      const s = await navigator.mediaDevices.getDisplayMedia({ audio:false, video:{ frameRate:{ ideal:60, max:60 } } });
      const v = document.createElement('video'); v.muted = true; v.srcObject = s; document.body.appendChild(v); await v.play();
      return true;
    })()`);
		log('CAPTURE_STARTED');

		const order = [];
		const origClose = helpers.closeAll.bind(helpers);
		helpers.closeAll = () => {
			order.push('stopCaptures');
			origClose();
		};
		const origDestroy = service.destroyDisplaySilently.bind(service);
		service.destroyDisplaySilently = async () => {
			order.push('removeDisplays');
			await origDestroy();
		};
		let quitDone = false;
		const origQuit = app.quit.bind(app);
		app.quit = () => {
			quitDone = true;
			order.push('quit');
		};

		const started = Date.now();
		app.emit('before-quit', { preventDefault: () => {} });
		const deadline = Date.now() + 30000;
		while (!quitDone && Date.now() < deadline)
			await new Promise((r) => setTimeout(r, 100));
		const elapsed = Date.now() - started;
		helpers.closeAll = origClose;
		service.destroyDisplaySilently = origDestroy;
		app.quit = origQuit;

		await new Promise((r) => setTimeout(r, 3000));
		const afterQuit = screen.getAllDisplays().length;
		log(
			'QUIT_ELAPSED_MS',
			elapsed,
			'ORDER',
			JSON.stringify(order),
			'AFTER_QUIT',
			afterQuit,
			labels(),
		);
		assert.ok(quitDone, 'quit must complete');
		assert.deepEqual(order, ['stopCaptures', 'removeDisplays', 'quit']);
		assert.equal(
			afterQuit,
			baseline,
			`virtual monitor must be removed (after ${afterQuit}, baseline ${baseline})`,
		);

		// Now verify it can be recreated (the "add screen" path).
		assert.equal(
			await service.setDisplayCount(1, {
				width: 1360,
				height: 768,
				refreshHz: 60,
			}),
			true,
		);
		for (let i = 0; i < 40 && screen.getAllDisplays().length <= baseline; i++)
			await new Promise((r) => setTimeout(r, 300));
		const afterRecreate = screen.getAllDisplays().length;
		log('AFTER_RECREATE', afterRecreate, labels());
		assert.ok(
			afterRecreate > baseline,
			'virtual monitor must be creatable again',
		);

		// Clean up: remove again.
		await service.destroyDisplay();
		await new Promise((r) => setTimeout(r, 2500));
		log('FINAL', screen.getAllDisplays().length, labels());
		log(
			'REAL_REMOVAL_ON_QUIT_PASS',
			JSON.stringify({
				baseline,
				afterCreate,
				afterQuit,
				afterRecreate,
				elapsed,
				order,
			}),
		);
		app.exit(0);
	} catch (error) {
		log('REAL_REMOVAL_ON_QUIT_FAIL', String(error));
		await service.destroyDisplay().catch(() => undefined);
		app.exit(1);
	}
});

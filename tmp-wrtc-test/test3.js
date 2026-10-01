const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('path');
const { existsSync } = require('fs');

app.whenReady().then(async () => {
	const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
	const target = sources.find((s) => s.id.startsWith('screen')) || sources[0];
	console.log('TARGET:', target.id);

	let handlerCount = 0;
	session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
		handlerCount++;
		callback({ video: target });
	});

	const win = new BrowserWindow({
		show: false,
		webPreferences: { nodeIntegration: true, sandbox: false },
	});
	win.webContents.on('console-message', (_e, _lvl, msg) => console.log('RENDERER:', msg));

	const helperHtml = path.join(__dirname, '..', 'out', 'renderer', 'peerConnectionHelperRendererWindowIndex.html');
	await win.loadURL(`file://${helperHtml}`);

	const makeTest = (label, constraints) => `
		(async () => {
			try {
				const stream = await navigator.mediaDevices.getDisplayMedia(${JSON.stringify(constraints)});
				const track = stream.getVideoTracks()[0];
				stream.getTracks().forEach(t => t.stop());
				return JSON.stringify({ ok:true, label: ${JSON.stringify(label)}, name: track && track.label });
			} catch (e) {
				return JSON.stringify({ ok:false, label: ${JSON.stringify(label)}, error: String(e) });
			}
		})()
	`;

	const tests = [
		['video:true', { video: true, audio: false }],
		['frameRate ideal+max', { audio: false, video: { frameRate: { ideal: 60, max: 60 } } }],
		['width/height ideal+max', { audio: false, video: { frameRate: { ideal: 60, max: 60 }, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } } }],
	];

	for (const [label, c] of tests) {
		const r = await win.webContents.executeJavaScript(makeTest(label, c));
		console.log('RESULT:', r);
	}
	console.log('HANDLER_CALL_COUNT:', handlerCount);
	app.quit();
});

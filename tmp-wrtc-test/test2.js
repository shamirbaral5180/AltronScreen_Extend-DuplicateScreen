const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('path');
const { existsSync } = require('fs');

app.whenReady().then(async () => {
	const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
	console.log('SOURCES_COUNT:', sources.length);
	const target = sources.find((s) => s.id.startsWith('screen')) || sources[0];
	console.log('TARGET:', target.id);

	session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
		console.log('HANDLER_CALLED');
		callback({ video: target });
	});

	// Match the real helper renderer preferences as closely as possible.
	const win = new BrowserWindow({
		show: false,
		webPreferences: {
			nodeIntegration: true,
			nodeIntegrationInSubFrames: true,
			nodeIntegrationInWorker: true,
			sandbox: false,
		},
	});

	win.webContents.on('console-message', (_e, _lvl, msg) => {
		console.log('RENDERER:', msg);
	});

	const helperHtml = path.join(__dirname, '..', 'out', 'renderer', 'peerConnectionHelperRendererWindowIndex.html');
	const url = existsSync(helperHtml)
		? `file://${helperHtml}`
		: 'file://' + path.join(__dirname, '..', 'src', 'renderer', 'peerConnectionHelperRendererWindowIndex.html');
	console.log('LOADING:', url);
	await win.loadURL(url).catch((e) => console.log('LOAD_ERR:', String(e)));

	const result = await win.webContents.executeJavaScript(`
		(async () => {
			try {
				if (!navigator.mediaDevices) return JSON.stringify({ ok:false, error:'navigator.mediaDevices undefined', secure: window.isSecureContext });
				const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
				const track = stream.getVideoTracks()[0];
				return JSON.stringify({ ok:true, name: track && track.label, secure: window.isSecureContext });
			} catch (e) {
				return JSON.stringify({ ok:false, error:String(e) });
			}
		})()
	`);
	console.log('DISPLAY_MEDIA_RESULT:', result);
	app.quit();
});

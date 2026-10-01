const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

app.whenReady().then(async () => {
	const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
	console.log('SOURCES_COUNT:', sources.length);
	sources.slice(0, 5).forEach((s) => console.log('SOURCE:', s.id, s.name));

	const target = sources.find((s) => s.id.startsWith('screen')) || sources[0];
	if (!target) {
		console.log('NO_SOURCE');
		app.quit();
		return;
	}

	session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
		console.log('HANDLER_CALLED, granting:', target.id);
		callback({ video: target });
	});

	const win = new BrowserWindow({
		show: false,
		webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false },
	});

	win.webContents.on('console-message', (_e, _lvl, msg) => {
		console.log('RENDERER:', msg);
	});

	await win.loadURL('data:text/html,<html><body>test</body></html>');

	const result = await win.webContents.executeJavaScript(`
		(async () => {
			try {
				const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
				const track = stream.getVideoTracks()[0];
				const settings = track ? track.getSettings() : null;
				return JSON.stringify({ ok: true, name: track && track.label, settings });
			} catch (e) {
				return JSON.stringify({ ok: false, error: String(e) });
			}
		})()
	`);
	console.log('DISPLAY_MEDIA_RESULT:', result);
	app.quit();
});

app.on('window-all-closed', () => {});

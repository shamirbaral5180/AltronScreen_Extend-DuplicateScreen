const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');

let pending = '';

ipcMain.handle('set-pending', (_, id) => {
	pending = id;
});

app.whenReady().then(async () => {
	session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
		console.log('HANDLER_INVOKED videoReq=' + req.videoRequested + ' pending=' + pending);
		try {
			const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
			const src = pending
				? sources.find((s) => s.id === pending)
				: sources[0];
			if (src) {
				console.log('GRANTING ' + src.id);
				cb({ video: src });
				return;
			}
		} catch (e) {
			console.log('HANDLER_ERROR ' + e.message);
		}
		cb({});
	});

	const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
	await win.loadURL('data:text/html,<html><body>test</body></html>');

	const res = await win.webContents.executeJavaScript(`
		(async () => {
			try {
				const sources = await window.require('electron').ipcRenderer ? null : null;
				return 'no-ipc';
			} catch (e) { return 'err ' + e.message; }
		})()
	`);
	console.log('IPC_CHECK ' + res);

	// Directly test getDisplayMedia in this window's context.
	const gdm = await win.webContents.executeJavaScript(`
		(async () => {
			try {
				const s = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
				const t = s.getVideoTracks()[0];
				const st = t.getSettings();
				return 'OK tracks=' + s.getVideoTracks().length + ' ' + st.width + 'x' + st.height + ' label=' + t.label;
			} catch (e) {
				return 'FAIL ' + (e && e.name) + ': ' + (e && e.message);
			}
		})()
	`);
	console.log('GETDISPLAYMEDIA ' + gdm);

	app.quit();
});

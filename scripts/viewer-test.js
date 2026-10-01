// End-to-end: start the real app (host) is external; here we just load the
// real client-viewer in an Electron window and report what it sees.
const { app, BrowserWindow } = require('electron');

const TARGET = process.argv[2] || 'http://127.0.0.1:3131/share';

app.whenReady().then(async () => {
	const win = new BrowserWindow({
		show: false,
		webPreferences: { contextIsolation: true, sandbox: false },
	});

	win.webContents.on('console-message', (_e, level, message) => {
		console.log('VIEWER_CONSOLE[' + level + ']=' + message);
	});

	await win.loadURL(TARGET);

	await new Promise((r) => setTimeout(r, 8000));

	const info = await win.webContents.executeJavaScript(`
		JSON.stringify({
			url: location.href,
			title: document.title,
			bodyText: document.body ? document.body.innerText.slice(0, 300) : '',
			videoCount: document.querySelectorAll('video').length,
			hasVideoWithSrc: Array.from(document.querySelectorAll('video')).some(v => v.srcObject || v.currentSrc),
		})
	`);
	console.log('VIEWER_INFO=' + info);
	app.exit(0);
});

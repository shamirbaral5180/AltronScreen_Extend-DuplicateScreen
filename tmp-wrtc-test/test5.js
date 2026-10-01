const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('path');

const helperHtml = path.join(__dirname, '..', 'out', 'renderer', 'peerConnectionHelperRendererWindowIndex.html');

app.whenReady().then(async () => {
	const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
	const target = sources.find((s) => s.id.startsWith('screen')) || sources[0];
	console.log('TARGET_SOURCE:', target.id);

	session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
		callback({ video: target });
	});

	const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, sandbox: false } });
	win.webContents.on('console-message', (_e, _l, m) => console.log('LOG:', m));
	await win.loadURL(`file://${helperHtml}`);

	// Loopback: initiator (with a canvas "screen") <-> responder in the same page.
	const result = await win.webContents.executeJavaScript(`
		(async () => {
			try {
				if (typeof SimplePeer === 'undefined') return JSON.stringify({ ok:false, err:'SimplePeer undefined' });
				const init = new SimplePeer({ initiator: true, config: { iceServers: [] }, trickle: true });
				const resp = new SimplePeer({ initiator: false, config: { iceServers: [] }, trickle: true });
				const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
				const ctx = canvas.getContext('2d');
				let i = 0;
				const timer = setInterval(() => { i++; ctx.fillStyle = i%2?'red':'blue'; ctx.fillRect(0,0,640,480); }, 100);
				const fake = canvas.captureStream(15);
				init.addStream(fake);
				init.on('signal', (d) => resp.signal(d));
				resp.on('signal', (d) => init.signal(d));
				return await new Promise((resolve) => {
					const done = (obj) => { clearTimeout(t); clearInterval(timer); resolve(JSON.stringify(obj)); };
					const t = setTimeout(() => done({ ok:false, err:'timeout: no stream/connect' }), 15000);
					resp.on('stream', (s) => done({ ok:true, note:'responder got stream', tracks: s.getVideoTracks().length }));
					resp.on('connect', () => console.log('RESP_CONNECT'));
					init.on('error', (e) => done({ ok:false, err:'init:'+String(e) }));
					resp.on('error', (e) => done({ ok:false, err:'resp:'+String(e) }));
				});
			} catch (e) { return JSON.stringify({ ok:false, err:String(e) }); }
		})()
	`);
	console.log('LOOPBACK_RESULT:', result);

	// Also test initiator with a REAL screen capture stream.
	const realResult = await win.webContents.executeJavaScript(`
		(async () => {
			try {
				const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 } }, audio: false });
				const init = new SimplePeer({ initiator: true, config: { iceServers: [] }, trickle: true });
				const resp = new SimplePeer({ initiator: false, config: { iceServers: [] }, trickle: true });
				init.addStream(stream);
				init.on('signal', (d) => resp.signal(d));
				resp.on('signal', (d) => init.signal(d));
				return await new Promise((resolve) => {
					const done = (obj) => { clearTimeout(t); resolve(JSON.stringify(obj)); };
					const t = setTimeout(() => done({ ok:false, err:'timeout: no stream' }), 15000);
					resp.on('stream', (s) => done({ ok:true, note:'responder got REAL stream', tracks: s.getVideoTracks().length }));
					init.on('error', (e) => done({ ok:false, err:'init:'+String(e) }));
					resp.on('error', (e) => done({ ok:false, err:'resp:'+String(e) }));
				});
			} catch (e) { return JSON.stringify({ ok:false, err:String(e) }); }
		})()
	`);
	console.log('REAL_STREAM_RESULT:', realResult);

	app.quit();
});

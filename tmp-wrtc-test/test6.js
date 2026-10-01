const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('path');

const helperHtml = path.join(__dirname, '..', 'out', 'renderer', 'peerConnectionHelperRendererWindowIndex.html');

app.whenReady().then(async () => {
	const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
	const target = sources.find((s) => s.id.startsWith('screen')) || sources[0];

	session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
		callback({ video: target });
	});

	const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, sandbox: false } });
	win.webContents.on('console-message', (_e, _l, m) => console.log('LOG:', m));
	await win.loadURL(`file://${helperHtml}`);

	// Reproduce host's sdpTransform (set b=AS on video m-line) and test connect.
	const result = await win.webContents.executeJavaScript(`
		(async () => {
			try {
				const setBitrate = (sdp, mediaType, bitrate) => {
					if (typeof sdp !== 'string' || sdp.length === 0) return sdp;
					const lines = sdp.split('\\n');
					const mediaLine = 'm=' + mediaType;
					const idx = lines.findIndex((l) => l.startsWith(mediaLine));
					if (idx !== -1 && idx < lines.length) {
						let bi = idx + 1;
						while (bi < lines.length && (lines[bi].startsWith('i=') || lines[bi].startsWith('c='))) bi++;
						if (bi >= lines.length) return lines.join('\\n');
						if (lines[bi].startsWith('b=')) lines[bi] = 'b=AS:' + bitrate;
						else lines.splice(bi, 0, 'b=AS:' + bitrate);
					}
					return lines.join('\\n');
				};
				const sdpTransform = (sdp) => setBitrate(sdp, 'video', 5000000);

				const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 } }, audio: false });
				const init = new SimplePeer({ initiator: true, config: { iceServers: [] }, trickle: true, sdpTransform });
				const resp = new SimplePeer({ initiator: false, config: { iceServers: [] }, trickle: true, sdpTransform });
				init.addStream(stream);
				init.on('signal', (d) => resp.signal(d));
				resp.on('signal', (d) => init.signal(d));
				return await new Promise((resolve) => {
					const done = (o) => { clearTimeout(t); resolve(JSON.stringify(o)); };
					const t = setTimeout(() => done({ ok:false, err:'timeout with sdpTransform' }), 15000);
					resp.on('stream', (s) => done({ ok:true, note:'connected WITH sdpTransform', tracks: s.getVideoTracks().length }));
					init.on('error', (e) => done({ ok:false, err:'init:'+String(e) }));
					resp.on('error', (e) => done({ ok:false, err:'resp:'+String(e) }));
				});
			} catch (e) { return JSON.stringify({ ok:false, err:String(e) }); }
		})()
	`);
	console.log('SDPTRANSFORM_RESULT:', result);

	app.quit();
});

const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('path');
const { existsSync } = require('fs');

const helperHtml = path.join(__dirname, '..', 'out', 'renderer', 'peerConnectionHelperRendererWindowIndex.html');

app.whenReady().then(async () => {
	const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
	const target = sources.find((s) => s.id.startsWith('screen')) || sources[0];

	// Two separate sessions so getDisplayMedia (host) and plain (viewer) don't clash.
	session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
		callback({ video: target });
	});

	const makeWin = () =>
		new BrowserWindow({
			show: false,
			webPreferences: { nodeIntegration: true, sandbox: false },
		});

	const host = makeWin();
	const viewer = makeWin();
	host.webContents.on('console-message', (_e, _l, m) => console.log('HOST:', m));
	viewer.webContents.on('console-message', (_e, _l, m) => console.log('VIEWER:', m));

	// Minimal page that loads the global SimplePeer from the bundled min.js.
	const html = `<!doctype html><html><head><script src="./assets/simplepeer.min.js"></script></head><body>ok</body></html>`;
	await host.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html.replace('./assets/simplepeer.min.js', 'file:///' + path.join(__dirname, '..', 'out', 'renderer', 'assets', 'simplepeer.min.js').replace(/\\/g, '/'))));

	// Inject a direct peer-to-peer test in the host page: create initiator, capture, offer.
	const hostResult = await host.webContents.executeJavaScript(`
		(async () => {
			try {
				if (typeof SimplePeer === 'undefined') return JSON.stringify({ ok:false, err:'SimplePeer undefined' });
				const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 } }, audio: false });
				window.__stream = stream;
				const peer = new SimplePeer({ initiator: true, config: { iceServers: [] }, trickle: false });
				window.__peer = peer;
				peer.addStream(stream);
				return await new Promise((resolve) => {
					const t = setTimeout(() => resolve(JSON.stringify({ ok:false, err:'no offer within 8s' })), 8000);
					peer.on('signal', (d) => { clearTimeout(t); window.__offer = d; resolve(JSON.stringify({ ok:true, offer: JSON.stringify(d).slice(0,80) })); });
					peer.on('error', (e) => { clearTimeout(t); resolve(JSON.stringify({ ok:false, err:String(e) })); });
				});
			} catch (e) { return JSON.stringify({ ok:false, err:String(e) }); }
		})()
	`);
	console.log('HOST_OFFER_RESULT:', hostResult);

	// Now create a viewer that answers the offer, still within one page using two peers.
	const bothResult = await viewer.webContents.executeJavaScript(`
		(async () => {
			try {
				if (typeof SimplePeer === 'undefined') return JSON.stringify({ ok:false, err:'SimplePeer undefined' });
				// We test loopback: initiator + responder in the same page.
				const init = new SimplePeer({ initiator: true, config: { iceServers: [] }, trickle: false });
				const resp = new SimplePeer({ initiator: false, config: { iceServers: [] }, trickle: false });
				const pc = new RTCPeerConnection();
				const stream = await pc.createOffer().then(()=>{}).catch(()=>{}); // noop
				// Use a canvas stream as fake media
				const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=240;
				const ctx = canvas.getContext('2d');
				setInterval(()=>{ ctx.fillStyle='red'; ctx.fillRect(0,0,320,240); }, 100);
				const fake = canvas.captureStream(10);
				init.addStream(fake);
				let connected = false;
				init.on('signal', (d) => resp.signal(d));
				resp.on('signal', (d) => init.signal(d));
				resp.on('stream', () => { connected = true; });
				return await new Promise((resolve) => {
					const t = setTimeout(() => resolve(JSON.stringify({ ok: connected, note: connected?'viewer received stream':'no stream within 10s' })), 10000);
					resp.on('stream', () => { clearTimeout(t); resolve(JSON.stringify({ ok:true, note:'viewer received stream' })); });
					resp.on('error', (e)=>{ clearTimeout(t); resolve(JSON.stringify({ ok:false, err:String(e) })); });
					init.on('error', (e)=>{ clearTimeout(t); resolve(JSON.stringify({ ok:false, err:String(e) })); });
				});
			} catch (e) { return JSON.stringify({ ok:false, err:String(e) }); }
		})()
	`);
	console.log('LOOPBACK_RESULT:', bothResult);

	app.quit();
});

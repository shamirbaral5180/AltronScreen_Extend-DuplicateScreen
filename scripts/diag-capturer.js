const { app, desktopCapturer } = require('electron');

app.whenReady().then(async () => {
	try {
		const sources = await desktopCapturer.getSources({
			types: ['screen', 'window'],
			thumbnailSize: { width: 500, height: 500 },
			fetchWindowIcons: true,
		});
		console.log('SOURCE_COUNT=' + sources.length);
		sources.slice(0, 6).forEach((s) => {
			const thumb = s.thumbnail;
			console.log(
				`id=${s.id} name=${JSON.stringify(s.name)} thumbEmpty=${thumb.isEmpty()} thumbSize=${thumb.getSize().width}x${thumb.getSize().height} dataUrlLen=${thumb.toDataURL().length}`,
			);
		});
	} catch (e) {
		console.log('ERROR ' + e.message);
	}
	app.quit();
});

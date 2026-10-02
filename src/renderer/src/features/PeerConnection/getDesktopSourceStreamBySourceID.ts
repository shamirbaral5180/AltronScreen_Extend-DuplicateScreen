import { IpcEvents } from '../../../../common/IpcEvents.enum';
import type { StreamSettings } from '../../../../common/StreamSettings';

async function getStreamWithSource(
	sourceID: string,
	width: number | null | undefined,
	height: number | null | undefined,
	maxSizeMultiplier: number,
	maxFrameRate: number,
): Promise<MediaStream> {
	const settings: StreamSettings = await window.electron.ipcRenderer.invoke(
		IpcEvents.GetStreamSettings,
	);
	// Tell the main process which source to grant for the upcoming
	// getDisplayMedia() request. This replaces the legacy (removed in modern
	// Electron) getUserMedia + chromeMediaSource constraints.
	await window.electron.ipcRenderer.invoke(
		IpcEvents.SetPendingDisplaySourceId,
		sourceID,
	);

	const videoConstraints: MediaTrackConstraints = {
		frameRate: {
			ideal: Math.min(maxFrameRate, settings.frameRate),
			max: Math.min(maxFrameRate, settings.frameRate),
		},
	};

	if (width && height) {
		const targetWidth = Math.max(
			2,
			Math.round(width * maxSizeMultiplier * settings.resolutionScale),
		);
		const targetHeight = Math.max(
			2,
			Math.round(height * maxSizeMultiplier * settings.resolutionScale),
		);
		videoConstraints.width = { ideal: targetWidth, max: targetWidth };
		videoConstraints.height = { ideal: targetHeight, max: targetHeight };
	}

	const stream = await navigator.mediaDevices.getDisplayMedia({
		audio: false,
		video: videoConstraints,
	});
	const track = stream.getVideoTracks()[0];
	try {
		if (
			(!width || !height) &&
			settings.resolutionScale * maxSizeMultiplier < 1
		) {
			const native = track.getSettings();
			if (native.width && native.height)
				await track.applyConstraints({
					width: {
						ideal: Math.round(
							native.width * settings.resolutionScale * maxSizeMultiplier,
						),
						max: Math.round(
							native.width * settings.resolutionScale * maxSizeMultiplier,
						),
					},
					height: {
						ideal: Math.round(
							native.height * settings.resolutionScale * maxSizeMultiplier,
						),
						max: Math.round(
							native.height * settings.resolutionScale * maxSizeMultiplier,
						),
					},
				});
		}
		track.contentHint = settings.contentHint;
		return stream;
	} catch (error) {
		stream.getTracks().forEach((item) => item.stop());
		throw error;
	}
}

export default async (
	sourceID: string,
	width: number | null | undefined = undefined,
	height: number | null | undefined = undefined,
	_minSizeMultiplier = 1,
	maxSizeMultiplier = 1,
	_minFrameRate = 15,
	maxFrameRate = 60,
): Promise<MediaStream> => {
	return getStreamWithSource(
		sourceID,
		width,
		height,
		maxSizeMultiplier,
		maxFrameRate,
	);
};

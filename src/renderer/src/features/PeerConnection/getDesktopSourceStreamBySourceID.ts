import { IpcEvents } from '../../../../common/IpcEvents.enum';

async function getStreamWithSource(
	sourceID: string,
	width: number | null | undefined,
	height: number | null | undefined,
	maxSizeMultiplier: number,
	maxFrameRate: number,
): Promise<MediaStream> {
	// Tell the main process which source to grant for the upcoming
	// getDisplayMedia() request. This replaces the legacy (removed in modern
	// Electron) getUserMedia + chromeMediaSource constraints.
	await window.electron.ipcRenderer.invoke(
		IpcEvents.SetPendingDisplaySourceId,
		sourceID,
	);

	const videoConstraints: MediaTrackConstraints = {
		frameRate: { ideal: maxFrameRate, max: maxFrameRate },
	};

	if (width && height) {
		const targetWidth = Math.round(width * maxSizeMultiplier);
		const targetHeight = Math.round(height * maxSizeMultiplier);
		videoConstraints.width = { ideal: targetWidth, max: targetWidth };
		videoConstraints.height = { ideal: targetHeight, max: targetHeight };
	}

	return navigator.mediaDevices.getDisplayMedia({
		audio: false,
		video: videoConstraints,
	});
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

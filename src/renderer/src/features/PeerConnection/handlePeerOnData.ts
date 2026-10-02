import DesktopCapturerSourceType from '../../../../common/DesktopCapturerSourceType';
import prepareDataMessageToSendScreenSourceType from './prepareDataMessageToSendScreenSourceType';
import { IpcEvents } from '../../../../common/IpcEvents.enum';

export default async function handlePeerOnData(
	peerConnection: PeerConnection,
	data: string,
): Promise<void> {
	const dataJSON = JSON.parse(data);

	if (dataJSON.type === 'set_video_quality') {
		const multiplier = dataJSON.payload.value;
		if (
			typeof multiplier !== 'number' ||
			!Number.isFinite(multiplier) ||
			multiplier < 0.25 ||
			multiplier > 1
		)
			return;
		const settings = await window.electron.ipcRenderer.invoke(
			IpcEvents.GetStreamSettings,
		);
		await peerConnection.applyStreamSettings(settings, multiplier);
	}

	if (dataJSON.type === 'get_sharing_source_type') {
		const sourceType = peerConnection.desktopCapturerSourceID.includes(
			DesktopCapturerSourceType.SCREEN,
		)
			? DesktopCapturerSourceType.SCREEN
			: DesktopCapturerSourceType.WINDOW;

		peerConnection.peer.send(
			prepareDataMessageToSendScreenSourceType(sourceType),
		);
	}
}

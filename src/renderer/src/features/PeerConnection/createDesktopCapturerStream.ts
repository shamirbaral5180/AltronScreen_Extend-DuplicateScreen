import getDesktopSourceStreamBySourceID from './getDesktopSourceStreamBySourceID';
import DesktopCapturerSourceType from '../../../../common/DesktopCapturerSourceType';
import { IpcEvents } from '../../../../common/IpcEvents.enum';

export default async function createDesktopCapturerStream(
	peerConnection: PeerConnection,
	sourceID: string,
): Promise<void> {
	try {
		if (process.env.RUN_MODE === 'test') return;
		peerConnection.streamSettings = await window.electron.ipcRenderer.invoke(
			IpcEvents.GetStreamSettings,
		);

		if (sourceID.includes(DesktopCapturerSourceType.SCREEN)) {
			const stream = await getDesktopSourceStreamBySourceID(
				sourceID,
				peerConnection.sourceDisplaySize?.width,
				peerConnection.sourceDisplaySize?.height,
				0.5,
				1,
			);
			peerConnection.localStream = stream;
		} else {
			// when source is app window
			const stream = await getDesktopSourceStreamBySourceID(sourceID);
			peerConnection.localStream = stream;
		}
	} catch (e) {
		console.error(e);
		throw e;
	}
}

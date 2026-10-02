import {
	prepareDataMessageToChangeQuality,
	prepareDataMessageToGetSharingSourceType,
} from './simplePeerDataMessages';
import { VideoQuality } from '../VideoAutoQualityOptimizer/VideoQualityEnum';
import { ErrorMessage } from '../../components/ErrorDialog/ErrorMessageEnum';
import PeerConnectionPeerIsNullError from './errors/PeerConnectionPeerIsNullError';
import { ScreenSharingSource } from './ScreenSharingSourceEnum';
import applyReceiverSettings from './applyReceiverSettings';

export function getSharingShourceType(peerConnection: PeerConnection) {
	try {
		peerConnection.peer?.send(prepareDataMessageToGetSharingSourceType());
	} catch (e) {
		console.log(e);
	}
}

export default (peerConnection: PeerConnection) => {
	if (peerConnection.peer === null) {
		throw new PeerConnectionPeerIsNullError();
	}
	peerConnection.peer.on('stream', (stream) => {
		if (peerConnection.destroyed) return;
		peerConnection.remoteStream = stream;
		peerConnection.setUrlCallback(stream);

		for (const track of stream.getVideoTracks()) {
			try {
				track.contentHint = 'motion';
			} catch {
				// contentHint is best-effort
			}
		}

		setTimeout(() => {
			if (peerConnection.destroyed) return;
			peerConnection.videoAutoQualityOptimizer.setGoodQualityCallback(() => {
				if (peerConnection.videoQuality === VideoQuality.Q_AUTO) {
					try {
						peerConnection.peer?.send(prepareDataMessageToChangeQuality(1));
					} catch (e) {
						console.log(e);
					}
				}
			});

			peerConnection.videoAutoQualityOptimizer.setHalfQualityCallbak(() => {
				if (peerConnection.videoQuality === VideoQuality.Q_AUTO) {
					try {
						peerConnection.peer?.send(prepareDataMessageToChangeQuality(0.5));
					} catch (e) {
						console.log(e);
					}
				}
			});
		}, 1000);

		peerConnection.videoAutoQualityOptimizer.startOptimizationLoop();

		peerConnection.isStreamStarted = true;

		// if any transient error dialog was shown earlier, close it now
		try {
			peerConnection.UIHandler.setIsErrorDialogOpen(false);
			peerConnection.UIHandler.errorDialogMessage = ErrorMessage.UNKNOWN_ERROR;
		} catch (_) {
			// ignore
		}
	});
	peerConnection.peer.on('connect', () => {
		getSharingShourceType(peerConnection);
		peerConnection.videoQualityChangedCallback();
	});
	peerConnection.peer.on('close', () => {
		if (!peerConnection.destroyed) {
			peerConnection.destroy();
			peerConnection.UIHandler.setDialogErrorMessageCallback(
				ErrorMessage.DISCONNECTED,
			);
		}
	});

	peerConnection.peer.on('signal', (data) => {
		// fired when webrtc done preparation to start call on peerConnection machine
		peerConnection.sendEncryptedMessage({
			type: 'CALL_ACCEPTED',
			payload: {
				signalData: data,
			},
		});
	});

	peerConnection.peer.on('data', (data) => {
		const dataJSON = JSON.parse(data);
		if (dataJSON.type === 'stream_settings')
			applyReceiverSettings(peerConnection, dataJSON.payload);

		if (dataJSON.type === 'screen_sharing_source_type') {
			peerConnection.screenSharingSourceType = dataJSON.payload.value;
			if (
				peerConnection.screenSharingSourceType === ScreenSharingSource.SCREEN ||
				peerConnection.screenSharingSourceType === ScreenSharingSource.WINDOW
			) {
				peerConnection.UIHandler.setScreenSharingSourceTypeCallback(
					peerConnection.screenSharingSourceType,
				);
			}
		}
	});
};

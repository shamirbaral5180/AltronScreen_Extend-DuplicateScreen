// import SimplePeer from 'simple-peer';
import createDesktopCapturerStream from './createDesktopCapturerStream';
import handlePeerOnData from './handlePeerOnData';
import NullSimplePeer from './NullSimplePeer';
import {
	STUN_ICE_SERVERS,
	applyLowLatencySenderParameters,
} from './webRtcPeerOptions';

export default function handleCreatePeer(
	peerConnection: PeerConnection,
): Promise<void> {
	return new Promise((resolve, reject) => {
		// cleanup existing peer before creating new one
		if (peerConnection.peer !== NullSimplePeer) {
			try {
				peerConnection.peer.removeAllListeners();
				peerConnection.peer.destroy();
			} catch (error) {
				console.error('Error cleaning up existing peer:', error);
			}
			peerConnection.peer = NullSimplePeer;
		}

		// cleanup existing stream before creating new one
		if (peerConnection.localStream) {
			peerConnection.localStream.getTracks().forEach((track) => {
				track.stop();
			});
			peerConnection.localStream = null;
		}

		// clear old signals and reset call state when recreating peer
		peerConnection.signalsDataToCallUser = [];
		peerConnection.isCallStarted = false;

		createDesktopCapturerStream(
			peerConnection,
			peerConnection.desktopCapturerSourceID,
		)
			.then(() => {
				// if (peerConnection.peer === NullSimplePeer) {
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-ignore
				peerConnection.peer = new SimplePeer({
					initiator: true,
					// trickle: false,
					// wrtc: window.api.wrtc,
					config: { iceServers: STUN_ICE_SERVERS },
				});
				// }

				// TODO: basically here we need a client side simple peer, but we get a nodejs side simple peer
				if (peerConnection.localStream !== null) {
					peerConnection.peer.addStream(peerConnection.localStream);
					// Prefer smoothness and low latency over sharpness for live
					// screen content, so text/scroll updates feel instantaneous.
					for (const track of peerConnection.localStream.getVideoTracks()) {
						try {
							track.contentHint = peerConnection.streamSettings.contentHint;
						} catch {
							// contentHint is best-effort and unsupported in some browsers
						}
					}
					void applyLowLatencySenderParameters(
						peerConnection.peer,
						peerConnection.streamSettings,
					);
				}

				peerConnection.peer.on('signal', (data: string) => {
					// The first signals (offer SDP) are queued and flushed by
					// callPeer(). Once the call has started, forward any late
					// trickle ICE candidates immediately; otherwise the remote
					// peer would be missing most of our candidates and ICE could
					// fail or fall back to a slower path.
					if (peerConnection.isCallStarted) {
						void peerConnection.sendEncryptedMessage({
							type: 'CALL_USER',
							payload: {
								signalData: data,
							},
						});
						return;
					}
					// fired when simple peer and webrtc done preparation to start call on peerConnection machine
					peerConnection.signalsDataToCallUser.push(data);
				});

				peerConnection.peer.on('data', (data) => {
					void handlePeerOnData(peerConnection, data).catch((error) =>
						console.error('Could not apply viewer settings:', error),
					);
				});
				peerConnection.peer.on('connect', () => {
					void peerConnection
						.applyStreamSettings(peerConnection.streamSettings)
						.catch((error) =>
							console.error('Could not configure stream:', error),
						);
				});

				// ensure cleanup on peer end/error to prevent dangling helper window
				peerConnection.peer.on('close', () => {
					peerConnection.selfDestroy();
				});

				peerConnection.peer.on('error', (e: Error) => {
					console.error('peerConnection peer error', e);
					peerConnection.selfDestroy();
				});
				resolve(undefined);
			})
			.catch((e) => {
				console.error(e);
				reject(e);
			});
	});
}

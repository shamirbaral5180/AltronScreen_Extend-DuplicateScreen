import type SimplePeer from 'simple-peer';
import {
	DEFAULT_STREAM_SETTINGS,
	type StreamSettings,
} from '../../../../common/StreamSettings';

// LAN host candidates are sufficient; do not contact public STUN/TURN services.
export const STUN_ICE_SERVERS: RTCIceServer[] = [];

export const MAX_VIDEO_BITRATE = 5_000_000;

/**
 * Apply low-latency parameters to the video sender. Best-effort: some browsers
 * (and older Electron) do not support sender parameters, so failures are
 * ignored rather than allowed to tear down the peer connection.
 */
export async function applyLowLatencySenderParameters(
	peer: SimplePeer.Instance,
	settings: StreamSettings = DEFAULT_STREAM_SETTINGS,
): Promise<void> {
	try {
		const peerConnection = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
		if (!peerConnection?.getSenders) return;

		for (const sender of peerConnection.getSenders()) {
			const track = sender.track;
			if (!track || track.kind !== 'video') continue;
			try {
				track.contentHint = settings.contentHint;
			} catch {
				// ignore
			}
			try {
				const params = sender.getParameters() as RTCRtpSendParameters & {
					degradationPreference?: string;
				};
				if (!params.encodings || params.encodings.length === 0) {
					// Not yet negotiated; re-applied on the peer 'connect' event.
					continue;
				}
				params.encodings[0].maxBitrate = Math.round(
					settings.bitrateMbps * 1_000_000,
				);
				params.encodings[0].maxFramerate = settings.frameRate;
				params.degradationPreference =
					settings.latency === 'interactive'
						? 'maintain-framerate'
						: settings.latency === 'smooth'
							? 'maintain-resolution'
							: 'balanced';
				try {
					await sender.setParameters(params);
				} catch {
					delete params.degradationPreference;
					await sender.setParameters(params);
				}
			} catch (error) {
				throw error;
			}
		}
	} catch (error) {
		throw error;
	}
}

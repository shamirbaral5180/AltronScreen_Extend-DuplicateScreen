import type SimplePeer from 'simple-peer';

// LAN host candidates are sufficient; do not contact public STUN/TURN services.
export const STUN_ICE_SERVERS: RTCIceServer[] = [];

export const MAX_VIDEO_BITRATE = 5_000_000;
const MAX_VIDEO_FRAMERATE = 60;

/**
 * Apply low-latency parameters to the video sender. Best-effort: some browsers
 * (and older Electron) do not support sender parameters, so failures are
 * ignored rather than allowed to tear down the peer connection.
 */
export function applyLowLatencySenderParameters(
	peer: SimplePeer.Instance,
): void {
	try {
		const peerConnection = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
		if (!peerConnection?.getSenders) return;

		for (const sender of peerConnection.getSenders()) {
			const track = sender.track;
			if (!track || track.kind !== 'video') continue;
			try {
				track.contentHint = 'motion';
			} catch {
				// ignore
			}
			try {
				const params = sender.getParameters();
				if (!params.encodings || params.encodings.length === 0) {
					// Not yet negotiated; the sdpTransform bitrate cap still applies.
					continue;
				}
				params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE;
				params.encodings[0].maxFramerate = MAX_VIDEO_FRAMERATE;
				void sender.setParameters(params).catch(() => {
					// ignore unsupported parameter changes
				});
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}
}

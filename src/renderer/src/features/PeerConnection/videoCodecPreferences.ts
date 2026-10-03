import type SimplePeer from 'simple-peer';

// Order matters: earlier entries are preferred. H.264 is listed first because
// it is hardware-encoded/decoded on virtually every desktop GPU, which removes
// the CPU bottleneck that makes software VP8/VP9 screen sharing look choppy.
// AV1 is last: it is excellent when hardware-encoded but very slow in software,
// and browsers only expose it for send when the hardware supports it.
const PREFERRED_VIDEO_CODECS = ['h264', 'vp9', 'vp8', 'av1'];

function codecShortName(mimeType: string): string {
	const slash = mimeType.indexOf('/');
	const semicolon = mimeType.indexOf(';');
	const start = slash >= 0 ? slash + 1 : 0;
	const end = semicolon >= 0 ? semicolon : mimeType.length;
	return mimeType.slice(start, end).trim().toLowerCase();
}

function codecRank(mimeType: string): number {
	const index = PREFERRED_VIDEO_CODECS.indexOf(codecShortName(mimeType));
	// Unknown/auxiliary codecs (rtx, red, ulpfec, ...) keep the lowest priority
	// and are reordered by Chromium relative to their associated primaries.
	return index === -1 ? PREFERRED_VIDEO_CODECS.length : index;
}

type PeerConnectionWithTransceivers = RTCPeerConnection & {
	getTransceivers?: () => RTCRtpTransceiver[];
};

type RtpSenderWithCapabilities = typeof RTCRtpSender & {
	getCapabilities?: (kind: string) => RTCRtpCapabilities | undefined;
};

/**
 * Ask the local RTCPeerConnection to offer hardware-friendly codecs first.
 *
 * This must run on the host (the offerer) synchronously after the video track
 * is added and before simple-peer creates its offer, so the preference is
 * reflected in the SDP. It is fully best-effort: unsupported browsers, missing
 * capabilities, or per-transceiver failures are ignored so sharing keeps
 * working with whatever the browser would have chosen anyway.
 */
export default function applyPreferredVideoCodecs(
	peer: SimplePeer.Instance | null,
): void {
	if (!peer) return;
	try {
		const peerConnection = (
			peer as unknown as { _pc?: PeerConnectionWithTransceivers }
		)._pc;
		if (!peerConnection?.getTransceivers) {
			return;
		}

		const capabilities = (
			RTCRtpSender as unknown as RtpSenderWithCapabilities
		).getCapabilities?.('video');
		if (!capabilities?.codecs?.length) return;

		// Stable sort so codecs of equal rank (e.g. multiple H.264 profiles)
		// keep the browser's original relative order.
		const ordered = [...capabilities.codecs].sort(
			(a, b) => codecRank(a.mimeType) - codecRank(b.mimeType),
		);

		for (const transceiver of peerConnection.getTransceivers()) {
			const kind =
				transceiver.sender?.track?.kind ?? transceiver.receiver?.track?.kind;
			if (kind !== 'video') continue;
			try {
				transceiver.setCodecPreferences?.(ordered);
			} catch {
				// Some browsers reject preferences on individual transceivers.
			}
		}
	} catch {
		// Never let codec preference negotiation break a working share.
	}
}

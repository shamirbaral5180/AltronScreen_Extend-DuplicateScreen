import {
	RECEIVER_BUFFER_MS,
	validateStreamSettings,
	type StreamSettings,
} from '../../../../common/StreamSettings';

export default function applyReceiverSettings(
	peerConnection: PeerConnection,
	value: StreamSettings,
): void {
	const settings = validateStreamSettings(value);
	const pc = (
		peerConnection.peer as unknown as { _pc?: RTCPeerConnection } | null
	)?._pc;
	for (const receiver of pc?.getReceivers() ?? []) {
		if (receiver.track.kind !== 'video') continue;
		const configurable = receiver as RTCRtpReceiver & {
			jitterBufferTarget?: number;
		};
		try {
			if ('jitterBufferTarget' in configurable)
				configurable.jitterBufferTarget = RECEIVER_BUFFER_MS[settings.latency];
		} catch {
			/* Receiver buffer preferences are not supported by every browser. */
		}
	}
}

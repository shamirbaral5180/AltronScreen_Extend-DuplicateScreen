import setSdpMediaBitrate from './setSdpMediaBitrate';
import { MAX_VIDEO_BITRATE } from './webRtcPeerOptions';

export default (sdp: string): string => {
	let newSDP = sdp;
	newSDP = setSdpMediaBitrate(newSDP, 'video', MAX_VIDEO_BITRATE);
	return newSDP;
};

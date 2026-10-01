// LAN host candidates are sufficient; do not contact public STUN/TURN services.
export const STUN_ICE_SERVERS: RTCIceServer[] = [];

/**
 * Upper bound for the shared video bitrate. The host caps its SDP to the same
 * value so both sides agree on a ceiling instead of negotiating an unbounded
 * rate that could exceed the LAN capacity and add latency.
 */
export const MAX_VIDEO_BITRATE = 5_000_000;

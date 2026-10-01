/* istanbul ignore file */

let hostname;
let protocol;
let primaryPort;
let backupPort;

if (!hostname && !protocol && !primaryPort && !backupPort) {
	hostname = 'localhost';
	protocol = 'http';
	primaryPort = 3131;
	backupPort = 3132;
}

// Official download page for the Windows Virtual Display Driver (VDD), which
// AltronScreen uses to create a real extended (secondary) display on the host.
export const VIRTUAL_DISPLAY_DRIVER_URL =
	'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/latest';

// Public entry point; each browser is assigned a private signaling room.
export const DEFAULT_ROOM_ID = 'share';
export const MAX_VIEWER_SESSIONS = 16;

export default {
	hostname,
	protocol,
	primaryPort,
	backupPort,
};

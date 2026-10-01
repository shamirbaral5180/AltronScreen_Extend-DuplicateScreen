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

// A single, fixed room id used for all sharing sessions. The random room id
// was removed so the share URL stays clean (no `/<random>` suffix); the app is
// LAN-only and still requires the host to explicitly allow each connection.
export const DEFAULT_ROOM_ID = 'share';

export default {
	hostname,
	protocol,
	primaryPort,
	backupPort,
};

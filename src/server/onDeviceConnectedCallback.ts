import { IpcEvents } from '../common/IpcEvents.enum';
import { getAltronScreenGlobal } from '../main/helpers/getAltronScreenGlobal';
import { altronscreenApp } from '../main';
import { Device } from '../common/Device';
import SharingSessionStatusEnum from '../features/SharingSessionService/SharingSessionStatusEnum';

export function showNextPendingConnection(): void {
	const { connectedDevicesService, sharingSessionService } =
		getAltronScreenGlobal();
	const device = connectedDevicesService.pendingConnectionDevice;
	sharingSessionService.waitingForConnectionSharingSession =
		sharingSessionService.sharingSessions.get(device.sharingSessionID) ?? null;
	const window = altronscreenApp.mainWindow;
	if (window && !window.isDestroyed()) {
		window.webContents.send(IpcEvents.SetPendingConnectionDevice, device.id ? device : null);
	}
}

export function onDeviceConnectedCallback(device: Device): void {
	const altronscreenGlobal = getAltronScreenGlobal();
	const { connectedDevicesService, sharingSessionService } = altronscreenGlobal;
	const session = sharingSessionService.sharingSessions.get(
		device.sharingSessionID,
	);
	if (!session || session.status === SharingSessionStatusEnum.SHARING) return;
	const wasEmpty = !connectedDevicesService.pendingConnectionDevice.id;
	if (!connectedDevicesService.setPendingConnectionDevice(device)) return;
	session.setDeviceID(device.id);
	if (wasEmpty) showNextPendingConnection();
}

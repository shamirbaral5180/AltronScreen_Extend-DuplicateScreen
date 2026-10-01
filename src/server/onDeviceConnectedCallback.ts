import { IpcEvents } from '../common/IpcEvents.enum';
import { getAltronScreenGlobal } from '../main/helpers/getAltronScreenGlobal';
import { altronscreenApp } from '../main';
import { Device } from '../common/Device';
import SharingSessionStatusEnum from '../features/SharingSessionService/SharingSessionStatusEnum';

export function onDeviceConnectedCallback(device: Device): void {
	const altronscreenGlobal = getAltronScreenGlobal();
	const { connectedDevicesService, sharingSessionService } = altronscreenGlobal;
	if (!connectedDevicesService.isSlotAvailable()) {
		const waitingSession =
			sharingSessionService.waitingForConnectionSharingSession;
		waitingSession?.denyConnectionForPartner();
		waitingSession?.setStatus(SharingSessionStatusEnum.NOT_CONNECTED);
		sharingSessionService.waitingForConnectionSharingSession = null;
		connectedDevicesService.resetPendingConnectionDevice();
		return;
	}
	connectedDevicesService.setPendingConnectionDevice(device);
	altronscreenApp.mainWindow?.webContents.send(
		IpcEvents.SetPendingConnectionDevice,
		device,
	);
}

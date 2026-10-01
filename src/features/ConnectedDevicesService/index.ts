import { Device } from '../../common/Device';

export const nullDevice: Device = {
	id: '',
	sharingSessionID: '',
	deviceOS: '',
	deviceType: '',
	deviceIP: '',
	deviceBrowser: '',
	deviceScreenWidth: -1,
	deviceScreenHeight: -1,
	deviceRoomId: '',
};

export class ConnectedDevicesService {
	private readonly devices = new Map<string, Readonly<Device>>();
	private readonly pendingDevices = new Map<string, Device>();

	get pendingConnectionDevice(): Device {
		return this.pendingDevices.values().next().value ?? nullDevice;
	}

	removePendingDevice(sharingSessionID: string): void {
		this.pendingDevices.delete(sharingSessionID);
	}

	getDevices(): Device[] {
		return [...this.devices.values()].map((device) => ({ ...device }));
	}

	disconnectAllDevices(): void {
		this.devices.clear();
	}

	disconnectDeviceByID(deviceIDToRemove: string): Promise<undefined> {
		return new Promise<undefined>((resolve) => {
			this.devices.delete(deviceIDToRemove);
			resolve(undefined);
		});
	}

	addDevice(device: Device): void {
		this.devices.set(device.id, Object.freeze({ ...device }));
	}

	setPendingConnectionDevice(device: Device): boolean {
		if (
			this.pendingDevices.has(device.sharingSessionID) ||
			this.devices.has(device.id)
		)
			return false;
		this.pendingDevices.set(device.sharingSessionID, device);
		return true;
	}
}

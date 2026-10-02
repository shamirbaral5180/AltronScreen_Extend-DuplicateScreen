import { BrowserWindow } from 'electron';
import uuid from 'uuid';
import SharingSessionStatusEnum from './SharingSessionStatusEnum';
import SharingTypeEnum from './SharingTypeEnum';
import PeerConnectionHelperRendererService from '../PeerConnectionHelperRendererService';
import { Device } from '../../common/Device';
import { LocalPeerUser } from '../../common/LocalPeerUser';
import Logger from '../../main/utils/LoggerWithFilePrefix';
import type { StreamSettings } from '../../common/StreamSettings';

export type SharingSessionStatusChangeListener = (
	sharingSessionID: string,
) => void;

export default class SharingSession {
	log = new Logger(__filename);
	id: string;
	deviceID: string;
	sharingType: SharingTypeEnum;
	sharingStream: MediaStream | null;
	roomID: string;
	connectedDeviceAt: Date | null;
	sharingStartedAt: Date | null;
	status: SharingSessionStatusEnum;
	statusChangeListeners: SharingSessionStatusChangeListener[];
	peerConnectionHelperRenderer: BrowserWindow | undefined;
	onDeviceConnectedCallback: undefined | ((device: Device) => void);
	desktopCapturerSourceID: string;

	constructor(
		_roomID: string,
		user: LocalPeerUser,
		peerConnectionHelperRendererService: PeerConnectionHelperRendererService,
	) {
		this.id = uuid.v4();
		this.deviceID = '';
		this.sharingType = SharingTypeEnum.NOT_SET;
		this.sharingStream = null;
		this.roomID = _roomID;
		this.connectedDeviceAt = null;
		this.sharingStartedAt = null;
		this.status = SharingSessionStatusEnum.NOT_CONNECTED;
		this.statusChangeListeners = [] as SharingSessionStatusChangeListener[];
		this.desktopCapturerSourceID = '';
		this.onDeviceConnectedCallback = undefined;

		if (process.env.RUN_MODE === 'test') return;

		this.peerConnectionHelperRenderer =
			peerConnectionHelperRendererService.createPeerConnectionHelperRenderer();

		this.peerConnectionHelperRenderer.webContents.on('did-finish-load', () => {
			// TODO: I need to remove dependency on renderer window, just to facilitate development
			// TODO: OR I can use a Utility or Child process to handle this. https://electron-vite.org/guide/dev#utility-process-and-child-process
			// TODO: probably using worker thread is the best option, but it will use the same resources as the main thread. child process is using more resources, but it is more isolated.
			this.peerConnectionHelperRenderer?.webContents.send(
				'create-peer-connection-with-data',
				{
					roomID: this.roomID,
					sharingSessionID: this.id,
					user,
				},
			);
		});

		this.peerConnectionHelperRenderer.webContents.on(
			'ipc-message',
			(_, channel, data) => {
				if (channel === 'peer-connected') {
					if (this.onDeviceConnectedCallback) {
						this.onDeviceConnectedCallback(data);
					}
				}
			},
		);

		this.statusChangeListeners.push(() => {
			if (this.status === SharingSessionStatusEnum.CONNECTED) {
				this.peerConnectionHelperRenderer?.webContents.send(
					'send-user-allowed-to-connect',
				);
			}
		});
	}

	destroy(): void {
		const helper = this.peerConnectionHelperRenderer;
		if (helper && !helper.isDestroyed()) helper.close();
	}

	setOnDeviceConnectedCallback(callback: (device: Device) => void): void {
		this.onDeviceConnectedCallback = callback;
	}

	async setDesktopCapturerSourceID(id: string): Promise<void> {
		if (process.env.RUN_MODE !== 'test') {
			await this.requestHelper('set-desktop-capturer-source-id', id);
		}
		this.desktopCapturerSourceID = id;
	}

	async callPeer(): Promise<void> {
		if (process.env.RUN_MODE === 'test') return;
		await this.requestHelper('call-peer');
	}

	async updateStreamSettings(settings: StreamSettings): Promise<void> {
		await this.requestHelper('stream-settings-changed', settings);
	}

	private requestHelper(channel: string, sourceId?: unknown): Promise<void> {
		return new Promise((resolve, reject) => {
			const helper = this.peerConnectionHelperRenderer;
			if (!helper || helper.isDestroyed()) {
				reject(
					new Error(
						'The screen-sharing helper is no longer available. Reconnect the viewer.',
					),
				);
				return;
			}
			const requestID = uuid.v4();
			const contents = helper.webContents;
			const finish = (error?: string) => {
				clearTimeout(timer);
				contents.removeListener('ipc-message', onResult);
				helper.removeListener('closed', onClosed);
				if (error) {
					this.log.error(`Sharing ${this.id} ${channel}: ${error}`);
					reject(new Error(error));
				} else resolve();
			};
			const onClosed = () =>
				finish('The screen-sharing connection closed. Reconnect the viewer.');
			const onResult = (
				_,
				resultChannel: string,
				result: { requestID: string; error?: string },
			) => {
				if (
					resultChannel === `${channel}-result` &&
					result.requestID === requestID
				)
					finish(result.error);
			};
			const timer = setTimeout(
				() =>
					finish(
						'Screen sharing timed out. Check Windows Firewall and that both devices are on the same LAN.',
					),
				35000,
			);
			helper.webContents.on('ipc-message', onResult);
			helper.once('closed', onClosed);
			helper.webContents.send(channel, sourceId, requestID);
		});
	}

	disconnectByHostMachineUser(): void {
		this.peerConnectionHelperRenderer?.webContents.send(
			'disconnect-by-host-machine-user',
			this.deviceID,
		);
	}

	denyConnectionForPartner(): void {
		this.peerConnectionHelperRenderer?.webContents.send(
			'deny-connection-for-partner',
		);
	}

	appLanguageChanged(): void {
		this.peerConnectionHelperRenderer?.webContents.send('app-language-changed');
	}

	addStatusChangeListener(callback: SharingSessionStatusChangeListener): void {
		this.statusChangeListeners.push(callback);
	}

	notifyStatusChangeListeners(): Promise<undefined> {
		return new Promise((resolve) => {
			for (let i = 0; i < this.statusChangeListeners.length; i += 1) {
				this.statusChangeListeners[i](this.id);
			}
			resolve(undefined);
		});
	}

	setStatus(newStatus: SharingSessionStatusEnum): void {
		this.status = newStatus;
		this.notifyStatusChangeListeners();
	}

	setDeviceID(deviceID: string): void {
		this.deviceID = deviceID;
	}
}

// override console early to catch all logs in helper renderer
import {
	overrideGlobalConsole,
	startConsoleRateLimiting,
} from '../../common/rateLimitedConsole';
overrideGlobalConsole();
startConsoleRateLimiting();

import { IpcEvents } from '../../common/IpcEvents.enum';
import PeerConnection from './features/PeerConnection';

const loadDevelopmentText = (): void => {
	const root = document.getElementById('root');
	if (root) {
		const h1 = document.createElement('h1');
		h1.textContent =
			'This is a client connection WebRTC electron renderer helper window.';
		root.appendChild(h1);

		const h2Mode = document.createElement('h2');
		h2Mode.textContent = 'It is shown only in Dev mode';
		root.appendChild(h2Mode);

		const h2F12 = document.createElement('h2');
		h2F12.textContent =
			'Press F12 to open Development Tools for this renderer window to debug webrtc with one connected client.';
		root.appendChild(h2F12);
	} else {
		console.error('Root element not found.');
	}
};

export function handleIpcRenderer(): void {
	window.electron.ipcRenderer.on('start-peer-connection', () => {
		let peerConnection: PeerConnection | undefined;
		let sourceReady: Promise<void> = Promise.resolve();

		window.electron.ipcRenderer.on(
			'create-peer-connection-with-data',
			async (_, data) => {
				// cleanup existing peer connection before creating new one
				if (peerConnection) {
					peerConnection.selfDestroy();
					peerConnection = undefined;
				}

				const port = await window.electron.ipcRenderer.invoke(
					IpcEvents.GetPort,
				);
				peerConnection = new PeerConnection(
					data.roomID,
					data.sharingSessionID,
					data.user,
					port,
				);

				peerConnection.setOnDeviceConnectedCallback((deviceData) => {
					window.electron.ipcRenderer.send('peer-connected', deviceData);
				});
			},
		);

		window.electron.ipcRenderer.on(
			'set-desktop-capturer-source-id',
			(_, id, requestID: string) => {
				if (peerConnection) {
					sourceReady = peerConnection.setDesktopCapturerSourceID(id);
					void sourceReady.then(
						() =>
							window.electron.ipcRenderer.send(
								'set-desktop-capturer-source-id-result',
								{ requestID },
							),
						(error) =>
							window.electron.ipcRenderer.send(
								'set-desktop-capturer-source-id-result',
								{ requestID, error: String(error) },
							),
					);
				} else {
					window.electron.ipcRenderer.send(
						'set-desktop-capturer-source-id-result',
						{
							requestID,
							error:
								'Screen-sharing helper is not ready. Reconnect the viewer.',
						},
					);
				}
			},
		);

		window.electron.ipcRenderer.on(
			'stream-settings-changed',
			async (_, settings, requestID: string) => {
				try {
					await sourceReady;
					if (peerConnection)
						await peerConnection.applyStreamSettings(settings);
					window.electron.ipcRenderer.send('stream-settings-changed-result', {
						requestID,
					});
				} catch (error) {
					window.electron.ipcRenderer.send('stream-settings-changed-result', {
						requestID,
						error: String(error),
					});
				}
			},
		);

		window.electron.ipcRenderer.on(
			'call-peer',
			async (_, _sourceId, requestID: string) => {
				try {
					// Capture is asynchronous; do not start signaling until the peer exists.
					await sourceReady;
					if (!peerConnection)
						throw new Error('Screen-sharing helper is not ready');
					const connection = peerConnection;
					await new Promise<void>((resolve, reject) => {
						const timer = setTimeout(
							() =>
								reject(
									new Error(
										'WebRTC did not connect. Check Windows Firewall and LAN connectivity.',
									),
								),
							30000,
						);
						connection.peer.once('connect', () => {
							clearTimeout(timer);
							resolve();
						});
						connection.peer.once('error', (error: Error) => {
							clearTimeout(timer);
							reject(error);
						});
						connection.callPeer();
					});
					window.electron.ipcRenderer.send('call-peer-result', { requestID });
				} catch (error) {
					console.error('Cannot start sharing:', error);
					window.electron.ipcRenderer.send('call-peer-result', {
						requestID,
						error: String(error),
					});
				}
			},
		);

		window.electron.ipcRenderer.on(
			'disconnect-by-host-machine-user',
			(_, deviceId: string) => {
				if (peerConnection) {
					peerConnection.disconnectByHostMachineUser(deviceId);
				}
			},
		);

		window.electron.ipcRenderer.on('deny-connection-for-partner', () => {
			if (peerConnection) {
				peerConnection.denyConnectionForPartner();
			}
		});

		window.electron.ipcRenderer.on('send-user-allowed-to-connect', () => {
			if (peerConnection) {
				peerConnection.sendUserAllowedToConnect();
			}
		});

		window.electron.ipcRenderer.on('app-language-changed', () => {
			if (peerConnection) {
				peerConnection.notifyClientWithNewLanguage();
			}
		});
	});
}

handleIpcRenderer();

loadDevelopmentText();

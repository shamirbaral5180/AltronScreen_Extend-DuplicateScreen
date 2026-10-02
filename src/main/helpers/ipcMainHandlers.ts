import {
	Display,
	ipcMain,
	BrowserWindow,
	screen,
	clipboard,
	shell,
	app,
} from 'electron';
import i18n from '../configs/i18next.config';
import { ConnectedDevicesService } from '../../features/ConnectedDevicesService';
import SharingSession from '../../features/SharingSessionService/SharingSession';
import RoomIDService from '../../server/RoomIDService';
import { signalingServer } from '../../server';
import { showNextPendingConnection } from '../../server/onDeviceConnectedCallback';
import SharingSessionStatusEnum from '../../features/SharingSessionService/SharingSessionStatusEnum';
import getMyLocalIpV4 from './getMyLocalIpV4';
import isWifiConnected from './isWifiConnected';
import { getAltronScreenGlobal } from './getAltronScreenGlobal';
import { IpcEvents } from '../../common/IpcEvents.enum';
import { ElectronStoreKeys } from '../../common/ElectronStoreKeys.enum';
import { store } from '../../common/altronscreen-electron-store';
import DesktopCapturerSourceType from '../../common/DesktopCapturerSourceType';
import isLinuxWaylandSession from '../utils/isLinuxWaylandSession';
import { checkScreenRecordingPermission } from './checkScreenRecordingPermission';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { validateStreamSettings } from '../../common/StreamSettings';
import { getStreamSettings, STREAM_SETTINGS_KEY } from './streamSettings';
import {
	getVirtualDisplayResolution,
	SUPPORTED_VIRTUAL_DISPLAY_RESOLUTIONS,
	validateVirtualDisplayResolution,
	VIRTUAL_DISPLAY_RESOLUTION_KEY,
} from './virtualDisplaySettings';

export const initIpcMainHandlers = (mainWindow: BrowserWindow): void => {
	ipcMain.handle(IpcEvents.GetStreamSettings, getStreamSettings);
	ipcMain.handle(IpcEvents.SetStreamSettings, async (_, value: unknown) => {
		const settings = validateStreamSettings(value);
		store.set(STREAM_SETTINGS_KEY, JSON.stringify(settings));
		const sessions = [
			...getAltronScreenGlobal().sharingSessionService.sharingSessions.values(),
		].filter((session) => session.desktopCapturerSourceID);
		const results = await Promise.allSettled(
			sessions.map((session) => session.updateStreamSettings(settings)),
		);
		return {
			settings,
			updated: results.filter((result) => result.status === 'fulfilled').length,
			warnings: results
				.filter((result) => result.status === 'rejected')
				.map((result) => String((result as PromiseRejectedResult).reason)),
		};
	});
	ipcMain.handle(
		IpcEvents.GetVirtualDisplayResolutionOptions,
		() => SUPPORTED_VIRTUAL_DISPLAY_RESOLUTIONS,
	);
	ipcMain.handle(
		IpcEvents.GetVirtualDisplayResolution,
		getVirtualDisplayResolution,
	);
	ipcMain.handle(
		IpcEvents.SetVirtualDisplayResolution,
		async (_, value: unknown) => {
			const resolution = validateVirtualDisplayResolution(value);
			store.set(VIRTUAL_DISPLAY_RESOLUTION_KEY, JSON.stringify(resolution));
			return { ok: true, resolution };
		},
	);

	ipcMain.on('client-changed-language', async (_, newLangCode) => {
		i18n.changeLanguage(newLangCode);
		if (store.has(ElectronStoreKeys.AppLanguage)) {
			if (store.get(ElectronStoreKeys.AppLanguage) === newLangCode) {
				return;
			}
			store.delete(ElectronStoreKeys.AppLanguage);
		}
		store.set(ElectronStoreKeys.AppLanguage, newLangCode);
	});

	ipcMain.handle('get-signaling-server-port', () => {
		if (mainWindow === null) return;
		mainWindow.webContents.send('sending-port-from-main', signalingServer.port);
	});

	ipcMain.handle('get-all-displays', () => {
		return screen.getAllDisplays();
	});

	ipcMain.handle('get-display-size-by-display-id', (_, displayID: string) => {
		const display = screen.getAllDisplays().find((d: Display) => {
			return `${d.id}` === displayID;
		});

		if (display) {
			return display.size;
		}
		return undefined;
	});

	ipcMain.handle(IpcEvents.GetIsLinuxWaylandSession, () => {
		return isLinuxWaylandSession;
	});

	ipcMain.handle(
		IpcEvents.RequestDesktopCapturerPortalSource,
		async (_, { mode }: { mode: 'screen' | 'window' }) => {
			const types =
				mode === 'window'
					? [DesktopCapturerSourceType.WINDOW]
					: [DesktopCapturerSourceType.SCREEN];

			if (!isLinuxWaylandSession) {
				await getAltronScreenGlobal().desktopCapturerSourcesService.refreshDesktopCapturerSources();
				if (mode === 'window') {
					const sources =
						getAltronScreenGlobal().desktopCapturerSourcesService.getAppWindowSources();
					return sources[0]?.id ?? null;
				}
				const sources =
					getAltronScreenGlobal().desktopCapturerSourcesService.getScreenSources();
				return sources[0]?.id ?? null;
			}

			const source =
				await getAltronScreenGlobal().desktopCapturerSourcesService.requestPortalSource(
					types,
				);
			return source?.id ?? null;
		},
	);

	ipcMain.handle('main-window-onbeforeunload', () => {
		const altronscreenGlobal = getAltronScreenGlobal();
		altronscreenGlobal.connectedDevicesService = new ConnectedDevicesService();
		altronscreenGlobal.roomIDService = new RoomIDService();
		altronscreenGlobal.sharingSessionService.sharingSessions.forEach(
			(sharingSession: SharingSession) => {
				sharingSession.denyConnectionForPartner();
				sharingSession.destroy();
			},
		);

		altronscreenGlobal.rendererWebrtcHelpersService.closeAll();

		altronscreenGlobal.sharingSessionService.waitingForConnectionSharingSession =
			null;
		altronscreenGlobal.sharingSessionService.sharingSessions.clear();
	});

	ipcMain.handle('get-latest-version', () => {
		return getAltronScreenGlobal().latestAppVersion;
	});

	ipcMain.handle('get-current-version', () => {
		return getAltronScreenGlobal().currentAppVersion;
	});

	ipcMain.handle('get-local-lan-ip', async () => {
		const altronscreenGlobal = getAltronScreenGlobal();
		if (altronscreenGlobal.cliLocalIp) {
			return altronscreenGlobal.cliLocalIp;
		}
		const ip = getMyLocalIpV4();
		return ip;
	});

	ipcMain.handle('check-wifi-connection', async () => {
		return isWifiConnected();
	});

	ipcMain.handle(IpcEvents.GetPort, () => {
		return signalingServer.port;
	});

	ipcMain.handle(IpcEvents.GetAppPath, () => {
		const altronscreenGlobal = getAltronScreenGlobal();
		return altronscreenGlobal.appPath;
	});

	ipcMain.handle(IpcEvents.UnmarkRoomIDAsTaken, (_, roomID) => {
		const altronscreenGlobal = getAltronScreenGlobal();
		// A late cleanup message from an old helper must not invalidate its replacement.
		if (
			[
				...altronscreenGlobal.sharingSessionService.sharingSessions.values(),
			].some((session) => session.roomID === roomID)
		)
			return;
		altronscreenGlobal.roomIDService.unmarkRoomIDAsTaken(roomID);
	});

	ipcMain.handle(
		IpcEvents.CreateWaitingForConnectionSharingSession,
		showNextPendingConnection,
	);

	async function resetWaitingForConnectionSharingSession(
		sharingSession = getAltronScreenGlobal().sharingSessionService
			.waitingForConnectionSharingSession,
	): Promise<void> {
		if (!sharingSession) return;
		getAltronScreenGlobal().connectedDevicesService.removePendingDevice(
			sharingSession.id,
		);
		const roomID = sharingSession?.roomID;
		sharingSession?.denyConnectionForPartner();
		sharingSession?.disconnectByHostMachineUser();
		sharingSession?.destroy();
		sharingSession?.setStatus(SharingSessionStatusEnum.NOT_CONNECTED);
		getAltronScreenGlobal().sharingSessionService.sharingSessions.delete(
			sharingSession?.id as string,
		);
		if (roomID) {
			getAltronScreenGlobal().roomIDService.unmarkRoomIDAsTaken(roomID);
		}
		if (
			getAltronScreenGlobal().sharingSessionService
				.waitingForConnectionSharingSession === sharingSession
		) {
			getAltronScreenGlobal().sharingSessionService.waitingForConnectionSharingSession =
				null;
		}
		if (roomID) await signalingServer.closeRoom(roomID);
	}

	ipcMain.handle(IpcEvents.ResetWaitingForConnectionSharingSession, () =>
		resetWaitingForConnectionSharingSession(),
	);

	ipcMain.handle(IpcEvents.SetDeviceConnectedStatus, () => {
		if (
			getAltronScreenGlobal().sharingSessionService
				.waitingForConnectionSharingSession !== null
		) {
			const sharingSession =
				getAltronScreenGlobal().sharingSessionService
					.waitingForConnectionSharingSession;
			sharingSession?.setStatus(SharingSessionStatusEnum.CONNECTED);
		}
	});

	ipcMain.handle(
		IpcEvents.GetSourceDisplayIDByDesktopCapturerSourceID,
		(_, sourceId) => {
			return getAltronScreenGlobal().desktopCapturerSourcesService.getSourceDisplayIDByDisplayCapturerSourceID(
				sourceId,
			);
		},
	);

	ipcMain.handle(
		IpcEvents.DisconnectPeerAndDestroySharingSessionBySessionID,
		(_, sessionId) => {
			const sharingSession =
				getAltronScreenGlobal().sharingSessionService.sharingSessions.get(
					sessionId,
				);
			if (sharingSession) {
				getAltronScreenGlobal().connectedDevicesService.disconnectDeviceByID(
					sharingSession.deviceID,
				);
			}
			sharingSession?.disconnectByHostMachineUser();
			sharingSession?.destroy();
			getAltronScreenGlobal().sharingSessionService.sharingSessions.delete(
				sessionId,
			);
		},
	);

	ipcMain.handle(
		IpcEvents.GetDesktopCapturerSourceIdBySharingSessionId,
		(_, sessionId) => {
			return getAltronScreenGlobal().sharingSessionService.sharingSessions.get(
				sessionId,
			)?.desktopCapturerSourceID;
		},
	);

	ipcMain.handle(IpcEvents.GetConnectedDevices, () => {
		return getAltronScreenGlobal().connectedDevicesService.getDevices();
	});

	ipcMain.handle(IpcEvents.DisconnectDeviceById, (_, id) => {
		getAltronScreenGlobal().connectedDevicesService.disconnectDeviceByID(id);
	});

	ipcMain.handle(IpcEvents.DisconnectAllDevices, () => {
		getAltronScreenGlobal().connectedDevicesService.disconnectAllDevices();
	});

	ipcMain.handle(IpcEvents.AppLanguageChanged, (_, newLang) => {
		if (store.has(ElectronStoreKeys.AppLanguage)) {
			store.delete(ElectronStoreKeys.AppLanguage);
		}
		store.set(ElectronStoreKeys.AppLanguage, newLang);
		getAltronScreenGlobal().sharingSessionService.sharingSessions.forEach(
			(sharingSession) => {
				sharingSession?.appLanguageChanged();
			},
		);
		i18n.changeLanguage(newLang);
	});

	ipcMain.handle(IpcEvents.GetDesktopCapturerServiceSourcesMap, () => {
		const map =
			getAltronScreenGlobal().desktopCapturerSourcesService.getSourcesMap();
		const res = {};

		for (const key of map.keys()) {
			const source = map.get(key);
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			res[key] = {
				source: {
					thumbnail: source?.source.thumbnail?.toDataURL(),
					appIcon: source?.source.appIcon?.toDataURL(),
					name: source?.source.name,
				},
			};
		}
		return res;
	});

	ipcMain.handle(
		IpcEvents.GetDesktopCapturerServiceSourcesByIds,
		(_, ids: string[]) => {
			const map =
				getAltronScreenGlobal().desktopCapturerSourcesService.getSourcesMap();
			const res = {};

			ids.forEach((id) => {
				const source = map.get(id);
				if (!source) return;
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-ignore
				res[id] = {
					source: {
						thumbnail: source?.source.thumbnail?.toDataURL(),
						appIcon: source?.source.appIcon?.toDataURL(),
						name: source?.source.name,
					},
				};
			});
			return res;
		},
	);

	ipcMain.handle(
		IpcEvents.GetWaitingForConnectionSharingSessionSourceId,
		() => {
			return getAltronScreenGlobal().sharingSessionService
				.waitingForConnectionSharingSession?.desktopCapturerSourceID;
		},
	);

	async function startSharingOnWaitingForConnectionSharingSession(): Promise<{
		ok: boolean;
		message?: string;
	}> {
		const altronscreenGlobal = getAltronScreenGlobal();
		const { connectedDevicesService, sharingSessionService, roomIDService } =
			altronscreenGlobal;
		const pendingDevice = connectedDevicesService.pendingConnectionDevice;
		if (!pendingDevice.id) {
			return {
				ok: false,
				message: 'The viewer disconnected. Reconnect it before sharing.',
			};
		}

		const sharingSession =
			sharingSessionService.waitingForConnectionSharingSession;
		if (!sharingSession?.desktopCapturerSourceID) {
			return {
				ok: false,
				message: 'Select a screen or application window before sharing.',
			};
		}

		try {
			// Keep each device independent and only list it after media connects.
			await sharingSession.callPeer();
			connectedDevicesService.addDevice(pendingDevice);
		} catch (error) {
			console.error('Failed to establish screen-sharing connection:', error);
			await resetWaitingForConnectionSharingSession(sharingSession);
			showNextPendingConnection();
			return {
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			};
		}

		roomIDService.unmarkRoomIDAsTaken(sharingSession.roomID);
		sharingSession.setStatus(SharingSessionStatusEnum.SHARING);
		sharingSessionService.waitingForConnectionSharingSession = null;

		connectedDevicesService.removePendingDevice(sharingSession.id);
		return { ok: true };
	}

	let sharingStart: ReturnType<
		typeof startSharingOnWaitingForConnectionSharingSession
	> | null = null;
	ipcMain.handle(
		IpcEvents.StartSharingOnWaitingForConnectionSharingSession,
		() => {
			if (!sharingStart) {
				sharingStart =
					startSharingOnWaitingForConnectionSharingSession().finally(() => {
						sharingStart = null;
					});
			}
			return sharingStart;
		},
	);

	ipcMain.handle(IpcEvents.GetPendingConnectionDevice, () => {
		return getAltronScreenGlobal().connectedDevicesService
			.pendingConnectionDevice;
	});

	ipcMain.handle(IpcEvents.GetWaitingForConnectionSharingSessionRoomId, () => {
		if (
			getAltronScreenGlobal().sharingSessionService
				.waitingForConnectionSharingSession === null
		) {
			return undefined;
		}
		return getAltronScreenGlobal().sharingSessionService
			.waitingForConnectionSharingSession?.roomID;
	});

	ipcMain.handle(
		IpcEvents.GetDesktopSharingSourceIds,
		async (_, { isEntireScreenToShareChosen }) => {
			if (isLinuxWaylandSession) {
				return [];
			}
			// ensure sources are up to date at request time
			await getAltronScreenGlobal().desktopCapturerSourcesService.refreshDesktopCapturerSources();

			if (isEntireScreenToShareChosen === true) {
				return getAltronScreenGlobal()
					.desktopCapturerSourcesService.getScreenSources()
					.map((source) => source.id);
			}
			return getAltronScreenGlobal()
				.desktopCapturerSourcesService.getAppWindowSources()
				.map((source) => source.id);
		},
	);

	ipcMain.handle(IpcEvents.SetDesktopCapturerSourceId, async (_, id) => {
		const sharingSession =
			getAltronScreenGlobal().sharingSessionService
				.waitingForConnectionSharingSession;
		if (!sharingSession)
			throw new Error(
				'The viewer disconnected. Reconnect it before selecting a screen.',
			);
		await sharingSession.setDesktopCapturerSourceID(id);
	});

	ipcMain.handle(IpcEvents.GetVirtualDisplaySupport, () => {
		return getAltronScreenGlobal().virtualDisplayService.isSupported();
	});

	ipcMain.handle(
		IpcEvents.CreateVirtualDisplay,
		async (
			_,
			request: { width?: number; height?: number; refreshHz?: number },
		) => {
			const altronscreenGlobal = getAltronScreenGlobal();
			const virtualDisplayService = altronscreenGlobal.virtualDisplayService;

			if (!virtualDisplayService.isSupported().supported) {
				return { ok: false, reason: 'unsupported-platform' };
			}

			// Use the user's saved extended-display resolution (default 1360x768).
			// It is also offered first to Windows; other modes remain selectable.
			const saved = getVirtualDisplayResolution();
			const width = request?.width ?? saved.width;
			const height = request?.height ?? saved.height;

			const created = await virtualDisplayService.createDisplay({
				width,
				height,
				refreshHz: request?.refreshHz ?? 60,
			});

			if (!created) {
				return { ok: false, reason: 'driver-not-available' };
			}

			// Give the OS a moment to register the new monitor, then refresh the
			// capture-source map so the virtual display can be selected.
			await new Promise((resolve) => setTimeout(resolve, 1500));
			await altronscreenGlobal.desktopCapturerSourcesService.refreshDesktopCapturerSources();

			return { ok: true, width, height };
		},
	);

	ipcMain.handle(IpcEvents.DestroyVirtualDisplay, async () => {
		await getAltronScreenGlobal().virtualDisplayService.destroyDisplay();
		await getAltronScreenGlobal().desktopCapturerSourcesService.refreshDesktopCapturerSources();
		return { ok: true };
	});

	ipcMain.handle(IpcEvents.SetPendingDisplaySourceId, (event, sourceId) => {
		const sources = getAltronScreenGlobal().pendingDisplaySourceIds;
		const id = event.sender.id;
		if (!sources.has(id))
			event.sender.once('destroyed', () => sources.delete(id));
		sources.set(id, typeof sourceId === 'string' ? sourceId : '');
	});

	ipcMain.handle(IpcEvents.GetVirtualDisplayCount, async () => {
		return getAltronScreenGlobal().virtualDisplayService.getActiveDisplayCount();
	});

	ipcMain.handle(IpcEvents.AddVirtualDisplay, async () => {
		const altronscreenGlobal = getAltronScreenGlobal();
		const virtualDisplayService = altronscreenGlobal.virtualDisplayService;

		if (!virtualDisplayService.isSupported().supported) {
			return { ok: false, reason: 'unsupported-platform' };
		}

		// If the driver is not installed yet, install it synchronously so we can
		// report the real result back to the UI.
		if (!virtualDisplayService.isSupported().driverInstalled) {
			const installResult = await installVirtualDisplayDriverSync(
				altronscreenGlobal.appPath,
			);

			if (installResult.ok) {
				// Driver is now present; fall through to add a display below.
			} else {
				return {
					ok: false,
					reason: 'driver-install-failed',
					message: installResult.message,
				};
			}
		}

		// Driver present: add one more virtual display.
		const currentCount = await virtualDisplayService.getActiveDisplayCount();
		if (currentCount >= 16) {
			return {
				ok: false,
				message: 'The maximum of 16 virtual screens has been reached.',
			};
		}
		const nextCount = (Number.isFinite(currentCount) ? currentCount : 0) + 1;
		const previousDisplayCount = screen.getAllDisplays().length;

		const saved = getVirtualDisplayResolution();
		const width = saved.width;
		const height = saved.height;

		const ok = await virtualDisplayService.setDisplayCount(nextCount, {
			width,
			height,
			refreshHz: 60,
		});

		if (!ok) {
			return {
				ok: false,
				reason: 'driver-not-available',
				message:
					'Virtual Display Driver is installed but the display could not be created.',
			};
		}

		// A config update is not proof Windows activated another monitor.
		const deadline = Date.now() + 10000;
		while (
			screen.getAllDisplays().length <= previousDisplayCount &&
			Date.now() < deadline
		) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		await altronscreenGlobal.desktopCapturerSourcesService.refreshDesktopCapturerSources();
		if (screen.getAllDisplays().length <= previousDisplayCount) {
			return {
				ok: false,
				message:
					'Windows did not activate the new screen. Run AltronScreen as administrator and try again.',
			};
		}

		return { ok: true, count: nextCount };
	});

	ipcMain.handle(
		IpcEvents.SetVirtualDisplayCount,
		async (_, request: { count: number; width?: number; height?: number }) => {
			const altronscreenGlobal = getAltronScreenGlobal();
			const virtualDisplayService = altronscreenGlobal.virtualDisplayService;

			if (!virtualDisplayService.isSupported().supported) {
				return { ok: false, reason: 'unsupported-platform' };
			}

			const saved = getVirtualDisplayResolution();
			const width = request?.width ?? saved.width;
			const height = request?.height ?? saved.height;

			const ok = await virtualDisplayService.setDisplayCount(
				request?.count ?? 0,
				{
					width,
					height,
					refreshHz: 60,
				},
			);

			// Give the OS a moment to register/remove monitors, then refresh.
			await new Promise((resolve) => setTimeout(resolve, 1500));
			await altronscreenGlobal.desktopCapturerSourcesService.refreshDesktopCapturerSources();

			return { ok, reason: ok ? undefined : 'driver-not-available' };
		},
	);

	ipcMain.handle(IpcEvents.OpenVirtualDisplayDriverInstaller, () => {
		if (process.platform !== 'win32') {
			shell.openExternal(
				'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/latest',
			);
			return { ok: true, method: 'external' };
		}

		const appPath = getAltronScreenGlobal().appPath;
		const installerCandidates = [
			path.join(
				process.resourcesPath ?? '',
				'driver',
				'install-virtual-display-driver.bat',
			),
			path.join(appPath, 'driver', 'install-virtual-display-driver.bat'),
			path.join(
				appPath,
				'..',
				'resources',
				'driver',
				'install-virtual-display-driver.bat',
			),
			path.join(
				process.cwd(),
				'resources',
				'driver',
				'install-virtual-display-driver.bat',
			),
		];

		for (const installer of installerCandidates) {
			try {
				if (fs.existsSync(installer)) {
					// Launch elevated so Windows shows a UAC prompt and the
					// driver install is allowed to proceed. The bundled script
					// also self-elevates, but doing it here guarantees the
					// prompt appears even if the script is opened directly.
					launchInstallerElevated(installer);
					return { ok: true, method: 'bundled' };
				}
			} catch {
				// try next candidate
			}
		}

		shell.openExternal(
			'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/latest',
		);
		return { ok: true, method: 'external' };
	});

	ipcMain.handle(IpcEvents.GetIsFirstTimeAppStart, () => {
		if (store.has(ElectronStoreKeys.IsNotFirstTimeAppStart)) {
			return false;
		}
		return true;
	});

	ipcMain.handle(IpcEvents.SetAppStartedOnce, () => {
		if (store.has(ElectronStoreKeys.IsNotFirstTimeAppStart)) {
			store.delete(ElectronStoreKeys.IsNotFirstTimeAppStart);
		}
		store.set(ElectronStoreKeys.IsNotFirstTimeAppStart, 'true');
	});

	ipcMain.handle(IpcEvents.GetAppLanguage, () => {
		if (store.has(ElectronStoreKeys.AppLanguage)) {
			return store.get(ElectronStoreKeys.AppLanguage);
		}
		return 'en';
	});

	ipcMain.handle(IpcEvents.DestroySharingSessionById, (_, id) => {
		const global = getAltronScreenGlobal();
		const wasPending =
			global.sharingSessionService.waitingForConnectionSharingSession?.id ===
			id;
		global.connectedDevicesService.removePendingDevice(id);
		if (
			getAltronScreenGlobal().sharingSessionService
				.waitingForConnectionSharingSession?.id === id
		) {
			getAltronScreenGlobal().sharingSessionService.waitingForConnectionSharingSession =
				null;
		}
		const sharingSession =
			getAltronScreenGlobal().sharingSessionService.sharingSessions.get(id);
		if (sharingSession)
			void global.connectedDevicesService.disconnectDeviceByID(
				sharingSession.deviceID,
			);
		sharingSession?.setStatus(SharingSessionStatusEnum.DESTROYED);
		sharingSession?.destroy();
		getAltronScreenGlobal().sharingSessionService.sharingSessions.delete(id);
		if (wasPending) showNextPendingConnection();
	});

	ipcMain.handle(IpcEvents.OpenExternalLink, (_, url: string) => {
		if (typeof url !== 'string') {
			return;
		}
		shell.openExternal(url);
	});

	ipcMain.handle(IpcEvents.WriteTextToClipboard, (_, text) => {
		clipboard.writeText(text);
	});

	ipcMain.handle(IpcEvents.CheckScreenRecordingPermission, () => {
		return checkScreenRecordingPermission();
	});

	ipcMain.handle(IpcEvents.RelaunchApp, () => {
		app.relaunch();
		app.exit(0);
	});
};

/**
 * Launch the bundled driver installer with administrator privileges so the
 * Windows UAC prompt appears and the driver install is permitted. Falls back to
 * a normal launch if elevation fails (e.g. the user dismisses UAC).
 */
function launchInstallerElevated(installerPath: string): void {
	const quotedPath = installerPath.replace(/'/g, "''");
	const command = `Start-Process -FilePath '${quotedPath}' -Verb RunAs`;

	try {
		const child = spawn(
			'powershell.exe',
			[
				'-NoProfile',
				'-ExecutionPolicy',
				'Bypass',
				'-WindowStyle',
				'Hidden',
				'-Command',
				command,
			],
			{ windowsHide: true, detached: true, stdio: 'ignore' },
		);
		child.on('error', () => {
			void shell.openPath(installerPath);
		});
		child.unref();
	} catch {
		void shell.openPath(installerPath);
	}
}

function resolveDriverScript(appPath: string, name: string): string | null {
	const candidates = [
		path.join(process.resourcesPath ?? '', 'driver', name),
		path.join(appPath, 'driver', name),
		path.join(appPath, '..', 'resources', 'driver', name),
		path.join(process.cwd(), 'resources', 'driver', name),
	];
	return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/**
 * Run the bundled VDD installer synchronously and report the real result. If
 * the app is not elevated, re-run it elevated and wait for it to finish. The
 * installer prints a `RESULT:OK:...` / `RESULT:FAIL:...` line we parse.
 */
let driverInstallation: Promise<{ ok: boolean; message: string }> | null = null;

export function installVirtualDisplayDriverSync(
	appPath: string,
): Promise<{ ok: boolean; message: string }> {
	if (driverInstallation) return driverInstallation;
	driverInstallation = runVirtualDisplayDriverInstall(appPath).finally(() => {
		driverInstallation = null;
	});
	return driverInstallation;
}

function runVirtualDisplayDriverInstall(
	appPath: string,
): Promise<{ ok: boolean; message: string }> {
	return new Promise((resolve) => {
		const script = resolveDriverScript(appPath, 'install-vdd.ps1');
		if (!script) {
			resolve({
				ok: false,
				message:
					'Driver installer script was not found. Please download the Virtual Display Driver manually.',
			});
			return;
		}

		const isElevated = ((): boolean => {
			if (process.platform !== 'win32') return true;
			try {
				const r = spawnSync('net', ['session'], { stdio: 'ignore' });
				return r.status === 0;
			} catch {
				return false;
			}
		})();

		const runInstall = (elevated: boolean) => {
			const args = [
				'-NoProfile',
				'-ExecutionPolicy',
				'Bypass',
				'-File',
				script,
			];

			const result = spawnSync('powershell.exe', args, {
				encoding: 'utf8',
				windowsHide: true,
				timeout: 120000,
			});

			const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

			if (elevated && output.includes('Access is denied')) {
				resolve({
					ok: false,
					message:
						'Administrator rights were denied. Close the app and run it as administrator, then try again.',
				});
				return;
			}

			const okLine = output
				.split(/\r?\n/)
				.find((line) => line.includes('RESULT:'));

			if (okLine && okLine.includes('RESULT:OK')) {
				resolve({ ok: true, message: 'Driver installed.' });
				return;
			}

			if (okLine && okLine.includes('RESULT:FAIL')) {
				const detail = okLine.split(':').slice(2).join(':') || 'unknown error';
				resolve({ ok: false, message: `Driver install failed: ${detail}` });
				return;
			}

			resolve({
				ok: false,
				message:
					'Driver install did not complete. See install-log.txt in %TEMP%\\AltronScreenVDD.',
			});
		};

		if (isElevated) {
			runInstall(true);
		} else {
			// Not elevated: relaunch elevated and wait for completion. We detect
			// whether the driver DLL now exists to determine success.
			const scriptPath = script.replace(/'/g, "''");
			spawnSync(
				'powershell.exe',
				[
					'-NoProfile',
					'-ExecutionPolicy',
					'Bypass',
					'-Command',
					`Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}' -Verb RunAs -Wait`,
				],
				{ windowsHide: true, stdio: 'ignore', timeout: 150000 },
			);
			const installed =
				getAltronScreenGlobal().virtualDisplayService.isDriverInstalledSync();
			resolve({
				ok: installed,
				message: installed
					? 'Driver installed.'
					: 'Driver install did not complete. Check %TEMP%\\AltronScreenVDD\\install-log.txt.',
			});
		}
	});
}

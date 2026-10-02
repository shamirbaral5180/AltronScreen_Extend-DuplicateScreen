// override console early to catch all logs
import {
	overrideGlobalConsole,
	startConsoleRateLimiting,
} from '../common/rateLimitedConsole';
overrideGlobalConsole();
startConsoleRateLimiting();

import {
	app,
	shell,
	BrowserWindow,
	session,
	desktopCapturer,
	screen,
	webContents,
} from 'electron';
import { join } from 'path';
import { is, optimizer } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';
import { existsSync } from 'node:fs';
import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Asynchronous elevation check. Uses `net session`, which succeeds only when
 * the process has administrator rights. Kept async so startup never blocks the
 * main thread (and therefore the first UI paint) while it runs.
 */
const isProcessElevated = async (): Promise<boolean> => {
	if (process.platform !== 'win32') {
		return true;
	}
	try {
		await execFileAsync('net', ['session'], { windowsHide: true });
		return true;
	} catch {
		return false;
	}
};

/**
 * Relaunch the current executable with administrator rights (UAC prompt).
 * Portable builds run from a temp-extracted inner exe; electron-builder
 * exposes the real launcher via PORTABLE_EXECUTABLE_FILE, so we prefer that.
 * A `--elevated` marker prevents a relaunch loop. Returns true when the
 * elevated relaunch was initiated, false when the user declines or it fails.
 */
const relaunchElevated = (): boolean => {
	try {
		const portableLauncher = process.env.PORTABLE_EXECUTABLE_FILE;
		const target = (portableLauncher || process.execPath).replace(/'/g, "''");
		// Synchronous so a UAC cancellation (non-zero exit) is detectable.
		execSync(
			`powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '${target}' -ArgumentList '--elevated' -Verb RunAs"`,
			{ stdio: 'ignore', windowsHide: true },
		);
		return true;
	} catch (error) {
		// User declined the UAC prompt or elevation failed; keep running.
		console.error('elevation was not granted', error);
		return false;
	}
};
// function createWindow(): void {
//   // Create the browser window.
//   const mainWindow = new BrowserWindow({
//     width: 900,
//     height: 670,
//     show: false,
//     autoHideMenuBar: true,
//     ...(process.platform === 'linux' ? { icon } : {}),
//     webPreferences: {
//       preload: join(__dirname, '../preload/index.js'),
//       sandbox: false,
//     },
//   });
//
//   mainWindow.on('ready-to-show', () => {
//     mainWindow.show();
//   });
//
//   mainWindow.webContents.setWindowOpenHandler((details) => {
//     shell.openExternal(details.url);
//     return { action: 'deny' };
//   });
//
//   // HMR for renderer base on electron-vite cli.
//   // Load the remote URL for development or the local html file for production.
//   if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
//     mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
//   } else {
//     mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
//   }
// }
//
// // This method will be called when Electron has finished
// // initialization and is ready to create browser windows.
// // Some APIs can only be used after this event occurs.
// app.whenReady().then(() => {
//   // Set app user model id for windows
//   electronApp.setAppUserModelId('com.altronscreen');
//
//   // Default open or close DevTools by F12 in development
//   // and ignore CommandOrControl + R in production.
//   app.on('browser-window-created', (_, window) => {
//     optimizer.watchWindowShortcuts(window);
//   });
//
//   // IPC test
//   ipcMain.on('ping', () => console.log('pong'));
//
//   createWindow();
//
//   app.on('activate', function () {
//     // On macOS it's common to re-create a window in the app when the
//     // dock icon is clicked and there are no other windows open.
//     if (BrowserWindow.getAllWindows().length === 0) createWindow();
//   });
// });
//
// // Quit when all windows are closed, except on macOS. There, it's common
// // for applications and their menu bar to stay active until the user quits
// // explicitly with Cmd + Q.
// app.on('window-all-closed', () => {
//   if (process.platform !== 'darwin') {
//     app.quit();
//   }
// });

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// import path from 'path';
// import { app, BrowserWindow } from 'electron';
import { store } from '../common/altronscreen-electron-store';
// import i18n from './i18next.config';
import i18n from './configs/i18next.config';
import { signalingServer } from '../server';
import MenuBuilder from './menu';
import installExtensions from './utils/installExtensions';
import {
	initIpcMainHandlers,
	installVirtualDisplayDriverSync,
} from './helpers/ipcMainHandlers';
import { initGlobals } from './helpers/initGlobals';
import { getAltronScreenGlobal } from './helpers/getAltronScreenGlobal';
import { ElectronStoreKeys } from '../common/ElectronStoreKeys.enum';
import { startLogBufferCleanup } from './utils/LoggerWithFilePrefix';

const resolvePreloadScriptPath = (
	entry: 'index' | 'helperRenderer',
): string => {
	const baseDir = join(__dirname, '../preload');
	const candidates = [`${entry}.js`, `${entry}.mjs`, `${entry}.cjs`];
	for (const fileName of candidates) {
		const fullPath = join(baseDir, fileName);
		if (existsSync(fullPath)) {
			return fullPath;
		}
	}
	return join(baseDir, `${entry}.js`);
};

export default class AltronScreenApp {
	mainWindow: BrowserWindow | null = null;

	menuBuilder: MenuBuilder | null = null;

	initElectronAppObject(): void {
		/**
		 * Add event listeners...
		 */
		app.on('window-all-closed', () => {
			// TODO: when app will be set to auto start on login, this will be not required,
			// TODO: the app will run until user didn't kill it in system tray
			// Respect the OSX convention of having the application in memory even
			// after all windows have been closed
			if (process.platform !== 'darwin') {
				app.quit();
			}
		});

		app.whenReady().then(async () => {
			app.setAppUserModelId('com.altronscreen.app');
			if (process.platform === 'darwin') {
				app.setActivationPolicy('regular');
			}

			// start log buffer cleanup to prevent memory bloat
			startLogBufferCleanup();

			this.setupDisplayMediaHandler();

			// Record the physical display count before any virtual display is
			// created, so shutdown can reliably detect a lingering monitor even
			// when the driver's XML count says 0.
			const global = getAltronScreenGlobal();
			global.virtualDisplayService.setPhysicalDisplayBaseline(
				screen.getAllDisplays().length,
			);

			// Create and show the window first so the UI appears immediately.
			await this.createWindow();

			// Then run everything else in the background. None of this blocks the
			// first paint: the driver check uses synchronous OS queries internally,
			// so it must never run before the window is visible.
			this.startBackgroundTasks();
		});

		app.on('browser-window-created', (_, window) => {
			optimizer.watchWindowShortcuts(window);
		});

		// Remove any virtual monitor created for screen extension so the host
		// does not keep a phantom monitor after the app exits.
		//
		// Order is critical: a display device cycle is required to actually
		// remove the monitor, but cycling while WebRTC captures are active
		// deadlocks the display stack and freezes the desktop. So we stop every
		// capture first, wait for the duplication handles to release, then apply
		// the removal. When no virtual monitor was activated, this returns fast.
		let displayCleanupStarted = false;
		let quitAfterCleanup = false;
		app.on('before-quit', (event) => {
			const global = getAltronScreenGlobal();
			global.lanDiscoveryService.stop();
			if (quitAfterCleanup) return;
			event.preventDefault();
			if (displayCleanupStarted) return;
			displayCleanupStarted = true;
			void (async () => {
				const service = global.virtualDisplayService;
				const hasVirtual = await service.hasActiveVirtualDisplay(
					screen.getAllDisplays().length,
				);
				global.rendererWebrtcHelpersService.closeAll();
				if (!hasVirtual) return;
				await new Promise((resolve) => setTimeout(resolve, 800));
				await service.destroyDisplaySilently();
			})()
				.catch(() => undefined)
				.finally(() => {
					quitAfterCleanup = true;
					app.quit();
				});
		});

		app.on('activate', (e) => {
			e.preventDefault();
			// On macOS it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			if (this.mainWindow === null) {
				this.createWindow();
			}
		});

		app.commandLine.appendSwitch(
			'webrtc-max-cpu-consumption-percentage',
			'100',
		);

		// AltronScreen streams directly to a browser on the same LAN. Chromium
		// hides host IPs behind resolvable-only-on-the-host mDNS `.local`
		// candidates, so the viewer (especially Safari/Firefox, which do not
		// resolve mDNS) never learns the host's real LAN IP and ICE fails with
		// a WebRTC error. Exposing host candidates gives instant direct
		// connections with minimal latency and no external relay.
		const disabledFeatures = ['WebRtcHideLocalIpsWithMdns'];
		if (process.platform === 'win32') {
			// WGC can fail with access denied in elevated apps. Keep DXGI/GDI
			// capture for physical/virtual screens and application windows.
			disabledFeatures.push('AllowWgcScreenCapturer', 'AllowWgcWindowCapturer');
		}
		const existingDisabledFeatures =
			app.commandLine.getSwitchValue('disable-features');
		if (existingDisabledFeatures) {
			disabledFeatures.push(existingDisabledFeatures);
		}
		app.commandLine.appendSwitch(
			'disable-features',
			disabledFeatures.join(','),
		);
	}

	/**
	 * Grant the desktop-capture stream requested by the hidden WebRTC helper
	 * renderer. Modern Electron removed the legacy
	 * getUserMedia({ chromeMediaSource }) API, so we route getDisplayMedia()
	 * through this handler and resolve the previously selected source id.
	 */
	private async setupDisplayMediaHandler(): Promise<void> {
		session.defaultSession.setDisplayMediaRequestHandler(
			async (request, callback) => {
				try {
					const contents = request.frame
						? webContents.fromFrame(request.frame)
						: null;
					const pendingSourceId =
						contents &&
						getAltronScreenGlobal().pendingDisplaySourceIds.get(contents.id);

					if (pendingSourceId) {
						const sources = await desktopCapturer.getSources({
							types: ['screen', 'window'],
						});
						const source = sources.find((s) => s.id === pendingSourceId);
						if (source) {
							callback({ video: source });
							return;
						}
					}
				} catch (error) {
					console.error('failed to resolve display source', error);
				}
				// Do not silently share another monitor when the selected source disappears.
				callback({});
			},
		);
	}

	/**
	 * Run startup work that is not needed for the first paint. Kept off the
	 * critical path so the UI shows immediately; each step is independent and
	 * failures are logged without blocking.
	 */
	private startBackgroundTasks(): void {
		// Start the LAN signaling server once the UI is up. It binds a socket
		// and reads local storage, so it must not run before the first paint.
		void signalingServer.start().catch((error) => {
			console.error('failed to start signaling server', error);
		});

		// Virtual display driver availability (Windows only). The internal check
		// runs synchronous OS queries, so it is deferred until after the window
		// is visible.
		setTimeout(() => {
			void this.ensureVirtualDisplayDriver();
		}, 0).unref?.();
	}

	/**
	 * Check whether the virtual display driver is installed; if not, launch the
	 * bundled installer (elevated) so the driver downloads and installs in the
	 * background rather than when the user first clicks "Extend Screen".
	 */
	private async ensureVirtualDisplayDriver(): Promise<void> {
		if (process.platform !== 'win32') {
			return;
		}

		const virtualDisplayService = getAltronScreenGlobal().virtualDisplayService;
		if (!virtualDisplayService) {
			return;
		}

		try {
			// Async check keeps the main thread free while pnputil runs.
			const installed = await virtualDisplayService.isDriverInstalled();
			if (installed) {
				return;
			}

			const result = await installVirtualDisplayDriverSync(
				getAltronScreenGlobal().appPath,
			);
			if (!result.ok)
				console.error('Virtual display driver install failed:', result.message);
		} catch (error) {
			console.error('failed to check virtual display driver', error);
		}
	}

	async createWindow(): Promise<void> {
		if (
			process.env.NODE_ENV === 'development' ||
			process.env.DEBUG_PROD === 'true'
		) {
			await installExtensions();
		}

		this.mainWindow = new BrowserWindow({
			show: false,
			backgroundColor: '#ffffff',
			width: 940,
			height: 640,
			minHeight: 460,
			minWidth: 640,
			titleBarStyle: 'hiddenInset',
			frame: process.platform === 'darwin' ? false : true,
			useContentSize: true,
			title: 'AltronScreen',
			// useContentSize: true,
			autoHideMenuBar: true,
			...(process.platform === 'linux' ? { icon } : {}),
			webPreferences: {
				preload: resolvePreloadScriptPath('index'),
				sandbox: false,
			},
		});

		// this.mainWindow.loadURL(`file://${__dirname}/app.html`);

		// Show the window as soon as the first paint is ready. A short fallback
		// also shows it if ready-to-show is delayed, so a slow background task
		// can never keep the UI hidden.
		const showWindow = (): void => {
			if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
			if (process.env.START_MINIMIZED === 'true') {
				this.mainWindow.minimize();
			} else {
				this.mainWindow.show();
				this.mainWindow.focus();
			}
		};
		this.mainWindow.once('ready-to-show', showWindow);
		setTimeout(showWindow, 1200).unref?.();

		this.mainWindow.webContents.setWindowOpenHandler((details) => {
			shell.openExternal(details.url);
			return { action: 'deny' };
		});

		// HMR for renderer base on electron-vite cli.
		// Load the remote URL for development or the local html file for production.
		if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
			this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
		} else {
			this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
		}

		this.mainWindow.on('closed', () => {
			this.mainWindow = null;
			// TODO: when app will be set to auto start on login, this will be not required,
			// TODO: the app will run until user didn't kill it in system tray
			if (process.platform !== 'darwin') {
				app.quit();
			}
		});

		if (process.env.NODE_ENV === 'dev') {
			this.mainWindow.webContents.toggleDevTools();
		}

		this.menuBuilder = new MenuBuilder(this.mainWindow, i18n);
		this.menuBuilder.buildMenu();

		this.initI18n();

		initIpcMainHandlers(this.mainWindow);
	}

	initI18n(): void {
		i18n.on('loaded', () => {
			i18n.changeLanguage('en');
			i18n.off('loaded');
		});

		i18n.on('languageChanged', (lng) => {
			if (this.mainWindow === null) return;
			this.menuBuilder = new MenuBuilder(this.mainWindow, i18n);
			this.menuBuilder.buildMenu();
			setTimeout(async () => {
				if (lng !== 'en' && i18n.language !== lng) {
					i18n.changeLanguage(lng);
					if (store.has(ElectronStoreKeys.AppLanguage)) {
						store.delete(ElectronStoreKeys.AppLanguage);
					}
					store.set(ElectronStoreKeys.AppLanguage, lng);
				}
			}, 400);
		});
	}

	start(): void {
		// Single-instance lock is fast and synchronous; do it first so a second
		// launch cannot create a duplicate window.
		const gotTheLock = app.requestSingleInstanceLock();
		if (!gotTheLock) {
			app.quit();
			return;
		}

		// Handle second instance attempts (e.g., clicking the taskbar icon on
		// Windows) before any slower startup work.
		app.on('second-instance', () => {
			if (this.mainWindow) {
				if (this.mainWindow.isMinimized()) {
					this.mainWindow.restore();
				}
				this.mainWindow.focus();
				this.mainWindow.show();
			}
		});

		const cliLocalIp = this.parseCliLocalIp();
		initGlobals(join(__dirname, '..'), cliLocalIp);

		// Build the UI first; start the signaling server in the background once
		// the app is ready. This keeps the first paint fast.
		this.initElectronAppObject();

		// On Windows, request administrator rights so the virtual display driver
		// can be managed. The check is async so it never delays the UI; if
		// elevation is needed the app relaunches and this instance exits.
		void this.ensureElevated();
	}

	/**
	 * On Windows packaged builds, relaunch elevated when not already elevated.
	 * Runs off the startup critical path so the window can appear immediately.
	 */
	private async ensureElevated(): Promise<void> {
		if (process.platform !== 'win32' || !app.isPackaged) {
			return;
		}
		if (process.argv.includes('--elevated')) {
			return;
		}
		if (await isProcessElevated()) {
			return;
		}
		if (relaunchElevated()) {
			app.quit();
		}
	}

	private parseCliLocalIp(): string | undefined {
		const args = process.argv;
		const localIpIndex = args.findIndex(
			(arg) => arg === '--local-ip' || arg === '--ip',
		);
		if (localIpIndex !== -1 && localIpIndex + 1 < args.length) {
			const ip = args[localIpIndex + 1];
			if (ip && !ip.startsWith('--')) {
				return ip;
			}
		}
		return undefined;
	}
}

export const altronscreenApp = new AltronScreenApp();
altronscreenApp.start();

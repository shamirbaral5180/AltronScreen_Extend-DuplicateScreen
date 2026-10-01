import { join } from 'path';
import { BrowserWindow } from 'electron';
import { is } from '@electron-toolkit/utils';
import { existsSync } from 'node:fs';

type RendererHelperWebcontentsID = number;

export default class RendererWebrtcHelpersService {
	helpers: Map<RendererHelperWebcontentsID, BrowserWindow>;
	appPath: string;

	constructor(_appPath: string) {
		this.helpers = new Map<RendererHelperWebcontentsID, BrowserWindow>();
		this.appPath = _appPath;
	}

	private resolvePreloadScriptPath(entry: 'index' | 'helperRenderer'): string {
		const baseDir = join(__dirname, '../preload');
		const candidates = [`${entry}.js`, `${entry}.mjs`, `${entry}.cjs`];
		for (const fileName of candidates) {
			const fullPath = join(baseDir, fileName);
			if (existsSync(fullPath)) {
				return fullPath;
			}
		}
		return join(baseDir, `${entry}.js`);
	}

	createPeerConnectionHelperRenderer(): BrowserWindow {
		let helperRendererWindow: BrowserWindow | null = null;

		helperRendererWindow = new BrowserWindow({
			show: is.dev, // show in dev only
			webPreferences: {
				backgroundThrottling: false,
				preload: this.resolvePreloadScriptPath('helperRenderer'),
				// contextIsolation: true,
				// nodeIntegration: true,
				nodeIntegration: true,
				nodeIntegrationInSubFrames: true,
				nodeIntegrationInWorker: true,
				sandbox: false,
			},
		});

		helperRendererWindow.loadURL(
			`file://${this.appPath}/renderer/peerConnectionHelperRendererWindowIndex.html`,
		);

		helperRendererWindow.webContents.on('did-finish-load', () => {
			if (!helperRendererWindow) {
				throw new Error('"helperRendererWindow" is not defined');
			}
			helperRendererWindow.webContents.send('start-peer-connection');
		});

		const helperId = helperRendererWindow.webContents.id;
		// cleanup tracking map on close to prevent memory leaks
		helperRendererWindow.on('closed', () => {
			this.helpers.delete(helperId);
			helperRendererWindow = null;
		});

		this.helpers.set(helperId, helperRendererWindow);

		if (process.env.NODE_ENV === 'dev') {
			helperRendererWindow.webContents.toggleDevTools();
		}
		// helperRendererWindow.webContents.toggleDevTools();

		return helperRendererWindow;
	}
}

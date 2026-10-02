/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { desktopCapturer, DesktopCapturerSource } from 'electron';
import Logger from '../../main/utils/LoggerWithFilePrefix';
import DesktopCapturerSourceType from '../../common/DesktopCapturerSourceType';
import isLinuxWaylandSession from '../../main/utils/isLinuxWaylandSession';

export interface DesktopCapturerSourceWithType {
	source: import('electron').DesktopCapturerSource;
	type: import('../../common/DesktopCapturerSourceType').default;
}

export function getSourceTypeFromSourceID(
	id: string,
): DesktopCapturerSourceType {
	if (id.includes(DesktopCapturerSourceType.SCREEN)) {
		return DesktopCapturerSourceType.SCREEN;
	}
	return DesktopCapturerSourceType.WINDOW;
}

type SourcesDisappearListener = (ids: string[]) => void;
type SharingSessionID = string;

class DesktopCapturerSourcesService {
	sources: Map<string, DesktopCapturerSourceWithType>;

	lastAvailableScreenIDs: string[];

	lastAvailableWindowIDs: string[];

	onWindowClosedListeners: Map<SharingSessionID, SourcesDisappearListener[]>;

	onScreenDisconnectedListeners: Map<
		SharingSessionID,
		SourcesDisappearListener[]
	>;

	log = new Logger(__filename);

	autoRefreshEnabled: boolean;

	refreshPromise: Promise<void> | null;

	portalSelectionPromise: Promise<DesktopCapturerSource | null> | null;

	constructor() {
		this.sources = new Map<string, DesktopCapturerSourceWithType>();
		this.lastAvailableScreenIDs = [];
		this.lastAvailableWindowIDs = [];
		this.onWindowClosedListeners = new Map<
			SharingSessionID,
			SourcesDisappearListener[]
		>();
		this.onScreenDisconnectedListeners = new Map<
			SharingSessionID,
			SourcesDisappearListener[]
		>();
		this.autoRefreshEnabled = !isLinuxWaylandSession;
		this.refreshPromise = null;
		this.portalSelectionPromise = null;

		if (this.autoRefreshEnabled) {
			this.startRefreshDesktopCapturerSourcesLoop();
		} else {
			this.log.debug(
				'skipping desktop capturer auto refresh on wayland session',
			);
		}
		this.startPollForInactiveListenersLoop();
	}

	getSourcesMap(): Map<string, DesktopCapturerSourceWithType> {
		return this.sources;
	}

	startRefreshDesktopCapturerSourcesLoop(): void {
		if (!this.autoRefreshEnabled) {
			return;
		}
		setInterval(() => {
			this.refreshDesktopCapturerSources();
		}, 5000);
	}

	getScreenSources(): DesktopCapturerSource[] {
		const screenSources: DesktopCapturerSource[] = [];
		[...this.sources.keys()].forEach((key) => {
			const source = this.sources.get(key);
			if (!source) return;
			if (source.type === DesktopCapturerSourceType.SCREEN) {
				screenSources.push(source.source);
			}
		});
		return screenSources;
	}

	getAppWindowSources(): DesktopCapturerSource[] {
		const appWindowSources: DesktopCapturerSource[] = [];
		[...this.sources.keys()].forEach((key) => {
			const source = this.sources.get(key);
			if (!source) return;
			if (source.type !== DesktopCapturerSourceType.WINDOW) return;
			// Never list AltronScreen's own windows (the main window and the
			// hidden WebRTC helper renderer), which the user cannot meaningfully
			// share and which otherwise clutter the list.
			if (this.isOwnAppWindow(source.source.name)) return;
			appWindowSources.push(source.source);
		});
		return appWindowSources;
	}

	/**
	 * Whether a captured window is AltronScreen's internal WebRTC helper
	 * renderer. That window is hidden and exists only to run the capture
	 * pipeline, so it is never a meaningful share target. Kept intentionally
	 * narrow so ordinary application windows are unaffected.
	 */
	isOwnAppWindow(name: string | undefined): boolean {
		if (!name) return false;
		return name.toLowerCase().includes('electron helper renderer');
	}

	getSourceDisplayIDByDisplayCapturerSourceID(sourceID: string): string {
		let displayID = '';
		[...this.sources.keys()].forEach((key) => {
			const source = this.sources.get(key);
			if (!source) return;
			if (source.source.id === sourceID) {
				displayID = source.source.display_id;
			}
		});
		return displayID;
	}

	addWindowClosedListener(
		_sharingSessionID: string,
		_callback: SourcesDisappearListener,
	): void {
		// TODO: implement logic
	}

	addScreenDisconnectedListener(
		_sharingSessionID: string,
		_callback: SourcesDisappearListener,
	): void {
		// TODO: implement logic
	}

	async updateDesktopCapturerSources(): Promise<void> {
		const captured = await this.getSourcesWithFallback();
		const enumerated = new Map<string, DesktopCapturerSourceWithType>();
		captured.forEach((source) => {
			enumerated.set(source.id, {
				type: getSourceTypeFromSourceID(source.id),
				source,
			});
		});

		const windowCount = [...enumerated.values()].filter(
			(entry) => entry.type === DesktopCapturerSourceType.WINDOW,
		).length;
		const screenCount = [...enumerated.values()].filter(
			(entry) => entry.type === DesktopCapturerSourceType.SCREEN,
		).length;
		this.log.debug(
			`Captured sources: ${enumerated.size} (windows=${windowCount}, screens=${screenCount})`,
		);

		// Windows can transiently return an empty/partial window list (notably
		// right after startup or while the desktop is busy). Blanking the list
		// then leaves the user with nothing to pick and never recovers in that
		// dialog. Keep the last good window sources when a refresh yields none.
		if (windowCount === 0) {
			const previousWindows = [...this.sources.values()].filter(
				(entry) => entry.type === DesktopCapturerSourceType.WINDOW,
			);
			if (previousWindows.length > 0) {
				this.log.debug(
					`Window enumeration returned 0; keeping ${previousWindows.length} previously known windows.`,
				);
				previousWindows.forEach((entry) =>
					enumerated.set(entry.source.id, entry),
				);
			}
		}

		this.sources = enumerated;
	}

	async getDesktopCapturerSources(): Promise<
		Map<string, DesktopCapturerSourceWithType>
	> {
		const newSources = new Map<string, DesktopCapturerSourceWithType>();
		const capturerSources = await this.getSourcesWithFallback();
		capturerSources.forEach((source) => {
			newSources.set(source.id, {
				type: getSourceTypeFromSourceID(source.id),
				source,
			});
		});
		return newSources;
	}

	/**
	 * Enumerate capture sources with defensive fallbacks.
	 *
	 * On Windows, `desktopCapturer.getSources` can transiently return an empty
	 * list (or reject when `fetchWindowIcons` cannot extract an icon from a
	 * protected/UWP window), which would leave the share dialog with nothing to
	 * pick. We therefore retry the same request a few times before dropping the
	 * icon flag, and finally fall back to screens-only so the user can always
	 * share something.
	 */
	private async getSourcesWithFallback(): Promise<DesktopCapturerSource[]> {
		const withWindows: Parameters<typeof desktopCapturer.getSources>[0] = {
			types: [
				DesktopCapturerSourceType.WINDOW,
				DesktopCapturerSourceType.SCREEN,
			],
			thumbnailSize: { width: 500, height: 500 },
			fetchWindowIcons: true,
		};
		const withWindowsNoIcons: Parameters<typeof desktopCapturer.getSources>[0] =
			{
				...withWindows,
				fetchWindowIcons: false,
			};
		const screensOnly: Parameters<typeof desktopCapturer.getSources>[0] = {
			types: [DesktopCapturerSourceType.SCREEN],
			thumbnailSize: { width: 500, height: 500 },
			fetchWindowIcons: false,
		};

		// Retry the primary request a few times: a transient empty result is the
		// common failure mode, and a short retry usually resolves it.
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const sources = await this.tryGetSources(withWindows);
			if (sources && sources.some((s) => s.id.startsWith('window:'))) {
				return sources;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}

		// Icons unavailable for some window; retry without icons.
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const sources = await this.tryGetSources(withWindowsNoIcons);
			if (sources && sources.length > 0) return sources;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}

		// Last resort: at least offer the screens.
		return (await this.tryGetSources(screensOnly)) ?? [];
	}

	private async tryGetSources(
		options: Parameters<typeof desktopCapturer.getSources>[0],
	): Promise<DesktopCapturerSource[] | null> {
		try {
			return await desktopCapturer.getSources(options);
		} catch (error) {
			this.log.debug(
				`desktopCapturer.getSources failed (fetchWindowIcons=${options.fetchWindowIcons}, types=${options.types?.join('+')}): ${String(error)}`,
			);
			return null;
		}
	}

	async refreshDesktopCapturerSources(): Promise<void> {
		// TODO: implement get available sources logic here;
		if (this.refreshPromise) {
			return this.refreshPromise;
		}

		this.refreshPromise = (async () => {
			try {
				await this.updateDesktopCapturerSources();
				// eventually run checkers that emit events
				this.checkForClosedWindows();
				this.checkForScreensDisconnected();
			} catch (e) {
				this.log.error(e);
			} finally {
				this.refreshPromise = null;
			}
		})();

		return this.refreshPromise;
	}

	async requestPortalSource(
		types: DesktopCapturerSourceType[],
	): Promise<DesktopCapturerSource | null> {
		if (this.portalSelectionPromise) {
			return this.portalSelectionPromise;
		}

		this.portalSelectionPromise = (async () => {
			try {
				const sources = await desktopCapturer.getSources({
					types,
					thumbnailSize: { width: 500, height: 500 },
					fetchWindowIcons: types.includes(DesktopCapturerSourceType.WINDOW),
				});
				if (sources.length === 0) {
					return null;
				}
				const selectedSourcesMap = new Map<
					string,
					DesktopCapturerSourceWithType
				>(this.sources);
				const defaultType = types.length === 1 ? types[0] : undefined;

				sources.forEach((source) => {
					selectedSourcesMap.set(source.id, {
						type: defaultType ?? getSourceTypeFromSourceID(source.id),
						source,
					});
				});

				this.sources = selectedSourcesMap;

				return sources[0];
			} catch (error) {
				this.log.error(error);
				return null;
			} finally {
				this.portalSelectionPromise = null;
			}
		})();

		return this.portalSelectionPromise;
	}

	startPollForInactiveListenersLoop(): void {
		setInterval(
			() => {
				// TODO: implement logic
				// if session ID no longer exists in SharingSessionsService -> remove its listener object
			},
			1000 * 60 * 60,
		); // runs every hour in infinite loop
	}

	checkForClosedWindows(): void {
		// TODO: implement logic
		// const isSomeWindowsClosed = false;
		// const closedWindowsIDs: string[] = [];
		// if (isSomeWindowsClosed) {
		//   this.notifyOnWindowsClosedListeners(closedWindowsIDs);
		// }
	}

	notifyOnWindowsClosedListeners(_closedWindowsIDs: string[]): void {
		// TODO: implement logic
	}

	checkForScreensDisconnected(): void {
		// TODO: implement logic
		// const isSomeScreensDisconnected = false;
		// const disconnectedScreensIDs: string[] = [];
		// if (isSomeScreensDisconnected) {
		//   this.notifyOnScreensDisconnectedListeners(disconnectedScreensIDs);
		// }
	}

	notifyOnScreensDisconnectedListeners(
		_disconnectedScreensIDs: string[],
	): void {
		// TODO: implement logic
	}
}

export default DesktopCapturerSourcesService;

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Logger from '../../main/utils/LoggerWithFilePrefix';

export interface VirtualDisplayRequest {
	width: number;
	height: number;
	refreshHz?: number;
}

export interface VirtualDisplaySupport {
	supported: boolean;
	driverInstalled: boolean;
	platform: NodeJS.Platform;
	reason?: string;
}

export interface VirtualDisplayInfo {
	width: number;
	height: number;
	refreshHz: number;
}

const VDD_PIPE_PATH = '\\\\.\\pipe\\MTTVirtualDisplayPipe';

const VDD_CONFIG_CANDIDATES = [
	'C:\\VirtualDisplayDriver\\vdd_settings.xml',
	path.join(
		process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
		'VirtualDisplayDriver',
		'vdd_settings.xml',
	),
];

const COMMAND_TIMEOUT_MS = 4000;
const SHUTDOWN_TIMEOUT_MS = 1500;
const execFileAsync = promisify(execFile);

// Resolutions advertised to Windows for the virtual display. The first entry is
// the default. Writing several entries lets the user change the extended
// display's resolution from Windows Display Settings without recreating it.
const DEFAULT_VIRTUAL_DISPLAY_RESOLUTION = { width: 1360, height: 768 };
const VIRTUAL_DISPLAY_RESOLUTIONS: ReadonlyArray<{
	width: number;
	height: number;
}> = [
	DEFAULT_VIRTUAL_DISPLAY_RESOLUTION,
	{ width: 1920, height: 1080 },
	{ width: 1280, height: 720 },
	{ width: 2560, height: 1440 },
	{ width: 3840, height: 2160 },
];
export { DEFAULT_VIRTUAL_DISPLAY_RESOLUTION, VIRTUAL_DISPLAY_RESOLUTIONS };

/**
 * Controls a Windows virtual display through the Virtual Display Driver (VDD).
 *
 * The driver exposes a named pipe (`\\.\pipe\MTTVirtualDisplayPipe`) that
 * accepts plain-text UTF-16LE commands on a one-shot connection model: open,
 * write a single command, read the response, close.
 *
 * Monitor geometry is defined in `vdd_settings.xml`; the pipe only controls how
 * many monitors are active. We therefore write the requested resolution to the
 * config file (when writable) before activating a monitor, so the created
 * display matches the connecting viewer's resolution.
 *
 * Non-Windows platforms are reported as unsupported; macOS/Linux virtual
 * display backends are intentionally out of scope for this phase.
 */
export default class VirtualDisplayService {
	log = new Logger(__filename);

	private commandInFlight: Promise<string> | null = null;

	// Tracks whether this session actually activated a virtual monitor, so app
	// shutdown can skip all display work when nothing was created.
	private virtualDisplayActive = false;

	isSupported(): VirtualDisplaySupport {
		if (process.platform !== 'win32') {
			return {
				supported: false,
				driverInstalled: false,
				platform: process.platform,
				reason: 'virtual display is currently only supported on Windows',
			};
		}

		const driverInstalled = this.isDriverInstalledSync();

		return {
			supported: true,
			driverInstalled,
			platform: process.platform,
			reason: driverInstalled
				? undefined
				: 'Virtual Display Driver is not installed',
		};
	}

	/**
	 * Synchronous best-effort check for the presence of the VDD driver. The
	 * named pipe is created by the driver when its root device is active, so it
	 * is the most reliable signal that the driver is actually installed AND
	 * running. A stale DLL in System32 (e.g. from a partial install) is not
	 * enough — we also verify the device/pipe.
	 */
	isDriverInstalledSync(): boolean {
		if (process.platform !== 'win32') {
			return false;
		}

		// Primary signal: the named pipe exists while the driver device is
		// loaded, even before any virtual display is activated.
		try {
			if (fs.existsSync(VDD_PIPE_PATH)) {
				return true;
			}
		} catch {
			// fall through
		}

		// Secondary signal: the root device is present (via pnputil) AND the
		// UMDF DLL exists.
		const umdfDriverDll = path.join(
			process.env.SystemRoot ?? 'C:\\Windows',
			'System32',
			'drivers',
			'UMDF',
			'MttVDD.dll',
		);

		try {
			return fs.existsSync(umdfDriverDll) && this.isRootDevicePresentSync();
		} catch {
			return false;
		}
	}

	private isRootDevicePresentSync(): boolean {
		if (process.platform !== 'win32') {
			return false;
		}
		try {
			const result = spawnSync(
				'pnputil.exe',
				['/enum-devices', '/connected', '/deviceids'],
				{ encoding: 'utf8', windowsHide: true, timeout: 10000 },
			);
			const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
			return /Root\\MttVDD/i.test(output);
		} catch {
			return false;
		}
	}

	async ping(): Promise<boolean> {
		if (process.platform !== 'win32') {
			return false;
		}
		try {
			const response = await this.sendCommand('PING');
			return response.toUpperCase().includes('PONG');
		} catch (error) {
			this.log.debug(`VDD ping failed: ${String(error)}`);
			return false;
		}
	}

	async getActiveDisplayCount(): Promise<number> {
		if (process.platform !== 'win32') return 0;
		const configPath = this.resolveConfigPath();
		if (!configPath || !fs.existsSync(configPath)) return 0;
		// VDD persists SETDISPLAYCOUNT in XML; it has no GETDISPLAYCOUNT command.
		const xml = await fs.promises.readFile(configPath, 'utf8');
		const match = xml.match(/<monitors>\s*<count>\s*(\d+)\s*<\/count>/);
		if (!match)
			throw new Error('Virtual Display Driver monitor count is missing');
		return Number.parseInt(match[1], 10);
	}

	/**
	 * Create (or reconfigure) a single virtual monitor sized to the viewer's
	 * resolution. Returns true when the driver acknowledged the command.
	 */
	async createDisplay(request: VirtualDisplayRequest): Promise<boolean> {
		return this.setDisplayCount(1, request);
	}

	/**
	 * Create or reconfigure `count` virtual monitors. Used so the user can add
	 * more than one extended screen from Settings. Returns true on success.
	 */
	async setDisplayCount(
		count: number,
		request?: VirtualDisplayRequest,
		options: { restartDevice?: boolean } = {},
	): Promise<boolean> {
		if (process.platform !== 'win32') {
			this.log.debug('setDisplayCount skipped: unsupported platform');
			return false;
		}

		const targetCount = Math.max(0, Math.min(16, Math.round(count)));

		if (request) {
			const width = this.clampDimension(request.width, 640, 7680);
			const height = this.clampDimension(request.height, 480, 4320);
			const refreshHz = this.clampDimension(request.refreshHz ?? 60, 24, 360);
			await this.writeSettingsFile({ width, height, refreshHz });
		}

		try {
			const response = await this.sendCommand(
				`SETDISPLAYCOUNT ${targetCount}`,
				{
					allowReload: true,
				},
			);
			this.log.debug(
				`VDD SETDISPLAYCOUNT ${targetCount} response: ${response}`,
			);
			if (/failed|unknown command|error/i.test(response)) return false;
			if ((await this.getActiveDisplayCount()) !== targetCount) return false;
			if (targetCount > 0) {
				this.virtualDisplayActive = true;
			} else {
				this.virtualDisplayActive = false;
			}
			// Restarting the display device resets the whole display stack and can
			// freeze a live desktop, so it is opt-in only (the deliberate add-screen
			// flow). Removal and shutdown never restart the device; the driver's own
			// SETDISPLAYCOUNT reload is sufficient.
			if (options.restartDevice) {
				await execFileAsync(
					'pnputil.exe',
					['/restart-device', '/deviceid', 'Root\\MttVDD'],
					{ windowsHide: true, timeout: 15000 },
				);
			}
			if (targetCount > 0) {
				await execFileAsync('DisplaySwitch.exe', ['/extend'], {
					windowsHide: true,
					timeout: 15000,
				});
			}
			return true;
		} catch (error) {
			this.log.error(
				`VDD setDisplayCount(${targetCount}) failed: ${String(error)}`,
			);
			return false;
		}
	}

	/**
	 * Remove all virtual monitors without restarting the display device. Safe to
	 * call repeatedly; sends SETDISPLAYCOUNT 0 so no phantom monitor remains.
	 */
	async destroyDisplay(): Promise<boolean> {
		if (process.platform !== 'win32') {
			return false;
		}

		return this.setDisplayCount(0);
	}

	/**
	 * Best-effort cleanup on app shutdown. Does nothing when this session never
	 * activated a virtual monitor, and is bounded by a short timeout so quitting
	 * can never hang the desktop. Removal uses the soft (no device restart) path.
	 */
	async destroyDisplaySilently(): Promise<void> {
		if (process.platform !== 'win32') {
			return;
		}
		if (!this.virtualDisplayActive) {
			// The flag lives in memory only, so a display left active by an
			// earlier session would be missed. A quick local file read recovers
			// that case without touching the display device.
			try {
				if ((await this.getActiveDisplayCount()) <= 0) return;
			} catch {
				return;
			}
		}
		await Promise.race([
			this.destroyDisplay(),
			new Promise<void>((resolve) =>
				setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref?.(),
			),
		]).catch(() => undefined);
		this.virtualDisplayActive = false;
	}

	isActive(): boolean {
		return this.virtualDisplayActive;
	}

	private clampDimension(
		value: number | undefined,
		min: number,
		max: number,
	): number {
		if (!Number.isFinite(value)) {
			return min;
		}
		return Math.min(max, Math.max(min, Math.round(value as number)));
	}

	private resolveConfigPath(): string | null {
		if (process.platform !== 'win32') {
			return null;
		}

		for (const candidate of VDD_CONFIG_CANDIDATES) {
			try {
				if (fs.existsSync(candidate)) {
					return candidate;
				}
			} catch {
				// keep looking
			}
		}

		// Prefer the documented driver directory as the write target even when
		// the file does not exist yet; the write itself will surface whether we
		// have permission.
		return VDD_CONFIG_CANDIDATES[0];
	}

	private async writeSettingsFile(request: VirtualDisplayInfo): Promise<void> {
		const configPath = this.resolveConfigPath();
		if (!configPath) {
			return;
		}

		const count = await this.getActiveDisplayCount();
		const xml = this.buildSettingsXml(request, count);

		try {
			await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
			await fs.promises.writeFile(configPath, xml, 'utf8');
			this.log.debug(`VDD settings written to ${configPath}`);
		} catch (error) {
			this.log.debug(
				`unable to write VDD settings (${configPath}): ${String(error)}. ` +
					'The driver will fall back to its existing profile.',
			);
		}
	}

	/**
	 * Build the driver settings file. Several resolutions are advertised so the
	 * user can change the extended display's resolution from Windows Display
	 * Settings. The requested resolution is always listed first (and becomes the
	 * driver's default), followed by a standard set; duplicates are removed.
	 */
	private buildSettingsXml(request: VirtualDisplayInfo, count: number): string {
		const rates = [request.refreshHz, 60, 30]
			.filter((value, index, arr) => arr.indexOf(value) === index)
			.map((rate) => `      <g_refresh_rate>${rate}</g_refresh_rate>`)
			.join('\n');

		const seen = new Set<string>();
		const resolutions = [
			{ width: request.width, height: request.height },
			...VIRTUAL_DISPLAY_RESOLUTIONS,
		].filter(({ width, height }) => {
			const key = `${width}x${height}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		const resolutionXml = resolutions
			.map(
				({ width, height }) => `    <resolution>
      <width>${width}</width>
      <height>${height}</height>
      <refresh_rate>${request.refreshHz}</refresh_rate>
    </resolution>`,
			)
			.join('\n');

		return `<?xml version='1.0' encoding='utf-8'?>
<vdd_settings>
  <monitors>
    <count>${count}</count>
  </monitors>
  <global>
${rates}
  </global>
  <resolutions>
${resolutionXml}
  </resolutions>
</vdd_settings>
`;
	}

	private async sendCommand(
		command: string,
		options: { allowReload?: boolean } = {},
	): Promise<string> {
		const previous = this.commandInFlight;
		const promise = (async () => {
			// The driver serves one pipe client at a time; never reuse another command's response.
			await previous?.catch(() => undefined);
			return this.runCommand(command, options.allowReload ?? false);
		})();
		this.commandInFlight = promise;
		try {
			return await promise;
		} finally {
			if (this.commandInFlight === promise) {
				this.commandInFlight = null;
			}
		}
	}

	private runCommand(command: string, allowReload: boolean): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			let settled = false;
			const socket = net.connect(VDD_PIPE_PATH);
			let buffer = '';

			const finish = (error: Error | null, value?: string) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.destroy();
				if (error) {
					reject(error);
				} else {
					resolve(value ?? '');
				}
			};

			const timer = setTimeout(() => {
				finish(new Error(`VDD command "${command}" timed out`));
			}, COMMAND_TIMEOUT_MS);

			socket.on('connect', () => {
				// Raw UTF-16LE, message-mode pipe. A trailing NUL is tolerated by
				// the driver and improves compatibility across driver versions.
				const payload = Buffer.from(`${command}\0`, 'utf16le');
				socket.write(payload);
			});

			socket.on('data', (chunk) => {
				// PING and command logs are UTF-8; only GETSETTINGS uses UTF-16LE.
				buffer += chunk.toString(
					command === 'GETSETTINGS' ? 'utf16le' : 'utf8',
				);
			});

			socket.on('end', () => {
				finish(null, this.normalizeResponse(buffer));
			});

			socket.on('close', () => {
				finish(null, this.normalizeResponse(buffer));
			});

			socket.on('error', (error) => {
				finish(error);
			});

			if (allowReload) {
				// The driver reloads its display stack on count changes; allow the
				// connection a little extra time before considering it failed.
				timer.unref?.();
			}
		});
	}

	private normalizeResponse(raw: string): string {
		return raw.replace(/\0/g, '').trim();
	}
}

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
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
// Applying the topology change requires cycling the display device, which can
// take several seconds. Cleanup runs only after captures have stopped, so this
// cycle is safe; the timeout is the upper bound before we stop waiting.
const SHUTDOWN_TIMEOUT_MS = 15000;
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

	// Number of displays present before the app created any virtual display.
	private physicalDisplayBaseline: number | null = null;

	isSupported(): VirtualDisplaySupport {
		if (process.platform !== 'win32') {
			return {
				supported: false,
				driverInstalled: false,
				platform: process.platform,
				reason: 'virtual display is currently only supported on Windows',
			};
		}

		// Fast path only (pipe check). Callers that need a thorough check should
		// await isDriverInstalled(), which may run pnputil without blocking.
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
	 * Best-effort check that the driver is usable. The named pipe only exists
	 * while the root device is present and running, so it is the reliable
	 * runtime signal. The root-enumerated device can be removed (for example by
	 * a device restart), in which case the driver package or UMDF DLL may still
	 * be present; reporting "not installed" then lets the app recreate the
	 * device instead of silently failing.
	 */
	/**
	 * Fast, non-blocking check that the driver *package* is available. The
	 * device is intentionally removed on shutdown (the driver has no
	 * zero-monitor mode), so the device/pipe cannot be used as the "installed"
	 * signal — that would make the app re-download on every launch. The UMDF DLL
	 * and the named pipe both persist across device removal.
	 */
	isDriverInstalledSync(): boolean {
		if (process.platform !== 'win32') {
			return false;
		}

		try {
			if (fs.existsSync(VDD_PIPE_PATH)) {
				return true;
			}
		} catch {
			// fall through
		}

		const umdfDriverDll = path.join(
			process.env.SystemRoot ?? 'C:\\Windows',
			'System32',
			'drivers',
			'UMDF',
			'MttVDD.dll',
		);
		try {
			return fs.existsSync(umdfDriverDll);
		} catch {
			return false;
		}
	}

	/**
	 * Authoritative, non-blocking check that the driver package is installed and
	 * the device can be (re)created. Uses the pipe/DLL for a fast positive and
	 * falls back to enumerating the installed driver packages (device removal
	 * keeps the package, so this prevents a needless re-download).
	 */
	async isDriverInstalled(): Promise<boolean> {
		if (process.platform !== 'win32') {
			return false;
		}

		if (this.isDriverInstalledSync()) {
			return true;
		}

		try {
			const { stdout, stderr } = await execFileAsync(
				'pnputil.exe',
				['/enum-drivers'],
				{ encoding: 'utf8', windowsHide: true, timeout: 10000 },
			);
			return /mttvdd\.inf/i.test(`${stdout ?? ''}${stderr ?? ''}`);
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
	): Promise<boolean> {
		if (process.platform !== 'win32') {
			this.log.debug('setDisplayCount skipped: unsupported platform');
			return false;
		}

		const targetCount = Math.max(0, Math.min(16, Math.round(count)));

		// The driver reads the desired monitor count from vdd_settings.xml, and a
		// count of 0 is clamped to 1 (there is no zero-monitor mode). So the XML
		// count plus the presence of the root device fully determine the monitor
		// state: count>0 => device present, count==0 => device removed.
		const width = this.clampDimension(request?.width ?? 1360, 640, 7680);
		const height = this.clampDimension(request?.height ?? 768, 480, 4320);
		const refreshHz = this.clampDimension(request?.refreshHz ?? 60, 24, 360);
		await this.writeSettingsFile({ width, height, refreshHz }, targetCount);

		try {
			// Best-effort: nudge the running driver to reload (applies instantly
			// when the pipe is present). Ignored when the device is absent.
			await this.sendCommand(`SETDISPLAYCOUNT ${targetCount}`, {
				allowReload: true,
			}).catch(() => '');

			// Apply the topology. This MUST NOT run while WebRTC captures are
			// active (that deadlocks the display stack and freezes the desktop),
			// so callers must stop captures first.
			await this.applyDisplayTopology(targetCount);
			this.virtualDisplayActive = targetCount > 0;

			if (targetCount > 0) {
				await execFileAsync('DisplaySwitch.exe', ['/extend'], {
					windowsHide: true,
					timeout: 15000,
				}).catch(() => undefined);
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
	 * Recreate the root display device so the virtual monitor appears. The
	 * driver has no "zero monitors" mode: its settings parser clamps a count of
	 * 0 to 1, so the monitor only exists while the device exists. Recreating the
	 * device is therefore the way to add it back after removal.
	 *
	 * Safe only when no desktop capture is running; callers must stop captures
	 * first.
	 */
	private async applyDisplayTopology(targetCount: number): Promise<void> {
		if (process.platform !== 'win32') return;
		// count 0 means "no virtual monitor": remove the root device entirely
		// (the driver clamps a count of 0 to 1, so the device must go away).
		if (targetCount <= 0) {
			if (await this.isRootDevicePresent()) {
				try {
					await execFileAsync(
						'pnputil.exe',
						['/remove-device', '/deviceid', 'Root\\MttVDD'],
						{ windowsHide: true, timeout: 30000 },
					);
				} catch (error) {
					this.log.warn(`remove-device failed: ${String(error)}`);
				}
			}
		} else if (await this.isRootDevicePresent()) {
			// Device exists: a restart applies the new count/resolution.
			try {
				await execFileAsync(
					'pnputil.exe',
					['/restart-device', '/deviceid', 'Root\\MttVDD'],
					{ windowsHide: true, timeout: 30000 },
				);
			} catch (error) {
				this.log.warn(`restart-device failed: ${String(error)}`);
			}
		} else {
			// Device absent: recreate it from the installed package.
			await this.recreateRootDevice();
		}
		// Allow the display stack a moment to settle before captures start.
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}

	private async isRootDevicePresent(): Promise<boolean> {
		try {
			const { stdout, stderr } = await execFileAsync(
				'pnputil.exe',
				['/enum-devices', '/connected', '/deviceids'],
				{ encoding: 'utf8', windowsHide: true, timeout: 10000 },
			);
			return /Root\\MttVDD/i.test(`${stdout ?? ''}${stderr ?? ''}`);
		} catch {
			return false;
		}
	}

	/**
	 * Create the root device from the cached, previously-extracted driver
	 * package without downloading it again. Falls back to a full install when no
	 * cache is available.
	 */
	private async recreateRootDevice(): Promise<void> {
		const workDir = path.join(os.tmpdir(), 'AltronScreenVDD', 'extracted');
		const arch = /arm/i.test(process.env.PROCESSOR_ARCHITECTURE ?? '')
			? 'ARM64'
			: 'x86';
		const driverDir = path.join(workDir, 'SignedDrivers', arch, 'VDD');
		const inf = path.join(driverDir, 'MttVDD.inf');
		const devcon = fs.existsSync(
			path.join(workDir, 'Dependencies', 'devcon.exe'),
		)
			? path.join(workDir, 'Dependencies', 'devcon.exe')
			: path.join(driverDir, 'devcon.exe');

		if (!fs.existsSync(inf) || !fs.existsSync(devcon)) {
			// No cache: run the full installer (downloads the package and creates
			// the device). Imported lazily to avoid a cycle.
			const { installVirtualDisplayDriverSync } = await import(
				'../../main/helpers/ipcMainHandlers'
			);
			const appPath = (global as unknown as { appPath?: string }).appPath ?? '';
			await installVirtualDisplayDriverSync(appPath);
			return;
		}

		await execFileAsync(devcon, ['install', inf, 'Root\\MttVDD'], {
			windowsHide: true,
			timeout: 60000,
		});
	}

	/**
	 * Remove the virtual monitor. The driver has no zero-monitor mode (a count
	 * of 0 is clamped to 1), so the only reliable way to remove it is to remove
	 * the root display device. It is recreated on demand via
	 * `applyDisplayTopology()`. Must be called after captures have stopped.
	 */
	async destroyDisplay(): Promise<boolean> {
		if (process.platform !== 'win32') {
			return false;
		}

		if (!(await this.isRootDevicePresent())) {
			this.virtualDisplayActive = false;
			return true;
		}

		try {
			await execFileAsync(
				'pnputil.exe',
				['/remove-device', '/deviceid', 'Root\\MttVDD'],
				{ windowsHide: true, timeout: 30000 },
			);
			this.virtualDisplayActive = false;
			// Give Windows a moment to retire the monitor.
			await new Promise((resolve) => setTimeout(resolve, 1500));
			return true;
		} catch (error) {
			this.log.error(`VDD remove-device failed: ${String(error)}`);
			return false;
		}
	}

	/**
	 * Best-effort cleanup on app shutdown. Callers must have stopped all
	 * captures first. Bounded by a timeout so quitting cannot hang forever, and
	 * skipped when the driver is not present.
	 */
	async destroyDisplaySilently(): Promise<void> {
		if (process.platform !== 'win32') {
			return;
		}
		if (!(await this.isDriverInstalled())) {
			return;
		}
		await Promise.race([
			this.destroyDisplay(),
			new Promise<void>((resolve) =>
				setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref?.(),
			),
		]).catch(() => undefined);
		this.virtualDisplayActive = false;
	}

	/**
	 * Record the number of displays present before any virtual display is
	 * created, as a secondary signal for shutdown cleanup.
	 */
	setPhysicalDisplayBaseline(count: number): void {
		this.physicalDisplayBaseline = count;
	}

	/**
	 * Whether a virtual monitor is currently active. Prefers the concrete signal
	 * (the root device is present / the monitor count rose above the baseline),
	 * so a lingering monitor left by a previous session is still cleaned up.
	 */
	async hasActiveVirtualDisplay(currentDisplayCount: number): Promise<boolean> {
		if (this.virtualDisplayActive) return true;
		if (
			this.physicalDisplayBaseline !== null &&
			currentDisplayCount > this.physicalDisplayBaseline
		) {
			return true;
		}
		return this.isRootDevicePresent();
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

	private async writeSettingsFile(
		request: VirtualDisplayInfo,
		count: number,
	): Promise<void> {
		const configPath = this.resolveConfigPath();
		if (!configPath) {
			return;
		}

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

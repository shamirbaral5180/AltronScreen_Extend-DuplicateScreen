import { store } from '../../common/altronscreen-electron-store';
import {
	DEFAULT_VIRTUAL_DISPLAY_RESOLUTION,
	VIRTUAL_DISPLAY_RESOLUTIONS,
} from '../../features/VirtualDisplayService';

export const VIRTUAL_DISPLAY_RESOLUTION_KEY = 'virtual-display-resolution';

export interface VirtualDisplayResolution {
	width: number;
	height: number;
}

export const SUPPORTED_VIRTUAL_DISPLAY_RESOLUTIONS: ReadonlyArray<VirtualDisplayResolution> =
	VIRTUAL_DISPLAY_RESOLUTIONS;

export function validateVirtualDisplayResolution(
	value: unknown,
): VirtualDisplayResolution {
	const input = value as Partial<VirtualDisplayResolution> | null;
	if (
		!input ||
		typeof input.width !== 'number' ||
		typeof input.height !== 'number' ||
		!Number.isFinite(input.width) ||
		!Number.isFinite(input.height)
	) {
		throw new Error('Invalid display resolution.');
	}
	const match = SUPPORTED_VIRTUAL_DISPLAY_RESOLUTIONS.find(
		(resolution) =>
			resolution.width === input.width && resolution.height === input.height,
	);
	if (!match) {
		throw new Error('Unsupported display resolution.');
	}
	return { width: match.width, height: match.height };
}

/**
 * The resolution the extended (virtual) display is created at. Defaults to
 * 1360x768. Several resolutions are advertised to Windows, so this is the
 * initial/default mode and the user can still change it in Windows.
 */
export function getVirtualDisplayResolution(): VirtualDisplayResolution {
	try {
		const saved = store.get(VIRTUAL_DISPLAY_RESOLUTION_KEY);
		return saved
			? validateVirtualDisplayResolution(JSON.parse(saved))
			: { ...DEFAULT_VIRTUAL_DISPLAY_RESOLUTION };
	} catch {
		return { ...DEFAULT_VIRTUAL_DISPLAY_RESOLUTION };
	}
}

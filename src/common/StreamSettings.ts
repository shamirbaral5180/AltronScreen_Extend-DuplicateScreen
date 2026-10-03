export interface StreamSettings {
	frameRate: number;
	resolutionScale: number;
	bitrateMbps: number;
	latency: 'interactive' | 'balanced' | 'smooth';
	contentHint: 'motion' | 'detail';
}

export const DEFAULT_STREAM_SETTINGS: StreamSettings = {
	frameRate: 60,
	resolutionScale: 1,
	bitrateMbps: 20,
	latency: 'interactive',
	contentHint: 'motion',
};

export const STREAM_PRESETS: Record<string, StreamSettings> = {
	default: DEFAULT_STREAM_SETTINGS,
	speed: {
		frameRate: 30,
		resolutionScale: 0.5,
		bitrateMbps: 8,
		latency: 'interactive',
		contentHint: 'motion',
	},
	balanced: {
		frameRate: 60,
		resolutionScale: 0.75,
		bitrateMbps: 15,
		latency: 'interactive',
		contentHint: 'motion',
	},
	quality: {
		frameRate: 60,
		resolutionScale: 1,
		bitrateMbps: 35,
		latency: 'balanced',
		contentHint: 'detail',
	},
};

export function validateStreamSettings(value: unknown): StreamSettings {
	const input = value as Partial<StreamSettings> | null;
	if (
		!input ||
		![15, 24, 30, 60].includes(input.frameRate ?? 0) ||
		![0.25, 0.5, 0.75, 1].includes(input.resolutionScale ?? 0) ||
		typeof input.bitrateMbps !== 'number' ||
		!Number.isFinite(input.bitrateMbps) ||
		input.bitrateMbps < 1 ||
		input.bitrateMbps > 50 ||
		!['interactive', 'balanced', 'smooth'].includes(input.latency ?? '') ||
		!['motion', 'detail'].includes(input.contentHint ?? '')
	) {
		throw new Error(
			'Invalid streaming settings. Choose a supported frame rate, resolution, latency mode, and a bitrate between 1 and 50 Mbps.',
		);
	}
	return {
		frameRate: input.frameRate!,
		resolutionScale: input.resolutionScale!,
		bitrateMbps: input.bitrateMbps,
		latency: input.latency!,
		contentHint: input.contentHint!,
	};
}

export const RECEIVER_BUFFER_MS = { interactive: 0, balanced: 50, smooth: 150 };

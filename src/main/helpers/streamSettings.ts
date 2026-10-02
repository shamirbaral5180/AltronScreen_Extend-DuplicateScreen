import { store } from '../../common/altronscreen-electron-store';
import {
	DEFAULT_STREAM_SETTINGS,
	validateStreamSettings,
	type StreamSettings,
} from '../../common/StreamSettings';

export const STREAM_SETTINGS_KEY = 'stream-settings';

export function getStreamSettings(): StreamSettings {
	try {
		const saved = store.get(STREAM_SETTINGS_KEY);
		return saved
			? validateStreamSettings(JSON.parse(saved))
			: { ...DEFAULT_STREAM_SETTINGS };
	} catch {
		return { ...DEFAULT_STREAM_SETTINGS };
	}
}

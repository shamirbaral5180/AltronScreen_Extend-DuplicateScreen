import { systemPreferences } from 'electron';
import Logger from '../utils/LoggerWithFilePrefix';

const log = new Logger(__filename);

export function checkScreenRecordingPermission(): boolean {
	if (process.platform !== 'darwin') {
		return true;
	}

	try {
		const status = systemPreferences.getMediaAccessStatus('screen');
		log.info(`Screen recording permission status: ${status}`);
		return status === 'granted';
	} catch (error) {
		log.error('Error checking screen recording permission:', error);
		return false;
	}
}

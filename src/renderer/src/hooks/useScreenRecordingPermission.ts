import { useEffect, useState } from 'react';
import { IpcEvents } from '../../../common/IpcEvents.enum';

export function useScreenRecordingPermission(): boolean {
	const [hasPermission, setHasPermission] = useState(true);

	useEffect(() => {
		let isMounted = true;

		void window.electron.ipcRenderer
			.invoke(IpcEvents.CheckScreenRecordingPermission)
			.then((value: unknown) => {
				if (!isMounted) return;
				if (typeof value === 'boolean') {
					setHasPermission(value);
				}
			})
			.catch(() => {
				// ignore
			});

		return () => {
			isMounted = false;
		};
	}, []);

	return hasPermission;
}

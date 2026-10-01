import type React from 'react';
import { useCallback } from 'react';
import { Button, Callout, Dialog, Intent, Text } from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import { IpcEvents } from '../../../common/IpcEvents.enum';

interface ScreenRecordingPermissionModalProps {
	isOpen: boolean;
}

const MACOS_SCREEN_RECORDING_SETTINGS_URL =
	'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

const ScreenRecordingPermissionModal: React.FC<ScreenRecordingPermissionModalProps> = ({
	isOpen,
}) => {
	const { t } = useTranslation();

	const handleOpenSettings = useCallback(() => {
		void window.electron.ipcRenderer.invoke(
			IpcEvents.OpenExternalLink,
			MACOS_SCREEN_RECORDING_SETTINGS_URL,
		);
	}, []);

	const handleRestartApp = useCallback(() => {
		void window.electron.ipcRenderer.invoke(IpcEvents.RelaunchApp);
	}, []);

	return (
		<Dialog
			isOpen={isOpen}
			onClose={() => {}}
			title={t('screen-recording-permission-required')}
			icon='warning-sign'
			isCloseButtonShown={false}
			canEscapeKeyClose={false}
			canOutsideClickClose={false}
			enforceFocus
			autoFocus
			usePortal={true}
			style={{ zIndex: 10002, borderRadius: '8px' }}
		>
			<div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
				<Text>{t('screen-recording-permission-message')}</Text>
				<Callout intent={Intent.WARNING}>
					{t('screen-recording-permission-restart-reminder')}
				</Callout>
				<div
					style={{
						display: 'flex',
						justifyContent: 'flex-end',
						gap: '10px',
					}}
				>
					<Button
						intent={Intent.PRIMARY}
						onClick={handleOpenSettings}
						text={t('screen-recording-permission-open-settings')}
						style={{ borderRadius: '9999px' }}
					/>
					<Button
						intent={Intent.SUCCESS}
						onClick={handleRestartApp}
						text={t('screen-recording-permission-restart-app')}
						style={{ borderRadius: '9999px' }}
					/>
				</div>
			</div>
		</Dialog>
	);
};

export default ScreenRecordingPermissionModal;

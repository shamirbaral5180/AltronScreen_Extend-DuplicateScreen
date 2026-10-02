import { type ErrorMessageType } from '../../components/ErrorDialog/ErrorMessageEnum';

export default (
	peerConnection: PeerConnection,
	errorMessage: ErrorMessageType,
) => {
	if (peerConnection.destroyed) return;
	peerConnection.destroy();
	peerConnection.UIHandler.errorDialogMessage = errorMessage;
	peerConnection.UIHandler.setDialogErrorMessageCallback(errorMessage);
};

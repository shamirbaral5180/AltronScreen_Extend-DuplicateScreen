import React, { useEffect, useMemo, useState } from 'react';
import {
	Button,
	Text,
	Tooltip,
	Position,
	Dialog,
	Classes,
	H3,
} from '@blueprintjs/core';
import { QRCodeSVG } from 'qrcode.react';
import { makeStyles, createStyles } from '@material-ui/core';
import { Row, Col } from 'react-flexbox-grid';
import isProduction from '../../../../common/isProduction';
import { IpcEvents } from '../../../../common/IpcEvents.enum';
import { useTranslation } from 'react-i18next';
import Logo192 from '../../assets/logo192.png';

const useStyles = makeStyles(() =>
	createStyles({
		smallQRCode: {
			height: '100%',
			border: '1px solid',
			borderColor: 'rgba(0,0,0,0.0)',
			padding: '10px',
			borderRadius: '10px',
			margin: '0 auto',
			'&:hover': {
				backgroundColor: 'rgba(0,0,0,0.12)',
				border: '1px solid #8A9BA8',
				cursor: 'zoom-in',
			},
		},
		dialogQRWrapper: {
			backgroundColor: 'white',
			padding: '20px',
			borderRadius: '10px',
		},
		bigQRCodeDialogRoot: {
			'&:hover': {
				cursor: 'zoom-out',
			},
			paddingBottom: '0px',
		},
	}),
);

const ScanQRStep: React.FC = () => {
	const { t } = useTranslation();
	const [clientViewerPort, setClientViewerPort] = useState('80'); // Default port, can be changed later
	const classes = useStyles();

	const [isViewerSlotAvailable, setIsViewerSlotAvailable] = useState(true);
	const [LOCAL_LAN_IP, setLocalLanIP] = useState('');
	const [isQRCodeMagnified, setIsQRCodeMagnified] = useState(false);

	useEffect(() => {
		window.electron.ipcRenderer
			.invoke(IpcEvents.GetPort)
			.then((port) => {
				return setClientViewerPort(port);
			})
			.catch((error) => {
				console.error('Failed to get port:', error);
			});
	}, []);

	useEffect(() => {
		let cancelled = false;

		const handleAvailabilityChange = (
			_: unknown,
			payload: { isAvailable: boolean },
		): void => {
			if (cancelled) return;
			const isAvailable = Boolean(payload?.isAvailable);
			setIsViewerSlotAvailable(isAvailable);
			if (!isAvailable) {
				setIsQRCodeMagnified(false);
			}
		};

		window.electron.ipcRenderer
			.invoke(IpcEvents.GetViewerConnectionAvailability)
			.then((availability) => {
				if (cancelled) return;
				const isAvailable = Boolean(availability);
				setIsViewerSlotAvailable(isAvailable);
				if (!isAvailable) {
					setIsQRCodeMagnified(false);
				}
			})
			.catch((error) => {
				console.error('Failed to get viewer slot availability:', error);
			});

		window.electron.ipcRenderer.on(
			IpcEvents.ViewerConnectionAvailabilityChanged,
			handleAvailabilityChange,
		);

		return () => {
			cancelled = true;
			window.electron.ipcRenderer.removeListener(
				IpcEvents.ViewerConnectionAvailabilityChanged,
				handleAvailabilityChange,
			);
		};
	}, []);

	useEffect(() => {
		let cancelled = false;

		const fetchLocalIp = async (): Promise<void> => {
			const gotIP =
				await window.electron.ipcRenderer.invoke('get-local-lan-ip');
			if (!cancelled && gotIP) {
				setLocalLanIP(gotIP);
			}
		};

		void fetchLocalIp();
		const ipInterval = setInterval(() => {
			void fetchLocalIp();
		}, 1000);

		return () => {
			cancelled = true;
			clearInterval(ipInterval);
		};
	}, []);

	const portString = useMemo(() => {
		return `:${clientViewerPort}`;
	}, [clientViewerPort]);
	const shareUrl = useMemo(() => {
		if (!isViewerSlotAvailable) return '';
		if (LOCAL_LAN_IP === '') return '';
		return `http://${LOCAL_LAN_IP}${portString}`;
	}, [LOCAL_LAN_IP, portString, isViewerSlotAvailable]);
	const isQrInteractive = shareUrl !== '';
	const connectionLimitTooltip = t('connection-limit-reached-tooltip');
	const qrTooltipContent = isQrInteractive
		? t('click-to-make-bigger')
		: connectionLimitTooltip;
	const copyTooltipContent = isQrInteractive
		? t('click-to-copy')
		: connectionLimitTooltip;

	return (
		<>
			<div style={{ textAlign: 'center' }}>
				<Text>
					<span
						style={{
							backgroundColor: '#00f99273',
							fontWeight: 900,
							paddingRight: '8px',
							paddingLeft: '8px',
							borderRadius: '20px',
						}}
					>
						{t(
							'make-sure-your-computer-and-screen-viewing-device-are-connected-to-same-wi-fi',
						)}
					</span>
				</Text>
			</div>
			<div>
				<Row>
					<Col xs={12}>
						<div style={{ textAlign: 'center' }}>
							<Text className="bp3-text">
								{t('scan-the-qr-code-to-connect')}
							</Text>
						</div>
						<div
							style={{
								display: 'flex',
								flexDirection: 'column',
								alignItems: 'center',
								justifyContent: 'center',
								height: '100%',
								marginBottom: '16px',
							}}
						>
							<Tooltip content={qrTooltipContent} position={Position.LEFT}>
								<span>
									{isQrInteractive ? (
										<Button
											id="magnify-qr-code-button"
											className={classes.smallQRCode}
											onClick={() => {
												if (!isQrInteractive) return;
												setIsQRCodeMagnified(true);
											}}
											disabled={!isQrInteractive}
										>
											<QRCodeSVG
												value={shareUrl}
												level="H"
												bgColor="rgba(0,0,0,0.0)"
												fgColor="#000000"
												imageSettings={{
													// src: `http://127.0.0.1${portString}/logo192.png`,
													src: Logo192,
													width: 40,
													height: 40,
													excavate: true,
												}}
											/>
										</Button>
									) : (
										<div
											className={classes.smallQRCode}
											style={{ cursor: 'not-allowed' }}
										>
											<img
												src={Logo192}
												alt={t('altronscreen-logo')}
												width={64}
												height={64}
											/>
										</div>
									)}
								</span>
							</Tooltip>
						</div>
					</Col>
				</Row>
			</div>
			<Row
				style={{
					marginBottom: '10px',
					display: 'flex',
					flexDirection: 'row',
					alignItems: 'center',
					justifyContent: 'center',
					textAlign: 'center',
				}}
			>
				<Text className="bp3-text-muted">
					{isQrInteractive
						? t(
								'enter-the-following-address-in-browser-address-bar-on-any-device',
							)
						: t('one-viewing-client-is-connected-already')}
				</Text>
			</Row>

			<Row
				style={{
					display: 'flex',
					flexDirection: 'row',
					justifyContent: 'center',
				}}
			>
				<Tooltip content={copyTooltipContent} position={Position.TOP}>
					<span>
						<Button
							intent={isQrInteractive ? 'primary' : 'none'}
							icon="duplicate"
							style={{ borderRadius: '100px' }}
							disabled={!isQrInteractive}
							onClick={() => {
								if (!isQrInteractive) return;
								window.electron.ipcRenderer.invoke(
									IpcEvents.WriteTextToClipboard,
									shareUrl,
								);
							}}
						>
							{isQrInteractive ? shareUrl : t('viewing-client-connected-label')}
						</Button>
					</span>
				</Tooltip>
			</Row>
			{!isQrInteractive && (
				<>
					<Row
						style={{
							marginTop: '12px',
							marginBottom: '6px',
							display: 'flex',
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'center',
							textAlign: 'center',
						}}
					>
						<Text className="bp3-text-muted">
							{t('altronscreen-allows-only-one-client-at-same-time')}
						</Text>
					</Row>
				</>
			)}

			<Dialog
				className={classes.bigQRCodeDialogRoot}
				isOpen={isQrInteractive && isQRCodeMagnified}
				onClose={() => setIsQRCodeMagnified(false)}
				canEscapeKeyClose
				canOutsideClickClose
				transitionDuration={isProduction() ? 700 : 0}
				style={{ position: 'relative', top: '0px' }}
				usePortal={false}
			>
				<Row
					id="qr-code-dialog-inner"
					className={Classes.DIALOG_BODY}
					center="xs"
					middle="xs"
					onClick={() => setIsQRCodeMagnified(false)}
				>
					<Col xs={11} className={classes.dialogQRWrapper}>
						{/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
						{/* @ts-ignore */}
						<QRCodeSVG
							value={isQrInteractive ? shareUrl : 'INACTIVE'}
							level="H"
							imageSettings={{
								// src: `http://127.0.0.1${portString}/logo192.png`,
								src: Logo192,
								width: 25,
								height: 25,
								excavate: true,
							}}
							width="390px"
							height="390px"
						/>
					</Col>
					<Col>
						<H3>
							{isQrInteractive
								? `${LOCAL_LAN_IP}${portString}`
								: t('waiting-for-connection')}
						</H3>
						<H3>{isQrInteractive ? shareUrl : t('waiting-for-connection')}</H3>
					</Col>
				</Row>
			</Dialog>
		</>
	);
};

export default ScanQRStep;

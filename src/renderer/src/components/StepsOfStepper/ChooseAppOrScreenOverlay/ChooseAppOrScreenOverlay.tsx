import { useCallback, useEffect, useState } from 'react';
import { H3, Dialog, Button, Spinner, Card } from '@blueprintjs/core';
import { Row, Col } from 'react-flexbox-grid';
import { createStyles, makeStyles } from '@material-ui/core/styles';
import CloseOverlayButton from '../../CloseOverlayButton';
import PreviewGridList from './PreviewGridList';
import { IpcEvents } from '../../../../../common/IpcEvents.enum';
import { useTranslation } from 'react-i18next';

const useStyles = makeStyles(() =>
	createStyles({
		dialogRoot: {
			width: '90%',
			height: '87vh !important',
			overflowY: 'scroll',
		},
		closeButton: {
			position: 'relative',
			width: '40px',
			height: '40px',
			left: 'calc(100% - 55px)',
			borderRadius: '100px',
			zIndex: 9999,
		},
		overlayInnerRoot: { width: '90%', height: '90%' },
		sharePreviewsContainer: {
			top: '60px',
			position: 'relative',
			height: '100%',
		},
	}),
);

interface ChooseAppOrScreenOverlayProps {
	isEntireScreenToShareChosen: boolean;
	isChooseAppOrScreenOverlayOpen: boolean;
	handleNextEntireScreen: () => void;
	handleNextApplicationWindow: () => void;
	handleClose: () => void;
	isWaylandSession: boolean;
}

export default function ChooseAppOrScreenOverlay(
	props: ChooseAppOrScreenOverlayProps,
) {
	const {
		handleClose,
		isChooseAppOrScreenOverlayOpen,
		isEntireScreenToShareChosen,
		handleNextEntireScreen,
		handleNextApplicationWindow,
		isWaylandSession,
	} = props;
	const classes = useStyles();
	const { t } = useTranslation();

	const [viewSharingIds, setViewSharingIds] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [isAddingDisplay, setIsAddingDisplay] = useState<boolean>(false);
	const [addDisplayMessage, setAddDisplayMessage] = useState<string>('');

	const handleRefreshSources = useCallback(async (): Promise<string[]> => {
		if (isWaylandSession) {
			setViewSharingIds([]);
			return [];
		}
		const ids = await window.electron.ipcRenderer.invoke(
			IpcEvents.GetDesktopSharingSourceIds,
			{
				isEntireScreenToShareChosen,
			},
		);
		setViewSharingIds(ids);
		return ids;
	}, [isEntireScreenToShareChosen, isWaylandSession]);

	const handleAddVirtualDisplay = useCallback(async () => {
		if (isAddingDisplay) return;
		setIsAddingDisplay(true);
		setAddDisplayMessage('');
		try {
			const result = await window.electron.ipcRenderer.invoke(
				IpcEvents.AddVirtualDisplay,
			);
			if (result?.ok) {
				// Refresh so the newly created screen appears in the list.
				await handleRefreshSources();
			} else {
				setAddDisplayMessage(
					result?.message || t('virtual-display-driver-required'),
				);
			}
		} catch (error) {
			console.error('Failed to add virtual display:', error);
			setAddDisplayMessage(t('virtual-display-driver-required'));
		} finally {
			setIsAddingDisplay(false);
		}
	}, [isAddingDisplay, handleRefreshSources, t]);

	const handleRemoveVirtualDisplay = useCallback(async () => {
		if (isAddingDisplay) return;
		setIsAddingDisplay(true);
		setAddDisplayMessage('');
		try {
			const result = await window.electron.ipcRenderer.invoke(
				IpcEvents.RemoveVirtualDisplay,
			);
			if (result?.ok) {
				// Refresh so the removed screen disappears from the list.
				await handleRefreshSources();
			} else {
				setAddDisplayMessage(
					result?.message || t('no-virtual-screen-to-remove'),
				);
			}
		} catch (error) {
			console.error('Failed to remove virtual display:', error);
			setAddDisplayMessage(t('no-virtual-screen-to-remove'));
		} finally {
			setIsAddingDisplay(false);
		}
	}, [isAddingDisplay, handleRefreshSources, t]);

	const handleRefreshSourcesWithLoading = useCallback(async (): Promise<
		string[]
	> => {
		setIsLoading(true);
		try {
			const ids = await handleRefreshSources();
			return ids;
		} finally {
			setIsLoading(false);
		}
	}, [handleRefreshSources]);

	useEffect(() => {
		if (!isChooseAppOrScreenOverlayOpen || isWaylandSession) {
			setIsLoading(false);
			setViewSharingIds([]);
			return;
		}

		let cancelled = false;
		let attempts = 0;
		const maxAttempts = 8; // ~3.2s total if retryDelayMs = 400
		const retryDelayMs = 400;

		setIsLoading(true);

		const attemptLoad = async () => {
			const ids = await handleRefreshSources();
			if (cancelled) return;
			if (ids.length > 0 || attempts >= maxAttempts) {
				setIsLoading(false);
				return;
			}
			attempts += 1;
			setTimeout(() => {
				if (!cancelled) {
					attemptLoad();
				}
			}, retryDelayMs);
		};

		attemptLoad();

		return () => {
			cancelled = true;
			setIsLoading(false);
		};
	}, [isChooseAppOrScreenOverlayOpen, handleRefreshSources, isWaylandSession]);

	return (
		<Dialog
			onClose={handleClose}
			className={`${classes.dialogRoot} choose-app-or-screen-dialog`}
			autoFocus
			canEscapeKeyClose
			canOutsideClickClose
			enforceFocus
			isOpen={isChooseAppOrScreenOverlayOpen}
			usePortal
			transitionDuration={0}
			style={{
				borderRadius: '8px',
			}}
		>
			<div
				id="choose-app-or-screen-overlay-container"
				style={{ minHeight: '95%', overflowX: 'hidden' }}
			>
				<div
					style={{
						position: 'fixed',
						zIndex: 99999,
						width: '90%',
						paddingTop: '0px',
						paddingLeft: '15px',
						paddingRight: '15px',
					}}
				>
					<div
						style={{
							padding: '10px',
							borderRadius: '5px',
							height: '60px',
							width: '100%',
						}}
					>
						<Row
							between="xs"
							middle="xs"
							style={{
								width: '100%',
								backgroundColor: '#f6f7f9',
								borderRadius: '8px',
							}}
						>
							<Col xs={9}>
								{isEntireScreenToShareChosen ? (
									<div>
										<H3 style={{ marginBottom: '0px' }}>
											{t('select-entire-screen-to-share')}
										</H3>
									</div>
								) : (
									<div>
										<H3 style={{ marginBottom: '0px' }}>
											{t('select-app-window-to-share')}
										</H3>
									</div>
								)}
							</Col>
							<Col xs={2}>
								<Button
									icon="refresh"
									intent="warning"
									onClick={handleRefreshSourcesWithLoading}
									disabled={isLoading}
									style={{
										borderRadius: '100px',
										width: 'max-content',
									}}
								>
									{t('refresh')}
								</Button>
							</Col>

							<Col xs={1}>
								<CloseOverlayButton
									onClick={handleClose}
									style={{
										borderRadius: '100px',
										width: '40px',
										height: '40px',
									}}
								/>
							</Col>
						</Row>
					</div>
				</div>

				<div
					style={{
						position: 'relative',
						zIndex: '1',
						height: 'calc(87vh - 80px)',
						minHeight: '400px',
					}}
				>
					{isLoading ? (
						<div
							style={{
								position: 'absolute',
								top: 0,
								left: 0,
								right: 0,
								bottom: 0,
								display: 'flex',
								justifyContent: 'center',
								alignItems: 'center',
								width: '100%',
								height: '100%',
							}}
						>
							<Spinner size={60} />
						</div>
					) : (
						<div
							style={{
								position: 'relative',
								height: '100%',
							}}
						>
							<Row>
								<div className={classes.sharePreviewsContainer}>
									<PreviewGridList
										viewSharingIds={viewSharingIds}
										isEntireScreen={isEntireScreenToShareChosen}
										handleNextEntireScreen={() => {
											handleNextEntireScreen();
											handleClose();
										}}
										handleNextApplicationWindow={() => {
											handleNextApplicationWindow();
											handleClose();
										}}
									/>
									{isEntireScreenToShareChosen && (
										<Row center="xs" style={{ marginTop: '12px' }}>
											<Col>
												<Card
													interactive
													onClick={
														isAddingDisplay
															? undefined
															: handleAddVirtualDisplay
													}
													style={{
														width: '250px',
														height: '230px',
														display: 'flex',
														flexDirection: 'column',
														alignItems: 'center',
														justifyContent: 'center',
														gap: '8px',
														border: '2px dashed #48AFF0',
														boxShadow: 'none',
													}}
												>
													{isAddingDisplay ? (
														<Spinner size={40} />
													) : (
														<>
															<Button
																icon="add"
																large
																intent="primary"
																style={{ borderRadius: '100px' }}
															/>
															<H3
																style={{ marginTop: '12px', marginBottom: '0' }}
															>
																{t('add-another-screen')}
															</H3>
															<Button
																icon="remove"
																text={t('remove-a-screen')}
																intent="danger"
																style={{ borderRadius: '100px' }}
																onClick={(event) => {
																	event.stopPropagation();
																	void handleRemoveVirtualDisplay();
																}}
															/>
														</>
													)}
												</Card>
												{addDisplayMessage !== '' && (
													<div
														style={{
															marginTop: '8px',
															maxWidth: '250px',
															color: '#A66321',
															textAlign: 'center',
														}}
													>
														{addDisplayMessage}
													</div>
												)}
											</Col>
										</Row>
									)}
								</div>
							</Row>
						</div>
					)}
				</div>
			</div>
		</Dialog>
	);
}

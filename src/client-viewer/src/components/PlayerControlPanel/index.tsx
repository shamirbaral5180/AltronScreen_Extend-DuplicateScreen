import React, { useEffect, useState, useCallback } from 'react';
import {
	Alignment,
	Button,
	ButtonGroup,
	Card,
	H5,
	Switch,
	Divider,
	Text,
	Icon,
	Tooltip,
	Position,
	Popover,
	Classes,
	H3,
} from '@blueprintjs/core';
import screenfull from 'screenfull';
import { useTranslation } from 'react-i18next';
import FullScreenEnter from '../../images/fullscreen_24px.svg';
import FullScreenExit from '../../images/fullscreen_exit-24px.svg';
import { Col, Row } from 'react-flexbox-grid';
import {
	VideoQuality,
	type VideoQualityType,
} from '../../features/VideoAutoQualityOptimizer/VideoQualityEnum';
import { handlePlayerToggleFullscreen } from './handlePlayerToggleFullscreen';
import initScreenfullOnChange from './initScreenfullOnChange';
import { ScreenSharingSource } from '../../features/PeerConnection/ScreenSharingSourceEnum';
import './index.css';

const videoQualityButtonStyle: React.CSSProperties = {
	width: '100%',
	display: 'flex',
	justifyContent: 'center',
	alignItems: 'center',
	textAlign: 'center',
};

interface PlayerControlPanelProps {
	onSwitchChangedCallback: (isEnabled: boolean) => void;
	isPlaying: boolean;
	isDefaultPlayerTurnedOn: boolean;
	handleClickFullscreen: () => 'entered' | 'exited' | 'failed';
	handleClickPlayPause: () => void;
	setVideoQuality: (q: VideoQualityType) => void;
	selectedVideoQuality: VideoQualityType;
	screenSharingSourceType: ScreenSharingSourceType;
	// toaster: undefined | HTMLDivElement;
}

function PlayerControlPanel(props: PlayerControlPanelProps) {
	const { t } = useTranslation();
	const {
		onSwitchChangedCallback,
		isPlaying,
		isDefaultPlayerTurnedOn,
		handleClickPlayPause,
		handleClickFullscreen,
		selectedVideoQuality,
		setVideoQuality,
		screenSharingSourceType,
	} = props;

	const isFullScreenAPIAvailable = screenfull.isEnabled;

	const [isFullScreenOn, setIsFullScreenOn] = useState(false);

	useEffect(() => {
		const cleanup = initScreenfullOnChange(setIsFullScreenOn);
		return cleanup;
	}, []);

	const handleClickFullscreenWhenDefaultPlayerIsOn = useCallback(() => {
		const result = handlePlayerToggleFullscreen();
		if (result === 'failed') {
			console.warn('Unable to toggle fullscreen');
			return result;
		}
		setIsFullScreenOn(result === 'entered');
		return result;
	}, [setIsFullScreenOn]);

	const handleLogoClick = useCallback(() => {
		window.open('https://altronscreen.com', '_blank');
	}, []);

	const handlePlayPauseClick = useCallback(() => {
		handleClickPlayPause();
	}, [handleClickPlayPause]);

	const handleVideoQualitySelect = useCallback(
		(quality: VideoQualityType) => {
			setVideoQuality(quality);
		},
		[setVideoQuality],
	);

	const handleDefaultPlayerToggle = useCallback(() => {
		const nextState = !isDefaultPlayerTurnedOn;
		onSwitchChangedCallback(nextState);
	}, [isDefaultPlayerTurnedOn, onSwitchChangedCallback]);

	const handleFullscreenClick = useCallback(() => {
		const result = isDefaultPlayerTurnedOn
			? handleClickFullscreenWhenDefaultPlayerIsOn()
			: handleClickFullscreen();
		if (result === 'failed') {
			return;
		}
	}, [
		handleClickFullscreen,
		handleClickFullscreenWhenDefaultPlayerIsOn,
		isDefaultPlayerTurnedOn,
	]);

	return (
		<>
			<Card elevation={4}>
				<Row between="xs" middle="xs">
					<Col xs={12} md={3}>
						<Row middle="xs" start="xs">
							<Col xs>
								<Tooltip
									content={t('Click to visit our website')}
									position={Position.BOTTOM}
								>
									<Button minimal onClick={handleLogoClick}>
										<Row middle="xs">
											<img
												src="/img/logo512.png"
												alt="logo"
												style={{ height: '72px', marginRight: '12px' }}
											/>
											<H3 style={{ margin: 0 }}>AltronScreen Viewer</H3>
										</Row>
									</Button>
								</Tooltip>
							</Col>
						</Row>
					</Col>
					<Col xs={12} md={5}>
						<Row center="xs" style={{ height: '42px' }}>
							<ButtonGroup
								style={{
									borderRadius: '20px',
									backgroundColor: '#137CBD',
									height: '42px',
								}}
							>
								<Tooltip content={isPlaying ? t('Click to Pause Video') : t('Click to Play Video')} position={Position.BOTTOM}>
									<Button
										minimal
										onClick={handlePlayPauseClick}
										style={{
											color: 'white',
											backgroundColor: !isPlaying ? 'rgba(255, 255, 255, 0.2)' : 'transparent',
											boxShadow: !isPlaying ? '0 0 20px rgba(19, 124, 189, 0.8), 0 0 40px rgba(19, 124, 189, 0.6)' : 'none',
											transition: 'all 0.3s ease-in-out',
											border: 'none',
											outline: 'none',
											boxSizing: 'border-box',
											padding: '0 20px',
											borderRadius: '20px 0 0 20px',
											width: '120px',
											minWidth: '120px',
											maxWidth: '120px',
										}}
										className={!isPlaying ? 'play-pause-button play-pause-button-glow' : 'play-pause-button'}
									>
										<span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
											<Icon icon={isPlaying ? 'pause' : 'play'} color="white" />
											<Text className="bp3-text-large play-pause-text" style={{ color: 'white' }}>
												{isPlaying ? t('Pause') : t('Play')}
											</Text>
										</span>
									</Button>
								</Tooltip>
								<Popover
									content={
										<>
											<H5>{`${t('Video Settings')}:`}</H5>
											<Divider />
											{Object.values(VideoQuality).map(
												(q: VideoQualityType) => {
													return (
														<Row key={q}>
															<Button
																minimal
																active={selectedVideoQuality === q}
																style={videoQualityButtonStyle}
																disabled={
																	screenSharingSourceType ===
																	ScreenSharingSource.WINDOW
																}
																onClick={() => {
																	handleVideoQualitySelect(q);
																	// toaster?.show({
																	//   icon: 'clean',
																	//   intent: Intent.PRIMARY,
																	//   message: `${t(
																	//     'Video quality has been changed to'
																	//   )} ${q}`,
																	// });
																}}
															>
																{q}
															</Button>
														</Row>
													);
												},
											)}
										</>
									}
									position={Position.BOTTOM}
									popoverClassName={Classes.POPOVER_CONTENT_SIZING}
								>
									<Tooltip
										content={t('Click to Open Video Settings')}
										position={Position.BOTTOM}
									>
										<Button
											minimal
											style={{
												color: 'white',
												outline: 'none',
												boxShadow: 'none',
												borderRadius: '0',
												padding: '0 20px',
											}}
											className="settings-button-separator"
										>
											<Icon icon="cog" color="white" />
										</Button>
									</Tooltip>
								</Popover>
								<Tooltip
									content={t('Click to Enter Full Screen Mode')}
									position={Position.BOTTOM}
								>
									<Button
										minimal
										onClick={handleFullscreenClick}
										style={{
											color: 'white',
											border: 'none',
											outline: 'none',
											boxShadow: 'none',
											borderRadius: '0 20px 20px 0',
											padding: '0 20px',
										}}
									>
										<img
											src={isFullScreenOn ? FullScreenExit : FullScreenEnter}
											width={16}
											height={16}
											style={{
												transform: 'scale(1.5) translateY(1px)',
												filter:
													'invert(100%) sepia(100%) saturate(0%) hue-rotate(127deg) brightness(107%) contrast(102%)',
											}}
											alt="fullscreen-toggle"
										/>
									</Button>
								</Tooltip>
							</ButtonGroup>
						</Row>
					</Col>
					<Col xs={12} md={3}>
						<Row end="xs">
							<Col xs={12}>
								<Switch
									onChange={handleDefaultPlayerToggle}
									innerLabel={isDefaultPlayerTurnedOn ? t('ON') : t('OFF')}
									inline
									label={t('Default Video Player')}
									alignIndicator={Alignment.RIGHT}
									checked={isDefaultPlayerTurnedOn}
									disabled={!isFullScreenAPIAvailable}
									style={{
										marginBottom: '12px',
									}}
								/>
							</Col>
						</Row>
					</Col>
				</Row>
			</Card>
		</>
	);
}

export default PlayerControlPanel;

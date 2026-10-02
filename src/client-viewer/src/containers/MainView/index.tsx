import { useEffect, useState, useCallback } from 'react';
import { Grid } from 'react-flexbox-grid';
import screenfull from 'screenfull';
import './index.css';
import PeerConnection from '../../features/PeerConnection';
import {
	VideoQuality,
	type VideoQualityType,
} from '../../features/VideoAutoQualityOptimizer/VideoQualityEnum';
import {
	ErrorMessage,
	type ErrorMessageType,
} from '../../components/ErrorDialog/ErrorMessageEnum';
import ConnectionPropmpts from '../../containers/ConnectionPrompts';
import PlayerView from '../../containers/PlayerView';
import handleSetVideoQuality from './handleSetVideoQuality';
import { DUMMY_MY_DEVICE_DETAILS } from '../../constants/appConstants';
import ViewerHome from './ViewerHome';
import PeerConnectionUIHandler from '../../features/PeerConnection/PeerConnectionUIHandler';
import VideoAutoQualityOptimizer from '../../features/VideoAutoQualityOptimizer';
import changeLanguage from './changeLanguage';
import handleDisplayingLoadingSharingIconLoop from './handleDisplayingLoadingSharingIconLoop';
import { ScreenSharingSource } from '../../features/PeerConnection/ScreenSharingSourceEnum';
import ConnectionIcon from './ConnectionIconEnum';
import { LoadingSharingIconEnum } from './LoadingSharingIconEnum';

function MainView() {
	const [attempt, setAttempt] = useState(() =>
		new URLSearchParams(window.location.search).get('connect') === '1' ? 1 : 0,
	);
	const [notice, setNotice] = useState('');

	const [promptStep, setPromptStep] = useState(1);
	const [connectionIconType, setConnectionIconType] =
		useState<ConnectionIconType>(ConnectionIcon.FEED);
	const [myDeviceDetails, setMyDeviceDetails] = useState<DeviceDetails>(
		DUMMY_MY_DEVICE_DETAILS,
	);

	const [playing, setPlaying] = useState(true);
	const [url, setUrl] = useState<MediaStream | null>(null);
	const [screenSharingSourceType, setScreenSharingSourceType] =
		useState<ScreenSharingSourceType>(ScreenSharingSource.SCREEN);
	const [isWithControls, setIsWithControls] = useState(!screenfull.isEnabled);
	const [isShownTextPrompt, setIsShownTextPrompt] = useState(false);
	const [isShownLoadingSharingIcon, setIsShownLoadingSharingIcon] =
		useState(false);
	const [loadingSharingIconType, setLoadingSharingIconType] =
		useState<LoadingSharingIconType>(LoadingSharingIconEnum.DESKTOP);
	const [videoQuality, setVideoQuality] = useState<VideoQualityType>(
		VideoQuality.Q_100_PERCENT,
	);
	const [peer, setPeer] = useState<undefined | PeerConnection>();
	useEffect(() => {
		const url = new URL(window.location.href);
		url.searchParams.delete('connect');
		window.history.replaceState(null, '', url.pathname + url.search);
	}, []);

	useEffect(handleSetVideoQuality(videoQuality, peer), [videoQuality, peer]);

	useEffect(() => {
		if (!attempt) return;
		let finished = false;
		setNotice('');
		setMyDeviceDetails(DUMMY_MY_DEVICE_DETAILS);
		setPromptStep(1);
		setPlaying(true);
		setIsShownTextPrompt(true);
		setConnectionIconType(ConnectionIcon.FEED);
		const ui = new PeerConnectionUIHandler(
			(details) => {
				if (!finished) setMyDeviceDetails(details);
			},
			() => {
				if (!finished) {
					setConnectionIconType(ConnectionIcon.FEED_SUBSCRIBED);
					setPromptStep(3);
				}
			},
			setScreenSharingSourceType,
			changeLanguage,
			(message: ErrorMessageType) => {
				if (finished) return;
				finished = true;
				setNotice(
					message === ErrorMessage.DISCONNECTED
						? 'Disconnected. Choose a host below to request a new connection.'
						: message,
				);
				setUrl(null);
				setPeer(undefined);
				setAttempt(0);
			},
			() => {},
		);
		const connection = new PeerConnection(
			'share',
			(stream) => {
				if (!finished) setUrl(stream);
			},
			new VideoAutoQualityOptimizer(),
			ui,
		);
		setPeer(connection);
		return () => {
			finished = true;
			connection.destroy();
		};
	}, [attempt]);

	const handlePlayPause = useCallback(() => {
		setPlaying(!playing);
	}, [playing]);

	useEffect(
		handleDisplayingLoadingSharingIconLoop({
			promptStep,
			url,
			setIsShownLoadingSharingIcon,
			loadingSharingIconType,
			isShownLoadingSharingIcon,
			setLoadingSharingIconType,
		}),
		[promptStep, url],
	);

	return (
		<Grid>
			{attempt === 0 && (
				<ViewerHome
					notice={notice}
					onConnect={() => setAttempt((value) => value + 1)}
				/>
			)}
			{attempt > 0 && url === null && (
				<>
					<ConnectionPropmpts
						myDeviceDetails={myDeviceDetails}
						isShownTextPrompt={isShownTextPrompt}
						promptStep={promptStep}
						connectionIconType={connectionIconType}
						spinnerIconType={loadingSharingIconType}
						isShownSpinnerIcon={isShownLoadingSharingIcon}
					/>
					<button
						className="bp6-button"
						style={{ position: 'relative', zIndex: 4, margin: '20px' }}
						onClick={() => {
							setAttempt(0);
							setUrl(null);
							setPeer(undefined);
						}}
					>
						{'Back to home'}
					</button>
				</>
			)}
			{url !== null && (
				<PlayerView
					onDisconnect={() => {
						setNotice(
							'Disconnected. Choose a host below to request a new connection.',
						);
						setAttempt(0);
						setUrl(null);
						setPeer(undefined);
					}}
					streamUrl={url}
					screenSharingSourceType={screenSharingSourceType}
					setIsWithControls={setIsWithControls}
					isWithControls={isWithControls}
					handlePlayPause={handlePlayPause}
					isPlaying={playing}
					setPlaying={setPlaying}
					setVideoQuality={setVideoQuality}
					videoQuality={videoQuality}
				/>
			)}
		</Grid>
	);
}

export default MainView;

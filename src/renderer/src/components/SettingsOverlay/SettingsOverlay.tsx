import React, { useEffect, useState } from 'react';
import {
	Overlay2,
	Classes,
	H3,
	Tabs,
	Tab,
	Icon,
	Text,
	TabsExpander,
} from '@blueprintjs/core';
import { Col, Row } from 'react-flexbox-grid';
import { createStyles, makeStyles } from '@material-ui/core/styles';
import { LIGHT_UI_BACKGROUND } from '../../containers/SettingsProvider';
import CloseOverlayButton from '../CloseOverlayButton';
import SettingRowLabelAndInput from './SettingRowLabelAndInput';
import LanguageSelector from '../LanguageSelector';
import { IpcEvents } from '../../../../common/IpcEvents.enum';
import { useTranslation } from 'react-i18next';
import './settings-overlay.css';

interface SettingsOverlayProps {
	isSettingsOpen: boolean;
	handleClose: () => void;
}

type SettingsOverlayClassKey =
	| 'checkboxSettings'
	| 'overlayInnerRoot'
	| 'overlayInsideFade'
	| 'absoluteCloseButton'
	| 'tabNavigationRowButton'
	| 'iconInTablLeftButton';

type SettingsOverlayClassMap = Record<SettingsOverlayClassKey, string>;

const useStyles = makeStyles(() =>
	createStyles({
		checkboxSettings: { margin: '0' },
		overlayInnerRoot: { width: '90%' },
		overlayInsideFade: {
			height: '90vh',
			backgroundColor: LIGHT_UI_BACKGROUND,
		},
		absoluteCloseButton: { position: 'absolute', left: 'calc(100% - 65px)' },
		tabNavigationRowButton: {
			fontWeight: 700,
			padding: '6px 10px',
			borderRadius: '100px',
		},
		iconInTablLeftButton: { marginRight: '5px' },
	}),
);

export default function SettingsOverlay(
	props: SettingsOverlayProps,
): React.ReactElement {
	const [clientViewerPort, setClientViewerPort] = useState('80'); // Default port, can be changed later

	const { handleClose, isSettingsOpen } = props;
	const [currentVersion, setCurrentVersion] = useState('');

	const { t } = useTranslation();

	const classes = useStyles() as SettingsOverlayClassMap;

	useEffect(() => {
		window.electron.ipcRenderer
			.invoke(IpcEvents.GetPort)
			.then((port) => {
				return setClientViewerPort(port);
			})
			.catch((error) => {
				console.error('Error getting port:', error);
			});

		return () => {
			window.electron.ipcRenderer.removeListener(
				'settings-overlay-close',
				handleClose,
			);
		};
	}, [handleClose]);

	useEffect(() => {
		const getCurrentVersion = async (): Promise<void> => {
			const gotCurrentVersion = await window.electron.ipcRenderer.invoke(
				'get-current-version',
			);
			if (gotCurrentVersion !== '') {
				setCurrentVersion(gotCurrentVersion);
			}
		};
		getCurrentVersion();
	}, []);

	const GeneralSettingsPanel: React.FC = () => {
		return (
			<div style={{ width: '100%' }}>
				<Row middle="xs">
					<H3 className="bp3-text-muted">{t('general-settings')}</H3>
				</Row>

				{/*<SettingRowLabelAndInput*/}
				{/*  icon="style"*/}
				{/*  label={t('color-theme')}*/}
				{/*  input={<ToggleThemeBtnGroup />}*/}
				{/*/>*/}
				<div style={{ marginTop: '24px' }}>
					<SettingRowLabelAndInput
						icon="translate"
						label={t('language')}
						input={<LanguageSelector />}
					/>
				</div>

				<Row
					center="xs"
					middle="xs"
					style={{ marginTop: '40px', width: '100%' }}
				>
					<div>
						<Col xs={12}>
							<img
								src={`http://127.0.0.1:${clientViewerPort}/logo512.png`}
								alt="logo"
								style={{ width: '100px' }}
							/>
						</Col>
						<Col xs={12}>
							<H3>{t('about-altronscreen')}</H3>
						</Col>
						<Col xs={12}>
							<Text>{`${t('version')}: ${currentVersion} (${currentVersion})`}</Text>
						</Col>
						<Col xs={12}>
							<Text>
								{`${t('copyright')} © ${new Date().getFullYear()} `}
								<a
									href="https://www.openservicetools.com"
									target="_blank"
									rel="noopener noreferrer"
									className="bp3-link"
									style={{
										color: '#106ba3',
										textDecoration: 'none',
									}}
								>
									OpenServiceTools
								</a>
							</Text>
						</Col>
						<Col xs={12}>
							<Text>
								{`${t('website')}: `}
								<a
									href="https://www.openservicetools.com"
									target="_blank"
									rel="noopener noreferrer"
									className="bp3-link"
									style={{
										color: '#106ba3',
										textDecoration: 'none',
									}}
								>
									https://www.openservicetools.com
								</a>
							</Text>
						</Col>
					</div>
				</Row>
			</div>
		);
	};

	const getTabNavGeneralSettingsButton = (): React.ReactElement => {
		return (
			<Row middle="xs" className={classes.tabNavigationRowButton}>
				<Icon icon="wrench" className={classes.iconInTablLeftButton} />
				<Text className="bp3-text-large">{t('general')}</Text>
			</Row>
		);
	};

	return (
		<Overlay2
			onClose={handleClose}
			className={`${Classes.OVERLAY_SCROLL_CONTAINER} bp3-overlay-settings`}
			autoFocus
			canEscapeKeyClose
			canOutsideClickClose
			enforceFocus
			hasBackdrop
			isOpen={isSettingsOpen}
			usePortal
			transitionDuration={0}
		>
			<div className={classes.overlayInnerRoot}>
				<div
					id="settings-overlay-inner"
					className={`${classes.overlayInsideFade} ${Classes.CARD}`}
					style={{
						borderRadius: '8px',
					}}
				>
					<CloseOverlayButton
						className={classes.absoluteCloseButton}
						onClick={handleClose}
						isDefaultStyles
					/>
					<Tabs
						animate
						id="TabsExample"
						key="vertical"
						renderActiveTabPanelOnly
						vertical
					>
						<Tab
							id="rx"
							title=""
							panel={<GeneralSettingsPanel />}
							panelClassName={'tab-panel-wide-custom-style'}
						>
							{getTabNavGeneralSettingsButton()}
						</Tab>
						<TabsExpander />
					</Tabs>
				</div>
			</div>
		</Overlay2>
	);
}

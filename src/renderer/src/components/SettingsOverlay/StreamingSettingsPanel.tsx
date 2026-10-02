import { useEffect, useState } from 'react';
import {
	Button,
	Callout,
	H3,
	HTMLSelect,
	NumericInput,
} from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import {
	DEFAULT_STREAM_SETTINGS,
	STREAM_PRESETS,
	type StreamSettings,
} from '../../../../common/StreamSettings';
import { IpcEvents } from '../../../../common/IpcEvents.enum';

export default function StreamingSettingsPanel() {
	const { t } = useTranslation();
	const [settings, setSettings] = useState<StreamSettings>({
		...DEFAULT_STREAM_SETTINGS,
	});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState('');
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let cancelled = false;
		window.electron.ipcRenderer
			.invoke(IpcEvents.GetStreamSettings)
			.then((value) => {
				if (!cancelled) setSettings(value);
			})
			.catch((error) => {
				if (!cancelled) {
					setFailed(true);
					setMessage(String(error));
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);
	const preset =
		Object.entries(STREAM_PRESETS).find(([, value]) =>
			Object.keys(value).every(
				(key) =>
					value[key as keyof StreamSettings] ===
					settings[key as keyof StreamSettings],
			),
		)?.[0] || 'custom';
	const save = async () => {
		setSaving(true);
		setMessage('');
		try {
			const result = await window.electron.ipcRenderer.invoke(
				IpcEvents.SetStreamSettings,
				settings,
			);
			setSettings(result.settings);
			setFailed(Boolean(result.warnings.length));
			setMessage(
				result.warnings.length
					? t(
							'Defaults saved, but some active viewers could not be updated. Reconnect those viewers.',
						)
					: t('Settings saved and applied to active streams.'),
			);
		} catch (error) {
			setFailed(true);
			setMessage(String(error));
		} finally {
			setSaving(false);
		}
	};
	return (
		<section
			aria-label={t('Streaming settings')}
			style={{ marginTop: '24px', maxWidth: '640px' }}
		>
			<H3>{t('Streaming settings')}</H3>
			<p>
				{t(
					'Saved defaults apply to new connections. Save to update active viewers without disconnecting them.',
				)}
			</p>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'minmax(140px, 1fr) minmax(160px, 1fr)',
					gap: '12px',
					alignItems: 'center',
				}}
			>
				<label htmlFor="stream-preset">{t('Preset')}</label>
				<HTMLSelect
					id="stream-preset"
					value={preset}
					disabled={loading || saving}
					onChange={(event) => {
						const value = STREAM_PRESETS[event.target.value];
						if (value) setSettings({ ...value });
					}}
				>
					<option value="default">{t('Default')}</option>
					<option value="speed">{t('Speed / low bandwidth')}</option>
					<option value="balanced">{t('Balanced')}</option>
					<option value="quality">{t('High quality')}</option>
					<option value="custom" disabled>
						{t('Custom')}
					</option>
				</HTMLSelect>
				<label htmlFor="stream-frame-rate">{t('Frame rate limit')}</label>
				<HTMLSelect
					id="stream-frame-rate"
					value={settings.frameRate}
					disabled={loading || saving}
					onChange={(event) =>
						setSettings({ ...settings, frameRate: Number(event.target.value) })
					}
				>
					{[15, 24, 30, 60].map((rate) => (
						<option key={rate} value={rate}>
							{rate} FPS
						</option>
					))}
				</HTMLSelect>
				<label htmlFor="stream-resolution">{t('Resolution / quality')}</label>
				<HTMLSelect
					id="stream-resolution"
					value={settings.resolutionScale}
					disabled={loading || saving}
					onChange={(event) =>
						setSettings({
							...settings,
							resolutionScale: Number(event.target.value),
						})
					}
				>
					{[0.25, 0.5, 0.75, 1].map((scale) => (
						<option key={scale} value={scale}>
							{scale * 100}%
						</option>
					))}
				</HTMLSelect>
				<label htmlFor="stream-bitrate">{t('Bitrate limit (Mbps)')}</label>
				<NumericInput
					id="stream-bitrate"
					value={settings.bitrateMbps}
					min={1}
					max={50}
					stepSize={1}
					disabled={loading || saving}
					onValueChange={(value) =>
						setSettings({ ...settings, bitrateMbps: value })
					}
				/>
				<label htmlFor="stream-latency">{t('Latency preference')}</label>
				<HTMLSelect
					id="stream-latency"
					value={settings.latency}
					disabled={loading || saving}
					onChange={(event) =>
						setSettings({
							...settings,
							latency: event.target.value as StreamSettings['latency'],
						})
					}
				>
					<option value="interactive">
						{t('Interactive / lowest buffering')}
					</option>
					<option value="balanced">{t('Balanced')}</option>
					<option value="smooth">{t('Smooth / more buffering')}</option>
				</HTMLSelect>
				<label htmlFor="stream-content">{t('Content preference')}</label>
				<HTMLSelect
					id="stream-content"
					value={settings.contentHint}
					disabled={loading || saving}
					onChange={(event) =>
						setSettings({
							...settings,
							contentHint: event.target.value as StreamSettings['contentHint'],
						})
					}
				>
					<option value="motion">{t('Smooth motion')}</option>
					<option value="detail">{t('Sharp text and detail')}</option>
				</HTMLSelect>
			</div>
			<p style={{ color: '#5c7080', fontSize: '13px' }}>
				{t(
					'These are capture and bitrate limits, not guaranteed speeds. Latency depends on the network and hardware; receiver buffering is applied where supported by the browser.',
				)}
			</p>
			<div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
				<Button
					intent="primary"
					loading={saving}
					disabled={loading}
					onClick={save}
				>
					{t('Save streaming settings')}
				</Button>
				<Button
					disabled={loading || saving}
					onClick={() => setSettings({ ...DEFAULT_STREAM_SETTINGS })}
				>
					{t('Restore defaults')}
				</Button>
			</div>
			{message && (
				<Callout
					role="status"
					intent={failed ? 'warning' : 'success'}
					style={{ marginTop: '12px' }}
				>
					{message}
				</Callout>
			)}
		</section>
	);
}

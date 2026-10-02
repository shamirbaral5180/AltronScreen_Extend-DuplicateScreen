import { useEffect, useState } from 'react';
import { Button, Callout, H3, HTMLSelect } from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import { IpcEvents } from '../../../../common/IpcEvents.enum';

interface Resolution {
	width: number;
	height: number;
}

const keyOf = (resolution: Resolution): string =>
	`${resolution.width}x${resolution.height}`;

export default function ExtendedDisplaySettingsPanel() {
	const { t } = useTranslation();
	const [options, setOptions] = useState<Resolution[]>([]);
	const [selected, setSelected] = useState('1360x768');
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState('');
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			window.electron.ipcRenderer.invoke(
				IpcEvents.GetVirtualDisplayResolutionOptions,
			),
			window.electron.ipcRenderer.invoke(IpcEvents.GetVirtualDisplayResolution),
		])
			.then(([available, current]: [Resolution[], Resolution]) => {
				if (cancelled) return;
				setOptions(available);
				setSelected(keyOf(current));
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

	const save = async () => {
		setSaving(true);
		setMessage('');
		try {
			const [width, height] = selected.split('x').map(Number);
			await window.electron.ipcRenderer.invoke(
				IpcEvents.SetVirtualDisplayResolution,
				{ width, height },
			);
			setFailed(false);
			setMessage(
				t(
					'Saved. This is the default size of the extended screen. You can still change the resolution from Windows Display Settings while it is active.',
				),
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
			aria-label={t('Extended display')}
			style={{ marginTop: '24px', maxWidth: '640px' }}
		>
			<H3>{t('Extended display')}</H3>
			<p>
				{t(
					'Choose the default resolution for the virtual extended screen. Other standard sizes remain selectable in Windows Display Settings.',
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
				<label htmlFor="extended-display-resolution">
					{t('Extended screen resolution')}
				</label>
				<HTMLSelect
					id="extended-display-resolution"
					value={selected}
					disabled={loading || saving}
					onChange={(event) => setSelected(event.target.value)}
				>
					{options.map((option) => (
						<option key={keyOf(option)} value={keyOf(option)}>
							{keyOf(option)}
						</option>
					))}
				</HTMLSelect>
			</div>
			<div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
				<Button
					intent="primary"
					loading={saving}
					disabled={loading}
					onClick={save}
				>
					{t('Save extended display resolution')}
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

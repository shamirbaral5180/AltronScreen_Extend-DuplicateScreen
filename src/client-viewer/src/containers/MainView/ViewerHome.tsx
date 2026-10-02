import { useEffect, useState } from 'react';
import {
	Button,
	Callout,
	Card,
	H3,
	InputGroup,
	Spinner,
} from '@blueprintjs/core';
import { useTranslation } from 'react-i18next';
import logo from '../../images/altronscreen_logo_128x128.png';
import './viewer-home.css';

interface Host {
	name: string;
	url: string;
	current?: boolean;
}

export default function ViewerHome({
	onConnect,
	notice,
}: {
	onConnect: () => void;
	notice: string;
}) {
	const { t } = useTranslation();
	const [hosts, setHosts] = useState<Host[]>([
		{
			name: t('This sharing computer'),
			url: window.location.origin,
			current: true,
		},
	]);
	const [address, setAddress] = useState('');
	const [addressError, setAddressError] = useState('');
	const [online, setOnline] = useState(true);
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		let cancelled = false;
		let controller: AbortController | null = null;
		const refresh = async () => {
			controller?.abort();
			controller = new AbortController();
			const timeout = setTimeout(() => controller?.abort(), 3500);
			try {
				const response = await fetch('/api/hosts', {
					cache: 'no-store',
					signal: controller.signal,
				});
				if (!response.ok) throw new Error('Host unavailable');
				const data = await response.json();
				const valid = Array.isArray(data)
					? data.filter((host) => {
							try {
								return (
									typeof host.name === 'string' &&
									['http:', 'https:'].includes(new URL(host.url).protocol)
								);
							} catch {
								return false;
							}
						})
					: [];
				if (!cancelled) {
					setOnline(true);
					if (valid.length) setHosts(valid);
				}
			} catch {
				if (!cancelled) setOnline(false);
			} finally {
				clearTimeout(timeout);
				if (!cancelled) setLoading(false);
			}
		};
		void refresh();
		const timer = setInterval(refresh, 5000);
		return () => {
			cancelled = true;
			clearInterval(timer);
			controller?.abort();
		};
	}, []);
	const connectAddress = (event: React.FormEvent) => {
		event.preventDefault();
		try {
			const url = new URL(
				address.includes('://') ? address : `http://${address}`,
			);
			if (
				!['http:', 'https:'].includes(url.protocol) ||
				url.username ||
				url.password
			)
				throw new Error();
			if (url.origin === window.location.origin) onConnect();
			else window.location.assign(`${url.origin}/?connect=1`);
		} catch {
			setAddressError(
				t(
					'Enter a valid sharing computer URL, for example http://192.168.1.10:3131.',
				),
			);
		}
	};
	return (
		<main className="viewer-home" data-testid="viewer-home">
			<img src={logo} alt="AltronScreen" width="72" height="72" />
			<H3>AltronScreen Viewer</H3>
			<p>
				{t(
					'Choose a sharing computer to request access. The host must allow your connection.',
				)}
			</p>
			{notice && (
				<Callout className="viewer-home-notice" intent="none">
					{t(notice)}
				</Callout>
			)}
			<H3>{t('Nearby sharing computers')}</H3>
			{loading && <Spinner size={20} />}
			{hosts.map((host) => (
				<Card key={host.url} className="viewer-host-card">
					<strong>{host.name}</strong>
					<a
						data-testid={
							host.current ? 'connect-current-host' : 'connect-nearby-host'
						}
						href={host.current ? host.url : `${host.url}/?connect=1`}
						onClick={
							host.current
								? (event) => {
										event.preventDefault();
										onConnect();
									}
								: undefined
						}
					>
						{host.url}
					</a>
					{host.current && !online && (
						<span>
							{t('Host unavailable. You can retry when it is running.')}
						</span>
					)}
					<Button
						intent="primary"
						onClick={() =>
							host.current
								? onConnect()
								: window.location.assign(`${host.url}/?connect=1`)
						}
					>
						{t('Request connection')}
					</Button>
				</Card>
			))}
			<p className="viewer-discovery-hint">
				{t(
					'Nearby computers must run AltronScreen on the same LAN. If broadcasts are blocked, enter their URL below.',
				)}
			</p>
			<form onSubmit={connectAddress} className="viewer-address-form">
				<label htmlFor="sharing-host-url">{t('Sharing computer URL')}</label>
				<InputGroup
					id="sharing-host-url"
					value={address}
					onChange={(event) => {
						setAddress(event.target.value);
						setAddressError('');
					}}
					placeholder="http://192.168.1.10:3131"
				/>
				<Button type="submit" disabled={!address.trim()}>
					{t('Connect')}
				</Button>
			</form>
			{addressError && <Callout intent="warning">{addressError}</Callout>}
		</main>
	);
}

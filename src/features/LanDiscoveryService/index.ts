import dgram from 'node:dgram';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const DISCOVERY_PORT = 31333;
const TTL_MS = 20000;
const isPrivate = (ip: string) =>
	/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip);

export interface NearbyHost {
	name: string;
	url: string;
	current?: boolean;
}

export default class LanDiscoveryService {
	private readonly id = randomUUID();
	private socket: dgram.Socket | null = null;
	private timer: NodeJS.Timeout | null = null;
	private port = 0;
	private readonly hosts = new Map<string, NearbyHost & { seen: number }>();

	start(port: number): void {
		if (this.socket) return;
		this.port = port;
		const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
		this.socket = socket;
		socket.on('error', (error) => {
			console.warn('LAN discovery unavailable:', error.message);
			this.stop();
		});
		socket.on('message', (bytes, remote) => {
			if (bytes.length > 1024 || !isPrivate(remote.address)) return;
			try {
				const message = JSON.parse(bytes.toString('utf8'));
				if (
					message.app !== 'altronscreen' ||
					message.version !== 1 ||
					message.id === this.id ||
					typeof message.name !== 'string' ||
					!Number.isInteger(message.port) ||
					message.port < 1 ||
					message.port > 65535
				)
					return;
				const url = `http://${remote.address}:${message.port}`;
				if (this.hosts.size >= 64 && !this.hosts.has(url)) return;
				this.hosts.set(url, {
					name: message.name.slice(0, 80),
					url,
					seen: Date.now(),
				});
			} catch {
				/* Ignore unrelated UDP traffic. */
			}
		});
		socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
			if (this.socket !== socket) return;
			socket.setBroadcast(true);
			socket.unref();
			this.announce();
			this.timer = setInterval(() => this.announce(), 5000);
			this.timer.unref();
		});
	}

	private announce(): void {
		const bytes = Buffer.from(
			JSON.stringify({
				app: 'altronscreen',
				version: 1,
				id: this.id,
				name: os.hostname(),
				port: this.port,
			}),
		);
		for (const entries of Object.values(os.networkInterfaces())) {
			for (const entry of entries ?? []) {
				if (
					entry.family !== 'IPv4' ||
					entry.internal ||
					!isPrivate(entry.address)
				)
					continue;
				const address = entry.address.split('.').map(Number);
				const mask = entry.netmask.split('.').map(Number);
				const broadcast = address
					.map((part, index) => part | (~mask[index] & 255))
					.join('.');
				this.socket?.send(bytes, DISCOVERY_PORT, broadcast, (error) => {
					if (error) console.debug('LAN announcement failed:', error.message);
				});
			}
		}
	}

	list(currentUrl: string): NearbyHost[] {
		for (const [key, host] of this.hosts)
			if (Date.now() - host.seen > TTL_MS) this.hosts.delete(key);
		return [
			{ name: os.hostname(), url: currentUrl, current: true },
			...[...this.hosts.values()]
				.filter((host) => host.url !== currentUrl)
				.map(({ name, url }) => ({ name, url })),
		];
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		try {
			this.socket?.close();
		} catch {
			/* The socket may have failed before binding. */
		}
		this.socket = null;
	}
}

export default {
	host: window.location.hostname,
	protocol: window.location.protocol.replace(':', ''),
	// Production signaling must use the same port as the served viewer page.
	port: import.meta.env.DEV
		? 3131
		: Number(
				window.location.port ||
					(window.location.protocol === 'https:' ? 443 : 80),
			),
};

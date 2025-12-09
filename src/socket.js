const WebSocket = require('ws');

const HEARTBEAT_INTERVAL_MS = 15000;
const AUTH_TIMEOUT_MS = 8000;

const safeParse = (raw) => {
	try {
		return JSON.parse(raw.toString());
	} catch (err) {
		return null;
	}
};

function startHeartbeat(sendFn) {
	return setInterval(() => {
		try {
			sendFn({ type: 'ping' });
		} catch (err) {
			/* noop */
		}
	}, HEARTBEAT_INTERVAL_MS);
}

function connectWebSocket({ wsUrl, jwt, timezone, onMessage, onReady, onClose, onError }) {
	const ws = new WebSocket(wsUrl);
	let heartbeat = null;
	let authTimeout = null;

	const send = (payload) => {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify(payload));
	};

	const teardownHeartbeat = () => {
		if (heartbeat) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
	};

	const clearAuthTimeout = () => {
		if (authTimeout) {
			clearTimeout(authTimeout);
			authTimeout = null;
		}
	};

	ws.on('open', () => {
		send({ type: 'auth', token: jwt, timezone });
		authTimeout = setTimeout(() => {
			onError?.(new Error('WebSocket auth timeout'));
			ws.close(4001, 'Auth timeout');
		}, AUTH_TIMEOUT_MS);
	});

	ws.on('message', (raw) => {
		const payload = safeParse(raw);
		onMessage?.(payload);

		if (!payload) return;

		if (payload.type === 'auth_success') {
			clearAuthTimeout();
			heartbeat = startHeartbeat(send);
			onReady?.(payload);
		}
	});

	ws.on('close', (code, reason) => {
		clearAuthTimeout();
		teardownHeartbeat();
		onClose?.({ code, reason: reason?.toString?.() || '' });
	});

	ws.on('error', (err) => {
		clearAuthTimeout();
		teardownHeartbeat();
		onError?.(err);
	});

	return {
		send,
		close: () => ws.close(),
		get raw() {
			return ws;
		},
	};
}

module.exports = {
	connectWebSocket,
};

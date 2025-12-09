const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const Module = require('module');

let lastSocket = null;

class FakeWebSocket extends EventEmitter {
	constructor() {
		super();
		this.readyState = FakeWebSocket.CONNECTING;
		this.sent = [];
		lastSocket = this;
		setImmediate(() => {
			this.readyState = FakeWebSocket.OPEN;
			this.emit('open');
		});
	}

	send(payload) {
		this.sent.push(payload);
		try {
			const parsed = JSON.parse(payload);
			if (parsed?.type === 'auth') {
				setImmediate(() => {
					this.emit('message', JSON.stringify({ type: 'auth_success' }));
				});
			}
		} catch (err) {
			// ignore parse issues in tests
		}
	}

	close(code = 1000, reason = '') {
		this.readyState = FakeWebSocket.CLOSED;
		this.emit('close', code, reason);
	}
}

FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;

const mockFetch = (responseBody) => {
	const original = global.fetch;
	global.fetch = async () => ({
		ok: true,
		status: 200,
		json: async () => responseBody,
	});
	return () => {
		global.fetch = original;
	};
};

const mockWebSocket = () => {
	const originalLoad = Module._load;
	Module._load = (request, parent, isMain) => {
		if (request === 'ws') return FakeWebSocket;
		return originalLoad(request, parent, isMain);
	};
	return () => {
		Module._load = originalLoad;
		lastSocket = null;
	};
};

const liveConfig = {
	botId: process.env.SDK_LIVE_BOT_ID,
	botToken: process.env.SDK_LIVE_BOT_TOKEN,
	baseUrl: process.env.SDK_LIVE_BASE_URL || 'https://api.syncre.xyz/v1',
	wsUrl: process.env.SDK_LIVE_WS_URL || 'wss://api.syncre.xyz/ws',
};

const hasLiveConfig = Boolean(liveConfig.botId && liveConfig.botToken);

const loadClient = () => {
	delete require.cache[require.resolve('../src/client')];
	delete require.cache[require.resolve('../src/socket')];
	delete require.cache[require.resolve('../src/httpClient')];
	delete require.cache[require.resolve('../index')];
	return require('../src/client');
};

test('authenticate fetches and stores JWT (mocked HTTP)', async () => {
	const restoreFetch = mockFetch({ token: 'jwt-token', user: { id: 'bot-1' } });
	const Client = loadClient();
	const client = new Client({ botId: 'bot-1', botToken: 'secret', baseUrl: 'https://example.com' });

	const result = await client.authenticate();

	assert.equal(result.token, 'jwt-token');
	assert.equal(client.jwt, 'jwt-token');
	assert.deepEqual(client.botUser, { id: 'bot-1' });
	restoreFetch();
});

test('connect authenticates over WebSocket and forwards messages (mocked ws)', async () => {
	const restoreFetch = mockFetch({ token: 'jwt-token', user: { id: 'bot-1' } });
	const restoreWs = mockWebSocket();
	const Client = loadClient();
	const client = new Client({ botId: 'bot-1', botToken: 'secret', baseUrl: 'https://example.com', wsUrl: 'wss://ws.example.com' });

	const readyPromise = new Promise((resolve) => client.on('ready', resolve));
	const messagePromise = new Promise((resolve) => client.on('message', resolve));

	await client.connect();
	await readyPromise;

	await client.sendMessage('chat-1', 'Hello');
	const outbound = lastSocket.sent.map((entry) => JSON.parse(entry));
	const authFrame = outbound.find((p) => p.type === 'auth');
	const sendFrame = outbound.find((p) => p.type === 'message_send');

	assert.ok(authFrame, 'auth frame should be sent');
	assert.equal(sendFrame.chatId, 'chat-1');
	assert.equal(sendFrame.content, 'Hello');

	const incoming = { type: 'new_message', messageId: 123, chatId: 'chat-1' };
	lastSocket.emit('message', JSON.stringify(incoming));
	const received = await messagePromise;
	assert.equal(received.messageId, 123);

	client.close();
	restoreFetch();
	restoreWs();
});

test('live bot login and websocket auth (optional)', { timeout: 20000, skip: !hasLiveConfig }, async () => {
	const Client = loadClient();
	const client = new Client({
		botId: liveConfig.botId,
		botToken: liveConfig.botToken,
		baseUrl: liveConfig.baseUrl,
		wsUrl: liveConfig.wsUrl,
	});

	const readyPromise = new Promise((resolve) => client.on('ready', resolve));
	const rawFrames = [];
	client.on('raw', (payload) => rawFrames.push(payload));

	await client.connect();
	await readyPromise;

	assert.ok(client.jwt, 'JWT should be set after live login');
	assert.equal(client.botUser?.id?.toString(), liveConfig.botId?.toString());
	assert.ok(rawFrames.find((f) => f?.type === 'auth_success'), 'auth_success frame received');

	client.close();
});

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const Module = require('module');

let originalLoad = null;
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

const loadClient = () => {
	delete require.cache[require.resolve('../src/client')];
	delete require.cache[require.resolve('../src/socket')];
	delete require.cache[require.resolve('../src/httpClient')];
	delete require.cache[require.resolve('../index')];
	return require('../src/client');
};

beforeEach(() => {
	originalLoad = Module._load;
	Module._load = (request, parent, isMain) => {
		if (request === 'ws') return FakeWebSocket;
		return originalLoad(request, parent, isMain);
	};
	lastSocket = null;
});

afterEach(() => {
	Module._load = originalLoad;
	lastSocket = null;
});

test('authenticate fetches and stores JWT', async () => {
	const restoreFetch = mockFetch({ token: 'jwt-token', user: { id: 'bot-1' } });
	const Client = loadClient();
	const client = new Client({ botId: 'bot-1', botToken: 'secret', baseUrl: 'https://example.com' });

	const result = await client.authenticate();

	assert.equal(result.token, 'jwt-token');
	assert.equal(client.jwt, 'jwt-token');
	assert.deepEqual(client.botUser, { id: 'bot-1' });
	restoreFetch();
});

test('connect authenticates over WebSocket and forwards messages', async () => {
	const restoreFetch = mockFetch({ token: 'jwt-token', user: { id: 'bot-1' } });
	const Client = loadClient();
	const client = new Client({ botId: 'bot-1', botToken: 'secret', baseUrl: 'https://example.com', wsUrl: 'wss://ws.example.com' });

	const readyPromise = new Promise((resolve) => client.on('ready', resolve));
	const messagePromise = new Promise((resolve) => client.on('message', resolve));

	const connectPromise = client.connect();

	// Wait for socket to be created and simulate auth success
	await new Promise((r) => setImmediate(r));
	assert.ok(lastSocket, 'WebSocket should be created');

	// Server confirms auth
	lastSocket.emit('message', JSON.stringify({ type: 'auth_success' }));
	await connectPromise;
	await readyPromise;

	// send a message through the client
	await client.sendMessage('chat-1', 'Hello');
	const outbound = lastSocket.sent.map((entry) => JSON.parse(entry));
	const authFrame = outbound.find((p) => p.type === 'auth');
	const sendFrame = outbound.find((p) => p.type === 'message_send');

	assert.ok(authFrame, 'auth frame should be sent');
	assert.equal(sendFrame.chatId, 'chat-1');
	assert.equal(sendFrame.content, 'Hello');

	// Simulate inbound chat message
	const incoming = { type: 'new_message', messageId: 123, chatId: 'chat-1' };
	lastSocket.emit('message', JSON.stringify(incoming));
	const received = await messagePromise;
	assert.equal(received.messageId, 123);

	client.close();

	restoreFetch();
});
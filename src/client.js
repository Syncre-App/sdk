const EventEmitter = require('events');
const HttpClient = require('./httpClient');
const { connectWebSocket } = require('./socket');

class SyncreBotClient extends EventEmitter {
	constructor(options = {}) {
		super();
		const {
			baseUrl = 'https://api.syncre.xyz/v1',
			wsUrl = 'wss://api.syncre.xyz/ws',
			botId,
			botToken,
			timezone = 'UTC',
		} = options;

		if (!botId) throw new Error('botId is required to initialize the Syncre SDK');
		if (!botToken) throw new Error('botToken is required to initialize the Syncre SDK');

		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.wsUrl = wsUrl;
		this.botId = botId;
		this.botToken = botToken;
		this.timezone = timezone;

		this.jwt = null;
		this.botUser = null;
		this.socket = null;
		this.connecting = null;
		this.authenticated = false;

		this.http = new HttpClient({
			baseUrl: this.baseUrl,
			tokenProvider: () => this.jwt,
		});
	}

	async authenticate() {
		const response = await this.http.request('/auth/bot-login', {
			method: 'POST',
			body: JSON.stringify({ botId: this.botId, botToken: this.botToken }),
		});

		if (!response?.token) {
			const error = new Error('Bot authentication failed');
			error.response = response;
			throw error;
		}

		this.jwt = response.token;
		this.botUser = response.user;
		this.emit('token', this.jwt);
		return response;
	}

	async connect() {
		if (this.authenticated && this.socket?.raw?.readyState === 1) {
			return;
		}

		if (!this.jwt) {
			await this.authenticate();
		}

		if (this.connecting) {
			return this.connecting;
		}

		this.connecting = new Promise((resolve, reject) => {
			this.socket = connectWebSocket({
				wsUrl: this.wsUrl,
				jwt: this.jwt,
				timezone: this.timezone,
				onMessage: (payload) => this._handleSocketMessage(payload),
				onReady: (payload) => {
					this.authenticated = true;
					this.connecting = null;
					this.emit('ready', payload);
					resolve();
				},
				onClose: (info) => {
					this.authenticated = false;
					this.connecting = null;
					this.emit('disconnect', info);
				},
				onError: (err) => {
					this.authenticated = false;
					this.connecting = null;
					this.emit('socketError', err);
					reject(err);
				},
			});
		});

		return this.connecting;
	}

	async sendMessage(chatId, content, options = {}) {
		if (!chatId || !content) {
			throw new Error('chatId and content are required');
		}
		await this.connect();
		const payload = {
			type: 'message_send',
			chatId,
			content: content.toString(),
			message_type: options.messageType || 'text',
		};
		if (options.reply) payload.replyMetadata = options.reply;
		if (options.attachments) payload.attachments = options.attachments;
		this._send(payload);
		return payload;
	}

	async joinChat(chatId, deviceId) {
		if (!chatId) throw new Error('chatId is required');
		await this.connect();
		this._send({ type: 'chat_join', chatId, deviceId: deviceId || undefined });
	}

	async leaveChat(chatId) {
		if (!chatId) throw new Error('chatId is required');
		await this.connect();
		this._send({ type: 'chat_leave', chatId });
	}

	async markSeen(chatId, messageId) {
		if (!chatId || !messageId) throw new Error('chatId and messageId are required');
		await this.connect();
		this._send({ type: 'message_seen', chatId, messageId });
	}

	setBotToken(nextToken) {
		this.botToken = nextToken;
		this.jwt = null;
	}

	close() {
		this.authenticated = false;
		this.connecting = null;
		if (this.socket) this.socket.close();
		this.socket = null;
	}

	_handleSocketMessage(payload) {
		this.emit('raw', payload);
		if (!payload) return;
		if (payload.type === 'error') {
			this.emit('socketError', payload);
			return;
		}
		if (payload.type === 'new_message') {
			this.emit('message', payload);
			return;
		}
		if (payload.type === 'message_status') {
			this.emit('messageStatus', payload);
			return;
		}
	}

	_send(payload) {
		if (!this.socket || this.socket.raw.readyState !== 1) {
			throw new Error('WebSocket is not connected');
		}
		if (!this.authenticated) {
			throw new Error('WebSocket is not authenticated yet');
		}
		this.socket.send(payload);
	}
}

module.exports = SyncreBotClient;

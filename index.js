const EventEmitter = require('events');
const WebSocket = require('ws');

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

    if (!botId) {
      throw new Error('botId is required to initialize the Syncre SDK');
    }
    if (!botToken) {
      throw new Error('botToken is required to initialize the Syncre SDK');
    }

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.wsUrl = wsUrl;
    this.botId = botId;
    this.botToken = botToken;
    this.timezone = timezone;

    this.jwt = null;
    this.botUser = null;
    this.ws = null;
    this.connecting = null;
    this.authenticated = false;
    this.heartbeat = null;
  }

  async authenticate() {
    const response = await this._request('/auth/bot-login', {
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
    if (this.authenticated && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (!this.jwt) {
      await this.authenticate();
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      this.authenticated = false;

      const authTimeout = setTimeout(() => {
        reject(new Error('WebSocket auth timeout'));
        ws.close(4001, 'Auth timeout');
      }, 8000);

      ws.on('open', () => {
        this._send({ type: 'auth', token: this.jwt, timezone: this.timezone }, false);
      });

      ws.on('message', (raw) => {
        this._handleSocketMessage(raw, resolve, authTimeout);
      });

      ws.on('error', (err) => {
        clearTimeout(authTimeout);
        this.connecting = null;
        if (!this.authenticated) {
          reject(err);
        }
        this.emit('socketError', err);
      });

      ws.on('close', (code, reason) => {
        clearTimeout(authTimeout);
        this.connecting = null;
        this.authenticated = false;
        this._stopHeartbeat();
        this.emit('disconnect', { code, reason: reason?.toString?.() || '' });
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

    if (options.reply) {
      payload.replyMetadata = options.reply;
    }

    if (options.attachments && Array.isArray(options.attachments)) {
      payload.attachments = options.attachments;
    }

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
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close();
    }
    this.ws = null;
    this.authenticated = false;
    this.connecting = null;
  }

  async _request(path, options = {}) {
    if (typeof fetch !== 'function') {
      throw new Error('Global fetch is not available. Node.js 18+ is required.');
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (this.jwt) {
      headers.Authorization = `Bearer ${this.jwt}`;
    }

    const url = this._buildUrl(path);
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.message || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.response = data;
      throw error;
    }

    return data;
  }

  _buildUrl(path) {
    if (!path.startsWith('/')) {
      return `${this.baseUrl}/${path}`;
    }
    return `${this.baseUrl}${path}`;
  }

  _send(payload, ensureAuth = true) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    if (ensureAuth && !this.authenticated) {
      throw new Error('WebSocket is not authenticated yet');
    }

    this.ws.send(JSON.stringify(payload));
  }

  _handleSocketMessage(raw, resolve, authTimeout) {
    try {
      const payload = JSON.parse(raw.toString());
      this.emit('raw', payload);

      if (payload.type === 'auth_success') {
        this.authenticated = true;
        this._startHeartbeat();
        clearTimeout(authTimeout);
        this.connecting = null;
        this.emit('ready', payload);
        if (resolve) resolve();
        return;
      }

      if (payload.type === 'error') {
        this.emit('socketError', payload);
        return;
      }

      if (payload.type === 'new_message') {
        this.emit('message', payload);
      }

      if (payload.type === 'message_status') {
        this.emit('messageStatus', payload);
      }

      if (payload.type === 'pong') {
        return;
      }
    } catch (err) {
      this.emit('socketError', err);
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeat = setInterval(() => {
      try {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this._send({ type: 'ping' }, false);
        }
      } catch (err) {
        this.emit('socketError', err);
      }
    }, 15000);
  }

  _stopHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}

module.exports = {
  SyncreBotClient,
};

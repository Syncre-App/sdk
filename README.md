# Syncre Bot SDK

Node.js helper for driving Syncre bot accounts over the HTTP API and WebSocket gateway.

## Installation

```bash
npm install @syncre/sdk
# or from this repo
npm install ./sdk
```

Requirements: Node.js 18+ (uses native `fetch`) and a bot token created in the Syncre mobile app (Settings → Developer → Bot Account).

## Quick start

```js
const { SyncreBotClient } = require('@syncre/sdk');

const client = new SyncreBotClient({
  baseUrl: 'https://api.syncre.xyz/v1',
  wsUrl: 'wss://api.syncre.xyz/ws',
  botId: '<your bot user id>',
  botToken: '<one-time bot token>',
});

client.on('ready', () => console.log('SDK authenticated'));
client.on('message', (msg) => console.log('message', msg));
client.on('messageStatus', (status) => console.log('status', status));
client.on('socketError', console.error);

(async () => {
  await client.connect();
  await client.joinChat('<chat id>');
  await client.sendMessage('<chat id>', 'Hello from my bot!');
})();
```

## API

- `new SyncreBotClient(options)` – options: `baseUrl`, `wsUrl`, `botId`, `botToken`, `timezone`.
- `authenticate()` – fetches a JWT via `/auth/bot-login`.
- `connect()` – opens the WebSocket, authenticates, and starts the heartbeat.
- `sendMessage(chatId, content, options?)` – send a plain text message (`messageType`, `reply`, `attachments`).
- `joinChat(chatId, deviceId?)` / `leaveChat(chatId)` – manage presence for delivery receipts.
- `markSeen(chatId, messageId)` – mark a message as seen.
- `setBotToken(token)` – set a rotated bot token (forces a fresh login on next connect).
- `close()` – closes the WebSocket and stops the heartbeat.

### Events

- `ready` – WebSocket authenticated.
- `message` – new chat message payload from the gateway.
- `messageStatus` – delivery/seen updates.
- `socketError` – WebSocket/parsing errors.
- `disconnect` – socket closed (`code`, `reason`).
- `raw` – every parsed inbound frame for custom handling.

## Notes

- Bot accounts cannot sign in with email/password; they must use this SDK (`/auth/bot-login`).
- Each bot request in the app issues a new token and revokes previous JWTs; update `botToken` and reconnect to rotate credentials.

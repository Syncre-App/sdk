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

### Bot token megszerzése

1) Appból: Settings → Developer → Bot Account → „Create bot token” (egyedi token, csak egyszer látható, ilyenkor a fiók role-ja `bot` lesz).
2) API-ból: authenticated user JWT-vel hívd meg a `POST /v1/user/request-bot`-ot. Válasz:

```bash
curl -X POST \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"CI bot"}' \
  https://api.syncre.xyz/v1/user/request-bot

# Válasz: { success: true, bot_status: "approved", role: "bot", bot_token: "..." }
```

3) Bot login az SDK/bármi számára: `POST /v1/auth/bot-login` a bot ID + bot token párossal:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"botId":"<bot user id>","botToken":"<bot token>"}' \
  https://api.syncre.xyz/v1/auth/bot-login

# Válasz: { token: "<jwt>", user: { id, username, role: "bot", ... } }
```

Ezt a JWT-t használja a `SyncreBotClient` is automatikusan a `connect()` előtt.

## Testing

- Unit tests (mocked HTTP/WebSocket): `npm test`
- Optional live integration test (real bot login + WS auth): set env vars before running `npm test`:
  - `SDK_LIVE_BOT_ID`
  - `SDK_LIVE_BOT_TOKEN`
  - `SDK_LIVE_BASE_URL` (defaults to https://api.syncre.xyz/v1)
  - `SDK_LIVE_WS_URL` (defaults to wss://api.syncre.xyz/ws)
  The live test is skipped if the bot env vars are missing.

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

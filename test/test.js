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
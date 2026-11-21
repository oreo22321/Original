// Discord bot (discord.js)
// 1. 設定タブの「環境変数」に DISCORD_TOKEN を追加 (Discord Developer Portal の Bot → Reset Token で取得)
// 2. Developer Portal の Bot → Privileged Gateway Intents で「MESSAGE CONTENT INTENT」をオン
// 3. ▶ 起動 を押して、サーバーで !ping と送ってみてください
const { Client, Events, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`ログインしました: ${c.user.tag}`);
  console.log(`参加しているサーバー: ${c.guilds.cache.size} 個`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    await message.reply(`Pong! ${client.ws.ping}ms`);
  } else if (message.content === '!hello') {
    await message.reply(`こんにちは、${message.member?.displayName ?? message.author.username} さん！`);
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('環境変数 DISCORD_TOKEN がありません。設定タブで追加してから起動してください。');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);

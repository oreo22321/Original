// Twitch のチャット bot (tmi.js)
// 1. bot 用の Twitch アカウントでログインして、チャット用のトークン (oauth:…) を取る
//    (例: https://twitchtokengenerator.com/ などのサービスで「Bot Chat Token」)
// 2. 設定タブの「環境変数」に TWITCH_USERNAME (bot のアカウント名)・TWITCH_OAUTH (oauth:…)・TWITCH_CHANNEL (入るチャンネル) を入れる
// 3. ▶ 起動 → チャットで !hello や !dice と送ってみてください
const tmi = require('tmi.js');

const { TWITCH_USERNAME, TWITCH_OAUTH, TWITCH_CHANNEL } = process.env;
if (!TWITCH_USERNAME || !TWITCH_OAUTH || !TWITCH_CHANNEL) {
  console.error('環境変数 TWITCH_USERNAME・TWITCH_OAUTH・TWITCH_CHANNEL を設定タブで追加してから起動してください。');
  process.exit(1);
}

const client = new tmi.Client({
  identity: { username: TWITCH_USERNAME, password: TWITCH_OAUTH },
  channels: TWITCH_CHANNEL.split(',').map((c) => c.trim()),
});

client.on('message', (channel, tags, message, self) => {
  if (self) return;
  const text = message.trim().toLowerCase();
  if (text === '!hello') client.say(channel, `@${tags['display-name']} こんにちは！`);
  if (text === '!dice') client.say(channel, `🎲 ${Math.floor(Math.random() * 6) + 1}`);
});

client.connect().then(() => console.log(`Twitch のチャット (${TWITCH_CHANNEL}) に入りました`));

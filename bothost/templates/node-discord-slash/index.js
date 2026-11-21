// Discord bot (スラッシュコマンド / discord.js)
// スラッシュコマンドは「MESSAGE CONTENT INTENT」が要らないので、設定が少なくて済みます。
// 1. 設定タブの「Discord」に DISCORD_TOKEN を入れて「確認」→ 出た招待リンクでサーバーに入れる
// 2. ▶ 起動 → Discord で / と打つと、/ping /dice /say が出ます
const { Client, Events, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('返事をします'),
  new SlashCommandBuilder().setName('dice').setDescription('サイコロを振ります')
    .addIntegerOption((o) => o.setName('面').setDescription('何面のサイコロか (ふつうは 6)').setMinValue(2).setMaxValue(1000)),
  new SlashCommandBuilder().setName('say').setDescription('代わりに言います')
    .addStringOption((o) => o.setName('文').setDescription('言うこと').setRequired(true)),
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  await c.application.commands.set(commands.map((cmd) => cmd.toJSON()));
  console.log(`${c.user.tag} でログインしました。スラッシュコマンドを ${commands.length} 個登録しました`);
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName === 'ping') await i.reply(`🏓 Pong! (${client.ws.ping} ms)`);
  if (i.commandName === 'dice') {
    const n = i.options.getInteger('面') ?? 6;
    await i.reply(`🎲 ${Math.floor(Math.random() * n) + 1} (${n} 面)`);
  }
  if (i.commandName === 'say') await i.reply(i.options.getString('文'));
});

if (!process.env.DISCORD_TOKEN) {
  console.error('環境変数 DISCORD_TOKEN がありません。設定タブで追加してから起動してください。');
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);

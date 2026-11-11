'use strict';

const path = require('node:path');
const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { Store } = require('./store');
const { handleComponent } = require('./handlers/components');
const { UserError } = require('./lib/errors');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .env が無い場合はサーバーの環境変数を使う
}

const token = process.env.DISCORD_TOKEN;
if (!token || token === 'ここにBotのトークンを貼る') {
  console.error('❌ DISCORD_TOKEN が設定されていません。.env.example を .env にコピーして、Bot のトークンを書いてください。');
  process.exit(1);
}

const store = new Store(process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json'));
const commands = new Map(
  ['setup', 'product', 'panel', 'config', 'order', 'stats', 'shop'].map((name) => {
    const cmd = require(`./commands/${name}`);
    return [cmd.data.name, cmd];
  }),
);
const commandJson = [...commands.values()].map((c) => c.data.toJSON());
const ctx = { store };

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

async function registerCommands(guild) {
  try {
    await guild.commands.set(commandJson);
    console.log(`✅ コマンドを登録しました: ${guild.name}`);
  } catch (err) {
    console.error(`❌ コマンド登録に失敗 (${guild.name}):`, err.message);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 ${c.user.tag} としてログインしました (${c.guilds.cache.size} サーバー)`);
  for (const guild of c.guilds.cache.values()) await registerCommands(guild);
  if (c.guilds.cache.size === 0) {
    const url = `https://discord.com/oauth2/authorize?client_id=${c.user.id}&permissions=268561424&scope=bot+applications.commands`;
    console.log(`📨 まだどのサーバーにも入っていません。次の URL から招待してください:\n${url}`);
  }
});

client.on(Events.GuildCreate, (guild) => registerCommands(guild));

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild()) return;
  try {
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction, ctx);
      return;
    }
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction, ctx);
      return;
    }
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      await handleComponent(interaction, ctx);
    }
  } catch (err) {
    // UserError やストアの入力チェックは「お客様向けのメッセージ」なのでそのまま表示する
    const expected = err instanceof UserError;
    if (!expected) console.error('[interaction] エラー:', err);
    const content = `❌ ${expected ? err.message : 'エラーが発生しました。時間をおいてもう一度お試しください。'}`;
    if (interaction.isAutocomplete()) return;
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch {
      // 返信できない場合は諦める
    }
  }
});

client.on(Events.Error, (err) => console.error('[client] エラー:', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

client.login(token).catch((err) => {
  if (String(err.message).includes('disallowed intents')) {
    console.error(
      '❌ 「MESSAGE CONTENT INTENT」が有効になっていません。\n' +
        '   Discord Developer Portal → あなたのアプリ → Bot → Privileged Gateway Intents の\n' +
        '   「MESSAGE CONTENT INTENT」を ON にして保存してから、もう一度起動してください。',
    );
  } else if (err.code === 'TokenInvalid' || String(err.message).includes('invalid token')) {
    console.error('❌ トークンが正しくありません。Developer Portal の Bot ページで「Reset Token」して貼り直してください。');
  } else {
    console.error('❌ ログインに失敗しました:', err);
  }
  process.exit(1);
});

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { Store } = require('./store');
const { handleComponent } = require('./handlers/components');
const { UserError } = require('./lib/errors');
const { sweepExpiredOrders } = require('./lib/actions');

const ENV_FILE = path.join(__dirname, '..', '.env');
try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // .env が無い場合はサーバーの環境変数を使う
}

function looksLikeToken(t) {
  return typeof t === 'string' && t.split('.').length === 3 && t.length > 50;
}

/** トークンが無ければ、その場で聞いて .env に保存する (初回だけ) */
async function getToken() {
  const current = process.env.DISCORD_TOKEN;
  if (looksLikeToken(current)) return current;
  if (!process.stdin.isTTY) {
    console.error(
      '❌ DISCORD_TOKEN が設定されていません。環境変数 DISCORD_TOKEN に Bot のトークンを設定してください。' +
        (process.env.RAILWAY_ENVIRONMENT ? '\n   Railway: サービスをタップ → Variables → New Variable で DISCORD_TOKEN を追加' : ''),
    );
    process.exit(1);
  }
  console.log('');
  console.log('🔑 Bot のトークンを貼り付けて Enter を押してください。');
  console.log('   (Discord Developer Portal → あなたのアプリ → Bot → 「Reset Token」でコピーできます)');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let token = '';
  while (!looksLikeToken(token)) {
    token = (await rl.question('トークン: ')).trim().replace(/^["']|["']$/g, '');
    if (!looksLikeToken(token)) console.log('   ⚠️ トークンの形ではないようです。もう一度コピーして貼り付けてください。');
  }
  rl.close();
  saveToken(token);
  console.log('   ✅ 保存しました。次回からは入力不要です。\n');
  return token;
}

function saveToken(token) {
  let text = '';
  try {
    text = fs.readFileSync(ENV_FILE, 'utf8');
  } catch {
    // 新しく作る
  }
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('DISCORD_TOKEN='));
  if (token) lines.unshift(`DISCORD_TOKEN=${token}`);
  fs.writeFileSync(ENV_FILE, `${lines.join('\n')}\n`);
}

// データの保存場所: DATA_FILE > Railway のボリューム > data/db.json
const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const dataFile = process.env.DATA_FILE || (volume ? path.join(volume, 'db.json') : path.join(__dirname, '..', 'data', 'db.json'));
if (process.env.RAILWAY_ENVIRONMENT && !volume && !process.env.DATA_FILE) {
  console.warn('⚠️ Railway にボリュームが付いていません。このままだと更新のたびに商品・注文データが消えます (README の「スマホだけで導入」を参照)。');
}
console.log(`💾 データの保存先: ${dataFile}`);
const store = new Store(dataFile);
const commands = new Map(
  [
    'setup',
    'product',
    'codes',
    'coupon',
    'panel',
    'config',
    'order',
    'stats',
    'announce',
    'blacklist',
    'shop',
    'myorders',
    'help',
    'backup',
  ].map((name) => {
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
  // 10 分ごとに、放置されたお支払い待ちの注文を自動キャンセル
  setInterval(() => {
    sweepExpiredOrders(c, store).catch((err) => console.error('[sweep]', err));
  }, 10 * 60_000);
  const url = `https://discord.com/oauth2/authorize?client_id=${c.user.id}&permissions=268561424&scope=bot+applications.commands`;
  if (c.guilds.cache.size === 0) {
    console.log(`\n📨 まだどのサーバーにも入っていません。次の URL をブラウザで開いて、サーバーに招待してください:\n${url}\n`);
    console.log('   招待したら、サーバーで /setup と入力すればショップが完成します。');
  } else {
    console.log(`📨 招待 URL (別のサーバーに入れるとき): ${url}`);
  }
  console.log('🟢 動作中です。この画面を閉じると Bot は止まります。');
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

async function main() {
  const token = await getToken();
  await client.login(token);
}

main().catch((err) => {
  if (String(err.message).includes('disallowed intents')) {
    console.error(
      '❌ 「MESSAGE CONTENT INTENT」が有効になっていません。\n' +
        '   Discord Developer Portal → あなたのアプリ → Bot → Privileged Gateway Intents の\n' +
        '   「MESSAGE CONTENT INTENT」を ON にして保存してから、もう一度起動してください。',
    );
  } else if (err.code === 'TokenInvalid' || String(err.message).includes('invalid token')) {
    console.error('❌ トークンが正しくありません。Developer Portal の Bot ページで「Reset Token」して、もう一度起動してください。');
    if (process.stdin.isTTY) saveToken(''); // 次回の起動でもう一度聞く
  } else if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(err.code)) {
    console.error('❌ Discord に接続できません。インターネットにつながっているか確認して、もう一度起動してください。');
  } else {
    console.error('❌ ログインに失敗しました:', err);
  }
  process.exit(1);
});

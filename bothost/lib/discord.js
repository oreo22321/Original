'use strict';
// Discord との連携: bot のトークンが正しいかの確認・招待リンク・Webhook での通知

const API = 'https://discord.com/api/v10';
// 招待リンクで求める権限: チャンネルを見る・送信・埋め込み・ファイル・履歴・リアクション・スラッシュコマンド
const INVITE_PERMISSIONS = (1024n + 2048n + 16384n + 32768n + 65536n + 64n + 2147483648n).toString();
const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

// アプリのフラグ: メッセージの内容を読む権限 (Privileged Intent)
const FLAG_MESSAGE_CONTENT = 1 << 18;
const FLAG_MESSAGE_CONTENT_LIMITED = 1 << 19;
const FLAG_MEMBERS = 1 << 14;
const FLAG_MEMBERS_LIMITED = 1 << 15;
const FLAG_PRESENCE = 1 << 12;
const FLAG_PRESENCE_LIMITED = 1 << 13;

async function checkToken(token, { api = API, timeoutMs = 10000 } = {}) {
  token = String(token || '').trim().replace(/^Bot\s+/i, '');
  if (!token) return { ok: false, error: 'DISCORD_TOKEN が設定されていません' };
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    return { ok: false, error: 'トークンの形が違います。Developer Portal の Bot → Reset Token で出る文字列をそのまま貼ってください (Client Secret や Application ID ではありません)' };
  }
  const headers = { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (bothost, 1.0)' };
  const get = async (p) => {
    const ctrl = AbortSignal.timeout(timeoutMs);
    const res = await fetch(api + p, { headers, signal: ctrl });
    return { status: res.status, body: res.ok ? await res.json() : null };
  };
  let me;
  try {
    me = await get('/users/@me');
  } catch (e) {
    return { ok: false, error: `Discord に繋がりませんでした (${e.name === 'TimeoutError' ? '時間切れ' : e.message})` };
  }
  if (me.status === 401) return { ok: false, error: 'トークンが正しくありません (期限切れか、リセットされた可能性があります)。Developer Portal で Reset Token して入れ直してください' };
  if (!me.body) return { ok: false, error: `Discord がエラーを返しました (${me.status})` };
  const u = me.body;
  const result = {
    ok: true,
    id: u.id,
    username: u.discriminator && u.discriminator !== '0' ? `${u.username}#${u.discriminator}` : u.username,
    avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null,
    inviteUrl: `https://discord.com/oauth2/authorize?client_id=${u.id}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`,
    intents: null,
    guilds: null,
  };
  try {
    const app = await get('/applications/@me');
    if (app.body) {
      const f = app.body.flags || 0;
      result.intents = {
        messageContent: !!(f & (FLAG_MESSAGE_CONTENT | FLAG_MESSAGE_CONTENT_LIMITED)),
        members: !!(f & (FLAG_MEMBERS | FLAG_MEMBERS_LIMITED)),
        presence: !!(f & (FLAG_PRESENCE | FLAG_PRESENCE_LIMITED)),
      };
      if (typeof app.body.approximate_guild_count === 'number') result.guilds = app.body.approximate_guild_count;
      if (app.body.id) result.inviteUrl = result.inviteUrl.replace(/client_id=\d+/, `client_id=${app.body.id}`);
    }
  } catch { /* 取れなくても大丈夫 */ }
  return result;
}

function validWebhook(url) { return WEBHOOK_RE.test(String(url || '')); }

const COLORS = { bad: 0xe5484d, warn: 0xf0a020, ok: 0x30a46c, info: 0x5b6cff };

async function notify(url, { title, description, color = 'bad', fields = [], log = null }) {
  if (!validWebhook(url)) throw new Error('Discord の Webhook の URL ではありません');
  let desc = description || '';
  if (log) {
    const tail = log.slice(-1500).replace(/```/g, '`​``');
    desc += `\n\`\`\`\n${tail}\n\`\`\``;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'BotHost',
      embeds: [{ title: title.slice(0, 250), description: desc.slice(0, 4000), color: COLORS[color] ?? color, fields, timestamp: new Date().toISOString() }],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Webhook に送れませんでした (${res.status})`);
}

module.exports = { checkToken, notify, validWebhook, INVITE_PERMISSIONS };

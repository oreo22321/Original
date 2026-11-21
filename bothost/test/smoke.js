'use strict';
// 動いている BotHost を、外から API で一通り触って確かめるスクリプト。
//   node test/smoke.js http://localhost:3000 [--net] [--resume]
//   --net     インターネットが要る確認もする (PyPI / npm からライブラリを入れる・本物の Discord にトークンを確かめる)
//   --resume  前の実行で作った bot が、サーバーの再起動のあとにまた動いているかだけ確かめる
//   --restored  空のサーバーが GitHub のバックアップ (test/fixtures/sample-backup.json.gz) から戻ったかだけ確かめる
const assert = require('assert');

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const net = process.argv.includes('--net');
const resumeOnly = process.argv.includes('--resume');
const restoredOnly = process.argv.includes('--restored');
const USER = { username: 'smoke', password: 'smoke-password-1' };
// 形だけ Discord のトークンに似せた、でたらめな値 (実行のたびに作る。本物のトークンではありません)
const FAKE_TOKEN = [
  Buffer.from(String(1e18 + Math.floor(Math.random() * 1e9))).toString('base64').replace(/=+$/, ''),
  'G' + Math.random().toString(36).slice(2, 7),
  Array.from({ length: 38 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join(''),
].join('.');

let cookie = '';
async function call(method, url, body) {
  const headers = { 'X-BotHost': '1' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = typeof body === 'string' ? 'application/octet-stream' : 'application/json';
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* テキスト */ }
  return { status: res.status, body: json ?? text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, fn, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`時間切れ: ${label}`);
    await sleep(500);
  }
}
// ログは SSE の最初のまとまり (init) から読む
async function logs(id) {
  const res = await fetch(`${base}/api/bots/${id}/events`, { headers: { Cookie: cookie } });
  const reader = res.body.getReader();
  let text = '';
  while (!text.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += Buffer.from(value).toString();
  }
  reader.cancel().catch(() => {});
  const data = JSON.parse(text.split('\n').find((l) => l.startsWith('data: ')).slice(6));
  return data.logs.map((l) => l.l);
}
const step = (msg) => console.log(`✓ ${msg}`);

async function main() {
  await until('サーバーの起動', async () => (await call('GET', '/api/health').catch(() => ({}))).body?.ok, 120000);
  step('サーバーが応答 (/api/health)');

  if (restoredOnly) {
    assert.strictEqual((await call('POST', '/api/login', { username: 'restore-test', password: 'restore-password-1' })).status, 200, 'バックアップのユーザーでログインできる');
    const { bots } = (await call('GET', '/api/bots')).body;
    const bot = bots.find((b) => b.name === 'restored-bot');
    assert.ok(bot, 'バックアップの bot がある');
    assert.deepStrictEqual(bot.env, { TEST_VAR: true });
    await until('戻した bot が自動で動く', async () => (await logs(bot.id)).includes('restored from GitHub hello v2 日本語'));
    const admin = (await call('GET', '/api/admin')).body;
    assert.ok(admin.backup.restoredAt, 'バックアップから戻したと記録されている');
    step('空のサーバーが GitHub のバックアップから戻り、bot が自動でまた動いた');
    return;
  }

  if (resumeOnly) {
    assert.strictEqual((await call('POST', '/api/login', USER)).status, 200, 'ログイン (データが残っている)');
    const { bots } = (await call('GET', '/api/bots')).body;
    const bot = bots.find((b) => b.name === 'smoke-loop');
    assert.ok(bot, 'bot が残っている');
    await until('再起動後に bot がまた動く', async () => (await call('GET', `/api/bots/${bot.id}`)).body.bot.status === 'running');
    await until('再起動後のログ', async () => (await logs(bot.id)).some((l) => l.includes('サーバーが起動したので')));
    step('サーバーの再起動のあと、データが残り、bot が自動でまた動いた');
    return;
  }

  const cfg = (await call('GET', '/api/config')).body;
  assert.strictEqual(cfg.firstUser, true, '最初のユーザーの登録画面になっている');
  assert.strictEqual((await call('POST', '/api/register', USER)).status, 200);
  step('最初のユーザー (管理者) を登録');
  const other = await fetch(base + '/api/register', { method: 'POST', headers: { 'X-BotHost': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'stranger', password: 'password-xyz' }) });
  assert.strictEqual(other.status, 403);
  step('2 人目は登録できない (first-only)');

  // 画面
  const html = await fetch(base + '/', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.strictEqual(html.status, 200);
  assert.ok((await html.text()).includes('app.js'));
  step('画面 (index.html) を返す');

  // ずっと動く Python の bot
  const loop = (await call('POST', '/api/bots', { name: 'smoke-loop', template: 'python-blank' })).body.bot;
  await call('PUT', `/api/bots/${loop.id}/file?path=main.py`, 'import time\nprint("smoke alive", flush=True)\nwhile True:\n    time.sleep(1)\n');
  await call('POST', `/api/bots/${loop.id}/start`);
  await until('Python の bot が動く', async () => (await logs(loop.id)).includes('smoke alive'));
  step('Python の bot が動いた');

  const js = (await call('POST', '/api/bots', { name: 'smoke-node', template: 'node-blank' })).body.bot;
  await call('PUT', `/api/bots/${js.id}/file?path=index.js`, 'console.log("node ok", process.version)\n');
  await call('PATCH', `/api/bots/${js.id}`, { autoRestart: false });
  await call('POST', `/api/bots/${js.id}/start`);
  await until('Node.js の bot が動く', async () => (await logs(js.id)).some((l) => l.startsWith('node ok v')));
  step('Node.js の bot が動いた');

  if (net) {
    // PyPI から本物のライブラリを入れる
    const req = (await call('POST', '/api/bots', { name: 'smoke-pip', template: 'python-blank' })).body.bot;
    await call('PUT', `/api/bots/${req.id}/file?path=requirements.txt`, 'discord.py>=2.4\n');
    await call('PUT', `/api/bots/${req.id}/file?path=main.py`, 'import discord\nprint("discord.py", discord.__version__, flush=True)\n');
    await call('PATCH', `/api/bots/${req.id}`, { autoRestart: false });
    await call('POST', `/api/bots/${req.id}/start`);
    await until('PyPI から discord.py を入れて動く', async () => (await logs(req.id)).some((l) => l.startsWith('discord.py 2.')), 300000);
    step('requirements.txt から discord.py を入れて import できた');

    // npm から本物のライブラリ (discord.js) を入れ、テンプレートのまま、でたらめなトークンで起動する
    const nd = (await call('POST', '/api/bots', { name: 'smoke-npm', template: 'node-discord' })).body.bot;
    await call('PATCH', `/api/bots/${nd.id}`, { autoRestart: false, env: { DISCORD_TOKEN: FAKE_TOKEN } });
    await call('POST', `/api/bots/${nd.id}/start`);
    await until('npm から discord.js を入れ、Discord に繋ぎに行って断られる', async () => {
      const L = await logs(nd.id);
      return L.some((l) => /TokenInvalid|An invalid token was provided/.test(l));
    }, 300000);
    step('package.json から discord.js を入れ、テンプレートが Discord に接続し「トークンが正しくない」と返された');

    // 本物の Discord に、でたらめなトークンを確かめてもらう → 「正しくない」と返る
    const chk = (await call('POST', `/api/bots/${nd.id}/discord-check`)).body.result;
    assert.strictEqual(chk.ok, false);
    assert.match(chk.error, /トークンが正しくありません/, chk.error);
    step('本物の Discord API で、正しくないトークンを見分けた');

  }

  // ZIP
  const zipRes = await fetch(`${base}/api/bots/${loop.id}/export`, { headers: { Cookie: cookie } });
  assert.strictEqual(zipRes.headers.get('content-type'), 'application/zip');
  step('ZIP で書き出せた');

  const admin = (await call('GET', '/api/admin')).body;
  assert.ok(admin.server.running >= 1);
  step(`管理画面の情報 (動作中 ${admin.server.running} 個・サーバーのメモリ ${admin.server.memoryMB} MB)`);
  console.log('ぜんぶ OK');
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });

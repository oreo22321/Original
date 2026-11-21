'use strict';
// git (デプロイキー) でのバックアップ: ローカルの空のリポジトリを GitHub の代わりに使って確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createApp } = require('../server');
const { decodeKey } = require('../lib/backup');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const h = { 'X-BotHost': '1' };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (typeof body === 'string') payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* テキスト */ }
    return { status: res.status, body: json ?? text };
  };
}

async function start(t, opts) {
  const dataDir = tmp('bothost-g-');
  const app = createApp({ dataDir, keepAwakeUrl: '', stopTimeoutMs: 1500, ...opts });
  await app.init();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.shutdown(); } };
  t.after(close);
  return { app, base: `http://127.0.0.1:${app.server.address().port}`, dataDir, close };
}

test('鍵の形: PEM そのまま・\\n 入り・base64 を受け付ける', () => {
  const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----';
  assert.strictEqual(decodeKey(pem), pem + '\n');
  assert.strictEqual(decodeKey(pem.replace(/\n/g, '\\n')), pem + '\n');
  assert.strictEqual(decodeKey(Buffer.from(pem).toString('base64')), pem + '\n');
  assert.strictEqual(decodeKey('nonsense'), '');
});

test('git でのバックアップと復元', async (t) => {
  const bare = path.join(tmp('bothost-bare-'), 'data.git');
  git('init', '-q', '--bare', '-b', 'main', bare);
  const gitUrl = `file://${bare}`;
  const backup = { gitUrl };

  // 1 台目: 空のリポジトリ → 戻すものはない。登録すると、すぐに保存される
  const one = await start(t, { backup });
  assert.strictEqual(one.app.backup.info().method, 'git');
  assert.strictEqual(one.app.backup.info().restoredAt, null);
  assert.strictEqual(await one.app.backup.check(), true);
  const a = client(one.base);
  await a('POST', '/api/register', { username: 'owner', password: 'password1' });
  const deadline = Date.now() + 10000;
  while (!one.app.backup.info().lastAt && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.ok(one.app.backup.info().lastAt, '最初のアカウントはすぐに保存される');
  const id = (await a('POST', '/api/bots', { name: 'g', template: 'python-blank' })).body.bot.id;
  await a('PUT', `/api/bots/${id}/file?path=${encodeURIComponent('sub/x.txt')}`, 'git で保存');
  one.app.store.flush();
  for (let i = 0; i < 3; i++) assert.strictEqual((await a('POST', '/api/admin/backup')).status, 200);
  // 履歴は積み上げない (いつも最新の 1 つ)
  assert.strictEqual(git('--git-dir', bare, 'rev-list', '--count', 'main'), '1');
  assert.deepStrictEqual(git('--git-dir', bare, 'ls-tree', '--name-only', 'main').split('\n').sort(), ['README.md', 'bothost-backup.json.gz']);
  const health = (await a('GET', '/api/health')).body;
  assert.strictEqual(health.backup.method, 'git');
  assert.strictEqual(health.backup.ok, true);
  assert.ok(!JSON.stringify(health).includes(bare), 'health に場所は出さない');
  await one.close();

  // 2 台目: データが空 → git から戻る
  const two = await start(t, { backup });
  assert.ok(two.app.backup.info().restoredAt);
  const b = client(two.base);
  assert.strictEqual((await b('POST', '/api/login', { username: 'owner', password: 'password1' })).status, 200);
  assert.strictEqual((await b('GET', `/api/bots/${id}/file?path=${encodeURIComponent('sub/x.txt')}`)).body, 'git で保存');
  await two.close();
});

test('起動のときに戻せなかったら、古い・空のデータで上書きしない', async (t) => {
  const bare = path.join(tmp('bothost-bare2-'), 'data.git');
  git('init', '-q', '--bare', '-b', 'main', bare);
  // まず正しいバックアップを置く
  const one = await start(t, { backup: { gitUrl: `file://${bare}` } });
  const a = client(one.base);
  await a('POST', '/api/register', { username: 'keep', password: 'password1' });
  await a('POST', '/api/admin/backup');
  await one.close();
  const before = git('--git-dir', bare, 'rev-parse', 'main');

  // 読めない場所 → 戻せない → 保存は止まる (登録しても上書きしない)
  const broken = `file://${bare}-missing`;
  const two = await start(t, { backup: { gitUrl: broken }, restoreRetry: { tries: 2, waitMs: 10 } });
  assert.ok(two.app.backup.info().blocked, '止めている');
  const b = client(two.base);
  await b('POST', '/api/register', { username: 'new', password: 'password2' });
  await assert.rejects(two.app.backup.run(), /上書きしないように/);
  assert.strictEqual(git('--git-dir', bare, 'rev-parse', 'main'), before, '元のバックアップはそのまま');
  const h = (await b('GET', '/api/health')).body;
  assert.strictEqual(h.backup.ok, false);
});

test('止めている間も確かめ直し、鍵が使えるようになったら自動で再開・復元する', async (t) => {
  // (1) GitHub にまだバックアップがない → そのまま再開して保存する
  const empty = path.join(tmp('bothost-bare3-'), 'data.git');
  git('init', '-q', '--bare', '-b', 'main', empty);
  const one = await start(t, { backup: { gitUrl: `file://${empty}-not-yet` }, restoreRetry: { tries: 1, waitMs: 1 } });
  assert.ok(one.app.backup.info().blocked);
  const a = client(one.base);
  await a('POST', '/api/register', { username: 'first', password: 'password1' });
  one.app.backup.gitUrl = `file://${empty}`; // 鍵を登録した、と同じ
  await one.app.backup.retryBlocked();
  assert.strictEqual(one.app.backup.info().blocked, null);
  await one.app.backup.run();
  assert.strictEqual(git('--git-dir', empty, 'rev-list', '--count', 'main'), '1');

  // (2) バックアップがあり、こちらのデータは空 → 戻して、bot も動かす
  const two = await start(t, { backup: { gitUrl: `file://${empty}-broken` }, restoreRetry: { tries: 1, waitMs: 1 } });
  assert.ok(two.app.backup.info().blocked);
  let resumed = false;
  const orig = two.app.backup.onRestored;
  two.app.backup.onRestored = () => { resumed = true; orig(); };
  two.app.backup.gitUrl = `file://${empty}`;
  await two.app.backup.retryBlocked();
  assert.strictEqual(two.app.backup.info().blocked, null);
  assert.ok(resumed);
  assert.deepStrictEqual(two.app.store.users.map((u) => u.username), ['first']);

  // (3) どちらにもデータがある → 勝手に上書きしない
  const three = await start(t, { backup: { gitUrl: `file://${empty}-broken` }, restoreRetry: { tries: 1, waitMs: 1 } });
  const c = client(three.base);
  await c('POST', '/api/register', { username: 'other', password: 'password2' });
  three.app.backup.gitUrl = `file://${empty}`;
  await three.app.backup.retryBlocked();
  assert.match(three.app.backup.info().blocked, /両方にデータがある/);
  await assert.rejects(three.app.backup.run(), /両方にデータ/);
  // 管理画面の「今すぐバックアップ」(force) なら上書きできる
  assert.strictEqual((await c('POST', '/api/admin/backup')).status, 200);
  assert.strictEqual(three.app.backup.info().blocked, null);
});

test('バックアップの暗号化: 鍵がないと読めず、古い (暗号化なし) バックアップも読める', async (t) => {
  const zlib = require('zlib');
  const bare = path.join(tmp('bothost-bare4-'), 'data.git');
  git('init', '-q', '--bare', '-b', 'main', bare);
  const backup = { gitUrl: `file://${bare}`, secretKey: 'correct horse battery staple' };
  const one = await start(t, { backup });
  const a = client(one.base);
  await a('POST', '/api/register', { username: 'enc', password: 'password1' });
  const id = (await a('POST', '/api/bots', { name: 'e', template: 'python-blank' })).body.bot.id;
  await a('PATCH', `/api/bots/${id}`, { env: { DISCORD_TOKEN: 'super.secret.token' } });
  assert.strictEqual((await a('POST', '/api/admin/backup')).status, 200);
  assert.strictEqual(one.app.backup.info().encrypted, true);
  await one.close();
  // GitHub に置かれたファイルには、トークンもユーザー名も見えない
  const raw = execFileSync('git', ['--git-dir', bare, 'show', 'main:bothost-backup.json.gz']);
  assert.ok(raw.subarray(0, 6).toString() === 'BHENC1');
  assert.ok(!raw.includes(Buffer.from('super.secret.token')) && !raw.includes(Buffer.from('enc')));
  assert.throws(() => zlib.gunzipSync(raw));

  // 正しい鍵なら戻る
  const two = await start(t, { backup });
  assert.ok(two.app.backup.info().restoredAt);
  assert.strictEqual(two.app.store.bots[0].env.DISCORD_TOKEN, 'super.secret.token');
  await two.close();
  // 鍵が違うと戻せない (そして上書きもしない)
  const three = await start(t, { backup: { ...backup, secretKey: 'wrong' }, restoreRetry: { tries: 1, waitMs: 1 } });
  assert.ok(three.app.backup.info().blocked);
  assert.match(three.app.backup.info().lastError, /復号できません/);
  await three.close();

  // 暗号化していない古いバックアップも、鍵を設定したあとで読める
  const old = path.join(tmp('bothost-bare5-'), 'data.git');
  git('init', '-q', '--bare', '-b', 'main', old);
  const p1 = await start(t, { backup: { gitUrl: `file://${old}` } });
  await client(p1.base)('POST', '/api/register', { username: 'plain', password: 'password1' });
  await p1.app.backup.run();
  await p1.close();
  const p2 = await start(t, { backup: { gitUrl: `file://${old}`, secretKey: 'new-key' } });
  assert.deepStrictEqual(p2.app.store.users.map((u) => u.username), ['plain']);
  await p2.app.backup.run();
  await p2.close();
  assert.strictEqual(execFileSync('git', ['--git-dir', old, 'show', 'main:bothost-backup.json.gz']).subarray(0, 6).toString(), 'BHENC1', '次からは暗号化して置く');
});

test('セッション: トークンそのものは保存しない・パスワードを変えるとほかの端末は切れる', async (t) => {
  const one = await start(t, { backup: {} });
  const a = client(one.base);
  const b = client(one.base);
  await a('POST', '/api/register', { username: 'sess', password: 'password1' });
  await b('POST', '/api/login', { username: 'sess', password: 'password1' });
  one.app.store.flush();
  const saved = fs.readFileSync(path.join(one.dataDir, 'db.json'), 'utf8');
  // クッキーの値 (トークン) は、保存したデータの中にない
  const res = await fetch(one.base + '/api/login', { method: 'POST', headers: { 'X-BotHost': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'sess', password: 'password1' }) });
  const token = res.headers.get('set-cookie').split(';')[0].split('=')[1];
  one.app.store.flush();
  assert.ok(!fs.readFileSync(path.join(one.dataDir, 'db.json'), 'utf8').includes(token));
  assert.ok(Object.keys(JSON.parse(saved).sessions).length >= 2);
  // パスワードを変えると、ほかの端末 (b) は切れ、自分 (a) はそのまま
  assert.strictEqual((await a('POST', '/api/me/password', { current: 'password1', next: 'password2' })).status, 200);
  assert.strictEqual((await a('GET', '/api/me')).status, 200);
  assert.strictEqual((await b('GET', '/api/me')).status, 401);
  // 同じユーザー名への総当たりは止める
  const c = client(one.base);
  let last;
  for (let i = 0; i < 12; i++) last = await c('POST', '/api/login', { username: 'sess', password: `wrong${i}` });
  assert.strictEqual(last.status, 429);
});

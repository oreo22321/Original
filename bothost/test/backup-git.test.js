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

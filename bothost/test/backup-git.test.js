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
  require('../lib/auth').resetAttempts(); // 同じテストの中で何度もログインするので
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

test('大きなファイル (.exe・.jar など) も分けて保存し、変わっていなければ送り直さない', async (t) => {
  const bare = path.join(tmp('bothost-bare-'), 'data.git');
  git('init', '-q', '--bare', '-b', 'main', bare);
  const backup = { gitUrl: `file://${bare}`, secretKey: 'test-secret-key' };
  const one = await start(t, { backup });
  const a = client(one.base);
  await a('POST', '/api/register', { username: 'owner', password: 'password-123' });
  const { body: { bot } } = await a('POST', '/api/bots', { name: 'big' });
  // 12 MB の「.exe」(前の版は 5 MB を超えるファイルを保存していなかった) と、実行できる印のあるファイル
  const big = Buffer.alloc(12 * 1048576);
  for (let i = 0; i < big.length; i += 997) big[i] = (i * 7) % 256;
  const dir = path.join(one.dataDir, 'bots', bot.id);
  fs.writeFileSync(path.join(dir, 'MyBot.exe'), big);
  fs.writeFileSync(path.join(dir, 'run'), '#!/bin/sh\necho hi\n');
  fs.chmodSync(path.join(dir, 'run'), 0o755);
  await one.app.backup.run({ force: true });
  const blobs = git('--git-dir', bare, 'ls-tree', '--name-only', 'main', 'blobs/').split('\n').filter(Boolean);
  assert.strictEqual(blobs.length, 1, '大きなファイルは blobs/ に');
  // 暗号化されている (中身がそのまま見えない)
  const stored = execFileSync('git', ['--git-dir', bare, 'cat-file', 'blob', `main:${blobs[0]}`], { maxBuffer: 64 * 1048576 });
  assert.ok(stored.subarray(0, 6).equals(Buffer.from('BHENC1')), '暗号化されている');
  assert.ok(!stored.includes(big.subarray(0, 4096)));
  const blobSha = git('--git-dir', bare, 'rev-parse', `main:${blobs[0]}`);

  // 小さなファイルだけ変えて保存 → 大きなファイルは同じもの (送り直さない)
  fs.writeFileSync(path.join(dir, 'config.json'), '{"a":1}');
  await one.app.backup.run({ force: true });
  assert.strictEqual(git('--git-dir', bare, 'rev-parse', `main:${blobs[0]}`), blobSha);
  assert.strictEqual(git('--git-dir', bare, 'rev-list', '--count', 'main'), '1', '履歴は積み上げない');
  await one.close();

  // 2 台目: 空のサーバーで戻す → 大きなファイルも、実行できる印も戻る
  const two = await start(t, { backup });
  const dir2 = path.join(two.dataDir, 'bots', bot.id);
  assert.ok(fs.readFileSync(path.join(dir2, 'MyBot.exe')).equals(big));
  assert.ok(fs.statSync(path.join(dir2, 'run')).mode & 0o100, '実行できる印');
  assert.strictEqual(fs.readFileSync(path.join(dir2, 'config.json'), 'utf8'), '{"a":1}');
  // 消したファイルは、次の保存で blobs/ からも消える
  fs.rmSync(path.join(dir2, 'MyBot.exe'));
  await two.app.backup.run({ force: true });
  assert.strictEqual(git('--git-dir', bare, 'ls-tree', '--name-only', 'main', 'blobs/'), '');
});

test('前の版 (version 1) のバックアップも戻せる', async (t) => {
  const bare = path.join(tmp('bothost-bare-'), 'data.git');
  git('init', '-q', '--bare', '-b', 'main', bare);
  // version 1 の形 (ファイルは全部 base64 で中に入っている) を作って置く
  const zlib = require('zlib');
  const work = tmp('bothost-v1-');
  git('init', '-q', '-b', 'main', work);
  const data = { version: 1, createdAt: Date.now(), db: { users: [], bots: [{ id: 'abcdef', ownerId: 'u', name: 'old', runtime: 'python', startCommand: 'python3 main.py', env: {}, desired: 'stopped' }], sessions: {}, settings: {} }, bots: { abcdef: { 'main.py': Buffer.from('print("old")').toString('base64') } } };
  fs.writeFileSync(path.join(work, 'bothost-backup.json.gz'), zlib.gzipSync(JSON.stringify(data)));
  git('-C', work, 'add', '-A');
  git('-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'v1');
  git('-C', work, 'push', '-q', `file://${bare}`, 'main');
  const one = await start(t, { backup: { gitUrl: `file://${bare}` } });
  assert.strictEqual(one.app.store.bots[0].name, 'old');
  assert.strictEqual(fs.readFileSync(path.join(one.dataDir, 'bots', 'abcdef', 'main.py'), 'utf8'), 'print("old")');
  assert.ok(one.app.store.bots[0].port, '前の版の bot にも PORT が決まる');
});

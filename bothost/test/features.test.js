'use strict';
// 2.0 で足した機能のテスト: ZIP・バックアップ・Discord・通知・ログの保存・管理・定期処理など
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { createApp } = require('../server');
const zip = require('../lib/zip');
const files = require('../lib/files');
const discord = require('../lib/discord');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('時間切れ');
    await sleep(40);
  }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bothost-f-'));

function client(base) {
  let cookie = '';
  return async (method, url, body, { raw = false } = {}) => {
    const h = { 'X-BotHost': '1' };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (Buffer.isBuffer(body) || typeof body === 'string') payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* テキスト */ }
    return { status: res.status, body: json ?? text };
  };
}

async function startApp(t, opts = {}) {
  const dataDir = opts.dataDir || tmp();
  const app = createApp({ dataDir, stopTimeoutMs: 1500, statsIntervalMs: 200, keepAwakeUrl: '', ...opts });
  await app.init();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.shutdown(); } };
  t.after(close);
  return { app, base, dataDir, close };
}

// 小さな偽物の HTTP サーバー
async function fakeServer(t, handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    req.body = Buffer.concat(chunks);
    handler(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('ZIP: 作って読むと同じ中身に戻る', () => {
  const entries = [
    { name: 'main.py', data: Buffer.from('print("こんにちは")\n'.repeat(50)) },
    { name: 'cogs/a.py', data: Buffer.from('x = 1\n') },
    { name: 'img.bin', data: Buffer.from([0, 1, 2, 255, 254]) },
  ];
  const buf = zip.createZip(entries);
  const back = zip.readZip(buf);
  assert.deepStrictEqual(back.map((e) => [e.name, e.data.toString('hex')]), entries.map((e) => [e.name, e.data.toString('hex')]));
  assert.throws(() => zip.readZip(Buffer.from('not a zip at all, sorry........')), /ZIP ファイルではありません/);
  assert.throws(() => zip.readZip(buf, { maxTotal: 10 }), /大きすぎます/);
});

test('ZIP の読み込み: 1 つのフォルダーは外し、外へ出る名前は断る', () => {
  const root = tmp();
  const n = files.importEntries(root, [
    { name: 'proj/main.py', data: Buffer.from('a') },
    { name: 'proj/lib/x.py', data: Buffer.from('b') },
    { name: 'proj/node_modules/junk.js', data: Buffer.from('c') },
    { name: '__MACOSX/proj/._main.py', data: Buffer.from('d') },
  ]);
  assert.strictEqual(n, 2);
  assert.strictEqual(fs.readFileSync(path.join(root, 'main.py'), 'utf8'), 'a');
  assert.strictEqual(fs.readFileSync(path.join(root, 'lib/x.py'), 'utf8'), 'b');
  assert.ok(!fs.existsSync(path.join(root, 'node_modules')));
  assert.throws(() => files.importEntries(root, [{ name: '../evil.py', data: Buffer.from('x') }, { name: 'ok.py', data: Buffer.from('y') }]), /外/);
  assert.ok(!fs.existsSync(path.join(root, 'ok.py')), '1 つでも危ない名前があれば何も書かない');
  // 入れ替え
  files.importEntries(root, [{ name: 'only.py', data: Buffer.from('z') }], { replace: true });
  assert.deepStrictEqual(fs.readdirSync(root), ['only.py']);
});

test('Discord: Webhook の URL の確かめ', () => {
  assert.ok(discord.validWebhook('https://discord.com/api/webhooks/123/abc-DEF_9'));
  assert.ok(discord.validWebhook('https://canary.discord.com/api/webhooks/1/x'));
  assert.ok(!discord.validWebhook('https://evil.example/api/webhooks/1/x'));
  assert.ok(!discord.validWebhook('http://discord.com/api/webhooks/1/x'));
  assert.ok(!discord.validWebhook('https://discord.com/api/webhooks/1/x/../../users'));
});

test('BotHost 2.0 の機能', async (t) => {
  // 偽物の Discord API
  const discordApi = await fakeServer(t, (req, res) => {
    const ok = req.headers.authorization === 'Bot aaa.bbb.ccc';
    res.setHeader('Content-Type', 'application/json');
    if (!ok) { res.statusCode = 401; return res.end('{"message":"401: Unauthorized"}'); }
    if (req.url === '/users/@me') return res.end(JSON.stringify({ id: '42', username: 'testbot', discriminator: '0', avatar: null }));
    if (req.url === '/applications/@me') return res.end(JSON.stringify({ id: '42', flags: 0, approximate_guild_count: 3 }));
    res.statusCode = 404; return res.end('{}');
  });
  const { app, base, dataDir } = await startApp(t, { discordApi, crashLimit: 3, restartBackoffMs: 30 });
  const a = client(base);

  await t.test('最初の人は登録できて管理者。そのあとは (既定では) 登録できない', async () => {
    const cfg = (await a('GET', '/api/config')).body;
    assert.strictEqual(cfg.firstUser, true);
    assert.strictEqual(cfg.registrationOpen, true);
    assert.strictEqual((await a('POST', '/api/register', { username: 'owner', password: 'password1' })).body.user.admin, true);
    const b = client(base);
    assert.strictEqual((await b('POST', '/api/register', { username: 'guest', password: 'password2' })).status, 403);
    // 管理者が許可すれば登録できる
    assert.strictEqual((await a('PATCH', '/api/admin/settings', { registrationOpen: true })).status, 200);
    assert.strictEqual((await b('POST', '/api/register', { username: 'guest', password: 'password2' })).status, 200);
    assert.strictEqual((await b('GET', '/api/admin')).status, 403, '管理者以外は管理画面を使えない');
    const admin = (await a('GET', '/api/admin')).body;
    assert.deepStrictEqual(admin.users.map((u) => u.username), ['owner', 'guest']);
    const guestId = admin.users[1].id;
    assert.strictEqual((await a('DELETE', `/api/admin/users/${guestId}`)).status, 200);
    assert.strictEqual((await b('GET', '/api/me')).status, 401, '消したユーザーのログインは切れる');
  });

  await t.test('/api/health', async () => {
    const r = await a('GET', '/api/health');
    assert.strictEqual(r.body.ok, true);
  });

  let id;
  await t.test('スラッシュコマンドのテンプレート', async () => {
    const r = await a('POST', '/api/bots', { name: 'slash', template: 'python-discord-slash' });
    id = r.body.bot.id;
    const list = (await a('GET', `/api/bots/${id}/files`)).body.files.map((f) => f.path).sort();
    assert.deepStrictEqual(list, ['main.py', 'requirements.txt']);
  });

  await t.test('Discord のトークンの確認と招待リンク', async () => {
    let r = await a('POST', `/api/bots/${id}/discord-check`);
    assert.strictEqual(r.body.result.ok, false);
    assert.match(r.body.result.error, /DISCORD_TOKEN/);
    await a('PATCH', `/api/bots/${id}`, { env: { DISCORD_TOKEN: 'not-a-token' } });
    r = await a('POST', `/api/bots/${id}/discord-check`);
    assert.match(r.body.result.error, /形が違います/);
    await a('PATCH', `/api/bots/${id}`, { env: { DISCORD_TOKEN: 'xxx.yyy.zzz' } });
    r = await a('POST', `/api/bots/${id}/discord-check`);
    assert.match(r.body.result.error, /正しくありません/);
    await a('PATCH', `/api/bots/${id}`, { env: { DISCORD_TOKEN: 'Bot aaa.bbb.ccc ' } }); // 「Bot 」や空白が付いていても直す
    r = await a('POST', `/api/bots/${id}/discord-check`);
    assert.strictEqual(r.body.result.ok, true, JSON.stringify(r.body));
    assert.strictEqual(r.body.bot.discord.username, 'testbot');
    assert.strictEqual(r.body.bot.discord.guilds, 3);
    assert.strictEqual(r.body.bot.discord.intents.messageContent, false);
    assert.match(r.body.bot.discord.inviteUrl, /client_id=42&scope=bot%20applications\.commands&permissions=\d+/);
    assert.ok(!JSON.stringify(r.body).includes('aaa.bbb.ccc'), 'トークンは返さない');
  });

  await t.test('通知の Webhook は Discord のものだけ', async () => {
    assert.strictEqual((await a('PATCH', `/api/bots/${id}`, { notifyWebhook: 'https://example.com/hook' })).status, 400);
    assert.strictEqual((await a('POST', `/api/bots/${id}/notify-test`)).status, 400);
    const ok = await a('PATCH', `/api/bots/${id}`, { notifyWebhook: 'https://discord.com/api/webhooks/1/abc' });
    assert.strictEqual(ok.body.bot.notify, true);
    assert.ok(!JSON.stringify(ok.body).includes('webhooks/1/abc'), 'URL は返さない');
    await a('PATCH', `/api/bots/${id}`, { notifyWebhook: '' });
  });

  await t.test('ZIP で書き出して、別の bot に読み込む', async () => {
    await a('PUT', `/api/bots/${id}/file?path=${encodeURIComponent('cogs/fun.py')}`, 'x = 1\n');
    const res = await a('GET', `/api/bots/${id}/export`, undefined, { raw: true });
    assert.strictEqual(res.headers.get('content-type'), 'application/zip');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepStrictEqual(zip.readZip(buf).map((e) => e.name).sort(), ['cogs/fun.py', 'main.py', 'requirements.txt']);
    const other = (await a('POST', '/api/bots', { name: 'copy', template: 'python-blank' })).body.bot.id;
    const imp = await a('POST', `/api/bots/${other}/import?replace=1`, buf);
    assert.strictEqual(imp.body.count, 3);
    const list = (await a('GET', `/api/bots/${other}/files`)).body.files.map((f) => f.path).sort();
    assert.deepStrictEqual(list, ['cogs/fun.py', 'main.py', 'requirements.txt']);
    assert.strictEqual((await a('POST', `/api/bots/${other}/import`, Buffer.from('garbage'))).status, 400);
    await a('DELETE', `/api/bots/${other}`);
  });

  await t.test('起動ファイルがないときはわかりやすく止まる', async () => {
    await a('PATCH', `/api/bots/${id}`, { startCommand: 'python3 nothing.py' });
    await a('POST', `/api/bots/${id}/start`);
    await until(() => app.runner.info(id).status === 'crashed');
    assert.ok(app.runner.logs(id).some((l) => l.l.includes('nothing.py がありません')));
    await a('PATCH', `/api/bots/${id}`, { startCommand: 'python3 main.py' });
  });

  await t.test('色 (ANSI) は残し、ほかの制御文字は消す。\\r の上書きは最後だけ残す', async () => {
    await a('PUT', `/api/bots/${id}/file?path=requirements.txt`, '');
    await a('PUT', `/api/bots/${id}/file?path=main.py`,
      'import sys\nprint("\\x1b[31mred\\x1b[0m \\x1b[2Kcleared")\nprint("10%\\r50%\\r100%")\nsys.exit(0)\n');
    await a('PATCH', `/api/bots/${id}`, { autoRestart: false });
    app.runner.clearLogs(id);
    await a('POST', `/api/bots/${id}/start`);
    await until(() => app.runner.info(id).status === 'stopped');
    const lines = app.runner.logs(id).map((l) => l.l);
    assert.ok(lines.includes('\x1b[31mred\x1b[0m cleared'), JSON.stringify(lines));
    assert.ok(lines.includes('100%'), JSON.stringify(lines));
  });

  await t.test('大量の出力は間引く', async () => {
    await a('PUT', `/api/bots/${id}/file?path=main.py`, 'for i in range(5000):\n    print(i)\n');
    app.runner.clearLogs(id);
    await a('POST', `/api/bots/${id}/start`);
    await until(() => app.runner.info(id).status === 'stopped');
    await until(() => app.runner.logs(id).some((l) => /行を省略しました/.test(l.l)), 3000);
    const outs = app.runner.logs(id).filter((l) => l.s === 'out').length;
    assert.ok(outs < 5000, `${outs} 行`);
  });

  await t.test('落ちたときに Webhook で知らせる (あきらめたときも)', async () => {
    const hooks = [];
    const realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://discord.com/api/webhooks/')) { hooks.push(JSON.parse(opts.body)); return new Response(null, { status: 204 }); }
      return realFetch(url, opts);
    };
    t.after(() => { global.fetch = realFetch; });
    await a('PATCH', `/api/bots/${id}`, { autoRestart: true, notifyWebhook: 'https://discord.com/api/webhooks/1/abc' });
    await a('PUT', `/api/bots/${id}/file?path=main.py`, 'print("oops")\nraise RuntimeError("boom")\n');
    await a('POST', `/api/bots/${id}/start`);
    await until(() => app.runner.info(id).status === 'crashed', 15000);
    await until(() => hooks.length >= 2);
    assert.match(hooks[0].embeds[0].title, /落ちました/);
    assert.match(hooks[0].embeds[0].description, /boom/);
    assert.match(hooks[hooks.length - 1].embeds[0].title, /止まりました/);
    assert.strictEqual(hooks.length, 2, '途中の落ちたは 10 分に 1 回だけ');
    const bot = (await a('GET', `/api/bots/${id}`)).body.bot;
    assert.ok(bot.crashCount >= 3);
    assert.ok(bot.lastCrashAt);
    await a('PATCH', `/api/bots/${id}`, { notifyWebhook: '' });
  });

  await t.test('ログはファイルにも残り、ダウンロードできる', async () => {
    app.runner.flushLogs();
    const file = path.join(dataDir, 'logs', `${id}.log`);
    assert.ok(fs.existsSync(file));
    assert.ok(fs.readFileSync(file, 'utf8').includes('boom'));
    const txt = await a('GET', `/api/bots/${id}/logs.txt`);
    assert.match(txt.body, /\[err\] RuntimeError: boom/);
  });

  await t.test('ライブラリの入れ直し', async () => {
    fs.mkdirSync(path.join(dataDir, 'bots', id, '.deps', 'x'), { recursive: true });
    assert.strictEqual((await a('POST', `/api/bots/${id}/reinstall`)).status, 200);
    assert.ok(!fs.existsSync(path.join(dataDir, 'bots', id, '.deps')));
  });

  await t.test('定期的な再起動の設定', async () => {
    assert.strictEqual((await a('PATCH', `/api/bots/${id}`, { restartEveryHours: 0.5 })).status, 400);
    assert.strictEqual((await a('PATCH', `/api/bots/${id}`, { restartEveryHours: 24 })).body.bot.restartEveryHours, 24);
  });

  await t.test('画面のファイルは gzip と ETag', async () => {
    const r = await fetch(base + '/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.strictEqual(r.status, 200);
    const etag = r.headers.get('etag');
    assert.ok(etag);
    const r2 = await fetch(base + '/app.js', { headers: { 'If-None-Match': etag } });
    assert.strictEqual(r2.status, 304);
  });

  await t.test('サーバーを止めても、ログは次の起動で読める', async () => {
    await app.runner.stopAll();
    app.runner.close();
    const app2 = createApp({ dataDir, keepAwakeUrl: '' });
    try {
      assert.ok(app2.runner.logs(id).some((l) => l.l.includes('boom')));
    } finally { await app2.runner.stopAll(); app2.runner.close(); }
  });
});

test('GitHub へのバックアップと、データが消えたときの復元', async (t) => {
  // 偽物の GitHub の contents API
  const stored = { content: null, sha: null, puts: 0 };
  const api = await fakeServer(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer ghtoken') { res.statusCode = 401; return res.end('{"message":"Bad credentials"}'); }
    if (!req.url.startsWith('/repos/me/data/contents/bothost-backup.json.gz')) { res.statusCode = 404; return res.end('{}'); }
    if (req.method === 'GET') {
      if (!stored.content) { res.statusCode = 404; return res.end('{"message":"Not Found"}'); }
      if (req.headers.accept === 'application/vnd.github.raw') { res.setHeader('Content-Type', 'application/octet-stream'); return res.end(stored.content); }
      return res.end(JSON.stringify({ sha: stored.sha }));
    }
    if (req.method === 'PUT') {
      const body = JSON.parse(req.body.toString());
      if (stored.sha && body.sha !== stored.sha) { res.statusCode = 409; return res.end('{"message":"sha mismatch"}'); }
      stored.content = Buffer.from(body.content, 'base64');
      stored.sha = `sha${++stored.puts}`;
      return res.end(JSON.stringify({ content: { sha: stored.sha } }));
    }
    res.statusCode = 405; return res.end('{}');
  });
  const backup = { repo: 'me/data', token: 'ghtoken', api };

  const first = await startApp(t, { backup, registration: 'open' });
  const a = client(first.base);
  await a('POST', '/api/register', { username: 'owner', password: 'password1' });
  const id = (await a('POST', '/api/bots', { name: 'keep me', template: 'python-blank' })).body.bot.id;
  await a('PUT', `/api/bots/${id}/file?path=data.txt`, 'たいせつ');
  await a('PATCH', `/api/bots/${id}`, { env: { SECRET: 's3' } });
  fs.mkdirSync(path.join(first.dataDir, 'bots', id, '.deps'), { recursive: true });
  fs.writeFileSync(path.join(first.dataDir, 'bots', id, '.deps', 'big.so'), 'x');
  first.app.store.flush();

  const r = await a('POST', '/api/admin/backup');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.backup.lastAt);
  // 2 回目は sha を付けて上書き
  assert.strictEqual((await a('POST', '/api/admin/backup')).status, 200);
  assert.strictEqual(stored.puts, 2);
  const bundle = JSON.parse(zlib.gunzipSync(stored.content).toString());
  assert.ok(bundle.bots[id]['data.txt']);
  assert.ok(!Object.keys(bundle.bots[id]).some((k) => k.startsWith('.deps')), 'ライブラリは入れない');
  await first.close();

  // 新しいサーバー (データが空) → バックアップから戻る
  const second = await startApp(t, { backup });
  const b = client(second.base);
  assert.strictEqual((await b('POST', '/api/login', { username: 'owner', password: 'password1' })).status, 200);
  const bots = (await b('GET', '/api/bots')).body.bots;
  assert.deepStrictEqual(bots.map((x) => x.name), ['keep me']);
  assert.deepStrictEqual(bots[0].env, { SECRET: true });
  const f = await b('GET', `/api/bots/${id}/file?path=data.txt`);
  assert.strictEqual(f.body, 'たいせつ');
  assert.ok(second.app.backup.info().restoredAt);

  // データがあるときは戻さない (上書きしない)
  const before = fs.readFileSync(path.join(second.dataDir, 'db.json'), 'utf8');
  assert.strictEqual(await second.app.backup.restoreIfEmpty(path.join(second.dataDir, 'db.json')), false);
  assert.strictEqual(fs.readFileSync(path.join(second.dataDir, 'db.json'), 'utf8'), before);

  // トークンが違うとエラーを返す
  second.app.backup.token = 'wrong';
  const bad = await b('POST', '/api/admin/backup');
  assert.strictEqual(bad.status, 502);
  assert.match(bad.body.error, /GitHub/);
});

test('db.json が壊れていても .bak から戻る', () => {
  const dir = tmp();
  const { Store } = require('../lib/store');
  const s = new Store(path.join(dir, 'db.json'));
  s.users.push({ id: 'u1', username: 'a' });
  s.flush();
  s.users.push({ id: 'u2', username: 'b' });
  s.flush(); // ここで 1 つ前 (u1 だけ) が .bak に残る
  fs.writeFileSync(path.join(dir, 'db.json'), '{ broken');
  const s2 = new Store(path.join(dir, 'db.json'));
  assert.deepStrictEqual(s2.users.map((u) => u.id), ['u1']);
});

test('サーバーが突然落ちて取り残された bot のプロセスを片付ける', { skip: process.platform !== 'linux' }, async () => {
  const dataDir = tmp();
  const botDir = path.join(dataDir, 'bots', 'abc123');
  fs.mkdirSync(botDir, { recursive: true });
  const { spawn } = require('child_process');
  const child = spawn('sleep', ['60'], { cwd: botDir, detached: true, stdio: 'ignore' });
  fs.writeFileSync(path.join(dataDir, 'pids.json'), JSON.stringify({ abc123: child.pid, other: 1 }));
  const exited = new Promise((r) => child.on('exit', r));
  const app = createApp({ dataDir, keepAwakeUrl: '' });
  try {
    await Promise.race([exited, sleep(3000).then(() => { throw new Error('止まらなかった'); })]);
    // pid 1 (bot のフォルダーではない) には触れていない = このテストが動き続けている
  } finally { await app.runner.stopAll(); app.runner.close(); }
});

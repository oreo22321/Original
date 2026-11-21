'use strict';
// npm test (node --test test/*.test.js) で実行します
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');
const { splitCommand } = require('../lib/runner');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('時間切れ');
    await sleep(50);
  }
}

function client(base) {
  let cookie = '';
  const call = async (method, url, body, { headers = {}, raw = false } = {}) => {
    const h = { 'X-BotHost': '1', ...headers };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (typeof body === 'string') { payload = body; } else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* テキスト */ }
    return { status: res.status, body: json ?? text };
  };
  return call;
}

test('splitCommand', () => {
  assert.deepStrictEqual(splitCommand('python3 main.py'), ['python3', 'main.py']);
  assert.deepStrictEqual(splitCommand(`node x.js --name "a b" ''`), ['node', 'x.js', '--name', 'a b', '']);
});

test('BotHost の一通りの流れ', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bothost-test-'));
  const app = createApp({ dataDir, registration: 'first-only', stopTimeoutMs: 1500, statsIntervalMs: 300, isolate: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const a = client(base);
  const b = client(base);

  await t.test('ログインしていないと使えない', async () => {
    assert.strictEqual((await a('GET', '/api/bots')).status, 401);
  });

  await t.test('X-BotHost ヘッダーのない変更は断る (CSRF 対策)', async () => {
    const res = await fetch(base + '/api/register', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.strictEqual(res.status, 403);
  });

  await t.test('登録 (最初の人は管理者、first-only なので 2 人目は断る)', async () => {
    assert.strictEqual((await a('POST', '/api/register', { username: 'x', password: '12345678' })).status, 400);
    const r = await a('POST', '/api/register', { username: 'alice', password: 'password1' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user.admin, true);
    assert.strictEqual((await b('POST', '/api/register', { username: 'bob', password: 'password2' })).status, 403);
    assert.strictEqual((await b('POST', '/api/login', { username: 'alice', password: 'wrong-pass' })).status, 401);
    assert.strictEqual((await a('GET', '/api/me')).body.user.username, 'alice');
  });

  let botId;
  await t.test('テンプレートから bot を作る', async () => {
    const r = await a('POST', '/api/bots', { name: 'テスト', template: 'python-discord' });
    assert.strictEqual(r.status, 200);
    botId = r.body.bot.id;
    assert.strictEqual(r.body.bot.runtime, 'python');
    const list = await a('GET', `/api/bots/${botId}/files`);
    assert.deepStrictEqual(list.body.files.map((f) => f.path).sort(), ['main.py', 'requirements.txt']);
  });

  await t.test('ファイルの読み書きと、フォルダーの外への拒否', async () => {
    const code = 'import os, sys\nprint("hello", os.environ.get("GREETING"))\nprint("err line", file=sys.stderr)\nname = input()\nprint("got", name)\nimport time\ntime.sleep(60)\n';
    assert.strictEqual((await a('PUT', `/api/bots/${botId}/file?path=main.py`, code)).status, 200);
    assert.strictEqual((await a('DELETE', `/api/bots/${botId}/file?path=requirements.txt`)).status, 200);
    const got = await a('GET', `/api/bots/${botId}/file?path=main.py`);
    assert.strictEqual(got.body, code);
    for (const bad of ['../db.json', '../../server.js', '/etc/passwd', 'a/../../x']) {
      const r = await a('GET', `/api/bots/${botId}/file?path=${encodeURIComponent(bad)}`);
      assert.ok(r.status === 400 || r.status === 404, `${bad} → ${r.status}`);
      assert.notStrictEqual(r.status, 200);
    }
    // シンボリックリンクで外を指しても読めない
    fs.symlinkSync('/etc/hostname', path.join(dataDir, 'bots', botId, 'link'));
    assert.strictEqual((await a('GET', `/api/bots/${botId}/file?path=link`)).status, 400);
    fs.unlinkSync(path.join(dataDir, 'bots', botId, 'link'));
  });

  await t.test('環境変数は値を返さない', async () => {
    const r = await a('PATCH', `/api/bots/${botId}`, { env: { GREETING: 'やあ', 'BAD-KEY': 'x' } });
    assert.strictEqual(r.status, 400);
    const r2 = await a('PATCH', `/api/bots/${botId}`, { env: { GREETING: 'やあ', SECRET: 'tok' } });
    assert.deepStrictEqual(r2.body.bot.env, { GREETING: true, SECRET: true });
    assert.ok(!JSON.stringify(r2.body).includes('tok'));
    await a('PATCH', `/api/bots/${botId}`, { env: { SECRET: null } });
    assert.deepStrictEqual((await a('GET', `/api/bots/${botId}`)).body.bot.env, { GREETING: true });
  });

  await t.test('ほかの人の bot は見えない', async () => {
    // 管理者以外のユーザーを直接作る
    const auth = require('../lib/auth');
    app.store.users.push({ id: 'u2', username: 'carol', password: auth.hashPassword('password3'), admin: false, createdAt: Date.now() });
    const c = client(base);
    assert.strictEqual((await c('POST', '/api/login', { username: 'carol', password: 'password3' })).status, 200);
    assert.strictEqual((await c('GET', `/api/bots/${botId}`)).status, 404);
    assert.strictEqual((await c('GET', `/api/bots/${botId}/file?path=main.py`)).status, 404);
    assert.deepStrictEqual((await c('GET', '/api/bots')).body.bots, []);
  });

  await t.test('起動 → ログ (SSE) → 標準入力 → 使用量 → 停止', async () => {
    const ctrl = new AbortController();
    const res = await a('GET', `/api/bots/${botId}/events`, undefined, { raw: true, headers: {} });
    void ctrl;
    const reader = res.body.getReader();
    let sseText = '';
    (async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; sseText += Buffer.from(value).toString(); } })().catch(() => {});

    assert.strictEqual((await a('POST', `/api/bots/${botId}/start`)).status, 200);
    await until(() => app.runner.logs(botId).some((l) => l.l === 'hello やあ'));
    await until(() => app.runner.logs(botId).some((l) => l.s === 'err' && l.l === 'err line'));
    assert.strictEqual((await a('POST', `/api/bots/${botId}/stdin`, { text: 'world' })).status, 200);
    await until(() => app.runner.logs(botId).some((l) => l.l === 'got world'));
    await until(() => sseText.includes('got world'));
    assert.ok(sseText.includes('event: init'));
    const info = await until(async () => { const r = await a('GET', `/api/bots/${botId}`); return r.body.bot.stats && r.body.bot; });
    assert.strictEqual(info.status, 'running');
    assert.ok(info.stats.memoryMB > 0);
    assert.strictEqual(app.store.bots[0].desired, 'running');

    const stop = await a('POST', `/api/bots/${botId}/stop`);
    assert.strictEqual(stop.body.bot.status, 'stopped');
    assert.strictEqual(app.store.bots[0].desired, 'stopped');
    await reader.cancel();
  });

  await t.test('落ちたら自動で再起動し、何度も落ちたらあきらめる', async () => {
    await a('PUT', `/api/bots/${botId}/file?path=main.py`, 'print("boot")\nraise SystemExit(3)\n');
    const bot = app.store.bots.find((x) => x.id === botId);
    // テストでは待ち時間を短く
    const s = app.runner.state(botId);
    await a('POST', `/api/bots/${botId}/start`);
    s.backoff = 50;
    const origOnExit = app.runner.onExit.bind(app.runner);
    app.runner.onExit = (...args) => { origOnExit(...args); const st = app.runner.state(botId); if (st.backoff > 100) st.backoff = 50; };
    await until(() => app.runner.info(botId).status === 'crashed', 15000);
    const boots = app.runner.logs(botId).filter((l) => l.l === 'boot').length;
    assert.strictEqual(boots, 5);
    assert.ok(app.runner.logs(botId).some((l) => l.l.includes('自動での再起動をやめました')));
    app.runner.onExit = origOnExit;
    void bot;
  });

  await t.test('requirements.txt があればライブラリを入れる (変わらなければ 2 回目はしない)', async () => {
    // ネットワークなしで済むよう、ローカルのパッケージを入れる
    const pkg = path.join(dataDir, 'localpkg');
    fs.mkdirSync(path.join(pkg, 'hellopkg'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'hellopkg', '__init__.py'), 'MSG = "from hellopkg"\n');
    fs.writeFileSync(path.join(pkg, 'pyproject.toml'), '[build-system]\nrequires=["setuptools"]\nbuild-backend="setuptools.build_meta"\n[project]\nname="hellopkg"\nversion="0.1"\n');
    await a('PUT', `/api/bots/${botId}/file?path=requirements.txt`, `${pkg}\n`);
    await a('PUT', `/api/bots/${botId}/file?path=main.py`, 'import hellopkg\nprint(hellopkg.MSG)\n');
    await a('PATCH', `/api/bots/${botId}`, { autoRestart: false });
    app.runner.clearLogs(botId);
    await a('POST', `/api/bots/${botId}/start`);
    await until(() => ['stopped', 'crashed'].includes(app.runner.info(botId).status) && app.runner.logs(botId).some((l) => l.l.startsWith('終了しました')), 120000);
    const logs = app.runner.logs(botId).map((l) => l.l);
    if (!logs.includes('from hellopkg')) {
      t.diagnostic(logs.join('\n'));
      // pip でオフラインのビルドができない環境 (setuptools なし) はスキップ扱い
      if (logs.some((l) => /setuptools|No matching distribution|Could not find/.test(l))) return;
    }
    assert.ok(logs.includes('from hellopkg'), logs.join('\n'));
    assert.ok(logs.some((l) => l.includes('ライブラリを入れています')));
    app.runner.clearLogs(botId);
    await a('POST', `/api/bots/${botId}/start`);
    await until(() => app.runner.logs(botId).some((l) => l.l.startsWith('終了しました')));
    assert.ok(!app.runner.logs(botId).some((l) => l.l.includes('ライブラリを入れています')));
    assert.ok(app.runner.logs(botId).some((l) => l.l === 'from hellopkg'));
    // .deps は一覧に出さない
    const list = await a('GET', `/api/bots/${botId}/files`);
    assert.ok(list.body.hidden.includes('.deps'));
  });

  await t.test('サーバーを再起動したら、動かしていた bot を再開する', async () => {
    await a('PUT', `/api/bots/${botId}/file?path=main.py`, 'import time\nprint("alive")\ntime.sleep(60)\n');
    await a('PUT', `/api/bots/${botId}/file?path=requirements.txt`, '');
    await a('POST', `/api/bots/${botId}/start`);
    await until(() => app.runner.logs(botId).some((l) => l.l === 'alive'));
    await app.runner.stopAll();
    app.store.flush();
    const app2 = createApp({ dataDir, stopTimeoutMs: 1500, isolate: false });
    try {
      const before = app2.runner.logs(botId).filter((l) => l.l === 'alive').length; // 前のサーバーのログも残っている
      app2.resume();
      await until(() => app2.runner.logs(botId).filter((l) => l.l === 'alive').length > before);
      assert.strictEqual(app2.runner.info(botId).status, 'running');
    } finally {
      await app2.runner.stopAll();
      clearInterval(app2.runner.statsTimer);
    }
  });

  await t.test('削除', async () => {
    assert.strictEqual((await a('DELETE', `/api/bots/${botId}`)).status, 200);
    assert.ok(!fs.existsSync(path.join(dataDir, 'bots', botId)));
    assert.deepStrictEqual((await a('GET', '/api/bots')).body.bots, []);
  });

  await t.test('画面のファイルを返す', async () => {
    const res = await fetch(base + '/');
    assert.strictEqual(res.status, 200);
    assert.ok((await res.text()).includes('app.js'));
    assert.strictEqual((await fetch(base + '/bots/abc')).status, 200); // SPA
    assert.strictEqual((await fetch(base + '/nope.js')).status, 404);
    assert.strictEqual((await fetch(base + '/../server.js')).status, 404);
  });
});

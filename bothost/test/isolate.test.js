'use strict';
// bot ごとのユーザー分離 (サーバーが root のとき): bot はサーバーの秘密・データ・ほかの bot のファイルを読めない
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');
const { botUid } = require('../lib/runner');

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0 && process.platform === 'linux';

async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('時間切れ');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('bot ごとのユーザー分離', { skip: !isRoot && 'root で動いていないので分離は使いません' }, async (t) => {
  process.env.BOTHOST_TEST_SECRET = 'top-secret-value';
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bothost-iso-'));
  fs.chmodSync(base, 0o755);
  const dataDir = path.join(base, 'data');
  const app = createApp({ dataDir, keepAwakeUrl: '', isolate: true, stopTimeoutMs: 1500 });
  t.after(async () => { await app.shutdown(); delete process.env.BOTHOST_TEST_SECRET; fs.rmSync(base, { recursive: true, force: true }); });
  app.store.users.push({ id: 'u1', username: 'a', password: 'x' });
  app.store.flush();

  const mk = (id, code) => {
    const bot = { id, ownerId: 'u1', name: id, runtime: 'python', startCommand: 'python3 main.py', env: {}, autoRestart: false, desired: 'stopped', memoryLimitMB: 256 };
    app.store.bots.push(bot);
    const dir = app.runner.dir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'main.py'), code);
    fs.writeFileSync(path.join(dir, 'secret-of-' + id + '.txt'), 'bot の秘密');
    return bot;
  };
  const other = mk('bbbbbb000002', 'print("other")\n');
  const bot = mk('aaaaaa000001', `
import os
def tryread(p):
    try:
        open(p).read()
        return "読めた"
    except PermissionError:
        return "読めない"
    except FileNotFoundError:
        return "ない"
print("uid", os.getuid())
print("db", tryread(${JSON.stringify(path.join(dataDir, 'db.json'))}))
print("server-env", tryread("/proc/%d/environ" % os.getppid()))
try:
    os.listdir(${JSON.stringify(app.runner.dir(other.id))})
    print("other-dir 見えた")
except PermissionError:
    print("other-dir 見えない")
print("other-file", tryread(${JSON.stringify(path.join(app.runner.dir(other.id), 'secret-of-bbbbbb000002.txt'))}))
print("env-secret", os.environ.get("BOTHOST_TEST_SECRET"))
open("written.txt", "w").write("ok")
open("uploaded.txt", "a").write(" + bot")
print("own-write ok")
`);
  // 動かす前に、サーバー (API) が書いたファイルも bot が書き換えられるか
  app.runner.prepareDir(other.id);
  fs.writeFileSync(path.join(app.runner.dir(bot.id), 'uploaded.txt'), 'from api');
  app.runner.adopt(bot.id, path.join(app.runner.dir(bot.id), 'uploaded.txt'));

  await app.runner.start(bot);
  await until(() => app.runner.logs(bot.id).some((l) => l.l === 'own-write ok' || /Error/.test(l.l)));
  const L = app.runner.logs(bot.id).map((l) => l.l);
  assert.ok(L.includes(`uid ${botUid(bot.id)}`), L.join('\n'));
  assert.ok(L.includes('db 読めない'), 'サーバーのデータは読めない\n' + L.join('\n'));
  assert.ok(L.includes('server-env 読めない'), 'サーバーの環境変数 (秘密) は読めない\n' + L.join('\n'));
  assert.ok(L.includes('other-dir 見えない'), 'ほかの bot のフォルダーは見えない');
  assert.ok(L.includes('other-file 読めない'), 'ほかの bot のファイルは読めない');
  assert.ok(L.includes('env-secret None'), 'サーバーの環境変数は bot に渡さない');
  assert.ok(L.includes('own-write ok'));
  assert.strictEqual(fs.readFileSync(path.join(app.runner.dir(bot.id), 'uploaded.txt'), 'utf8'), 'from api + bot');
  const st = fs.statSync(path.join(app.runner.dir(bot.id), 'written.txt'));
  assert.strictEqual(st.uid, botUid(bot.id));
  assert.strictEqual(fs.statSync(path.join(dataDir, 'db.json')).mode & 0o777, 0o600);
});

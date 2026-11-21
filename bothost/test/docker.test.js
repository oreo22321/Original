'use strict';
// docker モード (bot ごとにコンテナで動かす) のテスト。Docker が使えないときは飛ばします。
// 使うイメージ: python:3.12-slim / node:22-slim (なければ取ってきます)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createApp } = require('../server');
const { botUid } = require('../lib/runner');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('時間切れ');
    await sleep(100);
  }
}

const hasDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const hasImages = hasDocker && ['python:3.12-slim', 'node:22-slim'].every((img) =>
  spawnSync('docker', ['image', 'inspect', img], { stdio: 'ignore' }).status === 0
  || spawnSync('docker', ['pull', '-q', img], { stdio: 'ignore', timeout: 300000 }).status === 0);

test('docker モード', { skip: !hasImages && 'Docker (と python / node のイメージ) が使えません', timeout: 300000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bothost-docker-'));
  const app = createApp({ dataDir, mode: 'docker', stopTimeoutMs: 8000, statsIntervalMs: 1500, keepAwakeUrl: '', restartBackoffMs: 200 });
  t.after(async () => { await app.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // 外の世界 (サーバーのデータ) に置いた秘密のファイル
  fs.writeFileSync(path.join(dataDir, 'secret.txt'), 'サーバーの秘密');
  const user = { id: 'u1', admin: true };
  app.store.users.push({ ...user, username: 'owner', password: 'x' });
  const make = (name, runtime, files, extra = {}) => {
    const bot = {
      id: Math.random().toString(16).slice(2, 10), ownerId: 'u1', name, runtime, template: null,
      startCommand: runtime === 'python' ? 'python3 main.py' : 'node index.js',
      env: {}, autoRestart: false, desired: 'stopped', memoryLimitMB: 128, cpuLimit: 0.5, ...extra,
    };
    app.store.bots.push(bot);
    const dir = app.runner.dir(bot.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
    return bot;
  };
  const logs = (bot) => app.runner.logs(bot.id).map((l) => l.l);

  await t.test('Python の bot がコンテナで動き、標準入力・環境変数・使用量・停止ができる', async () => {
    const bot = make('py', 'python', {
      'main.py': [
        'import os, time, sys',
        'print("hello", os.environ["GREETING"], os.getuid())',
        'print("cwd", os.getcwd(), sorted(os.listdir(".")))',
        'print("secret?", os.path.exists("/app/../secret.txt"))',
        'try:',
        '    open("/etc/hacked", "w")',
        '    print("rootfs: writable")',
        'except OSError as e:',
        '    print("rootfs: read-only")',
        'open("out.txt", "w").write("written in container")',
        'name = input()',
        'print("got", name)',
        'sys.stdout.flush()',
        'x = bytearray(30 * 1024 * 1024)',
        'while True: time.sleep(1)',
      ].join('\n'),
    }, { env: { GREETING: 'やあ' } });
    await app.runner.start(bot);
    await until(() => logs(bot).some((l) => l.startsWith('hello')));
    const L = logs(bot);
    // サーバーが root なら bot ごとのユーザー、そうでなければサーバーと同じユーザー (どちらでも root ではない)
    const uid = app.runner.isolate ? botUid(bot.id) : process.getuid();
    assert.ok(L.includes(`hello やあ ${uid}`), L.join('\n'));
    assert.notStrictEqual(uid, 0);
    assert.ok(L.some((l) => l.startsWith("cwd /app ['main.py']")), L.join('\n'));
    assert.ok(L.includes('secret? False'), 'bot のフォルダーの外は見えない');
    assert.ok(L.includes('rootfs: read-only'), 'システムのファイルは書けない');
    assert.strictEqual(fs.readFileSync(path.join(app.runner.dir(bot.id), 'out.txt'), 'utf8'), 'written in container');
    assert.ok(app.runner.write(bot.id, 'world'));
    await until(() => logs(bot).includes('got world'));
    const stats = await until(() => app.runner.info(bot.id).stats, 30000);
    assert.ok(stats.memoryMB > 20, JSON.stringify(stats));
    const t0 = Date.now();
    await app.runner.stop(bot.id);
    assert.strictEqual(app.runner.info(bot.id).status, 'stopped');
    assert.ok(Date.now() - t0 < 7000, `止まるまで ${Date.now() - t0}ms`);
    const left = spawnSync('docker', ['ps', '-aq', '--filter', `name=bothost-${bot.id}`], { encoding: 'utf8' }).stdout.trim();
    assert.strictEqual(left, '', 'コンテナは残らない');
  });

  await t.test('Node.js の bot も動く', async () => {
    const bot = make('js', 'node', { 'index.js': 'console.log("node", process.version, process.env.BOT_NAME); setTimeout(() => {}, 1e6);' });
    await app.runner.start(bot);
    await until(() => logs(bot).some((l) => /^node v22\./.test(l)));
    assert.ok(logs(bot).some((l) => l.endsWith(' js')));
    await app.runner.stop(bot.id);
  });

  await t.test('メモリの上限を超えるとコンテナが止められ、分かるように表示する', async () => {
    const bot = make('hog', 'python', {
      'main.py': 'import time\nprint("start", flush=True)\nblocks = []\nwhile True:\n    blocks.append(bytearray(16 * 1024 * 1024))\n    time.sleep(0.05)\n',
    }, { memoryLimitMB: 64 });
    let crash = null;
    app.runner.once('crash', (id, info) => { if (id === bot.id) crash = info; });
    await app.runner.start(bot);
    await until(() => app.runner.info(bot.id).status === 'crashed');
    assert.ok(logs(bot).includes('メモリの上限を超えたので止めました。'), logs(bot).join('\n'));
    assert.strictEqual(crash && crash.reason, 'memory');
  });

  await t.test('サーバーが落ちて残ったコンテナは、次の起動で片付ける', async () => {
    const name = 'bothost-leftover1';
    spawnSync('docker', ['run', '-d', '--rm', '--name', name, 'python:3.12-slim', 'sleep', '300'], { stdio: 'ignore' });
    assert.ok(spawnSync('docker', ['ps', '-q', '--filter', `name=${name}`], { encoding: 'utf8' }).stdout.trim());
    const app2 = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bothost-docker2-')), mode: 'docker', keepAwakeUrl: '' });
    app2.runner.close();
    await until(() => !spawnSync('docker', ['ps', '-aq', '--filter', `name=${name}`], { encoding: 'utf8' }).stdout.trim(), 20000);
  });
});

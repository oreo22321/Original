'use strict';
// v4: いろいろなファイル (.bat / .exe / .jar / .dll …) の起動方法・小さな cmd・ZIP・Web 公開・大きなファイル
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawnSync } = require('child_process');

const launch = require('../lib/launch');
const zip = require('../lib/zip');
const { createApp } = require('../server');

const FX = path.join(__dirname, 'fixtures', 'runtimes');
const CMD = path.join(__dirname, '..', 'lib', 'cmd.js');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `bothost-v4-${name}-`));
const write = (dir, rel, data) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };

test('起動コマンド → 本当に動かすコマンド', () => {
  const dir = tmp('resolve');
  write(dir, 'main.py', 'print(1)');
  write(dir, 'start.bat', '@echo off\r\npython main.py\r\n');
  write(dir, 'src/Bot.py', 'print(2)');
  fs.copyFileSync(path.join(FX, 'hello64.exe'), path.join(dir, 'bot.exe'));
  fs.copyFileSync(path.join(FX, 'hello32.exe'), path.join(dir, 'old32.exe'));
  fs.copyFileSync(path.join(FX, 'hello.jar'), path.join(dir, 'bot.jar'));
  fs.mkdirSync(path.join(dir, 'net'));
  for (const f of fs.readdirSync(path.join(FX, 'dotnet'))) fs.copyFileSync(path.join(FX, 'dotnet', f), path.join(dir, 'net', f));
  fs.copyFileSync(process.execPath, path.join(dir, 'linuxbin'));
  write(dir, 'run.sh', '#!/bin/bash\r\necho hi\r\n');

  const r = (cmd) => launch.resolve(dir, cmd, { memoryMB: 200 });
  assert.deepStrictEqual(r('start.bat').argv, ['node', launch.CMD_JS, 'start.bat']);
  assert.strictEqual(r('start.bat').kind, 'batch');
  assert.deepStrictEqual(r('py -3 main.py').argv, ['python3', 'main.py']);
  assert.deepStrictEqual(r('python src\\bot.py').argv, ['python3', 'src/Bot.py'], 'Windows の \\ と大文字・小文字の違い');
  assert.match(r('python3 nothere.py').problem, /nothere\.py がありません/);
  assert.deepStrictEqual(r('bot.exe --x').argv, ['wine64', 'bot.exe', '--x']);
  assert.strictEqual(r('bot.exe').kind, 'wine');
  assert.match(r('old32.exe').problem, /32 ビット/);
  assert.deepStrictEqual(r('net/hello.exe').argv, ['dotnet', 'net/hello.dll'], '.NET 製の .exe は .NET で直接');
  const jar = r('bot.jar').argv;
  assert.strictEqual(jar[0], 'java');
  assert.ok(jar.includes('-XX:MaxRAM=200m') && jar.includes('-XX:+UseSerialGC'));
  assert.deepStrictEqual(jar.slice(-2), ['-jar', 'bot.jar']);
  assert.ok(!r('java -Xmx64m -jar bot.jar').argv.some((a) => a.startsWith('-XX:MaxRAM')), '自分で -Xmx を書いたら足さない');
  assert.deepStrictEqual(r('bot').argv.slice(0, 2), ['wine64', 'bot.exe'], '拡張子なしでも見つける');
  assert.deepStrictEqual(r('linuxbin').argv, ['./linuxbin']);
  assert.deepStrictEqual(r('run.sh').argv, ['bash', 'run.sh']);
  assert.deepStrictEqual(r('cd src && python3 Bot.py').argv, ['bash', '-c', 'cd src && python3 Bot.py']);
  assert.deepStrictEqual(r('cmd /c echo hi').argv, ['node', launch.CMD_JS, '/c', 'echo hi']);
  assert.match(r('nothere.exe').problem, /nothere\.exe がありません/);
  write(dir, 'x.ps1', 'Write-Host hi');
  assert.match(r('x.ps1').problem, /PowerShell/);

  // ファイルの説明
  assert.match(launch.describe(path.join(dir, 'bot.exe')).text, /64 ビット/);
  assert.match(launch.describe(path.join(dir, 'old32.exe')).text, /32 ビット/);
  assert.strictEqual(launch.describe(path.join(dir, 'net', 'hello.dll')).kind, 'dotnet');
  assert.strictEqual(launch.describe(path.join(dir, 'linuxbin')).kind, 'binary');
});

test('起動方法を自動で見つける', () => {
  const d1 = tmp('detect1');
  write(d1, 'Procfile', 'worker: python3 bot.py\n');
  write(d1, 'bot.py', '');
  write(d1, 'main.py', '');
  assert.strictEqual(launch.detect(d1).command, 'python3 bot.py', 'Procfile が先');

  const d2 = tmp('detect2');
  write(d2, '.replit', 'run = ["python3", "app.py"]\n');
  write(d2, 'app.py', '');
  assert.strictEqual(launch.detect(d2).command, 'python3 app.py');

  const d3 = tmp('detect3');
  write(d3, 'package.json', JSON.stringify({ scripts: { start: 'node dist/index.js', build: 'tsc' }, main: 'dist/index.js' }));
  write(d3, 'tsconfig.json', '{}');
  const r3 = launch.detect(d3);
  assert.strictEqual(r3.command, 'npm start');
  assert.strictEqual(r3.build, 'npm run build', 'TypeScript は起動の前にビルド');

  const d4 = tmp('detect4');
  fs.copyFileSync(path.join(FX, 'hello64.exe'), path.join(d4, 'MyBot.exe'));
  fs.copyFileSync(path.join(FX, 'hello64.exe'), path.join(d4, 'unins000.exe'));
  write(d4, 'config.json', '{}');
  const r4 = launch.detect(d4);
  assert.strictEqual(r4.command, 'MyBot.exe', 'アンインストーラーは選ばない');
  assert.ok(!r4.candidates.some((c) => c.command === 'unins000.exe'));

  const d5 = tmp('detect5');
  write(d5, 'start.bat', '@echo off\r\n');
  write(d5, 'build/libs/bot-1.0.jar', 'x');
  write(d5, 'build/libs/bot-1.0-all.jar', 'xx');
  const r5 = launch.detect(d5);
  assert.strictEqual(r5.command, 'start.bat');
  assert.strictEqual(r5.candidates.find((c) => c.kind === 'java').command, 'build/libs/bot-1.0-all.jar', 'fat jar が先');

  const d7 = tmp('detect7');
  write(d7, 'main.py', '');
  write(d7, 'start.bat', '@echo off\r\n');
  write(d7, 'install.bat', '@echo off\r\n');
  const r7 = launch.detect(d7);
  assert.strictEqual(r7.command, 'start.bat', '作った人の start.bat が先');
  assert.ok(!r7.candidates.some((c) => c.command === 'install.bat'), 'install.bat は候補にしない');

  const d6 = tmp('detect6');
  write(d6, 'only.js', '');
  assert.strictEqual(launch.detect(d6).command, 'node only.js');
  assert.strictEqual(launch.detect(tmp('empty')).command, null);
});

// cmd.js でバッチを動かす
function runBat(text, { args = [], input = '', encoding = 'utf8', files = {} } = {}) {
  const dir = tmp('bat');
  for (const [k, v] of Object.entries(files)) write(dir, k, v);
  const buf = encoding === 'sjis' ? text : Buffer.from(text.replace(/\n/g, '\r\n'), 'utf8');
  fs.writeFileSync(path.join(dir, 'start.bat'), buf);
  const r = spawnSync(process.execPath, [CMD, 'start.bat', ...args], { cwd: dir, input, encoding: 'utf8', env: { ...process.env, BOTHOST_BOT_DIR: dir }, timeout: 30000 });
  return { out: r.stdout, err: r.stderr, code: r.status, dir };
}

test('小さな cmd: よく使う書き方', () => {
  const r = runBat([
    '@echo off',
    'title テスト',
    'chcp 65001 > nul',
    'cd /d %~dp0',
    'set NAME=world',
    'set "MSG=hello %NAME%"',
    'echo %MSG%!',
    'echo.',
    'set /a N=(1+2)*5',
    'if %N% EQU 15 (echo math ok) else (echo math bad)',
    'if /i "%NAME%"=="WORLD" echo ci ok',
    'if not exist nothing.txt echo nothing ok',
    'if defined NAME echo defined ok',
    'for %%x in (a b) do echo item %%x',
    'for /l %%i in (1,1,3) do call :add %%i',
    'echo total=%TOTAL%',
    'echo %NAME:o=0% %NAME:~1,3%',
    'setlocal enabledelayedexpansion',
    'set C=0',
    'for %%i in (1 2 3) do (',
    '  set /a C+=%%i',
    '  echo C=!C!',
    ')',
    'endlocal',
    'echo line > out.txt',
    'echo two >> out.txt',
    'type out.txt | find "two"',
    'for /f "tokens=1,2 delims=," %%a in (data.csv) do echo %%b-%%a',
    'set /p ANSWER=質問:',
    'echo answer=%ANSWER%',
    'echo 1 %1 2 %2 all %*',
    'goto skip',
    'echo not shown',
    ':skip',
    'exit /b 7',
    ':add',
    'set /a TOTAL+=%1',
    'goto :eof',
  ].join('\n'), { args: ['x', 'y z'], input: 'yes\n', files: { 'data.csv': 'a,b\nc,d\n' } });
  assert.strictEqual(r.code, 7, r.err);
  const lines = r.out.split('\n');
  for (const want of ['hello world!', '', 'math ok', 'ci ok', 'nothing ok', 'defined ok', 'item a', 'item b', 'total=6', 'w0rld orl',
    'C=1', 'C=3', 'C=6', 'two ', 'b-a', 'd-c', '質問:answer=yes', '1 x 2 "y z" all x "y z"']) {
    assert.ok(lines.includes(want), `「${want}」がありません:\n${r.out}\n${r.err}`);
  }
  assert.ok(!r.out.includes('not shown'));
});

test('小さな cmd: Python などを呼ぶ・Shift_JIS のファイル・エラーの番号', () => {
  const py = spawnSync('python3', ['--version']).status === 0;
  if (py) {
    const r = runBat('@echo off\npy -3 main.py one\nif errorlevel 1 echo failed %errorlevel%\npython main.py\n', { files: { 'main.py': 'import sys\nprint("py", sys.argv[1:])\nsys.exit(len(sys.argv) - 1)\n' } });
    assert.match(r.out, /py \['one'\]\nfailed 1\npy \[\]/);
    assert.strictEqual(r.code, 0);
  }
  // 日本語の Windows のメモ帳で保存したもの (Shift_JIS)
  const sjis = Buffer.from([0x40, 0x65, 0x63, 0x68, 0x6f, 0x20, 0x6f, 0x66, 0x66, 0x0d, 0x0a, 0x65, 0x63, 0x68, 0x6f, 0x20, 0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x0d, 0x0a]);
  assert.strictEqual(runBat(sjis, { encoding: 'sjis' }).out, '日本語\n');
  // Windows の仮想環境を使う書き方も、そのまま動く
  if (py) {
    const rv = runBat('@echo off\npython -m venv venv\ncall venv\\Scripts\\activate.bat\nvenv\\Scripts\\python.exe main.py\n', { files: { 'main.py': 'print("venv ok")\n' } });
    assert.match(rv.out, /venv ok/, rv.err);
  }
  const r2 = runBat('@echo off\nnosuchcommand_xyz\necho code=%errorlevel%\n');
  assert.match(r2.out, /code=9009/);
  assert.match(r2.err, /認識されていません/);
  // ping で待つ書き方・timeout・pause は止まらずに進む
  const t0 = Date.now();
  const r3 = runBat('@echo off\nping -n 2 127.0.0.1 > nul\ntimeout /t 1 /nobreak > nul\npause\necho done\n');
  assert.strictEqual(r3.out, 'done\n');
  assert.ok(Date.now() - t0 >= 1900, '2 秒くらい待つ');
  // start で裏で動かしたものが終わるまで待つ (bot が start で起動しても、すぐに「終了」にならない)
  const r4 = runBat(`@echo off\nstart "" "${process.execPath}" -e "setTimeout(()=>console.log('bg done'),300)"\necho main done\n`);
  assert.match(r4.out, /main done\n[\s\S]*bg done/);
});

test('ZIP: 日本語の名前 (Shift_JIS)・ディスクから少しずつ読む・書きながら送る', async () => {
  // Windows の「圧縮フォルダー」は名前を Shift_JIS で入れる (UTF-8 の印なし)
  const name = Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x2e, 0x74, 0x78, 0x74]); // テスト.txt (10 バイト)
  const sj = zip.createZip([{ name: 'ABCDEFGHIJ', data: Buffer.from('こんにちは') }]);
  for (let at = sj.indexOf('ABCDEFGHIJ'); at >= 0; at = sj.indexOf('ABCDEFGHIJ', at + 1)) name.copy(sj, at);
  sj.writeUInt16LE(0, 6); // ローカルヘッダーの UTF-8 の印を外す
  sj.writeUInt16LE(0, sj.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8); // 目次の UTF-8 の印を外す
  const entries = zip.readZip(sj);
  assert.strictEqual(entries[0].name, 'テスト.txt');
  assert.strictEqual(entries[0].data.toString(), 'こんにちは');

  // 大きなファイルを含む ZIP を、ディスクから 1 つずつ
  const dir = tmp('zip');
  const big = Buffer.alloc(3 * 1048576, 0x41);
  const file = path.join(dir, 'a.zip');
  fs.writeFileSync(file, zip.createZip([{ name: 'big.bin', data: big }, { name: 'dir/s.txt', data: Buffer.from('s') }]));
  const o = zip.openZip(file);
  assert.deepStrictEqual(o.entries.map((e) => [e.name, e.size]), [['big.bin', big.length], ['dir/s.txt', 1]]);
  assert.ok(o.entries[0].read().equals(big));
  o.close();

  // streamZip → readZip で元に戻る (実行できるファイルの印も)
  write(dir, 'src/x.sh', '#!/bin/sh\n');
  fs.chmodSync(path.join(dir, 'src/x.sh'), 0o755);
  const chunks = [];
  const { Writable } = require('stream');
  const out = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
  await zip.streamZip(out, [{ name: 'src/x.sh', file: path.join(dir, 'src/x.sh'), executable: true }, { name: 'big.bin', file }]);
  const back = zip.readZip(Buffer.concat(chunks));
  assert.strictEqual(back[0].name, 'src/x.sh');
  assert.ok(back[0].executable);
  assert.ok(back[1].data.equals(fs.readFileSync(file)));
});

// ----- サーバー全体 -----
async function startApp(t) {
  require('../lib/auth').resetAttempts();
  const dataDir = tmp('srv');
  const app = createApp({ dataDir, isolate: false, keepAwakeUrl: '', backup: {}, resumeGapMs: 0, restartBackoffMs: 100 });
  await app.init();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, { raw = false, headers = {} } = {}) => {
    const h = { 'X-BotHost': '1', Cookie: cookie, ...headers };
    let data = body;
    if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') { data = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers: h, body: data, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc && sc.startsWith('bothost_session=')) cookie = sc.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* テキスト */ }
    return { status: res.status, body: json ?? text, headers: res.headers };
  };
  await call('POST', '/api/register', { username: 'admin', password: 'password-123' });
  t.after(async () => { await app.shutdown(); });
  return { app, call, base, dataDir };
}

test('サーバー: ファイルから作る・自動の起動方法・Web 公開・大きなファイル', async (t) => {
  const { app, call, base, dataDir } = await startApp(t);
  const { body: { bot } } = await call('POST', '/api/bots', { name: 'web' });
  assert.strictEqual(bot.commandMode, 'auto');
  assert.ok(bot.port >= 30000, '待ち受ける番号が決まる');

  // 大きなファイル (5 MB) を送る → そのまま読める・ダウンロードできる
  const big = Buffer.alloc(5 * 1048576);
  for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
  assert.strictEqual((await call('PUT', `/api/bots/${bot.id}/file?path=data/big.bin`, big)).status, 200);
  const dl = await call('GET', `/api/bots/${bot.id}/file?path=data/big.bin&download=1`, undefined, { raw: true });
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(big));
  // 上限より大きいと断る
  app.cfg.maxUploadMB = 1;
  assert.strictEqual((await call('PUT', `/api/bots/${bot.id}/file?path=too.bin`, Buffer.alloc(2 * 1048576))).status, 413);
  assert.ok(!fs.existsSync(path.join(dataDir, 'bots', bot.id, 'too.bin')));
  app.cfg.maxUploadMB = 100;

  // .exe を入れると、説明と「このファイルで起動」のコマンドが出る
  await call('PUT', `/api/bots/${bot.id}/file?path=MyBot.exe`, fs.readFileSync(path.join(FX, 'hello64.exe')));
  const info = (await call('GET', `/api/bots/${bot.id}/fileinfo?path=MyBot.exe`)).body;
  assert.match(info.info.text, /Windows の実行ファイル \(64 ビット/);
  assert.strictEqual(info.command, 'MyBot.exe');
  const old = (await call('GET', `/api/bots/${bot.id}/fileinfo?path=data/big.bin`)).body;
  assert.strictEqual(old.command, null);

  // 自動: Web サーバーの Python があれば、それ (.exe より先)
  await call('PUT', `/api/bots/${bot.id}/file?path=main.py`, [
    'import os, http.server',
    'class H(http.server.BaseHTTPRequestHandler):',
    '    def do_GET(self):',
    '        body = ("path=" + self.path + " cookie=" + str(self.headers.get("Cookie")) + " prefix=" + str(self.headers.get("X-Forwarded-Prefix"))).encode()',
    '        self.send_response(200); self.send_header("Set-Cookie", "bothost_session=evil; Path=/"); self.send_header("Set-Cookie", "mine=1"); self.end_headers(); self.wfile.write(body)',
    '    def log_message(self, *a): pass',
    'print("listening", os.environ["PORT"], flush=True)',
    'http.server.HTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()',
  ].join('\n'));
  let launchInfo = (await call('GET', `/api/bots/${bot.id}`)).body.launch;
  assert.strictEqual(launchInfo.command, 'python3 main.py');
  assert.strictEqual(launchInfo.auto, true);
  assert.ok(launchInfo.candidates.some((c) => c.command === 'MyBot.exe'));

  // Web 公開はまだオフ → 404
  assert.strictEqual((await call('PATCH', `/api/bots/${bot.id}`, { web: { enabled: true } })).status, 200);
  const { body: { bot: b2 } } = await call('GET', `/api/bots/${bot.id}`);
  assert.ok(b2.web.enabled && b2.web.path.startsWith('/w/'));
  const notRunning = await fetch(`${base}${b2.web.path}`);
  assert.strictEqual(notRunning.status, 502);
  assert.match(await notRunning.text(), /動いていません/);

  await call('POST', `/api/bots/${bot.id}/start`);
  for (let i = 0; i < 100 && !app.runner.logs(bot.id).some((e) => e.l.startsWith('listening')); i++) await new Promise((r) => setTimeout(r, 100));
  const res = await fetch(`${base}${b2.web.path}hello?x=1`, { headers: { Cookie: 'bothost_session=SECRET; other=ok' } });
  const text = await res.text();
  assert.strictEqual(res.status, 200, text);
  assert.match(text, /^path=\/hello\?x=1 cookie=other=ok prefix=\/w\//, 'BotHost のログインの cookie は bot に渡さない');
  assert.match(res.headers.get('content-security-policy'), /sandbox/, 'bot のページは別のサイト扱い');
  const setCookies = res.headers.getSetCookie();
  assert.deepStrictEqual(setCookies, ['mine=1'], 'bot は BotHost のログインを書き換えられない');
  assert.strictEqual((await fetch(`${base}/w/notarealslug123/`)).status, 404);
  // 作り直すと前の URL は使えない
  const { body: { bot: b3 } } = await call('PATCH', `/api/bots/${bot.id}`, { web: { regenerate: true } });
  assert.notStrictEqual(b3.web.path, b2.web.path);
  assert.strictEqual((await fetch(`${base}${b2.web.path}`)).status, 404);
  await call('POST', `/api/bots/${bot.id}/stop`);

  // 手で決めた起動コマンド → manual。auto に戻せる
  let p = (await call('PATCH', `/api/bots/${bot.id}`, { startCommand: 'MyBot.exe' })).body;
  assert.strictEqual(p.bot.commandMode, 'manual');
  assert.strictEqual(p.launch.command, 'MyBot.exe');
  p = (await call('PATCH', `/api/bots/${bot.id}`, { commandMode: 'auto' })).body;
  assert.strictEqual(p.launch.command, 'python3 main.py');
  assert.strictEqual((await call('PATCH', `/api/bots/${bot.id}`, { timezone: 'Not/AZone' })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/bots/${bot.id}`, { timezone: 'Asia/Tokyo' })).body.bot.timezone, 'Asia/Tokyo');

  // ZIP の読み込み (中の 1 つのフォルダーは外す) → 起動方法が見つかる
  const { body: { bot: zb } } = await call('POST', '/api/bots', { name: 'zipped' });
  const z = zip.createZip([{ name: 'mybot/start.bat', data: Buffer.from('@echo off\r\necho hi from bat\r\n') }, { name: 'mybot/README.txt', data: Buffer.from('x') }]);
  const imp = (await call('POST', `/api/bots/${zb.id}/import?replace=1`, z)).body;
  assert.strictEqual(imp.count, 2);
  assert.strictEqual(imp.launch.command, 'start.bat');
  assert.strictEqual(imp.launch.kind, 'batch');
  // ZIP で保存 → 同じ中身
  const ex = await call('GET', `/api/bots/${zb.id}/export`, undefined, { raw: true });
  const names = zip.readZip(Buffer.from(await ex.arrayBuffer())).map((e) => e.name).sort();
  assert.deepStrictEqual(names, ['README.txt', 'start.bat']);
  // .bat で起動 → ログに出る
  await call('POST', `/api/bots/${zb.id}/start`);
  for (let i = 0; i < 100 && !app.runner.logs(zb.id).some((e) => e.l === 'hi from bat'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(app.runner.logs(zb.id).some((e) => e.l === 'hi from bat'), JSON.stringify(app.runner.logs(zb.id)));
  assert.strictEqual((await call('GET', `/api/bots/${zb.id}`)).body.bot.runtime, 'batch', '起動した言語を覚える');

  // 32 ビットの .exe は、起動の前にわかりやすく断る
  const { body: { bot: xb } } = await call('POST', '/api/bots', { name: 'x32' });
  await call('PUT', `/api/bots/${xb.id}/file?path=old.exe`, fs.readFileSync(path.join(FX, 'hello32.exe')));
  const l32 = (await call('GET', `/api/bots/${xb.id}`)).body.launch;
  assert.match(l32.problem, /32 ビット/);
  await call('POST', `/api/bots/${xb.id}/start`);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(app.runner.logs(xb.id).some((e) => /32 ビット/.test(e.l)));
  assert.strictEqual(app.runner.state(xb.id).status, 'crashed');

  // テンプレート: 環境変数の欄を用意する・LINE は Web 公開がオン
  const { body: { bot: lb } } = await call('POST', '/api/bots', { name: 'line', template: 'python-line' });
  assert.deepStrictEqual(lb.env, { LINE_CHANNEL_SECRET: false, LINE_CHANNEL_ACCESS_TOKEN: false });
  assert.ok(lb.web.enabled);
  const ports = new Set(app.store.bots.map((b) => b.port));
  assert.strictEqual(ports.size, app.store.bots.length, '待ち受ける番号は重ならない');
});

test('テンプレートのファイルがそろっている', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const ids = [...src.matchAll(/^ {2}'([a-z0-9-]+)': \{ group:/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 12);
  for (const id of ids) {
    const dir = path.join(__dirname, '..', 'templates', id);
    assert.ok(fs.existsSync(dir), id);
    const found = launch.detect(dir);
    assert.ok(found.command && !found.candidates[0].problem, `${id}: ${JSON.stringify(found)}`);
  }
  // Python のテンプレートは文法が正しい
  if (spawnSync('python3', ['--version']).status === 0) {
    for (const id of ids.filter((x) => x.startsWith('python') || x === 'bat-blank')) {
      execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', path.join(__dirname, '..', 'templates', id, 'main.py')]);
    }
  }
  for (const id of ids.filter((x) => x.startsWith('node'))) {
    execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'templates', id, 'index.js')]);
  }
});

test('Web 公開: WebSocket もつながる', async (t) => {
  const { app, call, base } = await startApp(t);
  const { body: { bot } } = await call('POST', '/api/bots', { name: 'ws' });
  const { body: { bot: b } } = await call('PATCH', `/api/bots/${bot.id}`, { web: { enabled: true } });
  // bot の代わりに、その番号で待ち受けるサーバー (Upgrade を受けて、届いた文字を大文字にして返す)
  const fake = http.createServer();
  fake.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n');
    socket.write(`path=${req.url} cookie=${req.headers.cookie || ''}\n`);
    socket.on('data', (d) => socket.write(String(d).toUpperCase()));
  });
  await new Promise((r) => fake.listen(b.port, '127.0.0.1', r));
  t.after(() => fake.close());
  const net = require('net');
  const u = new URL(base);
  const got = await new Promise((resolve, reject) => {
    const s = net.connect(Number(u.port), u.hostname, () => {
      s.write(`GET ${b.web.path}socket?q=1 HTTP/1.1\r\nHost: x\r\nUpgrade: test\r\nConnection: Upgrade\r\nCookie: bothost_session=SECRET; a=b\r\n\r\n`);
      setTimeout(() => s.write('ping'), 100);
    });
    let buf = '';
    s.on('data', (d) => { buf += d; if (buf.includes('PING')) { s.destroy(); resolve(buf); } });
    s.on('error', reject);
    setTimeout(() => { s.destroy(); reject(new Error(`時間切れ: ${buf}`)); }, 5000);
  });
  assert.match(got, /101 Switching/);
  assert.match(got, /path=\/socket\?q=1 cookie=a=b/);
  assert.match(got, /PING/);
  void app;
});

test('止まった原因と直し方 (ヒント)', () => {
  const hints = require('../lib/hints');
  const dir = tmp('hints');
  write(dir, 'main.py', 'import os\nimport discord\nTOKEN = os.getenv("TOKEN")\nkey = os.environ["OPENAI_API_KEY"]\n');
  write(dir, '.env', 'OPENAI_API_KEY="sk-xxx"\nEMPTY=\n');
  assert.deepStrictEqual(hints.scanEnv(dir).used, ['OPENAI_API_KEY', 'TOKEN']);
  assert.deepStrictEqual(hints.missingEnv(dir, {}), ['TOKEN'], '.env にあるものは入っている扱い');
  assert.ok(hints.usesDiscord(dir));
  const login = 'discord.errors.HTTPException: 401 Unauthorized (error code: 0): 401: Unauthorized\ndiscord.errors.LoginFailure: Improper token has been passed.';
  assert.match(hints.diagnose(login, { bot: { env: {} }, dir }).text, /環境変数 TOKEN から/);
  const wrong = hints.diagnose(login, { bot: { env: { TOKEN: 'x' } }, dir });
  assert.ok(wrong.fatal);
  assert.match(wrong.text, /Reset Token/);
  assert.match(hints.diagnose('Error [TokenInvalid]: An invalid token was provided.', { bot: { env: { DISCORD_TOKEN: 'x' } } }).text, /Reset Token/);
  assert.match(hints.diagnose('discord.errors.PrivilegedIntentsRequired: Shard ID None is requesting privileged intents', {}).text, /MESSAGE CONTENT INTENT/);
  const mod = hints.diagnose("ModuleNotFoundError: No module named 'dotenv'", { dir });
  assert.match(mod.text, /python-dotenv/);
  assert.deepStrictEqual(mod.action, { kind: 'pip', pkg: 'python-dotenv' }, 'ボタン 1 つで足せる');
  assert.strictEqual(hints.diagnose("ModuleNotFoundError: No module named 'mysterylib'", { dir }).action, null, '知らない名前は勝手に入れない');
  assert.deepStrictEqual(hints.diagnose("Error: Cannot find module 'dotenv'", {}).action, { kind: 'npm', pkg: 'dotenv' });
  assert.strictEqual(hints.diagnose("Error: Cannot find module 'node:fs'", {}).action, null);
  assert.match(hints.diagnose("Error: Cannot find module 'discord.js'\nRequire stack:", {}).text, /discord\.js/);
  assert.strictEqual(hints.diagnose("Error: Cannot find module './commands/ping'", {}), null, '自分のファイルは別');
  assert.match(hints.diagnose("KeyError: 'API_KEY'\n  os.environ['API_KEY']", {}).text, /API_KEY/);
  assert.strictEqual(hints.diagnose('openai 401 Unauthorized', {}), null, 'Discord 以外の 401 は Discord のトークンのせいにしない');
});

test('サーバー: 空の環境変数は渡さない・トークンを整える・原因を伝えて無駄な再起動をしない', async (t) => {
  const { app, call } = await startApp(t);
  const { body: { bot } } = await call('POST', '/api/bots', { name: 'tok', template: 'python-discord' });
  // まだ入れていない DISCORD_TOKEN (空の欄) は bot に渡さない → .env の値が使える
  await call('PUT', `/api/bots/${bot.id}/file?path=main.py`, [
    'import os',
    'print("env", repr(os.environ.get("DISCORD_TOKEN")), flush=True)',
    'class LoginFailure(Exception): pass',
    'raise LoginFailure("Improper token has been passed.")  # discord.errors.LoginFailure のつもり',
  ].join('\n'));
  await call('PUT', `/api/bots/${bot.id}/file?path=requirements.txt`, '');
  const before = (await call('GET', `/api/bots/${bot.id}`)).body.launch;
  assert.strictEqual(before.discord, false);
  await call('POST', `/api/bots/${bot.id}/start`);
  for (let i = 0; i < 100 && app.runner.state(bot.id).status !== 'crashed'; i++) await new Promise((r) => setTimeout(r, 100));
  const logs = app.runner.logs(bot.id).map((e) => e.l);
  assert.ok(logs.includes('env None'), logs.join('\n'));
  assert.ok(logs.some((l) => l.startsWith('💡 ') && /環境変数 DISCORD_TOKEN から/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /再起動しても直らない/.test(l)));
  assert.strictEqual(app.runner.state(bot.id).status, 'crashed', '自動の再起動はしない');
  assert.match((await call('GET', `/api/bots/${bot.id}`)).body.bot.hint, /トークン/);

  // コードが TOKEN という名前で読むなら、Discord の欄に入れたトークンをそこにも入れる。前後の空白・引用符・「Bot 」は外す
  await call('PUT', `/api/bots/${bot.id}/file?path=main.py`, 'import os\nimport discord\nprint(os.getenv("TOKEN"))\n');
  const info = (await call('GET', `/api/bots/${bot.id}`)).body.launch;
  assert.ok(info.discord);
  assert.deepStrictEqual(info.missingEnv, ['TOKEN']);
  await call('PATCH', `/api/bots/${bot.id}`, { env: { DISCORD_TOKEN: ' "Bot abc.def​.ghi"\n' } });
  const stored = app.store.bots.find((b) => b.id === bot.id).env;
  assert.strictEqual(stored.DISCORD_TOKEN, 'abc.def.ghi');
  assert.strictEqual(stored.TOKEN, 'abc.def.ghi');
  assert.deepStrictEqual((await call('GET', `/api/bots/${bot.id}`)).body.launch.missingEnv, []);
});

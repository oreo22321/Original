'use strict';
// 本物のイメージ (Dockerfile) の中で、いろいろな種類の bot を本当に動かして確かめるスクリプト。
//   node test/smoke-runtimes.js http://localhost:3000 [--net]
//   --net  インターネットが要るもの (Bun・ffmpeg を自動で入れる) も確かめる
// .bat (→ Python)・Windows の .exe (Wine)・.jar (Java)・.NET の .exe・TypeScript・Ruby・PHP・Lua・シェル・Web 公開
const fs = require('fs');
const path = require('path');

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const net = process.argv.includes('--net');
const FX = path.join(__dirname, 'fixtures', 'runtimes');
const USER = { username: 'runtimes', password: 'runtimes-password-1' };

let cookie = '';
async function call(method, url, body) {
  const headers = { 'X-BotHost': '1' };
  if (cookie) headers.Cookie = cookie;
  let data = body;
  if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') { data = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(base + url, { method, headers, body: data });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* テキスト */ }
  if (res.status >= 400) throw new Error(`${method} ${url}: ${res.status} ${text}`);
  return json ?? text;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  return JSON.parse(text.split('\n').find((l) => l.startsWith('data: ')).slice(6)).logs.map((l) => l.l);
}
async function waitLog(id, re, ms = 120000) {
  const end = Date.now() + ms;
  for (;;) {
    const lines = await logs(id);
    if (lines.some((l) => re.test(l))) return lines;
    if (Date.now() > end) throw new Error(`時間切れ: ${re}\n${lines.slice(-25).join('\n')}`);
    await sleep(700);
  }
}

// bot を作ってファイルを入れ、起動して、ログに出るのを待つ
async function check(label, files, { expect, stdin, command, timeoutMs } = {}) {
  const started = Date.now();
  const { bot } = await call('POST', '/api/bots', { name: label.slice(0, 40) });
  await call('PATCH', `/api/bots/${bot.id}`, { autoRestart: false });
  for (const [rel, data] of Object.entries(files)) await call('PUT', `/api/bots/${bot.id}/file?path=${encodeURIComponent(rel)}`, data);
  if (command) await call('PATCH', `/api/bots/${bot.id}`, { startCommand: command });
  const { launch } = await call('GET', `/api/bots/${bot.id}`);
  if (launch.problem) throw new Error(`${label}: ${launch.problem}`);
  await call('POST', `/api/bots/${bot.id}/start`);
  if (stdin) {
    await waitLog(bot.id, stdin.after, timeoutMs);
    await call('POST', `/api/bots/${bot.id}/stdin`, { text: stdin.text });
  }
  const lines = await waitLog(bot.id, expect, timeoutMs);
  console.log(`✓ ${label}: ${launch.command} (${launch.label}) — ${lines.find((l) => expect.test(l))} [${((Date.now() - started) / 1000).toFixed(1)} 秒]`);
  return bot;
}

async function main() {
  const cfg = await call('GET', '/api/config');
  if (cfg.firstUser) await call('POST', '/api/register', USER); else await call('POST', '/api/login', USER);
  const fx = (f) => fs.readFileSync(path.join(FX, f));

  await check('バッチ (.bat → Python)', {
    'start.bat': Buffer.from('@echo off\r\nchcp 65001 > nul\r\ncd /d %~dp0\r\nset GREETING=こんにちは\r\npy -3 main.py\r\n'),
    'main.py': 'import os\nprint("bat->python", os.environ["GREETING"])\n',
  }, { expect: /^bat->python こんにちは$/ });

  await check('Windows の .exe (Wine)', { 'MyBot.exe': fx('hello64.exe') }, {
    stdin: { after: /hello from exe \(64-bit\)/, text: 'from console' }, expect: /^got=from console$/, timeoutMs: 180000,
  });

  await check('Java (.jar)', { 'bot.jar': fx('hello.jar') }, { stdin: { after: /hello from java/, text: 'jj' }, expect: /^got=jj$/ });

  const dn = {};
  for (const f of fs.readdirSync(path.join(FX, 'dotnet'))) dn[f] = fx(path.join('dotnet', f));
  await check('.NET の .exe (C#)', dn, { stdin: { after: /hello from dotnet/, text: 'dd' }, expect: /^got=dd$/ });

  await check('TypeScript', { 'index.ts': 'interface A { n: number }\nconst a: A = { n: 42 };\nconsole.log(`ts ok ${a.n}`);\n' }, { expect: /^ts ok 42$/ });
  await check('Ruby', { 'bot.rb': 'puts "ruby ok #{RUBY_VERSION}"\n' }, { expect: /^ruby ok \d/ });
  await check('PHP', { 'bot.php': '<?php echo "php ok " . PHP_VERSION . "\\n";' }, { expect: /^php ok \d/ });
  await check('Lua', { 'main.lua': 'print("lua ok " .. _VERSION)\n' }, { expect: /^lua ok Lua/ });
  await check('シェル (.sh)', { 'start.sh': '#!/bin/bash\r\necho "sh ok $BOT_NAME"\r\n' }, { expect: /^sh ok シェル/ });

  // Web 公開: PORT で待ち受けて、/w/… から届く
  const web = await check('Web 公開', {
    'main.py': 'import os, http.server\nclass H(http.server.BaseHTTPRequestHandler):\n    def do_GET(self):\n        self.send_response(200); self.end_headers(); self.wfile.write(b"web ok " + self.path.encode())\nprint("listening", flush=True)\nhttp.server.HTTPServer(("0.0.0.0", int(os.environ["PORT"])), H).serve_forever()\n',
  }, { expect: /^listening$/ });
  const { bot: wb } = await call('PATCH', `/api/bots/${web.id}`, { web: { enabled: true } });
  const page = await (await fetch(`${base}${wb.web.path}callback`)).text();
  if (page !== 'web ok /callback') throw new Error(`Web 公開: ${page}`);
  console.log(`✓ Web 公開: ${wb.web.path}callback → ${page}`);

  if (net) {
    await check('Bun (自動で入れる)', { 'index.js': 'console.log("bun ok", Bun.version)\n' }, { command: 'bun index.js', expect: /^bun ok \d/, timeoutMs: 240000 });
    await check('ffmpeg (音楽 bot・自動で入れる)', {
      'main.py': '# discord.FFmpegPCMAudio を使う音楽 bot のつもり\nimport subprocess\nout = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout\nprint("ffmpeg ok", out.split()[2])\n',
    }, { expect: /^ffmpeg ok \S+/, timeoutMs: 240000 });
  }
  const admin = await call('GET', '/api/admin').catch(() => null);
  if (admin) console.log('使える言語:', admin.server.runtimes.map((r) => `${r.label}${r.ok ? '' : ' ×'}`).join(' / '));
  console.log('すべての種類の bot が動きました');
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });

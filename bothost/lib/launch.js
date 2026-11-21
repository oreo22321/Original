'use strict';
// 起動コマンドを、このサーバー (Linux) で本当に動かすコマンドに変えます。
//   "start.bat"                → node lib/cmd.js start.bat          (Windows のバッチを、小さな cmd で動かす)
//   "bot.exe"                  → dotnet bot.dll / wine64 bot.exe    (.NET 製なら .NET で。ほかは Wine で)
//   "bot.jar"                  → java -jar bot.jar                  (メモリの設定つき)
//   "py main.py" "python main.py" → python3 main.py
//   "npm run build && node ."  → bash -c "…"                         (シェルの記号があるとき)
// また、bot のファイルから起動方法を自動で見つけます (detect)。
const fs = require('fs');
const path = require('path');

const CMD_JS = path.join(__dirname, 'cmd.js');

// 言語・種類 (画面の表示とライブラリのインストールに使う)
const KINDS = {
  python: { label: 'Python', icon: 'python' },
  node: { label: 'Node.js', icon: 'node' },
  ts: { label: 'TypeScript', icon: 'node' },
  bun: { label: 'Bun', icon: 'node' },
  java: { label: 'Java', icon: 'java' },
  dotnet: { label: '.NET (C#)', icon: 'dotnet' },
  wine: { label: 'Windows (.exe)', icon: 'windows' },
  batch: { label: 'バッチ (.bat)', icon: 'windows' },
  shell: { label: 'シェル', icon: 'terminal' },
  ruby: { label: 'Ruby', icon: 'code' },
  php: { label: 'PHP', icon: 'code' },
  lua: { label: 'Lua', icon: 'code' },
  perl: { label: 'Perl', icon: 'code' },
  binary: { label: '実行ファイル', icon: 'terminal' },
  go: { label: 'Go', icon: 'code' },
};

// コマンドの名前 → 種類
const COMMAND_KIND = {
  python: 'python', python3: 'python', py: 'python', pythonw: 'python', pip: 'python', pip3: 'python', uv: 'python',
  node: 'node', npm: 'node', npx: 'node', yarn: 'node', pnpm: 'node', tsx: 'ts', 'ts-node': 'ts', bun: 'bun', bunx: 'bun',
  java: 'java', javaw: 'java', dotnet: 'dotnet', wine: 'wine', wine64: 'wine',
  bash: 'shell', sh: 'shell', ruby: 'ruby', bundle: 'ruby', php: 'php', composer: 'php', lua: 'lua', 'lua5.4': 'lua', luajit: 'lua',
  perl: 'perl', go: 'go', cmd: 'batch',
};
// Windows の名前を、ここでの名前に
const ALIAS = {
  py: 'python3', python: 'python3', pythonw: 'python3', 'python.exe': 'python3', 'py.exe': 'python3', 'pythonw.exe': 'python3',
  'node.exe': 'node', 'npm.cmd': 'npm', 'npx.cmd': 'npx', 'yarn.cmd': 'yarn', 'pnpm.cmd': 'pnpm', javaw: 'java', 'java.exe': 'java', 'javaw.exe': 'java',
  'dotnet.exe': 'dotnet', 'ruby.exe': 'ruby', 'php.exe': 'php', lua: 'lua5.4', 'lua.exe': 'lua5.4', 'lua54': 'lua5.4', 'pip.exe': 'pip', 'bun.exe': 'bun',
};

const EXT_KIND = {
  '.py': 'python', '.pyw': 'python', '.pyz': 'python', '.pyc': 'python',
  '.js': 'node', '.mjs': 'node', '.cjs': 'node',
  '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'ts',
  '.jar': 'java', '.class': 'java', '.dll': 'dotnet', '.exe': 'wine', '.com': 'wine',
  '.bat': 'batch', '.cmd': 'batch', '.sh': 'shell', '.bash': 'shell', '.command': 'shell',
  '.rb': 'ruby', '.php': 'php', '.lua': 'lua', '.pl': 'perl', '.go': 'go',
};

// ----- ファイルの中身を調べる -----
function readHead(file, n = 4096) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(n);
    const len = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, len);
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// Windows の実行ファイル (PE) を調べる: 64/32 ビット、.NET か、画面のあるアプリか
function peInfo(file) {
  const head = readHead(file, 4096);
  if (!head || head.length < 64 || head[0] !== 0x4d || head[1] !== 0x5a) return null; // MZ
  const off = head.readUInt32LE(0x3c);
  let buf = head;
  if (off + 256 > head.length) { buf = readHead(file, off + 512); if (!buf) return null; }
  if (off + 24 > buf.length || buf.toString('latin1', off, off + 4) !== 'PE\0\0') return null;
  const machine = buf.readUInt16LE(off + 4);
  const opt = off + 24;
  const magic = buf.readUInt16LE(opt);
  const pe32plus = magic === 0x20b;
  const subsystem = buf.readUInt16LE(opt + 68);
  // データディレクトリの 15 番目 (14) が .NET (CLR) のヘッダー
  const dirs = opt + (pe32plus ? 112 : 96);
  let managed = false;
  if (dirs + 15 * 8 <= buf.length) managed = buf.readUInt32LE(dirs + 14 * 8) !== 0;
  const arch = machine === 0x8664 ? 'x64' : machine === 0x14c ? 'x86' : machine === 0xaa64 ? 'arm64' : `0x${machine.toString(16)}`;
  return { arch, managed, gui: subsystem === 2 };
}

function isElf(file) {
  const h = readHead(file, 4);
  return !!h && h.length === 4 && h[0] === 0x7f && h.toString('latin1', 1, 4) === 'ELF';
}

function shebang(file) {
  const h = readHead(file, 256);
  if (!h || h[0] !== 0x23 || h[1] !== 0x21) return null; // #!
  const line = h.toString('utf8').split('\n')[0].slice(2).replace(/\r$/, '').trim();
  return line ? line.split(/\s+/) : null;
}

// ファイルの種類 (画面に出す説明にも使う)
function describe(file) {
  const ext = path.extname(file).toLowerCase();
  const pe = (ext === '.exe' || ext === '.dll' || ext === '.com') ? peInfo(file) : null;
  if (pe) {
    if (ext === '.dll') return { kind: 'dotnet', text: pe.managed ? '.NET のライブラリ (.dll)' : 'Windows のライブラリ (.dll)', runnable: pe.managed };
    if (pe.managed) return { kind: 'dotnet', text: '.NET の実行ファイル', runnable: true, pe };
    return { kind: 'wine', text: `Windows の実行ファイル (${pe.arch === 'x64' ? '64' : pe.arch === 'x86' ? '32' : pe.arch} ビット${pe.gui ? '・画面あり' : ''})`, runnable: pe.arch === 'x64', pe };
  }
  if (ext === '.jar') return { kind: 'java', text: 'Java のプログラム (.jar)', runnable: true };
  if (EXT_KIND[ext] && ext !== '.exe' && ext !== '.dll') return { kind: EXT_KIND[ext], text: `${KINDS[EXT_KIND[ext]].label} のファイル`, runnable: true };
  if (isElf(file)) return { kind: 'binary', text: 'Linux の実行ファイル', runnable: true };
  if (shebang(file)) return { kind: 'shell', text: 'スクリプト (#!)', runnable: true };
  return null;
}

// ----- コマンドを分ける -----
// "python3 main.py --name 'a b'" → ["python3", "main.py", "--name", "a b"]
function splitCommand(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const ch of String(cmd)) {
    if (quote) {
      if (ch === quote) quote = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch; has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) { out.push(cur); cur = ''; has = false; }
    } else {
      cur += ch;
    }
  }
  if (cur || has) out.push(cur);
  return out;
}

// シェルの記号 (&& | ; > < $ ` *) があれば bash で動かす
function needsShell(cmd) {
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) { if (c === quote) quote = null; else if (quote === '"' && (c === '$' || c === '`')) return true; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ('&|;<>$`*?(){}~'.includes(c)) return true;
    if (c === '=' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cmd.slice(0, i))) return true; // FOO=bar cmd
  }
  return false;
}

// 大文字・小文字が違っても見つける (Windows は区別しないので、Main.py と書いてあって main.py しかない、などがよくある)
function findFile(dir, rel) {
  if (!rel || rel.includes('\0')) return null;
  const clean = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  const full = path.resolve(dir, clean);
  if (full !== dir && !full.startsWith(dir + path.sep)) return fs.existsSync(full) ? full : null;
  if (fs.existsSync(full)) return full;
  let cur = dir;
  for (const part of path.relative(dir, full).split(path.sep)) {
    let names;
    try { names = fs.readdirSync(cur); } catch { return null; }
    const hit = names.find((n) => n === part) || names.find((n) => n.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

const rel = (dir, full) => path.relative(dir, full).split(path.sep).join('/');

// Java の起動に、メモリの設定を足す (自分で -Xmx などを書いていなければ)
function javaFlags(args, memoryMB) {
  const has = (re) => args.some((a) => re.test(a));
  const flags = [];
  if (!has(/^-Xmx|^-XX:MaxRAM/)) flags.push(`-XX:MaxRAM=${memoryMB}m`, '-XX:MaxRAMPercentage=70');
  if (!has(/^-XX:\+Use\w+GC$/)) flags.push('-XX:+UseSerialGC');
  if (!has(/^-Xss/)) flags.push('-Xss512k');
  if (!has(/^-Dfile\.encoding/)) flags.push('-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8');
  return flags;
}

// .exe を動かす方法
function exeLaunch(dir, full, args) {
  const base = full.replace(/\.exe$/i, '');
  const name = rel(dir, full);
  // .NET (5 以降) で作ったもの: 同じ名前の .dll と .runtimeconfig.json がある → Linux の .NET でそのまま動く
  const dll = findFile(path.dirname(full), path.basename(base) + '.dll');
  const rc = findFile(path.dirname(full), path.basename(base) + '.runtimeconfig.json');
  if (dll && rc) return { argv: ['dotnet', rel(dir, dll), ...args], kind: 'dotnet', note: `${name} は .NET で作られているので、.NET で直接動かします` };
  const pe = peInfo(full);
  if (!pe) return { problem: `${name} は Windows の実行ファイルではないようです` };
  if (pe.managed) {
    if (rc) return { argv: ['dotnet', name, ...args], kind: 'dotnet' };
    return { problem: `${name} は .NET Framework (古い .NET) で作られているので動かせません。.NET 6 以降でビルドし直してください (dotnet publish)。` };
  }
  if (pe.arch === 'x86') return { problem: `${name} は 32 ビット版なので動かせません。64 ビット版の .exe を使うか、元のプログラム (.py・.js など) をアップロードしてください。` };
  if (pe.arch !== 'x64') return { problem: `${name} はこのサーバーの CPU 用ではないので動かせません (${pe.arch})。` };
  return { argv: ['wine64', name, ...args], kind: 'wine', note: pe.gui ? `${name} は画面のあるアプリです。画面は表示できないので、画面がなくても動くものだけ使えます` : null };
}

// 起動コマンド → 実際のコマンド
//   返り値: { argv, kind, entry (起動するファイル), note (知らせること), problem (動かせない理由) }
function resolve(dir, command, { memoryMB = 256, has = () => true } = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) return { problem: '起動コマンドが空です。設定タブで指定してください。' };
  if (needsShell(cmd)) {
    const first = splitCommand(cmd.replace(/^([A-Za-z_]\w*=\S*\s+)+/, ''))[0] || '';
    return { argv: ['bash', '-c', cmd], kind: COMMAND_KIND[(ALIAS[first.toLowerCase()] || first).replace(/\.exe$/i, '')] || kindOfPath(first) || 'shell' };
  }
  let argv = splitCommand(cmd);
  let [first, ...args] = argv;
  // "py -3 main.py" → python3 main.py
  const lower = first.toLowerCase();
  if (ALIAS[lower]) {
    first = ALIAS[lower];
    if (first === 'python3') args = args.filter((a, i) => !(i === 0 && /^-[23](\.\d+)?$/.test(a)));
  }
  if (first === 'cmd' && /^\/[ck]$/i.test(args[0] || '')) return { argv: ['node', CMD_JS, '/c', args.slice(1).join(' ')], kind: 'batch' };
  // 引数の \ を / に (src\main.py → src/main.py)
  args = args.map((a) => (a.includes('\\') && !/^[A-Za-z]:\\/.test(a) && findFile(dir, a) ? rel(dir, findFile(dir, a)) : a));

  // 1 つ目がファイル (start.bat / bot.exe / bot.jar / main.py / ./bot …)
  const own = !COMMAND_KIND[first] && !/^\//.test(first) ? findFile(dir, first) : null;
  const asFile = own && fs.statSync(own).isFile() ? own : null;
  if (asFile) return fileLaunch(dir, asFile, args, memoryMB);
  if (!COMMAND_KIND[first] && !first.includes('/') && !first.includes('\\')) {
    // "bot" と書いて bot.exe / bot.bat などがあるとき
    for (const ext of ['.exe', '.bat', '.cmd', '.jar', '.sh', '.py', '.js']) {
      const f = findFile(dir, first + ext);
      if (f) return fileLaunch(dir, f, args, memoryMB);
    }
  }
  const kind = COMMAND_KIND[first] || null;
  if (!kind && /\.(py|pyw|js|mjs|cjs|ts|bat|cmd|exe|jar|dll|sh|rb|php|lua|pl|ps1|go)$/i.test(first)) {
    return { problem: `${first} がありません。ファイルタブで入れるか、設定タブの起動コマンドを直してください。` };
  }
  if (kind && !has(first)) return { problem: missingTool(first), kind };
  // 起動するファイル (python3 main.py の main.py など) があるか確かめる
  const entryIdx = args.findIndex((a) => /\.(py|pyw|js|mjs|cjs|ts|mts|jar|dll|rb|php|lua|pl|exe|go)$/i.test(a));
  let entry = null;
  if (entryIdx >= 0 && first !== 'npm' && first !== 'npx' && first !== 'yarn' && first !== 'pnpm') {
    const f = findFile(dir, args[entryIdx]);
    if (!f) return { problem: `${args[entryIdx]} がありません。ファイルタブで作るか、設定タブの起動コマンドを直してください。`, kind };
    args[entryIdx] = rel(dir, f);
    entry = args[entryIdx];
    // "python bot.exe" のような書き間違いは、ファイルに合わせる
    if (/\.exe$/i.test(entry)) return { ...exeLaunch(dir, f, args.slice(entryIdx + 1)), entry };
  }
  if (first === 'java') args = [...javaFlags(args, memoryMB), ...args];
  return { argv: [first, ...args], kind: kind || 'binary', entry };
}

function kindOfPath(p) {
  return EXT_KIND[path.extname(String(p)).toLowerCase()] || null;
}

function missingTool(name) {
  if (name === 'go') return 'Go のプログラムは、Linux 用にビルドしたファイルをアップロードしてください (GOOS=linux GOARCH=amd64 go build)。';
  if (name === 'pwsh' || name === 'powershell') return 'PowerShell は使えません。中身が簡単なら .bat か .sh に書き直してください。';
  return `「${name}」はこのサーバーにありません。`;
}

function fileLaunch(dir, full, args, memoryMB) {
  const name = rel(dir, full);
  const ext = path.extname(full).toLowerCase();
  const run = (argv, kind, extra = {}) => ({ argv, kind, entry: name, ...extra });
  switch (ext) {
    case '.bat': case '.cmd': return run(['node', CMD_JS, name, ...args], 'batch');
    case '.exe': case '.com': return { ...exeLaunch(dir, full, args), entry: name };
    case '.jar': return run(['java', ...javaFlags(args, memoryMB), '-jar', name, ...args], 'java');
    case '.class': return run(['java', ...javaFlags(args, memoryMB), '-cp', path.posix.dirname(name), path.basename(name, '.class'), ...args], 'java');
    case '.dll': return run(['dotnet', name, ...args], 'dotnet');
    case '.py': case '.pyw': case '.pyz': case '.pyc': return run(['python3', name, ...args], 'python');
    case '.js': case '.mjs': case '.cjs': return run(['node', name, ...args], 'node');
    case '.ts': case '.mts': case '.cts': case '.tsx': return run(['tsx', name, ...args], 'ts');
    case '.sh': case '.bash': case '.command': return run(['bash', name, ...args], 'shell');
    case '.rb': return run(fs.existsSync(path.join(dir, 'Gemfile')) ? ['bundle', 'exec', 'ruby', name, ...args] : ['ruby', name, ...args], 'ruby');
    case '.php': return run(['php', name, ...args], 'php');
    case '.lua': return run(['lua5.4', name, ...args], 'lua');
    case '.pl': return run(['perl', name, ...args], 'perl');
    case '.ps1': return { problem: missingTool('pwsh'), entry: name };
    case '.go': return { problem: missingTool('go'), kind: 'go', entry: name };
    case '.vbs': case '.vbe': case '.wsf': case '.msi': case '.lnk':
      return { problem: `${name} は動かせない種類のファイルです。`, entry: name };
    default: break;
  }
  if (isElf(full)) return run([`./${name}`, ...args], 'binary', { chmod: full });
  const sb = shebang(full);
  if (sb) {
    // #!/usr/bin/env python3 など (Windows の改行でも動くように、自分で読む)
    const [interp, ...rest] = sb[0].endsWith('/env') ? sb.slice(1) : sb;
    const cmd = path.basename(interp || 'sh');
    return run([ALIAS[cmd] || cmd, ...rest, name, ...args], COMMAND_KIND[cmd] || 'shell');
  }
  return { problem: `${name} の動かし方がわかりません。起動コマンドを「python3 ${name}」のように書いてください。`, entry: name };
}

// ----- 起動方法を自動で見つける -----
const SKIP_EXE = /^(unins\d*|uninstall|setup|install(er)?|vc_?redist.*|python\w*|pythonw|node|java\w*|dotnet|w9xpopen|ffmpeg|ffprobe|ffplay|yt-dlp|youtube-dl|createdump|crashpad_handler|chromedriver)\.exe$/i;
const PY_NAMES = ['main.py', 'bot.py', 'app.py', 'run.py', 'start.py', 'index.py', 'client.py', '__main__.py'];
const JS_NAMES = ['index.js', 'bot.js', 'main.js', 'app.js', 'start.js', 'server.js', 'index.mjs', 'bot.mjs', 'main.mjs', 'index.cjs'];
const TS_NAMES = ['index.ts', 'bot.ts', 'main.ts', 'app.ts'];
const LAUNCHERS = ['start.bat', 'run.bat', 'start.cmd', 'run.cmd', 'bot.bat', 'launch.bat', 'main.bat', 'start.sh', 'run.sh', 'bot.sh', 'launch.sh'];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

function listTop(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function detect(dir) {
  const out = [];
  const add = (command, why) => {
    if (!command || out.some((c) => c.command === command)) return;
    const r = resolve(dir, command);
    out.push({ command, kind: r.kind || null, why, problem: r.problem || null });
  };
  const top = listTop(dir);
  const files = top.filter((e) => e.isFile()).map((e) => e.name);
  const has = (n) => files.find((f) => f.toLowerCase() === n.toLowerCase());

  // 1. 起動方法が書いてあるファイル
  const procfile = has('Procfile');
  if (procfile) {
    for (const line of (fs.readFileSync(path.join(dir, procfile), 'utf8')).split(/\r?\n/)) {
      const m = line.match(/^(worker|bot|web|main)\s*:\s*(.+)$/);
      if (m) add(m[2].trim(), `Procfile の ${m[1]}`);
    }
  }
  const replit = has('.replit');
  if (replit) {
    const text = fs.readFileSync(path.join(dir, replit), 'utf8');
    const m = text.match(/^\s*run\s*=\s*(\[[^\]]*\]|"(?:[^"\\]|\\.)*"|'[^']*')/m);
    if (m) {
      let v = null;
      try { v = JSON.parse(m[1].replace(/'/g, '"')); } catch { /* 読めない */ }
      if (Array.isArray(v)) v = v.join(' ');
      if (typeof v === 'string' && v.trim()) add(v.trim(), '.replit の run');
    }
    const e = text.match(/^\s*entrypoint\s*=\s*"([^"]+)"/m);
    if (e && findFile(dir, e[1])) add(e[1], '.replit の entrypoint');
  }
  const pkg = has('package.json') ? readJson(path.join(dir, has('package.json'))) : null;
  const bunProject = has('bun.lockb') || has('bun.lock') || has('bunfig.toml');
  if (pkg) {
    if (pkg.scripts && pkg.scripts.start) add(bunProject ? 'bun run start' : 'npm start', 'package.json の start');
    if (typeof pkg.main === 'string' && findFile(dir, pkg.main)) add(`${bunProject ? 'bun' : 'node'} ${rel(dir, findFile(dir, pkg.main))}`, 'package.json の main');
  }
  // 2. 起動用のスクリプト (start.bat・run.sh など)。作った人が用意した起動方法なので、main.py などより先
  for (const n of LAUNCHERS) if (has(n)) add(has(n), n.endsWith('.sh') ? 'シェルスクリプト' : 'Windows のバッチ');
  // 3. よくある名前のファイル
  for (const n of PY_NAMES) if (has(n)) add(`python3 ${has(n)}`, 'Python のファイル');
  for (const n of JS_NAMES) if (has(n)) add(`node ${has(n)}`, 'JavaScript のファイル');
  for (const n of TS_NAMES) if (has(n)) add(`${bunProject ? 'bun' : 'tsx'} ${has(n)}`, 'TypeScript のファイル');
  for (const sub of ['src', 'bot', 'app']) {
    const d = top.find((e) => e.isDirectory() && e.name.toLowerCase() === sub);
    if (!d) continue;
    for (const n of [...PY_NAMES, ...JS_NAMES, ...TS_NAMES]) {
      const f = findFile(dir, `${d.name}/${n}`);
      if (f) add(n.endsWith('.py') ? `python3 ${rel(dir, f)}` : n.endsWith('.ts') ? `tsx ${rel(dir, f)}` : `node ${rel(dir, f)}`, `${d.name} フォルダーの中`);
    }
  }
  // 4. ほかの .bat
  for (const f of files) if (/\.(bat|cmd)$/i.test(f) && !/^(install|setup|uninstall|update)/i.test(f)) add(f, 'Windows のバッチ');
  // 4. .exe / .jar / .dll / 実行ファイル
  const exes = files.filter((f) => /\.exe$/i.test(f) && !SKIP_EXE.test(f));
  for (const f of exes) add(f, describe(path.join(dir, f))?.text || '実行ファイル');
  const jars = files.filter((f) => /\.jar$/i.test(f));
  for (const sub of ['build/libs', 'target', 'out', 'bin']) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, sub)); } catch { continue; }
    for (const n of names) if (/\.jar$/i.test(n) && !/-(sources|javadoc|plain)\.jar$|^original-/i.test(n)) jars.push(`${sub}/${n}`);
  }
  // fat jar (-all / -with-dependencies / -shaded) を先に
  jars.sort((a, b) => (/-(all|with-dependencies|shaded|fat)\.jar$/i.test(b) - /-(all|with-dependencies|shaded|fat)\.jar$/i.test(a)) || fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size);
  for (const f of jars) add(f, 'Java のプログラム');
  for (const f of files) {
    if (/\.dll$/i.test(f) && has(f.replace(/\.dll$/i, '.runtimeconfig.json'))) add(f, '.NET のプログラム');
  }
  for (const f of files) {
    if (!path.extname(f) && f !== 'Procfile' && f !== 'Gemfile' && f !== 'Makefile' && f !== 'Dockerfile' && isElf(path.join(dir, f))) add(`./${f}`, 'Linux の実行ファイル');
  }
  // 5. ほかの言語
  for (const [ext, names] of [['.rb', ['bot.rb', 'main.rb', 'app.rb', 'run.rb']], ['.php', ['bot.php', 'index.php', 'main.php', 'run.php']], ['.lua', ['main.lua', 'bot.lua', 'init.lua']], ['.pl', ['bot.pl', 'main.pl']]]) {
    for (const n of names) if (has(n)) add(has(n), `${KINDS[EXT_KIND[ext]].label} のファイル`);
  }
  // 6. 1 つしかないなら、それ
  for (const ext of ['.py', '.js', '.ts', '.rb', '.php', '.lua', '.sh']) {
    const list = files.filter((f) => path.extname(f).toLowerCase() === ext);
    if (list.length === 1) add(ext === '.py' ? `python3 ${list[0]}` : ext === '.js' ? `node ${list[0]}` : ext === '.ts' ? `tsx ${list[0]}` : list[0], 'ファイルが 1 つだけ');
  }
  const ok = out.filter((c) => !c.problem);
  return { command: (ok[0] || out[0] || {}).command || null, candidates: out.slice(0, 12), build: buildCommand(dir, pkg) };
}

// 起動の前にビルドが要るか (TypeScript で書いて dist/ に出すものなど)
function buildCommand(dir, pkg) {
  if (!pkg || !pkg.scripts || !pkg.scripts.build) return null;
  const start = String(pkg.scripts.start || '');
  if (/\b(build|tsc|tsup|esbuild|webpack|rollup|vite build)\b/.test(start)) return null; // start の中でビルドしている
  const main = String(pkg.main || '');
  const outDir = /^(\.\/)?(dist|build|out|lib)\//.test(main) || /\b(dist|build|out|lib)\//.test(start);
  const ts = fs.existsSync(path.join(dir, 'tsconfig.json'));
  return outDir || ts ? 'npm run build' : null;
}

// 起動のときに入れるライブラリの種類
function installKinds(kind) {
  if (kind === 'python') return ['python'];
  if (kind === 'node' || kind === 'ts') return ['node'];
  if (kind === 'bun') return ['bun'];
  if (kind === 'ruby') return ['ruby'];
  if (kind === 'php') return ['php'];
  if (kind === 'batch' || kind === 'shell' || kind === 'binary') return ['python', 'node', 'ruby', 'php'];
  return [];
}

module.exports = { KINDS, CMD_JS, resolve, fileLaunch, detect, describe, peInfo, isElf, splitCommand, needsShell, findFile, installKinds, buildCommand, kindOfPath };

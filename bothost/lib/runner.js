'use strict';
// bot のプロセスを管理します: ライブラリのインストール → 起動 → ログ → 落ちたら自動で再起動 → 停止。
// mode "process": このサーバーと同じマシンでそのまま動かします (手軽。ただし隔離はありません)。
// mode "docker":  bot ごとに Docker コンテナで動かします (メモリ・CPU の上限と隔離あり。公開するならこちら)。
const { spawn, spawnSync } = require('child_process');
const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RUNTIMES = {
  python: { defaultCommand: 'python3 main.py', image: 'python:3.12-slim' },
  node: { defaultCommand: 'node index.js', image: 'node:22-slim' },
};

const PASS_ENV = /^(https?_proxy|no_proxy|all_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|PIP_[A-Z_]+|UV_[A-Z_]+|npm_config_[a-z_]+)$/i;

// bot ごとのユーザー番号 (サーバーが root のとき、bot を別のユーザーで動かす)
function botUid(id) { return 20000 + (parseInt(String(id).slice(0, 6), 16) % 30000 || 0); }

// フォルダーの中を、まとめて持ち主を変える (もう合っているものは飛ばす)
function chownTree(root, uid, gid) {
  const walk = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch { return; }
    if (st.uid !== uid || st.gid !== gid) { try { fs.lchownSync(p, uid, gid); } catch { /* 消えた */ } }
    if (st.isDirectory()) {
      let names;
      try { names = fs.readdirSync(p); } catch { return; }
      for (const n of names) walk(path.join(p, n));
    }
  };
  walk(root);
}

const LOG_FILE_MAX = 1024 * 1024; // これを超えたら .1 に回す
const HISTORY_MAX = 120; // メモリ・CPU の記録 (グラフ用)
const ANSI_KEEP = /\x1b\[[0-9;]*m/g; // 色は残す (画面で色を付ける)
// eslint-disable-next-line no-control-regex
const ANSI_OTHER = /\x1b(?:\[[0-9;?]*[A-Za-ln-z]|\][^\x07]*\x07|[()][A-Z0-9]|[=>78])/g;

// "python3 main.py --name 'a b'" → ["python3", "main.py", "--name", "a b"] (シェルは通しません)
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

function fileHash(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

class Runner extends EventEmitter {
  constructor(opts) {
    super();
    this.botsDir = opts.botsDir;
    this.logsDir = opts.logsDir || null;
    this.pidsFile = opts.pidsFile || null;
    this.mode = opts.mode || 'process';
    this.maxLogLines = opts.maxLogLines || 1000;
    this.maxLinesPerSec = opts.maxLinesPerSec || 200;
    this.python = opts.python || 'python3';
    // サーバーが root なら、bot は bot ごとの別のユーザーで動かす
    // (サーバーの秘密・データ・ほかの bot のファイルを読めないように)
    this.isolate = opts.isolate ?? (typeof process.getuid === 'function' && process.getuid() === 0);
    this.uv = null; // uv (速い pip) が使えるか。最初のインストールのときに調べる
    this.stopTimeoutMs = opts.stopTimeoutMs || 5000;
    this.crashLimit = opts.crashLimit || 5;
    this.initialBackoff = opts.initialBackoffMs || 2000;
    this.states = new Map();
    this.pids = {};
    if (this.logsDir) fs.mkdirSync(this.logsDir, { recursive: true });
    this.cleanupOrphans();
    this.statsTimer = setInterval(() => this.sampleStats(), opts.statsIntervalMs || 3000);
    this.statsTimer.unref();
    this.flushTimer = setInterval(() => this.flushLogs(), 1000);
    this.flushTimer.unref();
  }

  dir(id) { return path.join(this.botsDir, id); }
  logFile(id) { return this.logsDir && path.join(this.logsDir, `${id}.log`); }

  state(id) {
    let s = this.states.get(id);
    if (!s) {
      s = {
        status: 'stopped', // stopped | installing | running | restarting | crashed
        child: null,
        logs: this.loadLogs(id),
        pending: [],
        startedAt: null,
        exitCode: null,
        lastExit: null,
        stopping: false,
        restartTimer: null,
        restartAt: null,
        crashTimes: [],
        backoff: this.initialBackoff,
        restarts: 0,
        stats: null,
        cpuPrev: null,
        history: [],
        runToken: 0,
        rate: { sec: 0, count: 0, dropped: 0 },
        killReason: null,
      };
      this.states.set(id, s);
    }
    return s;
  }

  info(id) {
    const s = this.state(id);
    return {
      status: s.status,
      startedAt: s.startedAt,
      exitCode: s.exitCode,
      lastExit: s.lastExit,
      restarts: s.restarts,
      restartAt: s.restartAt,
      stats: s.stats,
    };
  }

  history(id) { return this.state(id).history; }
  logs(id) { return this.state(id).logs; }

  // ----- ログ -----
  loadLogs(id) {
    const file = this.logFile(id);
    if (!file) return [];
    const text = [readText(file + '.1'), readText(file)].filter(Boolean).join('');
    if (!text) return [];
    const out = [];
    for (const line of text.split('\n').slice(-this.maxLogLines - 1)) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* 途中で切れた行 */ }
    }
    return out.slice(-this.maxLogLines);
  }

  push(id, s, entry) {
    s.logs.push(entry);
    if (s.logs.length > this.maxLogLines * 1.2) s.logs.splice(0, s.logs.length - this.maxLogLines);
    if (this.logsDir) s.pending.push(JSON.stringify(entry));
    this.emit('log', id, entry);
  }

  log(id, stream, text) {
    const s = this.state(id);
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const sec = Math.floor(Date.now() / 1000);
    for (let raw of lines) {
      // \r で上書きする進み具合の表示は、最後の状態だけ残す
      if (raw.includes('\r')) raw = raw.slice(raw.lastIndexOf('\r', raw.length - 2) + 1).replace(/\r$/, '');
      if (stream !== 'sys') {
        if (s.rate.sec !== sec) {
          if (s.rate.dropped) this.push(id, s, { t: Date.now(), s: 'sys', l: `(出力が多すぎるため ${s.rate.dropped} 行を省略しました)` });
          s.rate = { sec, count: 0, dropped: 0 };
        }
        if (++s.rate.count > this.maxLinesPerSec) { s.rate.dropped++; continue; }
      }
      let l = raw.replace(ANSI_OTHER, '');
      if (l.length > 4000) l = l.slice(0, 4000) + '…';
      this.push(id, s, { t: Date.now(), s: stream, l });
    }
  }

  sys(id, text) { this.flushPartial(id); this.log(id, 'sys', text); }

  // プロセスの出力は好きな所で区切られて届くので、改行が来るまで行をためる
  // (改行のない出力 (input("名前: ") など) は、少し待ってから出す)
  chunk(id, stream, data) {
    const s = this.state(id);
    if (!s.partial) s.partial = { out: '', err: '', timer: null };
    const text = s.partial[stream] + data;
    const cut = text.lastIndexOf('\n');
    if (cut >= 0) {
      s.partial[stream] = text.slice(cut + 1);
      this.log(id, stream, text.slice(0, cut + 1));
    } else {
      s.partial[stream] = text;
    }
    if (s.partial[stream].length > 8192) { this.log(id, stream, s.partial[stream]); s.partial[stream] = ''; }
    clearTimeout(s.partial.timer);
    if (s.partial.out || s.partial.err) {
      s.partial.timer = setTimeout(() => this.flushPartial(id), 150);
      s.partial.timer.unref();
    }
  }

  flushPartial(id) {
    const s = this.states.get(id);
    if (!s || !s.partial) return;
    clearTimeout(s.partial.timer);
    for (const stream of ['out', 'err']) {
      if (s.partial[stream]) { const t = s.partial[stream]; s.partial[stream] = ''; this.log(id, stream, t); }
    }
  }

  flushLogs() {
    for (const [id, s] of this.states) {
      if (s.rate.dropped && s.rate.sec !== Math.floor(Date.now() / 1000)) {
        this.push(id, s, { t: Date.now(), s: 'sys', l: `(出力が多すぎるため ${s.rate.dropped} 行を省略しました)` });
        s.rate.dropped = 0;
      }
      if (!s.pending.length) continue;
      const file = this.logFile(id);
      const data = s.pending.join('\n') + '\n';
      s.pending = [];
      try {
        fs.appendFileSync(file, data);
        if (fs.statSync(file).size > LOG_FILE_MAX) fs.renameSync(file, file + '.1');
      } catch (e) {
        if (e.code !== 'ENOENT') console.error('ログを保存できませんでした:', e.message);
      }
    }
  }

  clearLogs(id) {
    const s = this.state(id);
    s.logs = [];
    s.pending = [];
    const file = this.logFile(id);
    if (file) for (const f of [file, file + '.1']) fs.rmSync(f, { force: true });
  }

  forget(id) {
    const s = this.states.get(id);
    if (s) clearTimeout(s.restartTimer);
    this.clearLogs(id);
    this.states.delete(id);
  }

  setStatus(id, status) {
    const s = this.state(id);
    if (s.status === status) return;
    s.status = status;
    if (status !== 'running') { s.stats = null; s.cpuPrev = null; }
    if (status !== 'restarting') s.restartAt = null;
    this.emit('status', id, this.info(id));
  }

  isActive(id) {
    const st = this.state(id).status;
    return st === 'running' || st === 'installing' || st === 'restarting';
  }

  // ----- 取り残されたプロセスの後片付け (サーバーが突然落ちたとき) -----
  savePids() {
    if (!this.pidsFile) return;
    try { fs.writeFileSync(this.pidsFile, JSON.stringify(this.pids), { mode: 0o600 }); } catch { /* 次の機会に */ }
  }

  cleanupOrphans() {
    if (this.mode === 'docker') {
      const r = spawnSync('docker', ['ps', '-aq', '--filter', 'name=^bothost-'], { encoding: 'utf8' });
      const ids = (r.stdout || '').split('\n').filter(Boolean);
      if (ids.length) spawnSync('docker', ['rm', '-f', ...ids], { stdio: 'ignore' });
      return;
    }
    if (!this.pidsFile || process.platform !== 'linux') return;
    let old;
    try { old = JSON.parse(fs.readFileSync(this.pidsFile, 'utf8')); } catch { return; }
    const realBots = fs.realpathSync(this.botsDir);
    for (const [id, pid] of Object.entries(old)) {
      // 本当に bot のフォルダーで動いているプロセスだけを止める (別のプロセスが同じ番号を使っていることがあるため)
      try {
        const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
        if (cwd === path.join(realBots, id) || cwd.startsWith(path.join(realBots, id) + path.sep)) {
          process.kill(-pid, 'SIGKILL');
        }
      } catch { /* もういない */ }
    }
    this.pids = {};
    this.savePids();
  }

  // ----- 起動 -----
  async start(bot, { manual = true } = {}) {
    const s = this.state(bot.id);
    if (manual) { s.crashTimes = []; s.backoff = this.initialBackoff; s.restarts = 0; }
    if (s.child || s.status === 'installing') return;
    clearTimeout(s.restartTimer);
    s.restartTimer = null;
    s.stopping = false;
    s.killReason = null;
    const token = ++s.runToken;
    const dir = this.dir(bot.id);
    fs.mkdirSync(dir, { recursive: true });
    this.prepareDir(bot.id);

    const rt = RUNTIMES[bot.runtime] || RUNTIMES.python;
    const argv = splitCommand(bot.startCommand || rt.defaultCommand);
    if (!argv.length) {
      this.sys(bot.id, '起動コマンドが空です。設定タブで指定してください。');
      this.setStatus(bot.id, 'crashed');
      return;
    }
    const entry = argv.find((a, i) => i > 0 && /\.(py|js|mjs|cjs)$/.test(a));
    if (entry && !fs.existsSync(path.join(dir, entry))) {
      this.sys(bot.id, `${entry} がありません。ファイルタブで作るか、設定タブの起動コマンドを直してください。`);
      this.setStatus(bot.id, 'crashed');
      return;
    }

    this.setStatus(bot.id, 'installing');
    try {
      const ok = await this.install(bot, token);
      if (!ok) return; // 途中で止められた or 失敗 (メッセージは install の中で出します)
    } catch (e) {
      this.sys(bot.id, `インストールに失敗しました: ${e.message}`);
      this.setStatus(bot.id, 'crashed');
      return;
    }
    if (s.stopping || token !== s.runToken) return;

    this.sys(bot.id, `起動します: ${argv.join(' ')}`);
    const child = this.spawnIn(bot, argv, `bothost-${bot.id}`);
    s.child = child;
    s.startedAt = Date.now();
    s.exitCode = null;
    if (child.pid) { this.pids[bot.id] = child.pid; this.savePids(); }
    this.setStatus(bot.id, 'running');

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => this.chunk(bot.id, 'out', d));
    child.stderr.on('data', (d) => this.chunk(bot.id, 'err', d));
    child.stdin.on('error', () => { /* 終わった後に書いた */ });
    child.on('error', (e) => {
      this.sys(bot.id, e.code === 'ENOENT'
        ? `「${argv[0]}」が見つかりません。起動コマンドを確かめてください。`
        : `起動できませんでした: ${e.message}`);
    });
    child.on('close', (code, signal) => this.onExit(bot, child, code, signal));
  }

  // requirements.txt / package.json があれば、変わったときだけライブラリを入れ直します
  async install(bot, token) {
    const dir = this.dir(bot.id);
    const s = this.state(bot.id);
    const steps = [];
    const unchanged = (marker, hash) => readText(marker) === hash;
    if (bot.runtime === 'python' && fs.existsSync(path.join(dir, 'requirements.txt'))) {
      const hash = fileHash(path.join(dir, 'requirements.txt'));
      const marker = path.join(dir, '.deps', '.requirements-hash');
      const empty = !fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8').replace(/#.*$/gm, '').trim();
      if (!empty && !unchanged(marker, hash)) {
        const py = this.mode === 'docker' ? 'python3' : this.python;
        const pip = [py, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade',
          '--progress-bar', 'off', '--target', '.deps', '-r', 'requirements.txt'];
        const useUv = this.mode !== 'docker' && this.hasUv(bot.id);
        steps.push({
          label: `requirements.txt のライブラリを入れています${useUv ? ' (uv)' : ''}…`,
          argv: useUv ? ['uv', 'pip', 'install', '--quiet', '--target', '.deps', '--python', py, '--link-mode', 'copy', '-r', 'requirements.txt'] : pip,
          fallback: useUv ? { label: 'uv で入れられなかったので、pip で入れ直します…', argv: pip } : null,
          before: () => fs.rmSync(path.join(dir, '.deps'), { recursive: true, force: true }),
          done: () => { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, hash); },
        });
      }
    }
    if (bot.runtime === 'node' && fs.existsSync(path.join(dir, 'package.json'))) {
      const lock = fs.existsSync(path.join(dir, 'package-lock.json'));
      const hash = fileHash(path.join(dir, 'package.json')) + (lock ? fileHash(path.join(dir, 'package-lock.json')) : '');
      const marker = path.join(dir, 'node_modules', '.package-hash');
      if (!unchanged(marker, hash)) {
        steps.push({
          label: 'package.json のライブラリを入れています…',
          // package-lock.json があれば npm ci (速くて、いつも同じものが入る)
          argv: ['npm', lock ? 'ci' : 'install', '--omit=dev', '--no-audit', '--no-fund', '--prefer-offline', '--loglevel=error'],
          done: () => { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, hash); },
        });
      }
    }
    for (const step of steps) {
      if (s.stopping || token !== s.runToken) return false;
      this.sys(bot.id, step.label);
      if (step.before) step.before();
      const started = Date.now();
      const runStep = (argv) => new Promise((resolve) => {
        const child = this.spawnIn(bot, argv, `bothost-${bot.id}-install`);
        s.child = child;
        if (child.pid) { this.pids[bot.id] = child.pid; this.savePids(); }
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (d) => this.chunk(bot.id, 'out', d));
        child.stderr.on('data', (d) => this.chunk(bot.id, 'err', d));
        child.on('error', (e) => { this.sys(bot.id, e.message); });
        child.on('close', (c) => resolve(c));
      });
      let code = await runStep(step.argv);
      if (code !== 0 && step.fallback && !s.stopping && token === s.runToken) {
        this.sys(bot.id, step.fallback.label);
        if (step.before) step.before();
        code = await runStep(step.fallback.argv);
      }
      s.child = null;
      if (s.stopping || token !== s.runToken) { this.sys(bot.id, '停止しました。'); this.setStatus(bot.id, 'stopped'); return false; }
      if (code !== 0) {
        this.sys(bot.id, `ライブラリのインストールに失敗しました (終了コード ${code})。ライブラリの名前やバージョンを確かめてください。`);
        this.setStatus(bot.id, 'crashed');
        this.emit('crash', bot.id, { reason: 'install', gaveUp: true, code, tail: this.tail(bot.id) });
        return false;
      }
      step.done();
      this.sys(bot.id, `インストールが終わりました (${Math.round((Date.now() - started) / 100) / 10} 秒)。`);
    }
    return true;
  }

  // uv が bot のユーザーから使えるか (一度だけ調べる)
  hasUv(id) {
    if (this.uv === null) {
      const opts = { stdio: 'ignore', timeout: 10000, env: { PATH: process.env.PATH } };
      if (this.isolate) { opts.uid = botUid(id); opts.gid = botUid(id); }
      try { this.uv = spawnSync('uv', ['--version'], opts).status === 0; } catch { this.uv = false; }
    }
    return this.uv;
  }

  // bot のフォルダーを bot のユーザーのものにする (起動の前・ファイルを書いた後)
  prepareDir(id) {
    if (!this.isolate) return;
    const uid = botUid(id);
    try { fs.chmodSync(this.botsDir, 0o711); } catch { /* なくてもよい */ }
    const dir = this.dir(id);
    chownTree(dir, uid, uid);
    try { fs.chmodSync(dir, 0o700); } catch { /* なくてもよい */ }
  }

  // 1 つのファイル (とその上のフォルダー) を bot のユーザーのものにする
  adopt(id, full) {
    if (!this.isolate) return;
    const uid = botUid(id);
    const root = this.dir(id);
    let p = full;
    while (p.startsWith(root + path.sep)) {
      try { fs.lchownSync(p, uid, uid); } catch { /* 消えた */ }
      p = path.dirname(p);
    }
    try { fs.lchownSync(root, uid, uid); } catch { /* なくてもよい */ }
  }

  // 入れたライブラリを消して、次の起動で入れ直す
  resetDeps(id) {
    for (const d of ['.deps', 'node_modules']) fs.rmSync(path.join(this.dir(id), d), { recursive: true, force: true });
  }

  envFor(bot, inDocker) {
    const dir = inDocker ? '/app' : this.dir(bot.id);
    const env = {
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: path.posix.join(dir, '.deps'),
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
      NODE_ENV: 'production',
      FORCE_COLOR: '1',
      BOT_ID: bot.id,
      BOT_NAME: bot.name,
    };
    for (const [k, v] of Object.entries(bot.env || {})) env[k] = String(v);
    return env;
  }

  spawnIn(bot, argv, containerName) {
    const dir = this.dir(bot.id);
    if (this.mode === 'docker') {
      const rt = RUNTIMES[bot.runtime] || RUNTIMES.python;
      const args = [
        'run', '--rm', '-i', '--init', '--name', containerName,
        '--memory', `${bot.memoryLimitMB || 256}m`,
        '--cpus', String(bot.cpuLimit || 0.5),
        '--pids-limit', '256',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        // root にはしない: bot ごとのユーザー (サーバーが root のとき) か、サーバーと同じユーザー
        ...(this.isolate ? ['--user', `${botUid(bot.id)}:${botUid(bot.id)}`]
          : process.getuid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []),
        // システムのファイルは読み取り専用。書けるのは bot のフォルダー (/app) と /tmp だけ
        '--read-only', '--tmpfs', '/tmp:rw,size=64m',
        '-v', `${dir}:/app`, '-w', '/app',
      ];
      const env = { ...this.envFor(bot, true), HOME: '/app', PIP_NO_CACHE_DIR: '1' };
      for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
      args.push(rt.image, ...argv);
      return spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    }
    const env = {
      PATH: process.env.PATH,
      HOME: dir,
      // ライブラリのキャッシュは bot のフォルダーの中に (ほかの bot と混ざらないように)
      XDG_CACHE_HOME: path.join(dir, '.cache'),
      UV_CACHE_DIR: path.join(dir, '.cache', 'uv'),
      UV_NO_PROGRESS: '1',
      npm_config_cache: path.join(dir, '.npm'),
      LANG: process.env.LANG || 'C.UTF-8',
      ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
      ...this.envFor(bot, false),
    };
    // プロキシ・証明書・pip / npm の設定は、サーバーと同じものを使います (社内ネットワークなどで必要)
    for (const [k, v] of Object.entries(process.env)) {
      if (PASS_ENV.test(k) && !(k in env)) env[k] = v;
    }
    // detached: プロセスグループごと止められるように (npm start などが子プロセスを作っても残らない)
    const ids = this.isolate ? { uid: botUid(bot.id), gid: botUid(bot.id) } : {};
    return spawn(argv[0], argv.slice(1), { cwd: dir, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'], ...ids });
  }

  tail(id, n = 15) {
    return this.state(id).logs.slice(-n).map((e) => e.l.replace(ANSI_KEEP, '')).join('\n');
  }

  onExit(bot, child, code, signal) {
    const s = this.state(bot.id);
    if (s.child !== child) return;
    this.flushPartial(bot.id);
    s.child = null;
    delete this.pids[bot.id];
    this.savePids();
    s.exitCode = code;
    s.lastExit = { code, signal, at: Date.now() };
    const ranMs = Date.now() - (s.startedAt || Date.now());
    if (s.stopping) {
      this.sys(bot.id, '停止しました。');
      this.setStatus(bot.id, 'stopped');
      this.emit('exit', bot.id, { code, signal, manual: true });
      return;
    }
    // docker モードで 137 = 強制終了 (ほとんどはメモリの上限 --memory を超えたとき)
    const reason = s.killReason || (this.mode === 'docker' && code === 137 ? 'memory' : null);
    s.killReason = null;
    if (reason === 'memory') this.sys(bot.id, 'メモリの上限を超えたので止めました。');
    else this.sys(bot.id, signal ? `終了しました (シグナル ${signal})` : `終了しました (終了コード ${code})`);
    this.emit('exit', bot.id, { code, signal, manual: false });
    const latest = (this.getBot && this.getBot(bot.id)) || bot;

    if (!latest.autoRestart) {
      this.setStatus(bot.id, code === 0 && !reason ? 'stopped' : 'crashed');
      if (code !== 0 || reason) this.emit('crash', bot.id, { reason: reason || 'exit', gaveUp: true, code, signal, tail: this.tail(bot.id) });
      return;
    }
    // 1 分以上動いていたら、待ち時間をリセット
    if (ranMs > 60e3) { s.backoff = this.initialBackoff; s.crashTimes = []; }
    const now = Date.now();
    s.crashTimes = s.crashTimes.filter((t) => now - t < 5 * 60e3);
    s.crashTimes.push(now);
    if (s.crashTimes.length >= this.crashLimit) {
      this.sys(bot.id, `5 分で ${this.crashLimit} 回落ちたので、自動での再起動をやめました。ログを見て直してから起動してください。`);
      this.setStatus(bot.id, 'crashed');
      this.emit('crash', bot.id, { reason: reason || 'exit', gaveUp: true, code, signal, tail: this.tail(bot.id) });
      return;
    }
    const wait = s.backoff;
    s.backoff = Math.min(s.backoff * 2, 60e3);
    s.restarts++;
    this.sys(bot.id, `${Math.round(wait / 1000)} 秒後に自動で再起動します…`);
    s.restartAt = Date.now() + wait;
    this.setStatus(bot.id, 'restarting');
    this.emit('crash', bot.id, { reason: reason || 'exit', gaveUp: false, code, signal, tail: this.tail(bot.id) });
    s.restartTimer = setTimeout(() => {
      s.restartTimer = null;
      const b = (this.getBot && this.getBot(bot.id)) || bot;
      if (b) this.start(b, { manual: false });
    }, wait);
  }

  // ----- 停止 -----
  stop(id) {
    const s = this.state(id);
    s.stopping = true;
    s.runToken++;
    clearTimeout(s.restartTimer);
    s.restartTimer = null;
    const child = s.child;
    if (!child) {
      if (s.status !== 'stopped') { this.sys(id, '停止しました。'); this.setStatus(id, 'stopped'); }
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      child.once('close', () => resolve());
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      this.kill(id, child, 'SIGTERM');
      const t = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          this.sys(id, '止まらないので強制終了します。');
          this.kill(id, child, 'SIGKILL');
        }
      }, this.stopTimeoutMs);
      t.unref();
    });
  }

  kill(id, child, signal) {
    if (this.mode === 'docker') {
      if (signal === 'SIGKILL') {
        spawn('docker', ['rm', '-f', `bothost-${id}`, `bothost-${id}-install`], { stdio: 'ignore' });
      }
      try { child.kill(signal); } catch { /* もう終わっている */ }
      return;
    }
    try { process.kill(-child.pid, signal); } catch {
      try { child.kill(signal); } catch { /* もう終わっている */ }
    }
  }

  async restart(bot) {
    await this.stop(bot.id);
    await this.start(bot);
  }

  // コンソールから標準入力へ送る
  write(id, text) {
    const s = this.state(id);
    if (!s.child || s.status !== 'running' || !s.child.stdin.writable) return false;
    s.child.stdin.write(text.endsWith('\n') ? text : text + '\n');
    this.log(id, 'in', text.replace(/\n$/, ''));
    return true;
  }

  async stopAll() {
    await Promise.all([...this.states.keys()].map((id) => this.stop(id)));
    this.flushLogs();
  }

  close() {
    clearInterval(this.statsTimer);
    clearInterval(this.flushTimer);
    this.flushLogs();
  }

  // ----- 使用量 (process モードは /proc から。プロセスグループ全体の合計) -----
  // docker モード: docker stats で、動いているコンテナの CPU・メモリを取る
  sampleDockerStats() {
    if (this.dockerStatsBusy) return;
    const running = [...this.states.entries()].filter(([, s]) => s.child && s.status === 'running');
    if (!running.length) return;
    this.dockerStatsBusy = true;
    const names = running.map(([id]) => `bothost-${id}`);
    const child = spawn('docker', ['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}', ...names], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { this.dockerStatsBusy = false; });
    child.on('close', () => {
      this.dockerStatsBusy = false;
      const now = Date.now();
      for (const line of out.split('\n')) {
        const [name, cpu, mem] = line.split('\t');
        if (!name || !mem) continue;
        const id = name.replace(/^bothost-/, '');
        const s = this.states.get(id);
        if (!s || s.status !== 'running') continue;
        const m = mem.split('/')[0].trim().match(/^([\d.]+)\s*([KMG]i?B|B)$/i);
        if (!m) continue;
        const unit = { b: 1 / 1048576, kib: 1 / 1024, kb: 1 / 1024, mib: 1, mb: 1, gib: 1024, gb: 1024 }[m[2].toLowerCase()] ?? 1;
        s.stats = { memoryMB: Math.round(parseFloat(m[1]) * unit * 10) / 10, cpuPercent: Math.round(parseFloat(cpu) * 10) / 10 || 0 };
        s.history.push([now, s.stats.memoryMB, s.stats.cpuPercent]);
        if (s.history.length > HISTORY_MAX) s.history.shift();
        this.emit('stats', id, s.stats);
      }
    });
  }

  sampleStats() {
    if (this.mode === 'docker') { this.sampleDockerStats(); return; }
    if (process.platform !== 'linux') return;
    const running = [...this.states.entries()].filter(([, s]) => s.child && s.status === 'running');
    if (!running.length) return;
    const groups = new Map();
    for (const [, s] of running) groups.set(s.child.pid, { cpu: 0, rss: 0 });
    let entries;
    try { entries = fs.readdirSync('/proc'); } catch { return; }
    for (const name of entries) {
      const c = name.charCodeAt(0);
      if (c < 48 || c > 57) continue;
      let stat;
      try { stat = fs.readFileSync(`/proc/${name}/stat`, 'latin1'); } catch { continue; }
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      // f[0]=state f[2]=pgrp f[11]=utime f[12]=stime f[21]=rss(pages)
      const g = groups.get(Number(f[2]));
      if (!g) continue;
      g.cpu += Number(f[11]) + Number(f[12]);
      g.rss += Number(f[21]) * 4096;
    }
    const now = Date.now();
    for (const [id, s] of running) {
      const g = groups.get(s.child.pid);
      let cpuPercent = null;
      if (s.cpuPrev) {
        const ticks = g.cpu - s.cpuPrev.ticks;
        const secs = (now - s.cpuPrev.at) / 1000;
        cpuPercent = Math.max(0, Math.round((ticks / 100 / secs) * 1000) / 10);
      }
      s.cpuPrev = { ticks: g.cpu, at: now };
      s.stats = { memoryMB: Math.round(g.rss / 1048576 * 10) / 10, cpuPercent };
      s.history.push([now, s.stats.memoryMB, cpuPercent ?? 0]);
      if (s.history.length > HISTORY_MAX) s.history.shift();
      this.emit('stats', id, s.stats);
      const bot = this.getBot && this.getBot(id);
      if (bot && bot.memoryLimitMB && s.stats.memoryMB > bot.memoryLimitMB && !s.killReason) {
        this.sys(id, `メモリが上限 (${bot.memoryLimitMB} MB) を超えました (${s.stats.memoryMB} MB)。`);
        s.killReason = 'memory';
        this.kill(id, s.child, 'SIGKILL');
      }
    }
  }
}

module.exports = { Runner, RUNTIMES, splitCommand, botUid };

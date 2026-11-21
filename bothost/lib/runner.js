'use strict';
// bot のプロセスを管理します: ライブラリのインストール → 起動 → ログ → 落ちたら自動で再起動 → 停止。
// mode "process": このサーバーと同じマシンでそのまま動かします (手軽。ただし隔離はありません)。
// mode "docker":  bot ごとに Docker コンテナで動かします (メモリ・CPU の上限と隔離あり。公開するならこちら)。
const { spawn } = require('child_process');
const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RUNTIMES = {
  python: { defaultCommand: 'python3 main.py', image: 'python:3.12-slim' },
  node: { defaultCommand: 'node index.js', image: 'node:22-slim' },
};

const PASS_ENV = /^(https?_proxy|no_proxy|all_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|PIP_[A-Z_]+|npm_config_[a-z_]+)$/i;

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

class Runner extends EventEmitter {
  constructor(opts) {
    super();
    this.botsDir = opts.botsDir;
    this.mode = opts.mode || 'process';
    this.maxLogLines = opts.maxLogLines || 1000;
    this.python = opts.python || 'python3';
    this.stopTimeoutMs = opts.stopTimeoutMs || 5000;
    this.states = new Map();
    this.statsTimer = setInterval(() => this.sampleStats(), opts.statsIntervalMs || 3000);
    this.statsTimer.unref();
  }

  dir(id) { return path.join(this.botsDir, id); }

  state(id) {
    let s = this.states.get(id);
    if (!s) {
      s = {
        status: 'stopped', // stopped | installing | running | restarting | crashed
        child: null,
        logs: [],
        startedAt: null,
        exitCode: null,
        stopping: false,
        restartTimer: null,
        crashTimes: [],
        backoff: 2000,
        stats: null,
        cpuPrev: null,
        runToken: 0,
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
      stats: s.stats,
    };
  }

  logs(id) { return this.state(id).logs; }

  log(id, stream, text) {
    const s = this.state(id);
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      const entry = { t: Date.now(), s: stream, l: line.length > 4000 ? line.slice(0, 4000) + '…' : line };
      s.logs.push(entry);
      this.emit('log', id, entry);
    }
    if (s.logs.length > this.maxLogLines) s.logs.splice(0, s.logs.length - this.maxLogLines);
  }

  sys(id, text) { this.log(id, 'sys', text); }

  clearLogs(id) { this.state(id).logs = []; }

  setStatus(id, status) {
    const s = this.state(id);
    if (s.status === status) return;
    s.status = status;
    if (status !== 'running') { s.stats = null; s.cpuPrev = null; }
    this.emit('status', id, this.info(id));
  }

  isActive(id) {
    const st = this.state(id).status;
    return st === 'running' || st === 'installing' || st === 'restarting';
  }

  // ----- 起動 -----
  async start(bot, { manual = true } = {}) {
    const s = this.state(bot.id);
    if (manual) { s.crashTimes = []; s.backoff = 2000; }
    if (s.child || s.status === 'installing') return;
    clearTimeout(s.restartTimer);
    s.restartTimer = null;
    s.stopping = false;
    const token = ++s.runToken;
    const dir = this.dir(bot.id);
    fs.mkdirSync(dir, { recursive: true });

    const rt = RUNTIMES[bot.runtime] || RUNTIMES.python;
    const argv = splitCommand(bot.startCommand || rt.defaultCommand);
    if (!argv.length) {
      this.sys(bot.id, '起動コマンドが空です。設定タブで指定してください。');
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
    this.setStatus(bot.id, 'running');

    child.stdout.on('data', (d) => this.log(bot.id, 'out', d));
    child.stderr.on('data', (d) => this.log(bot.id, 'err', d));
    child.on('error', (e) => this.sys(bot.id, `起動できませんでした: ${e.message}`));
    child.on('close', (code, signal) => this.onExit(bot, child, code, signal));
  }

  // requirements.txt / package.json があれば、変わったときだけライブラリを入れ直します
  async install(bot, token) {
    const dir = this.dir(bot.id);
    const s = this.state(bot.id);
    const steps = [];
    if (bot.runtime === 'python' && fs.existsSync(path.join(dir, 'requirements.txt'))) {
      const hash = fileHash(path.join(dir, 'requirements.txt'));
      const marker = path.join(dir, '.deps', '.requirements-hash');
      if (fileHash(marker) !== null && fs.readFileSync(marker, 'utf8') === hash) {
        // 前と同じ → スキップ
      } else {
        const py = this.mode === 'docker' ? 'python3' : this.python;
        steps.push({
          label: 'requirements.txt のライブラリを入れています…',
          argv: [py, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade',
            '--target', '.deps', '-r', 'requirements.txt'],
          done: () => { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, hash); },
        });
      }
    }
    if (bot.runtime === 'node' && fs.existsSync(path.join(dir, 'package.json'))) {
      const hash = fileHash(path.join(dir, 'package.json'));
      const marker = path.join(dir, 'node_modules', '.package-hash');
      if (fileHash(marker) !== null && fs.readFileSync(marker, 'utf8') === hash) {
        // 前と同じ → スキップ
      } else {
        steps.push({
          label: 'package.json のライブラリを入れています…',
          argv: ['npm', 'install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'],
          done: () => { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, hash); },
        });
      }
    }
    for (const step of steps) {
      if (s.stopping || token !== s.runToken) return false;
      this.sys(bot.id, step.label);
      const code = await new Promise((resolve) => {
        const child = this.spawnIn(bot, step.argv, `bothost-${bot.id}-install`);
        s.child = child;
        child.stdout.on('data', (d) => this.log(bot.id, 'out', d));
        child.stderr.on('data', (d) => this.log(bot.id, 'err', d));
        child.on('error', (e) => { this.sys(bot.id, e.message); });
        child.on('close', (c) => resolve(c));
      });
      s.child = null;
      if (s.stopping || token !== s.runToken) { this.sys(bot.id, '停止しました。'); this.setStatus(bot.id, 'stopped'); return false; }
      if (code !== 0) {
        this.sys(bot.id, `ライブラリのインストールに失敗しました (終了コード ${code})。ファイル名やバージョンを確かめてください。`);
        this.setStatus(bot.id, 'crashed');
        return false;
      }
      step.done();
      this.sys(bot.id, 'インストールが終わりました。');
    }
    return true;
  }

  envFor(bot, inDocker) {
    const dir = inDocker ? '/app' : this.dir(bot.id);
    const env = {
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: path.posix.join(dir, '.deps'),
      PYTHONIOENCODING: 'utf-8',
      NODE_ENV: 'production',
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
        '-v', `${dir}:/app`, '-w', '/app',
      ];
      for (const [k, v] of Object.entries(this.envFor(bot, true))) args.push('-e', `${k}=${v}`);
      args.push(rt.image, ...argv);
      return spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    }
    const env = {
      PATH: process.env.PATH,
      HOME: dir,
      LANG: process.env.LANG || 'C.UTF-8',
      TZ: process.env.TZ || '',
      ...this.envFor(bot, false),
    };
    if (!env.TZ) delete env.TZ;
    // プロキシ・証明書・pip / npm の設定は、サーバーと同じものを使います (社内ネットワークなどで必要)
    for (const [k, v] of Object.entries(process.env)) {
      if (PASS_ENV.test(k) && !(k in env)) env[k] = v;
    }
    // detached: プロセスグループごと止められるように (npm start などが子プロセスを作っても残らない)
    return spawn(argv[0], argv.slice(1), { cwd: dir, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  onExit(bot, child, code, signal) {
    const s = this.state(bot.id);
    if (s.child !== child) return;
    s.child = null;
    s.exitCode = code;
    const ranMs = Date.now() - (s.startedAt || Date.now());
    if (s.stopping) {
      this.sys(bot.id, '停止しました。');
      this.setStatus(bot.id, 'stopped');
      this.emit('exit', bot.id, { code, signal, manual: true });
      return;
    }
    this.sys(bot.id, signal ? `終了しました (シグナル ${signal})` : `終了しました (終了コード ${code})`);
    this.emit('exit', bot.id, { code, signal, manual: false });

    if (!bot.autoRestart) {
      this.setStatus(bot.id, code === 0 ? 'stopped' : 'crashed');
      return;
    }
    // 1 分以上動いていたら、待ち時間をリセット
    if (ranMs > 60e3) { s.backoff = 2000; s.crashTimes = []; }
    const now = Date.now();
    s.crashTimes = s.crashTimes.filter((t) => now - t < 5 * 60e3);
    s.crashTimes.push(now);
    if (s.crashTimes.length >= 5) {
      this.sys(bot.id, '5 分で 5 回落ちたので、自動での再起動をやめました。ログを見て直してから起動してください。');
      this.setStatus(bot.id, 'crashed');
      return;
    }
    const wait = s.backoff;
    s.backoff = Math.min(s.backoff * 2, 60e3);
    this.sys(bot.id, `${Math.round(wait / 1000)} 秒後に自動で再起動します…`);
    this.setStatus(bot.id, 'restarting');
    s.restartTimer = setTimeout(() => {
      s.restartTimer = null;
      const latest = this.getBot ? this.getBot(bot.id) : bot;
      if (latest) this.start(latest, { manual: false });
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
      this.kill(id, child, 'SIGTERM');
      const t = setTimeout(() => {
        if (s.child === child || child.exitCode === null) {
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
    if (!s.child || !s.child.stdin.writable) return false;
    s.child.stdin.write(text.endsWith('\n') ? text : text + '\n');
    this.log(id, 'in', text.replace(/\n$/, ''));
    return true;
  }

  async stopAll() {
    await Promise.all([...this.states.keys()].map((id) => this.stop(id)));
  }

  // ----- 使用量 (process モードは /proc から。プロセスグループ全体の合計) -----
  sampleStats() {
    if (this.mode !== 'process' || process.platform !== 'linux') return;
    const running = [...this.states.entries()].filter(([, s]) => s.child && s.status === 'running');
    if (!running.length) return;
    const groups = new Map();
    for (const [, s] of running) groups.set(s.child.pid, { cpu: 0, rss: 0 });
    let entries;
    try { entries = fs.readdirSync('/proc'); } catch { return; }
    for (const name of entries) {
      if (!/^\d+$/.test(name)) continue;
      let stat;
      try { stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8'); } catch { continue; }
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
      this.emit('stats', id, s.stats);
      const bot = this.getBot && this.getBot(id);
      if (bot && bot.memoryLimitMB && s.stats.memoryMB > bot.memoryLimitMB) {
        this.sys(id, `メモリが上限 (${bot.memoryLimitMB} MB) を超えたので止めます (${s.stats.memoryMB} MB)。`);
        this.kill(id, s.child, 'SIGKILL');
      }
    }
  }
}

module.exports = { Runner, RUNTIMES, splitCommand };

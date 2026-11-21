'use strict';
// BotHost — Discord などの bot を 24 時間動かしておくためのサーバー
//   node server.js            → http://localhost:3000
// 設定は環境変数で (README.md を参照)。
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');

const { Store } = require('./lib/store');
const auth = require('./lib/auth');
const files = require('./lib/files');
const zip = require('./lib/zip');
const discord = require('./lib/discord');
const { Backup } = require('./lib/backup');
const { Runner } = require('./lib/runner');
const launch = require('./lib/launch');

const ROOT = __dirname;
const VERSION = require('./package.json').version;
// テンプレート: kind (言語)・command (起動コマンド)・env (入れてもらう環境変数)・web (Web 公開を最初からオン)
const TEMPLATES = {
  'python-discord': { group: 'Discord', kind: 'python', command: 'python3 main.py', label: 'Discord bot (Python)', desc: '!ping に返事をする bot (discord.py)', env: ['DISCORD_TOKEN'] },
  'python-discord-slash': { group: 'Discord', kind: 'python', command: 'python3 main.py', label: 'スラッシュコマンド (Python)', desc: '/ping /dice など。特別な権限が要らない', env: ['DISCORD_TOKEN'] },
  'node-discord': { group: 'Discord', kind: 'node', command: 'node index.js', label: 'Discord bot (Node.js)', desc: '!ping に返事をする bot (discord.js)', env: ['DISCORD_TOKEN'] },
  'node-discord-slash': { group: 'Discord', kind: 'node', command: 'node index.js', label: 'スラッシュコマンド (Node.js)', desc: '/ping /dice /say (discord.js)', env: ['DISCORD_TOKEN'] },
  'python-telegram': { group: 'ほかのアプリ', kind: 'python', command: 'python3 main.py', label: 'Telegram bot', desc: '/start /dice とオウム返し (python-telegram-bot)', env: ['TELEGRAM_TOKEN'] },
  'python-slack': { group: 'ほかのアプリ', kind: 'python', command: 'python3 main.py', label: 'Slack bot', desc: 'メンションに返事 (Bolt・公開 URL 不要)', env: ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'] },
  'python-line': { group: 'ほかのアプリ', kind: 'python', command: 'python3 main.py', label: 'LINE bot', desc: 'オウム返し (Messaging API・Webhook)', env: ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'], web: true },
  'node-twitch': { group: 'ほかのアプリ', kind: 'node', command: 'node index.js', label: 'Twitch のチャット bot', desc: '!hello !dice (tmi.js)', env: ['TWITCH_USERNAME', 'TWITCH_OAUTH', 'TWITCH_CHANNEL'] },
  'python-web': { group: 'そのほか', kind: 'python', command: 'python3 main.py', label: 'Web サーバー・Webhook', desc: 'URL で受け取る bot の土台 (ライブラリなし)', web: true },
  'bat-blank': { group: 'そのほか', kind: 'batch', command: 'start.bat', label: 'Windows のバッチ (.bat)', desc: 'start.bat から Python を起動する例' },
  'python-blank': { group: 'そのほか', kind: 'python', command: 'python3 main.py', label: '空の Python', desc: 'main.py だけ' },
  'node-blank': { group: 'そのほか', kind: 'node', command: 'node index.js', label: '空の Node.js', desc: 'index.js だけ' },
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
// 画面で見られるようにするファイルの種類 (ダウンロード・プレビュー用)
const FILE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.pdf': 'application/pdf',
};
const PORT_BASE = 30000;
// 管理画面に出す「使える言語」
const RUNTIME_CHECK = [['Python', 'python3'], ['Node.js', 'node'], ['TypeScript', 'tsx'], ['Java', 'java'], ['.NET', 'dotnet'],
  ['Windows (.exe)', 'wine64'], ['Ruby', 'ruby'], ['PHP', 'php'], ['Lua', 'lua5.4'], ['Bun', 'bun'], ['ffmpeg', 'ffmpeg']]; // bot が待ち受ける番号 (環境変数 PORT) の始まり

function createApp(config = {}) {
  const env = process.env;
  const cfg = {
    dataDir: path.resolve(config.dataDir || env.BOTHOST_DATA || path.join(ROOT, 'data')),
    mode: config.mode || env.BOTHOST_MODE || 'process',
    registration: config.registration || env.BOTHOST_REGISTRATION || 'first-only', // open | first-only
    maxBotsPerUser: Number(config.maxBotsPerUser || env.BOTHOST_MAX_BOTS || 5),
    maxDiskMB: Number(config.maxDiskMB || env.BOTHOST_MAX_DISK_MB || 500),
    maxUploadMB: Number(config.maxUploadMB || env.BOTHOST_MAX_UPLOAD_MB || 100),
    dockerImage: config.dockerImage || env.BOTHOST_DOCKER_IMAGE || null,
    secureCookie: config.secureCookie ?? env.BOTHOST_SECURE_COOKIE === '1',
    python: config.python || env.BOTHOST_PYTHON || 'python3',
    stopTimeoutMs: config.stopTimeoutMs,
    statsIntervalMs: config.statsIntervalMs,
    crashLimit: config.crashLimit,
    restartBackoffMs: config.restartBackoffMs,
    restoreRetry: config.restoreRetry,
    // bot を bot ごとの別のユーザーで動かす (サーバーが root のときの既定。BOTHOST_ISOLATE=0 で切る)
    isolate: config.isolate ?? (env.BOTHOST_ISOLATE === '0' ? false : undefined),
    resumeGapMs: config.resumeGapMs ?? 3000,
    discordApi: config.discordApi,
    trustProxy: config.trustProxy ?? (env.BOTHOST_TRUST_PROXY === '1' || !!env.RENDER),
    keepAwakeMinutes: Math.max(1, Math.min(14, Number(config.keepAwakeMinutes || env.BOTHOST_KEEP_AWAKE_MINUTES || 5))),
    keepAwakeUrl: config.keepAwakeUrl ?? (env.BOTHOST_KEEP_AWAKE === '0' ? '' : (env.BOTHOST_KEEP_AWAKE_URL || env.RENDER_EXTERNAL_URL || '')),
    backup: config.backup || {
      repo: env.BOTHOST_BACKUP_REPO, token: env.BOTHOST_BACKUP_TOKEN, sshKey: env.BOTHOST_BACKUP_SSH_KEY,
      secretKey: env.BOTHOST_SECRET_KEY,
      branch: env.BOTHOST_BACKUP_BRANCH, file: env.BOTHOST_BACKUP_FILE,
    },
  };
  const botsDir = path.join(cfg.dataDir, 'bots');
  fs.mkdirSync(botsDir, { recursive: true });
  const dbFile = path.join(cfg.dataDir, 'db.json');

  const store = new Store(dbFile);
  const backup = new Backup({ store, botsDir, workDir: cfg.dataDir, ...cfg.backup });
  store.onSave = () => backup.markDirty();
  const runner = new Runner({
    botsDir, mode: cfg.mode, python: cfg.python, isolate: cfg.isolate,
    logsDir: path.join(cfg.dataDir, 'logs'), pidsFile: path.join(cfg.dataDir, 'pids.json'),
    stopTimeoutMs: cfg.stopTimeoutMs, statsIntervalMs: cfg.statsIntervalMs, crashLimit: cfg.crashLimit,
    initialBackoffMs: cfg.restartBackoffMs,
    toolsDir: path.join(cfg.dataDir, 'tools'), dockerImage: cfg.dockerImage,
  });
  const tmpDir = path.join(cfg.dataDir, 'tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const findBot = (id) => store.bots.find((b) => b.id === id);
  runner.getBot = findBot;
  // bot を別のユーザーで動かすには、データの場所まで、ほかのユーザーがたどれる必要がある
  if (runner.isolate) {
    for (let p = path.dirname(cfg.dataDir); ; p = path.dirname(p)) {
      let st;
      try { st = fs.statSync(p); } catch { break; }
      if (!(st.mode & 0o001)) {
        console.warn(`注意: ${p} にほかのユーザーが入れないので、bot をユーザーごとに分けずに動かします (BOTHOST_DATA を別の場所にすると分けられます)`);
        runner.isolate = false;
        break;
      }
      if (p === path.dirname(p)) break;
    }
  }
  // bot を別のユーザーで動かすときは、サーバーのデータ (db.json・ログ・鍵) を bot から読めないようにする
  if (runner.isolate) {
    for (const [p, mode] of [[cfg.dataDir, 0o711], [botsDir, 0o711], [path.join(cfg.dataDir, 'logs'), 0o700], [tmpDir, 0o700]]) {
      try { fs.chmodSync(p, mode); } catch { /* なくてもよい */ }
    }
    for (const f of ['db.json', 'db.json.bak', 'pids.json']) {
      try { fs.chmodSync(path.join(cfg.dataDir, f), 0o600); } catch { /* まだない */ }
    }
  }
  const timers = [];
  const keepAwake = { lastAt: null, ok: null, error: null };

  // ----- リアルタイム (Server-Sent Events) -----
  // ログは 1 行ずつではなく 100ms ごとにまとめて送ります (大量に出す bot でも重くならないように)
  const listeners = new Map(); // botId -> Set(res)
  const logQueue = new Map(); // botId -> entries
  const sse = (id, event, data) => {
    const set = listeners.get(id);
    if (!set || !set.size) return;
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(msg);
  };
  runner.on('log', (id, entry) => {
    if (!listeners.get(id)?.size) return;
    let q = logQueue.get(id);
    if (!q) logQueue.set(id, (q = []));
    q.push(entry);
  });
  timers.push(setInterval(() => {
    for (const [id, q] of logQueue) {
      if (q.length) sse(id, 'logs', q.splice(0));
    }
  }, 100));
  // ユーザーごとの配信 (一覧の画面: 自分の bot の状態と使用量をまとめて)
  const userStreams = new Map(); // userId -> Set(res)
  const toOwner = (id, event, data) => {
    const bot = findBot(id);
    const set = bot && userStreams.get(bot.ownerId);
    if (!set || !set.size) return;
    const msg = `event: ${event}\ndata: ${JSON.stringify({ id, ...data })}\n\n`;
    for (const res of set) res.write(msg);
  };
  runner.on('status', (id, info) => { sse(id, 'status', info); toOwner(id, 'status', info); });
  runner.on('stats', (id, stats) => {
    const h = runner.history(id);
    sse(id, 'stats', { ...stats, point: h[h.length - 1] });
    toOwner(id, 'stats', stats);
  });
  // 起動したときの言語を覚えておく (一覧のアイコンなどに使う)
  runner.on('launch', (id, { kind }) => {
    const bot = findBot(id);
    if (bot && kind && bot.runtime !== kind) { bot.runtime = kind; store.save(); }
  });
  runner.on('exit', (id, { manual }) => {
    const bot = findBot(id);
    if (bot && !manual) { bot.lastCrashAt = Date.now(); bot.crashCount = (bot.crashCount || 0) + 1; store.save(); }
  });

  // 落ちたら Discord の Webhook に知らせる (同じ bot は 10 分に 1 回まで。あきらめたときは必ず)
  const lastNotify = new Map();
  runner.on('crash', (id, info) => {
    const bot = findBot(id);
    if (!bot || !bot.notifyWebhook) return;
    const now = Date.now();
    if (!info.gaveUp && now - (lastNotify.get(id) || 0) < 10 * 60e3) return;
    lastNotify.set(id, now);
    const why = info.reason === 'memory' ? 'メモリの上限を超えました'
      : info.reason === 'install' ? 'ライブラリのインストールに失敗しました'
        : info.signal ? `シグナル ${info.signal} で終了しました` : `終了コード ${info.code} で終了しました`;
    discord.notify(bot.notifyWebhook, {
      title: info.gaveUp ? `🔴 ${bot.name} が止まりました` : `🟠 ${bot.name} が落ちました (自動で再起動します)`,
      description: info.gaveUp ? `${why}。ログを見て直してから起動してください。` : `${why}。`,
      color: info.gaveUp ? 'bad' : 'warn',
      log: info.tail,
    }).catch((e) => runner.sys(id, `通知を送れませんでした: ${e.message}`));
  });

  // ----- 共通 -----
  const send = (res, status, body, headers = {}) => {
    const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
    const data = isJson ? JSON.stringify(body) : body;
    res.writeHead(status, {
      'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(data);
  };
  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const fail = (status, msg) => { throw new HttpError(status, msg); };

  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, `データが大きすぎます (${Math.round(limit / 1048576)} MB まで)`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const readJson = async (req) => {
    const buf = await readBody(req, 256 * 1024);
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); } catch { return fail(400, 'JSON が正しくありません'); }
  };

  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    if (i < 0) return [c.trim(), ''];
    let v = c.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch { /* そのまま */ }
    return [c.slice(0, i).trim(), v];
  }));
  const sessionCookie = (token, maxAge) =>
    `bothost_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.secureCookie ? '; Secure' : ''}`;

  const registrationOpen = () => store.users.length === 0
    || (store.settings.registrationOpen ?? cfg.registration === 'open');

  const publicUser = (u) => ({ id: u.id, username: u.username, admin: !!u.admin, createdAt: u.createdAt });
  // 環境変数の値は返さない (入っているかだけ)
  const maskEnv = (e) => Object.fromEntries(Object.entries(e || {}).map(([k, v]) => [k, v !== '']));
  const publicBot = (b) => ({
    id: b.id, name: b.name, runtime: b.runtime, template: b.template,
    startCommand: b.startCommand, commandMode: b.commandMode || 'manual', buildCommand: b.buildCommand || '',
    timezone: b.timezone || '', port: b.port || null,
    web: b.web && b.web.enabled ? { enabled: true, path: `/w/${b.web.slug}/` } : { enabled: false },
    autoRestart: b.autoRestart, keepRunning: b.desired === 'running',
    memoryLimitMB: b.memoryLimitMB, cpuLimit: b.cpuLimit, restartEveryHours: b.restartEveryHours || 0,
    notify: !!b.notifyWebhook, discord: b.discord || null,
    crashCount: b.crashCount || 0, lastCrashAt: b.lastCrashAt || null,
    env: maskEnv(b.env), createdAt: b.createdAt, ownerId: b.ownerId,
    ...runner.info(b.id),
  });

  // どう起動するか (画面に出す): 自動で見つけた方法・候補・動かせない理由
  const launchInfo = (bot) => {
    const plan = runner.plan(bot);
    const found = launch.detect(runner.dir(bot.id));
    return {
      command: plan.command || null, auto: bot.commandMode === 'auto', kind: plan.kind || null,
      label: launch.KINDS[plan.kind] ? launch.KINDS[plan.kind].label : null,
      problem: plan.problem || null, note: plan.note || null, build: plan.build || null,
      candidates: found.candidates,
    };
  };

  // bot ごとに、待ち受ける番号 (PORT) を決める (ほかの bot と重ならないように)
  const assignPort = (bot) => {
    if (bot.port) return false;
    const used = new Set(store.bots.filter((b) => b !== bot).map((b) => b.port).filter(Boolean));
    let p = PORT_BASE + (parseInt(bot.id.slice(0, 4), 16) % 5000 || 0);
    while (used.has(p) || p === Number(env.PORT || 3000)) p++;
    bot.port = p;
    return true;
  };
  const newSlug = () => crypto.randomBytes(12).toString('base64url');

  const ownedBot = (user, id) => {
    const bot = findBot(id);
    if (!bot || (bot.ownerId !== user.id && !user.admin)) fail(404, 'bot が見つかりません');
    return bot;
  };

  const validName = (name) => {
    const n = String(name || '').trim();
    if (!n || n.length > 40) fail(400, '名前は 1〜40 文字にしてください');
    return n;
  };
  const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

  // 保存容量 (数えるのに時間がかかるので、15 秒は覚えておく。書いた分は足しておく)
  const disk = { at: 0, mb: 0 };
  const diskMB = () => {
    if (Date.now() - disk.at > 15e3) { disk.mb = files.dirSize(botsDir) / 1048576; disk.at = Date.now(); }
    return disk.mb;
  };
  const checkDisk = () => {
    if (diskMB() > cfg.maxDiskMB) fail(507, 'サーバーの保存容量がいっぱいです');
  };
  const addDisk = (bytes) => { disk.mb += bytes / 1048576; };

  // ----- ルート -----
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, auth: opts.auth !== false, admin: !!opts.admin });
  };

  route('GET', '/api/health', async () => {
    const b = backup.info();
    return {
      ok: true, version: VERSION, uptime: Math.round(process.uptime()),
      running: [...runner.states.values()].filter((s) => s.status === 'running').length,
      // バックアップが動いているか (秘密は含めない)
      backup: b.enabled ? { method: b.method, connected: b.connected, lastAt: b.lastAt, ok: !b.lastError && !b.blocked, encrypted: b.encrypted } : null,
      keepAwake: cfg.keepAwakeUrl ? { lastAt: keepAwake.lastAt, ok: keepAwake.ok } : null,
    };
  }, { auth: false });

  route('GET', '/api/config', async () => ({
    version: VERSION,
    mode: cfg.mode,
    registrationOpen: registrationOpen(),
    firstUser: store.users.length === 0,
    templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })),
    kinds: launch.KINDS,
    maxBotsPerUser: cfg.maxBotsPerUser,
    maxUploadMB: cfg.maxUploadMB,
  }), { auth: false });

  route('POST', '/api/register', async ({ req, res, ip }) => {
    if (!registrationOpen()) fail(403, '新しい登録は受け付けていません。管理者に頼んでください');
    const { username, password } = await readJson(req);
    if (!auth.allowLogin(ip, username)) fail(429, '少し時間をおいてからもう一度お試しください');
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(name)) fail(400, 'ユーザー名は半角英数字と _ . - で 3〜24 文字にしてください');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) fail(400, 'パスワードは 8 文字以上にしてください');
    if (store.users.some((u) => u.username.toLowerCase() === name.toLowerCase())) fail(409, 'そのユーザー名はもう使われています');
    const user = {
      id: auth.newId(), username: name, password: auth.hashPassword(password),
      admin: store.users.length === 0, createdAt: Date.now(),
    };
    store.users.push(user);
    const token = auth.createSession(store, user.id);
    // 最初のアカウントはすぐにバックアップ (サーバーが再起動しても消えないように)
    if (user.admin && backup.enabled && !backup.blocked) setTimeout(() => backup.run().catch(() => {}), 1000).unref();
    res.setHeader('Set-Cookie', sessionCookie(token, auth.SESSION_DAYS * 86400));
    return { user: publicUser(user) };
  }, { auth: false });

  route('POST', '/api/login', async ({ req, res, ip }) => {
    const { username, password } = await readJson(req);
    if (!auth.allowLogin(ip, username)) fail(429, 'ログインの失敗が多いので、10 分ほど待ってからもう一度お試しください');
    const user = store.users.find((u) => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
    if (!user || typeof password !== 'string' || !auth.verifyPassword(password, user.password)) {
      fail(401, 'ユーザー名かパスワードが違います');
    }
    const token = auth.createSession(store, user.id);
    res.setHeader('Set-Cookie', sessionCookie(token, auth.SESSION_DAYS * 86400));
    return { user: publicUser(user) };
  }, { auth: false });

  route('POST', '/api/logout', async ({ req, res }) => {
    auth.destroySession(store, cookies(req).bothost_session);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  }, { auth: false });

  route('GET', '/api/me', async ({ user }) => ({ user: publicUser(user) }));

  route('POST', '/api/me/password', async ({ req, user, ip }) => {
    const { current, next } = await readJson(req);
    if (!auth.allowLogin(ip, user.username)) fail(429, '少し時間をおいてからもう一度お試しください');
    if (typeof current !== 'string' || !auth.verifyPassword(current, user.password)) fail(400, '今のパスワードが違います');
    if (typeof next !== 'string' || next.length < 8 || next.length > 200) fail(400, '新しいパスワードは 8 文字以上にしてください');
    user.password = auth.hashPassword(next);
    // ほかの端末のログインは切る (この端末はそのまま)
    auth.destroyUserSessions(store, user.id, cookies(req).bothost_session);
    store.save();
    return { ok: true };
  });

  // ----- 管理者 -----
  route('GET', '/api/admin', async () => ({
    users: store.users.map((u) => ({ ...publicUser(u), bots: store.bots.filter((b) => b.ownerId === u.id).length })),
    settings: { registrationOpen: registrationOpen() },
    backup: backup.info(),
    keepAwake: cfg.keepAwakeUrl ? { url: cfg.keepAwakeUrl, ...keepAwake } : null,
    security: { isolate: runner.isolate, encryptedBackup: backup.info().encrypted, secureCookie: cfg.secureCookie },
    server: {
      version: VERSION, mode: cfg.mode, uptime: Math.round(process.uptime()),
      node: process.version, memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      diskMB: Math.round(diskMB() * 10) / 10, maxDiskMB: cfg.maxDiskMB,
      runtimes: RUNTIME_CHECK.map(([label, cmd]) => ({ label, ok: runner.hasCommand(cmd) })),
      bots: store.bots.length, running: [...runner.states.values()].filter((s) => s.status === 'running').length,
    },
  }), { admin: true });

  route('PATCH', '/api/admin/settings', async ({ req }) => {
    const body = await readJson(req);
    if (body.registrationOpen !== undefined) store.settings.registrationOpen = !!body.registrationOpen;
    store.save();
    return { settings: { registrationOpen: registrationOpen() } };
  }, { admin: true });

  route('DELETE', '/api/admin/users/:uid', async ({ user, params }) => {
    const target = store.users.find((u) => u.id === params.uid);
    if (!target) fail(404, 'ユーザーが見つかりません');
    if (target.id === user.id) fail(400, '自分は削除できません');
    for (const bot of store.bots.filter((b) => b.ownerId === target.id)) await deleteBot(bot);
    store.data.users = store.users.filter((u) => u !== target);
    for (const [t, s] of Object.entries(store.sessions)) if (s.userId === target.id) delete store.sessions[t];
    store.save();
    return { ok: true };
  }, { admin: true });

  route('POST', '/api/admin/backup', async () => {
    try { await backup.run({ force: true }); } catch (e) { fail(502, e.message); }
    return { backup: backup.info() };
  }, { admin: true });

  // ----- bot -----
  route('GET', '/api/bots', async ({ user }) => ({
    bots: store.bots.filter((b) => b.ownerId === user.id).map(publicBot),
  }));

  route('POST', '/api/bots', async ({ req, user }) => {
    const body = await readJson(req);
    const name = validName(body.name);
    if (store.bots.filter((b) => b.ownerId === user.id).length >= cfg.maxBotsPerUser && !user.admin) {
      fail(403, `bot は 1 人 ${cfg.maxBotsPerUser} 個までです`);
    }
    const template = TEMPLATES[body.template] ? body.template : null;
    const t = template ? TEMPLATES[template] : null;
    const bot = {
      id: auth.newId(6), ownerId: user.id, name, runtime: t ? t.kind : 'python', template,
      // 起動方法は、ファイルから自動で見つける (自分のファイルを入れたときもそのまま動くように)
      startCommand: t ? t.command : 'python3 main.py', commandMode: 'auto',
      env: Object.fromEntries((t && t.env ? t.env : []).map((k) => [k, ''])), autoRestart: true, desired: 'stopped',
      memoryLimitMB: 256, cpuLimit: 0.5, restartEveryHours: 0, createdAt: Date.now(),
      timezone: /^[A-Za-z_]+\/[A-Za-z_]+$/.test(String(body.timezone || '')) ? body.timezone : null,
      web: t && t.web ? { enabled: true, slug: newSlug() } : { enabled: false },
    };
    assignPort(bot);
    files.copyTemplate(template && path.join(ROOT, 'templates', template), runner.dir(bot.id));
    runner.prepareDir(bot.id);
    store.bots.push(bot);
    store.save();
    return { bot: publicBot(bot) };
  });

  route('GET', '/api/bots/:id', async ({ user, params }) => {
    const bot = ownedBot(user, params.id);
    return { bot: publicBot(bot), launch: launchInfo(bot) };
  });

  route('PATCH', '/api/bots/:id', async ({ req, user, params }) => {
    const bot = ownedBot(user, params.id);
    const body = await readJson(req);
    if (body.name !== undefined) bot.name = validName(body.name);
    if (body.startCommand !== undefined) {
      const c = String(body.startCommand).trim();
      if (!c || c.length > 300) fail(400, '起動コマンドは 1〜300 文字にしてください');
      if (c !== bot.startCommand || body.commandMode === 'manual') bot.commandMode = 'manual';
      bot.startCommand = c;
    }
    if (body.commandMode === 'auto' || body.commandMode === 'manual') bot.commandMode = body.commandMode;
    if (body.buildCommand !== undefined) {
      const c = String(body.buildCommand || '').trim();
      if (c.length > 300) fail(400, 'ビルドのコマンドは 300 文字までにしてください');
      bot.buildCommand = c || null;
    }
    if (body.timezone !== undefined) {
      const tz = String(body.timezone || '').trim();
      if (tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { fail(400, 'タイムゾーンが正しくありません (例: Asia/Tokyo)'); } }
      bot.timezone = tz || null;
    }
    if (body.web && typeof body.web === 'object') {
      if (body.web.enabled !== undefined) {
        bot.web = { ...(bot.web || {}), enabled: !!body.web.enabled };
        if (bot.web.enabled && !bot.web.slug) bot.web.slug = newSlug();
      }
      if (body.web.regenerate && bot.web && bot.web.enabled) bot.web.slug = newSlug();
      assignPort(bot);
    }
    if (body.autoRestart !== undefined) bot.autoRestart = !!body.autoRestart;
    if (body.memoryLimitMB !== undefined) {
      const m = Number(body.memoryLimitMB);
      if (!(m >= 32 && m <= 4096)) fail(400, 'メモリの上限は 32〜4096 MB にしてください');
      bot.memoryLimitMB = Math.round(m);
    }
    if (body.cpuLimit !== undefined) {
      const c = Number(body.cpuLimit);
      if (!(c >= 0.1 && c <= 4)) fail(400, 'CPU の上限は 0.1〜4 にしてください');
      bot.cpuLimit = c;
    }
    if (body.restartEveryHours !== undefined) {
      const hrs = Number(body.restartEveryHours);
      if (!(hrs === 0 || (hrs >= 1 && hrs <= 168))) fail(400, '定期的な再起動は 1〜168 時間 (0 で使わない) にしてください');
      bot.restartEveryHours = Math.round(hrs);
    }
    if (body.notifyWebhook !== undefined) {
      const w = String(body.notifyWebhook || '').trim();
      if (w && !discord.validWebhook(w)) fail(400, 'Discord の Webhook の URL を入れてください (https://discord.com/api/webhooks/… の形)');
      bot.notifyWebhook = w || null;
    }
    if (body.env && typeof body.env === 'object') {
      bot.env = bot.env || {};
      for (const [k, v] of Object.entries(body.env)) {
        if (!ENV_KEY.test(k)) fail(400, `環境変数の名前「${k}」は使えません (半角英数字と _ で、数字から始めない)`);
        if (v === null) delete bot.env[k];
        else if (typeof v === 'string') {
          if (v.length > 4096) fail(400, '環境変数の値が長すぎます');
          bot.env[k] = k === 'DISCORD_TOKEN' ? v.trim().replace(/^Bot\s+/i, '') : v;
        }
      }
      if (Object.keys(bot.env).length > 50) fail(400, '環境変数は 50 個までです');
      if ('DISCORD_TOKEN' in body.env) bot.discord = null;
    }
    store.save();
    return { bot: publicBot(bot), launch: launchInfo(bot) };
  });

  const deleteBot = async (bot) => {
    await runner.stop(bot.id);
    store.data.bots = store.bots.filter((b) => b !== bot);
    store.save();
    fs.rmSync(runner.dir(bot.id), { recursive: true, force: true });
    runner.forget(bot.id);
  };

  route('DELETE', '/api/bots/:id', async ({ user, params }) => {
    await deleteBot(ownedBot(user, params.id));
    return { ok: true };
  });

  route('POST', '/api/bots/:id/start', async ({ user, params }) => {
    const bot = ownedBot(user, params.id);
    bot.desired = 'running';
    store.save();
    runner.start(bot);
    return { bot: publicBot(bot) };
  });
  route('POST', '/api/bots/:id/stop', async ({ user, params }) => {
    const bot = ownedBot(user, params.id);
    bot.desired = 'stopped';
    store.save();
    await runner.stop(bot.id);
    return { bot: publicBot(bot) };
  });
  route('POST', '/api/bots/:id/restart', async ({ user, params }) => {
    const bot = ownedBot(user, params.id);
    bot.desired = 'running';
    store.save();
    runner.stop(bot.id).then(() => runner.start(bot));
    return { bot: publicBot(bot) };
  });
  route('POST', '/api/bots/:id/reinstall', async ({ user, params }) => {
    const bot = ownedBot(user, params.id);
    const wasActive = runner.isActive(bot.id);
    await runner.stop(bot.id);
    runner.resetDeps(bot.id);
    runner.sys(bot.id, 'ライブラリを消しました。次の起動で入れ直します。');
    if (wasActive) runner.start(bot);
    return { bot: publicBot(bot) };
  });
  route('POST', '/api/bots/:id/stdin', async ({ req, user, params }) => {
    const bot = ownedBot(user, params.id);
    const { text } = await readJson(req);
    if (typeof text !== 'string' || text.length > 4000) fail(400, '入力が正しくありません');
    if (!runner.write(bot.id, text)) fail(409, 'bot が動いていません');
    return { ok: true };
  });
  route('DELETE', '/api/bots/:id/logs', async ({ user, params }) => {
    runner.clearLogs(ownedBot(user, params.id).id);
    return { ok: true };
  });
  route('GET', '/api/bots/:id/logs.txt', async ({ res, user, params }) => {
    const bot = ownedBot(user, params.id);
    // eslint-disable-next-line no-control-regex
    const text = runner.logs(bot.id).map((e) => `${new Date(e.t).toISOString()} [${e.s}] ${e.l.replace(/\x1b\[[0-9;]*m/g, '')}`).join('\n');
    send(res, 200, text + '\n', {
      'Content-Disposition': `attachment; filename="${encodeURIComponent(bot.name)}-log.txt"`,
    });
  });

  // ----- Discord -----
  route('POST', '/api/bots/:id/discord-check', async ({ user, params }) => {
    const bot = ownedBot(user, params.id);
    const result = await discord.checkToken(bot.env?.DISCORD_TOKEN, cfg.discordApi ? { api: cfg.discordApi } : {});
    if (result.ok) {
      bot.discord = {
        id: result.id, username: result.username, avatarUrl: result.avatarUrl, inviteUrl: result.inviteUrl,
        intents: result.intents, guilds: result.guilds, checkedAt: Date.now(),
      };
      store.save();
    }
    return { result, bot: publicBot(bot) };
  });
  route('POST', '/api/bots/:id/notify-test', async ({ user, params }) => {
    const bot = ownedBot(user, params.id);
    if (!bot.notifyWebhook) fail(400, '先に Webhook の URL を保存してください');
    try {
      await discord.notify(bot.notifyWebhook, {
        title: `🔔 ${bot.name} のテスト通知`, description: 'BotHost からの通知はこのように届きます。', color: 'info',
      });
    } catch (e) { fail(502, e.message); }
    return { ok: true };
  });

  route('GET', '/api/stream', async ({ req, res, user }) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\nevent: hello\ndata: {}\n\n');
    let set = userStreams.get(user.id);
    if (!set) userStreams.set(user.id, (set = new Set()));
    if (set.size >= 10) { const oldest = set.values().next().value; set.delete(oldest); oldest.end(); }
    set.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
    req.on('close', () => { clearInterval(ping); set.delete(res); });
    return undefined;
  });

  route('GET', '/api/bots/:id/events', async ({ req, res, user, params }) => {
    const bot = ownedBot(user, params.id);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\nevent: init\ndata: ${JSON.stringify({
      ...runner.info(bot.id), logs: runner.logs(bot.id).slice(-1000), history: runner.history(bot.id),
    })}\n\n`);
    let set = listeners.get(bot.id);
    if (!set) listeners.set(bot.id, (set = new Set()));
    if (set.size >= 10) { const oldest = set.values().next().value; set.delete(oldest); oldest.end(); }
    set.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
    req.on('close', () => { clearInterval(ping); set.delete(res); });
    return undefined; // 開いたまま
  });

  // ----- ファイル -----
  route('GET', '/api/bots/:id/files', async ({ user, params }) => files.list(runner.dir(ownedBot(user, params.id).id)));

  // 1 つのファイルを返す (?download=1 で保存。画像・音声などはそのまま表示できる種類で)
  route('GET', '/api/bots/:id/file', async ({ res, user, params, query }) => {
    const bot = ownedBot(user, params.id);
    const full = files.resolveInside(runner.dir(bot.id), query.get('path') || '');
    let st;
    try { st = fs.statSync(full); } catch { fail(404, 'ファイルがありません'); }
    if (st.isDirectory()) fail(400, 'フォルダーです');
    const name = path.basename(full);
    const type = query.get('download') === '1' ? 'application/octet-stream' : (FILE_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream');
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      ...(query.get('download') === '1' ? { 'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]+/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` } : {}),
    });
    fs.createReadStream(full).pipe(res);
    return undefined;
  });

  // ファイルの説明 (Windows の実行ファイル・.jar など) と、このファイルで起動するときのコマンド
  route('GET', '/api/bots/:id/fileinfo', async ({ user, params, query }) => {
    const bot = ownedBot(user, params.id);
    const dir = runner.dir(bot.id);
    const full = files.resolveInside(dir, query.get('path') || '');
    if (!fs.existsSync(full)) fail(404, 'ファイルがありません');
    const info = launch.describe(full);
    const rel = path.relative(dir, full).split(path.sep).join('/');
    let command = null;
    if (info && info.runnable) {
      const q = /\s/.test(rel) ? `"${rel}"` : rel;
      command = /\.(py|pyw)$/i.test(rel) ? `python3 ${q}` : /\.(js|mjs|cjs)$/i.test(rel) ? `node ${q}` : /\.(ts|mts)$/i.test(rel) ? `tsx ${q}` : (info.kind === 'binary' && !rel.includes('/') ? `./${q}` : q);
      if (/\.dll$/i.test(rel)) command = `dotnet ${q}`;
      const r = launch.resolve(dir, command, { memoryMB: bot.memoryLimitMB });
      if (r.problem) return { info, command: null, problem: r.problem };
    }
    return { info, command, size: fs.statSync(full).size };
  });

  route('PUT', '/api/bots/:id/file', async ({ req, user, params, query }) => {
    const bot = ownedBot(user, params.id);
    checkDisk();
    const { full, size } = await files.writeStream(runner.dir(bot.id), query.get('path'), req, cfg.maxUploadMB * 1048576);
    runner.adopt(bot.id, full);
    addDisk(size);
    backup.markDirty();
    return { ok: true };
  });

  route('DELETE', '/api/bots/:id/file', async ({ user, params, query }) => {
    const bot = ownedBot(user, params.id);
    files.remove(runner.dir(bot.id), query.get('path'));
    disk.at = 0;
    backup.markDirty();
    return { ok: true };
  });

  route('POST', '/api/bots/:id/rename', async ({ req, user, params }) => {
    const bot = ownedBot(user, params.id);
    const { from, to } = await readJson(req);
    files.rename(runner.dir(bot.id), from, to);
    runner.adopt(bot.id, files.resolveInside(runner.dir(bot.id), to));
    backup.markDirty();
    return { ok: true };
  });

  // ZIP で保存 (1 ファイルずつ書きながら送る)
  route('GET', '/api/bots/:id/export', async ({ res, user, params }) => {
    const bot = ownedBot(user, params.id);
    const safe = bot.name.replace(/[^\w.-]+/g, '_') || 'bot';
    res.writeHead(200, {
      'Content-Type': 'application/zip', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${safe}.zip"; filename*=UTF-8''${encodeURIComponent(bot.name)}.zip`,
    });
    try { await zip.streamZip(res, files.collect(runner.dir(bot.id))); } catch { /* 途中で切れた */ }
    res.end();
    return undefined;
  });

  // ZIP を読み込む (いったんディスクに置いて、1 つずつ取り出す)
  route('POST', '/api/bots/:id/import', async ({ req, user, params, query }) => {
    const bot = ownedBot(user, params.id);
    checkDisk();
    const tmp = path.join(tmpDir, `import-${bot.id}-${Date.now()}.zip`);
    let count;
    try {
      await files.writeStream(tmpDir, path.basename(tmp), req, cfg.maxUploadMB * 1048576);
      let z;
      try { z = zip.openZip(tmp, { maxTotal: Math.max(300, cfg.maxUploadMB * 3) * 1048576 }); } catch (e) {
        fail(400, e instanceof zip.ZipError ? e.message : 'ZIP を読めませんでした');
      }
      try {
        count = files.importEntries(runner.dir(bot.id), z.entries, { replace: query.get('replace') === '1' });
      } catch (e) {
        if (e instanceof zip.ZipError) fail(400, e.message);
        throw e;
      } finally { z.close(); }
    } finally { fs.rmSync(tmp, { force: true }); }
    runner.prepareDir(bot.id);
    disk.at = 0;
    backup.markDirty();
    return { count, launch: launchInfo(bot) };
  });

  // Web 公開: https://(このサイト)/w/(秘密の文字)/… を、bot が待ち受けている番号 (PORT) に渡す
  // LINE などの Webhook や、bot の「動いています」ページに使う
  const webBot = (slug) => store.bots.find((b) => b.web && b.web.enabled && b.web.slug === slug && b.port);
  const stripSession = (cookie) => (cookie || '').split(/;\s*/).filter((c) => c && !c.startsWith('bothost_session=')).join('; ');
  const proxyWeb = (req, res, url) => {
    const m = url.pathname.match(/^\/w\/([A-Za-z0-9_-]{8,64})(\/.*)?$/);
    const bot = m && webBot(m[1]);
    if (!bot) return send(res, 404, 'Not Found');
    if (!m[2]) { res.writeHead(308, { Location: `/w/${m[1]}/${url.search}` }); return res.end(); }
    const headers = { ...req.headers };
    // 1 つの接続の中だけで使うヘッダーは渡さない
    for (const k of ['host', 'connection', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'upgrade']) delete headers[k];
    const cookie = stripSession(headers.cookie);
    if (cookie) headers.cookie = cookie; else delete headers.cookie;
    const fwdFor = (cfg.trustProxy && req.headers['x-forwarded-for']) || req.socket.remoteAddress || '';
    headers['x-forwarded-for'] = fwdFor;
    headers['x-forwarded-host'] = req.headers['x-forwarded-host'] || req.headers.host || '';
    headers['x-forwarded-proto'] = (cfg.trustProxy && req.headers['x-forwarded-proto']) || (cfg.secureCookie ? 'https' : 'http');
    headers['x-forwarded-prefix'] = `/w/${m[1]}`;
    headers.host = `127.0.0.1:${bot.port}`;
    const preq = http.request({ host: '127.0.0.1', port: bot.port, method: req.method, path: m[2] + url.search, headers, timeout: 120e3 }, (pres) => {
      const h = { ...pres.headers };
      // bot から BotHost のログインを書き換えられないように
      if (h['set-cookie']) h['set-cookie'] = [].concat(h['set-cookie']).filter((c) => !/^\s*bothost_session=/i.test(c));
      // サイト全体の cookie を消す・別の場所へ動かす、などはさせない
      for (const k of ['clear-site-data', 'connection', 'keep-alive', 'transfer-encoding', 'service-worker-allowed']) delete h[k];
      // bot のページは「別のサイト」として扱う (BotHost の画面やログインには触れられない)
      h['content-security-policy'] = 'sandbox allow-scripts allow-forms allow-popups allow-downloads';
      res.writeHead(pres.statusCode || 502, h);
      pres.pipe(res);
    });
    preq.on('timeout', () => preq.destroy(new Error('timeout')));
    preq.on('error', (e) => {
      if (res.headersSent) { res.destroy(); return; }
      const running = runner.state(bot.id).status === 'running';
      send(res, 502, running
        ? `bot が ${bot.port} 番で待ち受けていません。bot のプログラムを、環境変数 PORT の番号で待ち受けるようにしてください。(${e.code || e.message})`
        : 'bot が動いていません。BotHost で起動してください。');
    });
    req.pipe(preq);
    return undefined;
  };
  const proxyUpgrade = (req, socket, head) => {
    const m = String(req.url || '').match(/^\/w\/([A-Za-z0-9_-]{8,64})(\/[^?]*)?(\?.*)?$/);
    const bot = m && webBot(m[1]);
    if (!bot) { socket.destroy(); return; }
    const up = net.connect(bot.port, '127.0.0.1', () => {
      const lines = [`${req.method} ${(m[2] || '/') + (m[3] || '')} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        let v = req.rawHeaders[i + 1];
        if (/^host$/i.test(k)) v = `127.0.0.1:${bot.port}`;
        if (/^cookie$/i.test(k)) { v = stripSession(v); if (!v) continue; }
        lines.push(`${k}: ${v}`);
      }
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    // 片方が切れたら、もう片方も切る (つなぎっぱなしで残らないように)
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
    up.on('close', () => socket.destroy());
    socket.on('close', () => up.destroy());
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
  };
  const upgraded = new Set();

  // ----- 画面 (public/ の静的ファイル。メモリに置いて gzip と ETag で返す) -----
  const staticCache = new Map();
  const loadStatic = (full) => {
    const st = fs.statSync(full);
    const hit = staticCache.get(full);
    if (hit && hit.mtime === st.mtimeMs) return hit;
    const body = fs.readFileSync(full);
    const type = MIME[path.extname(full)] || 'application/octet-stream';
    const entry = {
      mtime: st.mtimeMs, body, type,
      gz: /^(text|application\/(json|manifest)|image\/svg)/.test(type) ? zlib.gzipSync(body) : null,
      etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`,
    };
    staticCache.set(full, entry);
    return entry;
  };
  const serveStatic = (req, res, pathname) => {
    let rel;
    try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return send(res, 400, 'Bad Request'); }
    const pub = path.join(ROOT, 'public');
    const full = path.resolve(pub, rel);
    const exists = full.startsWith(pub + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile();
    if (!exists && path.extname(rel)) return send(res, 404, 'Not Found');
    const target = exists ? full : path.join(pub, 'index.html'); // 画面の中の URL (#/ 以外) も index.html
    const f = loadStatic(target);
    const headers = {
      'Content-Type': f.type,
      'Cache-Control': 'no-cache',
      ETag: f.etag,
      Vary: 'Accept-Encoding',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cdn.discordapp.com; media-src 'self' blob:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    };
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); return res.end(); }
    const gzip = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : (gzip ? f.gz : f.body));
  };

  const handler = async (req, res) => {
    // どの返事にも付ける安全のためのヘッダー
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (cfg.secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Bad Request'); }
    // リバースプロキシ (Render など) の後ろでは、本当の IP は X-Forwarded-For に入っています
    const ip = (cfg.trustProxy && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    if (url.pathname.startsWith('/w/')) return proxyWeb(req, res, url);
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
      return serveStatic(req, res, url.pathname);
    }
    try {
      // CSRF 対策: 変更する操作には、ほかのサイトからは付けられないヘッダーを必須にします
      if (req.method !== 'GET' && req.headers['x-bothost'] !== '1') fail(403, '不正なリクエストです');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        let params;
        try { params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); } catch { fail(400, 'URL が正しくありません'); }
        let user = null;
        if (r.auth) {
          user = auth.getSessionUser(store, cookies(req).bothost_session);
          if (!user) fail(401, 'ログインしてください');
          if (r.admin && !user.admin) fail(403, '管理者だけが使えます');
        }
        const result = await r.handler({ req, res, user, params, query: url.searchParams, ip });
        if (result !== undefined && !res.headersSent) send(res, 200, result);
        return;
      }
      fail(404, 'API が見つかりません');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof files.PathError ? (e.status || 400) : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'サーバーでエラーが起きました' : e.message });
      else res.end();
    }
  };

  const server = http.createServer((req, res) => { handler(req, res); });
  server.on('upgrade', proxyUpgrade);
  server.keepAliveTimeout = 65e3; // リバースプロキシ (Render など) より長く
  server.headersTimeout = 70e3;
  server.requestTimeout = 5 * 60e3;

  // 決めた時間ごとに再起動 (メモリが少しずつ増える bot 向け)
  timers.push(setInterval(() => {
    const now = Date.now();
    for (const bot of store.bots) {
      const s = runner.states.get(bot.id);
      if (!bot.restartEveryHours || !s || s.status !== 'running' || !s.startedAt) continue;
      if (now - s.startedAt >= bot.restartEveryHours * 3600e3) {
        runner.sys(bot.id, `${bot.restartEveryHours} 時間たったので、決めたとおり再起動します。`);
        runner.restart(bot);
      }
    }
  }, 60e3));

  // 眠らせない (24 時間稼働): Render の無料プランなどは、外からアクセスがないと 15 分で止まるので、
  // サイトを閉じていても、自分の公開 URL に数分ごとにアクセスし続けます
  if (cfg.keepAwakeUrl) {
    const ping = async () => {
      try {
        const res = await fetch(cfg.keepAwakeUrl.replace(/\/$/, '') + '/api/health?ping=1', { signal: AbortSignal.timeout(20000) });
        keepAwake.lastAt = Date.now();
        keepAwake.ok = res.ok;
        keepAwake.error = res.ok ? null : `HTTP ${res.status}`;
      } catch (e) {
        keepAwake.lastAt = Date.now();
        keepAwake.ok = false;
        keepAwake.error = e.name === 'TimeoutError' ? '時間切れ' : e.message;
      }
    };
    timers.push(setTimeout(ping, 30e3));
    timers.push(setInterval(ping, cfg.keepAwakeMinutes * 60e3));
  }
  for (const t of timers) t.unref();

  // 起動のとき: (データがなければ) バックアップから戻す → 動かしていた bot をまた動かす
  const init = async () => {
    if (backup.enabled) {
      try {
        if (await backup.restoreWithRetry(dbFile, cfg.restoreRetry)) console.log(`GitHub (${backup.repo || 'git'}) のバックアップから戻しました`);
      } catch (e) {
        console.error(`バックアップから戻せませんでした: ${backup.status.lastError}`);
      }
      // 止めている間に GitHub から戻せたら、動かしていた bot をまた動かす
      backup.onRestored = () => { console.log('GitHub のバックアップから戻しました'); resume(); };
      backup.start();
      // 繋がるかを確かめてログに出す (待たない)
      backup.check().then((ok) => console.log(ok
        ? `バックアップ: GitHub (${backup.repo || backup.gitUrl}) に繋がりました (${backup.method === 'git' ? 'デプロイキー' : 'トークン'})`
        : `バックアップ: GitHub に繋がりません: ${backup.status.lastError}`));
    }
    resume();
  };

  // 動かしていた bot をまた動かす。一度に動かすとメモリと CPU が足りなくなるので、少しずつずらす
  const resume = () => {
    auth.pruneSessions(store);
    // 前の版で作った bot にも、待ち受ける番号 (PORT) を決める
    let changed = false;
    for (const b of store.bots) if (assignPort(b)) changed = true;
    if (changed) store.save();
    const list = store.bots.filter((b) => b.desired === 'running' && !runner.isActive(b.id));
    list.forEach((bot, i) => {
      const t = setTimeout(() => {
        if (bot.desired !== 'running' || !findBot(bot.id) || runner.isActive(bot.id)) return;
        runner.sys(bot.id, 'サーバーが起動したので、bot を起動します。');
        runner.start(bot);
      }, i * cfg.resumeGapMs);
      t.unref();
    });
  };

  const shutdown = async () => {
    for (const t of timers) clearInterval(t);
    await runner.stopAll();
    runner.close();
    store.flush();
    backup.stop();
    if (backup.enabled && backup.dirty && !backup.blocked) {
      await Promise.race([backup.run().catch(() => {}), new Promise((r) => setTimeout(r, 20e3))]);
    }
    for (const set of [...listeners.values(), ...userStreams.values()]) for (const res of set) res.end();
    for (const sock of upgraded) sock.destroy();
    await new Promise((r) => server.close(() => r()));
  };

  return { server, store, runner, backup, cfg, init, resume, shutdown };
}

if (require.main === module) {
  process.on('uncaughtException', (e) => console.error('予期しないエラー (続けます):', e));
  process.on('unhandledRejection', (e) => console.error('予期しないエラー (続けます):', e));
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  app.init().then(() => {
    app.server.listen(port, host, () => {
      console.log(`BotHost ${VERSION}: http://localhost:${port}  (モード: ${app.cfg.mode}, データ: ${app.cfg.dataDir})`);
      if (app.backup.enabled) console.log(`バックアップ: GitHub ${app.backup.repo}`);
      if (app.cfg.keepAwakeUrl) console.log(`眠らせない: ${app.cfg.keepAwakeUrl}`);
      if (app.cfg.mode === 'process') {
        console.log('注意: process モードでは bot がこのマシンでそのまま動きます。知らない人に使わせるなら BOTHOST_MODE=docker にしてください。');
      }
    });
  });
  let closing = false;
  const onSignal = async () => {
    if (closing) process.exit(1);
    closing = true;
    console.log('止めています… (bot も止めます。次に起動したときにまた動かします)');
    // 止めるときは desired を変えないので、次の起動で再開されます
    await app.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

module.exports = { createApp };

'use strict';
// BotHost — Discord などの bot を 24 時間動かしておくためのサーバー
//   node server.js            → http://localhost:3000
// 設定は環境変数で (README.md を参照)。
const http = require('http');
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
const { Runner, RUNTIMES } = require('./lib/runner');

const ROOT = __dirname;
const VERSION = require('./package.json').version;
const TEMPLATES = {
  'python-discord': { runtime: 'python', label: 'Discord bot (Python)', desc: '!ping に返事をする bot (discord.py)' },
  'python-discord-slash': { runtime: 'python', label: 'スラッシュコマンド (Python)', desc: '/ping /dice など。特別な権限が要らない' },
  'node-discord': { runtime: 'node', label: 'Discord bot (Node.js)', desc: '!ping に返事をする bot (discord.js)' },
  'python-blank': { runtime: 'python', label: '空の Python', desc: 'main.py だけ' },
  'node-blank': { runtime: 'node', label: '空の Node.js', desc: 'index.js だけ' },
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function createApp(config = {}) {
  const env = process.env;
  const cfg = {
    dataDir: path.resolve(config.dataDir || env.BOTHOST_DATA || path.join(ROOT, 'data')),
    mode: config.mode || env.BOTHOST_MODE || 'process',
    registration: config.registration || env.BOTHOST_REGISTRATION || 'first-only', // open | first-only
    maxBotsPerUser: Number(config.maxBotsPerUser || env.BOTHOST_MAX_BOTS || 5),
    maxDiskMB: Number(config.maxDiskMB || env.BOTHOST_MAX_DISK_MB || 500),
    secureCookie: config.secureCookie ?? env.BOTHOST_SECURE_COOKIE === '1',
    python: config.python || env.BOTHOST_PYTHON || 'python3',
    stopTimeoutMs: config.stopTimeoutMs,
    statsIntervalMs: config.statsIntervalMs,
    crashLimit: config.crashLimit,
    restartBackoffMs: config.restartBackoffMs,
    restoreRetry: config.restoreRetry,
    discordApi: config.discordApi,
    trustProxy: config.trustProxy ?? (env.BOTHOST_TRUST_PROXY === '1' || !!env.RENDER),
    keepAwakeUrl: config.keepAwakeUrl ?? (env.BOTHOST_KEEP_AWAKE === '0' ? '' : (env.BOTHOST_KEEP_AWAKE_URL || env.RENDER_EXTERNAL_URL || '')),
    backup: config.backup || {
      repo: env.BOTHOST_BACKUP_REPO, token: env.BOTHOST_BACKUP_TOKEN, sshKey: env.BOTHOST_BACKUP_SSH_KEY,
      branch: env.BOTHOST_BACKUP_BRANCH, file: env.BOTHOST_BACKUP_FILE,
    },
  };
  const botsDir = path.join(cfg.dataDir, 'bots');
  fs.mkdirSync(botsDir, { recursive: true });
  const dbFile = path.join(cfg.dataDir, 'db.json');

  const store = new Store(dbFile);
  const backup = new Backup({ store, botsDir, ...cfg.backup });
  store.onSave = () => backup.markDirty();
  const runner = new Runner({
    botsDir, mode: cfg.mode, python: cfg.python,
    logsDir: path.join(cfg.dataDir, 'logs'), pidsFile: path.join(cfg.dataDir, 'pids.json'),
    stopTimeoutMs: cfg.stopTimeoutMs, statsIntervalMs: cfg.statsIntervalMs, crashLimit: cfg.crashLimit,
    initialBackoffMs: cfg.restartBackoffMs,
  });
  const findBot = (id) => store.bots.find((b) => b.id === id);
  runner.getBot = findBot;
  const timers = [];

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
  runner.on('status', (id, info) => sse(id, 'status', info));
  runner.on('stats', (id, stats) => {
    const h = runner.history(id);
    sse(id, 'stats', { ...stats, point: h[h.length - 1] });
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
  const maskEnv = (e) => Object.fromEntries(Object.keys(e || {}).map((k) => [k, true]));
  const publicBot = (b) => ({
    id: b.id, name: b.name, runtime: b.runtime, template: b.template,
    startCommand: b.startCommand, autoRestart: b.autoRestart, keepRunning: b.desired === 'running',
    memoryLimitMB: b.memoryLimitMB, cpuLimit: b.cpuLimit, restartEveryHours: b.restartEveryHours || 0,
    notify: !!b.notifyWebhook, discord: b.discord || null,
    crashCount: b.crashCount || 0, lastCrashAt: b.lastCrashAt || null,
    env: maskEnv(b.env), createdAt: b.createdAt, ownerId: b.ownerId,
    ...runner.info(b.id),
  });

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

  const checkDisk = () => {
    const mb = files.dirSize(botsDir) / 1048576;
    if (mb > cfg.maxDiskMB) fail(507, 'サーバーの保存容量がいっぱいです');
  };

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
      backup: b.enabled ? { method: b.method, connected: b.connected, lastAt: b.lastAt, ok: !b.lastError && !b.blocked } : null,
    };
  }, { auth: false });

  route('GET', '/api/config', async () => ({
    version: VERSION,
    mode: cfg.mode,
    registrationOpen: registrationOpen(),
    firstUser: store.users.length === 0,
    templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })),
    runtimes: Object.fromEntries(Object.entries(RUNTIMES).map(([k, v]) => [k, { defaultCommand: v.defaultCommand }])),
    maxBotsPerUser: cfg.maxBotsPerUser,
  }), { auth: false });

  route('POST', '/api/register', async ({ req, res, ip }) => {
    if (!registrationOpen()) fail(403, '新しい登録は受け付けていません。管理者に頼んでください');
    if (!auth.allowAttempt(ip)) fail(429, '少し時間をおいてからもう一度お試しください');
    const { username, password } = await readJson(req);
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
    if (!auth.allowAttempt(ip)) fail(429, '少し時間をおいてからもう一度お試しください');
    const { username, password } = await readJson(req);
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

  route('POST', '/api/me/password', async ({ req, user }) => {
    const { current, next } = await readJson(req);
    if (typeof current !== 'string' || !auth.verifyPassword(current, user.password)) fail(400, '今のパスワードが違います');
    if (typeof next !== 'string' || next.length < 8) fail(400, '新しいパスワードは 8 文字以上にしてください');
    user.password = auth.hashPassword(next);
    store.save();
    return { ok: true };
  });

  // ----- 管理者 -----
  route('GET', '/api/admin', async () => ({
    users: store.users.map((u) => ({ ...publicUser(u), bots: store.bots.filter((b) => b.ownerId === u.id).length })),
    settings: { registrationOpen: registrationOpen() },
    backup: backup.info(),
    keepAwake: cfg.keepAwakeUrl || null,
    server: {
      version: VERSION, mode: cfg.mode, uptime: Math.round(process.uptime()),
      node: process.version, memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      diskMB: Math.round(files.dirSize(botsDir) / 1048576 * 10) / 10, maxDiskMB: cfg.maxDiskMB,
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
    const runtime = template ? TEMPLATES[template].runtime : (RUNTIMES[body.runtime] ? body.runtime : 'python');
    const bot = {
      id: auth.newId(6), ownerId: user.id, name, runtime, template,
      startCommand: RUNTIMES[runtime].defaultCommand,
      env: {}, autoRestart: true, desired: 'stopped',
      memoryLimitMB: 256, cpuLimit: 0.5, restartEveryHours: 0, createdAt: Date.now(),
    };
    files.copyTemplate(template && path.join(ROOT, 'templates', template), runner.dir(bot.id));
    store.bots.push(bot);
    store.save();
    return { bot: publicBot(bot) };
  });

  route('GET', '/api/bots/:id', async ({ user, params }) => ({ bot: publicBot(ownedBot(user, params.id)) }));

  route('PATCH', '/api/bots/:id', async ({ req, user, params }) => {
    const bot = ownedBot(user, params.id);
    const body = await readJson(req);
    if (body.name !== undefined) bot.name = validName(body.name);
    if (body.startCommand !== undefined) {
      const c = String(body.startCommand).trim();
      if (!c || c.length > 300) fail(400, '起動コマンドは 1〜300 文字にしてください');
      bot.startCommand = c;
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
    return { bot: publicBot(bot) };
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
    set.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
    req.on('close', () => { clearInterval(ping); set.delete(res); });
    return undefined; // 開いたまま
  });

  // ----- ファイル -----
  route('GET', '/api/bots/:id/files', async ({ user, params }) => files.list(runner.dir(ownedBot(user, params.id).id)));

  route('GET', '/api/bots/:id/file', async ({ res, user, params, query }) => {
    const bot = ownedBot(user, params.id);
    let buf;
    try { buf = files.read(runner.dir(bot.id), query.get('path')); } catch (e) {
      if (e.code === 'ENOENT') fail(404, 'ファイルがありません');
      if (e.code === 'EISDIR') fail(400, 'フォルダーです');
      throw e;
    }
    send(res, 200, buf, { 'Content-Type': 'application/octet-stream' });
  });

  route('PUT', '/api/bots/:id/file', async ({ req, user, params, query }) => {
    const bot = ownedBot(user, params.id);
    checkDisk();
    const buf = await readBody(req, 10 * 1024 * 1024);
    files.write(runner.dir(bot.id), query.get('path'), buf);
    backup.markDirty();
    return { ok: true };
  });

  route('DELETE', '/api/bots/:id/file', async ({ user, params, query }) => {
    const bot = ownedBot(user, params.id);
    files.remove(runner.dir(bot.id), query.get('path'));
    backup.markDirty();
    return { ok: true };
  });

  route('POST', '/api/bots/:id/rename', async ({ req, user, params }) => {
    const bot = ownedBot(user, params.id);
    const { from, to } = await readJson(req);
    files.rename(runner.dir(bot.id), from, to);
    backup.markDirty();
    return { ok: true };
  });

  route('GET', '/api/bots/:id/export', async ({ res, user, params }) => {
    const bot = ownedBot(user, params.id);
    const buf = zip.createZip(files.collect(runner.dir(bot.id)));
    const safe = bot.name.replace(/[^\w.-]+/g, '_') || 'bot';
    send(res, 200, buf, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safe}.zip"; filename*=UTF-8''${encodeURIComponent(bot.name)}.zip`,
    });
  });

  route('POST', '/api/bots/:id/import', async ({ req, user, params, query }) => {
    const bot = ownedBot(user, params.id);
    checkDisk();
    const buf = await readBody(req, 30 * 1024 * 1024);
    let entries;
    try { entries = zip.readZip(buf, { maxTotal: 100 * 1024 * 1024 }); } catch (e) {
      fail(400, e instanceof zip.ZipError ? e.message : 'ZIP を読めませんでした');
    }
    const count = files.importEntries(runner.dir(bot.id), entries, { replace: query.get('replace') === '1' });
    backup.markDirty();
    return { count };
  });

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
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.discordapp.com; frame-ancestors 'none'",
    };
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); return res.end(); }
    const gzip = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : (gzip ? f.gz : f.body));
  };

  const handler = async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Bad Request'); }
    // リバースプロキシ (Render など) の後ろでは、本当の IP は X-Forwarded-For に入っています
    const ip = (cfg.trustProxy && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
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
      const status = e instanceof HttpError ? e.status : e instanceof files.PathError ? 400 : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'サーバーでエラーが起きました' : e.message });
      else res.end();
    }
  };

  const server = http.createServer((req, res) => { handler(req, res); });
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

  // 眠らせない: Render の無料プランなどは、外からアクセスがないと 15 分で止まるので、
  // bot を動かしている間は自分の公開 URL に 10 分ごとにアクセスします
  if (cfg.keepAwakeUrl) {
    timers.push(setInterval(() => {
      if (!store.bots.some((b) => b.desired === 'running')) return;
      fetch(cfg.keepAwakeUrl.replace(/\/$/, '') + '/api/health', { signal: AbortSignal.timeout(15000) }).catch(() => {});
    }, 10 * 60e3));
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

  const resume = () => {
    auth.pruneSessions(store);
    for (const bot of store.bots) {
      if (bot.desired === 'running') {
        runner.sys(bot.id, 'サーバーが起動したので、bot を起動します。');
        runner.start(bot);
      }
    }
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
    for (const set of listeners.values()) for (const res of set) res.end();
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

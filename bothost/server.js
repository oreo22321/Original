'use strict';
// BotHost — Discord などの bot を 24 時間動かしておくためのサーバー
//   node server.js            → http://localhost:3000
// 設定は環境変数で (README.md を参照)。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { Store } = require('./lib/store');
const auth = require('./lib/auth');
const files = require('./lib/files');
const { Runner, RUNTIMES } = require('./lib/runner');

const ROOT = __dirname;
const TEMPLATES = {
  'python-discord': { runtime: 'python', label: 'Discord bot (Python / discord.py)' },
  'node-discord': { runtime: 'node', label: 'Discord bot (Node.js / discord.js)' },
  'python-blank': { runtime: 'python', label: '空の Python' },
  'node-blank': { runtime: 'node', label: '空の Node.js' },
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function createApp(config = {}) {
  const cfg = {
    dataDir: path.resolve(config.dataDir || process.env.BOTHOST_DATA || path.join(ROOT, 'data')),
    mode: config.mode || process.env.BOTHOST_MODE || 'process',
    registration: config.registration || process.env.BOTHOST_REGISTRATION || 'open', // open | first-only
    maxBotsPerUser: Number(config.maxBotsPerUser || process.env.BOTHOST_MAX_BOTS || 5),
    maxDiskMB: Number(config.maxDiskMB || process.env.BOTHOST_MAX_DISK_MB || 500),
    secureCookie: config.secureCookie ?? process.env.BOTHOST_SECURE_COOKIE === '1',
    python: config.python || process.env.BOTHOST_PYTHON || 'python3',
    stopTimeoutMs: config.stopTimeoutMs,
    statsIntervalMs: config.statsIntervalMs,
  };
  const botsDir = path.join(cfg.dataDir, 'bots');
  fs.mkdirSync(botsDir, { recursive: true });

  const store = new Store(path.join(cfg.dataDir, 'db.json'));
  const runner = new Runner({
    botsDir, mode: cfg.mode, python: cfg.python,
    stopTimeoutMs: cfg.stopTimeoutMs, statsIntervalMs: cfg.statsIntervalMs,
  });
  const findBot = (id) => store.bots.find((b) => b.id === id);
  runner.getBot = findBot;

  // ----- リアルタイム (Server-Sent Events) -----
  const listeners = new Map(); // botId -> Set(res)
  const sse = (id, event, data) => {
    const set = listeners.get(id);
    if (!set) return;
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(msg);
  };
  runner.on('log', (id, entry) => sse(id, 'log', entry));
  runner.on('status', (id, info) => sse(id, 'status', info));
  runner.on('stats', (id, stats) => sse(id, 'stats', stats));
  runner.on('exit', (id, { manual }) => {
    const bot = findBot(id);
    if (bot && !manual) { bot.lastCrashAt = Date.now(); store.save(); }
  });

  // ----- 共通 -----
  const send = (res, status, body, headers = {}) => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
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
      if (size > limit) { reject(new HttpError(413, 'データが大きすぎます')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const readJson = async (req) => {
    const buf = await readBody(req, 256 * 1024);
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); } catch { fail(400, 'JSON が正しくありません'); }
  };

  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
  const sessionCookie = (token, maxAge) =>
    `bothost_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.secureCookie ? '; Secure' : ''}`;

  const publicUser = (u) => ({ id: u.id, username: u.username, admin: !!u.admin, createdAt: u.createdAt });
  const maskEnv = (env) => Object.fromEntries(Object.keys(env || {}).map((k) => [k, true]));
  const publicBot = (b) => ({
    id: b.id, name: b.name, runtime: b.runtime, template: b.template,
    startCommand: b.startCommand, autoRestart: b.autoRestart, keepRunning: b.desired === 'running',
    memoryLimitMB: b.memoryLimitMB, cpuLimit: b.cpuLimit,
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

  // ----- ルート -----
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, auth: opts.auth !== false });
  };

  route('GET', '/api/config', async () => ({
    mode: cfg.mode,
    registrationOpen: cfg.registration === 'open' || store.users.length === 0,
    templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })),
    runtimes: Object.fromEntries(Object.entries(RUNTIMES).map(([k, v]) => [k, { defaultCommand: v.defaultCommand }])),
    maxBotsPerUser: cfg.maxBotsPerUser,
  }), { auth: false });

  route('POST', '/api/register', async ({ req, res, ip }) => {
    if (!(cfg.registration === 'open' || store.users.length === 0)) fail(403, '新しい登録は受け付けていません');
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
      memoryLimitMB: 256, cpuLimit: 0.5, createdAt: Date.now(),
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
    if (body.env && typeof body.env === 'object') {
      bot.env = bot.env || {};
      for (const [k, v] of Object.entries(body.env)) {
        if (!ENV_KEY.test(k)) fail(400, `環境変数の名前「${k}」は使えません (半角英数字と _ で、数字から始めない)`);
        if (v === null) delete bot.env[k];
        else if (typeof v === 'string') {
          if (v.length > 4096) fail(400, '環境変数の値が長すぎます');
          bot.env[k] = v;
        }
      }
      if (Object.keys(bot.env).length > 50) fail(400, '環境変数は 50 個までです');
    }
    store.save();
    return { bot: publicBot(bot) };
  });

  route('DELETE', '/api/bots/:id', async ({ user, params }) => {
    const bot = ownedBot(user, params.id);
    await runner.stop(bot.id);
    store.data.bots = store.bots.filter((b) => b !== bot);
    store.save();
    fs.rmSync(runner.dir(bot.id), { recursive: true, force: true });
    runner.states.delete(bot.id);
    return { ok: true };
  });

  const checkDisk = () => {
    const mb = files.dirSize(botsDir) / 1048576;
    if (mb > cfg.maxDiskMB) fail(507, 'サーバーの保存容量がいっぱいです');
  };

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

  route('GET', '/api/bots/:id/events', async ({ req, res, user, params }) => {
    const bot = ownedBot(user, params.id);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: init\ndata: ${JSON.stringify({ ...runner.info(bot.id), logs: runner.logs(bot.id) })}\n\n`);
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
    return undefined;
  });

  route('PUT', '/api/bots/:id/file', async ({ req, user, params, query }) => {
    const bot = ownedBot(user, params.id);
    checkDisk();
    const buf = await readBody(req, 10 * 1024 * 1024);
    files.write(runner.dir(bot.id), query.get('path'), buf);
    return { ok: true };
  });

  route('DELETE', '/api/bots/:id/file', async ({ user, params, query }) => {
    const bot = ownedBot(user, params.id);
    files.remove(runner.dir(bot.id), query.get('path'));
    return { ok: true };
  });

  route('POST', '/api/bots/:id/rename', async ({ req, user, params }) => {
    const bot = ownedBot(user, params.id);
    const { from, to } = await readJson(req);
    files.rename(runner.dir(bot.id), from, to);
    return { ok: true };
  });

  // ----- 画面 (public/ の静的ファイル) -----
  const serveStatic = (req, res, pathname) => {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const full = path.resolve(ROOT, 'public', rel);
    const pub = path.join(ROOT, 'public');
    let target = full.startsWith(pub + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile()
      ? full : path.join(pub, 'index.html');
    if (path.extname(rel) && target.endsWith('index.html') && rel !== 'index.html') {
      return send(res, 404, 'Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    });
    fs.createReadStream(target).pipe(res);
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const ip = req.socket.remoteAddress || '';
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
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        let user = null;
        if (r.auth) {
          user = auth.getSessionUser(store, cookies(req).bothost_session);
          if (!user) fail(401, 'ログインしてください');
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

  // サーバーを再起動したら、動かしていた bot をまた動かします
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
    await runner.stopAll();
    store.flush();
    clearInterval(runner.statsTimer);
    for (const set of listeners.values()) for (const res of set) res.end();
    await new Promise((r) => server.close(() => r()));
  };

  return { server, store, runner, cfg, resume, shutdown };
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  app.server.listen(port, host, () => {
    console.log(`BotHost: http://localhost:${port}  (モード: ${app.cfg.mode}, データ: ${app.cfg.dataDir})`);
    if (app.cfg.mode === 'process') {
      console.log('注意: process モードでは bot がこのマシンでそのまま動きます。知らない人に使わせるなら BOTHOST_MODE=docker にしてください。');
    }
    app.resume();
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

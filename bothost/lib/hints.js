'use strict';
// bot が止まったときに、ログからよくある原因を見つけて、直し方をわかる言葉で伝えます。
// また、bot のコードが使っている環境変数 (os.getenv("TOKEN") など) を見つけます。
const fs = require('fs');
const path = require('path');

// ----- コードが使っている環境変数 -----
const ENV_PATTERNS = [
  /os\.getenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, // Python
  /os\.environ\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
  /os\.environ\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /\bgetenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, // Python (from os import getenv)・PHP
  /\benviron\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, // Node.js
  /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /(?:Bun|import\.meta)\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /Deno\.env\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
  /\bENV(?:\.fetch\(\s*|\[\s*)['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, // Ruby
  /\$_ENV\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g, // PHP
  /System\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g, // Java
  /Environment\.GetEnvironmentVariable\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g, // C#
  /os\.Getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g, // Go
];
// BotHost やシステムが入れるもの (自分で入れなくてよい)
const SYSTEM_ENV = new Set(['PORT', 'PATH', 'HOME', 'USER', 'PWD', 'SHELL', 'TERM', 'LANG', 'TZ', 'NODE_ENV', 'PYTHONPATH', 'BOT_ID', 'BOT_NAME',
  'DEBUG', 'CI', 'HOSTNAME', 'TMPDIR', 'TEMP', 'TMP', 'APPDATA', 'USERPROFILE', 'LOCALAPPDATA', 'PYTHONUNBUFFERED', 'FORCE_COLOR', 'NO_COLOR',
  'REPL_ID', 'REPL_SLUG', 'REPL_OWNER', 'REPLIT_DB_URL', 'RENDER', 'RENDER_EXTERNAL_URL', 'VERCEL', 'HEROKU', 'DYNO', 'COLUMNS', 'LINES']);
const SCAN_EXT = /\.(py|js|mjs|cjs|ts|mts|rb|php|java|kt|cs|go)$/i;
const SKIP = new Set(['node_modules', '.deps', '.git', '.wine', '.cache', '.npm', '.local', '.gems', 'vendor', '__pycache__', '.npm-global', 'dist', 'build', 'out', 'bin', 'obj', 'target']);

function scanEnv(dir) {
  const used = new Set();
  let budget = 300;
  const walk = (d, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (--budget < 0) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(full, depth + 1); continue; }
      if (!e.isFile() || !SCAN_EXT.test(e.name)) continue;
      let text;
      try { if (fs.statSync(full).size > 512 * 1024) continue; text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      for (const re of ENV_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) if (!SYSTEM_ENV.has(m[1]) && !m[1].startsWith('BOTHOST_') && !m[1].startsWith('npm_')) used.add(m[1]);
      }
    }
  };
  walk(dir, 0);
  // .env ファイル (python-dotenv・dotenv) に書いてあるもの
  const dotenv = new Map();
  try {
    for (const line of fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) dotenv.set(m[1], m[2].replace(/^(['"])(.*)\1$/, '$2').trim() !== '');
    }
  } catch { /* .env はない */ }
  return { used: [...used].sort(), dotenv };
}

// 入っていない環境変数 (BotHost にも .env にもない)
function missingEnv(dir, botEnv) {
  const { used, dotenv } = scanEnv(dir);
  return used.filter((k) => !(botEnv && botEnv[k]) && !dotenv.get(k));
}

// ----- ログから原因を見つける -----
// Python のモジュール名 → pip で入れるときの名前
const PIP_NAME = {
  discord: 'discord.py', dotenv: 'python-dotenv', yaml: 'pyyaml', PIL: 'pillow', cv2: 'opencv-python-headless', bs4: 'beautifulsoup4',
  sklearn: 'scikit-learn', nacl: 'PyNaCl', dateutil: 'python-dateutil', telegram: 'python-telegram-bot', linebot: 'line-bot-sdk',
  googleapiclient: 'google-api-python-client', jwt: 'PyJWT', Crypto: 'pycryptodome', serial: 'pyserial', yt_dlp: 'yt-dlp', MySQLdb: 'mysqlclient',
  psycopg2: 'psycopg2-binary', slack_bolt: 'slack_bolt', openai: 'openai', aiohttp: 'aiohttp', requests: 'requests', flask: 'flask',
};

const NODE_BUILTIN = new Set(require('module').builtinModules);

function diagnose(text, { bot, dir } = {}) {
  const env = (bot && bot.env) || {};
  let m;
  // Discord のトークンが正しくない
  if (/LoginFailure: Improper token|TokenInvalid|An invalid token was provided|Incorrect login details/i.test(text) || (/401: Unauthorized|401 Unauthorized/.test(text) && /discord/i.test(text))) {
    const { used, dotenv } = dir ? scanEnv(dir) : { used: [], dotenv: new Map() };
    const tokenNames = used.filter((k) => /TOKEN/i.test(k));
    const missing = tokenNames.filter((k) => !env[k] && !dotenv.get(k));
    if (missing.length) {
      return { fatal: true, text: `bot のコードは環境変数 ${missing.join('・')} からトークンを読んでいますが、まだ入っていません。設定タブの「Discord」にトークンを入れて「保存して確認」を押すか、「環境変数」に ${missing[0]} という名前で入れてから起動してください。` };
    }
    if (!tokenNames.length && !env.DISCORD_TOKEN) {
      return { fatal: true, text: 'Discord のトークンが入っていないか、正しくありません。設定タブの「Discord」にトークンを入れて「保存して確認」を押してから起動してください。コードが config.json などのファイルからトークンを読んでいるなら、そのファイルのトークンを新しくしてください。' };
    }
    return {
      fatal: true,
      text: 'Discord が「トークンが正しくない」と断りました。トークンが古い (Reset Token した・Discord が自動で無効にした) か、コピーが途中で切れています。'
        + 'Discord Developer Portal の「Bot」→「Reset Token」で新しいトークンを出し、設定タブの「Discord」に貼って「保存して確認」を押してから起動してください。'
        + 'コードが .env や config.json からトークンを読んでいるなら、そのファイルのトークンも新しくしてください。',
    };
  }
  // 特別な権限 (Intents) がオフ
  if (/PrivilegedIntentsRequired|disallowed intents|Disallowed intent|4014/i.test(text)) {
    return { fatal: true, text: 'bot が使う特別な権限 (Privileged Gateway Intents) がオフです。Discord Developer Portal の「Bot」で、MESSAGE CONTENT INTENT (と、使っていれば SERVER MEMBERS・PRESENCE) をオンにして保存してから、もう一度起動してください。' };
  }
  // Python のライブラリがない
  if ((m = text.match(/ModuleNotFoundError: No module named '([\w.]+)'/))) {
    const mod = m[1].split('.')[0];
    const pkg = PIP_NAME[mod] || mod;
    const hasReq = dir && fs.existsSync(path.join(dir, 'requirements.txt'));
    // 名前がわかっているものだけ、ボタン 1 つで足せるようにする (似た名前の別物を入れないように)
    const known = Object.prototype.hasOwnProperty.call(PIP_NAME, mod);
    return {
      fatal: true,
      text: `Python のライブラリ「${mod}」が入っていません。${hasReq ? 'requirements.txt に' : 'requirements.txt というファイルを作って、'}「${pkg}」と 1 行書いてから起動してください (起動の前に自動で入れます)。`,
      action: known ? { kind: 'pip', pkg } : null,
    };
  }
  // Node.js のライブラリがない
  if ((m = text.match(/Cannot find module '([^']+)'/)) && !m[1].startsWith('.') && !m[1].startsWith('/')) {
    const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
    return {
      fatal: true,
      text: `Node.js のライブラリ「${name}」が入っていません。package.json の dependencies に「"${name}": "*"」のように書いてから起動してください (起動の前に自動で入れます)。`,
      action: /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name) && !NODE_BUILTIN.has(name) ? { kind: 'npm', pkg: name } : null,
    };
  }
  // 環境変数がない
  if ((m = text.match(/KeyError: '([A-Za-z_][A-Za-z0-9_]*)'/)) && /environ/.test(text)) {
    return { fatal: true, text: `環境変数 ${m[1]} が入っていません。設定タブの「環境変数」に ${m[1]} を入れてから起動してください。` };
  }
  if (/AttributeError: 'NoneType' object has no attribute 'strip'/.test(text) && /discord/.test(text)) {
    const missing = dir ? missingEnv(dir, env) : [];
    return { fatal: true, text: `トークンが空です (None)。${missing.length ? `コードは環境変数 ${missing.join('・')} を読んでいます。設定タブの「環境変数」に入れてください。` : '設定タブの「環境変数」に、コードが読む名前でトークンを入れてください。'}` };
  }
  // 待ち受ける番号が重なっている
  if (/EADDRINUSE|Address already in use/i.test(text)) {
    return { fatal: false, text: `待ち受ける番号がほかと重なっています。Web サーバーは、環境変数 PORT の番号${bot && bot.port ? ` (${bot.port})` : ''}で待ち受けるようにしてください。` };
  }
  // 文法の間違い
  if (/SyntaxError|IndentationError|TabError/.test(text) && /File "|\.js:\d+|\.ts:\d+/.test(text)) {
    return { fatal: true, text: 'コードに書き間違い (文法の間違い) があります。ログに出ているファイル名と行番号のところを直してください。' };
  }
  return null;
}

// Discord の bot か (ライブラリやコードから)
function usesDiscord(dir) {
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  if (/^\s*(discord(\.py)?|py-cord|nextcord|disnake|interactions\.py|hikari)\b/im.test(read('requirements.txt'))) return true;
  if (/"(discord\.js|eris|oceanic\.js|discordx|@discordjs\/core)"/.test(read('package.json'))) return true;
  if (/discord|nextcord|disnake/i.test(read('pyproject.toml'))) return true;
  let found = false;
  let budget = 60;
  const walk = (d, depth) => {
    if (found || depth > 2) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found || --budget < 0) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(full, depth + 1); continue; }
      if (!/\.(py|js|mjs|cjs|ts)$/i.test(e.name)) continue;
      let text = '';
      try { if (fs.statSync(full).size < 512 * 1024) text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (/^\s*(import|from)\s+(discord|nextcord|disnake)\b|require\(\s*['"]discord\.js['"]\s*\)|from\s+['"]discord\.js['"]/m.test(text)) found = true;
    }
  };
  walk(dir, 0);
  return found;
}

module.exports = { scanEnv, missingEnv, diagnose, usesDiscord };

'use strict';
// BotHost の画面 (フレームワークなし)

// ---------- 小さな道具 ----------
const $app = document.getElementById('app');

function h(tag, attrs, ...children) {
  const svg = tag.startsWith('svg:');
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// 中身を入れ替える (配列は展開し、null / false は飛ばす)
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
}

async function api(method, url, body, { raw = false } = {}) {
  const opts = { method, headers: { 'X-BotHost': '1' }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer || typeof body === 'string') {
      opts.body = body;
      opts.headers['Content-Type'] = 'application/octet-stream';
    } else {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error('サーバーに繋がりません。ネットワークを確かめてください');
  }
  if (!res.ok) {
    let msg = `エラー (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* JSON ではない */ }
    if (res.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/register')) {
      state.user = null;
      go('#/login');
    }
    throw new Error(msg);
  }
  if (raw) return res;
  const type = res.headers.get('Content-Type') || '';
  return type.includes('json') ? res.json() : res.text();
}

function toast(msg, bad = false) {
  const el = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: bad ? 'alert' : 'status' }, msg);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), bad ? 5000 : 2600);
}

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

function download(url) {
  const a = h('a', { href: url, download: '' });
  document.body.append(a); a.click(); a.remove();
}

const STATUS_LABEL = {
  running: '動作中', stopped: '停止中', installing: '準備中', restarting: '再起動待ち', crashed: 'エラーで停止',
};
const RUNTIME_LABEL = { python: 'Python', node: 'Node.js' };
const ACTIVE = ['running', 'installing', 'restarting'];

function pill(status) {
  return h('span', { class: `pill ${status}` }, STATUS_LABEL[status] || status);
}

function dur(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const hh = Math.floor(s / 3600); s -= hh * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}日 ${hh}時間`;
  if (hh) return `${hh}時間 ${m}分`;
  if (m) return `${m}分 ${s}秒`;
  return `${s}秒`;
}
const uptime = (startedAt) => (startedAt ? dur(Date.now() - startedAt) : '—');

function ago(t) {
  if (!t) return '—';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)} 分前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 時間前`;
  return new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function modal(title, body, foot) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); back.dispatchEvent(new Event('closed')); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.append(h('div', { class: 'modal card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', {}, title), body, h('div', { class: 'foot' }, foot(close))));
  document.body.append(back);
  const first = back.querySelector('input, textarea, select');
  if (first) first.focus();
  close.el = back;
  return close;
}

function confirmBox(title, text, okLabel, danger = true) {
  return new Promise((resolve) => {
    let ok = false;
    const close = modal(title, h('p', {}, text), (c) => [
      h('button', { class: 'btn', onclick: c }, 'やめる'),
      h('button', { class: 'btn ' + (danger ? 'danger solid' : 'primary'), onclick: () => { ok = true; c(); } }, okLabel),
    ]);
    close.el.addEventListener('closed', () => resolve(ok));
  });
}

// 3 つから選ぶ (選ばずに閉じたら null)
function choiceBox(title, text, choices) {
  return new Promise((resolve) => {
    let picked = null;
    const close = modal(title, h('p', {}, text), (c) => [
      h('button', { class: 'btn', onclick: c }, 'やめる'),
      ...choices.map((ch) => h('button', { class: 'btn ' + (ch.primary ? 'primary' : ''), onclick: () => { picked = ch.value; c(); } }, ch.label)),
    ]);
    close.el.addEventListener('closed', () => resolve(picked));
  });
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: 'display:none' });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// ---------- ANSI の色 (ログ) ----------
const ANSI16 = ['#4d5566', '#ff7b72', '#7ee787', '#e3b341', '#79c0ff', '#d2a8ff', '#76e3ea', '#d7dae2',
  '#6e7681', '#ffa198', '#a5f3a7', '#f0d36b', '#a5d6ff', '#e2c5ff', '#b3f0ff', '#ffffff'];
function ansi256(n) {
  if (n < 16) return ANSI16[n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
  n -= 16;
  const c = (x) => (x ? 55 + x * 40 : 0);
  return `rgb(${c(Math.floor(n / 36))},${c(Math.floor(n / 6) % 6)},${c(n % 6)})`;
}
function ansiNodes(text) {
  if (!text.includes('\x1b[')) return [text];
  const out = [];
  let style = {};
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  const pushText = (t) => {
    if (!t) return;
    const css = [];
    if (style.fg) css.push(`color:${style.fg}`);
    if (style.bold) css.push('font-weight:700');
    if (style.dim) css.push('opacity:.7');
    if (style.italic) css.push('font-style:italic');
    if (style.underline) css.push('text-decoration:underline');
    out.push(css.length ? h('span', { style: css.join(';') }, t) : t);
  };
  while ((m = re.exec(text))) {
    pushText(text.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = {};
      else if (c === 1) style.bold = true;
      else if (c === 2) style.dim = true;
      else if (c === 3) style.italic = true;
      else if (c === 4) style.underline = true;
      else if (c === 22) { style.bold = false; style.dim = false; } else if (c === 23) style.italic = false;
      else if (c === 24) style.underline = false;
      else if (c >= 30 && c <= 37) style.fg = ANSI16[c - 30];
      else if (c >= 90 && c <= 97) style.fg = ANSI16[c - 90 + 8];
      else if (c === 39) style.fg = null;
      else if (c === 38 && codes[i + 1] === 5) { style.fg = ansi256(codes[i + 2] || 0); i += 2; } else if (c === 38 && codes[i + 1] === 2) {
        style.fg = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`; i += 4;
      } else if (c === 48 && codes[i + 1] === 5) i += 2;
      else if (c === 48 && codes[i + 1] === 2) i += 4;
    }
  }
  pushText(text.slice(last));
  return out;
}
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// ---------- コードの色分け (Python / JavaScript / JSON) ----------
const HL = {
  python: /(#[^\n]*)|((?:\b[rbfuRBFU]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(@[\w.]+)|\b(\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?j?|0[xX][\da-fA-F_]+)\b|\b(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case|self)\b|\b(print|len|range|int|str|float|list|dict|set|tuple|bool|open|input|isinstance|enumerate|zip|map|filter|sorted|sum|min|max|abs|round|super|type|any|all|getattr|setattr|hasattr)\b(?=\s*\()|\b([A-Za-z_]\w*)(?=\s*\()/g,
  js: /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(@\w+)|\b(\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?n?|0[xX][\da-fA-F_]+)\b|\b(async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|true|false|null|undefined|require|module)\b|\b(console|process|Math|JSON|Object|Array|Promise|Date|Number|String|Boolean|Map|Set|Error)\b|\b([A-Za-z_$][\w$]*)(?=\s*\()/g,
  json: /(\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"?)|(@@@)|(-?\b\d+\.?\d*(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g,
};
const HL_CLASS = ['c', 's', 'd', 'n', 'k', 'b', 'f'];
function langOf(p) {
  if (/\.py$/i.test(p)) return 'python';
  if (/\.(m|c)?js$|\.ts$/i.test(p)) return 'js';
  if (/\.json$/i.test(p)) return 'json';
  return null;
}
function esc(s) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function highlight(text, lang) {
  const re = HL[lang];
  if (!re) return esc(text);
  let out = '';
  let last = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    out += esc(text.slice(last, m.index));
    let i = 1;
    while (i < m.length && m[i] === undefined) i++;
    out += `<span class="t-${HL_CLASS[i - 1] || 'x'}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  return out + esc(text.slice(last));
}

// ---------- 状態 ----------
const state = { user: null, config: null, cleanup: [], guard: null };

function cleanup() {
  for (const fn of state.cleanup) { try { fn(); } catch { /* 片付けの失敗は無視 */ } }
  state.cleanup = [];
  state.guard = null;
}

function topbar() {
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: '/icon.svg', alt: '' }), 'BotHost'),
    h('div', { class: 'spacer' }),
    state.user && h('span', { class: 'who' }, state.user.username),
    state.user && state.user.admin && h('a', { class: 'btn small ghost', href: '#/admin' }, '管理'),
    state.user && h('button', { class: 'btn small ghost', onclick: openAccount }, 'アカウント'),
    state.user && h('button', {
      class: 'btn small', onclick: async () => {
        await api('POST', '/api/logout').catch(() => {});
        state.user = null;
        go('#/login');
      },
    }, 'ログアウト'));
}

function openAccount() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = h('div', { class: 'error-text' });
  modal('パスワードを変える', [
    h('label', { class: 'field' }, h('span', {}, '今のパスワード'), cur),
    h('label', { class: 'field' }, h('span', {}, '新しいパスワード (8 文字以上)'), next),
    err,
  ], (close) => [
    h('button', { class: 'btn', onclick: close }, 'やめる'),
    h('button', {
      class: 'btn primary', onclick: async () => {
        try {
          await api('POST', '/api/me/password', { current: cur.value, next: next.value });
          close(); toast('パスワードを変えました');
        } catch (e) { err.textContent = e.message; }
      },
    }, '変える'),
  ]);
}

// ---------- ログイン / 登録 ----------
function renderAuth(mode) {
  const cfg = state.config;
  if (cfg.firstUser) mode = 'register';
  if (!cfg.registrationOpen) mode = 'login';
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
  const pass = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
  const err = h('div', { class: 'error-text' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? 'ログイン' : 'アカウントを作る');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true; err.textContent = '';
      try {
        const r = await api('POST', mode === 'login' ? '/api/login' : '/api/register', { username: user.value, password: pass.value });
        state.user = r.user;
        state.config.firstUser = false;
        go('#/');
      } catch (e2) { err.textContent = e2.message; submit.disabled = false; }
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'ユーザー名'), user),
  h('label', { class: 'field' }, h('span', {}, mode === 'login' ? 'パスワード' : 'パスワード (8 文字以上)'), pass),
  err, submit);

  fill($app, h('div', { class: 'auth-wrap' }, h('div', { class: 'auth card' },
    h('div', { class: 'brand' }, h('img', { src: '/icon.svg', alt: '' }), 'BotHost'),
    h('p', { class: 'lead' }, 'Discord などの bot を、24 時間動かしておく場所'),
    cfg.firstUser && h('div', { class: 'banner' }, 'はじめまして！ 最初に作るアカウントが管理者になります。'),
    cfg.registrationOpen && !cfg.firstUser && h('div', { class: 'tabs-row' },
      h('button', { type: 'button', class: mode === 'login' ? 'on' : '', onclick: () => go('#/login') }, 'ログイン'),
      h('button', { type: 'button', class: mode === 'register' ? 'on' : '', onclick: () => go('#/register') }, '新しく登録')),
    form)));
  user.focus();
}

// ---------- bot 一覧 ----------
async function renderList() {
  const main = h('main', {}, h('p', { class: 'hint' }, '読み込み中…'));
  fill($app, topbar(), main);
  const head = h('div', { class: 'page-head' },
    h('h1', {}, 'あなたの bot'),
    h('button', { class: 'btn primary', onclick: openNewBot }, '＋ 新しい bot'));
  const grid = h('div', { class: 'grid' });
  const draw = (bots) => {
    if (!bots.length) {
      fill(main, head, h('div', { class: 'card empty' },
        h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '🤖'),
        h('h2', {}, 'まだ bot がありません'),
        h('p', {}, 'テンプレートを選ぶと、すぐに動く Discord bot ができます。'),
        h('button', { class: 'btn primary', onclick: openNewBot }, '＋ 最初の bot を作る')));
      return;
    }
    fill(grid, bots.map((b) => h('a', { class: 'bot-card card', href: `#/bots/${b.id}` },
      h('div', { class: 'row' },
        b.discord && b.discord.avatarUrl ? h('img', { class: 'avatar', src: b.discord.avatarUrl, alt: '' }) : h('span', { class: 'avatar ph', 'aria-hidden': 'true' }, b.name.slice(0, 1)),
        h('span', { class: 'name' }, b.name), pill(b.status)),
      h('div', { class: 'meta' },
        h('span', { class: 'badge' }, RUNTIME_LABEL[b.runtime] || b.runtime),
        h('span', {}, '稼働 ', b.status === 'running' ? uptime(b.startedAt) : '—'),
        b.stats && h('span', {}, `メモリ ${b.stats.memoryMB} MB`),
        b.lastCrashAt && h('span', { class: 'warn-text' }, `最後に落ちた: ${ago(b.lastCrashAt)}`)))));
    fill(main, head, grid);
  };
  const load = async () => draw((await api('GET', '/api/bots')).bots);
  await load();
  const t = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 8000);
  state.cleanup.push(() => clearInterval(t));
}

function openNewBot() {
  const templates = state.config.templates;
  let chosen = templates[0].id;
  const name = h('input', { type: 'text', placeholder: '例: my-bot', maxlength: 40 });
  const err = h('div', { class: 'error-text' });
  const tplWrap = h('div', { class: 'templates' });
  const drawTpl = () => fill(tplWrap, templates.map((t) => h('button', {
    type: 'button', class: 'tpl' + (t.id === chosen ? ' on' : ''), 'aria-pressed': String(t.id === chosen), onclick: () => { chosen = t.id; drawTpl(); },
  }, h('b', {}, t.label), h('span', {}, t.desc || ''))));
  drawTpl();
  const create = async (close) => {
    try {
      const { bot } = await api('POST', '/api/bots', { name: name.value.trim() || 'my-bot', template: chosen });
      close();
      const isDiscord = chosen.includes('discord');
      go(`#/bots/${bot.id}/${isDiscord ? 'settings' : 'console'}`);
      if (isDiscord) toast('まず Discord のトークンを入れてください');
    } catch (e) { err.textContent = e.message; }
  };
  const close = modal('新しい bot', [
    h('label', { class: 'field' }, h('span', {}, '名前'), name),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'テンプレート'), tplWrap),
    h('p', { class: 'hint' }, '自分のコードは、作った後に「ファイル」タブで ZIP を読み込めます。'),
    err,
  ], (c) => [h('button', { class: 'btn', onclick: c }, 'やめる'), h('button', { class: 'btn primary', onclick: () => create(c) }, '作る')]);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) create(close); });
}

// ---------- bot の画面 ----------
function sparkline(points, limit) {
  const w = 96; const hgt = 26;
  if (points.length < 2) return null;
  const vals = points.map((p) => p[1]);
  const max = Math.max(limit || 0, ...vals, 1);
  const step = w / (points.length - 1);
  const d = vals.map((v, i) => `${(i * step).toFixed(1)},${(hgt - 2 - (v / max) * (hgt - 4)).toFixed(1)}`).join(' ');
  return h('svg:svg', { class: 'spark', width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, 'aria-hidden': 'true' },
    h('svg:polyline', { points: d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linejoin': 'round' }));
}

async function renderBot(id, tab) {
  tab = ['console', 'files', 'settings'].includes(tab) ? tab : 'console';
  let { bot } = await api('GET', `/api/bots/${id}`);

  const statusEl = h('span');
  const actions = h('div', { class: 'actions' });
  const statsEl = h('div', { class: 'stats' });
  const connEl = h('span', { class: 'conn' }, '再接続中…');
  connEl.hidden = true;
  const live = { ...bot, history: [] };

  const act = (path, label) => async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api('POST', `/api/bots/${id}/${path}`);
      bot = r.bot; // 状態はリアルタイム (SSE) で届くので、ここでは live を上書きしない
      if (label) toast(label);
    } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
    drawHead();
  };
  const drawHead = () => {
    fill(statusEl, pill(live.status));
    const active = ACTIVE.includes(live.status);
    fill(actions, active
      ? [h('button', { class: 'btn', onclick: act('restart') }, '↻ 再起動'), h('button', { class: 'btn danger', onclick: act('stop') }, '■ 停止')]
      : [h('button', { class: 'btn primary', onclick: act('start') }, '▶ 起動')]);
    const waiting = live.status === 'restarting' && live.restartAt ? Math.max(0, Math.ceil((live.restartAt - Date.now()) / 1000)) : null;
    fill(statsEl,
      h('span', {}, '稼働 ', h('b', {}, live.status === 'running' ? uptime(live.startedAt) : '—')),
      waiting !== null && h('span', { class: 'warn-text' }, `${waiting} 秒後に再起動`),
      h('span', {}, 'CPU ', h('b', {}, live.stats && live.stats.cpuPercent !== null ? `${live.stats.cpuPercent}%` : '—')),
      h('span', { class: 'mem' }, 'メモリ ', h('b', {}, live.stats ? `${live.stats.memoryMB} MB` : '—'), ` / ${bot.memoryLimitMB} MB`,
        live.status === 'running' && sparkline(live.history, bot.memoryLimitMB)),
      live.restarts > 0 && h('span', {}, '自動再起動 ', h('b', {}, `${live.restarts} 回`)),
      h('span', {}, h('span', { class: 'badge' }, RUNTIME_LABEL[bot.runtime] || bot.runtime)),
      connEl);
  };
  drawHead();
  const tick = setInterval(() => { if (!document.hidden) drawHead(); }, 1000);
  state.cleanup.push(() => clearInterval(tick));

  const body = h('div');
  const tabLink = (key, label) => h('a', { href: `#/bots/${id}/${key}`, class: tab === key ? 'on' : '', 'aria-current': tab === key ? 'page' : null }, label);
  const nameEl = h('h1', {}, bot.name);
  fill($app, topbar(), h('main', {},
    h('a', { class: 'back', href: '#/' }, '‹ bot の一覧'),
    h('div', { class: 'bot-head' }, nameEl, statusEl, actions),
    statsEl,
    h('nav', { class: 'tabs' }, tabLink('console', 'コンソール'), tabLink('files', 'ファイル'), tabLink('settings', '設定')),
    body));

  // ログと状態はずっと受け取る (どのタブでも見出しを最新に)
  const logView = createLogView(id);
  const es = new EventSource(`/api/bots/${id}/events`);
  es.addEventListener('init', (e) => {
    const d = JSON.parse(e.data);
    connEl.hidden = true;
    Object.assign(live, d, { history: d.history || [] });
    logView.reset(d.logs);
    drawHead();
  });
  es.addEventListener('logs', (e) => logView.add(JSON.parse(e.data)));
  es.addEventListener('status', (e) => { Object.assign(live, JSON.parse(e.data)); if (!ACTIVE.includes(live.status)) live.history = []; drawHead(); });
  es.addEventListener('stats', (e) => {
    const d = JSON.parse(e.data);
    live.stats = { memoryMB: d.memoryMB, cpuPercent: d.cpuPercent };
    if (d.point) { live.history.push(d.point); if (live.history.length > 120) live.history.shift(); }
  });
  es.onerror = () => { connEl.hidden = false; };
  state.cleanup.push(() => es.close());

  const update = (b) => { bot = b; nameEl.textContent = b.name; drawHead(); };
  if (tab === 'console') body.append(logView.el);
  else if (tab === 'files') await renderFiles(id, bot, body, () => live.status);
  else renderSettings(bot, body, update);
}

function createLogView(id) {
  const log = h('div', { class: 'log', tabindex: '0', role: 'log', 'aria-live': 'off' });
  let entries = [];
  let follow = true;
  let filter = '';
  let errorsOnly = false;
  let queue = [];
  let frame = 0;
  const MAX = 3000;
  const SHOW = 1500;

  const followBox = h('input', { type: 'checkbox', checked: true, onchange: () => { follow = followBox.checked; if (follow) log.scrollTop = log.scrollHeight; } });
  log.addEventListener('scroll', () => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    if (follow !== atBottom) { follow = atBottom; followBox.checked = atBottom; }
  }, { passive: true });
  const time = (t) => new Date(t).toLocaleTimeString('ja-JP', { hour12: false });
  const match = (e) => (!errorsOnly || e.s === 'err' || (e.s === 'sys' && /失敗|エラー|落ち|超え|見つかりません|ありません|やめました/.test(e.l)))
    && (!filter || stripAnsi(e.l).toLowerCase().includes(filter));
  const line = (e) => h('div', { class: 'ln' }, h('span', { class: 'ts' }, time(e.t)), h('span', { class: e.s }, ansiNodes(e.l)));
  const placeholder = () => h('div', { class: 'placeholder' },
    filter || errorsOnly ? '当てはまる行はありません。' : 'まだ出力はありません。▶ 起動 を押すと、ここに bot の出力が出ます。');
  const redraw = () => {
    const shown = entries.filter(match).slice(-SHOW);
    fill(log, shown.length ? shown.map(line) : placeholder());
    log.scrollTop = log.scrollHeight;
  };
  // 新しい行は画面の描き直し 1 回分ずつまとめて足す (大量のログでも固まらないように)
  const flush = () => {
    frame = 0;
    const items = queue.filter(match).slice(-SHOW);
    queue = [];
    if (!items.length) return;
    if (log.firstElementChild && log.firstElementChild.classList.contains('placeholder')) fill(log);
    const frag = document.createDocumentFragment();
    for (const e of items) frag.append(line(e));
    log.append(frag);
    let extra = log.childElementCount - SHOW;
    while (extra-- > 0) log.firstElementChild.remove();
    if (follow) log.scrollTop = log.scrollHeight;
  };
  const view = {
    reset(logs) { entries = logs.slice(-MAX); queue = []; redraw(); },
    add(items) {
      entries.push(...items);
      if (entries.length > MAX * 1.2) entries = entries.slice(-MAX);
      queue.push(...items);
      if (!frame) frame = requestAnimationFrame(flush);
    },
  };
  const search = h('input', { type: 'search', class: 'log-search', placeholder: '絞り込み', 'aria-label': 'ログを絞り込む', autocapitalize: 'off', spellcheck: 'false' });
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter = search.value.trim().toLowerCase(); redraw(); }, 150);
  });
  const errBox = h('input', { type: 'checkbox', onchange: () => { errorsOnly = errBox.checked; redraw(); } });

  const input = h('input', { type: 'text', placeholder: '標準入力に送る (input() など)', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', enterkeyhint: 'send' });
  const sendIn = async () => {
    if (!input.value) return;
    try { await api('POST', `/api/bots/${id}/stdin`, { text: input.value }); input.value = ''; } catch (e) { toast(e.message, true); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendIn(); });
  view.el = h('div', { class: 'console' },
    h('div', { class: 'console-bar' },
      search,
      h('label', {}, errBox, 'エラーだけ'),
      h('div', { class: 'spacer' }),
      h('label', {}, followBox, '自動スクロール'),
      h('button', { class: 'btn small', onclick: () => download(`/api/bots/${id}/logs.txt`) }, '保存'),
      h('button', {
        class: 'btn small', onclick: async () => {
          if (!await confirmBox('ログを消去', 'このページと保存されたログをすべて消します。', '消去する')) return;
          await api('DELETE', `/api/bots/${id}/logs`); view.reset([]);
        },
      }, '消去')),
    log,
    h('div', { class: 'stdin' }, input, h('button', { class: 'btn small', onclick: sendIn }, '送る')));
  return view;
}

// ---------- ファイル ----------
async function renderFiles(id, bot, body, getStatus) {
  const listEl = h('div', { class: 'file-list card' });
  const editorEl = h('div', { class: 'editor card' });
  fill(body, h('div', { class: 'files' }, listEl, editorEl));
  let current = null; // { path, original }
  let dirty = false;
  const collapsed = new Set();

  const confirmLeave = async () => !dirty || confirmBox('保存していません', `${current.path} の変更は保存されていません。破棄しますか？`, '破棄する');
  const onBefore = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBefore);
  state.cleanup.push(() => window.removeEventListener('beforeunload', onBefore));
  state.guard = confirmLeave;

  const openMain = async () => {
    const { files } = await api('GET', `/api/bots/${id}/files`);
    const main = files.find((f) => /^(main\.py|index\.js|bot\.py)$/.test(f.path)) || files[0];
    if (main) await open(main.path); else { showEmpty(); await refresh(); }
  };

  const importZip = async (file) => {
    const mode = await choiceBox('ZIP を読み込む',
      `${file.name} の中身を入れます。いまあるファイルを全部消して入れ替えますか？ それとも足しますか？ (足すときは、同じ名前のファイルだけ上書きします)`,
      [{ label: '足す', value: 'add' }, { label: '全部入れ替える', value: 'replace', primary: true }]);
    if (!mode) return;
    try {
      const res = await api('POST', `/api/bots/${id}/import${mode === 'replace' ? '?replace=1' : ''}`, file);
      toast(`${res.count} 個のファイルを読み込みました`);
      dirty = false; current = null;
      await openMain();
    } catch (e) { toast(e.message, true); }
  };

  const uploadFiles = async (fileList) => {
    if (fileList.length === 1 && /\.zip$/i.test(fileList[0].name)) { await importZip(fileList[0]); return; }
    let n = 0;
    for (const f of fileList) {
      try { await api('PUT', `/api/bots/${id}/file?path=${encodeURIComponent(f.name)}`, f); n++; } catch (e) { toast(`${f.name}: ${e.message}`, true); }
    }
    if (n) toast(`${n} 個のファイルを入れました`);
    refresh();
  };

  const refresh = async () => {
    const { files, hidden } = await api('GET', `/api/bots/${id}/files`);
    // フォルダーのツリーにする
    const rows = [];
    const seenDirs = new Set();
    for (const f of files) {
      const parts = f.path.split('/');
      let hiddenByParent = false;
      for (let i = 0; i < parts.length - 1 && !hiddenByParent; i++) {
        const dir = parts.slice(0, i + 1).join('/');
        if (!seenDirs.has(dir)) {
          seenDirs.add(dir);
          rows.push(h('button', {
            class: 'file-item dir', style: `padding-left:${9 + i * 14}px`, 'aria-expanded': String(!collapsed.has(dir)),
            onclick: () => { if (collapsed.has(dir)) collapsed.delete(dir); else collapsed.add(dir); refresh(); },
          }, h('span', { class: 'caret' }, collapsed.has(dir) ? '▸' : '▾'), h('span', { class: 'nm' }, parts[i] + '/')));
        }
        if (collapsed.has(dir)) hiddenByParent = true;
      }
      if (hiddenByParent) continue;
      rows.push(h('button', {
        class: 'file-item' + (current && current.path === f.path ? ' on' : ''),
        style: `padding-left:${9 + (parts.length - 1) * 14 + (parts.length > 1 ? 14 : 0)}px`,
        title: f.path,
        onclick: async () => { if (await confirmLeave()) open(f.path); },
      }, h('span', { class: 'nm' }, parts[parts.length - 1]), h('span', { class: 'size' }, fmtSize(f.size))));
    }
    fill(listEl,
      h('div', { class: 'tools' },
        h('button', { class: 'btn small', onclick: newFile }, '＋ 新規'),
        h('button', {
          class: 'btn small', onclick: () => {
            const input = h('input', { type: 'file', multiple: true, style: 'display:none' });
            input.addEventListener('change', () => { uploadFiles([...input.files]); input.remove(); });
            document.body.append(input); input.click();
          },
        }, 'アップロード'),
        h('button', { class: 'btn small', onclick: async () => { const f = await pickFile('.zip,application/zip'); if (f) importZip(f); } }, 'ZIP 読込'),
        h('button', { class: 'btn small', onclick: () => download(`/api/bots/${id}/export`) }, 'ZIP 保存')),
      rows.length ? rows : h('p', { class: 'hint', style: 'padding:6px' }, 'ファイルがありません'),
      hidden.length ? h('p', { class: 'hint small-hint' }, `ライブラリなどのフォルダー (${hidden.join(', ')}) は表示していません`) : null,
      h('p', { class: 'hint small-hint drop-hint' }, 'ここにファイルや ZIP をドロップしても入れられます'));
    return files;
  };
  // ドラッグ & ドロップ
  listEl.addEventListener('dragover', (e) => { e.preventDefault(); listEl.classList.add('drop'); });
  listEl.addEventListener('dragleave', () => listEl.classList.remove('drop'));
  listEl.addEventListener('drop', (e) => { e.preventDefault(); listEl.classList.remove('drop'); if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]); });

  const newFile = () => {
    const input = h('input', { type: 'text', placeholder: bot.runtime === 'python' ? '例: cogs/music.py' : '例: commands/ping.js', autocapitalize: 'off', spellcheck: 'false' });
    const err = h('div', { class: 'error-text' });
    const make = async (close) => {
      const p = input.value.trim();
      if (!p) return;
      try {
        await api('PUT', `/api/bots/${id}/file?path=${encodeURIComponent(p)}`, '');
        close(); open(p);
      } catch (e) { err.textContent = e.message; }
    };
    const close = modal('新しいファイル', [h('label', { class: 'field' }, h('span', {}, 'ファイル名 (フォルダーは / で区切る)'), input), err],
      (c) => [h('button', { class: 'btn', onclick: c }, 'やめる'), h('button', { class: 'btn primary', onclick: () => make(c) }, '作る')]);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) make(close); });
  };

  const showEmpty = () => {
    current = null; dirty = false;
    fill(editorEl, h('div', { class: 'no-file' }, '左のファイルを選ぶと、ここで編集できます。'));
  };

  const open = async (p) => {
    let buf;
    try {
      const res = await api('GET', `/api/bots/${id}/file?path=${encodeURIComponent(p)}`, undefined, { raw: true });
      buf = await res.arrayBuffer();
    } catch (e) { toast(e.message, true); return; }
    let text = null;
    if (buf.byteLength < 2 * 1024 * 1024) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = null; }
    }
    current = { path: p, original: text };
    dirty = false;
    await refresh();
    const dirtyEl = h('span', { class: 'dirty' });
    const actionsBar = [
      h('button', {
        class: 'btn small', onclick: () => {
          const input = h('input', { type: 'text', value: p, autocapitalize: 'off', spellcheck: 'false' });
          modal('名前を変える', h('label', { class: 'field' }, h('span', {}, '新しい名前'), input), (close) => [
            h('button', { class: 'btn', onclick: close }, 'やめる'),
            h('button', {
              class: 'btn primary', onclick: async () => {
                try { await api('POST', `/api/bots/${id}/rename`, { from: p, to: input.value.trim() }); close(); open(input.value.trim()); } catch (e) { toast(e.message, true); }
              },
            }, '変える')]);
        },
      }, '名前'),
      h('button', {
        class: 'btn small danger', onclick: async () => {
          if (!await confirmBox('ファイルを削除', `${p} を削除します。元には戻せません。`, '削除する')) return;
          await api('DELETE', `/api/bots/${id}/file?path=${encodeURIComponent(p)}`);
          showEmpty(); refresh(); toast('削除しました');
        },
      }, '削除'),
    ];
    if (text === null) {
      fill(editorEl,
        h('div', { class: 'editor-bar' }, h('span', { class: 'path' }, p), ...actionsBar),
        h('div', { class: 'no-file' }, `テキストではないファイルです (${fmtSize(buf.byteLength)})`));
      return;
    }
    const lang = langOf(p);
    const gutter = h('div', { class: 'gutter', 'aria-hidden': 'true' });
    const pre = h('pre', { class: 'hl', 'aria-hidden': 'true' });
    const code = h('textarea', {
      class: 'code' + (lang ? ' colored' : ''), spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off', 'aria-label': p,
    });
    code.value = text;
    let lineCount = 0;
    let hlFrame = 0;
    const sync = () => {
      pre.style.transform = `translate(${-code.scrollLeft}px, ${-code.scrollTop}px)`;
      gutter.scrollTop = code.scrollTop;
    };
    const paint = () => {
      hlFrame = 0;
      const n = code.value.split('\n').length;
      if (n !== lineCount) { lineCount = n; gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n') + '\n'; }
      if (lang && code.value.length < 300000) { pre.innerHTML = highlight(code.value, lang) + '\n'; code.classList.add('colored'); } else { pre.textContent = ''; code.classList.remove('colored'); }
      sync();
    };
    const schedule = () => { if (!hlFrame) hlFrame = requestAnimationFrame(paint); };
    const saveBtn = h('button', { class: 'btn small primary', onclick: () => save() }, '保存');
    const save = async () => {
      saveBtn.disabled = true;
      try {
        const value = code.value;
        await api('PUT', `/api/bots/${id}/file?path=${encodeURIComponent(p)}`, value);
        current.original = value; dirty = code.value !== value; dirtyEl.textContent = dirty ? '● 未保存' : '';
        toast(ACTIVE.includes(getStatus()) ? '保存しました (反映するには ↻ 再起動)' : '保存しました');
        refresh();
      } catch (e) { toast(e.message, true); } finally { saveBtn.disabled = false; }
    };
    code.addEventListener('input', () => {
      dirty = code.value !== current.original;
      dirtyEl.textContent = dirty ? '● 未保存' : '';
      schedule();
    });
    code.addEventListener('scroll', sync, { passive: true });
    const indentUnit = '    ';
    code.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
      if (e.isComposing) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b, value } = code;
        if (a !== b && value.slice(a, b).includes('\n')) {
          // 複数行: まとめて字下げ / 戻す
          const start = value.lastIndexOf('\n', a - 1) + 1;
          const block = value.slice(start, b);
          const next = e.shiftKey ? block.replace(/^( {1,4}|\t)/gm, '') : block.replace(/^/gm, indentUnit);
          code.setSelectionRange(start, b);
          document.execCommand('insertText', false, next);
          code.setSelectionRange(start, start + next.length);
        } else if (!e.shiftKey) {
          document.execCommand('insertText', false, indentUnit);
        }
      } else if (e.key === 'Enter') {
        // 前の行と同じ字下げ (: や { で終わる行のあとは 1 段深く)
        const before = code.value.slice(0, code.selectionStart);
        const cur = before.slice(before.lastIndexOf('\n') + 1);
        let indent = cur.match(/^\s*/)[0];
        if (/[:{[(]\s*$/.test(cur)) indent += indentUnit;
        e.preventDefault();
        document.execCommand('insertText', false, '\n' + indent);
      } else if (e.key === 'Backspace' && code.selectionStart === code.selectionEnd) {
        // 字下げの空白はまとめて消す
        const before = code.value.slice(0, code.selectionStart);
        const cur = before.slice(before.lastIndexOf('\n') + 1);
        if (cur.length && /^ +$/.test(cur) && cur.length % 4 === 0) {
          e.preventDefault();
          code.setSelectionRange(code.selectionStart - 4, code.selectionStart);
          document.execCommand('delete');
        }
      }
    });
    fill(editorEl,
      h('div', { class: 'editor-bar' }, h('span', { class: 'path' }, p), dirtyEl, ...actionsBar, saveBtn),
      h('div', { class: 'code-wrap' }, gutter, h('div', { class: 'code-area' }, pre, code)));
    paint();
  };

  await openMain();
}

// ---------- 設定 ----------
function renderSettings(bot, body, onSaved) {
  const docker = state.config.mode === 'docker';
  const isDiscord = (bot.template || '').includes('discord') || !!bot.env.DISCORD_TOKEN;
  const saved = (b, msg) => { onSaved(b); bot = b; if (msg) toast(msg); };
  const redraw = () => renderSettings(bot, body, onSaved);

  // --- Discord ---
  const discordSection = () => {
    const token = h('input', {
      type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Discord bot のトークン',
      placeholder: bot.env.DISCORD_TOKEN ? '••••••••（保存済み。変えるときだけ入れる）' : 'Bot → Reset Token で出る文字列',
    });
    const result = h('div', { class: 'discord-result' });
    const showInfo = (d) => {
      if (!d) { fill(result); return; }
      const warn = [];
      if (d.intents && !d.intents.messageContent && bot.template !== 'python-discord-slash') {
        warn.push(h('li', {}, 'MESSAGE CONTENT INTENT がオフです。!ping のようなメッセージのコマンドを使うなら、Developer Portal の Bot → Privileged Gateway Intents でオンにしてください。'));
      }
      fill(result, h('div', { class: 'discord-card' },
        d.avatarUrl ? h('img', { src: d.avatarUrl, alt: '', class: 'avatar big' }) : h('span', { class: 'avatar big ph' }, d.username.slice(0, 1)),
        h('div', { class: 'grow' },
          h('b', {}, d.username),
          h('div', { class: 'hint' }, d.guilds !== null && d.guilds !== undefined ? `${d.guilds} 個のサーバーに参加 ・ ` : '', `${ago(d.checkedAt)}に確認`),
          warn.length ? h('ul', { class: 'warn-list' }, warn) : null),
        h('a', { class: 'btn primary', href: d.inviteUrl, target: '_blank', rel: 'noopener' }, 'サーバーに招待')));
    };
    showInfo(bot.discord);
    const check = async (btn) => {
      btn.disabled = true;
      try {
        if (token.value.trim()) {
          const r = await api('PATCH', `/api/bots/${bot.id}`, { env: { DISCORD_TOKEN: token.value.trim() } });
          saved(r.bot);
          token.value = '';
          token.placeholder = '••••••••（保存済み。変えるときだけ入れる）';
        }
        const { result: res, bot: b } = await api('POST', `/api/bots/${bot.id}/discord-check`);
        saved(b);
        if (res.ok) { showInfo(b.discord); toast(`「${res.username}」として繋がりました`); } else {
          fill(result, h('div', { class: 'banner bad' }, res.error));
        }
      } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
    };
    const btn = h('button', { class: 'btn primary', onclick: () => check(btn) }, '保存して確認');
    token.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) check(btn); });
    return h('section', { class: 'card' },
      h('h2', {}, 'Discord'),
      h('p', { class: 'hint' }, 'bot のトークンを入れて「保存して確認」を押すと、正しいかを調べて、サーバーへの招待リンクを作ります。トークンは環境変数 DISCORD_TOKEN として bot に渡ります。'),
      h('div', { class: 'inline-form' }, token, btn),
      result,
      h('details', { class: 'howto', open: !bot.env.DISCORD_TOKEN }, h('summary', {}, 'トークンの取り方'),
        h('ol', {},
          h('li', {}, h('a', { href: 'https://discord.com/developers/applications', target: '_blank', rel: 'noopener' }, 'Discord Developer Portal'), ' を開き、「New Application」で作る'),
          h('li', {}, '左の「Bot」→「Reset Token」→ 出た文字列をコピーして上に貼る'),
          bot.template !== 'python-discord-slash' && h('li', {}, '同じページの「MESSAGE CONTENT INTENT」をオンにして保存'),
          h('li', {}, '「保存して確認」→「サーバーに招待」で自分のサーバーに入れる'),
          h('li', {}, '上の ▶ 起動 を押す'))));
  };

  // --- 環境変数 (値はサーバーから返さない。空欄のままなら変えません) ---
  const envSection = () => {
    const envRows = h('div');
    const rows = [];
    const addRow = (key = '', existing = false) => {
      const k = h('input', { type: 'text', value: key, placeholder: '名前 (例: API_KEY)', spellcheck: 'false', autocapitalize: 'characters', 'aria-label': '名前' });
      const v = h('input', { type: 'password', placeholder: existing ? '••••••（変えないなら空欄）' : '値', autocomplete: 'off', spellcheck: 'false', 'aria-label': '値' });
      const row = { k, v, existing, original: key, removed: false };
      const show = h('button', { class: 'btn small ghost', type: 'button', title: '表示', 'aria-label': '値を表示', onclick: () => { v.type = v.type === 'password' ? 'text' : 'password'; } }, '👁');
      const el = h('div', { class: 'env-row' }, k, h('div', { class: 'env-val' }, v, show),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { row.removed = true; el.remove(); } }, '削除'));
      rows.push(row);
      envRows.append(el);
    };
    const keys = Object.keys(bot.env || {}).filter((k) => !(k === 'DISCORD_TOKEN' && isDiscord));
    keys.forEach((key) => addRow(key, true));
    if (!keys.length) addRow();
    const saveEnv = async () => {
      const env = {};
      for (const r of rows) {
        const key = r.k.value.trim();
        if (r.removed) { if (r.existing) env[r.original] = null; continue; }
        if (!key) continue;
        if (r.existing && key !== r.original) {
          if (!r.v.value) { toast(`${key}: 名前を変えるときは値も入れてください`, true); return; }
          env[r.original] = null;
        }
        if (r.v.value) env[key] = r.v.value;
      }
      try {
        const r = await api('PATCH', `/api/bots/${bot.id}`, { env });
        saved(r.bot, '環境変数を保存しました (反映するには ↻ 再起動)');
        redraw();
      } catch (e) { toast(e.message, true); }
    };
    return h('section', { class: 'card' },
      h('h2', {}, '環境変数'),
      h('p', { class: 'hint' }, 'API キーやパスワードはコードに書かず、ここに入れてください。Python は os.environ["名前"]、Node.js は process.env.名前 で読めます。保存した値は画面には出しません。'),
      envRows,
      h('div', { class: 'row-end' },
        h('button', { class: 'btn small', onclick: () => addRow() }, '＋ 追加'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn primary', onclick: saveEnv }, '環境変数を保存')));
  };

  // --- 通知 ---
  const notifySection = () => {
    const url = h('input', { type: 'url', placeholder: bot.notify ? '設定済み (変えるときだけ入れる)' : 'https://discord.com/api/webhooks/…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Webhook の URL' });
    const saveBtn = h('button', {
      class: 'btn primary', onclick: async () => {
        if (!url.value.trim()) return;
        try { const r = await api('PATCH', `/api/bots/${bot.id}`, { notifyWebhook: url.value.trim() }); saved(r.bot, '通知先を保存しました'); redraw(); } catch (e) { toast(e.message, true); }
      },
    }, '保存');
    return h('section', { class: 'card' },
      h('h2', {}, '落ちたときの通知'),
      h('p', { class: 'hint' }, 'bot が落ちたり止まったりしたら、Discord のチャンネルに知らせます (同じ bot は 10 分に 1 回まで)。チャンネルの設定 → 連携サービス → ウェブフック で URL を作って貼ってください。'),
      h('div', { class: 'inline-form' }, url, saveBtn),
      bot.notify && h('div', { class: 'row-end' },
        h('span', { class: 'ok-text' }, '✓ 通知はオン'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn small', onclick: async () => { try { await api('POST', `/api/bots/${bot.id}/notify-test`); toast('テスト通知を送りました'); } catch (e) { toast(e.message, true); } } }, 'テスト通知'),
        h('button', { class: 'btn small danger', onclick: async () => { const r = await api('PATCH', `/api/bots/${bot.id}`, { notifyWebhook: '' }); saved(r.bot, '通知をオフにしました'); redraw(); } }, 'オフにする')));
  };

  // --- 基本 ---
  const generalSection = () => {
    const name = h('input', { type: 'text', value: bot.name, maxlength: 40 });
    const cmd = h('input', { type: 'text', value: bot.startCommand, class: 'mono', spellcheck: 'false', autocapitalize: 'off' });
    const auto = h('input', { type: 'checkbox', checked: bot.autoRestart });
    const presets = [0, 6, 12, 24, 48, 168];
    const every = h('select', {}, presets.map((v) => h('option', { value: v, selected: bot.restartEveryHours === v ? true : null },
      v === 0 ? 'しない' : v === 168 ? '1 週間ごと' : `${v} 時間ごと`)));
    if (!presets.includes(bot.restartEveryHours)) every.append(h('option', { value: bot.restartEveryHours, selected: true }, `${bot.restartEveryHours} 時間ごと`));
    const mem = h('input', { type: 'number', value: bot.memoryLimitMB, min: 32, max: 4096, step: 32, inputmode: 'numeric' });
    const cpu = h('input', { type: 'number', value: bot.cpuLimit, min: 0.1, max: 4, step: 0.1, inputmode: 'decimal' });
    const saveGeneral = async () => {
      const payload = {
        name: name.value, startCommand: cmd.value, autoRestart: auto.checked,
        restartEveryHours: Number(every.value), memoryLimitMB: Number(mem.value),
      };
      if (docker) payload.cpuLimit = Number(cpu.value);
      try { const r = await api('PATCH', `/api/bots/${bot.id}`, payload); saved(r.bot, '保存しました'); } catch (e) { toast(e.message, true); }
    };
    return h('section', { class: 'card' },
      h('h2', {}, '基本'),
      h('label', { class: 'field' }, h('span', {}, '名前'), name),
      h('label', { class: 'field' }, h('span', {}, '起動コマンド'), cmd,
        h('small', { class: 'hint' },
          `ふつうは ${state.config.runtimes[bot.runtime].defaultCommand}。${bot.runtime === 'python' ? 'requirements.txt' : 'package.json'} があれば、起動の前にライブラリを自動で入れます。`)),
      h('label', { class: 'switch' }, auto, h('span', {}, h('b', {}, '落ちたら自動で再起動'), h('br'),
        h('span', { class: 'hint' }, 'エラーで止まったら、少し待ってから起動し直します (5 分で 5 回落ちたらあきらめます)。'))),
      h('div', { class: 'two' },
        h('label', { class: 'field' }, h('span', {}, '定期的に再起動'), every),
        h('label', { class: 'field' }, h('span', {}, 'メモリの上限 (MB)'), mem),
        docker && h('label', { class: 'field' }, h('span', {}, 'CPU の上限 (コア数)'), cpu)),
      h('div', { class: 'row-end' }, h('div', { class: 'grow' }), h('button', { class: 'btn primary', onclick: saveGeneral }, '保存')));
  };

  const maintenanceSection = () => h('section', { class: 'card' },
    h('h2', {}, 'メンテナンス'),
    h('div', { class: 'maint' },
      h('div', {}, h('b', {}, 'ライブラリを入れ直す'), h('p', { class: 'hint' }, '入れたライブラリを消して、次の起動で入れ直します。ライブラリの調子がおかしいときに。')),
      h('button', {
        class: 'btn', onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try { await api('POST', `/api/bots/${bot.id}/reinstall`); toast('ライブラリを消しました。起動すると入れ直します'); } catch (err) { toast(err.message, true); }
          b.disabled = false;
        },
      }, '入れ直す')),
    h('div', { class: 'maint' },
      h('div', {}, h('b', {}, 'ファイルを ZIP で保存'), h('p', { class: 'hint' }, 'bot のファイルを全部まとめてダウンロードします (ライブラリは含めません)。')),
      h('button', { class: 'btn', onclick: () => download(`/api/bots/${bot.id}/export`) }, 'ダウンロード')));

  const dangerSection = () => h('section', { class: 'card danger-zone' },
    h('h2', {}, 'bot を削除'),
    h('p', { class: 'hint' }, 'bot を止めて、ファイルと設定とログをすべて消します。元には戻せません。'),
    h('button', {
      class: 'btn danger solid', onclick: async () => {
        if (!await confirmBox('bot を削除', `「${bot.name}」を削除します。ファイルもすべて消えます。`, '削除する')) return;
        await api('DELETE', `/api/bots/${bot.id}`);
        toast('削除しました'); go('#/');
      },
    }, '削除する'));

  fill(body, h('div', { class: 'settings' },
    isDiscord && discordSection(),
    envSection(),
    notifySection(),
    generalSection(),
    maintenanceSection(),
    dangerSection()));
}

// ---------- 管理 ----------
async function renderAdmin() {
  const main = h('main', {}, h('p', { class: 'hint' }, '読み込み中…'));
  fill($app, topbar(), main);
  const draw = async () => {
    const d = await api('GET', '/api/admin');
    const s = d.server;
    const reg = h('input', {
      type: 'checkbox', checked: d.settings.registrationOpen, onchange: async () => {
        try { await api('PATCH', '/api/admin/settings', { registrationOpen: reg.checked }); toast(reg.checked ? '新しい登録を受け付けます' : '新しい登録を止めました'); } catch (e) { toast(e.message, true); }
      },
    });
    const b = d.backup;
    const kv = (pairs) => h('div', { class: 'kv' }, pairs.filter(Boolean).map(([k, v, cls]) => [h('span', {}, k), h('b', { class: cls || null }, v)]));
    fill(main,
      h('a', { class: 'back', href: '#/' }, '‹ bot の一覧'),
      h('div', { class: 'page-head' }, h('h1', {}, '管理')),
      h('div', { class: 'settings' },
        h('section', { class: 'card' },
          h('h2', {}, 'サーバー'),
          kv([
            ['バージョン', s.version],
            ['動かし方', s.mode === 'docker' ? 'docker (bot ごとにコンテナ)' : 'process (そのまま)'],
            ['起動してから', dur(s.uptime * 1000)],
            ['bot', `${s.running} 個が動作中 / 全部で ${s.bots} 個`],
            ['サーバーのメモリ', `${s.memoryMB} MB`],
            ['保存容量', `${s.diskMB} MB / ${s.maxDiskMB} MB`],
            ['眠らせない', d.keepAwake ? `オン (${d.keepAwake})` : 'オフ'],
          ])),
        h('section', { class: 'card' },
          h('h2', {}, 'バックアップ'),
          b.enabled
            ? [
              h('p', { class: 'hint' }, `GitHub の ${b.repo || 'リポジトリ'} に、変更があれば 1 分ごとに保存しています (${b.method === 'git' ? 'デプロイキー' : 'トークン'})。サーバーのファイルが消えても、次の起動で自動で戻します。`),
              b.blocked && h('div', { class: 'banner warn' }, b.blocked),
              kv([
                ['接続', b.connected === null ? '確認中' : b.connected ? '✓ 繋がっています' : '✗ 繋がりません', b.connected === false ? 'bad-text' : null],
                ['最後に保存', b.lastAt ? `${ago(b.lastAt)} (${fmtSize(b.lastSize)})` : 'まだ'],
                b.restoredAt && ['戻した', ago(b.restoredAt)],
                b.lastError && ['エラー', b.lastError, 'bad-text'],
              ]),
              h('div', { class: 'row-end' }, h('div', { class: 'grow' }), h('button', {
                class: 'btn primary', onclick: async (e) => {
                  e.currentTarget.disabled = true;
                  try { await api('POST', '/api/admin/backup'); toast('バックアップしました'); } catch (err) { toast(err.message, true); }
                  draw();
                },
              }, '今すぐバックアップ'))]
            : h('div', { class: 'banner warn' }, 'バックアップはオフです。Render の無料プランなどでは、サーバーが再起動するとアカウントや bot が消えます。README の「GitHub にバックアップ」を見て、BOTHOST_BACKUP_REPO と BOTHOST_BACKUP_TOKEN を設定してください。')),
        h('section', { class: 'card' },
          h('h2', {}, 'ユーザー'),
          h('label', { class: 'switch' }, reg, h('span', {}, h('b', {}, '新しい登録を受け付ける'), h('br'),
            h('span', { class: 'hint' }, 'オンにすると、URL を知っている人なら誰でもアカウントを作れます。bot はこのサーバーの中で動くので、信頼できる人だけにしてください。'))),
          h('div', { class: 'user-list' }, d.users.map((u) => h('div', { class: 'user-row' },
            h('div', { class: 'grow' }, h('b', {}, u.username), ' ', u.admin && h('span', { class: 'badge' }, '管理者'),
              h('div', { class: 'hint' }, `bot ${u.bots} 個 ・ ${new Date(u.createdAt).toLocaleDateString('ja-JP')} に登録`)),
            !u.admin && h('button', {
              class: 'btn small danger', onclick: async () => {
                if (!await confirmBox('ユーザーを削除', `${u.username} と、その人の bot (${u.bots} 個) をすべて削除します。`, '削除する')) return;
                try { await api('DELETE', `/api/admin/users/${u.id}`); toast('削除しました'); draw(); } catch (e) { toast(e.message, true); }
              },
            }, '削除')))))));
  };
  await draw();
}

// ---------- 画面の切り替え ----------
let lastHash = location.hash;
async function render() {
  cleanup();
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (!state.config) state.config = await api('GET', '/api/config');
    if (parts[0] === 'login' || parts[0] === 'register') {
      if (state.user) return go('#/');
      return renderAuth(parts[0]);
    }
    if (!state.user) {
      try { state.user = (await api('GET', '/api/me')).user; } catch { return undefined; }
    }
    if (parts[0] === 'bots' && parts[1]) return await renderBot(parts[1], parts[2]);
    if (parts[0] === 'admin' && state.user.admin) return await renderAdmin();
    return await renderList();
  } catch (e) {
    fill($app, state.user ? topbar() : null, h('main', {}, h('div', { class: 'card empty' }, h('h2', {}, '表示できませんでした'), h('p', {}, e.message),
      h('button', { class: 'btn', onclick: () => render() }, 'もう一度'), ' ', h('a', { class: 'btn', href: '#/' }, '一覧へ'))));
    return undefined;
  }
}

window.addEventListener('hashchange', async () => {
  if (state.guard) {
    const target = location.hash;
    if (!await state.guard()) { history.replaceState(null, '', lastHash); return; }
    history.replaceState(null, '', target);
  }
  lastHash = location.hash;
  render();
});
render();

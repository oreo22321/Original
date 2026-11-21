'use strict';
// BotHost の画面 (フレームワークなし)

// ================= 小さな道具 =================
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

// ----- アイコン (24×24 の線画) -----
const ICONS = {
  play: [['path', { d: 'M7 4.5v15l12.5-7.5z' }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }]],
  restart: [['path', { d: 'M20.5 12a8.5 8.5 0 1 1-2.5-6' }], ['path', { d: 'M20.5 4v5h-5' }]],
  terminal: [['path', { d: 'M5 17l5-5-5-5' }], ['path', { d: 'M12.5 18h7' }]],
  folder: [['path', { d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z' }]],
  file: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 3v5h5' }]],
  settings: [['path', { d: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1' }], ['circle', { cx: 15, cy: 7, r: 2 }], ['circle', { cx: 9, cy: 12, r: 2 }], ['circle', { cx: 17, cy: 17, r: 2 }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  upload: [['path', { d: 'M12 15V4M7.5 8.5 12 4l4.5 4.5' }], ['path', { d: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }]],
  download: [['path', { d: 'M12 4v11M7.5 10.5 12 15l4.5-4.5' }], ['path', { d: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }]],
  trash: [['path', { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7' }]],
  edit: [['path', { d: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z' }]],
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['path', { d: 'M20 20l-4.2-4.2' }]],
  bell: [['path', { d: 'M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z' }], ['path', { d: 'M10 20.5h4' }]],
  shield: [['path', { d: 'M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z' }], ['path', { d: 'M9 12l2 2 4-4' }]],
  logout: [['path', { d: 'M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3' }], ['path', { d: 'M15.5 16.5 20 12l-4.5-4.5M20 12H9' }]],
  user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4.5 20.5a7.5 7.5 0 0 1 15 0' }]],
  back: [['path', { d: 'M15 18l-6-6 6-6' }]],
  chevron: [['path', { d: 'M9 18l6-6-6-6' }]],
  down: [['path', { d: 'M6 9l6 6 6-6' }]],
  cpu: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }], ['path', { d: 'M9.5 2.5v3M14.5 2.5v3M9.5 18.5v3M14.5 18.5v3M2.5 9.5h3M2.5 14.5h3M18.5 9.5h3M18.5 14.5h3' }]],
  memory: [['path', { d: 'M3 12h4l2.5-6 5 12 2.5-6h4' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7.5V12l3 2' }]],
  grid: [['rect', { x: 4, y: 4, width: 6.5, height: 6.5, rx: 1.5 }], ['rect', { x: 13.5, y: 4, width: 6.5, height: 6.5, rx: 1.5 }], ['rect', { x: 4, y: 13.5, width: 6.5, height: 6.5, rx: 1.5 }], ['rect', { x: 13.5, y: 13.5, width: 6.5, height: 6.5, rx: 1.5 }]],
  menu: [['path', { d: 'M4 7h16M4 12h16M4 17h16' }]],
  more: [['circle', { cx: 5.5, cy: 12, r: 1.2 }], ['circle', { cx: 12, cy: 12, r: 1.2 }], ['circle', { cx: 18.5, cy: 12, r: 1.2 }]],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  checkCircle: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M8 12.5l3 3 5-6' }]],
  alert: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7.5v5.5M12 16.5h.01' }]],
  x: [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
  key: [['circle', { cx: 8, cy: 15, r: 4 }], ['path', { d: 'M11 12l8.5-8.5M16.5 6.5l2.5 2.5' }]],
  chat: [['path', { d: 'M20 15a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z' }]],
  zap: [['path', { d: 'M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z' }]],
  package: [['path', { d: 'M20.5 7.5 12 3 3.5 7.5 12 12z' }], ['path', { d: 'M3.5 7.5v9L12 21l8.5-4.5v-9M12 12v9' }]],
  link: [['path', { d: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1' }], ['path', { d: 'M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1' }]],
  copy: [['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }], ['path', { d: 'M5 15V6a2 2 0 0 1 2-2h8' }]],
  eye: [['path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' }], ['circle', { cx: 12, cy: 12, r: 2.8 }]],
  server: [['rect', { x: 3.5, y: 4, width: 17, height: 7, rx: 2 }], ['rect', { x: 3.5, y: 13, width: 17, height: 7, rx: 2 }], ['path', { d: 'M7.5 7.5h.01M7.5 16.5h.01' }]],
  cloud: [['path', { d: 'M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18.5z' }]],
  lock: [['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 10.5V7.5a4 4 0 0 1 8 0v3' }]],
  zip: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M11 5h2M11 8h2M11 11h2M10.5 14h3v3h-3z' }]],
  python: [['path', { d: 'M12 3c-4 0-4 1.8-4 3v2h4v1H6c-2 0-3 1.5-3 4s1 4 3 4h2v-2.5c0-1.5 1-2.5 2.5-2.5h4c1.5 0 2.5-1 2.5-2.5V6c0-1.2-1-3-5-3z' }], ['path', { d: 'M12 21c4 0 4-1.8 4-3v-2h-4v-1h6c2 0 3-1.5 3-4s-1-4-3-4h-2v2.5c0 1.5-1 2.5-2.5 2.5h-4C8 12 7 13 7 14.5V18c0 1.2 1 3 5 3z' }]],
  node: [['path', { d: 'M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z' }], ['path', { d: 'M12 8v8' }]],
};
function icon(name, cls = '') {
  return h('svg:svg', { class: `ic ${cls}`.trim(), viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    (ICONS[name] || []).map(([tag, attrs]) => h(`svg:${tag}`, attrs)));
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
      signedOut();
    }
    throw new Error(msg);
  }
  if (raw) return res;
  const type = res.headers.get('Content-Type') || '';
  return type.includes('json') ? res.json() : res.text();
}

function toast(msg, bad = false) {
  const el = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: bad ? 'alert' : 'status' }, icon(bad ? 'alert' : 'checkCircle'), h('div', {}, msg));
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), bad ? 5500 : 2800);
}

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

function download(url) {
  const a = h('a', { href: url, download: '' });
  document.body.append(a); a.click(); a.remove();
}

const STATUS_LABEL = { running: '動作中', stopped: '停止中', installing: '準備中', restarting: '再起動待ち', crashed: 'エラーで停止' };
const RUNTIME_LABEL = { python: 'Python', node: 'Node.js' };
const ACTIVE = ['running', 'installing', 'restarting'];

const pill = (status) => h('span', { class: `pill ${status}` }, STATUS_LABEL[status] || status);

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

// 名前から決まる色 (アイコンの背景)
const AV_COLORS = [['#6366f1', '#8b5cf6'], ['#0ea5e9', '#6366f1'], ['#10b981', '#0ea5e9'], ['#f59e0b', '#ef4444'], ['#ec4899', '#8b5cf6'], ['#14b8a6', '#22c55e'], ['#f97316', '#eab308']];
function avatar(bot, cls = '') {
  if (bot.discord && bot.discord.avatarUrl) return h('img', { class: `avatar ${cls}`, src: bot.discord.avatarUrl, alt: '' });
  let n = 0;
  for (const ch of bot.name) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  const [a, b] = AV_COLORS[n % AV_COLORS.length];
  return h('span', { class: `avatar ${cls}`, style: `background:linear-gradient(135deg,${a},${b})`, 'aria-hidden': 'true' }, [...bot.name][0].toUpperCase());
}

function modal(title, body, foot) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); back.dispatchEvent(new Event('closed')); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.append(h('div', { class: 'modal card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', {}, title), body, h('div', { class: 'foot' }, foot(close))));
  document.body.append(back);
  const first = back.querySelector('input:not([type=checkbox]), textarea, select');
  if (first && matchMedia('(hover: hover)').matches) first.focus();
  close.el = back;
  return close;
}

function confirmBox(title, text, okLabel, danger = true) {
  return new Promise((resolve) => {
    let ok = false;
    const close = modal(title, h('p', { style: 'margin:0;color:var(--text-2)' }, text), (c) => [
      h('button', { class: 'btn', onclick: c }, 'やめる'),
      h('button', { class: 'btn ' + (danger ? 'danger solid' : 'primary'), onclick: () => { ok = true; c(); } }, okLabel),
    ]);
    close.el.addEventListener('closed', () => resolve(ok));
  });
}

function choiceBox(title, text, choices) {
  return new Promise((resolve) => {
    let picked = null;
    const close = modal(title, h('p', { style: 'margin:0;color:var(--text-2)' }, text), (c) => [
      h('button', { class: 'btn', onclick: c }, 'やめる'),
      ...choices.map((ch) => h('button', { class: 'btn ' + (ch.primary ? 'primary' : ''), onclick: () => { picked = ch.value; c(); } }, ch.label)),
    ]);
    close.el.addEventListener('closed', () => resolve(picked));
  });
}

// ボタンの下に出す小さなメニュー
function popMenu(anchor, items) {
  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'menu card', role: 'menu' }, items);
  document.body.append(menu);
  const w = menu.offsetWidth;
  const top = r.bottom + 6 + menu.offsetHeight > innerHeight ? Math.max(8, r.top - menu.offsetHeight - 6) : r.bottom + 6;
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey); });
  menu.addEventListener('click', (e) => { if (e.target.closest('button[data-close], a')) close(); });
  return close;
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: 'display:none' });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

async function copyText(text, label = 'コピーしました') {
  try { await navigator.clipboard.writeText(text); toast(label); } catch { toast('コピーできませんでした', true); }
}

// ================= ログの色 (ANSI) =================
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

// ================= コードの色分け =================
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

// ================= 状態と、リアルタイムの更新 =================
const state = { user: null, config: null, cleanup: [], guard: null, bots: new Map(), stream: null };
const subs = new Set(); // bot の状態が変わったときに呼ぶ

function cleanup() {
  for (const fn of state.cleanup) { try { fn(); } catch { /* 片付けの失敗は無視 */ } }
  state.cleanup = [];
  state.guard = null;
}
function onBots(fn) { subs.add(fn); state.cleanup.push(() => subs.delete(fn)); }
function emitBots(id) { for (const fn of subs) { try { fn(id); } catch (e) { console.error(e); } } }

async function loadBots() {
  const { bots } = await api('GET', '/api/bots');
  state.bots = new Map(bots.map((b) => [b.id, b]));
  emitBots(null);
  return bots;
}
function putBot(b) { state.bots.set(b.id, { ...(state.bots.get(b.id) || {}), ...b }); emitBots(b.id); }
// 操作の返事で、設定だけを更新する (動作の状態はリアルタイムで届くので、古い状態で上書きしない)
const LIVE_KEYS = ['status', 'startedAt', 'stats', 'restarts', 'restartAt', 'exitCode', 'lastExit'];
function putBotConfig(b) {
  const cur = state.bots.get(b.id);
  if (!cur || !state.stream || state.stream.readyState !== 1) { putBot(b); return; }
  const next = { ...b };
  for (const k of LIVE_KEYS) delete next[k];
  putBot(next);
}

// 自分の bot 全部の状態と使用量 (一覧・サイドバー用)
function openStream() {
  if (state.stream) return;
  const es = new EventSource('/api/stream');
  es.addEventListener('status', (e) => {
    const d = JSON.parse(e.data);
    const b = state.bots.get(d.id);
    if (!b) return;
    Object.assign(b, d);
    if (!ACTIVE.includes(d.status)) b.stats = null;
    emitBots(d.id);
  });
  es.addEventListener('stats', (e) => {
    const d = JSON.parse(e.data);
    const b = state.bots.get(d.id);
    if (!b) return;
    b.stats = { memoryMB: d.memoryMB, cpuPercent: d.cpuPercent };
    emitBots(d.id);
  });
  state.stream = es;
}
function signedOut() {
  state.user = null;
  if (state.stream) { state.stream.close(); state.stream = null; }
  state.bots = new Map();
  go('#/login');
}

// ================= テーマ =================
function getTheme() { try { return localStorage.getItem('bothost-theme') || 'system'; } catch { return 'system'; } }
function setTheme(t) {
  try { if (t === 'system') localStorage.removeItem('bothost-theme'); else localStorage.setItem('bothost-theme', t); } catch { /* 保存できない */ }
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

// ================= 全体の枠 (サイドバー・上のバー) =================
function userMenu(anchor) {
  const themeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'テーマ' });
  const drawSeg = () => fill(themeSeg, [['system', '端末'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, l]) =>
    h('button', { type: 'button', class: getTheme() === v ? 'on' : '', onclick: () => { setTheme(v); drawSeg(); } }, l)));
  drawSeg();
  popMenu(anchor, [
    h('div', { class: 'who' }, h('span', { class: 'avatar sm' }, icon('user', 'sm')), h('div', { class: 'grow' }, h('b', {}, state.user.username), h('span', {}, state.user.admin ? '管理者' : 'ユーザー'))),
    h('hr'),
    themeSeg,
    h('button', { 'data-close': '', onclick: openPassword }, icon('key'), 'パスワードを変える'),
    state.user.admin && h('a', { href: '#/admin' }, icon('shield'), '管理'),
    h('hr'),
    h('button', {
      'data-close': '', onclick: async () => { await api('POST', '/api/logout').catch(() => {}); signedOut(); },
    }, icon('logout'), 'ログアウト'),
  ]);
}

function sidebar(active) {
  const list = h('div', { class: 'nav nav-bots' });
  const draw = () => {
    const bots = [...state.bots.values()];
    fill(list, bots.length
      ? bots.map((b) => h('a', { href: `#/bots/${b.id}`, class: active === b.id ? 'on' : '', title: b.name },
        h('span', { class: `dot ${b.status}`, 'aria-label': STATUS_LABEL[b.status] }), h('span', { class: 'nm' }, b.name)))
      : h('p', { class: 'hint', style: 'padding:4px 10px;margin:0' }, 'まだありません'));
  };
  draw();
  onBots(draw);
  const menuBtn = h('button', { class: 'btn ghost icon sm', 'aria-label': 'メニュー', onclick: (e) => userMenu(e.currentTarget) }, icon('more'));
  return h('aside', { class: 'sidebar' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: '/icon.svg', alt: '' }), 'BotHost'),
    h('nav', { class: 'nav' },
      h('a', { href: '#/', class: active === 'home' ? 'on' : '' }, icon('grid'), 'ダッシュボード'),
      state.user.admin && h('a', { href: '#/admin', class: active === 'admin' ? 'on' : '' }, icon('shield'), '管理')),
    h('div', { class: 'nav-title' }, h('span', {}, 'bot'), h('button', { class: 'btn ghost icon sm', 'aria-label': '新しい bot', title: '新しい bot', onclick: openNewBot }, icon('plus', 'sm'))),
    list,
    h('div', { class: 'sidebar-foot' },
      h('div', { class: 'who' }, h('span', { class: 'avatar sm' }, icon('user', 'sm')),
        h('div', { class: 'grow' }, h('b', {}, state.user.username), h('span', {}, state.user.admin ? '管理者' : 'ユーザー')), menuBtn)));
}

function topbar({ title, back }) {
  return h('header', { class: 'topbar' },
    back
      ? h('a', { class: 'btn ghost icon', href: back, 'aria-label': '戻る' }, icon('back', 'lg'))
      : h('a', { class: 'brand', href: '#/' }, h('img', { src: '/icon.svg', alt: '' }), title ? null : 'BotHost'),
    h('div', { class: 'title' }, title || ''),
    h('button', { class: 'btn ghost icon', 'aria-label': 'メニュー', onclick: (e) => userMenu(e.currentTarget) }, icon('menu', 'lg')));
}

function shell({ active, title, back, bottomTabs }, ...content) {
  const main = h('main', {}, ...content);
  fill($app, h('div', { class: 'shell' + (bottomTabs ? ' has-bottom-tabs' : '') },
    sidebar(active),
    h('div', { class: 'content' }, topbar({ title, back }), main, bottomTabs || null)));
  document.title = title ? `${title} - BotHost` : 'BotHost';
  document.body.classList.toggle('with-tabs', !!bottomTabs);
  return main;
}

// ================= ログイン / 登録 =================
function renderAuth(mode) {
  const cfg = state.config;
  if (cfg.firstUser) mode = 'register';
  if (!cfg.registrationOpen) mode = 'login';
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true, enterkeyhint: 'next' });
  const pass = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, enterkeyhint: 'go' });
  const err = h('div', { class: 'error-text' });
  const submit = h('button', { class: 'btn primary block', type: 'submit', style: 'min-height:44px' }, mode === 'login' ? 'ログイン' : 'アカウントを作る');
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

  document.title = 'BotHost';
  fill($app, h('div', { class: 'auth-wrap' }, h('div', {},
    h('div', { class: 'auth card' },
      h('div', { class: 'logo' }, h('img', { src: '/icon.svg', alt: '' }), h('h1', {}, 'BotHost'), h('p', {}, 'Discord などの bot を、24 時間動かしておく場所')),
      cfg.firstUser && h('div', { class: 'banner' }, icon('user'), h('div', {}, 'はじめまして！ 最初に作るアカウントが管理者になります。')),
      cfg.registrationOpen && !cfg.firstUser && h('div', { class: 'seg' },
        h('button', { type: 'button', class: mode === 'login' ? 'on' : '', onclick: () => go('#/login') }, 'ログイン'),
        h('button', { type: 'button', class: mode === 'register' ? 'on' : '', onclick: () => go('#/register') }, '新しく登録')),
      form),
    h('div', { class: 'auth-foot' }, icon('lock', 'sm'), '通信は暗号化され、bot はサーバーで 24 時間動きます'))));
  if (matchMedia('(hover: hover)').matches) user.focus();
}

function openPassword() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = h('div', { class: 'error-text' });
  modal('パスワードを変える', [
    h('label', { class: 'field' }, h('span', {}, '今のパスワード'), cur),
    h('label', { class: 'field' }, h('span', {}, '新しいパスワード (8 文字以上)'), next),
    h('p', { class: 'hint', style: 'margin:0 0 8px' }, '変えると、ほかの端末のログインは切れます。'),
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

// ================= ダッシュボード =================
async function botAction(id, action, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api('POST', `/api/bots/${id}/${action}`);
    putBotConfig(r.bot);
    return r.bot;
  } catch (e) { toast(e.message, true); return null; } finally { if (btn) btn.disabled = false; }
}

function memBar(b) {
  const mb = b.stats ? b.stats.memoryMB : 0;
  const pct = b.memoryLimitMB ? Math.min(100, (mb / b.memoryLimitMB) * 100) : 0;
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'メモリ' },
    h('i', { class: pct > 90 ? 'over' : pct > 70 ? 'hot' : '', style: `width:${pct}%` }));
}

function botCard(b) {
  const actions = h('div', { style: 'display:flex;gap:6px' });
  const meta = h('div', { class: 'meta' });
  const bars = h('div', { class: 'bar-row' });
  const top = h('div', { class: 'top' });
  const footText = h('div', { class: 'grow' });
  const el = h('div', {
    class: 'bot-card card', role: 'link', tabindex: '0', 'aria-label': `${b.name} を開く`,
    onclick: (e) => { if (!e.target.closest('button')) go(`#/bots/${b.id}`); },
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === el) go(`#/bots/${b.id}`); },
  }, top, bars, h('div', { class: 'foot' }, footText, actions));
  const draw = () => {
    const bot = state.bots.get(b.id) || b;
    const active = ACTIVE.includes(bot.status);
    fill(top, avatar(bot), h('div', { class: 'grow' }, h('div', { class: 'name' }, bot.name), meta), pill(bot.status));
    fill(meta, h('span', {}, RUNTIME_LABEL[bot.runtime] || bot.runtime), '·', h('span', {}, bot.status === 'running' ? `稼働 ${uptime(bot.startedAt)}` : bot.lastCrashAt ? `最後に落ちた: ${ago(bot.lastCrashAt)}` : '停止中'));
    fill(bars, h('span', {}, 'メモリ'), h('span', { class: 'nowrap' }, bot.stats ? `${bot.stats.memoryMB} / ${bot.memoryLimitMB} MB` : `— / ${bot.memoryLimitMB} MB`), memBar(bot));
    fill(footText, bot.stats && bot.stats.cpuPercent !== null && bot.stats.cpuPercent !== undefined ? `CPU ${bot.stats.cpuPercent}%` : bot.autoRestart ? '落ちたら自動で再起動' : '');
    fill(actions, active
      ? [h('button', { class: 'btn sm icon', title: '再起動', 'aria-label': '再起動', onclick: (e) => botAction(bot.id, 'restart', e.currentTarget) }, icon('restart', 'sm')),
        h('button', { class: 'btn sm danger', onclick: (e) => botAction(bot.id, 'stop', e.currentTarget) }, icon('stop', 'sm'), '停止')]
      : [h('button', { class: 'btn sm primary', onclick: (e) => botAction(bot.id, 'start', e.currentTarget) }, icon('play', 'sm'), '起動')]);
  };
  draw();
  el.draw = draw;
  return el;
}

async function renderDashboard() {
  const main = shell({ active: 'home' }, h('div', { class: 'grid' }, [1, 2, 3].map(() => h('div', { class: 'card skel', style: 'height:168px' }))));
  const [, health] = await Promise.all([loadBots(), api('GET', '/api/health').catch(() => null)]);
  const tiles = h('div', { class: 'tiles' });
  const grid = h('div', { class: 'grid' });
  const cards = new Map();
  const tile = (ic, k, v, s, cls = '') => h('div', { class: 'tile card' }, h('div', { class: 'k' }, icon(ic, 'sm'), k), h('div', { class: `v ${cls}` }, v), s && h('div', { class: 's' }, s));
  const drawTiles = () => {
    const bots = [...state.bots.values()];
    const running = bots.filter((b) => b.status === 'running').length;
    const crashed = bots.filter((b) => b.status === 'crashed').length;
    const mem = bots.reduce((n, b) => n + (b.stats ? b.stats.memoryMB : 0), 0);
    const ka = health && health.keepAwake;
    const bk = health && health.backup;
    fill(tiles,
      tile('zap', '動作中', [running, h('small', {}, `/ ${bots.length}`)], crashed ? `${crashed} 個がエラーで停止` : running ? 'すべて正常' : '動いている bot はありません', crashed ? 'bad-text' : ''),
      tile('memory', 'メモリ', [Math.round(mem), h('small', {}, 'MB')], '動いている bot の合計'),
      tile('cloud', '24 時間稼働', ka ? (ka.ok === false ? '確認中' : 'オン') : 'オン', ka ? `サイトを閉じても動き続けます${ka.lastAt ? ` (確認 ${ago(ka.lastAt)})` : ''}` : 'サーバーで動き続けます', ka && ka.ok === false ? 'warn-text' : 'ok-text'),
      tile('lock', 'バックアップ', bk ? (bk.ok ? '正常' : '要確認') : 'オフ', bk ? (bk.lastAt ? `保存 ${ago(bk.lastAt)}${bk.encrypted ? '・暗号化' : ''}` : '変更があれば保存します') : '再起動でデータが消えます', bk ? (bk.ok ? 'ok-text' : 'warn-text') : 'warn-text'));
  };
  const drawGrid = () => {
    const bots = [...state.bots.values()];
    if (!bots.length) {
      fill(main, h('div', { class: 'page-head' }, h('h1', {}, 'ダッシュボード')), tiles, h('div', { class: 'card empty' },
        h('div', { class: 'art' }, icon('chat', 'lg')),
        h('h2', {}, '最初の bot を作りましょう'),
        h('p', {}, 'テンプレートを選ぶだけで、すぐに動く Discord bot ができます。'),
        h('ol', { class: 'steps' },
          h('li', {}, h('span', { class: 'n' }, '1'), 'テンプレートを選んで作る'),
          h('li', {}, h('span', { class: 'n' }, '2'), 'Discord の bot のトークンを入れる (取り方も案内します)'),
          h('li', {}, h('span', { class: 'n' }, '3'), '▶ 起動。あとはサイトを閉じても動き続けます')),
        h('button', { class: 'btn primary', onclick: openNewBot }, icon('plus'), '新しい bot')));
      return;
    }
    cards.clear();
    fill(grid, bots.map((b) => { const c = botCard(b); cards.set(b.id, c); return c; }),
      h('button', { class: 'new-card', onclick: openNewBot }, h('div', {}, icon('plus', 'lg'), '新しい bot')));
    fill(main,
      h('div', { class: 'page-head' }, h('h1', {}, 'ダッシュボード'), h('button', { class: 'btn primary', onclick: openNewBot }, icon('plus'), '新しい bot')),
      tiles, grid);
  };
  drawTiles();
  drawGrid();
  onBots((id) => {
    if (id && cards.has(id)) cards.get(id).draw(); else drawGrid();
    drawTiles();
  });
  const t = setInterval(() => {
    if (document.hidden) return;
    for (const c of cards.values()) c.draw();
  }, 1000);
  state.cleanup.push(() => clearInterval(t));
}

function openNewBot() {
  const templates = state.config.templates;
  let chosen = templates[0].id;
  const name = h('input', { type: 'text', placeholder: '例: my-bot', maxlength: 40 });
  const err = h('div', { class: 'error-text' });
  const tplWrap = h('div', { class: 'templates', role: 'radiogroup', 'aria-label': 'テンプレート' });
  const tplIcon = (t) => (t.id.includes('discord') ? 'chat' : t.runtime === 'node' ? 'node' : 'python');
  const drawTpl = () => fill(tplWrap, templates.map((t) => h('button', {
    type: 'button', class: 'tpl' + (t.id === chosen ? ' on' : ''), role: 'radio', 'aria-checked': String(t.id === chosen), onclick: () => { chosen = t.id; drawTpl(); },
  }, icon(tplIcon(t)), h('span', {}, h('b', {}, t.label), h('span', { class: 'd' }, t.desc || '')))));
  drawTpl();
  const create = async (close, btn) => {
    if (btn) btn.disabled = true;
    try {
      const { bot } = await api('POST', '/api/bots', { name: name.value.trim() || 'my-bot', template: chosen });
      putBot(bot);
      close();
      const isDiscord = chosen.includes('discord');
      go(`#/bots/${bot.id}/${isDiscord ? 'settings' : 'console'}`);
      if (isDiscord) toast('次に Discord のトークンを入れてください');
    } catch (e) { err.textContent = e.message; if (btn) btn.disabled = false; }
  };
  const close = modal('新しい bot', [
    h('label', { class: 'field' }, h('span', {}, '名前'), name),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'テンプレート'), tplWrap),
    h('p', { class: 'hint', style: 'margin:0' }, '自分のコードは、作ったあとに「ファイル」で ZIP を読み込めます。'),
    err,
  ], (c) => [h('button', { class: 'btn', onclick: c }, 'やめる'), h('button', { class: 'btn primary', onclick: (e) => create(c, e.currentTarget) }, '作る')]);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) create(close); });
}

// ================= bot の画面 =================
function sparkline(points, limit) {
  const w = 120; const hgt = 22;
  if (points.length < 2) return h('div', { style: 'height:22px' });
  const vals = points.map((p) => p[1]);
  const max = Math.max(limit || 0, ...vals, 1);
  const step = w / (points.length - 1);
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(hgt - 2 - (v / max) * (hgt - 4)).toFixed(1)}`);
  return h('svg:svg', { class: 'spark', viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    h('svg:polygon', { points: `0,${hgt} ${pts.join(' ')} ${w},${hgt}`, fill: 'currentColor', opacity: '.12' }),
    h('svg:polyline', { points: pts.join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
}

async function renderBot(id, tab) {
  tab = ['console', 'files', 'settings'].includes(tab) ? tab : 'console';
  if (!state.bots.size) await loadBots().catch(() => {});
  let { bot } = await api('GET', `/api/bots/${id}`);
  putBot(bot);

  const hero = h('div', { class: 'bot-hero' });
  const stats = h('div', { class: 'stat-row' });
  const connEl = h('span', { class: 'conn' }, icon('alert', 'sm'), '再接続中…');
  connEl.hidden = true;
  const live = { ...bot, history: [] };

  const act = (path) => async (e) => {
    const b = await botAction(id, path, e.currentTarget);
    if (b) bot = b; // 状態はリアルタイム (SSE) で届くので、ここでは live を上書きしない
    drawHead();
  };
  const drawHead = () => {
    const active = ACTIVE.includes(live.status);
    fill(hero,
      avatar(bot, 'lg'),
      h('div', { class: 'title' },
        h('h1', {}, bot.name, pill(live.status)),
        h('div', { class: 'meta' },
          h('span', { class: 'badge' }, icon(bot.runtime === 'node' ? 'node' : 'python', 'sm'), RUNTIME_LABEL[bot.runtime] || bot.runtime),
          bot.discord && h('span', { class: 'badge accent' }, icon('chat', 'sm'), bot.discord.username),
          h('span', {}, bot.autoRestart ? '落ちたら自動で再起動' : '自動の再起動はオフ'),
          connEl)),
      h('div', { class: 'actions' }, active
        ? [h('button', { class: 'btn', onclick: act('restart') }, icon('restart'), '再起動'), h('button', { class: 'btn danger', onclick: act('stop') }, icon('stop'), '停止')]
        : [h('button', { class: 'btn primary', onclick: act('start') }, icon('play'), '起動')]));
    drawStats();
  };
  const drawStats = () => {
    const waiting = live.status === 'restarting' && live.restartAt ? Math.max(0, Math.ceil((live.restartAt - Date.now()) / 1000)) : null;
    const st = (ic, k, v, extra) => h('div', { class: 'stat card' }, h('div', { class: 'k' }, icon(ic, 'sm'), k), h('div', { class: 'v' }, v), extra || null);
    fill(stats,
      st('clock', '稼働時間', waiting !== null ? h('span', { class: 'warn-text' }, `${waiting} 秒後に再起動`) : live.status === 'running' ? uptime(live.startedAt) : live.status === 'installing' ? h('span', { class: 'warn-text' }, '準備中…') : '—'),
      st('cpu', 'CPU', live.stats && live.stats.cpuPercent !== null && live.stats.cpuPercent !== undefined ? `${live.stats.cpuPercent}%` : '—'),
      st('memory', 'メモリ', [live.stats ? `${live.stats.memoryMB}` : '—', h('small', {}, ` / ${bot.memoryLimitMB} MB`)], live.status === 'running' ? sparkline(live.history, bot.memoryLimitMB) : null),
      st('restart', '自動再起動', [`${live.restarts || 0}`, h('small', {}, ' 回')], bot.lastCrashAt ? h('div', { class: 'hint', style: 'font-size:12px' }, `最後に落ちた: ${ago(bot.lastCrashAt)}`) : null));
  };
  drawHead();
  const tick = setInterval(() => { if (!document.hidden) drawStats(); }, 1000);
  state.cleanup.push(() => clearInterval(tick));

  const body = h('div');
  const tabs = [['console', 'コンソール', 'terminal'], ['files', 'ファイル', 'folder'], ['settings', '設定', 'settings']];
  const tabLink = ([key, label, ic]) => h('a', { href: `#/bots/${id}/${key}`, class: tab === key ? 'on' : '', 'aria-current': tab === key ? 'page' : null }, icon(ic), label);
  shell({ active: id, title: bot.name, back: '#/', bottomTabs: h('nav', { class: 'bottom-tabs', 'aria-label': 'bot のメニュー' }, tabs.map(tabLink)) },
    h('a', { class: 'crumb', href: '#/' }, icon('back', 'sm'), 'ダッシュボード'),
    hero, stats,
    h('nav', { class: 'tabs', 'aria-label': 'bot のメニュー' }, tabs.map(tabLink)),
    body);

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

  const update = (b) => { bot = b; putBotConfig(b); drawHead(); };
  if (tab === 'console') body.append(logView.el);
  else if (tab === 'files') await renderFiles(id, bot, body, () => live.status);
  else renderSettings(bot, body, update);
}

function createLogView(id) {
  const log = h('div', { class: 'log', tabindex: '0', role: 'log', 'aria-live': 'off', 'aria-label': 'bot の出力' });
  let entries = [];
  let follow = true;
  let filter = '';
  let errorsOnly = false;
  let queue = [];
  let frame = 0;
  const MAX = 3000;
  const SHOW = 1500;

  const jump = h('button', { class: 'btn sm primary jump', hidden: true, onclick: () => { follow = true; log.scrollTop = log.scrollHeight; jump.hidden = true; } }, icon('down', 'sm'), '最新へ');
  log.addEventListener('scroll', () => {
    follow = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    jump.hidden = follow;
  }, { passive: true });
  const time = (t) => new Date(t).toLocaleTimeString('ja-JP', { hour12: false });
  const match = (e) => (!errorsOnly || e.s === 'err' || (e.s === 'sys' && /失敗|エラー|落ち|超え|見つかりません|ありません|やめました/.test(e.l)))
    && (!filter || stripAnsi(e.l).toLowerCase().includes(filter));
  const line = (e) => h('div', { class: 'ln' }, h('span', { class: 'ts' }, time(e.t)), h('span', { class: e.s }, ansiNodes(e.l)));
  const placeholder = () => h('div', { class: 'placeholder' },
    filter || errorsOnly ? '当てはまる行はありません。' : 'まだ出力はありません。「起動」を押すと、ここに bot の出力が流れます。');
  const redraw = () => {
    const shown = entries.filter(match).slice(-SHOW);
    fill(log, shown.length ? shown.map(line) : placeholder());
    log.scrollTop = log.scrollHeight;
  };
  // 新しい行は、画面の描き直し 1 回分ずつまとめて足す (大量のログでも固まらないように)
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
    if (follow) log.scrollTop = log.scrollHeight; else jump.hidden = false;
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
  const search = h('input', { type: 'search', placeholder: 'ログを絞り込む', 'aria-label': 'ログを絞り込む', autocapitalize: 'off', spellcheck: 'false' });
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter = search.value.trim().toLowerCase(); redraw(); }, 150);
  });
  const errBox = h('input', { type: 'checkbox', onchange: () => { errorsOnly = errBox.checked; redraw(); } });

  const input = h('input', { type: 'text', placeholder: '標準入力に送る (input() など)', 'aria-label': '標準入力', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', enterkeyhint: 'send' });
  const sendIn = async () => {
    if (!input.value) return;
    try { await api('POST', `/api/bots/${id}/stdin`, { text: input.value }); input.value = ''; } catch (e) { toast(e.message, true); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendIn(); });
  view.el = h('div', { class: 'console' },
    h('div', { class: 'console-bar' },
      h('div', { class: 'search' }, icon('search', 'sm'), search),
      h('label', { class: 'check' }, errBox, 'エラーだけ'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm', onclick: () => download(`/api/bots/${id}/logs.txt`) }, icon('download', 'sm'), '保存'),
      h('button', {
        class: 'btn sm', onclick: async () => {
          if (!await confirmBox('ログを消去', 'この画面と、保存されたログをすべて消します。', '消去する')) return;
          await api('DELETE', `/api/bots/${id}/logs`); view.reset([]);
        },
      }, icon('trash', 'sm'), '消去')),
    h('div', { class: 'console-body' }, log, jump),
    h('div', { class: 'stdin' }, input, h('button', { class: 'btn sm', onclick: sendIn }, '送る')));
  return view;
}

// ================= ファイル =================
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
          }, icon(collapsed.has(dir) ? 'chevron' : 'down', 'sm'), h('span', { class: 'nm' }, parts[i])));
        }
        if (collapsed.has(dir)) hiddenByParent = true;
      }
      if (hiddenByParent) continue;
      rows.push(h('button', {
        class: 'file-item' + (current && current.path === f.path ? ' on' : ''),
        style: `padding-left:${9 + (parts.length - 1) * 14}px`,
        title: f.path,
        onclick: async () => { if (await confirmLeave()) open(f.path); },
      }, icon('file', 'sm'), h('span', { class: 'nm' }, parts[parts.length - 1]), h('span', { class: 'size' }, fmtSize(f.size))));
    }
    fill(listEl,
      h('div', { class: 'tools' },
        h('button', { class: 'btn sm', onclick: newFile }, icon('plus', 'sm'), '新規'),
        h('button', {
          class: 'btn sm', onclick: () => {
            const input = h('input', { type: 'file', multiple: true, style: 'display:none' });
            input.addEventListener('change', () => { uploadFiles([...input.files]); input.remove(); });
            document.body.append(input); input.click();
          },
        }, icon('upload', 'sm'), 'アップロード'),
        h('button', { class: 'btn sm', onclick: async () => { const f = await pickFile('.zip,application/zip'); if (f) importZip(f); } }, icon('zip', 'sm'), 'ZIP 読込'),
        h('button', { class: 'btn sm', onclick: () => download(`/api/bots/${id}/export`) }, icon('download', 'sm'), 'ZIP 保存')),
      rows.length ? rows : h('p', { class: 'hint', style: 'padding:6px' }, 'ファイルがありません'),
      hidden.length ? h('p', { class: 'hint small-hint' }, `ライブラリなどのフォルダー (${hidden.join(', ')}) は表示していません`) : null,
      h('p', { class: 'hint small-hint drop-hint' }, 'ここにファイルや ZIP をドロップしても入れられます'));
    return files;
  };
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
    fill(editorEl, h('div', { class: 'no-file' }, icon('file', 'lg'), '左のファイルを選ぶと、ここで編集できます。'));
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
        class: 'btn sm icon', title: '名前を変える', 'aria-label': '名前を変える', onclick: () => {
          const input = h('input', { type: 'text', value: p, autocapitalize: 'off', spellcheck: 'false' });
          modal('名前を変える', h('label', { class: 'field' }, h('span', {}, '新しい名前'), input), (close) => [
            h('button', { class: 'btn', onclick: close }, 'やめる'),
            h('button', {
              class: 'btn primary', onclick: async () => {
                try { await api('POST', `/api/bots/${id}/rename`, { from: p, to: input.value.trim() }); close(); open(input.value.trim()); } catch (e) { toast(e.message, true); }
              },
            }, '変える')]);
        },
      }, icon('edit', 'sm')),
      h('button', {
        class: 'btn sm icon danger', title: '削除', 'aria-label': '削除', onclick: async () => {
          if (!await confirmBox('ファイルを削除', `${p} を削除します。元には戻せません。`, '削除する')) return;
          await api('DELETE', `/api/bots/${id}/file?path=${encodeURIComponent(p)}`);
          showEmpty(); refresh(); toast('削除しました');
        },
      }, icon('trash', 'sm')),
    ];
    if (text === null) {
      fill(editorEl,
        h('div', { class: 'editor-bar' }, h('span', { class: 'path' }, p), ...actionsBar),
        h('div', { class: 'no-file' }, icon('file', 'lg'), `テキストではないファイルです (${fmtSize(buf.byteLength)})`));
      return;
    }
    const lang = langOf(p);
    const gutter = h('div', { class: 'gutter', 'aria-hidden': 'true' });
    const pre = h('pre', { class: 'hl', 'aria-hidden': 'true' });
    const pos = h('span');
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
    const updatePos = () => {
      const before = code.value.slice(0, code.selectionStart);
      const ln = before.split('\n').length;
      fill(pos, `${ln} 行 ${code.selectionStart - before.lastIndexOf('\n')} 文字目`);
    };
    const paint = () => {
      hlFrame = 0;
      const n = code.value.split('\n').length;
      if (n !== lineCount) { lineCount = n; gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n') + '\n'; }
      if (lang && code.value.length < 300000) { pre.innerHTML = highlight(code.value, lang) + '\n'; code.classList.add('colored'); } else { pre.textContent = ''; code.classList.remove('colored'); }
      sync();
    };
    const schedule = () => { if (!hlFrame) hlFrame = requestAnimationFrame(paint); };
    const saveBtn = h('button', { class: 'btn sm primary', onclick: () => save() }, '保存');
    const save = async () => {
      saveBtn.disabled = true;
      try {
        const value = code.value;
        await api('PUT', `/api/bots/${id}/file?path=${encodeURIComponent(p)}`, value);
        current.original = value; dirty = code.value !== value; dirtyEl.textContent = dirty ? '● 未保存' : '';
        toast(ACTIVE.includes(getStatus()) ? '保存しました (反映するには「再起動」)' : '保存しました');
        refresh();
      } catch (e) { toast(e.message, true); } finally { saveBtn.disabled = false; }
    };
    code.addEventListener('input', () => {
      dirty = code.value !== current.original;
      dirtyEl.textContent = dirty ? '● 未保存' : '';
      schedule();
    });
    code.addEventListener('scroll', sync, { passive: true });
    for (const ev of ['keyup', 'click', 'select']) code.addEventListener(ev, updatePos);
    const indentUnit = '    ';
    code.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
      if (e.isComposing) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b, value } = code;
        if (a !== b && value.slice(a, b).includes('\n')) {
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
        const before = code.value.slice(0, code.selectionStart);
        const cur = before.slice(before.lastIndexOf('\n') + 1);
        let indent = cur.match(/^\s*/)[0];
        if (/[:{[(]\s*$/.test(cur)) indent += indentUnit;
        e.preventDefault();
        document.execCommand('insertText', false, '\n' + indent);
      } else if (e.key === 'Backspace' && code.selectionStart === code.selectionEnd) {
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
      h('div', { class: 'editor-bar' }, icon('file', 'sm'), h('span', { class: 'path' }, p), dirtyEl, ...actionsBar, saveBtn),
      h('div', { class: 'code-wrap' }, gutter, h('div', { class: 'code-area' }, pre, code)),
      h('div', { class: 'editor-foot' }, pos, h('span', {}, lang === 'python' ? 'Python' : lang === 'js' ? 'JavaScript' : lang === 'json' ? 'JSON' : 'テキスト'), h('span', {}, 'UTF-8'), h('span', { class: 'grow' }), h('span', { class: 'hide-touch' }, 'Ctrl/⌘ + S で保存')));
    paint();
    updatePos();
  };

  await openMain();
}

// ================= 設定 =================
function renderSettings(bot, body, onSaved) {
  const docker = state.config.mode === 'docker';
  const isDiscord = (bot.template || '').includes('discord') || !!bot.env.DISCORD_TOKEN;
  const saved = (b, msg) => { onSaved(b); bot = b; if (msg) toast(msg); };
  const redraw = () => renderSettings(bot, body, onSaved);
  const section = (ic, title, hint, ...rest) => h('section', { class: 'section card' }, h('h2', {}, icon(ic), title), hint && h('p', { class: 'hint' }, hint), ...rest);

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
        d.avatarUrl ? h('img', { src: d.avatarUrl, alt: '', class: 'avatar lg' }) : h('span', { class: 'avatar lg' }, d.username.slice(0, 1)),
        h('div', { class: 'grow' },
          h('b', {}, d.username),
          h('div', { class: 'hint' }, d.guilds !== null && d.guilds !== undefined ? `${d.guilds} 個のサーバーに参加 ・ ` : '', `${ago(d.checkedAt)}に確認`),
          warn.length ? h('ul', { class: 'warn-list' }, warn) : null),
        h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: () => copyText(d.inviteUrl, '招待リンクをコピーしました') }, icon('copy', 'sm'), 'コピー'),
          h('a', { class: 'btn primary', href: d.inviteUrl, target: '_blank', rel: 'noopener' }, icon('link', 'sm'), 'サーバーに招待'))));
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
          fill(result, h('div', { class: 'banner bad', style: 'margin-top:12px' }, icon('alert'), h('div', {}, res.error)));
        }
      } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
    };
    const btn = h('button', { class: 'btn primary', onclick: () => check(btn) }, '保存して確認');
    token.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) check(btn); });
    return section('chat', 'Discord', 'bot のトークンを入れて「保存して確認」を押すと、正しいかを調べて、サーバーへの招待リンクを作ります。トークンは環境変数 DISCORD_TOKEN として bot に渡り、画面には出しません。',
      h('div', { class: 'inline-form' }, token, btn),
      result,
      h('details', { class: 'howto', open: !bot.env.DISCORD_TOKEN }, h('summary', {}, 'トークンの取り方'),
        h('ol', {},
          h('li', {}, h('a', { href: 'https://discord.com/developers/applications', target: '_blank', rel: 'noopener' }, 'Discord Developer Portal'), ' を開き、「New Application」で作る'),
          h('li', {}, '左の「Bot」→「Reset Token」→ 出た文字列をコピーして上に貼る'),
          bot.template !== 'python-discord-slash' && h('li', {}, '同じページの「MESSAGE CONTENT INTENT」をオンにして保存'),
          h('li', {}, '「保存して確認」→「サーバーに招待」で自分のサーバーに入れる'),
          h('li', {}, '上の「起動」を押す。あとはサイトを閉じても動き続けます'))));
  };

  const envSection = () => {
    const envRows = h('div');
    const rows = [];
    const addRow = (key = '', existing = false) => {
      const k = h('input', { type: 'text', value: key, placeholder: '名前 (例: API_KEY)', spellcheck: 'false', autocapitalize: 'characters', 'aria-label': '名前' });
      const v = h('input', { type: 'password', placeholder: existing ? '••••••（変えないなら空欄）' : '値', autocomplete: 'off', spellcheck: 'false', 'aria-label': '値' });
      const row = { k, v, existing, original: key, removed: false };
      const show = h('button', { class: 'btn ghost icon', type: 'button', title: '表示', 'aria-label': '値を表示', onclick: () => { v.type = v.type === 'password' ? 'text' : 'password'; } }, icon('eye'));
      const el = h('div', { class: 'env-row' }, k, h('div', { class: 'env-val' }, v, show),
        h('button', { class: 'btn danger', type: 'button', 'aria-label': '削除', onclick: () => { row.removed = true; el.remove(); } }, icon('trash', 'sm')));
      rows.push(row);
      envRows.append(el);
    };
    const keys = Object.keys(bot.env || {}).filter((k) => !(k === 'DISCORD_TOKEN' && isDiscord));
    keys.forEach((key) => addRow(key, true));
    if (!keys.length) addRow();
    const saveEnv = async (btn) => {
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
      btn.disabled = true;
      try {
        const r = await api('PATCH', `/api/bots/${bot.id}`, { env });
        saved(r.bot, '環境変数を保存しました (反映するには「再起動」)');
        redraw();
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    };
    return section('key', '環境変数', 'API キーやパスワードはコードに書かず、ここに入れてください。Python は os.environ["名前"]、Node.js は process.env.名前 で読めます。保存した値は画面には出しません。',
      envRows,
      h('div', { class: 'row-end' },
        h('button', { class: 'btn sm', onclick: () => addRow() }, icon('plus', 'sm'), '追加'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn primary', onclick: (e) => saveEnv(e.currentTarget) }, '環境変数を保存')));
  };

  const notifySection = () => {
    const url = h('input', { type: 'url', placeholder: bot.notify ? '設定済み (変えるときだけ入れる)' : 'https://discord.com/api/webhooks/…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Webhook の URL' });
    const saveBtn = h('button', {
      class: 'btn primary', onclick: async () => {
        if (!url.value.trim()) return;
        try { const r = await api('PATCH', `/api/bots/${bot.id}`, { notifyWebhook: url.value.trim() }); saved(r.bot, '通知先を保存しました'); redraw(); } catch (e) { toast(e.message, true); }
      },
    }, '保存');
    return section('bell', '落ちたときの通知', 'bot が落ちたり止まったりしたら、Discord のチャンネルに知らせます (同じ bot は 10 分に 1 回まで)。チャンネルの設定 → 連携サービス → ウェブフック で URL を作って貼ってください。',
      h('div', { class: 'inline-form' }, url, saveBtn),
      bot.notify && h('div', { class: 'row-end' },
        h('span', { class: 'ok-text', style: 'display:flex;gap:6px;align-items:center;font-weight:600;font-size:14px' }, icon('checkCircle', 'sm'), '通知はオン'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm', onclick: async () => { try { await api('POST', `/api/bots/${bot.id}/notify-test`); toast('テスト通知を送りました'); } catch (e) { toast(e.message, true); } } }, 'テスト通知'),
        h('button', { class: 'btn sm danger', onclick: async () => { const r = await api('PATCH', `/api/bots/${bot.id}`, { notifyWebhook: '' }); saved(r.bot, '通知をオフにしました'); redraw(); } }, 'オフにする')));
  };

  const generalSection = () => {
    const name = h('input', { type: 'text', value: bot.name, maxlength: 40 });
    const cmd = h('input', { type: 'text', value: bot.startCommand, class: 'mono', spellcheck: 'false', autocapitalize: 'off' });
    const auto = h('input', { type: 'checkbox', checked: bot.autoRestart, role: 'switch' });
    const presets = [0, 6, 12, 24, 48, 168];
    const every = h('select', {}, presets.map((v) => h('option', { value: v, selected: bot.restartEveryHours === v ? true : null },
      v === 0 ? 'しない' : v === 168 ? '1 週間ごと' : `${v} 時間ごと`)));
    if (!presets.includes(bot.restartEveryHours)) every.append(h('option', { value: bot.restartEveryHours, selected: true }, `${bot.restartEveryHours} 時間ごと`));
    const mem = h('input', { type: 'number', value: bot.memoryLimitMB, min: 32, max: 4096, step: 32, inputmode: 'numeric' });
    const cpu = h('input', { type: 'number', value: bot.cpuLimit, min: 0.1, max: 4, step: 0.1, inputmode: 'decimal' });
    const saveGeneral = async (btn) => {
      const payload = {
        name: name.value, startCommand: cmd.value, autoRestart: auto.checked,
        restartEveryHours: Number(every.value), memoryLimitMB: Number(mem.value),
      };
      if (docker) payload.cpuLimit = Number(cpu.value);
      btn.disabled = true;
      try { const r = await api('PATCH', `/api/bots/${bot.id}`, payload); saved(r.bot, '保存しました'); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
    };
    return section('settings', '基本', null,
      h('label', { class: 'field' }, h('span', {}, '名前'), name),
      h('label', { class: 'field' }, h('span', {}, '起動コマンド'), cmd,
        h('small', {}, `ふつうは ${state.config.runtimes[bot.runtime].defaultCommand}。${bot.runtime === 'python' ? 'requirements.txt' : 'package.json'} があれば、起動の前にライブラリを自動で入れます。`)),
      h('label', { class: 'switch' }, auto, h('span', {}, h('b', {}, '落ちたら自動で再起動'),
        h('span', { class: 'hint' }, 'エラーで止まったら、少し待ってから起動し直します (5 分で 5 回落ちたらあきらめます)。'))),
      h('div', { class: 'two' },
        h('label', { class: 'field' }, h('span', {}, '定期的に再起動'), every),
        h('label', { class: 'field' }, h('span', {}, 'メモリの上限 (MB)'), mem),
        docker && h('label', { class: 'field' }, h('span', {}, 'CPU の上限 (コア数)'), cpu)),
      h('div', { class: 'row-end' }, h('div', { class: 'grow' }), h('button', { class: 'btn primary', onclick: (e) => saveGeneral(e.currentTarget) }, '保存')));
  };

  const maintenanceSection = () => section('package', 'メンテナンス', null,
    h('div', { class: 'maint' },
      h('div', {}, h('b', {}, 'ライブラリを入れ直す'), h('p', { class: 'hint' }, '入れたライブラリを消して、次の起動で入れ直します。ライブラリの調子がおかしいときに。')),
      h('button', {
        class: 'btn', onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try { await api('POST', `/api/bots/${bot.id}/reinstall`); toast('ライブラリを消しました。起動すると入れ直します'); } catch (err) { toast(err.message, true); }
          b.disabled = false;
        },
      }, icon('restart', 'sm'), '入れ直す')),
    h('div', { class: 'maint' },
      h('div', {}, h('b', {}, 'ファイルを ZIP で保存'), h('p', { class: 'hint' }, 'bot のファイルを全部まとめてダウンロードします (ライブラリは含めません)。')),
      h('button', { class: 'btn', onclick: () => download(`/api/bots/${bot.id}/export`) }, icon('download', 'sm'), 'ダウンロード')));

  const dangerSection = () => h('section', { class: 'section card danger-zone' },
    h('h2', {}, icon('trash'), 'bot を削除'),
    h('p', { class: 'hint' }, 'bot を止めて、ファイルと設定とログをすべて消します。元には戻せません。'),
    h('button', {
      class: 'btn danger solid', onclick: async () => {
        if (!await confirmBox('bot を削除', `「${bot.name}」を削除します。ファイルもすべて消えます。`, '削除する')) return;
        await api('DELETE', `/api/bots/${bot.id}`);
        state.bots.delete(bot.id); emitBots(null);
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

// ================= 管理 =================
async function renderAdmin() {
  const main = shell({ active: 'admin', title: '管理', back: '#/' }, h('div', { class: 'card skel', style: 'height:220px' }));
  const draw = async () => {
    const d = await api('GET', '/api/admin');
    const s = d.server;
    const reg = h('input', {
      type: 'checkbox', role: 'switch', checked: d.settings.registrationOpen, onchange: async () => {
        try { await api('PATCH', '/api/admin/settings', { registrationOpen: reg.checked }); toast(reg.checked ? '新しい登録を受け付けます' : '新しい登録を止めました'); } catch (e) { toast(e.message, true); }
      },
    });
    const b = d.backup;
    const sec = d.security || {};
    const ka = d.keepAwake;
    const kv = (pairs) => h('div', { class: 'kv' }, pairs.filter(Boolean).map(([k, v, cls]) => [h('span', {}, k), h('b', { class: cls || null }, v)]));
    const okLine = (ok, text, sub) => h('div', {}, icon(ok ? 'checkCircle' : 'alert'), h('div', {}, h('b', { class: ok ? '' : 'warn-text' }, text), sub && h('div', { class: 'hint' }, sub)));
    const section = (ic, title, ...rest) => h('section', { class: 'section card' }, h('h2', {}, icon(ic), title), ...rest);
    fill(main,
      h('a', { class: 'crumb', href: '#/' }, icon('back', 'sm'), 'ダッシュボード'),
      h('div', { class: 'page-head' }, h('h1', {}, '管理')),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile card' }, h('div', { class: 'k' }, icon('zap', 'sm'), 'bot'), h('div', { class: 'v' }, s.running, h('small', {}, `/ ${s.bots} 動作中`))),
        h('div', { class: 'tile card' }, h('div', { class: 'k' }, icon('server', 'sm'), 'サーバーのメモリ'), h('div', { class: 'v' }, s.memoryMB, h('small', {}, 'MB'))),
        h('div', { class: 'tile card' }, h('div', { class: 'k' }, icon('package', 'sm'), '保存容量'), h('div', { class: 'v' }, s.diskMB, h('small', {}, `/ ${s.maxDiskMB} MB`))),
        h('div', { class: 'tile card' }, h('div', { class: 'k' }, icon('clock', 'sm'), '起動してから'), h('div', { class: 'v', style: 'font-size:18px' }, dur(s.uptime * 1000)))),
      h('div', { class: 'settings' },
        section('shield', '安全と 24 時間稼働',
          h('div', { class: 'checks' },
            okLine(!!ka && ka.ok !== false, ka ? '24 時間稼働: オン' : '24 時間稼働: オフ (眠らせる仕組みのない場所)',
              ka ? `サイトを閉じても止まらないように、${ka.lastAt ? `${ago(ka.lastAt)}に確認` : 'まもなく確認'}${ka.error ? ` (エラー: ${ka.error})` : ''}` : 'Render 以外では BOTHOST_KEEP_AWAKE_URL で設定できます'),
            okLine(b.enabled && !b.blocked && !b.lastError, b.enabled ? `バックアップ: ${b.method === 'git' ? 'デプロイキー' : 'トークン'}で GitHub に保存` : 'バックアップ: オフ',
              b.enabled ? (b.blocked || b.lastError || (b.lastAt ? `最後に保存: ${ago(b.lastAt)} (${fmtSize(b.lastSize)})` : '変更があれば保存します')) : 'サーバーが再起動するとデータが消えます'),
            b.enabled && okLine(!!sec.encryptedBackup, sec.encryptedBackup ? 'バックアップは暗号化しています (AES-256-GCM)' : 'バックアップは暗号化していません', sec.encryptedBackup ? 'GitHub に置くファイルは、鍵がないと読めません' : 'BOTHOST_SECRET_KEY を設定すると暗号化します'),
            okLine(!!sec.isolate || s.mode === 'docker', s.mode === 'docker' ? 'bot はコンテナで分けて動かしています' : sec.isolate ? 'bot は bot ごとの別のユーザーで動かしています' : 'bot はサーバーと同じユーザーで動いています',
              sec.isolate || s.mode === 'docker' ? 'bot からは、サーバーの秘密・データ・ほかの bot のファイルを読めません' : 'サーバーを root で動かすと、bot を分けて動かします'),
            okLine(!!sec.secureCookie, sec.secureCookie ? 'ログインは HTTPS だけで送ります' : 'ログインのクッキーに Secure が付いていません', null)),
          b.enabled && h('div', { class: 'row-end' }, h('div', { class: 'grow' }), h('button', {
            class: 'btn', onclick: async (e) => {
              e.currentTarget.disabled = true;
              try { await api('POST', '/api/admin/backup'); toast('バックアップしました'); } catch (err) { toast(err.message, true); }
              draw();
            },
          }, icon('cloud', 'sm'), '今すぐバックアップ'))),
        section('user', 'ユーザー',
          h('label', { class: 'switch' }, reg, h('span', {}, h('b', {}, '新しい登録を受け付ける'),
            h('span', { class: 'hint' }, 'オンにすると、URL を知っている人なら誰でもアカウントを作れます。bot はこのサーバーで動くので、信頼できる人だけにしてください。'))),
          h('div', {}, d.users.map((u) => h('div', { class: 'user-row' },
            h('span', { class: 'avatar sm' }, icon('user', 'sm')),
            h('div', { class: 'grow' }, h('b', {}, u.username), ' ', u.admin && h('span', { class: 'badge accent' }, '管理者'),
              h('div', { class: 'hint' }, `bot ${u.bots} 個 ・ ${new Date(u.createdAt).toLocaleDateString('ja-JP')} に登録`)),
            !u.admin && h('button', {
              class: 'btn sm danger', onclick: async () => {
                if (!await confirmBox('ユーザーを削除', `${u.username} と、その人の bot (${u.bots} 個) をすべて削除します。`, '削除する')) return;
                try { await api('DELETE', `/api/admin/users/${u.id}`); toast('削除しました'); draw(); } catch (e) { toast(e.message, true); }
              },
            }, '削除'))))),
        section('server', 'サーバー',
          kv([['バージョン', s.version], ['動かし方', s.mode === 'docker' ? 'docker (bot ごとにコンテナ)' : 'process'], ['Node.js', s.node]]))));
  };
  await draw();
}

// ================= 画面の切り替え =================
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
    openStream();
    if (parts[0] === 'bots' && parts[1]) return await renderBot(parts[1], parts[2]);
    if (parts[0] === 'admin' && state.user.admin) return await renderAdmin();
    return await renderDashboard();
  } catch (e) {
    const box = h('div', { class: 'card empty' }, h('div', { class: 'art' }, icon('alert', 'lg')), h('h2', {}, '表示できませんでした'), h('p', {}, e.message),
      h('div', { style: 'display:flex;gap:8px;justify-content:center' }, h('button', { class: 'btn', onclick: () => render() }, 'もう一度'), h('a', { class: 'btn primary', href: '#/' }, 'ダッシュボードへ')));
    if (state.user) shell({ active: null }, box); else fill($app, h('main', {}, box));
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
  window.scrollTo(0, 0);
  render();
});
render();

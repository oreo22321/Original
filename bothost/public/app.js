'use strict';
// BotHost の画面 (フレームワークなし)

// ---------- 小さな道具 ----------
const $app = document.getElementById('app');

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
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
  const res = await fetch(url, opts);
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
  const el = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), bad ? 5000 : 2600);
}

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

const STATUS_LABEL = {
  running: '動作中', stopped: '停止中', installing: '準備中', restarting: '再起動待ち', crashed: 'エラーで停止',
};
const RUNTIME_LABEL = { python: 'Python', node: 'Node.js' };

function pill(status) {
  return h('span', { class: `pill ${status}` }, STATUS_LABEL[status] || status);
}

function uptime(startedAt) {
  if (!startedAt) return '—';
  let s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const hh = Math.floor(s / 3600); s -= hh * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}日 ${hh}時間`;
  if (hh) return `${hh}時間 ${m}分`;
  if (m) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function modal(title, body, foot) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.append(h('div', { class: 'modal card', role: 'dialog', 'aria-label': title }, h('h2', {}, title), body, h('div', { class: 'foot' }, foot(close))));
  document.body.append(back);
  const first = back.querySelector('input, textarea, select');
  if (first) first.focus();
  return close;
}

function confirmBox(title, text, okLabel, danger = true) {
  return new Promise((resolve) => {
    let done = false;
    const close = modal(title, h('p', {}, text), (c) => [
      h('button', { class: 'btn', onclick: () => { c(); } }, 'やめる'),
      h('button', { class: 'btn ' + (danger ? 'danger solid' : 'primary'), onclick: () => { done = true; c(); resolve(true); } }, okLabel),
    ]);
    const obs = new MutationObserver(() => {
      if (!document.body.contains(document.querySelector('.modal-back'))) { obs.disconnect(); if (!done) resolve(false); }
    });
    obs.observe(document.body, { childList: true });
    void close;
  });
}

// ---------- 状態 ----------
const state = { user: null, config: null, cleanup: [] };

function cleanup() {
  for (const fn of state.cleanup) fn();
  state.cleanup = [];
}

function topbar() {
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: '/icon.svg', alt: '' }), 'BotHost'),
    h('div', { class: 'spacer' }),
    state.user && h('span', { class: 'who' }, state.user.username, state.user.admin ? ' (管理者)' : ''),
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
  const canRegister = state.config && state.config.registrationOpen;
  if (!canRegister) mode = 'login';
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
    canRegister && h('div', { class: 'tabs-row' },
      h('button', { type: 'button', class: mode === 'login' ? 'on' : '', onclick: () => go('#/login') }, 'ログイン'),
      h('button', { type: 'button', class: mode === 'register' ? 'on' : '', onclick: () => go('#/register') }, '新しく登録')),
    form)));
  user.focus();
}

// ---------- bot 一覧 ----------
async function renderList() {
  const main = h('main', {}, h('p', { class: 'hint' }, '読み込み中…'));
  fill($app, topbar(), main);
  const { bots } = await api('GET', '/api/bots');
  const head = h('div', { class: 'page-head' },
    h('h1', {}, 'あなたの bot'),
    h('button', { class: 'btn primary', onclick: openNewBot }, '＋ 新しい bot'));
  if (!bots.length) {
    fill(main, head, h('div', { class: 'card empty' },
      h('div', { style: 'font-size:44px' }, '🤖'),
      h('h2', {}, 'まだ bot がありません'),
      h('p', {}, 'テンプレートを選ぶと、すぐに動く Discord bot ができます。'),
      h('button', { class: 'btn primary', onclick: openNewBot }, '＋ 最初の bot を作る')));
    return;
  }
  const grid = h('div', { class: 'grid' }, bots.map((b) => h('a', { class: 'bot-card card', href: `#/bots/${b.id}` },
    h('div', { class: 'row' }, h('span', { class: 'name' }, b.name), pill(b.status)),
    h('div', { class: 'meta' },
      h('span', { class: 'badge' }, RUNTIME_LABEL[b.runtime] || b.runtime),
      h('span', {}, '稼働 ', b.status === 'running' ? uptime(b.startedAt) : '—'),
      b.stats && h('span', {}, `メモリ ${b.stats.memoryMB} MB`)))));
  fill(main, head, grid);
  const t = setInterval(() => { if (location.hash === '#/' || location.hash === '') renderList().catch(() => {}); }, 10000);
  state.cleanup.push(() => clearInterval(t));
}

function openNewBot() {
  const templates = state.config.templates;
  let chosen = templates[0].id;
  const name = h('input', { type: 'text', placeholder: '例: my-bot', maxlength: 40 });
  const err = h('div', { class: 'error-text' });
  const DESC = {
    'python-discord': '!ping に返事をする bot',
    'node-discord': '!ping に返事をする bot',
    'python-blank': 'main.py だけ',
    'node-blank': 'index.js だけ',
  };
  const tplWrap = h('div', { class: 'templates' });
  const drawTpl = () => fill(tplWrap, ...templates.map((t) => h('button', {
    type: 'button', class: 'tpl' + (t.id === chosen ? ' on' : ''), onclick: () => { chosen = t.id; drawTpl(); },
  }, h('b', {}, t.label), h('span', {}, DESC[t.id] || ''))));
  drawTpl();
  const create = async (close) => {
    try {
      const { bot } = await api('POST', '/api/bots', { name: name.value || 'my-bot', template: chosen });
      close();
      go(`#/bots/${bot.id}/${chosen.endsWith('discord') ? 'settings' : 'console'}`);
      if (chosen.endsWith('discord')) toast('まず「環境変数」に DISCORD_TOKEN を追加してください');
    } catch (e) { err.textContent = e.message; }
  };
  modal('新しい bot', [
    h('label', { class: 'field' }, h('span', {}, '名前'), name),
    h('div', { class: 'field' }, h('span', { style: 'display:block;font-size:13px;font-weight:600;margin-bottom:6px' }, 'テンプレート'), tplWrap),
    err,
  ], (close) => {
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(close); });
    return [h('button', { class: 'btn', onclick: close }, 'やめる'), h('button', { class: 'btn primary', onclick: () => create(close) }, '作る')];
  });
}

// ---------- bot の画面 ----------
async function renderBot(id, tab) {
  tab = ['console', 'files', 'settings'].includes(tab) ? tab : 'console';
  let { bot } = await api('GET', `/api/bots/${id}`);

  const statusEl = h('span');
  const actions = h('div', { class: 'actions' });
  const statsEl = h('div', { class: 'stats' });
  const live = { status: bot.status, startedAt: bot.startedAt, stats: bot.stats, exitCode: bot.exitCode };

  const act = (path, label) => async () => {
    try {
      const r = await api('POST', `/api/bots/${id}/${path}`);
      // 状態はリアルタイム (SSE) で届くので、ここでは上書きしない (古い状態で戻ってしまうため)
      bot = r.bot;
      drawHead();
      if (label) toast(label);
    } catch (e) { toast(e.message, true); }
  };
  const drawHead = () => {
    fill(statusEl, pill(live.status));
    const active = ['running', 'installing', 'restarting'].includes(live.status);
    fill(actions, ...(active
      ? [h('button', { class: 'btn', onclick: act('restart') }, '↻ 再起動'), h('button', { class: 'btn danger', onclick: act('stop') }, '■ 停止')]
      : [h('button', { class: 'btn primary', onclick: act('start') }, '▶ 起動')]));
    fill(statsEl, 
      h('span', {}, '稼働時間 ', h('b', {}, live.status === 'running' ? uptime(live.startedAt) : '—')),
      h('span', {}, 'CPU ', h('b', {}, live.stats && live.stats.cpuPercent !== null ? `${live.stats.cpuPercent}%` : '—')),
      h('span', {}, 'メモリ ', h('b', {}, live.stats ? `${live.stats.memoryMB} MB` : '—'), h('span', {}, ` / ${bot.memoryLimitMB} MB`)),
      h('span', {}, h('span', { class: 'badge' }, RUNTIME_LABEL[bot.runtime] || bot.runtime)),
      h('span', {}, '自動再起動 ', h('b', {}, bot.autoRestart ? 'オン' : 'オフ')));
  };
  drawHead();
  const tick = setInterval(drawHead, 1000);
  state.cleanup.push(() => clearInterval(tick));

  const body = h('div');
  const tabLink = (key, label) => h('a', { href: `#/bots/${id}/${key}`, class: tab === key ? 'on' : '' }, label);
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
    Object.assign(live, d); delete live.logs;
    logView.reset(d.logs);
    drawHead();
  });
  es.addEventListener('log', (e) => logView.add(JSON.parse(e.data)));
  es.addEventListener('status', (e) => { Object.assign(live, JSON.parse(e.data)); drawHead(); });
  es.addEventListener('stats', (e) => { live.stats = JSON.parse(e.data); });
  state.cleanup.push(() => es.close());

  if (tab === 'console') body.append(logView.el);
  else if (tab === 'files') await renderFiles(id, bot, body);
  else renderSettings(bot, body, (b) => { bot = b; nameEl.textContent = b.name; drawHead(); });
}

function createLogView(id) {
  const log = h('div', { class: 'log', tabindex: '0' });
  let follow = true;
  const followBox = h('input', { type: 'checkbox', checked: true, onchange: () => { follow = followBox.checked; if (follow) log.scrollTop = log.scrollHeight; } });
  log.addEventListener('scroll', () => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    if (follow !== atBottom) { follow = atBottom; followBox.checked = atBottom; }
  });
  const time = (t) => new Date(t).toLocaleTimeString('ja-JP', { hour12: false });
  const line = (e) => h('div', { class: 'ln' }, h('span', { class: 'ts' }, time(e.t)), h('span', { class: e.s }, e.l));
  const placeholder = () => h('div', { class: 'placeholder' }, 'まだ出力はありません。▶ 起動 を押すと、ここに bot の出力が出ます。');
  let count = 0;
  const api2 = {
    reset(logs) {
      count = logs.length;
      fill(log, ...(logs.length ? logs.map(line) : [placeholder()]));
      log.scrollTop = log.scrollHeight;
    },
    add(e) {
      if (!count) fill(log);
      count++;
      log.append(line(e));
      while (log.childElementCount > 2000) log.firstElementChild.remove();
      if (follow) log.scrollTop = log.scrollHeight;
    },
  };
  const input = h('input', { type: 'text', placeholder: '標準入力に送る (input() など)', autocomplete: 'off', spellcheck: 'false' });
  const sendIn = async () => {
    if (!input.value) return;
    try { await api('POST', `/api/bots/${id}/stdin`, { text: input.value }); input.value = ''; } catch (e) { toast(e.message, true); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendIn(); });
  api2.el = h('div', { class: 'console' },
    h('div', { class: 'console-bar' },
      h('span', {}, '出力'), h('div', { class: 'spacer' }),
      h('label', {}, followBox, '自動スクロール'),
      h('button', {
        class: 'btn small', onclick: () => {
          const text = [...log.querySelectorAll('.ln')].map((n) => n.textContent).join('\n');
          const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'log.txt' });
          a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        },
      }, '保存'),
      h('button', { class: 'btn small', onclick: async () => { await api('DELETE', `/api/bots/${id}/logs`); api2.reset([]); } }, '消去')),
    log,
    h('div', { class: 'stdin' }, input, h('button', { class: 'btn small', onclick: sendIn }, '送る')));
  return api2;
}

// ---------- ファイル ----------
const TEXT_EXT = /\.(py|js|mjs|cjs|ts|json|txt|md|toml|ya?ml|ini|cfg|env|csv|html|css|sh|gitignore|lock)$|^[^.]+$/i;

async function renderFiles(id, bot, body) {
  const listEl = h('div', { class: 'file-list card' });
  const editorEl = h('div', { class: 'editor card' });
  fill(body, h('div', { class: 'files' }, listEl, editorEl));
  let current = null; // { path, original }
  let dirty = false;

  const confirmLeave = async () => !dirty || confirmBox('保存していません', `${current.path} の変更は保存されていません。破棄しますか？`, '破棄する');
  const onBefore = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBefore);
  state.cleanup.push(() => window.removeEventListener('beforeunload', onBefore));
  state.guard = confirmLeave;
  state.cleanup.push(() => { state.guard = null; });

  const refresh = async () => {
    const { files, hidden } = await api('GET', `/api/bots/${id}/files`);
    const upload = h('input', {
      type: 'file', multiple: true, style: 'display:none', onchange: async () => {
        for (const f of upload.files) {
          try { await api('PUT', `/api/bots/${id}/file?path=${encodeURIComponent(f.name)}`, f); } catch (e) { toast(e.message, true); }
        }
        toast(`${upload.files.length} 個のファイルを入れました`);
        refresh();
      },
    });
    fill(listEl, 
      h('div', { class: 'tools' },
        h('button', { class: 'btn small', onclick: newFile }, '＋ 新規'),
        h('button', { class: 'btn small', onclick: () => upload.click() }, 'アップロード'),
        upload),
      files.length ? files.map((f) => h('button', {
        class: 'file-item' + (current && current.path === f.path ? ' on' : ''),
        title: f.path,
        onclick: async () => { if (await confirmLeave()) open(f.path); },
      }, h('span', { class: 'nm' }, f.path), h('span', { class: 'size' }, fmtSize(f.size))))
        : h('p', { class: 'hint', style: 'padding:6px' }, 'ファイルがありません'),
      hidden.length ? h('p', { class: 'hint', style: 'padding:8px 6px 0;font-size:12px' }, `ライブラリのフォルダー (${hidden.join(', ')}) は表示していません`) : null);
    return files;
  };

  const newFile = () => {
    const input = h('input', { type: 'text', placeholder: bot.runtime === 'python' ? '例: cogs/music.py' : '例: commands/ping.js' });
    const err = h('div', { class: 'error-text' });
    const make = async (close) => {
      const p = input.value.trim();
      if (!p) return;
      try {
        await api('PUT', `/api/bots/${id}/file?path=${encodeURIComponent(p)}`, '');
        close(); await refresh(); open(p);
      } catch (e) { err.textContent = e.message; }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') make(closeFn); });
    const closeFn = modal('新しいファイル', [h('label', { class: 'field' }, h('span', {}, 'ファイル名 (フォルダーは / で区切る)'), input), err],
      (close) => [h('button', { class: 'btn', onclick: close }, 'やめる'), h('button', { class: 'btn primary', onclick: () => make(close) }, '作る')]);
  };

  const showEmpty = () => {
    current = null; dirty = false;
    fill(editorEl, h('div', { class: 'no-file' }, '左のファイルを選ぶと、ここで編集できます。'));
  };

  const open = async (p) => {
    const res = await api('GET', `/api/bots/${id}/file?path=${encodeURIComponent(p)}`, undefined, { raw: true });
    const buf = await res.arrayBuffer();
    let text = null;
    if (TEXT_EXT.test(p.split('/').pop()) || buf.byteLength < 200000) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = null; }
    }
    current = { path: p, original: text };
    dirty = false;
    await refresh();
    const dirtyEl = h('span', { class: 'dirty' });
    const actionsBar = [
      h('button', {
        class: 'btn small', onclick: () => {
          const input = h('input', { type: 'text', value: p });
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
    const gutter = h('div', { class: 'gutter', 'aria-hidden': 'true' });
    const code = h('textarea', { class: 'code', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off' });
    code.value = text;
    const lines = () => { gutter.textContent = Array.from({ length: code.value.split('\n').length }, (_, i) => i + 1).join('\n'); };
    const saveBtn = h('button', { class: 'btn small primary', onclick: () => save() }, '保存');
    const save = async () => {
      try {
        await api('PUT', `/api/bots/${id}/file?path=${encodeURIComponent(p)}`, code.value);
        current.original = code.value; dirty = false; dirtyEl.textContent = '';
        const restartHint = ['running', 'restarting'].includes(document.querySelector('.bot-head .pill')?.className.split(' ')[1]);
        toast(restartHint ? '保存しました (反映するには ↻ 再起動)' : '保存しました');
        refresh();
      } catch (e) { toast(e.message, true); }
    };
    code.addEventListener('input', () => {
      dirty = code.value !== current.original;
      dirtyEl.textContent = dirty ? '● 未保存' : '';
      lines();
    });
    code.addEventListener('scroll', () => { gutter.scrollTop = code.scrollTop; });
    code.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('insertText', false, '    ');
      } else if (e.key === 'Enter') {
        // 前の行と同じ字下げ (: で終わる行のあとは 1 段深く)
        const before = code.value.slice(0, code.selectionStart);
        const lineStart = before.lastIndexOf('\n') + 1;
        const cur = before.slice(lineStart);
        let indent = cur.match(/^\s*/)[0];
        if (/[:{[(]\s*$/.test(cur)) indent += '    ';
        e.preventDefault();
        document.execCommand('insertText', false, '\n' + indent);
      }
    });
    lines();
    fill(editorEl, 
      h('div', { class: 'editor-bar' }, h('span', { class: 'path' }, p), dirtyEl, ...actionsBar, saveBtn),
      h('div', { class: 'code-wrap' }, gutter, code));
  };

  const files = await refresh();
  const main = files.find((f) => /^(main\.py|index\.js|bot\.py)$/.test(f.path)) || files[0];
  if (main) await open(main.path); else showEmpty();
}

// ---------- 設定 ----------
function renderSettings(bot, body, onSaved) {
  const name = h('input', { type: 'text', value: bot.name, maxlength: 40 });
  const cmd = h('input', { type: 'text', value: bot.startCommand, class: 'mono', spellcheck: 'false', autocapitalize: 'off' });
  const auto = h('input', { type: 'checkbox', checked: bot.autoRestart });
  const mem = h('input', { type: 'number', value: bot.memoryLimitMB, min: 32, max: 4096, step: 32 });
  const cpu = h('input', { type: 'number', value: bot.cpuLimit, min: 0.1, max: 4, step: 0.1 });
  const docker = state.config.mode === 'docker';

  const saveGeneral = async () => {
    const payload = { name: name.value, startCommand: cmd.value, autoRestart: auto.checked, memoryLimitMB: Number(mem.value) };
    if (docker) payload.cpuLimit = Number(cpu.value);
    try {
      const r = await api('PATCH', `/api/bots/${bot.id}`, payload);
      onSaved(r.bot); bot = r.bot; toast('保存しました');
    } catch (e) { toast(e.message, true); }
  };

  // 環境変数: 値はサーバーから返さない (トークンを画面に出さないため)。空欄のままなら変えません。
  const envRows = h('div');
  const rows = [];
  const addRow = (key = '', existing = false) => {
    const k = h('input', { type: 'text', value: key, placeholder: '名前 (例: DISCORD_TOKEN)', spellcheck: 'false', autocapitalize: 'characters' });
    const v = h('input', { type: 'password', placeholder: existing ? '••••••••（変えないなら空欄）' : '値', autocomplete: 'off', spellcheck: 'false' });
    const row = { k, v, existing, original: key, removed: false };
    const show = h('button', { class: 'btn small ghost', type: 'button', title: '表示', onclick: () => { v.type = v.type === 'password' ? 'text' : 'password'; } }, '👁');
    const del = h('button', {
      class: 'btn small danger', type: 'button', onclick: () => { row.removed = true; el.remove(); },
    }, '削除');
    const el = h('div', { class: 'env-row' }, k, h('div', { style: 'display:flex;gap:4px' }, v, show), del);
    rows.push(row);
    envRows.append(el);
  };
  const envKeys = Object.keys(bot.env || {});
  envKeys.forEach((key) => addRow(key, true));
  if (!envKeys.length) addRow(bot.template && bot.template.endsWith('discord') ? 'DISCORD_TOKEN' : '');

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
      if (r.v.value || !r.existing) {
        if (!r.v.value) continue; // 新しい行で値が空 → 送らない
        env[key] = r.v.value;
      }
    }
    try {
      const r = await api('PATCH', `/api/bots/${bot.id}`, { env });
      onSaved(r.bot); bot = r.bot;
      toast('環境変数を保存しました (反映するには ↻ 再起動)');
      renderSettings(bot, body, onSaved);
    } catch (e) { toast(e.message, true); }
  };

  fill(body, h('div', { class: 'settings' },
    h('section', { class: 'card' },
      h('h2', {}, '環境変数'),
      h('p', { class: 'hint' }, 'トークンやパスワードはコードに書かず、ここに入れてください。Python は os.environ["名前"]、Node.js は process.env.名前 で読めます。保存した値は画面には出しません。'),
      envRows,
      h('div', { style: 'display:flex;gap:8px;margin-top:6px' },
        h('button', { class: 'btn small', onclick: () => addRow() }, '＋ 追加'),
        h('div', { style: 'flex:1' }),
        h('button', { class: 'btn primary', onclick: saveEnv }, '環境変数を保存'))),
    h('section', { class: 'card' },
      h('h2', {}, '基本'),
      h('p', { class: 'hint' }, ''),
      h('label', { class: 'field' }, h('span', {}, '名前'), name),
      h('label', { class: 'field' }, h('span', {}, '起動コマンド'), cmd,
        h('span', { class: 'hint', style: 'font-weight:400;margin-top:4px' },
          `ふつうは ${state.config.runtimes[bot.runtime].defaultCommand}。${bot.runtime === 'python' ? 'requirements.txt' : 'package.json'} があれば、起動の前にライブラリを自動で入れます。`)),
      h('label', { class: 'switch' }, auto, h('span', {}, h('b', {}, '落ちたら自動で再起動'), h('br'),
        h('span', { class: 'hint' }, 'エラーで止まったら、少し待ってから起動し直します (5 分で 5 回落ちたらあきらめます)。'))),
      h('div', { class: 'two' },
        h('label', { class: 'field' }, h('span', {}, 'メモリの上限 (MB)'), mem),
        docker ? h('label', { class: 'field' }, h('span', {}, 'CPU の上限 (コア数)'), cpu) : h('div')),
      h('div', { style: 'display:flex;justify-content:flex-end' }, h('button', { class: 'btn primary', onclick: saveGeneral }, '保存'))),
    h('section', { class: 'card danger-zone' },
      h('h2', {}, 'bot を削除'),
      h('p', { class: 'hint' }, 'bot を止めて、ファイルと設定をすべて消します。元には戻せません。'),
      h('button', {
        class: 'btn danger solid', onclick: async () => {
          if (!await confirmBox('bot を削除', `「${bot.name}」を削除します。ファイルもすべて消えます。`, '削除する')) return;
          await api('DELETE', `/api/bots/${bot.id}`);
          toast('削除しました'); go('#/');
        },
      }, '削除する'))));
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
      try { state.user = (await api('GET', '/api/me')).user; } catch { return; }
    }
    if (parts[0] === 'bots' && parts[1]) return await renderBot(parts[1], parts[2]);
    return await renderList();
  } catch (e) {
    fill($app, topbar(), h('main', {}, h('div', { class: 'card empty' }, h('h2', {}, '表示できませんでした'), h('p', {}, e.message),
      h('a', { class: 'btn', href: '#/' }, '一覧へ'))));
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

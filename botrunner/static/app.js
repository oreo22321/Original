// BotRunner の画面。サーバー (server.py) の API とつながって bot を管理します

const app = document.getElementById('app')
const PERMS = 117824 // 招待リンクの権限: チャンネルを見る・送信・埋め込み・ファイル・履歴・リアクション

const S = {
  bots: new Map(),     // id → 要約
  ws: null,
  wsOn: false,
  view: null,          // 今の画面 { name, id, tab, cleanup, onBot, onLog }
  dirty: false,        // コードを保存していない
}

// ---------------------------------------------------------------- 小道具

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else if (k === 'value') el.value = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
  }
  return el
}

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-BotRunner': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  let data = {}
  try { data = await res.json() } catch {}
  if (res.status === 401 && path !== '/login') { start(); throw new Error(data.error || 'ログインしてください') }
  if (!res.ok) throw new Error(data.error || `エラー (${res.status})`)
  return data
}

let toastTimer
function toast(msg) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, 2600)
}

function duration(sec) {
  sec = Math.max(0, Math.floor(sec))
  const d = Math.floor(sec / 86400), hh = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60
  if (d) return `${d}日 ${hh}時間`
  if (hh) return `${hh}時間 ${m}分`
  if (m) return `${m}分 ${s}秒`
  return `${s}秒`
}

function bytes(n) {
  if (n == null) return ''
  if (n > 1 << 30) return (n / (1 << 30)).toFixed(1) + ' GB'
  return Math.round(n / (1 << 20)) + ' MB'
}

const STATUS = {
  running: '動作中', stopped: '停止中', waiting: '再起動待ち', error: 'エラー', installing: '準備中',
}

function statusText(b) {
  const now = Date.now() / 1000
  if (b.status === 'running' && b.started_at) return `動作中 · ${duration(now - b.started_at)}`
  if (b.status === 'waiting' && b.next_restart) return `再起動まで ${Math.max(0, Math.ceil(b.next_restart - now))} 秒`
  return STATUS[b.status] || b.status
}

function inviteUrl(b) {
  return `https://discord.com/oauth2/authorize?client_id=${b.client_id}&scope=bot+applications.commands&permissions=${PERMS}`
}

// 1 秒ごとに「動作中 · 3分」などを更新
setInterval(() => {
  document.querySelectorAll('[data-status-of]').forEach(el => {
    const b = S.bots.get(el.dataset.statusOf)
    if (b) el.textContent = statusText(b)
  })
}, 1000)

// ---------------------------------------------------------------- 接続 (WebSocket)

function connect() {
  if (S.ws) return
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws')
  S.ws = ws
  ws.onopen = () => { S.wsOn = true; setConn() }
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'hello') {
      S.bots = new Map(msg.bots.map(b => [b.id, b]))
      S.view?.onBot?.()
    } else if (msg.type === 'bot') {
      S.bots.set(msg.bot.id, msg.bot)
      S.view?.onBot?.(msg.bot)
    } else if (msg.type === 'deleted') {
      S.bots.delete(msg.id)
      S.view?.onBot?.()
    } else if (msg.type === 'log') {
      S.view?.onLog?.(msg.id, msg.line)
    }
  }
  ws.onclose = () => {
    S.ws = null; S.wsOn = false; setConn()
    setTimeout(() => { if (!document.hidden) connect() }, 2000)
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !S.ws && S.loggedIn) { connect(); route() }
})

function setConn() {
  document.querySelectorAll('.conn').forEach(el => {
    el.classList.toggle('on', S.wsOn)
    el.title = S.wsOn ? 'サーバーとつながっています' : 'サーバーとつながっていません'
  })
}

// ---------------------------------------------------------------- 画面の切り替え

window.addEventListener('hashchange', () => route())
window.addEventListener('beforeunload', e => { if (S.dirty) e.preventDefault() })

function go(hash) { location.hash = hash }

function route() {
  if (!S.loggedIn) return
  if (S.dirty && !confirm('保存していない変更があります。破棄しますか?')) {
    history.replaceState(null, '', S.lastHash)
    return
  }
  S.dirty = false
  S.view?.cleanup?.()
  S.view = null
  S.lastHash = location.hash
  const parts = location.hash.replace(/^#\/?/, '').split('/')
  window.scrollTo(0, 0)
  if (parts[0] === 'bot' && parts[1]) return viewBot(parts[1], parts[2] || 'logs')
  if (parts[0] === 'new') return viewNew()
  if (parts[0] === 'settings') return viewSettings()
  return viewHome()
}

function mount(...nodes) {
  app.replaceChildren(...nodes.filter(Boolean))
  setConn()
}

function topBar(title, { back, right } = {}) {
  return h('div', { class: 'top' },
    back ? h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => go(back) }, '‹') : null,
    h('h1', null, title),
    h('span', { class: 'conn' }),
    right || null)
}

// ---------------------------------------------------------------- ログイン

async function start() {
  S.loggedIn = false
  S.ws?.close()
  let st
  try {
    st = await api('GET', '/state')
  } catch (e) {
    mount(h('div', { class: 'center' }, h('p', null, 'サーバーに接続できません'), h('p', { class: 'muted small' }, e.message),
      h('button', { class: 'btn', onclick: start }, 'もう一度')))
    return
  }
  if (st.logged_in) {
    S.loggedIn = true
    connect()
    route()
  } else if (st.setup) viewSetup()
  else viewLogin()
}

function authForm({ title, sub, fields, submit, onsubmit }) {
  const err = h('p', { class: 'err' })
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, submit)
  const form = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault()
    err.textContent = ''
    btn.disabled = true
    try {
      await onsubmit(Object.fromEntries(new FormData(form)))
      S.loggedIn = true
      connect()
      route()
    } catch (x) { err.textContent = x.message } finally { btn.disabled = false }
  } }, ...fields, err, btn)
  mount(h('div', { class: 'login' },
    h('img', { class: 'logo', src: '/static/icon.svg', alt: '' }),
    h('h1', null, title),
    h('p', { class: 'muted center', style: 'padding:0 0 16px' }, sub),
    form))
  form.querySelector('input')?.focus()
}

function viewLogin() {
  authForm({
    title: 'BotRunner',
    sub: 'パスワードを入れてください',
    fields: [h('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'パスワード', required: true })],
    submit: 'ログイン',
    onsubmit: v => api('POST', '/login', v),
  })
}

function viewSetup() {
  authForm({
    title: 'はじめまして',
    sub: 'この管理画面を開けるのはあなただけにします。パスワードを決めてください。',
    fields: [
      h('label', { class: 'field' }, h('span', null, '設定コード (6 桁)'),
        h('input', { type: 'text', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', required: true }),
        h('p', { class: 'muted small' }, 'サーバーを起動した画面に出ている数字です。見つからないときは、サーバーの data/setup-code.txt に書いてあります。')),
      h('label', { class: 'field' }, h('span', null, '新しいパスワード (8 文字以上)'),
        h('input', { type: 'password', name: 'password', autocomplete: 'new-password', minlength: 8, required: true })),
    ],
    submit: '設定してはじめる',
    onsubmit: v => api('POST', '/setup', v),
  })
}

// ---------------------------------------------------------------- ホーム (bot の一覧)

function viewHome() {
  const list = h('div', { class: 'bots' })
  const render = () => {
    const bots = [...S.bots.values()]
    if (!bots.length) {
      list.replaceChildren(h('div', { class: 'card stack' },
        h('b', null, 'まだ bot がありません'),
        h('p', { class: 'muted small' }, 'bot を作って Discord のトークンを入れると、このサーバーで 24 時間動き続けます。アプリを閉じても止まりません。'),
        h('button', { class: 'btn primary block', onclick: () => go('#/new') }, '＋ はじめての bot を作る')))
      return
    }
    list.replaceChildren(...bots.map(b => h('a', { class: 'bot-card', href: `#/bot/${b.id}` },
      h('span', { class: `dot ${b.status}` }),
      h('div', { class: 'grow' },
        h('div', { class: 'name' }, b.name),
        h('div', { class: 'meta' },
          h('span', { 'data-status-of': b.id }, statusText(b)),
          b.memory ? ` · ${bytes(b.memory)}` : '',
          b.error ? ' · 要確認' : '')),
      h('span', { class: 'muted' }, '›'))))
  }
  render()
  const poll = setInterval(() => api('GET', '/bots').then(r => {
    S.bots = new Map(r.bots.map(b => [b.id, b])); render()
  }).catch(() => {}), 15000)
  S.view = { onBot: render, cleanup: () => clearInterval(poll) }
  mount(
    topBar('BotRunner', { right: h('button', { class: 'icon-btn', 'aria-label': '設定', onclick: () => go('#/settings') }, '⚙︎') }),
    list,
    S.bots.size ? h('button', { class: 'btn block', style: 'margin-top:12px', onclick: () => go('#/new') }, '＋ 新しい bot') : null)
}

// ---------------------------------------------------------------- 新しい bot

async function viewNew() {
  mount(topBar('新しい bot', { back: '#/' }), h('p', { class: 'muted' }, '読み込み中…'))
  let tpls
  try { tpls = (await api('GET', '/templates')).templates } catch (e) { toast(e.message); return }
  let chosen = tpls[0]?.id
  const name = h('input', { type: 'text', maxlength: 40, placeholder: '例: おしゃべり bot', required: true })
  const box = h('div', { class: 'tpls' })
  const renderTpls = () => box.replaceChildren(...tpls.map(t => h('button', {
    type: 'button', class: 'tpl' + (t.id === chosen ? ' on' : ''), onclick: () => { chosen = t.id; renderTpls() },
  }, h('b', null, t.title), h('span', null, t.desc))))
  renderTpls()
  const err = h('p', { class: 'err' })
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, '作成')
  const form = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault()
    btn.disabled = true
    try {
      const r = await api('POST', '/bots', { name: name.value, template: chosen })
      S.bots.set(r.bot.id, r.bot)
      go(`#/bot/${r.bot.id}/settings`)
    } catch (x) { err.textContent = x.message; btn.disabled = false }
  } },
  h('label', { class: 'field' }, h('span', null, '名前 (この画面での呼び名)'), name),
  h('div', null, h('label', { class: 'field' }, h('span', null, 'ひな形')), box),
  err, btn)
  mount(topBar('新しい bot', { back: '#/' }), form)
  name.focus()
}

// ---------------------------------------------------------------- bot の画面

async function viewBot(id, tab) {
  let detail
  try { detail = await api('GET', `/bots/${id}`) } catch (e) { toast(e.message); go('#/'); return }
  if (S.lastHash !== location.hash) return  // 読み込み中に別の画面へ移った
  S.bots.set(id, detail.bot)
  const b = () => S.bots.get(id) || detail.bot

  // 上の部分: 状態と操作ボタン
  const pill = h('span', { class: 'pill' })
  const errBox = h('div', { class: 'banner', hidden: true })
  const actions = h('div', { class: 'row wrap' })
  const busy = async (fn) => {
    actions.querySelectorAll('button').forEach(x => { x.disabled = true })
    try { await fn() } catch (e) { toast(e.message) }
    renderHead()
  }
  const act = a => busy(async () => { const r = await api('POST', `/bots/${id}/${a}`); S.bots.set(id, r.bot) })
  const renderHead = () => {
    const bot = b()
    pill.replaceChildren(h('span', { class: `dot ${bot.status}` }), h('span', { 'data-status-of': id }, statusText(bot)))
    errBox.hidden = !bot.error
    errBox.textContent = bot.error || ''
    const on = bot.status === 'running' || bot.status === 'installing' || bot.status === 'waiting'
    actions.replaceChildren(...[
      on ? h('button', { class: 'btn danger', onclick: () => act('stop') }, '■ 停止')
        : h('button', { class: 'btn go', onclick: () => act('start') }, '▶ 起動'),
      on ? h('button', { class: 'btn', onclick: () => act('restart') }, '↻ 再起動') : null,
      bot.memory ? h('span', { class: 'muted small' }, bytes(bot.memory)) : null,
      bot.restarts ? h('span', { class: 'muted small' }, `自動再起動 ${bot.restarts} 回`) : null,
    ].filter(Boolean))
    titleEl.textContent = bot.name
  }

  const tabs = h('div', { class: 'tabs', role: 'tablist' })
  const body = h('div')
  const titleEl = h('span')
  const top = topBar('', { back: '#/' })
  top.querySelector('h1').append(titleEl)

  const views = { logs: tabLogs, code: tabCode, settings: tabSettings }
  const labels = { logs: 'ログ', code: 'コード', settings: '設定' }
  let sub = null
  const show = name => {
    if (S.dirty && name !== 'code' && !confirm('保存していないコードの変更があります。破棄しますか?')) return
    S.dirty = false
    sub?.cleanup?.()
    tab = name
    history.replaceState(null, '', `#/bot/${id}/${name}`)
    S.lastHash = location.hash
    tabs.replaceChildren(...Object.keys(views).map(k =>
      h('button', { class: k === name ? 'on' : '', role: 'tab', onclick: () => show(k) }, labels[k])))
    sub = views[name](id, detail, body, b) || {}
  }

  S.view = {
    onBot: bot => {
      if (!S.bots.has(id)) { toast('この bot は削除されました'); go('#/'); return }
      if (!bot || bot.id === id) { renderHead(); sub?.onBot?.() }
    },
    onLog: (bid, line) => { if (bid === id) sub?.onLog?.(line) },
    cleanup: () => sub?.cleanup?.(),
  }
  mount(top, h('div', { class: 'row wrap', style: 'justify-content:space-between' }, pill, actions), errBox, tabs, body)
  renderHead()
  show(views[tab] ? tab : 'logs')
}

function tabLogs(id, detail, body) {
  const box = h('div', { class: 'log', role: 'log' })
  const fmt = t => new Date(t * 1000).toLocaleTimeString('ja-JP', { hour12: false })
  const BAD = /Traceback|Error|Exception|エラー/
  const lineEl = l => h('div', { class: 'l' + (l.s === 'old' ? ' old' : '') },
    h('span', { class: 't' }, fmt(l.t)),
    h('span', { class: l.s === 'sys' ? 'sys' : BAD.test(l.text) ? 'bad' : '' }, l.text))
  let empty = true
  const nearBottom = () => box.scrollHeight - box.scrollTop - box.clientHeight < 60
  const add = l => {
    if (empty) { box.replaceChildren(); empty = false }
    const stick = nearBottom()
    box.append(lineEl(l))
    while (box.childElementCount > 1500) box.firstChild.remove()
    if (stick) box.scrollTop = box.scrollHeight
  }
  box.append(h('div', { class: 'log-empty' }, '読み込み中…'))
  api('GET', `/bots/${id}/logs`).then(r => {
    box.replaceChildren()
    empty = !r.lines.length
    if (empty) box.append(h('div', { class: 'log-empty' }, 'まだログはありません。▶ 起動 を押すと、bot の print や エラーがここに出ます。'))
    r.lines.forEach(l => box.append(lineEl(l)))
    box.scrollTop = box.scrollHeight
  }).catch(e => toast(e.message))
  body.replaceChildren(box, h('div', { class: 'row', style: 'margin-top:8px' },
    h('button', { class: 'btn', onclick: async () => {
      if (!confirm('ログを消しますか?')) return
      await api('POST', `/bots/${id}/clear-logs`).catch(e => toast(e.message))
      box.replaceChildren(h('div', { class: 'log-empty' }, 'ログを消しました')); empty = true
    } }, 'ログを消す'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn', onclick: () => { box.scrollTop = box.scrollHeight } }, '↓ 最新')))
  return { onLog: add }
}

function tabCode(id, detail, body, b) {
  const ta = h('textarea', {
    class: 'code', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
    wrap: 'off', 'aria-label': 'main.py',
  })
  ta.value = detail.code
  const status = h('p', { class: 'small' })
  const showSyntax = s => {
    status.className = s ? 'err' : 'muted small'
    status.textContent = s ? `⚠ ${s.line ? s.line + ' 行目: ' : ''}${s.msg}` : 'main.py'
  }
  showSyntax(detail.syntax)
  const markDirty = () => { S.dirty = ta.value !== detail.code; saveBtn.disabled = !S.dirty }

  // iPhone が勝手に変える “ ” ‘ ’ を、Python で使える " ' に戻す
  ta.addEventListener('input', () => {
    if (/[“”‘’]/.test(ta.value)) {
      const pos = ta.selectionStart
      ta.value = ta.value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      ta.setSelectionRange(pos, pos)
    }
    markDirty()
  })
  const insert = text => {
    ta.focus()
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end')
    markDirty()
  }
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); insert('    ') }
    else if (e.key === 'Enter' && !e.isComposing) {
      // 前の行と同じだけ字下げ。「:」で終わる行の次はもう一段
      const before = ta.value.slice(0, ta.selectionStart)
      const line = before.slice(before.lastIndexOf('\n') + 1)
      let indent = line.match(/^\s*/)[0]
      if (/:\s*(#.*)?$/.test(line)) indent += '    '
      e.preventDefault()
      insert('\n' + indent)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(false) }
  })

  const save = async restart => {
    saveBtn.disabled = runBtn.disabled = true
    try {
      const r = await api('PUT', `/bots/${id}`, { code: ta.value, restart })
      detail.code = ta.value
      S.dirty = false
      S.bots.set(id, r.bot)
      showSyntax(r.syntax)
      if (r.syntax) toast('保存しました (文法エラーがあるので起動しませんでした)')
      else toast(restart ? '保存して起動しました' : '保存しました')
      S.view?.onBot?.(r.bot)
    } catch (e) { toast(e.message) }
    markDirty()
    runBtn.disabled = false
  }
  const saveBtn = h('button', { class: 'btn', disabled: true, onclick: () => save(false) }, '保存')
  const running = () => b().status !== 'stopped' && b().status !== 'error'
  const runBtn = h('button', { class: 'btn primary', onclick: () => save(true) })
  const label = () => { runBtn.textContent = running() ? '保存して再起動' : '保存して起動' }
  label()
  const keys = h('div', { class: 'keys' }, ...['    ', ':', '(', ')', '"', "'", '[', ']', '{', '}', '=', '_', '#', '.', ','].map(k =>
    h('button', { type: 'button', onmousedown: e => e.preventDefault(), onclick: () => insert(k) }, k === '    ' ? '⇥' : k)))

  body.replaceChildren(keys, ta, h('div', { class: 'row', style: 'margin-top:8px' }, status, h('span', { class: 'grow' }), saveBtn, runBtn))
  return { onBot: label }
}

function tabSettings(id, detail, body, b) {
  const bot = b()
  const name = h('input', { type: 'text', value: bot.name, maxlength: 40 })
  const token = h('input', {
    type: 'password', placeholder: bot.token_set ? '設定済み (変えるときだけ入力)' : 'ここに bot のトークンを貼り付け',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  })
  const req = h('textarea', { class: 'mono', rows: 4, placeholder: '例:\naiohttp\nrequests', autocapitalize: 'off', spellcheck: 'false' })
  req.value = detail.requirements
  const err = h('p', { class: 'err' })
  const invite = h('div')
  const renderInvite = () => {
    const x = b()
    invite.replaceChildren(x.token_set && x.client_id
      ? h('div', { class: 'banner info stack' },
        h('div', null, x.bot_user ? `トークン設定済み: ${x.bot_user}` : 'トークン設定済み'),
        h('a', { class: 'btn primary block', href: inviteUrl(x), target: '_blank', rel: 'noopener' }, 'Discord のサーバーに招待する'))
      : h('div', { class: 'banner info' }, 'まだトークンが入っていません。下の手順でトークンを作って貼り付けてください。'))
  }
  renderInvite()

  const saveBtn = h('button', { class: 'btn primary block', type: 'submit' }, '保存')
  const form = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault()
    err.textContent = ''
    saveBtn.disabled = true
    const patch = { name: name.value, requirements: req.value }
    if (token.value.trim()) patch.token = token.value
    try {
      const r = await api('PUT', `/bots/${id}`, patch)
      S.bots.set(id, r.bot)
      token.value = ''
      token.placeholder = r.bot.token_set ? '設定済み (変えるときだけ入力)' : 'ここに bot のトークンを貼り付け'
      renderInvite()
      S.view?.onBot?.(r.bot)
      toast(r.token_check === 'unknown' ? '保存しました (Discord に接続できず、トークンは確かめられませんでした)' : '保存しました')
    } catch (x) { err.textContent = x.message } finally { saveBtn.disabled = false }
  } },
  invite,
  h('label', { class: 'field' }, h('span', null, '名前'), name),
  h('label', { class: 'field' }, h('span', null, 'トークン'), token,
    h('p', { class: 'muted small' }, 'トークンはこのサーバーにだけ保存され、bot には DISCORD_TOKEN として渡されます。コードには書かないでください。')),
  h('details', { open: !bot.token_set || null },
    h('summary', null, 'トークンの作り方'),
    h('ol', { class: 'steps small' },
      h('li', null, h('a', { href: 'https://discord.com/developers/applications', target: '_blank', rel: 'noopener' }, 'Discord Developer Portal'), ' を開き、右上の「New Application」で名前を付けて作成'),
      h('li', null, '左のメニューの「Bot」→「Reset Token」を押し、出てきたトークンをコピーして上に貼り付け'),
      h('li', null, 'メッセージに反応する bot なら、同じページの「MESSAGE CONTENT INTENT」をオンにして Save'),
      h('li', null, '「保存」したら「Discord のサーバーに招待する」で自分のサーバーに追加'),
      h('li', null, '上の「▶ 起動」を押す。次からはサーバーが再起動しても自動で動きます'))),
  h('label', { class: 'field' }, h('span', null, 'パッケージ (1 行に 1 つ)'), req,
    h('p', { class: 'muted small' }, 'discord.py 以外に使うライブラリ。保存すると次の起動で自動で入ります。')),
  err, saveBtn)

  const del = h('button', { class: 'btn danger block', onclick: async () => {
    if (!confirm(`「${b().name}」を削除しますか? コードとデータもすべて消えます。`)) return
    try { await api('DELETE', `/bots/${id}`); S.bots.delete(id); toast('削除しました'); go('#/') } catch (e) { toast(e.message) }
  } }, 'この bot を削除')

  body.replaceChildren(form, h('h2', null, '危険な操作'), del)
  return { onBot: renderInvite }
}

// ---------------------------------------------------------------- 設定

async function viewSettings() {
  const info = h('dl', { class: 'info' })
  const err = h('p', { class: 'err' })
  const cur = h('input', { type: 'password', name: 'current', autocomplete: 'current-password', required: true })
  const pw = h('input', { type: 'password', name: 'password', autocomplete: 'new-password', minlength: 8, required: true })
  const form = h('form', { class: 'stack card', onsubmit: async e => {
    e.preventDefault()
    err.textContent = ''
    try {
      await api('POST', '/password', { current: cur.value, password: pw.value })
      cur.value = pw.value = ''
      toast('パスワードを変えました (ほかの端末はログアウトします)')
    } catch (x) { err.textContent = x.message }
  } },
  h('label', { class: 'field' }, h('span', null, '今のパスワード'), cur),
  h('label', { class: 'field' }, h('span', null, '新しいパスワード (8 文字以上)'), pw),
  err, h('button', { class: 'btn', type: 'submit' }, 'パスワードを変える'))

  mount(topBar('設定', { back: '#/' }),
    h('h2', null, 'サーバー'), h('div', { class: 'card' }, info),
    h('h2', null, 'ホーム画面に追加'),
    h('p', { class: 'muted small' }, 'iPhone / iPad: Safari の共有ボタン (□↑) →「ホーム画面に追加」で、アプリのように開けます。アプリを閉じても bot はサーバーで動き続けます。'),
    h('h2', null, 'パスワード'), form,
    h('h2', null, 'ログアウト'),
    h('button', { class: 'btn block', onclick: async () => { await api('POST', '/logout').catch(() => {}); start() } }, 'この端末からログアウト'))

  try {
    const s = await api('GET', '/server')
    const rows = [
      ['バージョン', s.version], ['マシン', s.hostname], ['OS', s.platform], ['Python', s.python],
      ['起動してから', duration(s.uptime)], ['空き容量', bytes(s.disk_free)], ['データの場所', s.data_dir],
    ]
    info.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]))
  } catch (e) { info.textContent = e.message }
}

start()

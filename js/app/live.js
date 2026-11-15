// 実機連携 (ForgeCode Live): Delta などのエグゼキューターと ForgeCode をつなぐ
// ・中継サーバー (relay/server.mjs) を通して、▶ のスクリプトを実際のゲームの中で実行し、出力・エラーを受け取る
// ・コンソールの式をゲームの中で評価、ゲームのオブジェクトを一覧
// ・サーバーなしでも使える「コピー & 貼り付け」モード
import { app, command, runCommand } from './app.js'
import { getSettings, setSettings, emit, on } from './store.js'
import { h, icon, toast, copyText, modal, menu, promptDialog, haptic } from './ui.js'
import * as db from '../editor/apidb.js'
import { roomOf } from './sha256.js'
import { DEFAULT_RELAY } from './live-config.js'

const STORE = 'forgecode.live'
const rand = (bytes, alphabet = 'abcdefghijklmnopqrstuvwxyz234567') => {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map(b => alphabet[b % alphabet.length]).join('')
}
const normRelay = u => String(u || '').trim().replace(/\/+$/, '')
const relayOk = u => /^https:\/\/[^\s/]+/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u)
const TARGETS = new Set(['auto', 'emulator', 'device'])
// 依頼への返事 (id で待っている相手に渡す)
const REPLIES = new Set(['evalResult', 'tree', 'props', 'setProp', 'expanded', 'watchValues', 'pong'])

class LiveLink {
  constructor() {
    let saved = {}
    try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') } catch {}
    this.key = typeof saved.key === 'string' && saved.key.length >= 32 ? saved.key : rand(40, '0123456789abcdef')
    // 部屋の ID は鍵から決まる (中継サーバーが再起動しても、他の人に乗っ取られない)
    this.room = roomOf(this.key)
    this.target = TARGETS.has(saved.target) ? saved.target : 'auto'
    this.allLogs = !!saved.allLogs
    this.used = !!saved.used   // エグゼキューター用の 1 行をコピーしたことがある (= 実機連携を使う人)
    this.cleanupRuns = saved.cleanup !== false // もう一度実行する前に、前回の実行で作ったものを片付ける
    this.hotReload = !!saved.hotReload         // 保存したら実機に自動で反映
    this.save()
    this.state = 'off'      // off | connecting | waiting (相手待ち) | online | error
    this.error = ''
    this.peer = null        // { executor, game, player, placeId }
    this.peerOnline = false
    this.after = -1
    this.gen = ''
    this.lastOk = 0
    this.autoRelay = ''     // 中継サーバーと同じ場所から開いたとき、その URL
    this.outbox = []
    this.pending = new Map() // id → { resolve, reject, timer }
    this.seq = 1
    this.loopId = 0
    this.recvCtrl = null
    this.handlers = new Set()
    // アプリに戻ったとき・通信が戻ったときは、すぐにつなぎ直す (iOS は裏にいる間の通信を止めるため)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick() })
    addEventListener('online', () => this.kick())
    addEventListener('pageshow', () => this.kick())
    on('settings', (s, prev) => { if (prev && s.liveRelay !== prev.liveRelay) this.restart() })
    setTimeout(() => this.detect(), 0)
  }

  // 中継サーバー: 設定 → 同じ場所 (中継サーバーから開いたとき) → アプリに組み込んだ既定 の順
  get relay() { return normRelay(getSettings().liveRelay) || this.autoRelay || normRelay(DEFAULT_RELAY) }
  get relaySource() { return normRelay(getSettings().liveRelay) ? 'custom' : this.autoRelay ? 'same' : normRelay(DEFAULT_RELAY) ? 'default' : '' }
  save() { try { localStorage.setItem(STORE, JSON.stringify({ key: this.key, target: this.target, allLogs: this.allLogs, used: this.used, cleanup: this.cleanupRuns, hotReload: this.hotReload })) } catch {} }
  setCleanup(on) { this.cleanupRuns = !!on; this.save(); emit('live', this.status()) }
  setHotReload(on) { this.hotReload = !!on; this.save(); emit('live', this.status()) }
  // 起動時から自動でつなぐか: 実機連携を使ったことがある人だけ (使わない人は中継サーバーと通信しない)
  get active() { return this.used || this.relaySource === 'custom' || this.target === 'device' }
  markUsed() { if (!this.used) { this.used = true; this.save() } if (this.relay) this.start() }
  onEvent(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn) }
  fire(m) { for (const f of this.handlers) { try { f(m) } catch {} } }
  setState(s, err = '') { const changed = s !== this.state || err !== this.error; this.state = s; this.error = err; if (changed) emit('live', this.status()) }
  status() { return { state: this.state, error: this.error, peer: this.peer, online: this.peerOnline, target: this.target, relay: this.relay, source: this.relaySource, device: this.runsOnDevice(), active: this.active || !!this.running } }
  // エグゼキューターに貼る 1 行。中継サーバーが起動中・通信が不安定でも、つながるまで裏で何度か試す (自動実行を止めない)
  oneLiner() { return `task.spawn(function() for _ = 1, 60 do local ok, s = pcall(function() return game:HttpGet("${this.relay}/c/${this.room}") end) if ok and s and #s > 0 then return loadstring(s)() end task.wait(5) end end)` }
  // ▶ をゲームの中で実行するか (自動: エグゼキューターがつながっていれば実機)
  runsOnDevice() { return this.target === 'device' || (this.target === 'auto' && !!this.relay && this.peerOnline && this.state === 'online') }

  setTarget(t) { this.target = TARGETS.has(t) ? t : 'auto'; this.save(); emit('live', this.status()); if (this.target !== 'emulator') this.start() }
  setAllLogs(on) { this.allLogs = !!on; this.save(); this.send({ t: 'config', allLogs: this.allLogs }) }

  // 中継サーバーと同じ場所から開いたか (Render などで本体ごと公開したとき)。それなら設定なしで使う
  // (中継サーバーが配る index.html には、その印が入っている)
  detect() {
    const meta = document.querySelector('meta[name="forgecode-relay"]')
    if (meta && meta.content === 'same' && /^https?:$/.test(location.protocol)) { this.autoRelay = location.origin; emit('live', this.status()) }
    if (this.relay && this.active) this.start()
  }

  async regenerate() {
    this.key = rand(40, '0123456789abcdef')
    this.room = roomOf(this.key)
    this.peer = null
    this.peerOnline = false
    this.after = -1
    this.gen = ''
    this.save()
    await this.restart()
  }

  async restart() {
    this.loopId++
    if (this.recvCtrl) { try { this.recvCtrl.abort() } catch {} }
    this.running = false
    this.after = -1; this.gen = ''; this.peer = null; this.peerOnline = false
    if (this.relay) await this.start(); else this.setState('off')
  }

  // 止まっていそうなら、すぐにつなぎ直す
  kick() {
    if (!this.relay || !this.active) return
    if (!this.running) { this.start(); return }
    if (Date.now() - this.lastOk > 26000 && this.recvCtrl) { try { this.recvCtrl.abort() } catch {} }
  }

  // 部屋を開いて、受信を始める (失敗しても、しばらくしてから自動でやり直す)
  async start() {
    if (!this.relay) { this.setState('off'); return false }
    if (this.running) return true
    if (!relayOk(this.relay)) { this.setState('error', '中継サーバーの URL は https:// で始まる必要があります'); return false }
    this.running = true
    const id = ++this.loopId
    if (this.state !== 'online') this.setState('connecting')
    try {
      const r = await this.fetch('/open', { method: 'POST' }, 70000)
      if (r.status === 403) throw new Error('接続コードが正しくありません。「接続コードを作り直す」を押してください')
      if (!r.ok) throw new Error('中継サーバーに接続できません (' + r.status + ')')
      const d = await r.json()
      if (id !== this.loopId) return false
      if (d.gen && d.gen !== this.gen) { this.gen = d.gen; this.after = -1 }
      this.lastOk = Date.now()
      this.peerOnline = !!(d.peer && d.peer.online)
      this.setState(this.peerOnline ? 'online' : 'waiting')
      this.flush()
    } catch (e) {
      if (id !== this.loopId) return false
      this.running = false
      this.setState('error', e && e.name === 'AbortError' ? '中継サーバーの応答がありません (無料のサーバーは起動に 1 分ほどかかることがあります)。自動でやり直します' : (e && e.message) || String(e))
      // 自動でやり直す
      clearTimeout(this.retryTimer)
      this.retryTimer = setTimeout(() => { if (!this.running && this.relay) this.start() }, 8000)
      return false
    }
    this.loop(id)
    return true
  }

  fetch(pathPart, opts = {}, timeout = 30000, ctrl = new AbortController()) {
    const timer = setTimeout(() => ctrl.abort(), timeout)
    return fetch(`${this.relay}/r/${this.room}${pathPart}`, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Forgecode-Key': this.key, ...(opts.headers || {}) }, signal: ctrl.signal, cache: 'no-store' }).finally(() => clearTimeout(timer))
  }

  async loop(id) {
    let fails = 0
    while (id === this.loopId && this.relay) {
      try {
        const ctrl = new AbortController()
        this.recvCtrl = ctrl
        const r = await this.fetch(`/recv?as=editor&wait=20&after=${this.after}&gen=${this.gen}`, {}, 30000, ctrl)
        if (id !== this.loopId) break
        if (r.status === 403) { this.running = false; this.setState('error', '接続コードが正しくありません。「接続コードを作り直す」を押してください'); return }
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const d = await r.json()
        fails = 0
        this.lastOk = Date.now()
        if (d.gen && d.gen !== this.gen) this.gen = d.gen
        this.after = d.seq
        const was = this.peerOnline
        this.peerOnline = !!(d.peer && d.peer.online)
        for (const item of d.msgs || []) this.receive(item.m, item.age)
        // 相手はいるのに、どのゲームか分からない (先にエグゼキューターがつないでいた) → 名乗ってもらう
        if (this.peerOnline && !this.peer && !this.asked) { this.asked = true; this.send({ t: 'who' }) }
        if (!this.peerOnline) this.asked = false
        if (was !== this.peerOnline || this.state !== (this.peerOnline ? 'online' : 'waiting')) this.setState(this.peerOnline ? 'online' : 'waiting')
      } catch (e) {
        if (id !== this.loopId) break
        fails++
        // アプリに戻ったときに止めた分は数えない
        if (e && e.name === 'AbortError' && Date.now() - this.lastOk < 60000) { fails = Math.max(0, fails - 1); continue }
        if (fails >= 2) this.setState('error', '中継サーバーとの通信が切れました。つなぎ直しています…')
        await new Promise(r => setTimeout(r, Math.min(15000, 1500 * fails)))
      }
    }
    if (id === this.loopId) this.running = false
  }

  receive(m, age) {
    if (!m || typeof m !== 'object') return
    if (m.t === 'hello') {
      const fresh = !this.peer || this.peer.placeId !== m.placeId || Date.now() - (this.helloAt || 0) > 600000
      this.peer = { executor: String(m.executor || ''), game: String(m.game || ''), player: String(m.player || ''), placeId: m.placeId, logs: m.logs, v: m.v, features: m.features || {} }
      this.helloAt = Date.now()
      this.peerOnline = true
      this.setState('online')
      emit('live', this.status())
      this.send({ t: 'config', allLogs: this.allLogs })
      if (fresh && (age === undefined || age < 60000)) toast(`${this.peer.executor && this.peer.executor !== '?' ? this.peer.executor : 'エグゼキューター'} とつながりました${this.peer.game ? ' — ' + this.peer.game : ''}`, { icon: 'device', duration: 3000 })
    }
    if (REPLIES.has(m.t) && m.id !== undefined && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)
      this.pending.delete(m.id)
      clearTimeout(p.timer)
      p.resolve(m)
      return
    }
    this.fire({ ...m, age })
  }

  send(m) {
    this.outbox.push(m)
    this.flush()
  }
  async flush() {
    if (this.flushing || !this.outbox.length || !this.relay) return
    this.flushing = true
    try {
      while (this.outbox.length) {
        const batch = this.outbox.splice(0, 50)
        try {
          const r = await this.fetch('/send?as=editor', { method: 'POST', body: JSON.stringify({ msgs: batch }) })
          if (!r.ok) throw new Error('HTTP ' + r.status)
        } catch (e) {
          this.outbox.unshift(...batch)
          setTimeout(() => this.flush(), 2000)
          break
        }
      }
    } finally { this.flushing = false }
  }

  request(m, timeout = 15000) {
    const id = this.seq++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(this.peerOnline ? 'ゲームからの返事がありません' : 'エグゼキューターがつながっていません')) }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ ...m, id })
    })
  }

  run(path, code, extra = {}) {
    const id = this.seq++
    this.send({ t: 'run', id, chunk: path, code, ...extra })
    return id
  }
  eval(code) { return this.request({ t: 'eval', code }) }
  tree(pathArr) { return this.request({ t: 'tree', path: pathArr }) }
  props(pathArr, names) { return this.request({ t: 'props', path: pathArr, names }) }
  setProp(pathArr, name, expr) { return this.request({ t: 'setProp', path: pathArr, name, expr }) }
  expand(ref) { return this.request({ t: 'expand', ref }) }
  watch(run, exprs) { return this.request({ t: 'watch', run, exprs }) }
  dbg(run, cmd) { this.send({ t: 'dbg', run, cmd }) }
  sendBps(bps) { this.send({ t: 'dbgBps', bps }) }
  // 応答の速さ (ミリ秒)
  async ping() { const t0 = performance.now(); await this.request({ t: 'ping' }, 10000); return Math.round(performance.now() - t0) }
  stopRuns(cleanup = true) { this.send({ t: 'stop', cleanup }) }
}

export const live = new LiveLink()

// ============================================================
// サーバーなしで使う: 実行結果をクリップボード経由で受け取る
// ============================================================
export function clipboardScript(path, code, seconds = 8) {
  let level = 1
  while (code.includes(']' + '='.repeat(level) + ']')) level++
  const eq = '='.repeat(level)
  const p = String(path).replace(/[^\w./ -]/g, '_')
  return `-- ForgeCode: ${p} を実行して、${seconds} 秒後に出力とエラーをクリップボードにコピーします
-- コピーされたら ForgeCode の「実機」→「結果を貼り付け」で表示できます
local __source = [${eq}[
${code}]${eq}]
local __HttpService = game:GetService("HttpService")
local __logs, __t0 = {}, os.clock()
local __result = { v = 1, path = "${p}" }
local __conn
pcall(function()
	__conn = game:GetService("LogService").MessageOut:Connect(function(text, kind)
		if #__logs < 500 then
			__logs[#__logs + 1] = { k = kind.Name, t = text, s = os.clock() - __t0 }
		end
	end)
end)
local __fn, __err = loadstring(__source, "=${p}")
if not __fn then
	__result.syntax = tostring(__err)
else
	task.spawn(function()
		local ok, err = xpcall(__fn, function(e)
			return tostring(e) .. "\\n" .. debug.traceback()
		end)
		__result.ok = ok
		__result.error = (not ok) and tostring(err) or nil
	end)
end
task.delay(${seconds}, function()
	if __conn then
		__conn:Disconnect()
	end
	__result.logs = __logs
	local text = "FORGECODE-RESULT " .. __HttpService:JSONEncode(__result)
	if setclipboard then
		setclipboard(text)
	elseif toclipboard then
		toclipboard(text)
	end
	pcall(function()
		game:GetService("StarterGui"):SetCore("SendNotification", { Title = "ForgeCode", Text = "結果をコピーしました。ForgeCode で「結果を貼り付け」", Duration = 6 })
	end)
end)
`
}

export function parseClipboardResult(text) {
  const m = /FORGECODE-RESULT\s+(\{[\s\S]*\})\s*$/.exec(String(text || '').trim())
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

// ============================================================
// 「実機」パネル
// ============================================================
export function renderLivePanel(el, runner) {
  const st = live.status()
  el.textContent = ''
  const sec = (title, ...kids) => h('div', { class: 'lv-sec' }, title ? h('div', { class: 'lv-title' }, title) : null, ...kids)

  // ---- 状態 ----
  const dot = st.state === 'online' ? 'on' : st.state === 'error' ? 'err' : st.relay ? 'wait' : 'off'
  const stateText = !st.relay ? '中継サーバーが未設定です'
    : st.state === 'online' ? `${st.peer && st.peer.executor && st.peer.executor !== '?' ? st.peer.executor : 'エグゼキューター'} とつながっています`
      : st.state === 'connecting' ? '中継サーバーに接続しています…'
        : st.state === 'error' ? st.error
          : 'エグゼキューターの接続を待っています'
  const head = h('div', { class: 'lv-status' }, h('span', { class: 'lv-dot ' + dot }), h('div', { class: 'lv-status-text' },
    h('div', { class: 'lv-state' }, stateText),
    st.state === 'online' && st.peer ? h('div', { class: 'lv-sub' }, [st.peer.game || (st.peer.placeId ? 'PlaceId ' + st.peer.placeId : ''), st.peer.player].filter(Boolean).join(' ・ ')) : null))
  // 実行先 (自動: つながっていれば実機、いなければエミュレーター)
  const segBtn = (t, label) => h('button', { class: 'seg-btn' + (st.target === t ? ' on' : ''), onclick: () => { if (t === 'device' && !live.relay) { toast('先に中継サーバーを設定してください'); return } live.setTarget(t); renderLivePanel(el, runner) } }, label)
  const seg = h('div', { class: 'seg' }, segBtn('auto', '自動'), segBtn('emulator', 'エミュレーター'), segBtn('device', '実機'))
  const targetNote = st.target === 'auto' ? (st.device ? 'いまはゲームの中で実行します' : 'エグゼキューターがつながると、自動でゲームの中で実行します') : st.target === 'device' ? 'いつもゲームの中で実行します' : 'いつもエミュレーターで実行します'
  el.append(sec(null, head, h('div', { class: 'lv-row' }, h('span', { class: 'lv-label' }, '▶ の実行先'), seg), h('div', { class: 'lv-desc lv-target-note' }, targetNote)))

  // 描画の途中で状態が変わって描き直しにならないよう、つなぐのは描き終えてから
  if (st.relay && !live.running) setTimeout(() => { if (!live.running) live.start() }, 0)
  if (!st.relay) {
    el.append(setupSection(el, runner))
  } else {
    // ---- つなぎ方 (最初の 1 回だけ) ----
    const code = h('code', { class: 'lv-code' }, live.oneLiner())
    el.append(sec(st.state === 'online' ? 'エグゼキューターでつなぐ' : 'エグゼキューターでつなぐ (最初の 1 回だけ)',
      h('ol', { class: 'lv-steps' },
        h('li', null, '下の 1 行をコピー'),
        h('li', null, 'Delta などの autoexec (自動実行) に貼り付けて保存'),
        h('li', null, 'ゲームを開くと自動でつながります。あとはコードを書いて ▶ を押すだけです')),
      code,
      h('div', { class: 'lv-acts' },
        h('button', { class: 'btn small primary', onclick: () => { live.markUsed(); copyText(live.oneLiner()).then(() => toast('1 行をコピーしました。エグゼキューターの autoexec に貼り付けてください', { icon: 'copy' })) } }, icon('copy', 14), '1 行をコピー'),
        h('button', { class: 'btn small ghost', onclick: () => fullConnector() }, 'スクリプト全体をコピー'),
        h('button', { class: 'btn small ghost', title: 'その他', 'aria-label': 'その他', onclick: () => menu([
          { label: 'つなぎ直す', icon: 'refresh', run: () => live.restart() },
          { label: 'ゲーム全体の出力も表示: ' + (live.allLogs ? 'オン' : 'オフ'), icon: 'filter', run: () => { live.setAllLogs(!live.allLogs); renderLivePanel(el, runner) } },
          { label: '接続コードを作り直す', icon: 'lock', run: async () => { await live.regenerate(); renderLivePanel(el, runner); toast('新しい接続コードにしました。エグゼキューターの 1 行も新しいものに入れ替えてください') } },
          { label: '中継サーバーを変更', icon: 'gear', run: () => app.wb.showView('settings', '中継') },
        ], null, { title: '実機連携' }) }, icon('more', 14))),
      h('p', { class: 'lv-note' }, icon('lock', 12), 'ForgeCode を閉じていても、開いたときに自動でつながります。テレポートしてもつながったままです。コードを送れるのはこの端末の ForgeCode だけです (この 1 行に鍵は入っていません)。')))

    // ---- 実行・コンソール ----
    const toggle = (label, desc, on, set) => h('label', { class: 'lv-toggle' },
      h('input', { type: 'checkbox', checked: on, onchange: e => { set(e.target.checked); renderLivePanel(el, runner) } }),
      h('span', { class: 'lv-toggle-text' }, h('span', null, label), h('span', { class: 'lv-sub' }, desc)))
    const latency = h('span', { class: 'lv-sub lv-latency' })
    el.append(sec('実機で試す',
      h('div', { class: 'lv-acts' },
        h('button', { class: 'btn small', onclick: () => runner.run({ device: true }) }, icon('play', 14), '開いているファイルを実機で実行'),
        h('button', { class: 'btn small ghost', onclick: () => { live.stopRuns(live.cleanupRuns); toast(live.cleanupRuns ? '実機の実行を止めて、作ったものを片付けました' : '実機の実行を止めました (つないだイベントは動き続けることがあります)') } }, icon('stop', 14), '止める'),
        st.state === 'online' ? h('button', { class: 'btn small ghost', onclick: async () => { latency.textContent = '測っています…'; try { latency.textContent = `応答 ${await live.ping()} ms` } catch (e) { latency.textContent = e.message } } }, icon('refresh', 14), '接続を確かめる') : null,
        latency),
      toggle('もう一度実行する前に片付ける', '前回の実行のイベントの接続・作ったオブジェクト・スレッドを消してから実行します (UI が重ならない)', live.cleanupRuns, v => live.setCleanup(v)),
      toggle('保存したら実機に自動で反映', '実機で実行したファイルを保存するたびに、ゲームの中で実行し直します (構文エラーがあるうちは送りません)', live.hotReload, v => live.setHotReload(v)),
      h('p', { class: 'lv-desc' }, 'require でプロジェクトの他のファイルも使えます。ブレークポイントを付けて実行すると、ゲームの中でもその行で止まり、変数を見ながら 1 行ずつ進められます。コンソールの式もゲームの中で評価します (例: workspace:GetChildren())。')))

    // ---- オブジェクト ----
    const tree = h('div', { class: 'lv-tree' })
    el.append(sec('ゲームのオブジェクト', st.state === 'online' ? tree : h('p', { class: 'lv-desc' }, 'つながると、ゲームの中のオブジェクトを一覧できます。')))
    if (st.state === 'online') loadTree(tree, [], 0)
  }

  // ---- サーバーなし ----
  el.append(sec('サーバーなしで使う (コピー & 貼り付け)',
    h('p', { class: 'lv-desc' }, '開いているファイルを「実行して結果をコピーする」スクリプトにしてコピーします。エグゼキューターで実行し、数秒後にコピーされた結果をここに貼り付けると、出力とエラーを表示します。'),
    h('div', { class: 'lv-acts' },
      h('button', { class: 'btn small', onclick: () => copyForDevice() }, icon('copy', 14), '実機用にコピー'),
      h('button', { class: 'btn small', onclick: () => pasteResult(runner) }, icon('paste', 14), '結果を貼り付け'))))
}

// 中継サーバーのない ForgeCode (公開する人が 1 回だけ用意する)
const DEPLOY_URL = 'https://render.com/deploy?repo=https://github.com/oreo22321/Original'
function setupSection(el, runner) {
  const input = h('input', { class: 'input', placeholder: 'https://forgecode-live-xxxx.onrender.com', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', inputmode: 'url', value: getSettings().liveRelay || '' })
  return h('div', { class: 'lv-sec' },
    h('div', { class: 'lv-title' }, 'はじめに: 中継サーバーを用意する (1 回だけ・無料)'),
    h('p', { class: 'lv-desc' }, 'ブラウザの ForgeCode とエグゼキューターは直接つながれないため、間に小さな中継サーバーを置きます。一度用意すれば、あとは自動です。'),
    h('ol', { class: 'lv-steps' },
      h('li', null, '下の「Render で作る」を押し、GitHub のアカウントでログイン'),
      h('li', null, '「Apply」(作成) を押す。forgecode-live ができます'),
      h('li', null, 'できた URL (https://〜.onrender.com) を下に貼り付けて保存')),
    h('div', { class: 'lv-acts' }, h('a', { class: 'btn small primary', href: DEPLOY_URL, target: '_blank', rel: 'noopener' }, icon('server', 14), 'Render で作る')),
    h('div', { class: 'input-row' }, input, h('button', { class: 'btn primary', onclick: async () => {
      const v = normRelay(input.value)
      if (!relayOk(v)) { toast('https:// で始まる URL を入れてください', { kind: 'error' }); return }
      setSettings({ liveRelay: v })
      const ok = await live.start()
      renderLivePanel(el, runner)
      if (ok) toast('中継サーバーにつながりました', { icon: 'check' })
    } }, '保存')),
    h('p', { class: 'lv-note' }, 'できた URL をそのまま開くと、ForgeCode 本体も同じ場所で使えます (その場合は設定なしで自動でつながります)。無料のサーバーはしばらく使わないと止まり、次の接続に 1 分ほどかかることがあります。'))
}

async function fullConnector() {
  live.markUsed()
  try {
    const src = await fetch('live/connector.lua').then(r => { if (!r.ok) throw new Error(); return r.text() })
    await copyText(src.replace('{{RELAY}}', live.relay).replace('{{ROOM}}', live.room))
    toast('コネクターのスクリプトをコピーしました', { icon: 'copy' })
  } catch { toast('スクリプトを読み込めませんでした', { kind: 'error' }) }
}

async function copyForDevice() {
  const doc = app.editors.activeDoc()
  if (!doc || doc.lang !== 'luau') { toast('実機で試したい Luau のファイルを開いてください'); return }
  const code = doc.state.doc.toString()
  await copyText(clipboardScript(doc.path, code))
  toast('コピーしました。エグゼキューターで実行し、数秒後に戻って「結果を貼り付け」', { icon: 'copy', duration: 6000 })
}

async function pasteResult(runner) {
  let text = ''
  try { text = await navigator.clipboard.readText() } catch {}
  let r = parseClipboardResult(text)
  if (!r) {
    const ta = h('textarea', { class: 'input mono', rows: '6', placeholder: 'FORGECODE-RESULT … を貼り付け' })
    const ok = await new Promise(res => modal({ title: '結果を貼り付け', body: h('div', { class: 'form' }, h('div', { class: 'set-desc' }, 'エグゼキューターでコピーされた結果を貼り付けてください。'), ta), actions: [{ label: 'キャンセル', value: false }, { label: '表示', primary: true, run: () => res(true) }], onClose: () => res(false) }))
    if (!ok) return
    r = parseClipboardResult(ta.value)
    if (!r) { toast('ForgeCode の結果ではないようです', { kind: 'error' }); return }
  }
  runner.showDeviceResult(r)
}

async function loadTree(box, pathArr, depth) {
  box.append(h('div', { class: 'lv-loading' }, h('span', { class: 'spinner' }), '読み込み中…'))
  let res
  try { res = await live.tree(pathArr) } catch (e) { box.textContent = ''; box.append(h('div', { class: 'lv-desc' }, e.message)); return }
  box.textContent = ''
  if (!res.ok) { box.append(h('div', { class: 'lv-desc' }, res.error || '読み込めませんでした')); return }
  for (const it of res.items || []) {
    // 場所は「名前 + 何番目の子か」で表す (同じ名前のオブジェクトがあっても取り違えない)
    const p = [...pathArr, it.i ? { n: it.name, i: it.i } : it.name]
    const kids = h('div', { class: 'lv-kids hidden' })
    let loaded = false
    const row = h('div', { class: 'gt-row lv-node', style: { paddingLeft: 6 + depth * 14 + 'px' } },
      it.n ? icon('chevronRight', 14, 'twisty') : h('span', { class: 'twisty-space' }),
      h('span', { class: 'gt-icon' }),
      h('span', { class: 'lv-name' }, it.name),
      h('span', { class: 'gt-class' }, it.class),
      h('button', { class: 'icon-btn sm lv-more', title: '操作', 'aria-label': '操作', onclick: e => { e.stopPropagation(); nodeMenu(e.currentTarget, p, it, kids, depth) } }, icon('more', 14)))
    row.addEventListener('click', () => {
      if (!it.n) { showProps(kids, p, it, depth); return }
      const open = kids.classList.toggle('hidden') === false
      const tw = row.querySelector('.twisty')
      if (tw) tw.style.transform = open ? 'rotate(90deg)' : ''
      if (open && !loaded) { loaded = true; loadTree(kids, p, depth + 1) }
    })
    box.append(row, kids)
  }
  if (!(res.items || []).length) box.append(h('div', { class: 'lv-desc', style: { paddingLeft: 6 + depth * 14 + 'px' } }, '(なし)'))
}

const stepName = s => (typeof s === 'string' ? s : s.n)
export function pathExpr(p) {
  if (!p.length) return 'game'
  const ident = s => /^[A-Za-z_]\w*$/.test(s)
  let out = `game:GetService("${stepName(p[0]).replace(/"/g, '\\"')}")`
  for (const s of p.slice(1)) { const n = stepName(s); out += ident(n) ? '.' + n : `["${n.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]` }
  return out
}

// プロパティ: クラスのプロパティの一覧は ForgeCode の API データから。値はゲームから読む
const FIRST_PROPS = ['Name', 'ClassName', 'Parent', 'Position', 'Size', 'CFrame', 'Orientation', 'Color', 'BrickColor', 'Material', 'Transparency', 'Anchored', 'CanCollide', 'Visible', 'Text', 'TextColor3', 'BackgroundColor3', 'BackgroundTransparency', 'Image', 'Value', 'Health', 'MaxHealth', 'WalkSpeed', 'JumpPower', 'Enabled']
function propNames(cls) {
  const names = []
  for (const m of db.classMembers(cls).values()) {
    if (m.kind !== 'p' || /[hd]/.test(m.flags || '')) continue
    names.push(m.name)
  }
  names.sort((a, b) => {
    const ia = FIRST_PROPS.indexOf(a), ib = FIRST_PROPS.indexOf(b)
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
    return a.localeCompare(b)
  })
  return names.slice(0, 150)
}
async function showProps(box, p, it, depth) {
  if (!box.classList.contains('hidden') && box.dataset.props) { box.classList.add('hidden'); box.textContent = ''; delete box.dataset.props; return }
  box.classList.remove('hidden')
  box.dataset.props = '1'
  box.textContent = ''
  const wrap = h('div', { class: 'lv-props', style: { marginLeft: 14 + depth * 14 + 'px' } })
  box.append(wrap)
  if (!db.apiReady()) { wrap.append(h('div', { class: 'lv-desc' }, 'API データを読み込み中です。少し待ってからもう一度開いてください')); return }
  const names = propNames(it.class)
  if (!names.length) { wrap.append(h('div', { class: 'lv-desc' }, 'このオブジェクトのプロパティは分かりません')); return }
  wrap.append(h('div', { class: 'lv-loading' }, h('span', { class: 'spinner' }), '読み込み中…'))
  let res
  try { res = await live.props(p, names) } catch (e) { wrap.textContent = ''; wrap.append(h('div', { class: 'lv-desc' }, e.message)); return }
  wrap.textContent = ''
  if (!res.ok) { wrap.append(h('div', { class: 'lv-desc' }, res.error || '読み込めませんでした')); return }
  wrap.append(h('div', { class: 'lv-props-head' }, `${it.name} のプロパティ`, h('span', { class: 'lv-sub' }, ' — 値をタップすると変更できます')))
  for (const pr of res.items || []) {
    const valEl = h('span', { class: 'lv-prop-val t-' + String(pr.t).toLowerCase() }, pr.v)
    const row = h('div', { class: 'lv-prop' + (pr.edit ? ' editable' : '') }, h('span', { class: 'lv-prop-name' }, pr.name), valEl)
    if (pr.edit) {
      row.addEventListener('click', async () => {
        // true / false はタップで切り替え
        let expr = pr.t === 'boolean' ? String(pr.edit !== 'true') : await promptDialog(`${pr.name} を変更`, { value: pr.edit, label: `Luau の式で入力 (例: ${pr.edit})`, okLabel: '変更' })
        if (expr === null || expr === undefined || !String(expr).trim()) return
        valEl.textContent = '…'
        try {
          const r = await live.setProp(p, pr.name, String(expr).trim())
          if (!r.ok) { valEl.textContent = pr.v; toast(r.error || '変更できませんでした', { kind: 'error' }); return }
          pr.v = r.v; pr.edit = r.edit || pr.edit
          valEl.textContent = r.v
          haptic(6)
        } catch (e) { valEl.textContent = pr.v; toast(e.message, { kind: 'error' }) }
      })
    }
    wrap.append(row)
  }
}

function nodeMenu(anchor, p, it, kids, depth) {
  const expr = pathExpr(p)
  menu([
    { note: `${it.name} (${it.class})` },
    { label: 'プロパティを見る・変える', icon: 'filter', run: () => showProps(kids, p, it, depth) },
    { label: 'パスをコピー', icon: 'copy', run: () => copyText(expr).then(() => toast('コピーしました: ' + expr, { icon: 'copy' })) },
    { label: 'エディタに挿入', icon: 'edit', run: () => { const v = app.editors.activeView(); if (!v) { toast('先にファイルを開いてください'); return } const pos = v.state.selection.main.head; v.dispatch({ changes: { from: pos, insert: expr }, selection: { anchor: pos + expr.length } }); v.focus() } },
    { label: 'コンソールで調べる', icon: 'terminal', run: () => { app.runner.show('output'); app.runner.evalConsole(expr, { device: true }) } },
  ], anchor, { title: 'オブジェクト' })
}

// ステータスバー用
export function liveBadge() {
  const st = live.status()
  if (!st.relay || !st.active) return null
  return { on: st.state === 'online', text: st.device ? '実機' : '実機連携', state: st.state }
}

command('liveOpen', '実機連携 (エグゼキューター) を開く', () => { runCommand('togglePanel', true); app.runner.show('live') }, { icon: 'device' })
command('liveRun', '実機で実行', () => app.runner.run({ device: true }), { icon: 'play' })
command('liveCopyLine', '実機連携: エグゼキューター用の 1 行をコピー', () => { if (!live.relay) { runCommand('liveOpen'); return } live.markUsed(); copyText(live.oneLiner()).then(() => toast('1 行をコピーしました', { icon: 'copy' })) }, { icon: 'copy' })
command('liveCopyForDevice', '実機用にコピー (結果をクリップボードで受け取る)', () => copyForDevice(), { icon: 'copy' })
command('livePasteResult', '実機の結果を貼り付け', () => pasteResult(app.runner), { icon: 'paste' })

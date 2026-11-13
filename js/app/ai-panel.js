// AI パネル (Forge AI: アプリに内蔵した AI。インターネット・API キー不要)
import { app, command, runCommand } from './app.js'
import { getMode, on, emit } from './store.js'
import { h, icon, toast, copyText, modal, confirmDialog } from './ui.js'
import { renderMarkdown } from './markdown.js'
import { askAi, aiStatus, resetMemory } from './ai-host.js'
import { revertChanges, lineDiff } from './agent.js'
import { EditorSelection } from '../../vendor/codemirror.js'

const QUICK = [
  { label: '直して', prompt: 'このコードの問題を直して' },
  { label: '説明して', prompt: 'このコードを説明して' },
  { label: 'チェック', prompt: 'このコードをチェックして' },
  { label: '整理して', prompt: 'このコードを整理して' },
  { label: 'コメント', prompt: 'コメントを追加して' },
  { label: '最適化', prompt: '最適化して' },
]
const STARTERS = {
  studio: [
    { icon: 'cube', title: '触れたら死ぬブロック', prompt: '触れたら死ぬブロックを作って' },
    { icon: 'window', title: 'ショップの UI', prompt: 'ショップの UI を作って' },
    { icon: 'save', title: 'データを保存する', prompt: 'コインを保存するリーダーボードを作って' },
    { icon: 'bug', title: 'コードを直す', prompt: 'このコードの問題を直して' },
  ],
  executor: [
    { icon: 'eye', title: 'ESP', prompt: 'ESP を作って' },
    { icon: 'window', title: 'メニュー', prompt: 'ドラッグできるメニューを作って' },
    { icon: 'bolt', title: 'ボタンで速く歩く', prompt: 'ボタンで速く歩くのを切り替えられるようにして' },
    { icon: 'bug', title: 'コードを直す', prompt: 'このコードの問題を直して' },
  ],
}
const HISTORY_KEY = 'forgecode.ai.chat.'

export class AiView {
  constructor(root) {
    this.root = root
    this.messages = []
    this.ctrl = null
    this.busy = false
    this.pid = null
    this.build()
    on('ai', () => this.renderHead())
    on('project', p => { resetMemory(); this.loadChat(p && p.id) })
    on('settings', () => this.renderHead())
  }

  // ---- 会話の保存 (プロジェクトごと・この端末だけ) ----
  loadChat(pid) {
    if (this.busy) this.stop()
    this.pid = pid
    let list = []
    try { list = JSON.parse(localStorage.getItem(HISTORY_KEY + pid) || '[]') } catch {}
    this.messages = Array.isArray(list) ? list.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : []
    this.render()
  }
  saveChat() {
    if (!this.pid) return
    const slim = this.messages.slice(-40).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 20000), steps: (m.steps || []).slice(0, 20).map(s => ({ icon: s.icon, text: s.text, kind: s.kind })), error: m.error, stopped: m.stopped, changes: (m.changes || []).map(c => ({ path: c.path, added: c.added, removed: c.removed, created: c.before === null || c.created })), stale: true }))
    try { localStorage.setItem(HISTORY_KEY + this.pid, JSON.stringify(slim)) } catch {}
  }

  build() {
    this.head = h('div', { class: 'side-head ai-head' })
    this.log = h('div', { class: 'ai-log', 'aria-live': 'polite' })
    this.input = h('textarea', { class: 'input ai-input', rows: '2', placeholder: 'AI に頼む (例: 触れたら消えるパーツを作って / このエラーを直して)', autocapitalize: 'off', 'aria-label': 'AI への依頼' })
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.send() } })
    this.input.addEventListener('input', () => this.autosize())
    this.sendBtn = h('button', { class: 'btn primary icon-only ai-send', 'aria-label': '送信', onclick: () => (this.busy ? this.stop() : this.send()) }, icon('send', 18))
    this.quick = h('div', { class: 'chips ai-quick' })
    for (const q of QUICK) this.quick.append(h('button', { class: 'chip', onclick: () => this.send(q.prompt) }, q.label))
    this.compose = h('div', { class: 'ai-compose' }, this.quick, h('div', { class: 'input-row ai-row' }, this.input, this.sendBtn))
    this.root.append(this.head, this.log, this.compose)
    this.renderHead()
    this.render()
  }

  autosize() {
    const t = this.input
    t.style.height = 'auto'
    t.style.height = Math.min(160, t.scrollHeight + 2) + 'px'
  }

  renderHead() {
    const st = aiStatus()
    const l = st.llm
    let badge
    if (st.llmReady) badge = h('span', { class: 'ai-badge ok', title: '内蔵 AI + 端末内の言語モデルで動いています' }, '高性能')
    else if (st.llmKey && l.state === 'loading') badge = h('span', { class: 'ai-badge', title: l.progress.text }, `読込 ${Math.round((l.progress.value || 0) * 100)}%`)
    else badge = h('span', { class: 'ai-badge ok', title: 'アプリ内蔵の AI (オフラインで動きます)' }, '内蔵')
    this.head.replaceChildren(
      h('div', { class: 'side-title ai-title' }, icon('sparkle', 16), 'Forge AI', badge),
      h('div', { class: 'side-actions' },
        h('button', { class: 'icon-btn', title: 'AI の設定', 'aria-label': 'AI の設定', onclick: () => app.wb.showView('settings', 'AI') }, icon('gear', 18)),
        h('button', { class: 'icon-btn', title: '新しい会話', 'aria-label': '新しい会話', onclick: () => this.reset() }, icon('plus', 18))))
  }

  async reset() {
    if (this.busy) this.stop()
    if (this.messages.length && !(await confirmDialog('新しい会話', 'いまの会話を消して、新しく始めますか? (ファイルの変更はそのまま残ります)', { okLabel: '新しく始める' }))) return
    this.messages = []
    resetMemory()
    this.saveChat()
    this.render()
  }

  // ---- 表示 ----
  render() {
    this.log.replaceChildren()
    if (!this.messages.length) this.log.append(this.welcome())
    for (const m of this.messages) this.log.append(m.role === 'user' ? this.userBubble(m) : this.replyBubble(m))
    this.scrollEnd()
  }
  scrollEnd() { this.log.scrollTop = this.log.scrollHeight }

  welcome() {
    const mode = getMode() === 'executor' ? 'executor' : 'studio'
    const box = h('div', { class: 'ai-welcome' },
      h('div', { class: 'ai-empty-icon' }, icon('sparkle', 32)),
      h('div', { class: 'ai-welcome-title' }, '何をしましょう?'),
      h('p', { class: 'set-desc' }, 'Forge AI はアプリに内蔵された AI です。コードを直す・説明する・作る・質問に答える、をすぐに行います (インターネット不要)。変更はあとから「元に戻す」で取り消せます。'))
    const grid = h('div', { class: 'ai-starters' })
    for (const s of STARTERS[mode] || STARTERS.studio) grid.append(h('button', { class: 'ai-starter', onclick: () => this.send(s.prompt) }, icon(s.icon, 18), h('span', null, s.title)))
    box.append(grid, h('button', { class: 'btn small ghost ai-help-btn', onclick: () => this.send('何ができる?') }, icon('info', 14), 'できること一覧'))
    return box
  }

  userBubble(m) {
    return h('div', { class: 'ai-msg user' }, h('div', { class: 'ai-text' }, m.content))
  }

  replyBubble(m) {
    const el = h('div', { class: 'ai-msg assistant' })
    m.el = el
    m.stepsEl = h('div', { class: 'ai-steps' })
    m.bodyEl = h('div', { class: 'ai-text md-body' })
    el.append(m.stepsEl, m.bodyEl)
    this.paintSteps(m)
    this.paintBody(m)
    if (m.changes && m.changes.length) el.append(this.changesCard(m))
    if (m.error) el.append(h('div', { class: 'ai-error' }, icon('alert', 14), m.error))
    if (m.stopped) el.append(h('div', { class: 'ai-note' }, '停止しました'))
    if (!m.pending && this.messages[this.messages.length - 1] === m) {
      const acts = h('div', { class: 'ai-actions' })
      for (const c of (m.chips || []).slice(0, 4)) acts.append(h('button', { class: 'chip ai-chip', onclick: () => this.send(c) }, c))
      if (m.content) acts.append(h('button', { class: 'btn small ghost', onclick: () => copyText(m.content).then(() => toast('コピーしました')) }, icon('copy', 14), 'コピー'))
      if (acts.childElementCount) el.append(acts)
    }
    return el
  }

  paintSteps(m) {
    const steps = m.steps || []
    m.stepsEl.replaceChildren(...steps.map((s, i) => h('div', { class: 'ai-step' + (s.kind ? ' ' + s.kind : '') },
      m.pending && i === steps.length - 1 && !s.kind ? h('span', { class: 'spinner' }) : icon(s.icon || 'check', 13),
      h('span', null, s.text))))
    m.stepsEl.classList.toggle('hidden', !steps.length)
  }

  paintBody(m) {
    const body = m.bodyEl
    const text = m.content || ''
    if (!text) {
      body.replaceChildren()
      if (m.pending) body.append(h('div', { class: 'ai-thinking' }, h('span', { class: 'spinner' }), m.progress || '考えています…'))
      return
    }
    body.innerHTML = renderMarkdown(text, { images: false, codeBlock: (code, lang) => `<div class="ai-code"><div class="ai-code-bar"><span>${(lang || 'code').replace(/[^\w-]/g, '')}</span><span class="ai-code-actions"><button data-act="copy">コピー</button><button data-act="insert">挿入</button><button data-act="replace">選択範囲と置換</button></span></div><pre><code></code></pre></div>` })
    const codes = []
    const re = /```[\w+-]*\n([\s\S]*?)(?:```|$)/g
    let mm
    while ((mm = re.exec(text))) codes.push(mm[1].replace(/\n$/, ''))
    body.querySelectorAll('.ai-code').forEach((block, i) => {
      block.querySelector('code').textContent = codes[i] || ''
      block.querySelector('.ai-code-actions').addEventListener('click', e => {
        const act = e.target.dataset.act
        if (!act) return
        const code = codes[i] || ''
        if (act === 'copy') copyText(code).then(() => toast('コピーしました'))
        else this.insertCode(code, act === 'replace')
      })
    })
  }

  changesCard(m) {
    const box = h('div', { class: 'ai-changes' + (m.reverted ? ' reverted' : '') })
    box.append(h('div', { class: 'ai-changes-head' }, icon('edit', 14), m.reverted ? '変更を元に戻しました' : `${m.changes.length} 個のファイルを変更`))
    for (const c of m.changes) {
      if (c.added === undefined && c.after !== undefined) { const d = lineDiff(c.before || '', c.after); c.added = d.added; c.removed = d.removed }
      const created = c.before === null || c.created
      const row = h('div', { class: 'ai-change' },
        icon(created ? 'newFile' : 'file', 15),
        h('button', { class: 'ai-change-path', onclick: () => this.openFile(c.path) }, c.path),
        created ? h('span', { class: 'ai-tag' }, '新規') : null,
        h('span', { class: 'ai-plus' }, '+' + (c.added || 0)), h('span', { class: 'ai-minus' }, '−' + (c.removed || 0)))
      if (c.after !== undefined && !m.reverted) row.append(h('button', { class: 'btn small ghost', onclick: () => this.showDiff(c) }, icon('diff', 14), '差分'))
      box.append(row)
    }
    if (!m.reverted && !m.stale && m.changes.some(c => c.after !== undefined)) {
      box.append(h('div', { class: 'ai-changes-acts' }, h('button', { class: 'btn small', onclick: async () => {
        if (!(await confirmDialog('変更を元に戻す', `AI が変更した ${m.changes.length} 個のファイルを、頼む前の状態に戻しますか?${m.changes.some(c => c.before === null) ? ' (新しく作ったファイルは削除されます)' : ''}`, { okLabel: '元に戻す', danger: true }))) return
        try { await revertChanges(m.changes); m.reverted = true; toast('元に戻しました', { icon: 'undo' }); this.saveChat(); this.render() } catch (e) { toast('元に戻せませんでした: ' + e.message, { kind: 'error' }) }
      } }, icon('undo', 14), 'すべて元に戻す')))
    }
    return box
  }

  showDiff(c) {
    const d = lineDiff(c.before || '', c.after || '')
    const pre = h('div', { class: 'ai-diff' })
    for (const o of d.ops) {
      pre.append(h('div', { class: 'ai-dl ' + (o.t === '+' ? 'add' : o.t === '-' ? 'del' : 'ctx') },
        h('span', { class: 'ai-dn' }, o.t === '+' ? '' : String(o.a || '')), h('span', { class: 'ai-dn' }, o.t === '-' ? '' : String(o.b || '')),
        h('span', { class: 'ai-ds' }, o.t), h('span', { class: 'ai-dt' }, o.s)))
    }
    modal({ title: `${c.path} の変更 (+${d.added} −${d.removed})`, wide: true, body: pre, actions: [{ label: 'ファイルを開く', run: () => { this.openFile(c.path) } }, { label: '閉じる', primary: true }] })
  }

  openFile(path) {
    if (!app.files.some(f => f.path === path)) { toast('ファイルが見つかりません'); return }
    app.editors.open(path)
    emit('fileOpened', path)
  }

  insertCode(code, replace) {
    const v = app.editors.activeView()
    if (!v) { toast('先にファイルを開いてください'); return }
    const sel = v.state.selection.main
    const from = replace ? sel.from : sel.head, to = replace ? sel.to : sel.head
    v.dispatch({ changes: { from, to, insert: code }, selection: EditorSelection.cursor(from + code.length), scrollIntoView: true, userEvent: 'input.paste' })
    toast(replace ? '置き換えました' : '挿入しました')
  }

  // ---- 送信 ----
  stop() { if (this.ctrl) { this.ctrl.abort(); this.ctrl = null } }

  history() {
    return this.messages.filter(m => !m.pending).slice(-8).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 2000) }))
  }
  lastChanges() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]
      if (m.role === 'assistant' && m.changes && m.changes.length && !m.reverted && !m.stale && m.changes.some(c => c.after !== undefined)) return m
    }
    return null
  }

  async send(textArg) {
    if (this.busy) return
    const text = String(textArg == null ? this.input.value : textArg).trim().slice(0, 20000)
    if (!text) return
    const history = this.history()
    if (textArg === undefined) { this.input.value = ''; this.autosize() }
    const user = { role: 'user', content: text }
    const reply = { role: 'assistant', content: '', steps: [], pending: true, changes: [] }
    this.messages.push(user, reply)
    this.render()
    this.ctrl = new AbortController()
    const signal = this.ctrl.signal
    this.setBusy(true)
    let raf = 0
    const repaint = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (reply.el) { this.paintBody(reply); this.scrollEnd() } }) }
    try {
      const r = await askAi({
        text, history, signal,
        focusEdits: app.wb.layout === 'desktop',
        lastChanges: () => this.lastChanges(),
        onText: t => { reply.content = t; repaint() },
        onProgress: p => { reply.progress = p.text + (p.value ? ` (${Math.round(p.value * 100)}%)` : ''); repaint() },
        onStep: s => { reply.steps.push(s); if (reply.stepsEl) { this.paintSteps(reply); if (!reply.content) this.paintBody(reply); this.scrollEnd() } },
      })
      reply.content = r.text
      reply.chips = r.chips
      reply.changes = r.changes
    } catch (e) {
      if (e && e.name === 'AbortError') reply.stopped = true
      else reply.error = (e && e.message) || 'エラーが発生しました'
      if (e && e.changes) reply.changes = e.changes
    } finally {
      cancelAnimationFrame(raf)
      reply.pending = false
      this.ctrl = null
      this.setBusy(false)
      this.saveChat()
      this.render()
    }
  }

  setBusy(b) {
    this.busy = b
    this.sendBtn.replaceChildren(icon(b ? 'stop' : 'send', 18))
    this.sendBtn.setAttribute('aria-label', b ? '停止' : '送信')
    this.sendBtn.classList.toggle('danger', b)
    emit('aiBusy', b)
  }
}

const view = () => { app.wb.showView('ai'); return app.wb.views.ai }
command('aiChat', 'AI を開く', () => app.wb.showView('ai'), { icon: 'sparkle' })
// 依頼を入力済みの状態で開いて送る (実行エラーの「AI で直す」など)
command('aiAsk', 'AI に頼む', text => { const v = view(); if (typeof text === 'string') v.send(text) }, { icon: 'sparkle' })
command('aiExplain', 'AI: このコードを説明', () => view().send('このコードを説明して'), { icon: 'sparkle' })
command('aiFix', 'AI: 問題を探して直す', () => view().send('このコードの問題を直して'), { icon: 'sparkle' })
command('aiReview', 'AI: コードをチェック', () => view().send('このコードをチェックして'), { icon: 'sparkle' })
command('aiComment', 'AI: コメントを追加', () => view().send('コメントを追加して'), { icon: 'sparkle' })
command('aiTidy', 'AI: コードを整理', () => view().send('このコードを整理して'), { icon: 'sparkle' })
command('aiOptimize', 'AI: 動作を軽くする', () => view().send('最適化して'), { icon: 'sparkle' })
command('aiTypes', 'AI: 型注釈を付ける', () => view().send('型注釈を付けて'), { icon: 'sparkle' })

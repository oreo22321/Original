// Claude パネル (ForgeCode に組み込んだ Claude エージェント)
import { app, command, runCommand } from './app.js'
import { getSettings, setSettings, on, emit } from './store.js'
import { h, icon, toast, copyText, modal, confirmDialog } from './ui.js'
import { renderMarkdown } from './markdown.js'
import { status, aiReady, canSendImages, errorMessage, IN_CLAUDE, CLAUDE_APP_URL } from './claude.js'
import { runAgent, revertChanges, lineDiff } from './agent.js'
import { EditorSelection } from '../../vendor/codemirror.js'

const QUICK = [
  { label: '説明して', prompt: '開いているコードが何をしているか、初心者にもわかるように説明してください。' },
  { label: 'バグを直して', prompt: '開いているコードのバグや問題点を探して直してください。直したら実行して確かめてください。' },
  { label: 'エラーを直して', prompt: '実行するとエラーが出ます。原因を調べて直し、実行して確かめてください。' },
  { label: 'コメントを追加', prompt: '開いているコードに、日本語で分かりやすいコメントを追加してください (処理は変えないでください)。' },
  { label: 'きれいに整理', prompt: '開いているコードを、動きを変えずに読みやすく整理してください (重複をまとめる・名前を分かりやすく・古い API を新しいものに)。' },
]
const STARTERS = [
  { icon: 'window', title: 'ショップの UI を作って', prompt: 'スマホでも見やすいショップの UI (タイトル・閉じるボタン・アイテム 3 つ・購入ボタン) を作って、実行して見た目を確かめてください。' },
  { icon: 'eye', title: 'Drawing で ESP を作って', prompt: 'Drawing を使った ESP (箱・名前・距離・体力バー) を作って、実行して確かめてください。' },
  { icon: 'bug', title: 'エラーを直して', prompt: QUICK[2].prompt },
  { icon: 'book', title: 'このコードを説明して', prompt: QUICK[0].prompt },
]
const TIERS = [['quick', '速い'], ['default', '標準'], ['complex', '高性能']]
const HISTORY_KEY = 'forgecode.ai.chat.'

export class AiView {
  constructor(root) {
    this.root = root
    this.messages = []
    this.ctrl = null
    this.busy = false
    this.attachments = []  // { blob, url }
    this.pid = null
    this.build()
    on('ai', () => { this.renderHead(); this.render() })
    on('project', p => this.loadChat(p && p.id))
    on('settings', () => this.renderHead())
  }

  // ---- 会話の保存 (プロジェクトごと・この端末だけ) ----
  loadChat(pid) {
    if (this.busy) this.stop()
    this.pid = pid
    let list = []
    try { list = JSON.parse(localStorage.getItem(HISTORY_KEY + pid) || '[]') } catch {}
    this.messages = Array.isArray(list) ? list : []
    this.render()
  }
  saveChat() {
    if (!this.pid) return
    const slim = this.messages.slice(-40).map(m => ({ role: m.role, content: m.content, steps: m.steps, error: m.error, stopped: m.stopped, changes: (m.changes || []).map(c => ({ path: c.path, added: c.added, removed: c.removed, created: c.before === null || c.created })), stale: true }))
    try { localStorage.setItem(HISTORY_KEY + this.pid, JSON.stringify(slim).slice(0, 400000)) } catch {}
  }

  build() {
    this.head = h('div', { class: 'side-head ai-head' })
    this.log = h('div', { class: 'ai-log' })
    this.input = h('textarea', { class: 'input ai-input', rows: '2', placeholder: 'Claude に頼む (例: 触れたら消えるパーツを作って)', autocapitalize: 'off' })
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.send() } })
    this.input.addEventListener('input', () => this.autosize())
    this.sendBtn = h('button', { class: 'btn primary icon-only ai-send', 'aria-label': '送信', onclick: () => (this.busy ? this.stop() : this.send()) }, icon('send', 18))
    this.fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, style: { display: 'none' } })
    this.fileInput.addEventListener('change', () => { this.addImages([...this.fileInput.files]); this.fileInput.value = '' })
    this.attachBtn = h('button', { class: 'icon-btn ai-attach', title: '画像を添付 (UI のスクリーンショットなど)', 'aria-label': '画像を添付', onclick: () => this.fileInput.click() }, icon('upload', 18))
    this.thumbs = h('div', { class: 'ai-thumbs hidden' })
    this.quick = h('div', { class: 'chips ai-quick' })
    for (const q of QUICK) this.quick.append(h('button', { class: 'chip', onclick: () => { this.input.value = q.prompt; this.autosize(); this.input.focus() } }, q.label))
    this.compose = h('div', { class: 'ai-compose' }, this.quick, this.thumbs, h('div', { class: 'input-row ai-row' }, this.attachBtn, this.input, this.sendBtn), this.fileInput)
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
    const st = status()
    const tier = getSettings().aiTier || 'default'
    const badge = st.provider === 'claude' ? h('span', { class: 'ai-badge ok', title: 'claude.ai のアカウントで動いています (API キー不要)' }, 'claude.ai')
      : st.provider === 'key' ? h('span', { class: 'ai-badge', title: '設定の API キーを使っています' }, 'API キー')
      : st.state === 'checking' ? h('span', { class: 'ai-badge' }, '接続中…') : h('span', { class: 'ai-badge off' }, '未接続')
    const sel = h('select', { class: 'ai-tier', title: 'Claude のモデル', 'aria-label': 'Claude のモデル' }, TIERS.map(([v, l]) => h('option', { value: v, selected: v === tier }, l)))
    sel.addEventListener('change', () => setSettings({ aiTier: sel.value }))
    this.head.replaceChildren(
      h('div', { class: 'side-title ai-title' }, icon('sparkle', 16), 'Claude', badge),
      h('div', { class: 'side-actions' }, st.provider ? sel : null,
        h('button', { class: 'icon-btn', title: '新しい会話', 'aria-label': '新しい会話', onclick: () => this.reset() }, icon('plus', 18))))
    this.attachBtn.classList.toggle('hidden', !(st.provider && canSendImages()))
  }

  async reset() {
    if (this.busy) this.stop()
    if (this.messages.length && !(await confirmDialog('新しい会話', 'いまの会話を消して、新しく始めますか? (ファイルの変更はそのまま残ります)', { okLabel: '新しく始める' }))) return
    this.messages = []
    this.saveChat()
    this.render()
  }

  // ---- 表示 ----
  render() {
    this.log.replaceChildren()
    const st = status()
    this.compose.classList.toggle('hidden', !st.provider)
    if (!st.provider) { this.log.append(this.setupCard(st)); return }
    if (!this.messages.length) this.log.append(this.welcome())
    for (const m of this.messages) this.log.append(m.role === 'user' ? this.userBubble(m) : this.replyBubble(m))
    this.scrollEnd()
  }
  scrollEnd() { this.log.scrollTop = this.log.scrollHeight }

  setupCard(st) {
    const box = h('div', { class: 'ai-empty ai-setup' }, h('div', { class: 'ai-empty-icon' }, icon('sparkle', 36)), h('h3', null, 'Claude を使う'))
    if (st.inClaude && st.state === 'checking') { box.append(h('p', null, 'Claude に接続しています…')); return box }
    if (st.inClaude && st.state === 'denied') {
      box.append(h('p', null, st.reason || 'この画面では Claude を使えません'), h('p', { class: 'set-desc' }, 'ページを開き直すと、使ってよいかの確認がもう一度出ます。'))
      return box
    }
    if (st.inClaude) {
      box.append(h('p', null, 'claude.ai の画面の中で開くと使えます。'), h('p', { class: 'set-desc' }, 'claude.ai にログインした状態で、この ForgeCode を開き直してください。'))
      return box
    }
    box.append(
      h('p', null, 'Claude がファイルを読んで、編集して、実行して確かめます。'),
      h('div', { class: 'ai-way' },
        h('div', { class: 'ai-way-title' }, icon('check', 15), 'おすすめ: Claude 版で開く (API キー不要)'),
        h('p', { class: 'set-desc' }, 'claude.ai のアカウントで動きます。料金はかからず、Claude の利用枠を使います。claude.ai にログインしたブラウザで開いてください (ログインしていないと「ページが見つかりません」と表示されます)。'),
        h('a', { class: 'btn primary', href: CLAUDE_APP_URL, target: '_blank', rel: 'noopener' }, icon('link', 16), 'Claude 版を開く'),
        h('p', { class: 'set-desc' }, 'プロジェクトは「ファイル → ⋯ → プロジェクトを ZIP で保存」で保存し、Claude 版の「ZIP を読み込む」で移せます。')),
      h('div', { class: 'ai-way' },
        h('div', { class: 'ai-way-title' }, icon('lock', 15), 'API キーを使う'),
        h('p', { class: 'set-desc' }, 'Anthropic の API キーがあれば、この画面のままでも使えます (従量課金)。'),
        h('button', { class: 'btn', onclick: () => app.wb.showView('settings', 'Claude API') }, icon('gear', 16), 'API キーを設定')))
    return box
  }

  welcome() {
    const box = h('div', { class: 'ai-welcome' },
      h('div', { class: 'ai-empty-icon' }, icon('sparkle', 32)),
      h('div', { class: 'ai-welcome-title' }, '何を作りますか?'),
      h('p', { class: 'set-desc' }, 'Claude がプロジェクトのファイルを読み、編集・作成し、実行して確かめます。変更はあとから「元に戻す」で取り消せます。'))
    const grid = h('div', { class: 'ai-starters' })
    for (const s of STARTERS) grid.append(h('button', { class: 'ai-starter', onclick: () => this.send(s.prompt) }, icon(s.icon, 18), h('span', null, s.title)))
    box.append(grid)
    return box
  }

  userBubble(m) {
    const el = h('div', { class: 'ai-msg user' }, h('div', { class: 'ai-text' }, m.content))
    if (m.images && m.images.length) el.prepend(h('div', { class: 'ai-msg-imgs' }, m.images.map(u => h('img', { src: u, alt: '' }))))
    return el
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
    if (m.truncated) el.append(h('div', { class: 'ai-note' }, '途中で終わりました。「続ける」で続きを頼めます'))
    if (!m.pending && this.messages[this.messages.length - 1] === m) {
      const acts = h('div', { class: 'ai-actions' })
      if ((m.steps && m.steps.length) || m.truncated || m.stopped || m.error) acts.append(h('button', { class: 'btn small', onclick: () => this.send('続けてください。') }, icon('play', 14), '続ける'))
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
      if (m.pending) body.append(h('div', { class: 'ai-thinking' }, h('span', { class: 'spinner' }), m.steps && m.steps.length ? '作業中…' : '考えています…'))
      return
    }
    body.innerHTML = renderMarkdown(text, { images: false, codeBlock: (code, lang) => `<div class="ai-code"><div class="ai-code-bar"><span>${lang || 'code'}</span><span class="ai-code-actions"><button data-act="copy">コピー</button><button data-act="insert">挿入</button><button data-act="replace">選択範囲と置換</button></span></div><pre><code></code></pre></div>` })
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
        if (!(await confirmDialog('変更を元に戻す', `Claude が変更した ${m.changes.length} 個のファイルを、頼む前の状態に戻しますか?${m.changes.some(c => c.before === null) ? ' (新しく作ったファイルは削除されます)' : ''}`, { okLabel: '元に戻す', danger: true }))) return
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

  // ---- 画像 ----
  async addImages(files) {
    for (const f of files.slice(0, 4 - this.attachments.length)) {
      try {
        const blob = await shrinkImage(f)
        this.attachments.push({ blob, url: URL.createObjectURL(blob) })
      } catch { toast('画像を読み込めませんでした', { kind: 'error' }) }
    }
    this.paintThumbs()
  }
  paintThumbs() {
    this.thumbs.replaceChildren(...this.attachments.map((a, i) => h('div', { class: 'ai-thumb' }, h('img', { src: a.url, alt: '' }),
      h('button', { class: 'ai-thumb-x', 'aria-label': '外す', onclick: () => { URL.revokeObjectURL(a.url); this.attachments.splice(i, 1); this.paintThumbs() } }, icon('close', 12)))))
    this.thumbs.classList.toggle('hidden', !this.attachments.length)
  }

  // ---- 送信 ----
  stop() { if (this.ctrl) { this.ctrl.abort(); this.ctrl = null } }

  history() {
    const out = []
    for (const m of this.messages) {
      if (m.pending) continue
      if (m.role === 'user') out.push({ role: 'user', content: m.content })
      else {
        let c = m.content || ''
        const acts = []
        if (m.changes && m.changes.length) acts.push((m.reverted ? '(reverted by the user) ' : '') + 'changed: ' + m.changes.map(x => x.path).join(', '))
        if (m.error) acts.push('error: ' + m.error)
        if (m.stopped) acts.push('stopped by the user')
        if (acts.length) c += `\n\n[${acts.join('; ')}]`
        out.push({ role: 'assistant', content: c || '(no reply)' })
      }
    }
    return out
  }

  async send(textArg) {
    if (this.busy) return
    const text = String(textArg == null ? this.input.value : textArg).trim()
    if (!text) return
    if (!aiReady()) { this.render(); return }
    if (!app.project) { toast('先にプロジェクトを開いてください'); return }
    const history = this.history()
    const atts = this.attachments.splice(0)
    this.paintThumbs()
    if (textArg === undefined) { this.input.value = ''; this.autosize() }
    const user = { role: 'user', content: text, images: atts.map(a => a.url) }
    const reply = { role: 'assistant', content: '', steps: [], pending: true, changes: [] }
    this.messages.push(user, reply)
    this.render()
    this.ctrl = new AbortController()
    const signal = this.ctrl.signal
    this.setBusy(true)
    let raf = 0
    const repaint = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (reply.el) { this.paintBody(reply); this.scrollEnd() } }) }
    try {
      const r = await runAgent({
        history, text, images: atts.map(a => a.blob), tier: getSettings().aiTier || 'default', signal,
        focusEdits: app.wb.layout === 'desktop',
        onText: t => { reply.content = t; repaint() },
        onStep: s => { reply.steps.push(s); if (reply.stepsEl) { this.paintSteps(reply); if (!reply.content) this.paintBody(reply); this.scrollEnd() } },
      })
      reply.content = r.text
      reply.changes = r.changes
      reply.truncated = r.truncated
    } catch (e) {
      if (e && e.text) reply.content = e.text
      if (e && e.code === 'cancelled') reply.stopped = true
      else reply.error = errorMessage(e) || 'エラーが発生しました'
      if (e && e.changes) reply.changes = e.changes
    } finally {
      cancelAnimationFrame(raf)
      reply.pending = false
      this.ctrl = null
      this.setBusy(false)
      this.saveChat()
      this.render()
      for (const a of atts) setTimeout(() => URL.revokeObjectURL(a.url), 60000)
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

// 大きな画像は送る前に縮める (長辺 1568px)
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const k = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight))
      if (k === 1 && file.size < 3e6) { resolve(file); return }
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      c.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.88)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')) }
    img.src = url
  })
}

const view = () => { app.wb.showView('ai'); return app.wb.views.ai }
command('aiChat', 'Claude を開く', () => app.wb.showView('ai'), { icon: 'sparkle' })
// 質問や依頼を入力済みの状態で開いて送る (実行エラーの「Claude で直す」など)
command('aiAsk', 'Claude に頼む', text => { const v = view(); if (typeof text === 'string') v.send(text) }, { icon: 'sparkle' })
command('aiExplain', 'Claude: このコードを説明', () => view().send(QUICK[0].prompt), { icon: 'sparkle' })
command('aiFix', 'Claude: バグを探して直す', () => view().send(QUICK[1].prompt), { icon: 'sparkle' })
command('aiComment', 'Claude: コメントを追加', () => view().send(QUICK[3].prompt), { icon: 'sparkle' })
command('aiTidy', 'Claude: コードを整理', () => view().send(QUICK[4].prompt), { icon: 'sparkle' })
command('aiOpenClaude', 'Claude 版 (API キー不要) を開く', () => { if (IN_CLAUDE) { toast('いま Claude 版で開いています'); return } window.open(CLAUDE_APP_URL, '_blank', 'noopener') }, { icon: 'link' })

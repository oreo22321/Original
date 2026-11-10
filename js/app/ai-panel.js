// AI チャット (Claude)
import { app, command } from './app.js'
import { getSettings } from './store.js'
import { h, icon, toast, copyText } from './ui.js'
import { renderMarkdown } from './markdown.js'
import { aiChat } from '../editor/ai.js'
import { EditorSelection } from '../../vendor/codemirror.js'

const QUICK = [
  { label: '説明して', prompt: 'このコードが何をしているか、初心者にもわかるように説明してください。' },
  { label: 'バグを探す', prompt: 'このコードのバグや問題点を探して、修正したコードを示してください。' },
  { label: 'コメントを追加', prompt: 'このコードに日本語で分かりやすいコメントを追加したコードを示してください。' },
  { label: '改善する', prompt: 'このコードをより読みやすく、効率的に書き直してください。' },
  { label: 'エラーを直す', prompt: '実行したら次のエラーが出ました。原因と直し方を教えてください:\n' },
]

export class AiView {
  constructor(root) {
    this.root = root
    this.messages = []
    this.ctrl = null
    this.build()
  }

  build() {
    this.log = h('div', { class: 'ai-log' })
    this.input = h('textarea', { class: 'input ai-input', rows: '2', placeholder: 'AI に質問 (例: プレイヤーが触れたら消えるパーツを作って)', autocapitalize: 'off' })
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.send() } })
    this.sendBtn = h('button', { class: 'btn primary icon-only', 'aria-label': '送信', onclick: () => this.send() }, icon('send', 18))
    const quick = h('div', { class: 'chips ai-quick' })
    for (const q of QUICK) {
      quick.append(h('button', { class: 'chip', onclick: () => {
        let p = q.prompt
        if (q.label === 'エラーを直す') {
          const errs = [...document.querySelectorAll('.out-line.error')].map(e => e.textContent).slice(-3).join('\n')
          p += errs || '(エラーの内容を貼り付けてください)'
        }
        this.input.value = p
        this.input.focus()
      } }, q.label))
    }
    this.root.append(
      h('div', { class: 'side-head' }, h('div', { class: 'side-title' }, 'AI アシスタント'),
        h('div', { class: 'side-actions' }, h('button', { class: 'icon-btn', title: '会話をリセット', 'aria-label': '会話をリセット', onclick: () => { this.stop(); this.messages = []; this.render() } }, icon('trash', 18)))),
      this.log,
      h('div', { class: 'ai-compose' }, quick, h('div', { class: 'input-row' }, this.input, this.sendBtn)))
    this.render()
  }

  render() {
    this.log.innerHTML = ''
    if (!getSettings().aiKey) {
      this.log.append(h('div', { class: 'ai-empty' },
        h('div', { class: 'ai-empty-icon' }, '✨'),
        h('p', null, 'Claude にコードの説明・修正・作成を頼めます。'),
        h('p', { class: 'set-desc' }, '使うには Anthropic の API キーが必要です (利用料金はキーの持ち主に請求されます)。キーはこの端末にのみ保存されます。'),
        h('button', { class: 'btn primary', onclick: () => app.wb.showView('settings', 'Claude API') }, icon('gear', 16), 'API キーを設定')))
      return
    }
    if (!this.messages.length) {
      this.log.append(h('div', { class: 'ai-empty' }, h('div', { class: 'ai-empty-icon' }, '✨'), h('p', null, '何でも聞いてください。開いているファイルの内容も参考にします。')))
    }
    for (const m of this.messages) this.log.append(this.bubble(m))
    this.log.scrollTop = this.log.scrollHeight
  }

  bubble(m) {
    const el = h('div', { class: 'ai-msg ' + m.role })
    if (m.role === 'user') el.append(h('div', { class: 'ai-text' }, m.content))
    else {
      const body = h('div', { class: 'ai-text md-body' })
      body.innerHTML = renderMarkdown(m.content || (m.pending ? '考え中…' : ''), { codeBlock: (code, lang) => `<div class="ai-code"><div class="ai-code-bar"><span>${lang || 'code'}</span><span class="ai-code-actions"><button data-act="copy">コピー</button><button data-act="insert">挿入</button><button data-act="replace">選択範囲と置換</button></span></div><pre><code></code></pre></div>` })
      // コードはテキストとして入れる (HTML エスケープ不要)
      const codes = []
      const re = /```[\w+-]*\n([\s\S]*?)(?:```|$)/g
      let mm
      while ((mm = re.exec(m.content || ''))) codes.push(mm[1].replace(/\n$/, ''))
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
      el.append(body)
      if (m.error) el.append(h('div', { class: 'ai-error' }, m.error))
    }
    return el
  }

  insertCode(code, replace) {
    const v = app.editors.activeView()
    if (!v) { toast('先にファイルを開いてください'); return }
    const sel = v.state.selection.main
    const from = replace ? sel.from : sel.head, to = replace ? sel.to : sel.head
    v.dispatch({ changes: { from, to, insert: code }, selection: EditorSelection.cursor(from + code.length), scrollIntoView: true, userEvent: 'input.paste' })
    toast(replace ? '置き換えました' : '挿入しました')
  }

  stop() { if (this.ctrl) { this.ctrl.abort(); this.ctrl = null } }

  async send() {
    const text = this.input.value.trim()
    const s = getSettings()
    if (!text) return
    if (!s.aiKey) { this.render(); return }
    this.input.value = ''
    this.messages.push({ role: 'user', content: text })
    const reply = { role: 'assistant', content: '', pending: true }
    this.messages.push(reply)
    this.render()
    let context = null
    const doc = app.editors.activeDoc()
    if (s.aiIncludeFile && doc) {
      const v = app.editors.activeView()
      const sel = v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : ''
      context = `path: ${doc.path}\n${doc.state.doc.toString().slice(0, 60000)}${sel ? `\n</current_file>\n<selected_text>\n${sel}` : ''}`
    }
    this.stop()
    this.ctrl = new AbortController()
    this.sendBtn.disabled = true
    const lastEl = () => this.log.lastElementChild
    let raf = null
    try {
      await aiChat({
        apiKey: s.aiKey, model: s.aiModel, context, signal: this.ctrl.signal,
        messages: this.messages.filter(m => !m.pending || m.content).filter(m => m !== reply).map(m => ({ role: m.role, content: m.content })),
        onText: t => {
          reply.content += t
          reply.pending = false
          if (!raf) raf = requestAnimationFrame(() => { raf = null; const old = lastEl(); if (old) old.replaceWith(this.bubble(reply)); this.log.scrollTop = this.log.scrollHeight })
        },
      })
    } catch (e) {
      reply.error = e.message
    } finally {
      reply.pending = false
      this.sendBtn.disabled = false
      this.ctrl = null
      this.render()
    }
  }
}

command('aiChat', 'AI アシスタントを開く', () => app.wb.showView('ai'), { icon: 'sparkle' })
command('aiExplain', 'AI: 選択したコードを説明', () => { app.wb.showView('ai'); const v = app.wb.views.ai; v.input.value = QUICK[0].prompt; v.send() }, { icon: 'sparkle' })
command('aiFix', 'AI: バグを探して修正', () => { app.wb.showView('ai'); const v = app.wb.views.ai; v.input.value = QUICK[1].prompt; v.send() }, { icon: 'sparkle' })

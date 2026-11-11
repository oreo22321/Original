// スマホ用キーボードバー (記号・矢印・Tab・候補の確定など)
import {
  EditorView, EditorSelection, cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown, selectCharLeft, selectCharRight, selectLineUp, selectLineDown,
  undo, redo, toggleComment, indentMore, indentLess, startCompletion, selectNextOccurrence, cursorLineBoundaryLeft, cursorLineBoundaryRight, insertTab,
} from '../../vendor/codemirror.js'
import { app, runCommand } from './app.js'
import { getSettings, on } from './store.js'
import { h, icon, haptic } from './ui.js'
import { acceptGhost, hasGhost } from '../editor/inline.js'

export function typeText(view, text) {
  const { state } = view
  const r = state.selection.main
  // closeBrackets などの入力ハンドラを通す
  for (const handler of state.facet(EditorView.inputHandler)) {
    if (handler(view, r.from, r.to, text, () => state.update(state.replaceSelection(text), { userEvent: 'input.type' }))) return
  }
  view.dispatch(state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true })
}

export class KeyBar {
  constructor(root) {
    this.root = root
    this.selectMode = false
    this.render()
    on('settings', () => this.render())
    on('editorupdate', () => this.scheduleUpdate())
    on('active', () => this.scheduleUpdate())
    on('problems', () => this.scheduleUpdate())
  }

  view() { return app.editors && app.editors.activeView() }

  key(label, action, opts = {}) {
    const btn = h('button', { class: 'kb-key' + (opts.cls ? ' ' + opts.cls : ''), 'aria-label': opts.title || label, title: opts.title || '' }, opts.icon ? icon(opts.icon, 18) : label)
    let timer = null, rep = null, sx = 0, sy = 0, cancelled = false, repeated = false
    const fire = () => {
      const v = this.view()
      if (!v) return
      if (getSettings().haptics) haptic(5)
      action(v)
    }
    const stopRep = () => { clearTimeout(timer); clearInterval(rep); timer = rep = null; btn.classList.remove('down') }
    btn.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') e.preventDefault()
      sx = e.clientX; sy = e.clientY; cancelled = false; repeated = false
      btn.classList.add('down')
      if (opts.repeat) timer = setTimeout(() => { repeated = true; fire(); rep = setInterval(fire, 55) }, 350)
    })
    btn.addEventListener('pointermove', e => {
      if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) { cancelled = true; stopRep() }
    })
    btn.addEventListener('pointerup', () => {
      const wasRepeating = repeated
      stopRep()
      if (!cancelled && !wasRepeating) fire()
    })
    btn.addEventListener('pointercancel', () => { cancelled = true; stopRep() })
    btn.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') stopRep() })
    // フォーカスをエディタに残す (キーボードが閉じないように)
    btn.addEventListener('mousedown', e => e.preventDefault())
    btn.addEventListener('touchend', e => { if (e.cancelable) e.preventDefault() })
    btn.addEventListener('click', e => e.preventDefault())
    return btn
  }

  render() {
    const s = getSettings()
    this.root.innerHTML = ''
    this.root.classList.toggle('hidden', !s.keybar)
    if (!s.keybar) return
    const row = h('div', { class: 'kb-row' })
    const mv = (plain, sel) => v => (this.selectMode ? sel : plain)(v)
    this.acceptBtn = this.key('✓', v => { if (!acceptGhost(v)) insertTab(v) }, { cls: 'accept hidden', title: '候補を確定 (Tab)' })
    // その行にエラーがあるときだけ出る「修正」キー
    this.fixBtn = this.key('', () => runCommand('quickFix'), { icon: 'bulb', cls: 'fix hidden', title: 'この行のエラーを修正' })
    row.append(
      this.key('Tab', v => { if (!acceptGhost(v)) { if (!v.state.selection.main.empty) indentMore(v); else insertTab(v) } }, { cls: 'wide', title: 'Tab (候補があれば確定)' }),
      this.acceptBtn,
      this.fixBtn,
      this.key('←', mv(cursorCharLeft, selectCharLeft), { repeat: true, cls: 'arrow', title: '左' }),
      this.key('→', mv(cursorCharRight, selectCharRight), { repeat: true, cls: 'arrow', title: '右' }),
      this.key('↑', mv(cursorLineUp, selectLineUp), { repeat: true, cls: 'arrow', title: '上' }),
      this.key('↓', mv(cursorLineDown, selectLineDown), { repeat: true, cls: 'arrow', title: '下' }),
    )
    this.selBtn = this.key('選択', () => { this.selectMode = !this.selectMode; this.selBtn.classList.toggle('on', this.selectMode) }, { cls: 'mode', title: '選択モード (矢印で範囲選択)' })
    row.append(this.selBtn)
    for (const k of (s.keybarKeys || '').split(/\s+/).filter(Boolean)) {
      const text = k === '\\\\' ? '\\' : k
      row.append(this.key(text, v => typeText(v, text)))
    }
    row.append(
      this.key('⇤', cursorLineBoundaryLeft, { title: '行頭へ' }),
      this.key('⇥', cursorLineBoundaryRight, { title: '行末へ' }),
      this.key('補完', v => startCompletion(v), { cls: 'wide', title: '補完候補を表示' }),
      this.key('--', v => toggleComment(v), { title: 'コメント切り替え' }),
      this.key('⇠', v => indentLess(v), { title: 'インデントを減らす' }),
      this.key('⇢', v => indentMore(v), { title: 'インデントを増やす' }),
      this.key('', v => selectNextOccurrence(v), { icon: 'search', title: '同じ単語を選択' }),
      this.key('', v => undo(v), { icon: 'undo', repeat: true, title: '元に戻す' }),
      this.key('', v => redo(v), { icon: 'redo', repeat: true, title: 'やり直し' }),
      this.key('', v => { v.contentDOM.blur() }, { icon: 'keyboardDown', title: 'キーボードを閉じる' }),
    )
    this.root.append(row)
    this.updateGhost()
  }

  // 入力のたびに呼ばれるので、1 フレームに 1 回だけ更新する
  scheduleUpdate() {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.updateGhost() })
  }

  updateGhost() {
    const v = this.view()
    if (!this.acceptBtn) return
    this.acceptBtn.classList.toggle('hidden', !(v && hasGhost(v.state)))
    if (this.fixBtn) this.fixBtn.classList.toggle('hidden', !(v && app.editors.lineDiagnostics(v).length))
  }
}

export { EditorSelection, runCommand }

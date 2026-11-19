// tkinter の画面: python-worker から届く命令で、ウィンドウ・ボタン・入力欄・キャンバスを作り、並べ、操作を Python に返す
// ・pack はTk と同じ「空き場所 (cavity) を順に分ける」並べ方を、入れ子の flex で再現します。grid は CSS grid、place は絶対位置
// ・キャンバスは描く物の一覧を持ち、画面の更新に合わせて描き直す
import { h, icon, menu } from './ui.js'
import { tkImages } from './surface.js'

const KEYSYM = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'space', Enter: 'Return', Escape: 'Escape', Backspace: 'BackSpace', Tab: 'Tab', Delete: 'Delete', Shift: 'Shift_L', Control: 'Control_L', Alt: 'Alt_L', Meta: 'Meta_L', Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next', Insert: 'Insert', CapsLock: 'Caps_Lock' }
const PUNCT = { '!': 'exclam', '@': 'at', '#': 'numbersign', '$': 'dollar', '%': 'percent', '^': 'asciicircum', '&': 'ampersand', '*': 'asterisk', '(': 'parenleft', ')': 'parenright', '-': 'minus', _: 'underscore', '=': 'equal', '+': 'plus', '[': 'bracketleft', ']': 'bracketright', '{': 'braceleft', '}': 'braceright', ';': 'semicolon', ':': 'colon', "'": 'apostrophe', '"': 'quotedbl', ',': 'comma', '.': 'period', '<': 'less', '>': 'greater', '/': 'slash', '?': 'question', '\\': 'backslash', '|': 'bar', '`': 'grave', '~': 'asciitilde' }
export function keysym(e) {
  if (KEYSYM[e.key]) return KEYSYM[e.key]
  if (/^F\d+$/.test(e.key)) return e.key
  if (e.key && e.key.length === 1) return PUNCT[e.key] || e.key
  return e.key || ''
}
const mods = e => (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0)
const RELIEF = { raised: 'outset', sunken: 'inset', groove: 'groove', ridge: 'ridge', solid: 'solid', flat: 'none' }
const isVert = side => side !== 'left' && side !== 'right'

export class TkView {
  constructor(sendEvent) {
    this.send = ev => sendEvent({ s: 'tk', ...ev })
    this.el = h('div', { class: 'out-tk' })
    this.w = new Map()        // id → ウィジェット / ウィンドウ
    this.cats = new Map()     // id → Set (bind されている出来事の種類)
    this.menus = new Map()    // menu id → 項目
    this.dirty = new Set()
    this.live = true
    this.packSeq = 0
    this.bindRoot()
  }

  // ============================================================
  // 命令
  // ============================================================
  push(json) {
    let ops
    try { ops = JSON.parse(json) } catch { return }
    for (const op of ops) { try { this.apply(op) } catch (e) { if (typeof console !== 'undefined') console.warn('tk', op[0], e) } }
    this.layoutDirty()
  }

  apply(op) {
    const [k, id] = op
    const w = this.w.get(id)
    switch (k) {
      case 'win': this.makeWin(id, op[2], op[3] || {}); break
      case 'title': if (w && w.titleEl) w.titleEl.textContent = op[2]; break
      case 'geom': if (w && w.win) { w.body.style.width = `min(100%, ${op[2]}px)`; w.body.style.height = op[3] + 'px'; w.sized = true } break
      case 'minsize': if (w && w.win) { w.body.style.minWidth = `min(100%, ${op[2]}px)`; w.body.style.minHeight = op[3] + 'px' } break
      case 'show': if (w && w.win) w.el.classList.toggle('hidden', !op[2]); break
      case 'full': break
      case 'new': this.make(id, op[2], op[3], op[4] || {}); break
      case 'cfg': if (w) this.configure(w, op[2] || {}); break
      case 'geo': if (w) { if (op[2] === 'pack' && !(w.geo && w.geo.mgr === 'pack')) w.seq = ++this.packSeq; w.geo = { mgr: op[2], o: op[3] || {} }; this.markParent(w) } break
      case 'forget': if (w) { w.geo = null; w.el.remove(); this.markParent(w) } break
      case 'del': this.destroy(id); break
      case 'val': if (w) this.setValue(w, op[2]); break
      case 'sel': if (w && w.kind === 'listbox') this.listSel(w, op[2]); break
      case 'items': if (w && w.kind === 'listbox') { w.items = op[2]; this.renderList(w); this.listSel(w, op[3] || []) } break
      case 'tags': if (w && w.kind === 'text') { w.tags = op[2]; this.renderTextTags(w) } break
      case 'see': if (w && w.input) w.input.scrollTop = w.input.scrollHeight; break
      case 'focus': if (w) { const f = w.input || w.el; try { f.focus({ preventScroll: true }) } catch {} } break
      case 'select': if (w && w.input && w.input.select) w.input.select(); break
      case 'bind': this.cats.set(id, new Set(op[2] || [])); break
      case 'menuitems': this.menus.set(id, op[2] || []); this.refreshMenubars(); break
      case 'popup': this.openMenu(id, this.el); break
      case 'cv': if (w && w.kind === 'canvas') this.canvasOp(w, op); break
      case 'gridcfg': if (w) { w.gridcfg = op[2]; this.dirty.add(w) } break
      case 'tabs': if (w && w.kind === 'notebook') { w.tabs = op[2]; w.cur = op[3] || 0; this.renderTabs(w) } break
      case 'tree': if (w && w.kind === 'treeview') { w.tree = op[2]; this.renderTree(w) } break
      case 'img': this.imageOp(op); break
      case 'raise': if (w) { if (w.win) this.el.append(w.el); else w.el.style.zIndex = String(++this.packSeq) } break
      case 'lower': if (w && !w.win) w.el.style.zIndex = '0'; break
    }
  }

  // ============================================================
  // ウィンドウ
  // ============================================================
  makeWin(id, parent, o) {
    const titleEl = h('span', { class: 'tk-title' }, o.title || 'tk')
    const menubar = h('div', { class: 'tk-menubar hidden' })
    const body = h('div', { class: 'tk-body tk-cav-root', 'data-tkid': String(id) })
    const el = h('div', { class: 'tk-win', 'data-tkwin': String(id) },
      h('div', { class: 'tk-titlebar' }, h('span', { class: 'tk-dots' }, h('i'), h('i'), h('i')), titleEl, h('span', { class: 'tk-spacer' }),
        h('button', { class: 'tk-close', title: '閉じる', 'aria-label': 'ウィンドウを閉じる', onclick: () => this.live && this.send({ t: 'close', id }) }, icon('close', 14))),
      menubar, body)
    if (o.bg) body.style.backgroundColor = o.bg
    const w = { id, kind: 'win', win: true, el, body, titleEl, menubar, inner: body, children: [], parent: null }
    this.w.set(id, w)
    this.el.append(el)
  }

  // ============================================================
  // ウィジェット
  // ============================================================
  make(id, parentId, kind, o) {
    const parent = this.w.get(parentId)
    const w = { id, kind, parent, children: [], o: {}, geo: null }
    let el
    const input = (tag, props) => { const x = h(tag, props); w.input = x; return x }
    switch (kind) {
      case 'frame': el = h('div', { class: 'tk-frame' }); w.inner = el; break
      case 'labelframe': {
        w.legend = h('legend', { class: 'tk-legend' })
        el = h('fieldset', { class: 'tk-labelframe' }, w.legend)
        w.inner = h('div', { class: 'tk-lf-inner' })
        el.append(w.inner)
        break
      }
      case 'label': case 'message': el = h('div', { class: 'tk-label' + (kind === 'message' ? ' tk-message' : '') }); break
      case 'button': case 'menubutton':
        el = h('button', { class: 'tk-button', type: 'button', onclick: () => { if (this.live && !w.disabled) { if (kind === 'menubutton' && w.o.menu) this.openMenu(w.o.menu, el); else this.send({ t: 'cmd', id }) } } })
        break
      case 'entry': case 'spinbox': case 'combobox': {
        const field = input('input', { class: 'tk-entry', type: kind === 'spinbox' && !o.values ? 'number' : 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
        field.addEventListener('input', () => { if (this.live) this.send({ t: 'var', id, v: field.value, sel: kind === 'combobox' && (w.values || []).includes(field.value) ? 1 : 0 }) })
        if (kind === 'spinbox') field.addEventListener('change', () => { if (this.live) this.send({ t: 'cmd', id }) })
        el = field
        if (kind === 'combobox') {
          const listId = 'tkdl' + id + '-' + Math.random().toString(36).slice(2, 7)
          w.datalist = h('datalist', { id: listId })
          field.setAttribute('list', listId)
          el = h('span', { class: 'tk-combo' }, field, w.datalist)
        }
        break
      }
      case 'text': el = input('textarea', { class: 'tk-text', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }); el.addEventListener('input', () => { if (this.live) this.send({ t: 'var', id, v: el.value, c: el.selectionStart }) }); break
      case 'checkbutton': case 'radiobutton': {
        const box = input('input', { type: kind === 'checkbutton' ? 'checkbox' : 'radio' })
        box.addEventListener('change', () => { if (!this.live) return; this.send({ t: 'var', id, v: box.checked ? 1 : 0 }); this.send({ t: 'cmd', id }) })
        w.textEl = h('span', { class: 'tk-cb-text' })
        el = h('label', { class: 'tk-check' }, box, w.textEl)
        break
      }
      case 'scale': {
        const r = input('input', { type: 'range', class: 'tk-range' })
        w.valEl = h('span', { class: 'tk-scale-val' })
        w.labelEl = h('span', { class: 'tk-scale-label' })
        let last = 0
        r.addEventListener('input', () => { w.valEl.textContent = this.fmtScale(w, r.value); const now = performance.now(); if (this.live && now - last > 30) { last = now; this.send({ t: 'var', id, v: Number(r.value) }) } })
        r.addEventListener('change', () => { if (this.live) this.send({ t: 'var', id, v: Number(r.value) }) })
        el = h('div', { class: 'tk-scale' }, w.labelEl, h('div', { class: 'tk-scale-row' }, r, w.valEl))
        break
      }
      case 'listbox': {
        const s = input('select', { class: 'tk-listbox', size: '6' })
        s.addEventListener('change', () => { if (this.live) this.send({ t: 'var', id, v: [...s.selectedOptions].map(o2 => Number(o2.value)) }) })
        el = s
        break
      }
      case 'optionmenu': {
        const s = input('select', { class: 'tk-option' })
        s.addEventListener('change', () => { if (this.live) this.send({ t: 'var', id, v: s.value }) })
        el = s
        break
      }
      case 'canvas': {
        w.cv = h('canvas', { class: 'tk-canvas' })
        w.overlay = h('div', { class: 'tk-cv-overlay' })
        el = h('div', { class: 'tk-canvas-wrap', tabindex: '0' }, w.cv, w.overlay)
        w.items = new Map(); w.order = []
        w.W = 378; w.H = 265
        break
      }
      case 'progressbar': w.bar = h('div', { class: 'tk-pbar' }); el = h('div', { class: 'tk-progress' }, w.bar); break
      case 'separator': el = h('div', { class: 'tk-sep' }); break
      case 'scrollbar': el = h('div', { class: 'tk-scrollbar hidden' }); break
      case 'notebook': w.tabbar = h('div', { class: 'tk-tabs' }); w.inner = h('div', { class: 'tk-nb-body' }); el = h('div', { class: 'tk-notebook' }, w.tabbar, w.inner); w.tabs = []; w.cur = 0; break
      case 'treeview': w.table = h('table', { class: 'tk-tree' }); el = h('div', { class: 'tk-tree-wrap' }, w.table); break
      case 'menu': el = h('div', { class: 'hidden' }); break
      case 'toplevel': this.makeWin(id, parentId, o); return
      default: el = h('div', { class: 'tk-frame' }); w.inner = el
    }
    w.el = el
    el.dataset.tkid = String(id)
    this.w.set(id, w)
    if (parent) parent.children.push(w)
    this.configure(w, o)
  }

  fmtScale(w, v) {
    const r = Number(w.o.resolution) || 1
    const n = Number(v)
    return r >= 1 && Number.isInteger(r) ? String(Math.round(n)) : String(Math.round(n / r) * r).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  }

  configure(w, o) {
    Object.assign(w.o, o)
    const el = w.el
    const st = el.style
    if ('bg' in o && o.bg) { if (w.kind === 'canvas') { w.bg = o.bg; this.drawCanvas(w) } else if (w.inner && w.inner !== el && w.kind !== 'notebook') { st.backgroundColor = o.bg; w.inner.style.backgroundColor = o.bg } else (w.input && w.kind !== 'scale' ? w.input.style : st).backgroundColor = o.bg }
    if ('fg' in o && o.fg) (w.input && w.kind !== 'scale' ? w.input.style : st).color = o.fg
    if ('font' in o && o.font) (w.input || el).style.font = o.font
    if ('relief' in o || 'bd' in o) {
      const rel = RELIEF[String(w.o.relief || 'flat')] || 'none'
      const bd = Number(w.o.bd !== undefined ? w.o.bd : (rel !== 'none' ? 2 : 0))
      if (w.kind !== 'button') { st.borderStyle = rel; st.borderWidth = (rel === 'none' ? 0 : bd) + 'px'; st.borderColor = '#a0a0a0' }
    }
    if (('padx' in o || 'pady' in o) && !['frame', 'canvas', 'labelframe'].includes(w.kind)) st.padding = `${Number(w.o.pady) || 0}px ${Number(w.o.padx) || 0}px`
    if ('state' in o) {
      w.disabled = o.state === 'disabled'
      const target = w.input || (w.kind === 'button' || w.kind === 'menubutton' ? el : null)
      if (target) { target.disabled = w.disabled; if (o.state === 'readonly' && w.input) { w.input.readOnly = true; w.input.disabled = false } else if (w.input) w.input.readOnly = false }
      el.classList.toggle('tk-disabled', w.disabled)
      if (w.kind === 'text') this.renderTextTags(w)
    }
    if ('padding' in o && o.padding !== null && o.padding !== undefined) {
      const pd = (Array.isArray(o.padding) ? o.padding : String(o.padding).split(/\s+/)).map(v => (Number(v) || 0) + 'px')
      const box = w.inner || el
      box.style.padding = pd.length === 1 ? pd[0] : pd.length === 2 ? `${pd[1]} ${pd[0]}` : pd.length === 4 ? `${pd[1]} ${pd[2]} ${pd[3]} ${pd[0]}` : pd.join(' ')
    }
    if ('cursor' in o) st.cursor = /hand/.test(o.cursor || '') ? 'pointer' : ''
    switch (w.kind) {
      case 'label': case 'message': case 'button': case 'menubutton': {
        if ('text' in o || 'image' in o || 'compound' in o) this.setContent(w)
        if ('width' in o && w.o.width) st.width = w.o.image && !w.o.text ? w.o.width + 'px' : `${Number(w.o.width) + (w.kind === 'button' ? 2 : 0)}ch`
        if ('height' in o && w.o.height) st.minHeight = w.o.image && !w.o.text ? w.o.height + 'px' : `${Number(w.o.height) * 1.35}em`
        if ('wraplength' in o && Number(o.wraplength) > 0) { st.maxWidth = o.wraplength + 'px'; st.whiteSpace = 'pre-wrap' }
        if ('justify' in o) st.textAlign = o.justify
        if ('anchor' in o) st.justifyContent = /w/.test(o.anchor) ? 'flex-start' : /e/.test(o.anchor) ? 'flex-end' : 'center'
        if ('activebackground' in o && o.activebackground) st.setProperty('--tk-active', o.activebackground)
        break
      }
      case 'entry': case 'spinbox': case 'combobox': {
        const f = w.input
        if ('width' in o && w.o.width) f.style.width = `${Number(w.o.width) + 1}ch`
        if ('show' in o) f.type = o.show ? 'password' : (w.kind === 'spinbox' && !w.o.values ? 'number' : 'text')
        if ('value' in o && o.value !== null && o.value !== undefined) f.value = String(o.value)
        if ('justify' in o) f.style.textAlign = o.justify
        if (w.kind === 'spinbox') {
          if ('from' in o) f.min = o.from
          if ('to' in o) f.max = o.to
          if ('increment' in o) f.step = o.increment
          if (!f.value && w.o.from !== undefined && !w.o.values) f.value = w.o.from
        }
        if ('values' in o && (w.kind === 'combobox' || w.kind === 'spinbox')) {
          w.values = (o.values || []).map(String)
          if (w.datalist) { w.datalist.textContent = ''; for (const v of w.values) w.datalist.append(h('option', { value: v })) }
          if (w.kind === 'spinbox' && w.values.length && !f.value) f.value = w.values[0]
        }
        if (w.kind === 'combobox' && w.o.state === 'readonly' && !w.select) this.comboAsSelect(w)
        if (w.select && 'values' in o) this.fillSelect(w.select, w.values, f.value)
        break
      }
      case 'text': {
        const t = w.input
        if ('width' in o && w.o.width) t.style.width = `min(100%, ${Number(w.o.width) + 1}ch)`
        if ('height' in o && w.o.height) t.style.height = `${Number(w.o.height) * 1.45}em`
        if ('wrap' in o) t.style.whiteSpace = o.wrap === 'none' ? 'pre' : 'pre-wrap'
        break
      }
      case 'checkbutton': case 'radiobutton': {
        if ('text' in o || 'image' in o) w.textEl.textContent = w.o.text || ''
        if ('checked' in o) w.input.checked = !!o.checked
        if ('group' in o) w.input.name = 'tkrg-' + o.group
        if ('indicatoron' in o && !o.indicatoron) el.classList.add('tk-toggle')
        if ('selectcolor' in o && o.selectcolor) w.input.style.accentColor = o.selectcolor
        break
      }
      case 'scale': {
        const r = w.input
        if ('from' in o) r.min = Math.min(Number(o.from), Number(w.o.to !== undefined ? w.o.to : 100))
        if ('to' in o) { r.max = Math.max(Number(o.to), Number(w.o.from || 0)); r.min = Math.min(Number(w.o.from || 0), Number(o.to)) }
        if ('resolution' in o) r.step = Number(o.resolution) > 0 ? o.resolution : 'any'
        if ('value' in o && o.value !== null && o.value !== undefined) { r.value = o.value; w.valEl.textContent = this.fmtScale(w, r.value) }
        if ('label' in o) w.labelEl.textContent = o.label || ''
        if ('orient' in o) el.classList.toggle('tk-vertical', !String(o.orient).startsWith('h'))
        if ('length' in o && o.length) r.style.width = o.length + 'px'
        if ('showvalue' in o) w.valEl.classList.toggle('hidden', !o.showvalue)
        if ('troughcolor' in o && o.troughcolor) r.style.accentColor = o.troughcolor
        break
      }
      case 'listbox': {
        if ('height' in o) w.input.size = Math.max(2, Number(o.height) || 10)
        if ('width' in o && w.o.width) w.input.style.width = `${Number(w.o.width) + 2}ch`
        if ('selectmode' in o) w.input.multiple = /multiple|extended/.test(o.selectmode)
        if ('items' in o) { w.items = o.items; this.renderList(w) }
        break
      }
      case 'optionmenu': {
        if ('values' in o) { w.values = o.values.map(String); this.fillSelect(w.input, w.values, w.input.value) }
        if ('value' in o && o.value !== undefined && o.value !== null) w.input.value = String(o.value)
        break
      }
      case 'canvas': {
        if ('width' in o || 'height' in o) { w.W = Number(w.o.width) || 378; w.H = Number(w.o.height) || 265; this.sizeCanvas(w) }
        if (!w.sized) this.sizeCanvas(w)
        break
      }
      case 'frame': case 'labelframe': {
        if ('text' in o && w.legend) { w.legend.textContent = o.text || ''; w.legend.classList.toggle('hidden', !o.text) }
        if ('width' in o || 'height' in o || 'propagate' in o) this.dirty.add(w)
        break
      }
      case 'progressbar': {
        const max = Number(w.o.maximum) || 100
        w.bar.style.width = Math.max(0, Math.min(100, (Number(w.o.value) || 0) / max * 100)) + '%'
        el.classList.toggle('tk-indeterminate', w.o.mode === 'indeterminate' && !!w.o.running)
        if ('length' in o && o.length) el.style.width = `min(100%, ${o.length}px)`
        if ('orient' in o) el.classList.toggle('tk-vertical', !String(o.orient).startsWith('h'))
        break
      }
      case 'separator': if ('orient' in o) el.classList.toggle('tk-vertical', !String(o.orient).startsWith('h')); break
      case 'treeview': if ('columns' in o) { w.tree = w.tree || { rows: [], heads: [['#0', '']].concat((o.columns || []).map(c => [c, c])), show: 'tree headings', sel: [] }; this.renderTree(w) } break
    }
    if ('menu' in o && w.win) { w.menuId = o.menu; this.refreshMenubars() }
    if (w.kind === 'win' && 'bg' in o && o.bg) w.body.style.backgroundColor = o.bg
  }

  setContent(w) {
    const el = w.el
    el.textContent = ''
    const img = w.o.image && tkImages.get(w.o.image)
    const text = w.o.text === undefined || w.o.text === null ? '' : String(w.o.text)
    if (img) {
      const c = h('canvas', { class: 'tk-img' })
      this.paintImage(c, img)
      w.imgEl = c
      const comp = w.o.compound || (text ? 'none' : 'none')
      if (text && comp && comp !== 'none') {
        el.classList.add('tk-compound', 'tk-c-' + comp)
        el.append(c, h('span', null, text))
      } else el.append(c)
    } else el.append(text)
  }

  paintImage(c, img) {
    c.width = img.w; c.height = img.h
    c.style.width = img.w + 'px'; c.style.height = img.h + 'px'
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, img.w, img.h)
    if (img.src) ctx.drawImage(img.src, 0, 0)
  }

  comboAsSelect(w) {
    w.select = h('select', { class: 'tk-option' })
    w.select.addEventListener('change', () => { w.input.value = w.select.value; if (this.live) this.send({ t: 'var', id: w.id, v: w.select.value, sel: 1 }) })
    this.fillSelect(w.select, w.values || [], w.input.value)
    w.el.replaceChildren(w.select)
  }
  fillSelect(sel, values, cur) {
    sel.textContent = ''
    for (const v of values) sel.append(h('option', { value: v, selected: v === cur }, v))
    if (cur !== undefined && values.includes(cur)) sel.value = cur
  }

  setValue(w, v) {
    if (w.kind === 'scale') { w.input.value = v; w.valEl.textContent = this.fmtScale(w, v); return }
    if (w.kind === 'optionmenu') { w.input.value = String(v); return }
    if (w.input) {
      if (w.input.value !== String(v)) {
        const atEnd = w.kind === 'text' && w.input.scrollHeight - w.input.scrollTop - w.input.clientHeight < 30
        w.input.value = String(v)
        if (atEnd) w.input.scrollTop = w.input.scrollHeight
      }
      if (w.select) w.select.value = String(v)
      if (w.kind === 'text') this.renderTextTags(w)
    }
  }

  renderList(w) {
    const s = w.input
    s.textContent = ''
    ;(w.items || []).forEach((t, i) => s.append(h('option', { value: String(i) }, String(t))))
  }
  listSel(w, sel) {
    const set = new Set(sel.map(Number))
    for (const o of w.input.options) o.selected = set.has(Number(o.value))
  }

  // 色付きの Text (読み取り専用のとき)
  renderTextTags(w) {
    if (!w.input) return
    const tags = (w.tags || []).filter(t => t[2] && (t[2].fg || t[2].bg || t[2].font || t[2].underline))
    const show = w.disabled && tags.length
    if (!show) { if (w.rich) { w.rich.remove(); w.rich = null; w.input.classList.remove('hidden') } return }
    const text = w.input.value
    if (!w.rich) { w.rich = h('div', { class: 'tk-text tk-rich' }); w.rich.style.cssText = w.input.style.cssText; w.input.after(w.rich); w.input.classList.add('hidden') }
    const marks = new Set([0, text.length])
    for (const [a, b] of tags) { marks.add(Math.max(0, Math.min(text.length, a))); marks.add(Math.max(0, Math.min(text.length, b))) }
    const pts = [...marks].sort((a, b) => a - b)
    w.rich.textContent = ''
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const span = h('span', null, text.slice(a, b))
      for (const [x, y, s] of tags) if (x <= a && b <= y) { if (s.fg) span.style.color = s.fg; if (s.bg) span.style.backgroundColor = s.bg; if (s.font) span.style.font = s.font; if (s.underline) span.style.textDecoration = 'underline' }
      w.rich.append(span)
    }
    w.rich.scrollTop = w.rich.scrollHeight
  }

  destroy(id) {
    const w = this.w.get(id)
    if (!w) return
    for (const c of [...(w.children || [])]) this.destroy(c.id)
    w.el.remove()
    this.w.delete(id)
    this.cats.delete(id)
    if (w.parent) { w.parent.children = w.parent.children.filter(c => c !== w); this.dirty.add(w.parent) }
  }

  // ============================================================
  // 並べる (pack / grid / place)
  // ============================================================
  markParent(w) { if (w.parent) this.dirty.add(w.parent) }
  layoutDirty() {
    if (!this.dirty.size) return
    const list = [...this.dirty]
    this.dirty.clear()
    for (const c of list) if (this.w.get(c.id) === c) this.layout(c)
  }

  container(w) { return w.inner || w.body || w.el }

  layout(c) {
    const box = this.container(c)
    if (!box) return
    if (c.kind === 'notebook') { this.renderTabs(c); return }
    const kids = c.children.filter(k => k.geo && !k.win)
    const packed = kids.filter(k => k.geo.mgr === 'pack').sort((a, b) => a.seq - b.seq)
    const gridded = kids.filter(k => k.geo.mgr === 'grid')
    const placed = kids.filter(k => k.geo.mgr === 'place')
    // いったん外す
    for (const k of kids) k.el.remove()
    for (const x of [...box.querySelectorAll(':scope > .tk-cav, :scope > .tk-parcel')]) x.remove()
    box.classList.remove('tk-grid', 'tk-packbox')
    box.style.gridTemplateColumns = box.style.gridTemplateRows = ''
    if (c.legend && c.legend.parentElement !== box && c.kind === 'labelframe') {}
    if (packed.length) {
      box.classList.add('tk-packbox')
      box.style.flexDirection = isVert(packed[0].geo.o.side) ? 'column' : 'row'
      this.buildCavity(box, packed, true)
    } else if (gridded.length) this.buildGrid(c, box, gridded)
    for (const k of placed) this.place(box, k)
    // 大きさ (中身があるときは、中身に合わせる = Tk の propagate)
    const fixed = c.o && (c.o.propagate === false || !kids.length)
    if ((c.kind === 'frame' || c.kind === 'labelframe') && c.o) {
      const st = c.el.style
      st.width = fixed && c.o.width ? `min(100%, ${c.o.width}px)` : ''
      st.height = fixed && c.o.height ? c.o.height + 'px' : ''
      if (placed.length && !packed.length && !gridded.length) { st.minWidth = c.o.width ? `min(100%, ${c.o.width}px)` : '200px'; st.minHeight = (c.o.height || 120) + 'px' }
    }
    if (c.win && placed.length && !packed.length && !gridded.length && !c.sized) c.body.style.minHeight = '240px'
  }

  buildCavity(box, list, root) {
    const vert = isVert(list[0].geo.o.side)
    const cav = root ? box : h('div', { class: 'tk-cav' })
    cav.style.flexDirection = vert ? 'column' : 'row'
    const start = [], end = []
    let i = 0
    while (i < list.length && isVert(list[i].geo.o.side) === vert) {
      const k = list[i]
      const side = k.geo.o.side || 'top'
      if (side === 'top' || side === 'left') start.push(k); else end.unshift(k)
      i++
    }
    for (const k of start) cav.append(this.parcel(k, vert))
    const rest = list.slice(i)
    const anyExpand = list.some(k => k.geo.o.expand)
    if (rest.length) { const inner = this.buildCavity(box, rest, false); inner.style.flex = '1 1 auto'; cav.append(inner) }
    else if (!anyExpand && end.length) cav.append(h('div', { class: 'tk-parcel tk-spacer-flex' }))
    for (const k of end) cav.append(this.parcel(k, vert))
    return cav
  }

  parcel(k, vert) {
    const o = k.geo.o
    const p = h('div', { class: 'tk-parcel' })
    const [px1, px2] = o.padx || [0, 0], [py1, py2] = o.pady || [0, 0]
    p.style.padding = `${py1}px ${px2}px ${py2}px ${px1}px`
    p.style.flexDirection = vert ? 'column' : 'row'
    if (o.expand) p.style.flex = '1 1 auto'
    const fill = o.fill || 'none'
    const anchor = o.anchor || 'center'
    // 横に並べる向き (縦の空き場所なら左右) の位置
    const cross = vert ? (fill === 'x' || fill === 'both' ? 'stretch' : /w/.test(anchor) ? 'flex-start' : /e/.test(anchor) ? 'flex-end' : 'center')
      : (fill === 'y' || fill === 'both' ? 'stretch' : /n/.test(anchor) ? 'flex-start' : /s/.test(anchor) ? 'flex-end' : 'center')
    const mainFill = vert ? (fill === 'y' || fill === 'both') : (fill === 'x' || fill === 'both')
    p.style.alignItems = cross
    p.style.justifyContent = vert ? (/n/.test(anchor) ? 'flex-start' : /s/.test(anchor) ? 'flex-end' : 'center') : (/w/.test(anchor) ? 'flex-start' : /e/.test(anchor) ? 'flex-end' : 'center')
    k.el.style.flex = mainFill && o.expand ? '1 1 auto' : ''
    if (o.ipadx || o.ipady) k.el.style.padding = `${(o.ipady || [0])[0]}px ${(o.ipadx || [0])[0]}px`
    p.append(k.el)
    return p
  }

  buildGrid(c, box, list) {
    box.classList.add('tk-grid')
    let cols = 0, rows = 0
    for (const k of list) { const g = k.geo.o; cols = Math.max(cols, (g.column || 0) + (g.columnspan || 1)); rows = Math.max(rows, (g.row || 0) + (g.rowspan || 1)) }
    const cfg = c.gridcfg || { cols: {}, rows: {} }
    const track = (n, conf) => Array.from({ length: n }, (_, i) => {
      const x = conf[String(i)] || {}
      const wgt = Number(x.weight) || 0, min = Number(x.minsize) || 0
      return wgt > 0 ? `minmax(${min}px, ${wgt}fr)` : `minmax(${min}px, auto)`
    }).join(' ')
    box.style.gridTemplateColumns = track(cols, cfg.cols || {})
    box.style.gridTemplateRows = track(rows, cfg.rows || {})
    for (const k of list) {
      const g = k.geo.o
      const st = k.el.style
      st.gridRow = `${(g.row || 0) + 1} / span ${g.rowspan || 1}`
      st.gridColumn = `${(g.column || 0) + 1} / span ${g.columnspan || 1}`
      const s = g.sticky || ''
      st.justifySelf = /e/.test(s) && /w/.test(s) ? 'stretch' : /w/.test(s) ? 'start' : /e/.test(s) ? 'end' : 'center'
      st.alignSelf = /n/.test(s) && /s/.test(s) ? 'stretch' : /n/.test(s) ? 'start' : /s/.test(s) ? 'end' : 'center'
      const [px1, px2] = g.padx || [0, 0], [py1, py2] = g.pady || [0, 0]
      st.margin = `${py1}px ${px2}px ${py2}px ${px1}px`
      if (g.ipadx || g.ipady) st.padding = `${(g.ipady || [0])[0]}px ${(g.ipadx || [0])[0]}px`
      box.append(k.el)
    }
  }

  place(box, k) {
    const g = k.geo.o
    const st = k.el.style
    st.position = 'absolute'
    const anchor = g.anchor || 'nw'
    st.left = `calc(${(g.relx || 0) * 100}% + ${g.x || 0}px)`
    st.top = `calc(${(g.rely || 0) * 100}% + ${g.y || 0}px)`
    if (g.width || g.relwidth) st.width = `calc(${(g.relwidth || 0) * 100}% + ${g.width || 0}px)`
    if (g.height || g.relheight) st.height = `calc(${(g.relheight || 0) * 100}% + ${g.height || 0}px)`
    const tx = /w/.test(anchor) ? '0' : /e/.test(anchor) ? '-100%' : '-50%'
    const ty = /n/.test(anchor) ? '0' : /s/.test(anchor) ? '-100%' : '-50%'
    st.transform = `translate(${tx}, ${ty})`
    box.style.position = 'relative'
    box.append(k.el)
  }

  // ============================================================
  // ノートブック・表
  // ============================================================
  renderTabs(w) {
    w.tabbar.textContent = ''
    ;(w.tabs || []).forEach(([cid, text], i) => {
      w.tabbar.append(h('button', { class: 'tk-tab' + (i === w.cur ? ' on' : ''), onclick: () => { if (!this.live) return; w.cur = i; this.renderTabs(w); this.send({ t: 'var', id: w.id, v: i }) } }, text))
    })
    const box = w.inner
    for (const k of w.children) k.el.remove()
    const cur = w.tabs && w.tabs[w.cur]
    const child = cur && this.w.get(cur[0])
    if (child) box.append(child.el)
  }

  renderTree(w) {
    const t = w.tree
    if (!t) return
    const tbl = w.table
    tbl.textContent = ''
    const showTree = /tree/.test(t.show || 'tree headings')
    const heads = t.heads.filter(([c]) => c !== '#0' || showTree)
    if (/headings/.test(t.show || 'tree headings')) tbl.append(h('thead', null, h('tr', null, heads.map(([, text]) => h('th', null, text)))))
    const body = h('tbody')
    const sel = new Set(t.sel || [])
    for (const [iid, depth, text, values, kids] of t.rows) {
      const cells = []
      if (showTree) cells.push(h('td', { class: 'tk-tree-0', style: `padding-left:${8 + depth * 16}px` }, kids ? '▾ ' : '', text))
      const vals = heads.filter(([c]) => c !== '#0')
      vals.forEach((_, i) => cells.push(h('td', null, values[i] !== undefined ? values[i] : '')))
      const tr = h('tr', { class: sel.has(iid) ? 'on' : '', onclick: () => { if (!this.live) return; t.sel = [iid]; this.renderTree(w); this.send({ t: 'var', id: w.id, v: [iid] }) } }, cells)
      body.append(tr)
    }
    tbl.append(body)
  }

  // ============================================================
  // メニュー
  // ============================================================
  refreshMenubars() {
    for (const w of this.w.values()) {
      if (!w.win || !w.menuId) continue
      const items = this.menus.get(w.menuId) || []
      w.menubar.textContent = ''
      w.menubar.classList.toggle('hidden', !items.length)
      for (const it of items) {
        if (it.type === 'separator') continue
        const b = h('button', { class: 'tk-menu-btn', onclick: () => { if (!this.live) return; if (it.type === 'cascade') this.openMenu(it.menu, b); else if (it.item) this.send({ t: 'menu', item: it.item }) } }, it.label)
        w.menubar.append(b)
      }
    }
  }
  openMenu(menuId, anchor) {
    const items = this.menus.get(menuId) || []
    const list = items.map(it => {
      if (it.type === 'separator') return '-'
      if (it.type === 'cascade') return { label: it.label + '  ›', run: () => setTimeout(() => this.openMenu(it.menu, anchor), 30) }
      return { label: it.label, hint: it.accel || undefined, checked: it.type !== 'command' ? !!it.checked : undefined, disabled: it.state === 'disabled', run: () => this.live && this.send({ t: 'menu', item: it.item }) }
    })
    if (list.length) menu(list, anchor)
  }

  // ============================================================
  // キャンバス
  // ============================================================
  sizeCanvas(w) {
    w.sized = true
    const dpr = Math.min(3, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1)
    w.dpr = dpr
    w.cv.width = Math.round(w.W * dpr); w.cv.height = Math.round(w.H * dpr)
    w.el.style.setProperty('--cw', w.W + 'px')
    w.el.style.aspectRatio = `${w.W} / ${w.H}`
    this.drawCanvas(w)
  }

  canvasOp(w, op) {
    const kind = op[2]
    if (kind === 'new') { w.items.set(op[3], { type: op[4], c: op[5], o: op[6] || {} }); w.order.push(op[3]); if (op[4] === 'window') this.placeWindowItem(w, op[3]) }
    else if (kind === 'xy') { const it = w.items.get(op[3]); if (it) { it.c = op[4]; if (it.type === 'window') this.placeWindowItem(w, op[3]) } }
    else if (kind === 'cfg') { const it = w.items.get(op[3]); if (it) Object.assign(it.o, op[4] || {}) }
    else if (kind === 'del') { const gone = new Set(op[3]); for (const i of gone) { const it = w.items.get(i); if (it && it.type === 'window' && it.el) it.el.remove(); w.items.delete(i) } w.order = w.order.filter(i => !gone.has(i)) }
    else if (kind === 'order') w.order = op[3].filter(i => w.items.has(i))
    this.scheduleCanvas(w)
  }
  scheduleCanvas(w) {
    if (w.raf) return
    w.raf = requestAnimationFrame(() => { w.raf = 0; this.drawCanvas(w) })
  }
  placeWindowItem(w, i) {
    const it = w.items.get(i)
    const child = this.w.get(it.o.window)
    if (!child) return
    it.el = child.el
    const st = child.el.style
    st.position = 'absolute'
    st.left = (it.c[0] / w.W * 100) + '%'
    st.top = (it.c[1] / w.H * 100) + '%'
    const a = it.o.anchor || 'center'
    st.transform = `translate(${/w/.test(a) ? '0' : /e/.test(a) ? '-100%' : '-50%'}, ${/n/.test(a) ? '0' : /s/.test(a) ? '-100%' : '-50%'})`
    w.overlay.append(child.el)
  }

  drawCanvas(w) {
    const ctx = w.cv.getContext('2d')
    const d = w.dpr || 1
    ctx.setTransform(d, 0, 0, d, 0, 0)
    ctx.fillStyle = w.bg || w.o.bg || '#ffffff'
    ctx.fillRect(0, 0, w.W, w.H)
    for (const i of w.order) {
      const it = w.items.get(i)
      if (!it || it.o.state === 'hidden') continue
      try { this.drawItem(ctx, it) } catch {}
    }
  }

  drawItem(ctx, it) {
    const o = it.o, c = it.c
    const lw = o.width !== undefined && o.width !== '' ? Number(o.width) : 1
    const dash = o.dash && o.dash.length ? o.dash : []
    ctx.setLineDash(dash)
    ctx.lineWidth = lw
    switch (it.type) {
      case 'line': {
        if (c.length < 4) break
        ctx.strokeStyle = o.fill === undefined ? '#000' : o.fill || 'transparent'
        ctx.lineCap = o.capstyle === 'round' ? 'round' : o.capstyle === 'projecting' ? 'square' : 'butt'
        ctx.lineJoin = o.joinstyle === 'bevel' ? 'bevel' : o.joinstyle === 'miter' ? 'miter' : 'round'
        ctx.beginPath()
        this.path(ctx, c, !!o.smooth, false)
        if (o.fill !== '') ctx.stroke()
        if (o.arrow && o.arrow !== 'none') {
          ctx.fillStyle = ctx.strokeStyle
          const head = (x1, y1, x2, y2) => {
            const a = Math.atan2(y2 - y1, x2 - x1), L = 8 + lw * 2, W2 = 3 + lw
            ctx.beginPath(); ctx.moveTo(x2, y2)
            ctx.lineTo(x2 - L * Math.cos(a) + W2 * Math.sin(a), y2 - L * Math.sin(a) - W2 * Math.cos(a))
            ctx.lineTo(x2 - L * Math.cos(a) - W2 * Math.sin(a), y2 - L * Math.sin(a) + W2 * Math.cos(a))
            ctx.closePath(); ctx.fill()
          }
          const n = c.length
          if (o.arrow === 'last' || o.arrow === 'both') head(c[n - 4], c[n - 3], c[n - 2], c[n - 1])
          if (o.arrow === 'first' || o.arrow === 'both') head(c[2], c[3], c[0], c[1])
        }
        break
      }
      case 'rectangle': case 'oval': {
        if (c.length < 4) break
        const x = Math.min(c[0], c[2]), y = Math.min(c[1], c[3]), ww = Math.abs(c[2] - c[0]), hh = Math.abs(c[3] - c[1])
        ctx.beginPath()
        if (it.type === 'rectangle') ctx.rect(x, y, ww, hh)
        else ctx.ellipse(x + ww / 2, y + hh / 2, ww / 2, hh / 2, 0, 0, Math.PI * 2)
        if (o.fill) { ctx.fillStyle = o.fill; ctx.fill() }
        const out = o.outline === undefined ? '#000' : o.outline
        if (out && lw > 0) { ctx.strokeStyle = out; ctx.stroke() }
        break
      }
      case 'polygon': {
        if (c.length < 4) break
        ctx.beginPath()
        this.path(ctx, c, !!o.smooth, true)
        ctx.closePath()
        const fill = o.fill === undefined ? '#000' : o.fill
        if (fill) { ctx.fillStyle = fill; ctx.fill() }
        if (o.outline && lw > 0) { ctx.strokeStyle = o.outline; ctx.stroke() }
        break
      }
      case 'arc': {
        if (c.length < 4) break
        const x = Math.min(c[0], c[2]), y = Math.min(c[1], c[3]), ww = Math.abs(c[2] - c[0]), hh = Math.abs(c[3] - c[1])
        const start = Number(o.start || 0) * Math.PI / 180, ext = Number(o.extent === undefined ? 90 : o.extent) * Math.PI / 180
        const cx = x + ww / 2, cy = y + hh / 2
        const style = o.style || 'pieslice'
        ctx.beginPath()
        if (style === 'pieslice') ctx.moveTo(cx, cy)
        ctx.ellipse(cx, cy, ww / 2, hh / 2, 0, -start, -(start + ext), ext > 0)
        if (style !== 'arc') ctx.closePath()
        if (style !== 'arc' && o.fill) { ctx.fillStyle = o.fill; ctx.fill() }
        const out = o.outline === undefined ? '#000' : o.outline
        if (out && lw > 0) { ctx.strokeStyle = out; ctx.stroke() }
        break
      }
      case 'text': {
        ctx.setLineDash([])
        ctx.font = o.font || '13px system-ui, sans-serif'
        ctx.fillStyle = o.fill === undefined ? '#000' : o.fill || 'transparent'
        const text = String(o.text === undefined ? '' : o.text)
        const lines = this.wrapText(ctx, text, Number(o.width) || 0)
        const m = ctx.measureText('Mg')
        const lh = (m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || 10) + (m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || 3)
        const wmax = Math.max(0, ...lines.map(l => ctx.measureText(l).width))
        const a = o.anchor || 'center'
        let x = c[0], y = c[1]
        x -= /w/.test(a) ? 0 : /e/.test(a) ? wmax : wmax / 2
        y -= /n/.test(a) ? 0 : /s/.test(a) ? lh * lines.length : lh * lines.length / 2
        ctx.save()
        if (o.angle) { ctx.translate(c[0], c[1]); ctx.rotate(-Number(o.angle) * Math.PI / 180); ctx.translate(-c[0], -c[1]) }
        ctx.textBaseline = 'top'
        lines.forEach((l, i) => {
          const lw2 = ctx.measureText(l).width
          const jx = o.justify === 'right' ? wmax - lw2 : o.justify === 'center' ? (wmax - lw2) / 2 : 0
          ctx.fillText(l, x + jx, y + i * lh)
        })
        ctx.restore()
        break
      }
      case 'image': {
        const img = o.image && tkImages.get(o.image)
        if (!img || !img.src) break
        const a = o.anchor || 'center'
        const x = c[0] - (/w/.test(a) ? 0 : /e/.test(a) ? img.w : img.w / 2)
        const y = c[1] - (/n/.test(a) ? 0 : /s/.test(a) ? img.h : img.h / 2)
        ctx.drawImage(img.src, x, y)
        break
      }
    }
    ctx.setLineDash([])
  }

  path(ctx, c, smooth, closed) {
    const n = c.length / 2
    if (!smooth || n < 3) { for (let i = 0; i < c.length; i += 2) i ? ctx.lineTo(c[i], c[i + 1]) : ctx.moveTo(c[i], c[i + 1]); return }
    // Tk の smooth: 各辺の中点を通る 2 次ベジェ
    const P = i => [c[(i % n) * 2], c[(i % n) * 2 + 1]]
    if (closed) {
      const m0 = [(P(0)[0] + P(1)[0]) / 2, (P(0)[1] + P(1)[1]) / 2]
      ctx.moveTo(m0[0], m0[1])
      for (let i = 1; i <= n; i++) { const p = P(i), q = P(i + 1); ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2) }
    } else {
      ctx.moveTo(c[0], c[1])
      for (let i = 1; i < n - 1; i++) { const p = P(i), q = P(i + 1); const mx = i === n - 2 ? q[0] : (p[0] + q[0]) / 2, my = i === n - 2 ? q[1] : (p[1] + q[1]) / 2; ctx.quadraticCurveTo(p[0], p[1], mx, my) }
    }
  }

  wrapText(ctx, text, width) {
    const lines = text.split('\n')
    if (!width) return lines
    const out = []
    for (const line of lines) {
      let cur = ''
      for (const ch of line) {
        if (ctx.measureText(cur + ch).width > width && cur) { out.push(cur); cur = ch.trimStart() } else cur += ch
      }
      out.push(cur)
    }
    return out
  }

  // ---- 画像 (PhotoImage) ----
  imageOp(op) {
    const sub = op[1]
    const img = tkImages.get(op[2])
    if (sub === 'put' && img) {
      if (!img.src || img.src instanceof ImageBitmap) { const c = document.createElement('canvas'); c.width = img.w; c.height = img.h; if (img.src) c.getContext('2d').drawImage(img.src, 0, 0); img.src = c }
      const ctx = img.src.getContext('2d')
      const [x1, y1, x2, y2] = op[4]
      ctx.fillStyle = op[3] || '#000'
      ctx.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1))
    } else if (sub === 'blank' && img && img.src && img.src.getContext) img.src.getContext('2d').clearRect(0, 0, img.w, img.h)
    else if (sub === 'copy') {
      const src = tkImages.get(op[3])
      if (img && src && src.src) {
        const c = document.createElement('canvas'); c.width = img.w; c.height = img.h
        const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false
        ctx.drawImage(src.src, 0, 0, src.w * op[4], src.h * op[5])
        img.src = c
      }
    }
    for (const w of this.w.values()) {
      if (w.kind === 'canvas') this.scheduleCanvas(w)
      else if (w.o && w.o.image) this.setContent(w)
    }
  }

  // ============================================================
  // 操作 → Python
  // ============================================================
  wants(id, cat) {
    const w = this.w.get(id)
    const win = w && this.winOf(w)
    return (this.cats.get(id) || new Set()).has(cat) || (win && (this.cats.get(win.id) || new Set()).has(cat)) || (this.cats.get(0) || new Set()).has(cat)
  }
  winOf(w) { let x = w; while (x && !x.win) x = x.parent; return x }
  targetOf(el) {
    const t = el && el.closest ? el.closest('[data-tkid]') : null
    return t ? this.w.get(Number(t.dataset.tkid)) : null
  }
  rel(w, e) {
    if (w.kind === 'canvas') {
      const r = w.cv.getBoundingClientRect()
      return { x: Math.round((e.clientX - r.left) / (r.width || 1) * w.W), y: Math.round((e.clientY - r.top) / (r.height || 1) * w.H) }
    }
    const r = w.el.getBoundingClientRect()
    return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) }
  }

  bindRoot() {
    const root = this.el
    let lastMove = 0
    const mouse = (k, e, cat) => {
      if (!this.live) return
      const w = this.targetOf(e.target)
      if (!w) return
      const win = this.winOf(w)
      if (!this.wants(w.id, cat) && !(cat === 'move' && this.wants(w.id, 'drag') && e.buttons)) return
      if (cat === 'move') { const now = performance.now(); if (now - lastMove < 16) return; lastMove = now }
      this.activeWin = win
      this.send({ t: 'mouse', k, id: w.id, win: win ? win.id : 0, ...this.rel(w, e), b: e.button === 2 ? 3 : e.button === 1 ? 2 : 1, bs: e.buttons, m: mods(e), d: k === 'wheel' ? -Math.sign(e.deltaY) : 0 })
    }
    root.addEventListener('pointerdown', e => {
      const w = this.targetOf(e.target)
      if (w) this.activeWin = this.winOf(w)
      if (w && w.kind === 'canvas') { try { w.el.focus({ preventScroll: true }) } catch {} }
      mouse('down', e, 'mouse')
    })
    root.addEventListener('pointerup', e => mouse('up', e, 'mouse'))
    root.addEventListener('pointermove', e => mouse('move', e, e.buttons ? 'drag' : 'move'))
    root.addEventListener('dblclick', e => mouse('dbl', e, 'dbl'))
    root.addEventListener('wheel', e => { const w = this.targetOf(e.target); if (w && this.wants(w.id, 'wheel')) { e.preventDefault(); mouse('wheel', e, 'wheel') } }, { passive: false })
    root.addEventListener('pointerover', e => { if (e.relatedTarget && root.contains(e.relatedTarget) && this.targetOf(e.relatedTarget) === this.targetOf(e.target)) return; mouse('enter', e, 'hover') })
    root.addEventListener('pointerout', e => { if (e.relatedTarget && this.targetOf(e.relatedTarget) === this.targetOf(e.target)) return; mouse('leave', e, 'hover') })
    root.addEventListener('contextmenu', e => { const w = this.targetOf(e.target); if (w && this.wants(w.id, 'mouse')) e.preventDefault() })
    // キー: tk のウィンドウを触ったあとは、ページ全体のキーを受け取る (入力欄の中ならその欄へ)
    this.onKey = e => {
      if (!this.live || e.isComposing || !this.el.isConnected) return
      const inside = this.el.contains(e.target)
      const t = e.target
      const editable = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      if (!inside && editable) return
      if (!inside && !this.el.offsetParent) return
      const w = inside ? this.targetOf(t) : null
      const win = w ? this.winOf(w) : (this.activeWin && this.w.get(this.activeWin.id)) || [...this.w.values()].find(x => x.win)
      if (!win) return
      const id = w ? w.id : win.id
      if (!this.wants(id, 'key')) return
      if (!editable && (/^Arrow/.test(e.key) || e.key === ' ' || e.key === 'Tab' || e.key === 'Backspace')) e.preventDefault()
      const ks = keysym(e)
      this.send({ t: 'key', k: e.type === 'keydown' ? 'kd' : 'ku', id, win: win.id, ks, ch: e.key.length === 1 ? e.key : e.key === 'Enter' ? '\r' : e.key === 'Tab' ? '\t' : e.key === 'Backspace' ? '\b' : e.key === 'Escape' ? '\x1b' : '', kc: e.keyCode || 0, m: mods(e) })
    }
    document.addEventListener('keydown', this.onKey)
    document.addEventListener('keyup', this.onKey)
  }

  finish() {
    this.live = false
    this.el.classList.add('tk-done')
    this.el.classList.remove('sf-sticky')
    if (this.onKey) { document.removeEventListener('keydown', this.onKey); document.removeEventListener('keyup', this.onKey); this.onKey = null }
  }
  destroyAll() { this.finish(); this.el.remove() }
}

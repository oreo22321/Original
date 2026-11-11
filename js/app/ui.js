// UI の共通部品: DOM 作成、アイコン、トースト、ダイアログ、メニュー
import { getMode } from './store.js'
export function h(tag, props, ...children) {
  const el = document.createElement(tag)
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'class') el.className = v
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
      else if (k === 'html') el.innerHTML = v
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
      else if (k === 'dataset') Object.assign(el.dataset, v)
      else if (v === true) el.setAttribute(k, '')
      else el.setAttribute(k, v)
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

// ---- アイコン (SVG) ----
const P = {
  files: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  outline: '<path d="M4 6h16M4 12h10M4 18h13"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  cube: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7l-4 9z"/><path d="M3 19l3.5-8H22l-3.5 8z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  newFile: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  newFolder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  keyboardDown: '<rect x="2" y="3" width="20" height="11" rx="2"/><path d="M6 7h.01M10 7h.01M14 7h.01M18 7h.01M7 10.5h10M9 18l3 3 3-3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  format: '<path d="M4 7h16M4 12h10M4 17h16"/><path d="m17 10 3 2-3 2"/>',
  brush: '<path d="M9.06 11.9 18.5 2.5a2.1 2.1 0 0 1 3 3l-9.4 9.4M7 14a3 3 0 0 0-3 3c0 1.3-1 2-2 2 1 1.5 3 2 4.5 2A4.5 4.5 0 0 0 11 16.5 3 3 0 0 0 7 14z"/>',
  command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z"/>',
  home: '<path d="m3 11 9-8 9 8M5 9v11h14V9"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  zip: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M10 7h2M10 10h2M10 13h2M9 16h4v3H9z"/>',
  wrap: '<path d="M3 6h18M3 12h15a3 3 0 0 1 0 6h-4M3 18h7"/><path d="m16 16-2 2 2 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  bug: '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="m19 7-3 2M5 7l3 2M19 19l-3-2M5 19l3-2M20 13h-4M4 13h4M12 6V3"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  tab: '<path d="M3 12h14M13 8l4 4-4 4M21 5v14"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  diff: '<path d="M12 3v14M5 10h14"/><path d="M5 21h14"/>',
  filter: '<path d="M3 5h18l-7 8.5V19l-4-2v-3.5z"/>',
  wand: '<path d="M4 20 15 9l-2-2L2 18z" transform="translate(1 1)"/><path d="m17 3 .9 2.1L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-.9zM20 13l.6 1.4L22 15l-1.4.6L20 17l-.6-1.4L18 15l1.4-.6z"/>',
  bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1.2 1.6 1.3 2.5h5.4c.1-.9.5-1.7 1.3-2.5A6 6 0 0 0 12 3z"/>',
  pin: '<path d="M12 16v6M8.5 3h7l-1 6 3.5 4.500H6L9.5 9z"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  saved: '<path d="M7 18a5 5 0 1 1 1.2-9.860A6 6 0 0 1 20 10.5 4 4 0 0 1 18 18z"/><path d="m9.5 13 2 2 3.5-3.5"/>',
  saving: '<path d="M7 18a5 5 0 1 1 1.2-9.860A6 6 0 0 1 20 10.5 4 4 0 0 1 18 18z"/><path d="M12 16v-5M9.5 13.5 12 11l2.5 2.5"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.500h.01M7 16.500h.01M11 7.500h6M11 16.500h6"/>',
  device: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18h3"/>',
  braces: '<path d="M8 4c-2 0-3 1-3 3v2c0 1.5-1 2.5-2 3 1 .500 2 1.5 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 2.5 2 3-1 .500-2 1.5-2 3v2c0 2-1 3-3 3"/>',
  text: '<path d="M5 6h14M5 10h14M5 14h9M5 18h11"/>',
  gamepad: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7.5 11v3M6 12.500h3M15 11.500h.01M17.5 13.500h.01"/>',
}
export function icon(name, size = 20, cls = '') {
  const span = document.createElement('span')
  span.className = 'ico ' + cls
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`
  return span
}

// ファイルの種類を表すアイコン (Studio の Script / LocalScript / ModuleScript と同じ色分け)
const FILE_KINDS = {
  server: ['server', '#3fb950', 'Script (サーバー)'],
  client: ['device', '#58a6ff', 'LocalScript (クライアント)'],
  module: ['cube', '#bc8cff', 'ModuleScript'],
  executor: ['bolt', '#f0a43a', 'エグゼキュータースクリプト'],
  json: ['braces', '#d7ba5a', 'JSON'],
  md: ['book', '#58a6ff', 'メモ (Markdown)'],
  text: ['text', '#8b949e', 'テキスト'],
}
export function fileKind(path) {
  const m = /\.(server|client)?\.?(luau?|json|md|markdown|txt)$/i.exec(path)
  if (!m) return 'text'
  const ext = m[2].toLowerCase()
  if (ext === 'lua' || ext === 'luau') return m[1] ? m[1].toLowerCase() : (getMode() === 'executor' ? 'executor' : 'module')
  return ext === 'json' ? 'json' : ext === 'txt' ? 'text' : 'md'
}
export function fileIcon(path, dir, open) {
  if (dir) return icon(open ? 'folderOpen' : 'folder', 18, 'fi-folder')
  const [name, color, label] = FILE_KINDS[fileKind(path)]
  const el = icon(name, 17, 'fi-kind')
  el.style.color = color
  el.title = label
  return el
}

// ---- 触覚フィードバック ----
export function haptic(ms = 8) {
  try { if (navigator.vibrate) navigator.vibrate(ms) } catch {}
}

// ---- トースト ----
let toastHost = null
export function toast(msg, opts = {}) {
  if (!toastHost) { toastHost = h('div', { class: 'toast-host' }); document.body.append(toastHost) }
  const el = h('div', { class: 'toast ' + (opts.kind || '') }, opts.icon ? icon(opts.icon, 18) : null, h('span', null, msg),
    opts.action ? h('button', { class: 'toast-action', onclick: () => { opts.action.run(); el.remove() } }, opts.action.label) : null)
  // 同時に表示するのは 3 件まで
  while (toastHost.childElementCount >= 3) toastHost.firstElementChild.remove()
  toastHost.append(el)
  requestAnimationFrame(() => el.classList.add('show'))
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250) }, opts.duration || 2600)
  return el
}

// ---- モーダル ----
export function modal({ title, body, actions = [], wide = false, onClose, sheet = true, cls = '' }) {
  const overlay = h('div', { class: 'modal-overlay' })
  const box = h('div', { class: `modal ${wide ? 'wide' : ''} ${sheet ? 'sheet' : ''} ${cls}`, role: 'dialog', 'aria-modal': 'true' })
  const close = (v) => {
    overlay.classList.remove('show')
    setTimeout(() => overlay.remove(), 180)
    document.removeEventListener('keydown', onKey, true)
    if (onClose) onClose(v)
  }
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }
  document.addEventListener('keydown', onKey, true)
  const header = h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, title || ''), h('button', { class: 'icon-btn', 'aria-label': '閉じる', onclick: () => close(null) }, icon('close', 20)))
  const content = h('div', { class: 'modal-body' }, body)
  const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map(a => h('button', { class: 'btn ' + (a.primary ? 'primary' : '') + (a.danger ? ' danger' : ''), onclick: () => { const r = a.run ? a.run() : a.value; if (r !== false) close(a.value !== undefined ? a.value : r) } }, a.label))) : null
  box.append(header, content, foot || '')
  overlay.append(box)
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(null) })
  document.body.append(overlay)
  requestAnimationFrame(() => overlay.classList.add('show'))
  return { close, box, content }
}

export function promptDialog(title, { value = '', placeholder = '', label = '', okLabel = 'OK', selectBase = false } = {}) {
  return new Promise(resolve => {
    const input = h('input', { class: 'input', value, placeholder, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    let done = false
    const m = modal({
      title,
      body: h('div', { class: 'form' }, label ? h('label', { class: 'label' }, label) : null, input),
      actions: [{ label: 'キャンセル', value: null }, { label: okLabel, primary: true, run: () => { done = true; resolve(input.value.trim()); } }],
      onClose: () => { if (!done) resolve(null) },
      sheet: false,
    })
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { done = true; resolve(input.value.trim()); m.close() } })
    setTimeout(() => {
      input.focus()
      if (selectBase && value.includes('.')) input.setSelectionRange(0, value.lastIndexOf('.'))
      else input.select()
    }, 50)
  })
}

export function confirmDialog(title, message, { okLabel = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false
    modal({
      title, body: h('div', { class: 'confirm-msg' }, message),
      actions: [{ label: 'キャンセル', value: false }, { label: okLabel, primary: !danger, danger, run: () => { done = true; resolve(true) } }],
      onClose: () => { if (!done) resolve(false) },
      sheet: false,
    })
  })
}

// ---- メニュー (スマホではアクションシート) ----
export function menu(items, anchor, { title } = {}) {
  closeMenus()
  const mobile = document.body.dataset.layout === 'mobile'
  const list = h('div', { class: 'menu-list' })
  const overlay = h('div', { class: 'menu-overlay' + (mobile ? ' sheet' : '') })
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true) }
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  document.addEventListener('keydown', onKey, true)
  if (title) list.append(h('div', { class: 'menu-title' }, title))
  for (const it of items) {
    if (it === '-') { list.append(h('div', { class: 'menu-sep' })); continue }
    if (!it) continue
    // 説明文 (押せない行)
    if (it.note) { list.append(h('div', { class: 'menu-note ' + (it.kind || '') }, it.icon ? icon(it.icon, 16) : null, h('span', null, it.note))); continue }
    list.append(h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : ''), disabled: it.disabled,
      onclick: () => { close(); it.run() },
    }, it.icon ? icon(it.icon, 18) : h('span', { class: 'ico-space' }), h('span', { class: 'menu-label' }, it.label), it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null, it.checked ? icon('check', 16) : null))
  }
  if (mobile) list.append(h('button', { class: 'menu-item cancel', onclick: close }, h('span', { class: 'menu-label' }, 'キャンセル')))
  overlay.append(list)
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  overlay.addEventListener('touchstart', e => { if (e.target === overlay) { e.preventDefault(); close() } }, { passive: false })
  document.body.append(overlay)
  if (!mobile && anchor) {
    const r = anchor.getBoundingClientRect()
    list.style.position = 'fixed'
    const w = 240
    let left = Math.min(r.left, innerWidth - w - 8)
    list.style.left = Math.max(8, left) + 'px'
    list.style.top = (r.bottom + 4) + 'px'
    requestAnimationFrame(() => {
      const lr = list.getBoundingClientRect()
      if (lr.bottom > innerHeight - 8) list.style.top = Math.max(8, r.top - lr.height - 4) + 'px'
    })
  } else if (!mobile) {
    list.style.position = 'fixed'; list.style.left = '50%'; list.style.top = '30%'; list.style.transform = 'translateX(-50%)'
  }
  requestAnimationFrame(() => overlay.classList.add('show'))
  return close
}
export function closeMenus() { document.querySelectorAll('.menu-overlay').forEach(e => e.remove()) }

// ---- 長押し ----
export function onLongPress(el, fn, ms = 480) {
  let timer = null, sx = 0, sy = 0, fired = false
  el.addEventListener('touchstart', e => {
    fired = false
    const t = e.touches[0]
    sx = t.clientX; sy = t.clientY
    timer = setTimeout(() => { fired = true; haptic(12); fn(e) }, ms)
  }, { passive: true })
  el.addEventListener('touchmove', e => {
    const t = e.touches[0]
    if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) clearTimeout(timer)
  }, { passive: true })
  el.addEventListener('touchend', e => { clearTimeout(timer); if (fired) { e.preventDefault() } })
  el.addEventListener('contextmenu', e => { e.preventDefault(); fn(e) })
}

// ---- あいまい検索 ----
export function fuzzyScore(query, text) {
  if (!query) return 1
  const q = query.toLowerCase(), t = text.toLowerCase()
  if (t.includes(q)) return 1000 - t.indexOf(q) - t.length * 0.1
  let qi = 0, score = 0, last = -1
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { score += last === i - 1 ? 5 : 1; last = i; qi++ }
  }
  return qi === q.length ? score : -1
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function relTime(t) {
  const d = (Date.now() - t) / 1000
  if (d < 60) return 'たった今'
  if (d < 3600) return Math.floor(d / 60) + ' 分前'
  if (d < 86400) return Math.floor(d / 3600) + ' 時間前'
  if (d < 86400 * 7) return Math.floor(d / 86400) + ' 日前'
  return new Date(t).toLocaleDateString('ja-JP')
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', top: '-1000px', opacity: '0' } })
    ta.value = text
    document.body.append(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch {}
    ta.remove()
    return ok
  }
}

export function download(name, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function shareFile(name, data, type = 'text/plain') {
  try {
    const file = new File([data], name, { type })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name })
      return true
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return true
  }
  download(name, data, type)
  return false
}

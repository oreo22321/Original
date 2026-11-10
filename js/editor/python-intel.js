// Python の補完・ホバー
import { PY_KEYWORDS, PY_BUILTINS, PY_MODULES, PY_STR_METHODS, PY_LIST_METHODS, PY_DICT_METHODS } from '../data/python-api.js'
import { PY_SNIPPETS } from '../data/snippets.js'
import { snippet, snippetCompletion, syntaxTree } from '../../vendor/codemirror.js'

const fnApply = (name, hasParams) => snippet(hasParams ? `${name}(\${})` : `${name}()\${}`)

function info(name, e, prefix = '') {
  return () => {
    const el = document.createElement('div')
    el.className = 'cm-api-info'
    const s = document.createElement('div'); s.className = 'sig'
    s.textContent = prefix + name + (e.kind === 'function' ? e.sig : ': ' + e.type)
    el.append(s)
    if (e.doc) { const d = document.createElement('div'); d.className = 'doc'; d.textContent = e.doc; el.append(d) }
    return el
  }
}

function entryItems(entries, prefix) {
  return Object.entries(entries).map(([name, e]) => e.kind === 'function'
    ? { label: name, type: 'function', detail: e.sig, info: info(name, e, prefix), apply: fnApply(name, !/^\(\)/.test(e.sig)) }
    : { label: name, type: 'variable', detail: e.type, info: info(name, e, prefix) })
}

function methodItems(list) {
  return list.map(m => {
    const name = m.slice(0, m.indexOf('('))
    return { label: name, type: 'method', detail: m, apply: fnApply(name, !m.endsWith('()')) }
  })
}

// import 文から モジュール名 → 実体 の対応を作る
function imports(text) {
  const map = new Map()
  let m
  const re1 = /^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm
  while ((m = re1.exec(text))) map.set(m[2] || m[1], m[1])
  const re2 = /^\s*from\s+([\w.]+)\s+import\s+(.+)$/gm
  while ((m = re2.exec(text))) {
    for (const part of m[2].replace(/[()]/g, '').split(',')) {
      const [n, alias] = part.trim().split(/\s+as\s+/)
      if (n && n !== '*') map.set((alias || n).trim(), m[1] + '.' + n.trim())
    }
  }
  return map
}

function varKind(text, name) {
  const re = new RegExp(`\\b${name}\\s*(?::\\s*(\\w+))?\\s*=\\s*([^\\n]+)`, 'g')
  let m, last = null
  while ((m = re.exec(text))) last = m
  if (!last) return null
  if (last[1]) return ({ str: 'str', list: 'list', dict: 'dict' })[last[1]] || null
  const v = last[2].trim()
  if (/^[rbfu]?["']/.test(v) || /^str\(/.test(v) || /^input\(/.test(v) || /\.(join|upper|lower|strip|replace|format)\(/.test(v)) return 'str'
  if (/^\[/.test(v) || /^list\(/.test(v) || /\.split\(/.test(v) || /^sorted\(/.test(v)) return 'list'
  if (/^\{\s*(\}|[^}]*:)/.test(v) || /^dict\(/.test(v)) return 'dict'
  return null
}

let globalCache = null
function globals() {
  if (globalCache) return globalCache
  globalCache = [
    ...PY_KEYWORDS.map(k => ({ label: k, type: 'keyword', boost: -1 })),
    ...entryItems(PY_BUILTINS, '').map(i => ({ ...i, boost: ['print', 'input', 'len', 'range', 'int', 'str'].includes(i.label) ? 4 : 0 })),
    ...Object.keys(PY_MODULES).map(m => ({ label: m, type: 'namespace', detail: 'モジュール', boost: -2 })),
    ...PY_SNIPPETS.map(s => snippetCompletion(s.body.replace(/\t/g, '    '), { label: s.label, detail: s.detail, type: 'snippet', boost: -1 })),
  ]
  return globalCache
}

export function pythonCompletionSource(context) {
  const { state, pos } = context
  const node = syntaxTree(state).resolveInner(pos, -1)
  if (/String|Comment/.test(node.name)) return null
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const text = state.doc.sliceString(0, Math.min(state.doc.length, 200000))
  // import 文
  let m = /^\s*(?:import|from)\s+([\w.]*)$/.exec(before)
  if (m) return { from: pos - m[1].length, options: Object.keys(PY_MODULES).map(k => ({ label: k, type: 'namespace' })), validFor: /^[\w.]*$/ }
  m = /^\s*from\s+(\w+)\s+import\s+(?:.*,\s*)?(\w*)$/.exec(before)
  if (m && PY_MODULES[m[1]]) return { from: pos - m[2].length, options: entryItems(PY_MODULES[m[1]], m[1] + '.'), validFor: /^\w*$/ }
  // メンバー
  m = /([\w)\]"']+)\.(\w*)$/.exec(before)
  if (m) {
    const obj = m[1]
    const typed = m[2]
    const from = pos - typed.length
    const imp = imports(text)
    const modName = imp.get(obj) || (PY_MODULES[obj] ? obj : null)
    if (modName && PY_MODULES[modName.split('.')[0]]) return { from, options: entryItems(PY_MODULES[modName.split('.')[0]], modName + '.'), validFor: /^\w*$/ }
    if (/["']$/.test(obj)) return { from, options: methodItems(PY_STR_METHODS), validFor: /^\w*$/ }
    if (/\]$/.test(obj)) return { from, options: methodItems(PY_LIST_METHODS), validFor: /^\w*$/ }
    const kind = /^\w+$/.test(obj) ? varKind(text, obj) : null
    if (kind === 'str') return { from, options: methodItems(PY_STR_METHODS), validFor: /^\w*$/ }
    if (kind === 'list') return { from, options: methodItems(PY_LIST_METHODS), validFor: /^\w*$/ }
    if (kind === 'dict') return { from, options: methodItems(PY_DICT_METHODS), validFor: /^\w*$/ }
    // 不明: ドキュメント内の単語 + よく使うメソッド
    const words = docWords(text, typed)
    return { from, options: [...words, ...methodItems([...PY_STR_METHODS, ...PY_LIST_METHODS, ...PY_DICT_METHODS]).map(i => ({ ...i, boost: -10 }))], validFor: /^\w*$/ }
  }
  const word = context.matchBefore(/[A-Za-z_]\w*/)
  if (!word && !context.explicit) return null
  if (word && word.from === word.to && !context.explicit) return null
  return { from: word ? word.from : pos, options: [...globals(), ...docWords(text, word ? word.text : '')], validFor: /^\w*$/ }
}

function docWords(text, exclude) {
  const set = new Set()
  const re = /[A-Za-z_]\w{2,}/g
  let m
  while ((m = re.exec(text))) set.add(m[0])
  set.delete(exclude)
  const kw = new Set(PY_KEYWORDS)
  return [...set].filter(w => !kw.has(w)).map(w => ({ label: w, type: 'text', boost: -5 }))
}

export function describePython(state, pos) {
  const w = state.wordAt(pos)
  if (!w) return null
  const name = state.sliceDoc(w.from, w.to)
  const line = state.doc.lineAt(w.from)
  const before = line.text.slice(0, w.from - line.from)
  const dm = /(\w+)\.$/.exec(before)
  if (dm) {
    const imp = imports(state.doc.toString())
    const mod = (imp.get(dm[1]) || dm[1]).split('.')[0]
    const e = PY_MODULES[mod] && PY_MODULES[mod][name]
    if (e) return { from: w.from, to: w.to, title: `${mod}.${name}${e.kind === 'function' ? e.sig : ': ' + e.type}`, doc: e.doc }
    return null
  }
  const e = PY_BUILTINS[name]
  if (e) return { from: w.from, to: w.to, title: name + (e.kind === 'function' ? e.sig : ''), doc: e.doc }
  if (PY_MODULES[name]) return { from: w.from, to: w.to, title: `(モジュール) ${name}`, doc: Object.keys(PY_MODULES[name]).slice(0, 14).join(', ') }
  return null
}

export function pythonSignatureAt(state, pos) {
  const start = Math.max(0, pos - 1500)
  const text = state.doc.sliceString(start, pos)
  let depth = 0, commas = 0, i
  for (i = text.length - 1; i >= 0; i--) {
    const c = text[i]
    if (c === ')' || c === ']' || c === '}') depth++
    else if (c === '[' || c === '{') { if (depth === 0) return null; depth-- }
    else if (c === '(') { if (depth === 0) break; depth-- }
    else if (c === ',' && depth === 0) commas++
  }
  if (i < 0) return null
  const m = /([\w.]+)\s*$/.exec(text.slice(0, i))
  if (!m) return null
  const parts = m[1].split('.')
  let e
  if (parts.length === 1) e = PY_BUILTINS[parts[0]]
  else {
    const imp = imports(state.doc.toString())
    const mod = (imp.get(parts[0]) || parts[0]).split('.')[0]
    e = PY_MODULES[mod] && PY_MODULES[mod][parts[1]]
  }
  if (!e || !e.sig) return null
  const inner = e.sig.slice(1, e.sig.lastIndexOf(')'))
  const params = inner ? inner.split(',').map(p => ({ name: p.trim(), type: '' })) : []
  return { label: m[1], params, active: Math.min(commas, Math.max(0, params.length - 1)), ret: e.sig.includes('): ') ? e.sig.slice(e.sig.lastIndexOf('): ') + 3) : null, doc: e.doc }
}

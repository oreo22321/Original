// Python のコードを直すための小さな道具 (エディタと Forge AI で共通。画面には触りません)
// ・全角記号 → 半角 (文字列とコメントの中はそのまま)
// ・近い名前 (定義されていない名前の「もしかして」)
// ・よくある打ち間違い (pirnt → print など)

export const STDLIB = new Set(['os', 'sys', 'math', 'random', 'time', 'datetime', 'json', 're', 'collections', 'itertools', 'functools', 'pathlib', 'string', 'statistics', 'decimal', 'fractions', 'typing', 'dataclasses', 'enum', 'csv', 'io', 'copy', 'heapq', 'bisect', 'textwrap', 'unicodedata', 'calendar', 'operator', 'pprint', 'secrets', 'hashlib', 'base64', 'uuid', 'struct', 'array', 'glob', 'shutil', 'tempfile', 'zipfile', 'sqlite3', 'logging', 'argparse', 'asyncio', 'threading', 'urllib', 'html', 'xml', 'numpy', 'pandas'])
export const ALIASES = { np: 'import numpy as np', pd: 'import pandas as pd', plt: 'import matplotlib.pyplot as plt' }

export const FULLWIDTH = { '（': '(', '）': ')', '［': '[', '］': ']', '｛': '{', '｝': '}', '：': ':', '；': ';', '，': ',', '．': '.', '＝': '=', '＋': '+', '－': '-', '＊': '*', '／': '/', '＜': '<', '＞': '>', '＂': '"', '＇': "'", '＃': '#', '　': ' ', '！': '!', '＆': '&', '｜': '|', '％': '%', '＿': '_', '＠': '@', '“': '"', '”': '"', '‘': "'", '’': "'" }

// 文字列・コメントの外にある全角記号を半角にする
export function fixFullwidth(text) {
  let out = '', q = null, i = 0
  while (i < text.length) {
    const c = text[i]
    if (q) {
      if (c === '\\') { out += c + (text[i + 1] || ''); i += 2; continue }
      if (text.startsWith(q, i)) { out += q; i += q.length; q = null; continue }
      if (c === '\n' && q.length === 1) q = null
      out += c
      i++
      continue
    }
    if (c === '#') { const e = text.indexOf('\n', i); const end = e < 0 ? text.length : e; out += text.slice(i, end); i = end; continue }
    if (c === '"' || c === "'") { q = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c; out += q; i += q.length; continue }
    out += FULLWIDTH[c] !== undefined ? FULLWIDTH[c] : c
    i++
  }
  return out
}

// 編集距離 (入れ替えも 1 と数える。max を超えたら打ち切り)
export function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let pp = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1)
      cur[j] = v
      if (v < best) best = v
    }
    if (best > max) return max + 1
    pp = prev
    prev = cur
  }
  return prev[b.length]
}
export const BUILTINS = ['print', 'input', 'len', 'range', 'int', 'float', 'str', 'bool', 'list', 'dict', 'set', 'tuple', 'sum', 'min', 'max', 'abs', 'round', 'sorted', 'reversed', 'enumerate', 'zip', 'map', 'filter', 'open', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr', 'any', 'all', 'chr', 'ord', 'format', 'repr', 'divmod', 'pow', 'iter', 'next', 'super', 'object', 'property', 'staticmethod', 'classmethod', 'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError', 'ZeroDivisionError', 'RuntimeError', 'StopIteration', 'True', 'False', 'None', 'self']
// 定義されていない名前に近い名前 (同じファイルで定義した名前・組み込み関数)
export function similarNames(name, code) {
  const names = new Set(BUILTINS)
  const re = /\b(?:def|class)\s+([A-Za-z_]\w*)|^[ \t]*([A-Za-z_]\w*)[ \t]*(?::[^=\n]*)?=(?!=)|\bfor\s+([A-Za-z_]\w*)|\bimport\s+([A-Za-z_]\w*)|\bas\s+([A-Za-z_]\w*)/gm
  for (const m of code.matchAll(re)) { const v = m.slice(1).find(Boolean); if (v) names.add(v) }
  // 関数の引数
  for (const m of code.matchAll(/\bdef\s+\w+\s*\(([^)]*)\)/g)) for (const p of m[1].split(',')) { const v = /^\s*\**([A-Za-z_]\w*)/.exec(p); if (v) names.add(v[1]) }
  names.delete(name)
  const limit = name.length <= 3 ? 1 : name.length <= 6 ? 2 : 3
  const lower = name.toLowerCase()
  return [...names]
    .map(c => [c, c.toLowerCase() === lower ? 0.5 : editDistance(name, c, limit)])
    .filter(([, dist]) => dist <= limit)
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length)
    .slice(0, 3)
    .map(([c]) => c)
}

export const TYPOS = {
  pirnt: 'print', pritn: 'print', prnit: 'print', prnt: 'print', rpint: 'print', pinrt: 'print',
  improt: 'import', imoprt: 'import', ipmort: 'import', imprt: 'import', iport: 'import',
  retrun: 'return', reutrn: 'return', retunr: 'return', retur: 'return', reurn: 'return',
  esle: 'else', eles: 'else', elsf: 'elif', elfi: 'elif', eilf: 'elif', esif: 'elif', elsif: 'elif', elseif: 'elif',
  whiel: 'while', wihle: 'while', whlie: 'while', hwile: 'while',
  calss: 'class', clas: 'class', clsas: 'class',
  slef: 'self', sefl: 'self',
  ture: 'True', Ture: 'True', treu: 'True', Treu: 'True', true: 'True',
  flase: 'False', Flase: 'False', fasle: 'False', Fasle: 'False', false: 'False',
  none: 'None', Noen: 'None', nul: 'None', null: 'None',
  contiune: 'continue', conitnue: 'continue', continu: 'continue',
  braek: 'break', brak: 'break', breka: 'break',
  lamda: 'lambda', lamba: 'lambda', yeild: 'yield', asert: 'assert',
  excpet: 'except', exept: 'except', finaly: 'finally', finnally: 'finally',
  raies: 'raise', rasie: 'raise', gloabl: 'global', nonlocla: 'nonlocal',
  rnage: 'range', ragne: 'range', rang: 'range', inptu: 'input', inupt: 'input', inpt: 'input', lne: 'len',
  enumarate: 'enumerate', enumrate: 'enumerate', isinstnace: 'isinstance', srt: 'str',
}

// ANSI エスケープシーケンス (文字の色・太字など) を画面の飾りにする
// ・色は VS Code のターミナルと同じ (css の --ansi-0 〜 --ansi-15。256 色・フルカラーにも対応)
// ・print("\033[31m赤\033[0m") や colorama・rich などの出力がそのまま色付きで見える
// ・画面の消去 (\033[2J) と行の消去 (\033[K) は、呼び出し側に知らせる
const ESC = '\x1b'
const SEQ = /\x1b\[([0-9;:?]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[()][A-Za-z0-9]|\x1b[=>78DEHMNOc]/g

export const hasAnsi = s => typeof s === 'string' && s.indexOf(ESC) >= 0
export function stripAnsi(s) { return hasAnsi(s) ? s.replace(SEQ, '') : s }

export class AnsiState {
  constructor() { this.reset() }
  reset() { this.fg = null; this.bg = null; this.bold = false; this.dim = false; this.italic = false; this.under = false; this.inverse = false; this.strike = false; this.hidden = false }
  get plain() { return this.fg === null && this.bg === null && !this.bold && !this.dim && !this.italic && !this.under && !this.inverse && !this.strike && !this.hidden }
}

// 256 色の表 (16〜255)
function color256(n) {
  if (n < 16) return n
  if (n < 232) {
    n -= 16
    const v = x => (x ? x * 40 + 55 : 0)
    return `rgb(${v(Math.floor(n / 36))},${v(Math.floor(n / 6) % 6)},${v(n % 6)})`
  }
  const g = (n - 232) * 10 + 8
  return `rgb(${g},${g},${g})`
}

function sgr(st, params) {
  const p = params === '' ? [0] : params.split(/[;:]/).map(x => (x === '' ? 0 : Number(x)))
  for (let i = 0; i < p.length; i++) {
    const n = p[i]
    if (n === 0) st.reset()
    else if (n === 1) st.bold = true
    else if (n === 2) st.dim = true
    else if (n === 3) st.italic = true
    else if (n === 4) st.under = true
    else if (n === 7) st.inverse = true
    else if (n === 8) st.hidden = true
    else if (n === 9) st.strike = true
    else if (n === 21 || n === 22) { st.bold = false; st.dim = false }
    else if (n === 23) st.italic = false
    else if (n === 24) st.under = false
    else if (n === 27) st.inverse = false
    else if (n === 28) st.hidden = false
    else if (n === 29) st.strike = false
    else if (n >= 30 && n <= 37) st.fg = n - 30
    else if (n === 39) st.fg = null
    else if (n >= 40 && n <= 47) st.bg = n - 40
    else if (n === 49) st.bg = null
    else if (n >= 90 && n <= 97) st.fg = n - 90 + 8
    else if (n >= 100 && n <= 107) st.bg = n - 100 + 8
    else if (n === 38 || n === 48) {
      let c = null
      if (p[i + 1] === 5) { c = color256(p[i + 2] || 0); i += 2 }
      else if (p[i + 1] === 2) { c = `rgb(${p[i + 2] || 0},${p[i + 3] || 0},${p[i + 4] || 0})`; i += 4 }
      if (n === 38) st.fg = c; else st.bg = c
    }
  }
}

function piece(text, st) {
  if (st.plain) return document.createTextNode(text)
  const el = document.createElement('span')
  const cls = []
  let fg = st.fg, bg = st.bg
  if (st.inverse) { const t = fg; fg = bg === null ? 'inv-fg' : bg; bg = t === null ? 'inv-bg' : t }
  // 太字の基本 8 色は明るい色で表示 (VS Code と同じ)
  if (st.bold && typeof fg === 'number' && fg < 8) fg += 8
  if (typeof fg === 'number') cls.push('af' + fg)
  else if (fg === 'inv-fg') cls.push('af-inv')
  else if (fg) el.style.color = fg
  if (typeof bg === 'number') cls.push('ab' + bg)
  else if (bg === 'inv-bg') cls.push('ab-inv')
  else if (bg) el.style.background = bg
  if (st.bold) cls.push('a-b')
  if (st.dim) cls.push('a-d')
  if (st.italic) cls.push('a-i')
  if (st.under) cls.push('a-u')
  if (st.strike) cls.push('a-s')
  if (st.hidden) cls.push('a-h')
  el.className = cls.join(' ')
  el.textContent = text
  return el
}

// text を飾りつきで parent に足す。onCtl(cmd, params, parent): 色以外の命令 (J = 画面の消去, K = 行の消去 など)
// onCtl が要素を返したら、そのあとの文字はその要素に足す (画面を消した後の新しい行など)
export function appendAnsi(parent, text, st, onCtl) {
  if (!hasAnsi(text)) { if (text) parent.append(st.plain ? text : piece(text, st)); return }
  const re = new RegExp(SEQ.source, 'g')
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(piece(text.slice(last, m.index), st))
    last = re.lastIndex
    if (m[2] === 'm') sgr(st, m[1])
    else if (m[2] && onCtl) { const np = onCtl(m[2], m[1], parent); if (np) parent = np }
  }
  if (last < text.length) parent.append(piece(text.slice(last), st))
}

// 小さな Markdown レンダラー (プレビュー / AI の回答表示用)
import { escapeHtml } from './ui.js'

// images: false のときは画像を読み込まず、リンクとして表示します
// (AI の回答に含まれる画像 URL を自動で読み込むと、URL に埋め込まれた情報が外部へ送られる恐れがあるため)
function inlineFmt(s, opts = {}) {
  let t = escapeHtml(s)
  const codes = []
  t = t.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
    if (opts.images === false) return /^https?:/.test(src) ? `<a href="${src}" target="_blank" rel="noopener noreferrer">[画像: ${alt || 'リンク'}]</a>` : `[画像: ${alt}]`
    return /^(https?:|data:image\/)/.test(src) ? `<img alt="${alt}" src="${src}">` : m
  })
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => /^(https?:|#|mailto:)/.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : text)
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  t = t.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[i]}</code>`)
  return t
}

export function renderMarkdown(src, { codeBlock, images } = {}) {
  const inline = s => inlineFmt(s, { images })
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  let out = ''
  let i = 0
  let para = []
  const flush = () => { if (para.length) { out += `<p>${inline(para.join(' '))}</p>`; para = [] } }
  while (i < lines.length) {
    const line = lines[i]
    let m
    if ((m = /^(\s*)```\s*([\w+-]*)/.exec(line))) {
      flush()
      const lang = m[2]
      const code = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      i++
      const text = code.join('\n')
      out += codeBlock ? codeBlock(text, lang) : `<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(text)}</code></pre>`
      continue
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out += '<hr>'; i++; continue }
    if (/^\s*>/.test(line)) {
      flush()
      const q = []
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
      out += `<blockquote>${renderMarkdown(q.join('\n'), { images })}</blockquote>`
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush()
      const ordered = /^\s*\d/.test(line)
      out += ordered ? '<ol>' : '<ul>'
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')
        const cb = /^\[( |x)\]\s+/.exec(item)
        if (cb) item = `<input type="checkbox" disabled ${cb[1] === 'x' ? 'checked' : ''}> ` + inline(item.slice(cb[0].length))
        else item = inline(item)
        out += `<li>${item}</li>`
        i++
      }
      out += ordered ? '</ol>' : '</ul>'
      continue
    }
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush()
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      out += '<table><thead><tr>' + cells(line).map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
      i += 2
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        out += '<tr>' + cells(lines[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'
        i++
      }
      out += '</tbody></table>'
      continue
    }
    if (!line.trim()) { flush(); i++; continue }
    para.push(line.trim())
    i++
  }
  flush()
  return out
}

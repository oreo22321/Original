// ターミナルのコマンド: 文字の処理 (echo・printf・sort・sed・diff など)
// (this はシェル。ctx は print / err / stdin / cols など)
import { C, bre, diffLines, escapes, expandSet, getopts, inputs, lines, parseSubst, sedRepl } from './util.js'

export default {
  // ---- 文字 ----
  echo(args, ctx) {
    let nl = true, esc = false
    while (args.length && /^-[neE]+$/.test(args[0])) { const a = args.shift(); if (a.includes('n')) nl = false; if (a.includes('e')) esc = true; if (a.includes('E')) esc = false }
    const s = args.join(' ')
    ctx.out((esc ? escapes(s) : s) + (nl ? '\n' : ''))
    return 0
  },
  printf(args, ctx) {
    if (!args.length) { ctx.err('printf: 書式を書いてください (例: printf "%s さん\\n" 太郎)\n'); return 1 }
    const fmt = escapes(args[0])
    const vals = args.slice(1)
    let k = 0, out = ''
    do {
      out += fmt.replace(/%([-+0 #]*)(\d*)(?:\.(\d+))?([sdifxXoc%])/g, (m, flags, width, prec, c) => {
        if (c === '%') return '%'
        const v = vals[k++] ?? ''
        let s
        if (c === 's') s = prec ? String(v).slice(0, Number(prec)) : String(v)
        else if (c === 'd' || c === 'i') s = String(Math.trunc(Number(v) || 0))
        else if (c === 'f') s = (Number(v) || 0).toFixed(prec ? Number(prec) : 6)
        else if (c === 'x') s = (Number(v) || 0).toString(16)
        else if (c === 'X') s = (Number(v) || 0).toString(16).toUpperCase()
        else if (c === 'o') s = (Number(v) || 0).toString(8)
        else s = String(v)[0] || ''
        if (flags.includes('+') && /[dif]/.test(c) && Number(v) >= 0) s = '+' + s
        const w = Number(width || 0)
        if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : s.padStart(w, flags.includes('0') && /[difxXo]/.test(c) ? '0' : ' ')
        return s
      })
    } while (k < vals.length && /%[^%]/.test(fmt))
    ctx.out(out)
    return 0
  },
  async sort(args, ctx) {
    const { o, rest } = getopts(args, 'rnufbV', 'kt')
    const all = []
    let status = 0
    for (const it of await inputs(this, rest, ctx, 'sort')) { if (!it) { status = 1; continue } all.push(...lines(it.text)) }
    const key = l => {
      if (!o.k) return l
      const f = l.split(o.t !== undefined ? o.t : /\s+/)
      return f[Number(String(o.k).split(',')[0]) - 1] ?? ''
    }
    const cmp = o.n ? (a, b) => (parseFloat(key(a)) || 0) - (parseFloat(key(b)) || 0) : o.f ? (a, b) => key(a).toLowerCase().localeCompare(key(b).toLowerCase()) : (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
    let out = all.sort(cmp)
    if (o.r) out.reverse()
    if (o.u) out = out.filter((l, k) => !k || cmp(l, out[k - 1]) !== 0)
    if (out.length) ctx.out(out.join('\n') + '\n')
    return status
  },
  async uniq(args, ctx) {
    const { o, rest } = getopts(args, 'cdui')
    const it = (await inputs(this, rest.slice(0, 1), ctx, 'uniq'))[0]
    if (!it) return 1
    const groups = []
    for (const l of lines(it.text)) {
      const last = groups[groups.length - 1]
      if (last && (o.i ? last[0].toLowerCase() === l.toLowerCase() : last[0] === l)) last[1]++
      else groups.push([l, 1])
    }
    const out = groups.filter(([, n]) => (o.d ? n > 1 : o.u ? n === 1 : true)).map(([l, n]) => (o.c ? String(n).padStart(7) + ' ' + l : l))
    if (out.length) ctx.out(out.join('\n') + '\n')
    return 0
  },
  async cut(args, ctx) {
    const { o, rest } = getopts(args, 's', 'dfc')
    const pick = spec => {
      const set = []
      for (const part of String(spec).split(',')) {
        const m = /^(\d*)-(\d*)$/.exec(part)
        if (m) set.push([m[1] ? Number(m[1]) : 1, m[2] ? Number(m[2]) : Infinity])
        else set.push([Number(part), Number(part)])
      }
      return k => set.some(([a, b]) => k >= a && k <= b)
    }
    if (!o.f && !o.c) { ctx.err('cut: -f (列) か -c (文字の位置) を書いてください (例: cut -d , -f 1)\n'); return 1 }
    const it = (await inputs(this, rest, ctx, 'cut'))[0]
    if (!it) return 1
    const d = o.d === undefined ? '\t' : o.d
    const out = []
    for (const l of lines(it.text)) {
      if (o.c) { const sel = pick(o.c); out.push([...l].filter((_, k) => sel(k + 1)).join('')); continue }
      if (!l.includes(d)) { if (!o.s) out.push(l); continue }
      const sel = pick(o.f)
      out.push(l.split(d).filter((_, k) => sel(k + 1)).join(d))
    }
    if (out.length) ctx.out(out.join('\n') + '\n')
    return 0
  },
  tr(args, ctx) {
    const { o, rest } = getopts(args, 'ds')
    const a = expandSet(rest[0] || ''), b = expandSet(rest[1] || '')
    const text = ctx.stdin ?? ''
    let out = ''
    for (const ch of text) {
      const k = a.indexOf(ch)
      if (k < 0) { out += ch; continue }
      if (o.d) continue
      out += b ? b[Math.min(k, b.length - 1)] : ch
    }
    if (o.s && b) out = out.replace(new RegExp(`([${b.replace(/[\]\\^-]/g, '\\$&')}])\\1+`, 'g'), '$1')
    ctx.out(out)
    return 0
  },
  async sed(args, ctx) {
    const { o, rest } = getopts(args, 'inE', 'e')
    const script = o.e ?? rest.shift()
    if (!script) { ctx.err('sed: 置き換えを書いてください (例: sed "s/old/new/g" file.py)\n'); return 1 }
    const cmds = []
    for (const part of script.split(/;(?=\s*(?:s|\d|\/|\$))/)) {
      const s = part.trim()
      let m
      const sub = parseSubst(s)
      if (sub) {
        let re
        try { re = new RegExp(o.E ? sub.re : bre(sub.re), (sub.flags.includes('g') ? 'g' : '') + (sub.flags.includes('i') ? 'i' : '')) } catch (e) { ctx.err(`sed: 正規表現が正しくありません: ${e.message}\n`); return 1 }
        cmds.push({ kind: 's', re, rep: sedRepl(sub.rep), print: sub.flags.includes('p') })
      } else if ((m = /^(\d+|\$)?(?:,(\d+|\$))?([dp])$/.exec(s))) cmds.push({ kind: m[3], from: m[1], to: m[2] })
      else if ((m = /^\/(.*)\/([dp])$/.exec(s))) cmds.push({ kind: m[2], re: new RegExp(m[1]) })
      else { ctx.err(`sed: ${s} は使えません (s/前/後/g・数字d・/文字/d が使えます)\n`); return 1 }
    }
    const apply = text => {
      const ls = text.split('\n')
      const tailNl = text.endsWith('\n')
      if (tailNl) ls.pop()
      const out = []
      ls.forEach((l, k) => {
        const n = k + 1
        let del = false, printed = false
        const inRange = c => {
          if (c.re) return c.re.test(l)
          const last = ls.length
          const a = c.from === '$' ? last : c.from ? Number(c.from) : null
          const b = c.to === '$' ? last : c.to ? Number(c.to) : a
          return a === null ? true : n >= a && n <= b
        }
        for (const c of cmds) {
          if (c.kind === 's') { const nl = l.replace(c.re, c.rep); if (nl !== l && c.print) printed = true; l = nl }
          else if (c.kind === 'd' && inRange(c)) { del = true; break }
          else if (c.kind === 'p' && inRange(c)) out.push(l)
        }
        if (printed && o.n) out.push(l)
        if (!del && !o.n) out.push(l)
      })
      return out.join('\n') + (tailNl && out.length ? '\n' : '')
    }
    if (o.i) {
      if (!rest.length) { ctx.err('sed -i: 書き換えるファイルを書いてください\n'); return 1 }
      for (const f of rest) {
        const t = await this.readText(f)
        if (t === null) { ctx.err(`sed: ${f}: ファイルがありません\n`); return 1 }
        await this.writeText(f, apply(t))
      }
      return 0
    }
    let status = 0
    for (const it of await inputs(this, rest, ctx, 'sed')) { if (!it) { status = 1; continue } ctx.out(apply(it.text)) }
    return status
  },
  async tee(args, ctx) {
    const { o, rest } = getopts(args, 'a')
    const text = ctx.stdin ?? ''
    for (const f of rest) {
      const before = o.a ? (await this.readText(f)) || '' : ''
      await this.writeText(f, before + text)
    }
    ctx.out(text)
    return 0
  },
  seq(args, ctx) {
    const nums = args.filter(a => !/^-[a-z]/.test(a)).map(Number)
    if (!nums.length || nums.some(isNaN)) { ctx.err('seq: 数を書いてください (例: seq 1 10)\n'); return 1 }
    const [first, step, last] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums
    if (!step) { ctx.err('seq: 増やす数が 0 です\n'); return 1 }
    const out = []
    for (let x = first; step > 0 ? x <= last : x >= last; x += step) { out.push(String(Math.round(x * 1e10) / 1e10)); if (out.length > 1e6) break }
    if (out.length) ctx.out(out.join('\n') + '\n')
    return 0
  },
  async diff(args, ctx) {
    const { rest } = getopts(args, 'uq')
    if (rest.length !== 2) { ctx.err('diff: 2 つのファイルを書いてください (例: diff a.py b.py)\n'); return 2 }
    const [a, b] = await Promise.all(rest.map(f => this.readText(f)))
    if (a === null || b === null) { ctx.err(`diff: ${a === null ? rest[0] : rest[1]}: ファイルがありません\n`); return 2 }
    if (a === b) return 0
    const ops = diffLines(lines(a), lines(b))
    if (!ops) { ctx.print(`ファイル ${rest[0]} と ${rest[1]} は違います (大きすぎて差分を出せません)`); return 1 }
    const col = ctx.tty
    ctx.print(`${col ? C.bold : ''}--- ${rest[0]}\n+++ ${rest[1]}${col ? C.reset : ''}`)
    // 変わったところと前後 3 行だけ
    const keep = new Set()
    ops.forEach((op, k) => { if (op[0] !== ' ') for (let d = -3; d <= 3; d++) keep.add(k + d) })
    let lastK = -2
    ops.forEach((op, k) => {
      if (!keep.has(k)) return
      if (k !== lastK + 1) ctx.print(`${col ? C.cyan : ''}@@ ${op[2] + 1} 行目付近 @@${col ? C.reset : ''}`)
      lastK = k
      const c = op[0] === '-' ? C.red : op[0] === '+' ? C.green : ''
      ctx.print((col && c ? c : '') + op[0] + op[1] + (col && c ? C.reset : ''))
    })
    return 1
  },
}

// ターミナルのコマンド: ファイル (場所・一覧・中身・作る・消す・動かす) と help
// (this はシェル。ctx は print / err / stdin / cols など)
import { C, baseName, bre, columns, dirName, getopts, globRe, human, inputs, lines, nameColor, shortDate, showPath, strWidth } from './util.js'
import { HELP } from './help.js'

export default {
  async help(args, ctx) {
    if (args[0]) {
      const name = this.aliases[args[0]] && !this.hasCmd(args[0]) ? this.aliases[args[0]].split(' ')[0] : args[0]
      for (const [, rows] of HELP) for (const [u, d] of rows) if (u.split(/[\s/]+/).includes(name)) { ctx.print(`${C.bold}${u}${C.reset}\n  ${d}`); return 0 }
      ctx.err(`help: ${args[0]} の説明はありません\n`)
      return 1
    }
    ctx.print(`${C.bold}ForgeCode ターミナル${C.reset} ${C.gray}— ~ はプロジェクトの一番上です。Tab で補完、↑↓ で前のコマンド、Ctrl+C で止める${C.reset}`)
    for (const [title, rows] of HELP) {
      ctx.print(`\n${C.byellow}${title}${C.reset}`)
      const w = Math.min(34, Math.max(...rows.map(r => strWidth(r[0]))))
      for (const [u, d] of rows) {
        if (ctx.cols < 60) ctx.print(`  ${C.cyan}${u}${C.reset}\n      ${C.gray}${d}${C.reset}`)
        else ctx.print(`  ${C.cyan}${u}${C.reset}${' '.repeat(Math.max(1, w - strWidth(u) + 2))}${C.gray}${d}${C.reset}`)
      }
    }
    ctx.print(`\n${C.gray}パイプ (|)・リダイレクト (> >> <)・&& || ;・$変数・$(コマンド)・* ? も使えます${C.reset}`)
    return 0
  },
  man(args, ctx) { return this.callCmd('help', args, ctx) },

  // ---- 場所 ----
  pwd(args, ctx) { ctx.print(showPath(this.cwd)); return 0 },
  cd(args, ctx) {
    let target = args[0]
    if (target === '-') { target = '/' + this.oldCwd; ctx.print(showPath(this.oldCwd)) }
    const p = target === undefined ? '' : this.resolve(target)
    if (!this.isDir(p)) {
      ctx.err(this.isFile(p) ? `cd: ${target}: フォルダではありません\n` : `cd: ${target}: そのフォルダはありません\n`)
      return 1
    }
    this.oldCwd = this.cwd
    this.cwd = p
    return 0
  },

  // ---- 一覧 ----
  ls(args, ctx) {
    const { o, rest } = getopts(args, 'laAhR1Ft')
    const all = o.a || o.A
    let status = 0
    const files = [], dirs = []
    for (const t of rest.length ? rest : ['.']) {
      const p = this.resolve(t)
      const st = this.stat(p)
      if (!st) { ctx.err(`ls: '${t}' はありません\n`); status = 2; continue }
      if (st.dir) dirs.push([t, p]); else files.push({ name: t, path: p, ...st })
    }
    const show = entries => {
      if (o.t) entries = [...entries].sort((a, b) => b.mtime - a.mtime)
      if (o.l) {
        const sizes = entries.map(e => (e.dir ? '-' : o.h ? human(e.size) : String(e.size)))
        const sw = Math.max(1, ...sizes.map(s => s.length))
        if (entries.length) ctx.print(`${C.gray}合計 ${entries.length}${C.reset}`)
        entries.forEach((e, k) => {
          const col = ctx.tty ? nameColor(e) : ''
          ctx.print(`${e.dir ? 'd' : '-'}rw-r--r--  ${sizes[k].padStart(sw)}  ${shortDate(e.mtime)}  ${col}${e.name}${col ? C.reset : ''}${o.F && e.dir ? '/' : ''}`)
        })
        return
      }
      const names = entries.map(e => e.name + (o.F && e.dir ? '/' : ''))
      if (!ctx.tty || o['1']) { if (names.length) ctx.out(names.join('\n') + '\n'); return }
      ctx.out(columns(names, ctx.cols, k => nameColor(entries[k])))
    }
    if (files.length) show(files)
    const walk = (t, p, head) => {
      if (head) ctx.print(`${t}:`)
      const kids = this.children(p, all)
      show(kids)
      if (o.R) for (const k of kids) if (k.dir) { ctx.print(''); walk(t.replace(/\/$/, '') + '/' + k.name, k.path, true) }
    }
    dirs.forEach(([t, p], k) => {
      if (k || files.length) ctx.print('')
      walk(t, p, files.length > 0 || dirs.length > 1 || o.R)
    })
    return status
  },
  dir(args, ctx) { return this.callCmd('ls', args, ctx) },
  tree(args, ctx) {
    const { o, rest } = getopts(args, 'ad', 'L')
    const max = o.L ? Number(o.L) : Infinity
    const start = rest[0] || '.'
    const root = this.resolve(start)
    if (!this.isDir(root)) { ctx.err(`tree: ${start}: フォルダがありません\n`); return 1 }
    let nd = 0, nf = 0
    ctx.print(`${ctx.tty ? C.bblue : ''}${start}${ctx.tty ? C.reset : ''}`)
    const walk = (p, prefix, depth) => {
      if (depth > max) return
      const kids = this.children(p, o.a).filter(k => !o.d || k.dir)
      kids.forEach((k, idx) => {
        const lastOne = idx === kids.length - 1
        const col = ctx.tty ? nameColor(k) : ''
        ctx.print(`${prefix}${lastOne ? '└── ' : '├── '}${col}${k.name}${col ? C.reset : ''}`)
        if (k.dir) { nd++; walk(k.path, prefix + (lastOne ? '    ' : '│   '), depth + 1) } else nf++
      })
    }
    walk(root, '', 1)
    ctx.print(`\n${nd} 個のフォルダ, ${nf} 個のファイル`)
    return 0
  },
  find(args, ctx) {
    const starts = []
    let k = 0
    while (k < args.length && !args[k].startsWith('-')) starts.push(args[k++])
    if (!starts.length) starts.push('.')
    let name = null, type = null, maxdepth = Infinity, mindepth = 0
    for (; k < args.length; k++) {
      const a = args[k]
      if (a === '-name' || a === '-iname') name = globRe(args[++k] || '*', a === '-iname' ? 'i' : '')
      else if (a === '-type') type = args[++k]
      else if (a === '-maxdepth') maxdepth = Number(args[++k])
      else if (a === '-mindepth') mindepth = Number(args[++k])
      else if (a === '-print') continue
      else { ctx.err(`find: ${a} は使えません (-name / -iname / -type / -maxdepth が使えます)\n`); return 1 }
    }
    let status = 0
    for (const s of starts) {
      const root = this.resolve(s)
      const st = this.stat(root)
      if (!st) { ctx.err(`find: '${s}' はありません\n`); status = 1; continue }
      const base = s.replace(/\/+$/, '') || s
      const visit = (p, shown, isDir, depth) => {
        const okType = !type || (type === 'd' ? isDir : !isDir)
        const okName = !name || name.test(baseName(shown))
        if (depth >= mindepth && okType && okName) ctx.print(shown)
        if (isDir && depth < maxdepth) for (const c of this.children(p, true)) visit(c.path, shown + '/' + c.name, c.dir, depth + 1)
      }
      visit(root, base, st.dir, 0)
    }
    return status
  },

  // ---- 中身 ----
  async cat(args, ctx) {
    const { o, rest } = getopts(args, 'nAbs')
    let status = 0, num = 0
    for (const it of await inputs(this, rest, ctx, 'cat')) {
      if (!it) { status = 1; continue }
      if (o.n || o.b) {
        const ls = it.text.split('\n')
        const tailNl = it.text.endsWith('\n')
        if (tailNl) ls.pop()
        ctx.out(ls.map(l => (o.b && !l ? '' : String(++num).padStart(6) + '\t') + l).join('\n') + (tailNl ? '\n' : ''))
      } else ctx.out(it.text)
    }
    return status
  },
  more(args, ctx) { return this.callCmd('cat', args, ctx) },
  less(args, ctx) { return this.callCmd('cat', args, ctx) },
  async head(args, ctx) {
    const { o, rest } = getopts(args, 'qv', 'nc', { num: 'n' })
    const n = Number(o.n || 10)
    const list = await inputs(this, rest, ctx, 'head')
    let status = 0
    list.forEach((it, k) => {
      if (!it) { status = 1; return }
      if (list.length > 1 && !o.q) ctx.print(`${k ? '\n' : ''}==> ${it.name} <==`)
      if (o.c) { ctx.out(it.text.slice(0, Number(o.c))); return }
      const ls = lines(it.text)
      const pick = n < 0 ? ls.slice(0, n) : ls.slice(0, n)
      if (pick.length) ctx.out(pick.join('\n') + '\n')
    })
    return status
  },
  async tail(args, ctx) {
    const { o, rest } = getopts(args, 'qvf', 'nc', { num: 'n' })
    const spec = String(o.n || 10)
    const list = await inputs(this, rest, ctx, 'tail')
    let status = 0
    list.forEach((it, k) => {
      if (!it) { status = 1; return }
      if (list.length > 1 && !o.q) ctx.print(`${k ? '\n' : ''}==> ${it.name} <==`)
      if (o.c) { ctx.out(it.text.slice(-Number(o.c))); return }
      const ls = lines(it.text)
      const pick = spec.startsWith('+') ? ls.slice(Number(spec.slice(1)) - 1) : ls.slice(Math.max(0, ls.length - Number(spec)))
      if (pick.length) ctx.out(pick.join('\n') + '\n')
    })
    return status
  },
  async wc(args, ctx) {
    const { o, rest } = getopts(args, 'lwcm')
    const all = !o.l && !o.w && !o.c && !o.m
    const rows = []
    let status = 0
    for (const it of await inputs(this, rest, ctx, 'wc')) {
      if (!it) { status = 1; continue }
      rows.push([(it.text.match(/\n/g) || []).length, (it.text.match(/\S+/g) || []).length, o.m ? [...it.text].length : new TextEncoder().encode(it.text).length, it.name === '-' ? '' : it.name])
    }
    if (rows.length > 1) rows.push([rows.reduce((a, r) => a + r[0], 0), rows.reduce((a, r) => a + r[1], 0), rows.reduce((a, r) => a + r[2], 0), '合計'])
    const w = Math.max(...rows.flatMap(r => [r[0], r[1], r[2]]).map(x => String(x).length), rest.length ? 3 : 1)
    for (const r of rows) {
      const cols = []
      if (all || o.l) cols.push(String(r[0]).padStart(w))
      if (all || o.w) cols.push(String(r[1]).padStart(w))
      if (all || o.c || o.m) cols.push(String(r[2]).padStart(w))
      ctx.print((rows.length === 1 && !rest.length && cols.length === 1 ? cols[0].trim() : cols.join(' ')) + (r[3] ? ' ' + r[3] : ''))
    }
    return status
  },
  async grep(args, ctx) {
    const { o, rest } = getopts(args, 'inrRvclLwxEFoHhqs', 'em')
    let pat = o.e
    if (pat === undefined) pat = rest.shift()
    if (pat === undefined) { ctx.err('grep: 探す文字を書いてください (例: grep print main.py)\n'); return 2 }
    let re
    try {
      const src = o.F ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : (o.E ? pat : bre(pat)).replace(/\\([<>])/g, '\\b')
      re = new RegExp(o.x ? `^(?:${src})$` : o.w ? `\\b(?:${src})\\b` : src, 'g' + (o.i ? 'i' : ''))
    } catch (e) { ctx.err(`grep: 正規表現が正しくありません: ${e.message}\n`); return 2 }
    const recursive = o.r || o.R
    let targets = rest
    if (!targets.length && recursive) targets = ['.']
    const list = []
    if (!targets.length) list.push({ name: '(標準入力)', text: ctx.stdin ?? '' })
    for (const t of targets) {
      const p = this.resolve(t)
      if (this.isDir(p)) {
        if (!recursive) { if (!o.s) ctx.err(`grep: ${t}: フォルダです (中も探すなら -r)\n`); continue }
        const walk = (dir, shown) => {
          for (const c of this.children(dir, false)) {
            const sp = shown === '.' ? c.name : shown.replace(/\/$/, '') + '/' + c.name
            if (c.dir) walk(c.path, sp)
            else list.push({ path: c.path, name: sp })
          }
        }
        walk(p, t)
      } else if (this.isFile(p)) list.push({ path: p, name: t })
      else if (!o.s) ctx.err(`grep: ${t}: ファイルがありません\n`)
    }
    const showName = o.H || (!o.h && (list.length > 1 || recursive))
    const color = ctx.tty
    const max = o.m ? Number(o.m) : Infinity
    let found = false
    for (const it of list) {
      const text = it.text ?? (await this.host.read(it.path)) ?? ''
      if (typeof text !== 'string' || text.includes('\0')) continue
      let count = 0
      const ls = lines(text)
      for (let k = 0; k < ls.length && count < max; k++) {
        const l = ls[k]
        re.lastIndex = 0
        const hit = re.test(l)
        if (hit === !!o.v) continue
        count++
        found = true
        if (o.q || o.l || o.L || o.c) continue
        const pre = (showName ? (color ? C.magenta + it.name + C.cyan + ':' + C.reset : it.name + ':') : '') + (o.n ? (color ? C.green + (k + 1) + C.cyan + ':' + C.reset : (k + 1) + ':') : '')
        if (o.o && !o.v) {
          re.lastIndex = 0
          let m
          while ((m = re.exec(l))) { if (!m[0]) { re.lastIndex++; continue } ctx.print(pre + (color ? C.bred + m[0] + C.reset : m[0])) }
          continue
        }
        re.lastIndex = 0
        ctx.print(pre + (color && !o.v ? l.replace(re, m => (m ? C.bred + m + C.reset : m)) : l))
      }
      if (o.c) ctx.print((showName ? (color ? C.magenta + it.name + C.cyan + ':' + C.reset : it.name + ':') : '') + count)
      if (o.l && count) ctx.print(color ? C.magenta + it.name + C.reset : it.name)
      if (o.L && !count) ctx.print(it.name)
      if (o.q && found) return 0
    }
    return found ? 0 : 1
  },

  // ---- 作る・消す・動かす ----
  async touch(args, ctx) {
    if (!args.length) { ctx.err('touch: ファイル名を書いてください\n'); return 1 }
    let status = 0
    for (const a of args.filter(x => !x.startsWith('-'))) {
      const p = this.resolve(a)
      if (this.isDir(p)) continue
      try { await this.writeText(a, this.isFile(p) ? (await this.host.read(p)) ?? '' : '') } catch (e) { ctx.err(`touch: ${e.message}\n`); status = 1 }
    }
    return status
  },
  async mkdir(args, ctx) {
    const { o, rest } = getopts(args, 'pv')
    if (!rest.length) { ctx.err('mkdir: フォルダ名を書いてください\n'); return 1 }
    let status = 0
    for (const a of rest) {
      const p = this.resolve(a)
      if (!p) continue
      if (this.stat(p)) { if (!o.p) { ctx.err(`mkdir: ${a}: もうあります\n`); status = 1 } continue }
      if (!o.p && dirName(p) && !this.isDir(dirName(p))) { ctx.err(`mkdir: ${a}: 上のフォルダがありません (-p を付けるとまとめて作ります)\n`); status = 1; continue }
      await this.fsMkdir(p)
      if (o.v) ctx.print(`フォルダを作りました: ${a}`)
    }
    return status
  },
  async rm(args, ctx) {
    const { o, rest } = getopts(args, 'rRfidv')
    if (!rest.length) { if (!o.f) { ctx.err('rm: 消すファイルを書いてください\n'); return 1 } return 0 }
    let status = 0
    for (const a of rest) {
      const p = this.resolve(a)
      if (!p) { ctx.err('rm: プロジェクト全体は消せません (プロジェクトの削除はプロジェクト一覧から)\n'); status = 1; continue }
      const st = this.stat(p)
      if (!st) { if (!o.f) { ctx.err(`rm: ${a}: ありません\n`); status = 1 } continue }
      if (st.dir && !(o.r || o.R) && !(o.d && !this.children(p, true).length)) { ctx.err(`rm: ${a}: フォルダです (中身ごと消すなら rm -r)\n`); status = 1; continue }
      await this.fsRemove(p)
      if (o.v) ctx.print(`削除しました: ${a}`)
    }
    return status
  },
  async rmdir(args, ctx) {
    let status = 0
    for (const a of args.filter(x => !x.startsWith('-'))) {
      const p = this.resolve(a)
      if (!this.isDir(p) || !p) { ctx.err(`rmdir: ${a}: フォルダではありません\n`); status = 1; continue }
      if (this.children(p, true).length) { ctx.err(`rmdir: ${a}: 空ではありません\n`); status = 1; continue }
      await this.fsRemove(p)
    }
    return status
  },
  async cp(args, ctx) {
    const { o, rest } = getopts(args, 'rRvfn')
    if (rest.length < 2) { ctx.err('cp: コピー元とコピー先を書いてください (例: cp a.py b.py)\n'); return 1 }
    const dest = rest.pop()
    const dp = this.resolve(dest)
    const intoDir = this.isDir(dp)
    if (rest.length > 1 && !intoDir) { ctx.err(`cp: ${dest}: フォルダではありません\n`); return 1 }
    let status = 0
    for (const s of rest) {
      const sp = this.resolve(s)
      const st = this.stat(sp)
      if (!st) { ctx.err(`cp: ${s}: ありません\n`); status = 1; continue }
      const target = intoDir ? (dp ? dp + '/' : '') + baseName(sp) : dp
      if (target === sp || target.startsWith(sp + '/')) { ctx.err(`cp: ${s}: 自分自身の中にはコピーできません\n`); status = 1; continue }
      if (o.n && this.stat(target)) continue
      if (st.dir) {
        if (!(o.r || o.R)) { ctx.err(`cp: ${s}: フォルダです (フォルダごとなら cp -r)\n`); status = 1; continue }
        const all = [...this.index().entries()].filter(([p]) => p.startsWith(sp + '/'))
        await this.fsMkdir(target)
        for (const [p, info] of all) {
          const np = target + p.slice(sp.length)
          if (info.dir) await this.fsMkdir(np)
          else await this.fsWrite(np, (await this.host.read(p)) ?? '')
        }
      } else {
        if (this.isDir(target)) { ctx.err(`cp: ${dest}: フォルダがあります\n`); status = 1; continue }
        await this.fsWrite(target, (await this.host.read(sp)) ?? '')
      }
      if (o.v) ctx.print(`'${s}' → '${showPath(target)}'`)
    }
    return status
  },
  async mv(args, ctx) {
    const { o, rest } = getopts(args, 'vfin')
    if (rest.length < 2) { ctx.err('mv: 移動元と移動先を書いてください (例: mv a.py b.py)\n'); return 1 }
    const dest = rest.pop()
    const dp = this.resolve(dest)
    const intoDir = this.isDir(dp)
    if (rest.length > 1 && !intoDir) { ctx.err(`mv: ${dest}: フォルダではありません\n`); return 1 }
    let status = 0
    for (const s of rest) {
      const sp = this.resolve(s)
      if (!sp || !this.stat(sp)) { ctx.err(`mv: ${s}: ありません\n`); status = 1; continue }
      const target = intoDir ? (dp ? dp + '/' : '') + baseName(sp) : dp
      if (target === sp) continue
      if (target.startsWith(sp + '/')) { ctx.err(`mv: ${s}: 自分自身の中には移動できません\n`); status = 1; continue }
      if (this.stat(target)) {
        if (o.n) continue
        if (this.isDir(target)) { ctx.err(`mv: ${showPath(target)}: もうあります\n`); status = 1; continue }
        await this.fsRemove(target)
      }
      const parent = dirName(target)
      if (parent && !this.isDir(parent)) { ctx.err(`mv: ${dest}: フォルダ ${showPath(parent)} がありません\n`); status = 1; continue }
      await this.fsRename(sp, target)
      if (o.v) ctx.print(`'${s}' → '${showPath(target)}'`)
    }
    return status
  },
}

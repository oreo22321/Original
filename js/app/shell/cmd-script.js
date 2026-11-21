// ターミナルのコマンド: スクリプト・制御と便利なコマンド
// (this はシェル。ctx は print / err / stdin / cols など)
import { bytesToContent, isBin } from '../bin.js'
import { C, Flow, baseName, dirName, getopts, inputs, lines, resolvePath, sleep, strftime } from './util.js'
import { arith, testExpr } from './parse.js'

export default {
  // ---- スクリプト・制御 ----
  test(args) { return testExpr(args, this) ? 0 : 1 },
  '['(args, ctx) {
    if (args[args.length - 1] !== ']') { ctx.err('[: ] がありません\n'); return 2 }
    return testExpr(args.slice(0, -1), this) ? 0 : 1
  },
  '[['(args, ctx) {
    if (args[args.length - 1] !== ']]') { ctx.err('[[: ]] がありません\n'); return 2 }
    return testExpr(args.slice(0, -1), this) ? 0 : 1
  },
  async read(args, ctx) {
    const { o, rest } = getopts(args, 'rs', 'pn')
    let line
    if (ctx.stdinStream) line = ctx.stdinStream.readLine()
    else if (ctx.term && ctx.term.readLine) { if (o.p) ctx.out(o.p); line = await ctx.term.readLine({ password: !!o.s }) }
    else line = null
    if (line === null || line === undefined) return 1
    if (!o.r) line = line.replace(/\\(.)/g, '$1')
    const names = rest.length ? rest : ['REPLY']
    const parts = line.trim().split(/\s+/)
    names.forEach((n, k) => this.setVar(n, k === names.length - 1 ? parts.slice(k).join(' ') : parts[k] ?? ''))
    return 0
  },
  break() { throw new Flow('break') },
  continue() { throw new Flow('continue') },
  return(args) { throw new Flow('return', Number(args[0]) || 0) },
  local(args) {
    const scope = this.locals[this.locals.length - 1]
    for (const a of args) { const m = /^([A-Za-z_]\w*)(?:=(.*))?$/s.exec(a); if (m) { if (scope) scope[m[1]] = m[2] ?? ''; else this.env[m[1]] = m[2] ?? '' } }
    return 0
  },
  shift(args) {
    const top = this.args[this.args.length - 1]
    if (top) top.splice(0, Number(args[0]) || 1)
    return 0
  },
  expr(args, ctx) {
    const v = arith(args.join(' '), n => this.varValue(n))
    ctx.print(String(v))
    return v === 0 ? 1 : 0
  },
  let(args) {
    let v = 0
    for (const a of args) {
      const m = /^([A-Za-z_]\w*)\s*([-+*/%]?)=(.*)$/s.exec(a)
      if (m) { const cur = Number(this.varValue(m[1])) || 0; const val = arith(m[3], n => this.varValue(n)); v = m[2] ? arith(`${cur} ${m[2]} ${val}`, () => 0) : val; this.setVar(m[1], String(v)) }
      else v = arith(a, n => this.varValue(n))
    }
    return v === 0 ? 1 : 0
  },
  async source(args, ctx) {
    if (!args[0]) { ctx.err('source: ファイル名を書いてください\n'); return 2 }
    return this.runScript(args[0], args.slice(1), ctx, { subshell: false })
  },
  '.'(args, ctx) { return this.callCmd('source', args, ctx) },
  async sh(args, ctx) {
    if (args[0] === '-c') {
      const saved = { cwd: this.cwd, env: { ...this.env } }
      try { return await this.run(args[1] || '', { ...ctx.io, out: ctx.out, err: ctx.err, stdin: ctx.stdinStream }) } finally { this.cwd = saved.cwd; this.env = saved.env }
    }
    if (!args[0]) { ctx.err('sh: スクリプトのファイル名を書いてください (例: sh run.sh)\n'); return 2 }
    return this.runScript(args[0], args.slice(1), ctx)
  },
  bash(args, ctx) { return this.callCmd('sh', args, ctx) },
  // ---- 便利なコマンド ----
  async xargs(args, ctx) {
    // オプションは、実行するコマンドの前だけ
    const o = {}
    let k0 = 0
    for (; k0 < args.length && args[k0].startsWith('-'); k0++) {
      const a = args[k0]
      if (a === '-n' || a === '-I') o[a[1]] = args[++k0]
      else if (/^-n\d+$/.test(a)) o.n = a.slice(2)
      else for (const f of a.slice(1)) o[f] = true
    }
    const rest = args.slice(k0)
    const cmd = rest.length ? rest : ['echo']
    const text = ctx.stdin ?? ''
    if (o.I !== undefined) {
      let status = 0
      for (const line of lines(text)) {
        if (!line && o.r) continue
        const argv = cmd.map(a => a.split(o.I).join(line))
        if (o.t) ctx.err(argv.join(' ') + '\n')
        status = await this.exec(argv, { ...ctx }) || status
      }
      return status
    }
    const items = text.split(o['0'] ? '\0' : /\s+/).filter(Boolean)
    if (!items.length && o.r) return 0
    const n = o.n ? Math.max(1, Number(o.n)) : items.length || 1
    let status = 0
    for (let k = 0; k < Math.max(items.length, 1); k += n) {
      const argv = [...cmd, ...items.slice(k, k + n)]
      if (o.t) ctx.err(argv.join(' ') + '\n')
      status = await this.exec(argv, { ...ctx }) || status
    }
    return status
  },
  async watch(args, ctx) {
    const { o, rest } = getopts(args, 't', 'n')
    if (!rest.length) { ctx.err('watch: 繰り返すコマンドを書いてください (例: watch -n 5 ls -l)\n'); return 1 }
    const sec = Math.max(0.5, Number(o.n) || 2)
    const line = rest.join(' ')
    for (;;) {
      if (ctx.term) ctx.term.clear()
      if (!o.t) ctx.print(`${C.gray}${sec} 秒ごと: ${line}    ${strftime('%T', new Date())}  (Ctrl+C で止める)${C.reset}\n`)
      await this.run(line, { ...ctx.io, out: ctx.out, err: ctx.err })
      await sleep(sec * 1000, ctx.signal)
    }
  },
  async zip(args, ctx) {
    const { o, rest } = getopts(args, 'rq')
    if (rest.length < 2) { ctx.err('zip: 作る ZIP と入れるファイルを書いてください (例: zip -r out.zip src)\n'); return 1 }
    const [name, ...srcs] = rest
    const { zipSync } = await import('../../../vendor/fflate.js')
    const obj = {}
    for (const sname of srcs) {
      const p = this.resolve(sname)
      const st = this.stat(p)
      if (!st) { ctx.err(`zip: ${sname}: ありません\n`); continue }
      const add = async (path, rel) => { const c = await this.host.read(path); obj[rel] = isBin(c) ? c : new TextEncoder().encode(c ?? '') }
      if (st.dir) {
        if (!o.r) { ctx.err(`zip: ${sname}: フォルダです (-r を付けてください)\n`); continue }
        for (const [k, info] of this.index()) if (!info.dir && k.startsWith(p ? p + '/' : '')) await add(k, (sname.replace(/\/+$/, '') + '/' + k.slice(p ? p.length + 1 : 0)).replace(/^\.\//, ''))
      } else await add(p, baseName(p))
      if (!o.q) ctx.print(`  追加: ${sname}`)
    }
    await this.fsWrite(this.resolve(name), zipSync(obj, { level: 6 }))
    return 0
  },
  async unzip(args, ctx) {
    const { o, rest } = getopts(args, 'lqo', 'd')
    const name = rest[0]
    if (!name) { ctx.err('unzip: ZIP のファイル名を書いてください\n'); return 1 }
    const data = this.isFile(this.resolve(name)) ? await this.host.read(this.resolve(name)) : null
    if (!isBin(data)) { ctx.err(`unzip: ${name}: ZIP ファイルがありません\n`); return 1 }
    const { unzipSync } = await import('../../../vendor/fflate.js')
    let entries
    try { entries = unzipSync(data) } catch { ctx.err(`unzip: ${name}: ZIP として読めません\n`); return 1 }
    const dest = o.d ? this.resolve(o.d) : this.cwd
    for (const [rel, bytes] of Object.entries(entries)) {
      if (rel.endsWith('/') || rel.startsWith('__MACOSX') || rel.split('/').includes('..')) continue
      if (o.l) { ctx.print(`${String(bytes.length).padStart(9)}  ${rel}`); continue }
      const target = resolvePath(dest, rel)
      if (dirName(target) && !this.isDir(dirName(target))) await this.fsMkdir(dirName(target))
      await this.fsWrite(target, bytesToContent(bytes, rel))
      if (!o.q) ctx.print(`  展開: ${rel}`)
    }
    return 0
  },
  async base64(args, ctx) {
    const { o, rest } = getopts(args, 'dw', '')
    let data
    if (rest[0]) { const p = this.resolve(rest[0]); data = this.isFile(p) ? await this.host.read(p) : null; if (data === null) { ctx.err(`base64: ${rest[0]}: ありません\n`); return 1 } } else data = ctx.stdin ?? ''
    if (o.d) {
      const bin = atob(String(data).replace(/\s+/g, ''))
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
      ctx.out(new TextDecoder().decode(bytes))
      return 0
    }
    const bytes = isBin(data) ? data : new TextEncoder().encode(data)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    ctx.print(btoa(bin).replace(/(.{76})/g, '$1\n').replace(/\n$/, ''))
    return 0
  },
  async sha256sum(args, ctx) {
    const list = args.length ? args : ['-']
    for (const f of list) {
      let data
      if (f === '-') data = ctx.stdin ?? ''
      else { const p = this.resolve(f); data = this.isFile(p) ? await this.host.read(p) : null; if (data === null) { ctx.err(`sha256sum: ${f}: ありません\n`); continue } }
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', isBin(data) ? data : new TextEncoder().encode(data)))
      ctx.print(`${[...d].map(b => b.toString(16).padStart(2, '0')).join('')}  ${f}`)
    }
    return 0
  },
  async nl(args, ctx) {
    const it = (await inputs(this, args.filter(a => !a.startsWith('-')), ctx, 'nl'))[0]
    if (!it) return 1
    let n = 0
    ctx.out(lines(it.text).map(l => (l.trim() ? String(++n).padStart(6) + '\t' + l : '')).join('\n') + '\n')
    return 0
  },
  async rev(args, ctx) {
    const it = (await inputs(this, args, ctx, 'rev'))[0]
    if (!it) return 1
    ctx.out(lines(it.text).map(l => [...l].reverse().join('')).join('\n') + '\n')
    return 0
  },
  async yes(args, ctx) {
    const text = (args.join(' ') || 'y') + '\n'
    for (let k = 0; k < 10000; k++) { ctx.out(text); if (k % 200 === 0) await this.tick(ctx.io) }
    return 0
  },
  async cloud(args, ctx) {
    if (!this.host.cloud) { ctx.err('cloud: この環境では使えません\n'); return 1 }
    return this.host.cloud(args[0] || 'status', args.slice(1), ctx)
  },
}

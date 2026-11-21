// ForgeCode のターミナル: シェル (コマンドの解釈と実行)
// ・bash に近い書き方: パイプ (|)・リダイレクト (> >> < 2> 2>&1 &>)・&& || ;・"…" '…'・$変数・$(コマンド)・* ? [..]・~
// ・ファイルはプロジェクトのファイルです (~ と / はプロジェクトの一番上)
// ・python / pip はアプリの Python (Pyodide) で動きます
// ・画面 (terminal.js) とは切り離してあるので、Node のテストでもそのまま動きます (host を差し替える)
//
// host: {
//   files() → [{ path, dir, size, mtime }]         プロジェクトのファイル (パスは一番上から)
//   read(path) → 中身 | null / write(path, text) / mkdir(path) / remove(path) / rename(from, to) / changed()
//   python({ entry, source, argv, cwd, stdin, out, err, tty, signal, input }) → 終了コード
//   pip(args, ctx) → 終了コード / pyVersion() / open(path, line) / runFile(path) / fetch(url, init)
//   storage() → { usage, quota } / project() → 名前 / command(id) (アプリのコマンド)
// }
import { isBin } from './bin.js'
import { C, Flow, ShellError, Stream, dirName, globRe, hasGlob, resolvePath, showPath, unescapeGlob } from './shell/util.js'
import { arith, lex, parse } from './shell/parse.js'
import FILES from './shell/cmd-files.js'
import TEXT from './shell/cmd-text.js'
import SYS from './shell/cmd-sys.js'
import SCRIPT from './shell/cmd-script.js'
import PYTHON from './shell/cmd-python.js'
import GIT from './shell/cmd-git.js'
export { C, resolvePath, showPath, strWidth, ShellError } from './shell/util.js'
export { lex, parse, arith } from './shell/parse.js'

// コマンドの一覧 (種類ごとのファイルから集める)
const COMMANDS = { ...FILES, ...TEXT, ...SYS, ...SCRIPT, ...PYTHON, ...GIT }
COMMANDS.py = COMMANDS.python
export const COMMAND_NAMES = Object.keys(COMMANDS)
// ============================================================
// シェル
// ============================================================
export class Shell {
  callCmd(name, args, ctx) { return COMMANDS[name].call(this, args, ctx) }
  hasCmd(name) { return Object.prototype.hasOwnProperty.call(COMMANDS, name) }
  constructor(host, { cwd = '', env = {}, aliases = {} } = {}) {
    this.host = host
    this.cwd = cwd
    this.oldCwd = cwd
    this.status = 0
    this.started = Date.now()
    this.env = { USER: 'forge', HOME: '~', SHELL: 'forgesh', LANG: 'ja_JP.UTF-8', TERM: 'xterm-256color', PYTHON: 'python3', ...env }
    this.aliases = { ll: 'ls -l', la: 'ls -a', l: 'ls', py: 'python', python3: 'python', pip3: 'pip', cls: 'clear', ...aliases }
    this.idxCache = null
    this.ov = new Map()
    this.funcs = {}      // 関数
    this.args = []       // 関数・スクリプトの引数 ($1 …)
    this.locals = []     // local で作った変数
    this.loops = 0
    this.scriptName = null
  }

  // ---- ファイルの一覧 (コマンドごとに 1 度だけ作る) ----
  // 変えたファイルは、アプリの一覧に反映されるまで ov (上書き) で覚えておく (mkdir x && cd x がすぐ使えるように)
  index() {
    if (this.idxCache) return this.idxCache
    const map = new Map()
    map.set('', { dir: true, size: 0, mtime: 0 })
    const addParents = (path, mtime) => {
      let p = path
      while (p.includes('/')) { p = dirName(p); if (!map.has(p)) map.set(p, { dir: true, size: 0, mtime }) }
    }
    for (const f of this.host.files()) {
      map.set(f.path, { dir: !!f.dir, size: f.size || 0, mtime: f.mtime || 0 })
      addParents(f.path, f.mtime || 0)
    }
    for (const [p, info] of this.ov) {
      if (info) { map.set(p, info); addParents(p, info.mtime) }
      else map.delete(p)
    }
    this.idxCache = map
    return map
  }
  touchIndex() { this.idxCache = null; this.dirty = true }
  async fsWrite(p, text) {
    await this.host.write(p, text)
    this.ov.set(p, { dir: false, size: text.length, mtime: Date.now() })
    this.touchIndex()
  }
  async fsMkdir(p) {
    await this.host.mkdir(p)
    let q = ''
    for (const part of p.split('/')) { q = q ? q + '/' + part : part; if (!this.isDir(q)) this.ov.set(q, { dir: true, size: 0, mtime: Date.now() }) }
    this.touchIndex()
  }
  async fsRemove(p) {
    const gone = [...this.index().keys()].filter(k => k === p || k.startsWith(p + '/'))
    await this.host.remove(p)
    for (const k of gone) this.ov.set(k, null)
    this.touchIndex()
  }
  async fsRename(a, b) {
    const moved = [...this.index().entries()].filter(([k]) => k === a || k.startsWith(a + '/'))
    await this.host.rename(a, b)
    for (const [k] of moved) this.ov.set(k, null)
    for (const [k, info] of moved) this.ov.set(b + k.slice(a.length), { ...info, mtime: Date.now() })
    this.touchIndex()
  }
  // 変えたことをアプリに知らせて、一覧を読み直してもらう
  async sync() {
    if (!this.dirty) return
    this.dirty = false
    try { await this.host.changed() } catch {}
    this.ov.clear()
    this.idxCache = null
  }
  stat(p) { return this.index().get(p) || null }
  isDir(p) { const s = this.stat(p); return !!(s && s.dir) }
  isFile(p) { const s = this.stat(p); return !!(s && !s.dir) }
  children(dir, all = false) {
    const out = []
    const pre = dir ? dir + '/' : ''
    for (const [p, s] of this.index()) {
      if (!p || !p.startsWith(pre)) continue
      const rest = p.slice(pre.length)
      if (!rest || rest.includes('/')) continue
      if (!all && rest.startsWith('.')) continue
      out.push({ name: rest, path: p, ...s })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  }
  resolve(p) { return resolvePath(this.cwd, p) }
  async readText(p) {
    const path = this.resolve(p)
    if (!this.isFile(path)) return null
    const t = await this.host.read(path)
    if (isBin(t)) throw new ShellError(`${p}: バイナリファイルです (画像・データベースなど)`)
    return t
  }
  async writeText(p, text) {
    const path = this.resolve(p)
    if (!path) throw new ShellError('ファイル名がありません')
    if (this.isDir(path)) throw new ShellError(`${p}: フォルダです`)
    const parent = dirName(path)
    if (parent && !this.isDir(parent)) throw new ShellError(`${p}: フォルダ ${showPath(parent)} がありません`)
    await this.fsWrite(path, text)
  }

  // ワイルドカードを、プロジェクトのファイルに当てはめる
  glob(pat) {
    const abs = pat.startsWith('/') || pat.startsWith('~')
    const prefix = pat.startsWith('~/') ? '~/' : pat.startsWith('/') ? '/' : ''
    const body = pat.slice(prefix.length || (pat === '~' ? 1 : 0))
    const parts = body.split('/').filter(Boolean)
    let cur = [[abs ? '' : this.cwd, '']]   // [実際のパス, 表示]
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k]
      const next = []
      for (const [real, shown] of cur) {
        if (!hasGlob(part)) {
          const lit = unescapeGlob(part)
          const p = resolvePath(real, lit)
          if (this.stat(p) || lit === '..' || lit === '.') next.push([p, shown + lit + (k < parts.length - 1 ? '/' : '')])
          continue
        }
        const re = globRe(part)
        for (const ch of this.children(real, part.startsWith('.'))) {
          if (re.test(ch.name) && (k === parts.length - 1 || ch.dir)) next.push([ch.path, shown + ch.name + (k < parts.length - 1 ? '/' : '')])
        }
      }
      cur = next
      if (!cur.length) return []
    }
    return cur.map(([, shown]) => prefix + shown).sort()
  }

  // ---- 単語の展開 ($変数・$(…)・$(( 式 ))・ワイルドカード) ----
  async expand(word, io) {
    let text = '', pat = '', split = false
    for (const s of word) {
      if (s.t === 'lit') { text += s.v; pat += s.v }
      else if (s.t === 'q') { text += s.v; pat += s.v.replace(/[*?[\]\\]/g, '\\$&') }
      else {
        let v
        if (s.t === 'var' || s.t === 'qvar') v = this.varValue(s.v)
        else if (s.t === 'arith') v = String(arith(await this.expandText(s.v, io), n => this.varValue(n)))
        else v = await this.capture(s.v, io)
        text += v
        pat += v.replace(/[*?[\]\\]/g, '\\$&')
        if (s.t === 'var' || s.t === 'sub') split = true
      }
    }
    if (split) return text.split(/\s+/).filter(Boolean)
    if (hasGlob(pat)) {
      const hits = this.glob(pat)
      if (hits.length) return hits
      return [unescapeGlob(pat)]
    }
    return [text]
  }
  // $(( )) の中の $変数
  async expandText(src, io) {
    return String(src).replace(/\$\{?([A-Za-z_]\w*|[0-9#?])\}?/g, (m, n) => this.varValue(n))
  }
  varValue(name) {
    const args = this.args[this.args.length - 1] || []
    if (name === '?') return String(this.status)
    if (name === '$') return '1'
    if (name === '#') return String(args.length)
    if (name === '@' || name === '*') return args.join(' ')
    if (name === 'PWD') return showPath(this.cwd)
    if (name === 'OLDPWD') return showPath(this.oldCwd)
    if (name === 'RANDOM') return String(Math.floor(Math.random() * 32768))
    if (name === '0') return this.scriptName || 'forgesh'
    if (/^\d$/.test(name)) return args[Number(name) - 1] ?? ''
    for (let k = this.locals.length - 1; k >= 0; k--) if (name in this.locals[k]) return this.locals[k][name]
    return this.env[name] ?? ''
  }
  setVar(name, value) {
    for (let k = this.locals.length - 1; k >= 0; k--) if (name in this.locals[k]) { this.locals[k][name] = value; return }
    this.env[name] = value
  }
  async capture(cmd, io) {
    const buf = []
    await this.run(cmd, { ...io, out: s => buf.push(s), tty: false })
    return buf.join('').replace(/\n+$/, '')
  }
  // 続きの行が要るか (for … do の後・閉じていない引用符など)
  isIncomplete(text) {
    try { parse(lex(text)); return false } catch (e) { return !!(e && e.incomplete) }
  }

  // ---- 実行 ----
  async run(line, io) {
    this.idxCache = null
    if (!this.args.length) this.loops = 0
    let list
    try {
      list = parse(lex(line))
    } catch (e) {
      io.err(`forgesh: ${e.message}\n`)
      this.status = 2
      return 2
    }
    try {
      return await this.runList(list, io)
    } catch (e) {
      if (e instanceof Flow) { this.status = e.code; return e.code }   // スクリプトの外での break / return
      throw e
    }
  }
  async runList(list, io) {
    let status = this.status
    for (let k = 0; k < list.length; k++) {
      const prev = k ? list[k - 1].then : null
      if (prev === '&&' && status !== 0) continue
      if (prev === '||' && status === 0) continue
      status = await this.runPipe(list[k].pipe, io)
      this.status = status
      if (io.signal && io.signal.aborted) { this.status = 130; return 130 }
    }
    this.status = status
    return status
  }
  // 繰り返しの途中で画面を止めない・Ctrl+C で止める
  async tick(io) {
    if (io.signal && io.signal.aborted) throw Object.assign(new Error('止めました'), { name: 'AbortError' })
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - (this.lastYield || 0) > 30) { this.lastYield = now; await new Promise(r => setTimeout(r, 0)) }
    if (++this.loops > 1000000) throw new ShellError('繰り返しが多すぎるので止めました (100 万回)')
  }
  // for / while / if / { } / 関数
  async runCompound(node, io) {
    switch (node.type) {
      case 'func':
        this.funcs[node.name] = node.body
        return 0
      case 'group':
        return this.runList(node.body, io)
      case 'if': {
        for (const b of node.branches) {
          if ((await this.runList(b.cond, io)) === 0) return this.runList(b.body, io)
        }
        return node.otherwise ? this.runList(node.otherwise, io) : 0
      }
      case 'for': {
        let items = []
        if (node.items === null) items = [...(this.args[this.args.length - 1] || [])]
        else for (const w of node.items) items.push(...await this.expand(w, io))
        let status = 0
        for (const v of items) {
          await this.tick(io)
          this.setVar(node.name, v)
          try { status = await this.runList(node.body, io) } catch (e) {
            if (e instanceof Flow && e.kind === 'break') break
            if (e instanceof Flow && e.kind === 'continue') continue
            throw e
          }
        }
        return status
      }
      case 'while': case 'until': {
        let status = 0
        for (;;) {
          await this.tick(io)
          const c = await this.runList(node.cond, io)
          if ((c === 0) !== (node.type === 'while')) break
          try { status = await this.runList(node.body, io) } catch (e) {
            if (e instanceof Flow && e.kind === 'break') break
            if (e instanceof Flow && e.kind === 'continue') continue
            throw e
          }
        }
        return status
      }
    }
    return 0
  }

  // 別名 (alias) を置き換える。同じ名前の別名を何度も展開しない (alias ls='ls -F' など)
  aliasWords(words) {
    const seen = new Set()
    for (let k = 0; k < 8; k++) {
      const w = words[0]
      const name = w && w.length === 1 && w[0].t === 'lit' ? w[0].v : null
      if (!name || seen.has(name) || !(name in this.aliases)) break
      seen.add(name)
      let toks
      try { toks = lex(this.aliases[name]) } catch { break }
      if (toks.some(t => t.op)) break
      words = [...toks.map(t => t.word), ...words.slice(1)]
    }
    return words
  }

  async runPipe(cmds, io) {
    let input = io.stdin || null, status = 0
    for (let k = 0; k < cmds.length; k++) {
      const cmd = cmds[k]
      const last = k === cmds.length - 1
      const outBuf = last ? null : []
      let stdin = input
      let out = last ? io.out : s => outBuf.push(String(s))
      let err = io.err
      let tty = last && io.tty !== false
      const files = []
      let bad = false
      for (const r of cmd.redirs) {
        if (r.op === '2>&1') { err = out; continue }
        let target
        try { target = (await this.expand(r.word, io))[0] || '' } catch (e) { io.err(`forgesh: ${e.message}\n`); bad = true; break }
        if (r.op === '<') {
          let t = null
          try { t = await this.readText(target) } catch (e) { io.err(`forgesh: ${e.message}\n`); bad = true; break }
          if (t === null) { io.err(`forgesh: ${target}: ファイルがありません\n`); bad = true; break }
          stdin = new Stream(t)
          continue
        }
        const f = { name: target, append: r.op.endsWith('>>'), buf: [] }
        files.push(f)
        const w = s => f.buf.push(String(s))
        if (r.op === '>' || r.op === '>>') { out = w; tty = false }
        else if (r.op === '2>' || r.op === '2>>') err = w
        else { out = w; err = w; tty = false }
      }
      if (bad) { status = 1; input = null; continue }
      const sub = { ...io, out, err, tty, stdin }
      if (cmd.compound) status = await this.runCompound(cmd.compound, sub)
      else {
        const argv = []
        try {
          for (const w of this.aliasWords(cmd.words)) argv.push(...await this.expand(w, io))
          for (const a of cmd.assigns) this.setVar(a.name, (await this.expand(a.word, io)).join(' '))
        } catch (e) { io.err(`forgesh: ${e.message}\n`); return 1 }
        if (!argv.length) status = 0
        else {
          const ctx = { out, err, tty, piped: !last, signal: io.signal, io: sub, cols: io.cols ? io.cols() : 80, stdinStream: stdin }
          // 標準入力は、読んだときに初めて取り出す (read で 1 行ずつ読む while ループのため)
          Object.defineProperty(ctx, 'stdin', { get: () => (stdin ? stdin.readAll() : null), configurable: true })
          status = await this.exec(argv, ctx)
        }
      }
      for (const f of files) {
        try {
          const before = f.append ? (await this.readText(f.name)) || '' : ''
          await this.writeText(f.name, before + f.buf.join(''))
        } catch (e) { io.err(`forgesh: ${e.message}\n`); status = 1 }
      }
      await this.sync()
      input = outBuf ? new Stream(outBuf.join('')) : null
      if (io.signal && io.signal.aborted) return 130
    }
    return status
  }

  // 関数・スクリプトを呼ぶ (引数は $1 $2 … $@)
  async callBody(body, args, io, { name = null, subshell = false } = {}) {
    if (this.args.length > 200) throw new ShellError('呼び出しが深すぎます (関数が自分を呼び続けていませんか?)')
    const saved = subshell ? { cwd: this.cwd, env: { ...this.env } } : null
    const savedName = this.scriptName
    this.args.push(args)
    this.locals.push({})
    if (name) this.scriptName = name
    try { return await this.runList(body, io) } catch (e) {
      if (e instanceof Flow && (e.kind === 'return' || (e.kind === 'exit' && name))) return e.code
      throw e
    } finally {
      this.args.pop()
      this.locals.pop()
      this.scriptName = savedName
      if (saved) { this.cwd = saved.cwd; this.env = saved.env }
    }
  }
  async runScript(path, args, ctx, { subshell = true } = {}) {
    const text = await this.readText(path)
    if (text === null) { ctx.err(`${path}: ファイルがありません\n`); return 127 }
    let list
    try { list = parse(lex(text)) } catch (e) { ctx.err(`${path}: ${e.message}\n`); return 2 }
    return this.callBody(list, args, { ...ctx.io, out: ctx.out, err: ctx.err, stdin: ctx.stdinStream }, { name: path, subshell })
  }

  async exec(argv, ctx) {
    const name = argv[0]
    ctx.sh = this
    ctx.term = ctx.io.term || null
    ctx.print = s => ctx.out(s + '\n')
    // 関数
    if (this.funcs[name]) return this.callBody(this.funcs[name], argv.slice(1), { ...ctx.io, out: ctx.out, err: ctx.err, stdin: ctx.stdinStream })
    // ./script.sh・sub/x.py のようにファイルを指したとき
    if (name.includes('/') && !COMMANDS[name]) {
      const p = this.resolve(name)
      if (this.isFile(p)) {
        if (/\.pyw?$/.test(name)) return COMMANDS.python.call(this, argv, ctx)
        return this.runScript(name, argv.slice(1), ctx)
      }
    }
    const fn = COMMANDS[name]
    if (!fn) {
      const hint = this.isFile(this.resolve(name)) && /\.pyw?$/.test(name) ? ` (実行するなら: python ${name})`
        : this.isFile(this.resolve(name)) && /\.sh$/.test(name) ? ` (実行するなら: sh ${name} か ./${name})`
          : /^(apt|apt-get|brew|sudo|npm|node|yarn|java|gcc|make|docker|ssh|top|htop)$/.test(name) ? ' (このターミナルでは使えません)' : ''
      ctx.err(`${name}: コマンドが見つかりません${hint}\n`)
      if (!hint) ctx.err(`${C.gray}使えるコマンドは help で表示します${C.reset}\n`)
      return 127
    }
    try {
      const r = await fn.call(this, argv.slice(1), ctx)
      return typeof r === 'number' ? r : 0
    } catch (e) {
      if (e instanceof Flow) throw e
      if (e && e.name === 'AbortError') return 130
      ctx.err(`${name}: ${e && e.message || e}\n`)
      return 1
    } finally {
      await this.sync()
    }
  }

  // 入力の補完 (Tab): [候補, 置き換える範囲の始まり]
  complete(line) {
    const m = /(?:^|[\s|;&<>])([^\s|;&<>]*)$/.exec(line)
    const word = m ? m[1] : ''
    const start = line.length - word.length
    const before = line.slice(0, start)
    const first = !/\S/.test(before.replace(/.*[|;&]\s*/s, ''))
    if (first && !word.includes('/')) {
      const names = [...new Set([...Object.keys(COMMANDS), ...Object.keys(this.aliases)])].filter(n => n.startsWith(word) && !n.startsWith('_')).sort()
      return { items: names.map(n => ({ text: n + ' ', label: n })), start }
    }
    const cmd = (/(?:^|[|;&])\s*(\S+)[^|;&]*$/.exec(before) || [])[1] || ''
    const dirOnly = cmd === 'cd' || cmd === 'rmdir'
    const pyFirst = cmd === 'python' || cmd === 'py' || cmd === 'python3' || cmd === 'run'
    const slash = word.lastIndexOf('/')
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : ''
    const namePart = slash >= 0 ? word.slice(slash + 1) : word
    const dir = resolvePath(this.cwd, dirPart || '.')
    if (!this.isDir(dir)) return { items: [], start }
    const quote = s => s.replace(/([\s'"\\$`&|;<>()*?[\]])/g, '\\$1')
    let items = this.children(dir, namePart.startsWith('.'))
      .filter(c => c.name.startsWith(namePart) && (!dirOnly || c.dir))
      .map(c => ({ text: dirPart + quote(c.name) + (c.dir ? '/' : ' '), label: c.name + (c.dir ? '/' : ''), dir: c.dir, py: /\.pyw?$/.test(c.name) }))
    if (pyFirst) items = items.sort((a, b) => (b.py || b.dir) - (a.py || a.dir))
    return { items, start }
  }
}

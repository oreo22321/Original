// ターミナルのコマンド: 変数・別名・情報・アプリとつなぐコマンド
// (this はシェル。ctx は print / err / stdin / cols など)
import { humanSize, isBin, kindOf } from '../bin.js'
import { Flow, PY_ROOT, baseName, dirName, fmtDuration, getopts, human, showPath, sleep, strftime } from './util.js'

export default {
  // ---- 変数・別名 ----
  env(args, ctx) {
    for (const [k, v] of Object.entries({ ...this.env, PWD: showPath(this.cwd) }).sort()) ctx.print(`${k}=${v}`)
    return 0
  },
  printenv(args, ctx) {
    if (!args.length) return this.callCmd('env', args, ctx)
    let status = 0
    for (const a of args) { const v = this.varValue(a); if (v === '' && !(a in this.env)) status = 1; else ctx.print(v) }
    return status
  },
  export(args, ctx) {
    if (!args.length) { for (const [k, v] of Object.entries(this.env).sort()) ctx.print(`export ${k}="${v}"`); return 0 }
    for (const a of args) { const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(a); if (m) this.env[m[1]] = m[2]; else if (!(a in this.env)) this.env[a] = '' }
    return 0
  },
  set(args, ctx) { return this.callCmd('env', args, ctx) },
  unset(args) { for (const a of args) delete this.env[a]; return 0 },
  alias(args, ctx) {
    if (!args.length) { for (const [k, v] of Object.entries(this.aliases).sort()) ctx.print(`alias ${k}='${v}'`); return 0 }
    let status = 0
    for (const a of args) {
      const m = /^([^=\s]+)=(.*)$/s.exec(a)
      if (m) this.aliases[m[1]] = m[2]
      else if (a in this.aliases) ctx.print(`alias ${a}='${this.aliases[a]}'`)
      else { ctx.err(`alias: ${a}: ありません\n`); status = 1 }
    }
    if (ctx.term && ctx.term.saveState) ctx.term.saveState()
    return status
  },
  unalias(args) { for (const a of args) delete this.aliases[a]; return 0 },
  which(args, ctx) {
    let status = 0
    for (const a of args) {
      if (a in this.aliases) ctx.print(`${a}: 別名 (${this.aliases[a]})`)
      else if (this.hasCmd(a)) ctx.print(a === 'python' || a === 'pip' ? `/usr/bin/${a}` : `${a}: 組み込みコマンド`)
      else { ctx.err(`${a} は見つかりません\n`); status = 1 }
    }
    return status
  },
  type(args, ctx) { return this.callCmd('which', args, ctx) },

  // ---- 情報 ----
  date(args, ctx) {
    const d = new Date()
    const fmt = args.find(a => a.startsWith('+'))
    if (fmt) { ctx.print(strftime(fmt.slice(1), d)); return 0 }
    if (args.includes('-I') || args.includes('--iso-8601')) { ctx.print(strftime('%F', d)); return 0 }
    ctx.print(strftime('%Y年 %m月 %d日 %A %T %Z', d))
    return 0
  },
  cal(args, ctx) {
    const d = new Date()
    const y = d.getFullYear(), m = d.getMonth()
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate()
    ctx.print(`      ${y}年 ${m + 1}月`)
    ctx.print('日 月 火 水 木 金 土')
    let row = '   '.repeat(first)
    for (let k = 1; k <= days; k++) {
      const cell = String(k).padStart(2)
      row += (k === d.getDate() && ctx.tty ? `\x1b[7m${cell}\x1b[27m` : cell) + ' '
      if ((first + k) % 7 === 0) { ctx.print(row.trimEnd()); row = '' }
    }
    if (row.trim()) ctx.print(row.trimEnd())
    return 0
  },
  async sleep(args, ctx) {
    const sec = args.reduce((a, s) => { const m = /^(\d*\.?\d+)([smhd]?)$/.exec(s); return a + (m ? Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]]) : NaN) }, 0)
    if (!args.length || isNaN(sec)) { ctx.err('sleep: 秒数を書いてください (例: sleep 2)\n'); return 1 }
    await sleep(sec * 1000, ctx.signal)
    return 0
  },
  async time(args, ctx) {
    const t0 = performance.now()
    const st = args.length ? await this.exec(args, ctx) : 0
    const s = (performance.now() - t0) / 1000
    ctx.err(`\nreal\t${Math.floor(s / 60)}m${(s % 60).toFixed(3)}s\n`)
    return st
  },
  true() { return 0 },
  false() { return 1 },
  ':'() { return 0 },
  whoami(args, ctx) { ctx.print(this.env.USER || 'forge'); return 0 },
  hostname(args, ctx) { ctx.print('forgecode'); return 0 },
  uname(args, ctx) {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'node'
    const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Web'
    ctx.print(args.some(a => /a/.test(a)) ? `ForgeCode forgecode ${this.host.pyVersion ? this.host.pyVersion() : 'Python 3'} (Pyodide / WebAssembly) ${os}` : 'ForgeCode')
    return 0
  },
  uptime(args, ctx) {
    const up = typeof performance !== 'undefined' ? performance.now() : Date.now() - this.started
    const run = this.host.running ? this.host.running() : null
    ctx.print(`${strftime('%T', new Date())}  アプリの起動から ${fmtDuration(up)}${run ? `  ・  ${run.name} を実行中 ${fmtDuration(run.ms)}` : ''}`)
    return 0
  },
  async free(args, ctx) {
    const pm = typeof performance !== 'undefined' && performance.memory
    const dm = typeof navigator !== 'undefined' && navigator.deviceMemory
    if (pm) ctx.print(`このページ: 使用 ${human(pm.usedJSHeapSize)} / 確保 ${human(pm.totalJSHeapSize)} / 上限 ${human(pm.jsHeapSizeLimit)}`)
    if (dm) ctx.print(`端末のメモリ: 約 ${dm} GB`)
    if (!pm && !dm) ctx.print('このブラウザではメモリの量を調べられません')
    return 0
  },
  async df(args, ctx) {
    const e = this.host.storage ? await this.host.storage() : null
    if (!e) { ctx.print('容量を調べられません'); return 1 }
    ctx.print(`使用 ${human(e.usage || 0)} / 上限 約 ${human(e.quota || 0)} (${((e.usage || 0) / Math.max(1, e.quota || 1) * 100).toFixed(1)}%)`)
    return 0
  },
  du(args, ctx) {
    const { o, rest } = getopts(args, 'shac')
    const fmt = n => (o.h ? human(n) : String(Math.ceil(n / 1024)))
    for (const t of rest.length ? rest : ['.']) {
      const p = this.resolve(t)
      if (!this.stat(p)) { ctx.err(`du: ${t}: ありません\n`); continue }
      const sizeOf = q => { let n = 0; for (const [path, s] of this.index()) if (!s.dir && (path === q || path.startsWith(q ? q + '/' : ''))) n += s.size; return n }
      if (!o.s) {
        for (const c of this.children(p, true)) if (c.dir || o.a) ctx.print(`${fmt(sizeOf(c.path))}\t${t === '.' ? '' : t.replace(/\/$/, '') + '/'}${c.name}`)
      }
      ctx.print(`${fmt(sizeOf(p))}\t${t}`)
    }
    return 0
  },
  stat(args, ctx) {
    let status = 0
    for (const a of args) {
      const p = this.resolve(a)
      const s = this.stat(p)
      if (!s) { ctx.err(`stat: ${a}: ありません\n`); status = 1; continue }
      ctx.print(`  名前: ${showPath(p)}\n  種類: ${s.dir ? 'フォルダ' : 'ファイル'}\n大きさ: ${s.dir ? '-' : s.size + ' 文字'}\n  更新: ${s.mtime ? new Date(s.mtime).toLocaleString('ja-JP') : '-'}`)
    }
    return status
  },
  async file(args, ctx) {
    let status = 0
    for (const a of args) {
      const p = this.resolve(a)
      if (this.isDir(p)) { ctx.print(`${a}: フォルダ`); continue }
      if (!this.isFile(p)) { ctx.err(`file: ${a}: ありません\n`); status = 1; continue }
      const c = await this.host.read(p)
      ctx.print(`${a}: ${kindOf(a, c)}${isBin(c) ? ` (${humanSize(c.length)})` : `, ${(c.match(/\n/g) || []).length} 行`}`)
    }
    return status
  },
  basename(args, ctx) { if (!args[0]) return 1; let b = baseName(args[0].replace(/\/+$/, '')); if (args[1] && b.endsWith(args[1])) b = b.slice(0, -args[1].length); ctx.print(b); return 0 },
  dirname(args, ctx) { if (!args[0]) return 1; ctx.print(dirName(args[0].replace(/\/+$/, '')) || '.'); return 0 },
  realpath(args, ctx) { for (const a of args) ctx.print(PY_ROOT + (this.resolve(a) ? '/' + this.resolve(a) : '')); return 0 },
  history(args, ctx) {
    if (!ctx.term) return 0
    if (args[0] === '-c') { ctx.term.clearHistory(); return 0 }
    const h = ctx.term.historyList()
    const n = args[0] ? Number(args[0]) : h.length
    h.slice(-n).forEach((l, k) => ctx.print(`${String(h.length - Math.min(n, h.length) + k + 1).padStart(5)}  ${l}`))
    return 0
  },
  clear(args, ctx) { if (ctx.term) ctx.term.clear(); return 0 },
  reset(args, ctx) { if (ctx.term) ctx.term.clear(); return 0 },
  exit(args, ctx) {
    const code = Number(args[0]) || 0
    if (this.args.length) throw new Flow('exit', code)   // スクリプトの中: スクリプトだけ終える
    if (ctx.term) ctx.term.exit()
    return code
  },
  logout(args, ctx) { return this.callCmd('exit', args, ctx) },

  // ---- アプリ ----
  async open(args, ctx) {
    if (!args.length) { ctx.err('open: 開くファイルを書いてください\n'); return 1 }
    let status = 0
    for (const a of args.filter(x => !x.startsWith('-') && !x.startsWith('+'))) {
      const m = /^(.*?):(\d+)$/.exec(a)
      const name = m && !this.stat(this.resolve(a)) ? m[1] : a
      const p = this.resolve(name)
      if (this.isDir(p)) { ctx.err(`open: ${a}: フォルダです\n`); status = 1; continue }
      if (!this.isFile(p)) { await this.writeText(name, ''); ctx.print(`新しいファイルを作りました: ${name}`) }
      await this.host.open(p, m ? Number(m[2]) : 0)
    }
    return status
  },
  code(args, ctx) { return this.callCmd('open', args, ctx) },
  edit(args, ctx) { return this.callCmd('open', args, ctx) },
  nano(args, ctx) { return this.callCmd('open', args, ctx) },
  vim(args, ctx) { return this.callCmd('open', args, ctx) },
  vi(args, ctx) { return this.callCmd('open', args, ctx) },
  async run(args, ctx) {
    const f = args[0]
    if (f && !this.isFile(this.resolve(f))) { ctx.err(`run: ${f}: ファイルがありません\n`); return 1 }
    await this.host.runFile(f ? this.resolve(f) : null)
    return 0
  },
  ps(args, ctx) {
    const run = this.host.running ? this.host.running() : null
    ctx.print('  PID   時間  コマンド')
    ctx.print(`    1   ${fmtDuration((typeof performance !== 'undefined' ? performance.now() : 0))}  forgesh`)
    if (run) ctx.print(`    2   ${fmtDuration(run.ms)}  python ${run.name}`)
    return 0
  },
  async kill(args, ctx) {
    const run = this.host.running ? this.host.running() : null
    if (!run) { ctx.err('kill: 実行中のプログラムはありません\n'); return 1 }
    await this.host.command('stop')
    ctx.print(`止めました: ${run.name}`)
    return 0
  },
  async curl(args, ctx) {
    const { o, rest } = getopts(args, 'sSLfIiOkv', 'oXdHA')
    const url = rest[0]
    if (!url) { ctx.err('curl: URL を書いてください (例: curl https://example.com/data.csv -o data.csv)\n'); return 2 }
    if (!/^https?:\/\//.test(url)) { ctx.err('curl: http:// か https:// で始まる URL を書いてください\n'); return 3 }
    const init = { method: o.X || (o.d !== undefined ? 'POST' : o.I ? 'HEAD' : 'GET'), headers: {} }
    if (o.H) { const m = /^([^:]+):\s*(.*)$/.exec(o.H); if (m) init.headers[m[1]] = m[2] }
    if (o.d !== undefined) { init.body = o.d; if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/x-www-form-urlencoded' }
    let res
    try { res = await this.host.fetch(url, { ...init, signal: ctx.signal }) } catch (e) {
      if (e && e.name === 'AbortError') throw e
      ctx.err(`curl: 読み込めませんでした (${e && e.message || e})。相手のサーバーがブラウザからの読み込み (CORS) を許可していないと、読み込めません\n`)
      return 7
    }
    if (o.I || o.i) { ctx.print(`HTTP ${res.status} ${res.statusText}`); res.headers.forEach((v, k) => ctx.print(`${k}: ${v}`)); if (o.I) return 0; ctx.print('') }
    if (o.f && !res.ok) { ctx.err(`curl: HTTP ${res.status}\n`); return 22 }
    const text = await res.text()
    const name = o.O ? baseName(new URL(url).pathname) || 'index.html' : o.o
    if (name) { await this.writeText(name, text); if (!o.s) ctx.err(`保存しました: ${name} (${human(text.length)})\n`) }
    else ctx.out(text)
    return 0
  },
  async wget(args, ctx) {
    const { o, rest } = getopts(args, 'qc', 'O')
    const url = rest[0]
    if (!url) { ctx.err('wget: URL を書いてください\n'); return 1 }
    let name = o.O
    if (!name) { try { name = baseName(new URL(url).pathname) || 'index.html' } catch { name = 'index.html' } }
    if (name === '-') return this.callCmd('curl', ['-s', url], ctx)
    return this.callCmd('curl', [url, '-o', name, ...(o.q ? ['-s'] : [])], ctx)
  },
}

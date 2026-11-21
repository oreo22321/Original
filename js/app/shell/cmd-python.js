// ターミナルのコマンド: Python と pip
// (this はシェル。ctx は print / err / stdin / cols など)


export default {
  // ---- Python ----
  async python(args, ctx) {
    const argv = [...args]
    let stdinText = ctx.stdin   // パイプ・< の中身 (1 度だけ読む)
    let mode = null, payload = null, interactive = false
    while (argv.length && argv[0].startsWith('-') && argv[0] !== '-') {
      const a = argv.shift()
      if (a === '-c') { mode = 'c'; payload = argv.shift(); break }
      if (a === '-m') { mode = 'm'; payload = argv.shift(); break }
      if (a === '-V' || a === '--version') { ctx.print(this.host.pyVersion ? this.host.pyVersion() : 'Python 3.14'); return 0 }
      if (a === '-h' || a === '--help') { return this.callCmd('help', ['python'], ctx) }
      if (a === '-i') { interactive = true; continue }
      if (/^-[uBOEsSIq]+$/.test(a)) continue
      if (a === '-X' || a === '-W') { argv.shift(); continue }
      ctx.err(`python: ${a} は使えないオプションです\n`)
      return 2
    }
    if ((mode === 'c' || mode === 'm') && payload === undefined) { ctx.err(`python: ${mode === 'c' ? '-c の後にコード' : '-m の後にモジュール名'}を書いてください\n`); return 2 }
    if (mode === 'm' && payload === 'pip') return this.callCmd('pip', argv, ctx)
    if (mode === 'm' && payload === 'pytest') return this.callCmd('pytest', argv, ctx)
    if (mode === 'm' && payload === 'http.server') {
      ctx.print(`Serving HTTP on 0.0.0.0 port ${argv.find(a => /^\d+$/.test(a)) || 8000} — アプリの中のブラウザ (プレビュー) で開きます`)
      return this.callCmd('preview', [this.cwd ? '/' + this.cwd + '/' : '/'], ctx)
    }
    if (mode === 'm' && (payload === 'cProfile' || payload === 'profile') && argv.length && !argv[0].startsWith('-')) return this.callCmd('profile', argv, ctx)
    let entry = null, source = null, sysArgv
    if (mode === 'c') { source = payload; entry = '<string>'; sysArgv = ['-c', ...argv] }
    else if (mode === 'm') {
      source = `import runpy\nrunpy.run_module(${JSON.stringify(payload)}, run_name="__main__", alter_sys=True)\n`
      entry = '<module>'
      sysArgv = [payload, ...argv]
    } else if (argv.length && argv[0] !== '-') {
      const file = argv[0]
      const p = this.resolve(file)
      if (this.isDir(p)) {
        if (!this.isFile(p ? p + '/__main__.py' : '__main__.py')) { ctx.err(`python: ${file}: __main__.py がありません\n`); return 2 }
        entry = (p ? p + '/' : '') + '__main__.py'
      } else if (!this.isFile(p)) { ctx.err(`python: '${file}' を開けません: ファイルがありません\n`); return 2 }
      else entry = p
      sysArgv = [file, ...argv.slice(1)]
    } else if (stdinText !== null && stdinText !== undefined && !interactive) {
      // echo 'print(1)' | python
      source = stdinText
      entry = '<stdin>'
      sysArgv = ['-', ...argv.slice(1)]
      stdinText = ''
    } else {
      if (!ctx.term) { ctx.err('python: 対話モードはターミナルで使えます\n'); return 1 }
      ctx.term.startRepl({ ns: 'repl-new' })
      return 0
    }
    const code = await this.host.python({ entry, source, argv: sysArgv, cwd: this.cwd, stdin: stdinText, out: ctx.out, err: ctx.err, tty: ctx.tty, signal: ctx.signal, term: ctx.term })
    if (interactive && ctx.term) ctx.term.startRepl({ ns: 'last' })
    return code
  },
  // pytest: テストを実行 (pytest が使えれば pytest、なければ同じ書き方の内蔵の実行役)
  async pytest(args, ctx) {
    if (args.includes('-h') || args.includes('--help')) {
      ctx.print('pytest [ファイル | ファイル::テスト] [-k 名前] [-x 最初の失敗で止める] [-v 1 つずつ表示] [--lf 前に失敗したもの]\ntest_*.py / *_test.py の test で始まる関数・Test クラス・unittest.TestCase を実行します (テストの画面にも結果が出ます)')
      return 0
    }
    const list = args.map(a => (a.startsWith('-') || this.cwd === '' ? a : this.resolve(a.split('::')[0]) + (a.includes('::') ? a.slice(a.indexOf('::')) : '')))
    return this.host.python({ entry: '<pytest>', source: `import _fctest\nraise SystemExit(_fctest.main(${JSON.stringify(list)}))\n`, argv: ['pytest', ...args], cwd: '', stdin: ctx.stdin, out: ctx.out, err: ctx.err, tty: ctx.tty, signal: ctx.signal, term: ctx.term })
  },
  // profile: 時間のかかった関数を調べて実行 (結果は表で出ます)
  async profile(args, ctx) {
    const file = args.find(a => !a.startsWith('-'))
    if (!file) { ctx.print('使い方: profile ファイル.py [引数]   (python -m cProfile ファイル.py も同じ)\n時間のかかった関数・行を調べます'); return 0 }
    const p = this.resolve(file)
    if (!this.isFile(p)) { ctx.err(`profile: '${file}' がありません\n`); return 2 }
    const rest = args.slice(args.indexOf(file) + 1)
    return this.host.python({ entry: '<profile>', source: `import _fcprof\n_fcprof.run_file(${JSON.stringify(p)}, ${JSON.stringify([file, ...rest])})\n`, argv: [file, ...rest], cwd: this.cwd, stdin: ctx.stdin, out: ctx.out, err: ctx.err, tty: ctx.tty, signal: ctx.signal, term: ctx.term })
  },
  // preview: アプリの中のブラウザで Web ページ・Web アプリを開く
  async preview(args, ctx) {
    const p = args.find(a => !a.startsWith('-'))
    const path = p ? (p.startsWith('/') && !this.isFile(this.resolve(p)) ? p : '/' + this.resolve(p) + (this.isDir(this.resolve(p)) && this.resolve(p) ? '/' : '')) : '/'
    if (!this.host.preview) { ctx.err('preview: ここでは使えません\n'); return 1 }
    await this.host.preview(path)
    ctx.print(`プレビューを開きました: ${path}`)
    return 0
  },
  // flask run: Flask のアプリをプレビューで動かす (FLASK_APP / app.py / wsgi.py)
  async flask(args, ctx) {
    if (args[0] !== 'run') { ctx.print('使い方: flask run   (FLASK_APP か app.py / wsgi.py の app を、アプリの中のブラウザで動かします)'); return args[0] ? 1 : 0 }
    let name = this.env.FLASK_APP || this.varValue('FLASK_APP') || ''
    const ai = args.indexOf('--app')
    if (ai >= 0) name = args[ai + 1] || ''
    if (!name) name = ['app.py', 'wsgi.py', 'main.py'].map(f => (this.cwd ? this.cwd + '/' : '') + f).find(f => this.isFile(f)) || ''
    if (!name) { ctx.err('flask: アプリが見つかりません (app.py を作るか、FLASK_APP=ファイル名 を指定してください)\n'); return 2 }
    const [modPart, attr] = name.replace(/\.py$/, '').split(':')
    const mod = modPart.replace(/^\.\//, '').split('/').pop()
    const src = `import importlib, sys\nsys.argv = ["flask", "run"]\n_m = importlib.import_module(${JSON.stringify(mod)})\n_a = getattr(_m, ${JSON.stringify(attr || 'app')}, None) or getattr(_m, "application", None)\nif _a is None and hasattr(_m, "create_app"):\n    _a = _m.create_app()\nif _a is None:\n    raise SystemExit("flask: ${mod} の中に app がありません")\n_a.run()\n`
    const code = await this.host.python({ entry: '<flask>', source: src, argv: ['flask', 'run'], cwd: modPart.includes('/') ? modPart.slice(0, modPart.lastIndexOf('/')) : this.cwd, stdin: ctx.stdin, out: ctx.out, err: ctx.err, tty: ctx.tty, signal: ctx.signal, term: ctx.term })
    if (code === 0 && this.host.preview) await this.host.preview('/')
    return code
  },
  async pip(args, ctx) {
    const sub = args[0]
    if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
      ctx.print('pip install 名前 … PyPI からライブラリを入れる (pure Python のもの)\npip install -r requirements.txt\npip list / pip freeze / pip show 名前 / pip uninstall 名前')
      return 0
    }
    if (sub === '--version' || sub === '-V') { ctx.print('pip (micropip) — ForgeCode'); return 0 }
    let rest = args.slice(1)
    if (sub === 'install') {
      const names = []
      for (let k = 0; k < rest.length; k++) {
        const a = rest[k]
        if (a === '-r' || a === '--requirement') {
          const f = rest[++k]
          const t = f ? await this.readText(f) : null
          if (t === null) { ctx.err(`pip: ${f || ''}: ファイルがありません\n`); return 1 }
          for (const l of t.split('\n')) { const r = l.replace(/\s+#.*$|^#.*$/, '').trim(); if (r && !r.startsWith('-')) names.push(r) }
        } else if (!a.startsWith('-')) names.push(a)
      }
      if (!names.length) { ctx.err('pip: 入れるライブラリの名前を書いてください (例: pip install emoji)\n'); return 1 }
      rest = names
    } else rest = rest.filter(a => !a.startsWith('-'))
    return this.host.pip([sub, ...rest], ctx)
  },
}

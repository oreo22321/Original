// テストの画面: test_*.py / *_test.py のテストを一覧にして、実行・結果 (✓ ✗)・失敗した行へ移動
// 実行は _fctest (pytest があれば pytest、なければ同じ書き方の内蔵の実行役)。ターミナルの pytest の結果もここに出ます
import { app, newFile } from './app.js'
import { on } from './store.js'
import { h, icon, toast, modal } from './ui.js'

const isTestFile = p => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(p)
const ST = {
  passed: ['check', 'ok', '成功'], failed: ['close', 'err', '失敗'], error: ['alert', 'err', 'エラー'], skipped: ['minus', 'skip', 'スキップ'],
  xfailed: ['minus', 'skip', '予想どおり失敗'], xpassed: ['alert', 'skip', '予想外に成功'], running: ['refresh', 'run', '実行中'], none: [null, 'none', 'まだ'],
}

// ファイルの中から、テストを探す (実行しなくても一覧に出すため。正確な一覧は実行したときに Python が作る)
export function discover(path, text) {
  const out = []
  let cls = null, clsIndent = -1, isCase = false
  const lines = String(text || '').split('\n')
  lines.forEach((line, i) => {
    const m = /^(\s*)class\s+(\w+)\s*(\(([^)]*)\))?\s*:/.exec(line)
    if (m) {
      const indent = m[1].length
      if (indent === 0) { cls = m[2]; clsIndent = 0; isCase = /TestCase/.test(m[4] || ''); if (!isCase && !/^Test/.test(cls)) cls = null }
      return
    }
    const f = /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/.exec(line)
    if (!f) { if (/^\S/.test(line) && !/^(#|@|$)/.test(line)) cls = null; return }
    const indent = f[1].length
    if (indent === 0) { cls = null; out.push({ id: `${path}::${f[2]}`, file: path, name: f[2], cls: null, line: i + 1 }) }
    else if (cls && indent > clsIndent) out.push({ id: `${path}::${cls}::${f[2]}`, file: path, name: f[2], cls, line: i + 1 })
  })
  return out
}

export class TestsView {
  constructor(el) {
    this.el = el
    this.results = new Map()     // id → 結果
    this.open = new Set()        // 開いているファイル
    this.closed = new Set()
    this.state = { running: false, total: 0, done: 0, summary: null }
    this.build()
    on('py-tests', e => this.onEvent(e))
    let t = 0
    const later = () => { clearTimeout(t); t = setTimeout(() => this.visible() && this.render(), 500) }
    on('files', later)
    on('saved', later)
    on('project', () => { this.results.clear(); this.state.summary = null; this.render() })
    this.render()
  }
  visible() { return !this.el.classList.contains('hidden') }
  build() {
    this.runBtn = h('button', { class: 'icon-btn sm', title: 'すべて実行', 'aria-label': 'すべてのテストを実行', onclick: () => this.run([]) }, icon('play', 15))
    this.failBtn = h('button', { class: 'icon-btn sm', title: '失敗したものだけ実行', 'aria-label': '失敗したテストだけ実行', onclick: () => this.runFailed() }, icon('refresh', 15))
    this.el.append(h('div', { class: 'side-head' }, h('span', { class: 'side-title' }, 'テスト'), h('div', { class: 'side-acts' }, this.failBtn, this.runBtn)))
    this.summary = h('div', { class: 'tv-summary' })
    this.list = h('div', { class: 'tv-list' })
    this.el.append(this.summary, this.list)
  }

  items() {
    const all = []
    for (const f of app.files) {
      if (f.dir || !isTestFile(f.path)) continue
      const d = app.editors && app.editors.docs.get(f.path)
      const text = d && d.state ? d.state.doc.toString() : app.contents.get(f.path)
      all.push({ file: f.path, tests: discover(f.path, text) })
    }
    return all.sort((a, b) => (a.file < b.file ? -1 : 1))
  }
  // 結果: 名前が同じもの (parametrize の [..] 付き) もまとめる
  resultsFor(t) {
    const out = []
    for (const [id, r] of this.results) if (id === t.id || id.startsWith(t.id + '[')) out.push(r)
    return out
  }
  statusOf(list) {
    if (!list.length) return 'none'
    for (const k of ['running', 'error', 'failed', 'xpassed', 'passed', 'xfailed', 'skipped']) if (list.some(r => r.outcome === k)) return k
    return 'none'
  }

  render() {
    const files = this.items()
    const s = this.state
    this.runBtn.disabled = s.running
    this.failBtn.disabled = s.running || ![...this.results.values()].some(r => r.outcome === 'failed' || r.outcome === 'error')
    // 上の集計
    this.summary.replaceChildren()
    if (s.running) this.summary.append(h('span', { class: 'tv-run' }, h('span', { class: 'spinner' }), `実行中… ${s.done} / ${s.total || '?'}`), h('button', { class: 'btn small ghost', onclick: () => app.runner.stop() }, icon('stop', 12), '止める'))
    else if (s.summary) {
      const c = s.summary.counts || {}
      const bad = (c.failed || 0) + (c.error || 0)
      this.summary.append(
        h('span', { class: 'tv-c ok' }, icon('check', 13), String(c.passed || 0)),
        h('span', { class: 'tv-c err' }, icon('close', 13), String(bad)),
        (c.skipped || c.xfailed) ? h('span', { class: 'tv-c skip' }, icon('minus', 13), String((c.skipped || 0) + (c.xfailed || 0))) : null,
        h('span', { class: 'tv-time' }, s.summary.stopped ? '止めました' : `${(s.summary.seconds || 0).toFixed(2)} 秒${s.summary.runner === 'pytest' ? ' · pytest' : ''}`),
        this.log ? h('button', { class: 'btn small ghost', onclick: () => this.showLog() }, '出力') : null)
    } else if (files.length) this.summary.append(h('span', { class: 'tv-time' }, `${files.reduce((n, f) => n + f.tests.length, 0)} 個のテスト · ▶ で実行`))

    if (!files.length) {
      const doc = app.editors && app.editors.activeDoc()
      const canMake = doc && /\.py$/.test(doc.path) && !isTestFile(doc.path)
      this.list.replaceChildren(h('div', { class: 'tree-empty' },
        h('div', null, 'テストのファイルがありません。test_ で始まる名前のファイル (例: test_main.py) に、test で始まる関数を書くとここに出ます。'),
        h('pre', { class: 'tv-sample' }, 'from main import add\n\ndef test_add():\n    assert add(1, 2) == 3'),
        canMake ? h('button', { class: 'btn small primary', onclick: () => this.scaffold(doc) }, icon('plus', 13), `${doc.path.split('/').pop()} のテストを作る`) : null,
        h('div', { class: 'set-desc' }, 'ターミナルで pytest と打っても実行できます。')))
      return
    }
    const rows = []
    for (const f of files) {
      const results = f.tests.flatMap(t => this.resultsFor(t))
      const fileErr = this.results.get(f.file)
      const st = fileErr ? fileErr.outcome : this.statusOf(results)
      const open = !this.closed.has(f.file)
      rows.push(h('div', { class: 'tv-file', onclick: e => { if (e.target.closest('button')) return; if (open) this.closed.add(f.file); else this.closed.delete(f.file); this.render() } },
        icon(open ? 'chevronDown' : 'chevronRight', 14), this.badge(st), h('span', { class: 'tv-fname' }, f.file),
        h('button', { class: 'icon-btn xs', title: 'このファイルを実行', 'aria-label': `${f.file} を実行`, onclick: () => this.run([f.file]) }, icon('play', 12))))
      if (fileErr && open) rows.push(this.failure(fileErr))
      if (!open) continue
      let lastCls = null
      for (const t of f.tests) {
        if (t.cls && t.cls !== lastCls) rows.push(h('div', { class: 'tv-cls' }, t.cls))
        lastCls = t.cls
        const rs = this.resultsFor(t)
        const st2 = this.statusOf(rs)
        const ms = rs.reduce((n, r) => n + (r.ms || 0), 0)
        rows.push(h('div', { class: 'tv-test' + (t.cls ? ' in-cls' : ''), title: `${t.id} — ${ST[st2][2]}`, onclick: e => { if (e.target.closest('button')) return; this.goto(t.file, t.line) } },
          this.badge(st2), h('span', { class: 'tv-name' }, t.name),
          rs.length > 1 ? h('span', { class: 'tv-ms' }, `${rs.filter(r => r.outcome === 'passed').length}/${rs.length}`) : rs.length && ms ? h('span', { class: 'tv-ms' }, ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} 秒`) : null,
          h('button', { class: 'icon-btn xs', title: 'このテストだけ実行', 'aria-label': `${t.name} を実行`, onclick: () => this.run([t.id]) }, icon('play', 12))))
        for (const r of rs) if (r.outcome === 'failed' || r.outcome === 'error') rows.push(this.failure(r, rs.length > 1))
      }
    }
    this.list.replaceChildren(...rows)
  }
  badge(st) {
    const [ic, cls] = ST[st] || ST.none
    return h('span', { class: 'tv-badge ' + cls }, ic ? (st === 'running' ? h('span', { class: 'spinner' }) : icon(ic, 12)) : null)
  }
  failure(r, showName = false) {
    return h('button', { class: 'tv-fail', onclick: () => this.detail(r) }, showName ? h('span', { class: 'tv-pname' }, r.name) : null, h('span', null, String(r.message || r.outcome).split('\n').slice(0, 4).join('\n')))
  }
  detail(r) {
    const at = r.at && r.at.file ? r.at : { file: r.file, line: r.line }
    modal({
      title: r.id, wide: true,
      body: h('div', { class: 'tv-detail' }, h('pre', { class: 'err-log tv-msg' }, r.message || ''), r.detail ? h('pre', { class: 'err-log' }, r.detail) : null),
      actions: [
        { label: `${at.file}:${at.line} へ`, run: () => { this.goto(at.file, at.line); return true } },
        { label: 'もう一度実行', run: () => { this.run([r.id]); return true } },
        { label: '閉じる', primary: true, value: null },
      ],
    })
  }
  async goto(file, line) {
    await app.editors.open(file, { line })
    if (app.wb.layout === 'mobile') app.wb.toggleSidebar(false)
  }
  showLog() {
    modal({ title: 'テストの出力', wide: true, body: h('pre', { class: 'err-log' }, this.log || '') })
  }

  onEvent(e) {
    if (!e) return
    const s = this.state
    if (e.phase === 'start') {
      // 実行するテストだけ「実行中」に
      s.total = e.total; s.done = 0
      if (!s.running) { s.running = true; s.external = true }
    } else if (e.phase === 'result') {
      s.done++
      this.results.set(e.id, e)
    } else if (e.phase === 'done') {
      s.summary = e
      if (s.external) { s.running = false; s.external = false }
      if (!this.visible() && e.counts) {
        const bad = (e.counts.failed || 0) + (e.counts.error || 0)
        if (!s.quiet) toast(bad ? `テスト: ${bad} 個失敗しました` : `テスト: すべて成功 (${e.counts.passed || 0} 個)`, { kind: bad ? 'error' : undefined, icon: bad ? 'alert' : 'check', action: { label: '見る', run: () => app.wb.showView('tests') } })
      }
    }
    clearTimeout(this.paintTimer)
    this.paintTimer = setTimeout(() => this.render(), e.phase === 'result' ? 60 : 0)
  }

  async run(ids) {
    const r = app.runner
    if (this.state.running) return
    if (r.running) { toast('ほかのプログラムが実行中です (止めてから)'); return }
    if (app.editors) await app.editors.saveAll().catch(() => {})
    const files = this.items()
    // 実行するものを「実行中」に
    const match = id => !ids.length || ids.some(x => id === x || id.startsWith(x + '::') || id.startsWith(x + '['))
    for (const f of files) {
      if (match(f.file)) this.results.delete(f.file)
      for (const t of f.tests) if (match(t.id)) { for (const k of [...this.results.keys()]) if (k === t.id || k.startsWith(t.id + '[')) this.results.delete(k); this.results.set(t.id, { ...t, outcome: 'running' }) }
    }
    this.state = { running: true, total: 0, done: 0, summary: null }
    this.log = ''
    this.render()
    let resolveDone
    const finished = new Promise(res => { resolveDone = res })
    const view = this
    const sink = {
      finished: false,
      output(items) { for (const it of items) view.log += it.text + (it.partial ? '' : '\n') },
      input() { r.sendInput('', true) },     // テストは入力を待たない (EOF)
      inputDone() {}, block() {}, visual() {}, note() {},
      done(m) {
        if (this.finished) return
        this.finished = true
        if (m.error) view.log += String(m.error.text || `${m.error.type}: ${m.error.message}`) + '\n'
        resolveDone(m)
      },
    }
    try {
      await r.run({ source: `import _fctest\nraise SystemExit(_fctest.main(${JSON.stringify(ids)}))\n`, name: '<tests>', term: sink })
      await Promise.race([finished, new Promise(res => setTimeout(res, 100))])
    } catch (e) { toast('テストを実行できませんでした: ' + (e.message || e), { kind: 'error' }) }
    // 結果が来なかったもの (止めた・読み込めなかった) を戻す
    for (const [k, v] of this.results) if (v.outcome === 'running') this.results.delete(k)
    this.state.running = false
    if (!this.state.summary) this.state.summary = { counts: {}, stopped: true }
    this.render()
  }
  runFailed() {
    const ids = [...this.results.values()].filter(r => r.outcome === 'failed' || r.outcome === 'error').map(r => r.id.replace(/\[.*$/, ''))
    if (ids.length) this.run([...new Set(ids)])
  }

  // いまのファイルの関数から、テストのひな形を作る
  async scaffold(doc) {
    const text = doc.state.doc.toString()
    const fns = [...text.matchAll(/^def\s+([a-zA-Z]\w*)\s*\(([^)]*)\)/gm)].filter(m => !m[1].startsWith('_'))
    const mod = doc.path.replace(/\.py$/, '').replace(/\//g, '.')
    const name = doc.path.split('/').pop()
    const dir = doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/') + 1) : ''
    const path = `${dir}test_${name}`
    if (app.files.some(f => f.path === path)) { await app.editors.open(path); return }
    const lines = [`# ${name} のテスト (テストの画面の ▶ か、ターミナルの pytest で実行)`, fns.length ? `from ${mod.split('.').pop()} import ${fns.map(m => m[1]).join(', ')}` : `import ${mod.split('.').pop()}`, '', '']
    if (!fns.length) lines.push('def test_example():', '    assert 1 + 1 == 2', '')
    for (const m of fns) {
      const args = m[2].split(',').map(a => a.trim()).filter(a => a && a !== 'self' && !a.startsWith('*')).map(a => a.split(/[:=]/)[0].trim())
      lines.push(`def test_${m[1]}():`, `    # ${m[1]}(${args.join(', ')}) の結果を確かめる`, `    assert ${m[1]}(${args.map(() => '...').join(', ')}) == ...`, '', '')
    }
    await newFile(path, lines.join('\n').replace(/\n+$/, '\n'))
    await app.editors.open(path)
    toast(`${path} を作りました。... を実際の値に書き換えてください`, { icon: 'beaker', duration: 6000 })
  }
}

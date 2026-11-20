// ブラウザでの通し確認 (E2E):  node tests/e2e/run.mjs
// ・アプリは tools/serve.mjs が配信 (Python に必要な COOP / COEP 付き)。GitHub は偽物 (tests/mock-github.mjs)
// ・配信用 (dist) で起動・実行を確認し、ソースのまま (?src) で中の機能を確認します
// 失敗したときの画面は tests/e2e/out/ に保存します
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer } from '../../tools/serve.mjs'
import { createMockGitHub } from '../mock-github.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, 'out')
mkdirSync(OUT, { recursive: true })
let playwright
for (const from of [path.join(here, '../../tools/package.json'), import.meta.url]) {
  try { playwright = createRequire(from)('playwright'); break } catch {}
}
if (!playwright) { console.error('playwright が見つかりません (cd tools && npm ci)'); process.exit(1) }
const { chromium, devices } = playwright

const web = createServer()
await new Promise(r => web.server.listen(0, '127.0.0.1', r))
const APP = `http://127.0.0.1:${web.server.address().port}/`
const gh = createMockGitHub()
await new Promise(r => gh.server.listen(0, '127.0.0.1', r))
const GH_API = `http://127.0.0.1:${gh.server.address().port}`

const browser = await chromium.launch()
let failed = 0
const results = []
async function step(page, name, fn) {
  const t0 = Date.now()
  try { await fn(); results.push(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`) } catch (e) {
    failed++
    results.push(`✗ ${name}: ${String(e.message).split('\n').slice(0, 12).join('\n    ')}`)
    try { await page.screenshot({ path: path.join(OUT, name.replace(/[^\w-]+/g, '_') + '.png') }) } catch {}
  }
}
async function open(url, { github = false } = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  if (github) await ctx.addInitScript(api => localStorage.setItem('forgecode.github', JSON.stringify({ token: 'tok', repo: 'me/proj', dir: 'forgecode', auto: false, api })), GH_API)
  // console.error に渡されたエラーの場所 (stack) も記録する
  await ctx.addInitScript(() => { const o = console.error; window.__errs = []; console.error = (...a) => { try { window.__errs.push(a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 1500)) } catch {} o.apply(console, a) } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error' && !/status of 409/.test(m.text())) errors.push('console: ' + m.text()) })
  await page.goto(url)
  await page.waitForSelector('.onboard, .cm-editor', { timeout: 30000 })
  for (let i = 0; i < 6; i++) {
    const b = page.locator('.onboard button:has-text("スキップ")').first()
    if (await b.count()) { await b.click(); await page.waitForTimeout(300) } else break
  }
  await page.waitForSelector('.cm-editor', { timeout: 30000 })
  return { ctx, page, errors }
}
const output = page => page.evaluate(() => (document.querySelector('.output') || {}).innerText || '')

// ---- 1. 配信用 (dist) ----
{
  const { ctx, page, errors } = await open(APP)
  await step(page, 'dist: boots from bundled files', async () => {
    const src = await page.evaluate(() => performance.getEntriesByType('resource').some(e => /\/js\/app\//.test(e.name)))
    if (src) throw new Error('loaded unbundled sources')
  })
  await step(page, 'dist: run the template (Python + input)', async () => {
    await page.locator('.run-btn').click()
    await page.waitForFunction(() => /こんにちは、Python!/.test(document.querySelector('.output')?.innerText || ''), null, { timeout: 90000 })
    // input() の入力欄に名前を入れる
    await page.waitForSelector('.out-input-field', { timeout: 30000 })
    await page.fill('.out-input-field', 'テスト')
    await page.press('.out-input-field', 'Enter')
    await page.waitForFunction(() => /テスト さん、ようこそ!/.test(document.querySelector('.output')?.innerText || ''), null, { timeout: 30000 })
  })
  await step(page, 'dist: no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
  await ctx.close()
}

// ---- 1b. 落ちたあとの起動 (安全モード・AI の自動読み込みの停止) ----
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('forgecode.settings.v1', JSON.stringify({ onboarded: true, design: 3, python: 1 }))
    localStorage.setItem('forgecode.session-health.v1', JSON.stringify({ t: Date.now() - 5000, clean: false, stable: false, streak: 1, llm: true }))
  })
  const page = await ctx.newPage()
  await step(page, 'crash loop: starts in safe mode and stops AI auto-load', async () => {
    await page.goto(APP)
    await page.waitForSelector('.cm-editor', { timeout: 30000 })
    await page.waitForFunction(() => /自動では読み込まない/.test([...document.querySelectorAll('.toast')].map(t => t.innerText).join(' ')), null, { timeout: 10000 })
    const st = await page.evaluate(() => ({ h: JSON.parse(localStorage.getItem('forgecode.session-health.v1')), noauto: localStorage.getItem('forgecode.llm.noauto') }))
    if (!st.h.safe || st.noauto !== '1') throw new Error(JSON.stringify(st))
    // 安全モードでも実行はできる
    await page.locator('.run-btn').first().click()
    await page.waitForFunction(() => /こんにちは、Python!/.test(document.querySelector('.output')?.innerText || ''), null, { timeout: 90000 })
  })
  await ctx.close()
}

// ---- 2. ソースのまま (?src): 中の機能 ----
{
  const { ctx, page, errors } = await open(APP + '?src', { github: true })
  await page.evaluate(async () => { window.__app = (await import('/js/app/app.js')).app })
  const setDoc = t => page.evaluate(t => { const v = window.__app.editors.activeView(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } }) }, t)

  const run = () => page.evaluate(() => window.__app.commands.get('run').run())
  const waitOut = (re, timeout = 60000) => page.waitForFunction(re => new RegExp(re).test(document.querySelector('.output')?.innerText || ''), re, { timeout })
  await step(page, 'src: run prints output', async () => {
    await setDoc('for i in range(1, 4):\n    print("line", i)\nprint("DONE")\n')
    await run()
    await waitOut('line 3[\\s\\S]*DONE')
  })
  await step(page, 'src: runtime error shows a line link and an explanation', async () => {
    await setDoc('names = ["a"]\nprint(names[3])\n')
    await run()
    await page.waitForSelector('.out-error', { timeout: 60000 })
    const t = await page.evaluate(() => document.querySelector('.out-error').innerText)
    if (!/IndexError/.test(t) || !/2 行目/.test(t)) throw new Error(t)
  })
  await step(page, 'src: stop an infinite loop', async () => {
    await setDoc('n = 0\nwhile True:\n    n += 1\n')
    await run()
    await page.waitForTimeout(800)
    await page.evaluate(() => window.__app.commands.get('stop').run())
    await waitOut('KeyboardInterrupt|停止|止め', 20000)
  })
  const hasDiag = re => page.evaluate(async re => {
    const { forEachDiagnostic } = await import('/vendor/codemirror.js')
    let hit = false
    forEachDiagnostic(window.__app.editors.activeView().state, d => { if (new RegExp(re).test(d.message)) hit = true })
    return hit
  }, re)
  await step(page, 'src: pyflakes warning appears and clears', async () => {
    await setDoc('total = 1\nprint(totl)\n')
    let seen = false
    for (let i = 0; i < 160 && !seen; i++) { await page.waitForTimeout(250); seen = await hasDiag('totl') }
    if (!seen) throw new Error('no undefined-name warning')
    await setDoc('total = 1\nprint(total)\n')
    let gone = false
    for (let i = 0; i < 60 && !gone; i++) { await page.waitForTimeout(250); gone = !(await hasDiag('totl')) }
    if (!gone) throw new Error('warning stayed after the fix')
  })
  await step(page, 'src: jedi completion', async () => {
    await setDoc('import math\nmath.sq')
    const names = await page.evaluate(async () => {
      const { pyTools } = await import('/js/editor/python.js')
      const r = await pyTools('complete', { code: 'import math\nmath.sq', line: 2, col: 7, path: 'main.py' })
      return r.map(c => c.name)
    })
    if (!names.includes('sqrt')) throw new Error(names.join(','))
  })
  await step(page, 'src: pre-run check (input() used as a number) with a one-tap fix', async () => {
    await setDoc('age = input("年齢: ")\nprint(age + 1)\n')
    let seen = false
    for (let i = 0; i < 120 && !seen; i++) { await page.waitForTimeout(250); seen = await hasDiag('input\\(\\) の結果なので文字列') }
    if (!seen) throw new Error('no check warning')
    await page.evaluate(async () => {
      const { forEachDiagnostic } = await import('/vendor/codemirror.js')
      const v = window.__app.editors.activeView()
      forEachDiagnostic(v.state, (d, from, to) => { if (/input\(\)/.test(d.message) && d.actions) d.actions[0].apply(v, from, to) })
    })
    const doc = await page.evaluate(() => window.__app.editors.activeView().state.doc.toString())
    if (!/age = int\(input\("年齢: "\)\)/.test(doc)) throw new Error(doc)
  })
  await step(page, 'src: auto-import completion adds the import line', async () => {
    await setDoc('x = sqr')
    await page.evaluate(() => { const v = window.__app.editors.activeView(); v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }) })
    const { startCompletion, acceptCompletion, currentCompletions } = { startCompletion: 'startCompletion', acceptCompletion: 'acceptCompletion', currentCompletions: 'currentCompletions' }
    await page.evaluate(async names => {
      const cm = await import('/vendor/codemirror.js')
      cm[names.startCompletion](window.__app.editors.activeView())
    }, { startCompletion })
    let picked = false
    for (let i = 0; i < 60 && !picked; i++) {
      await page.waitForTimeout(200)
      picked = await page.evaluate(async names => {
        const cm = await import('/vendor/codemirror.js')
        const v = window.__app.editors.activeView()
        const list = cm[names.currentCompletions](v.state)
        const idx = list.findIndex(c => c.label === 'sqrt' && /from math import sqrt/.test(c.detail || ''))
        if (idx < 0) return false
        v.dispatch({ effects: cm.setSelectedCompletion(idx) })
        return cm[names.acceptCompletion](v)
      }, { currentCompletions, acceptCompletion })
    }
    const doc = await page.evaluate(() => window.__app.editors.activeView().state.doc.toString())
    if (!/^from math import sqrt\nx = sqrt$/.test(doc)) throw new Error(JSON.stringify(doc))
  })
  await step(page, 'src: turtle draws and takes key input', async () => {
    await setDoc(`import turtle
wn = turtle.Screen()
p = turtle.Turtle()
p.speed(0)
p.circle(40)
p.penup()
def up():
    p.sety(p.ycor() + 10)
    if p.ycor() >= 29.9:
        print("moved", p.position())
        wn.bye()
wn.onkeypress(up, "Up")
wn.listen()
turtle.done()
`)
    await run()
    await page.waitForSelector('.out-turtle canvas.tt-top', { timeout: 60000 })
    await waitOut('キー操作・クリックを待っています', 30000)
    await page.focus('.out-turtle canvas.tt-top')
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowUp'); await page.waitForTimeout(120) }
    await waitOut('moved \\(-?0\\.00,30\\.00\\)', 20000).catch(async () => { throw new Error('output: ' + (await output(page)).slice(-400)) })
    // 線が描かれている (真っ白ではない)
    const ink = await page.evaluate(() => { const c = document.querySelector('.out-turtle canvas.tt-base'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n })
    if (ink < 50) throw new Error('nothing drawn: ' + ink)
  })
  await step(page, 'src: full-screen run view with a back button', async () => {
    await setDoc('print("full screen")\n')
    await run()
    await waitOut('full screen')
    if (!(await page.evaluate(() => !!document.querySelector('.panel.run-full')))) throw new Error('not full screen')
    await page.waitForFunction(() => /完了/.test(document.querySelector('.run-head')?.innerText || ''), null, { timeout: 20000 })
    await page.click('.rh-back')
    await page.waitForFunction(() => !document.querySelector('.panel.run-full'), null, { timeout: 5000 })
  })
  await step(page, 'src: pygame draws frames and takes keys', async () => {
    await setDoc(`import pygame
pygame.init()
screen = pygame.display.set_mode((200, 150))
clock = pygame.time.Clock()
x = 0
for frame in range(1200):
    for e in pygame.event.get():
        if e.type == pygame.KEYDOWN and e.key == pygame.K_RIGHT:
            print("right pressed", frame > 3)
            raise SystemExit
    screen.fill((0, 0, 80))
    pygame.draw.rect(screen, (255, 0, 0), (x, 50, 20, 20))
    x = (x + 2) % 200
    pygame.display.flip()
    clock.tick(60)
`)
    await run()
    await page.waitForSelector('.out-surface[data-kind=pg] canvas', { timeout: 60000 })
    await page.waitForTimeout(400)
    const px = await page.evaluate(() => { const c = document.querySelector('.out-surface[data-kind=pg] canvas'); return [...c.getContext('2d').getImageData(2, 2, 1, 1).data] })
    if (px[2] < 60 || px[0] > 20) throw new Error('frame not drawn: ' + px)
    await page.keyboard.press('ArrowRight')
    await waitOut('right pressed True', 20000)
    await page.click('.rh-back')
  })
  await step(page, 'src: tkinter window with a working button', async () => {
    await setDoc(`import tkinter as tk
root = tk.Tk()
v = tk.StringVar(value="0")
def inc():
    v.set(str(int(v.get()) + 1))
    if v.get() == "2":
        print("clicked twice")
        root.destroy()
tk.Label(root, textvariable=v).pack()
tk.Button(root, text="押す", command=inc).pack()
root.mainloop()
`)
    await run()
    await page.waitForSelector('.tk-win .tk-button', { timeout: 60000 })
    await page.click('.tk-win .tk-button')
    await page.waitForFunction(() => /^1$/.test(document.querySelector('.tk-win .tk-label')?.innerText || ''), null, { timeout: 10000 })
    await page.click('.tk-win .tk-button')
    await waitOut('clicked twice', 15000)
    await page.click('.rh-back')
  })
  await step(page, 'src: asyncio, threads and display()', async () => {
    await setDoc('import asyncio, threading\nasync def main():\n    await asyncio.sleep(0.05)\n    return "async ok"\nprint(asyncio.run(main()))\nt = threading.Thread(target=lambda: print("thread ok"))\nt.start(); t.join()\nclass T:\n    def _repr_html_(self):\n        return "<table><tr><td>cell</td></tr></table>"\ndisplay(T())\n')
    await run()
    await waitOut('async ok[\\s\\S]*thread ok[\\s\\S]*cell', 60000)
  })
  await step(page, 'src: debugger stops at a breakpoint', async () => {
    await setDoc('total = 0\nfor i in range(3):\n    total += i\nprint("sum", total)\n')
    await page.evaluate(async () => {
      const bp = await import('/js/editor/breakpoints.js')
      const v = window.__app.editors.activeView()
      bp.toggleBreakpoint(v, 3)
    })
    await run()
    await page.waitForSelector('.debug-float.is-paused, .dbg-state.paused', { timeout: 60000 })
    await page.evaluate(() => window.__app.commands.get('debugContinue').run())
    await page.waitForTimeout(300)
    await page.evaluate(() => window.__app.commands.get('debugContinue').run())
    await page.waitForTimeout(300)
    await page.evaluate(() => window.__app.commands.get('debugContinue').run())
    await waitOut('sum 3', 30000)
  })
  await step(page, 'src: AI answers a question', async () => {
    const r = await page.evaluate(async () => (await import('/js/app/ai-host.js')).askAi({ text: 'リストの使い方は?' }))
    if (!/append/.test(r.text)) throw new Error(r.text.slice(0, 120))
  })
  await step(page, 'src: AI fixes the open file', async () => {
    await setDoc('def f(x)\n    return x\nprnt(f(1))\n')
    const r = await page.evaluate(async () => (await import('/js/app/ai-host.js')).askAi({ text: '直して' }))
    const now = await page.evaluate(() => window.__app.editors.activeView().state.doc.toString())
    if (now !== 'def f(x):\n    return x\nprint(f(1))\n') throw new Error(now + ' / ' + r.text.slice(0, 120))
  })
  // ---- v14: ターミナル・24 時間動かす・整理 ----
  const termType = async line => { await page.fill('.term-input', line); await page.press('.term-input', 'Enter') }
  const termIdle = (ms = 60000) => page.waitForFunction(() => !document.querySelector('.term.busy'), null, { timeout: ms })
  const termText = () => page.evaluate(() => document.querySelector('.term-screen').innerText)
  await step(page, 'src: terminal (full screen on phones) runs shell commands', async () => {
    await page.evaluate(() => window.__app.commands.get('terminal').run())
    await page.waitForSelector('.panel.term-full .term-input', { timeout: 15000 })
    await termType('mkdir -p tdemo && cd tdemo && printf "import sys\\nprint(sys.argv[1:], input())\\n" > args.py && ls')
    await termIdle()
    if (!/args\.py/.test(await termText())) throw new Error(await termText())
    const inTree = await page.evaluate(() => window.__app.files.some(f => f.path === 'tdemo/args.py'))
    if (!inTree) throw new Error('file not in the project')
  })
  await step(page, 'src: terminal runs python with argv, input() and pipes', async () => {
    await termType('python args.py one two')
    await page.waitForSelector('.term-in.waiting', { timeout: 60000 })
    await termType('typed')
    await termIdle()
    await termType('echo piped | python args.py x | tr a-z A-Z')
    await termIdle()
    const t = await termText()
    if (!/\['one', 'two'\] typed/.test(t) || !/\['X'\] PIPED/.test(t)) throw new Error(t.slice(-600))
  })
  await step(page, 'src: terminal python REPL and Ctrl+C', async () => {
    await termType('python')
    await termIdle()
    await termType('def sq(n):')
    await termIdle()
    await termType('    return n * n')
    await termIdle()
    await termType('')
    await termIdle()
    await termType('sq(12)')
    await termIdle()
    await termType('exit()')
    await termIdle()
    await termType('python -c "while True: pass"')
    await page.waitForTimeout(1200)
    await page.focus('.term-input')
    await page.keyboard.press('Control+c')
    await termIdle(15000)
    const t = await termText()
    if (!/^144$/m.test(t) || !/KeyboardInterrupt/.test(t)) throw new Error(t.slice(-600))
    await page.click('.term-head .rh-back')
    await page.waitForFunction(() => !document.querySelector('.panel.term-full'), null, { timeout: 5000 })
  })
  await step(page, 'src: colored output and automatic restart after an error', async () => {
    await page.evaluate(() => window.__app.runner.restartPython())
    await page.evaluate(() => { localStorage.setItem('fc-runs', '0') })
    await setDoc('print("\\033[31mred\\033[0m")\nraise RuntimeError("boom")\n')
    await page.evaluate(async () => (await import('/js/app/store.js')).setSettings({ autoRestart: true }))
    await run()
    await page.waitForFunction(() => document.querySelector('.output .af1, .output .af9'), null, { timeout: 60000 })
    await waitOut('秒後に自動で再実行', 30000)
    await waitOut('秒後に自動で再実行[\\s\\S]*RuntimeError[\\s\\S]*2 回目', 30000)
    await page.evaluate(async () => { (await import('/js/app/store.js')).setSettings({ autoRestart: false }); window.__app.commands.get('stop').run() })
    await page.evaluate(() => window.__app.runner.exitFull())
  })
  await step(page, 'src: command palette lists all features by category', async () => {
    await page.evaluate(() => window.__app.commands.get('palette').run())
    await page.waitForSelector('.palette-head', { timeout: 5000 })
    const heads = await page.evaluate(() => [...document.querySelectorAll('.palette-head')].map(e => e.textContent))
    if (!heads.includes('ターミナル') || !heads.includes('実行')) throw new Error(heads.join(','))
    await page.keyboard.press('Escape')
  })
  await step(page, 'src: GitHub sync push and pull', async () => {
    const name = await page.evaluate(() => window.__app.project.name)
    const file = await page.evaluate(() => window.__app.editors.activeDoc().path)
    await setDoc('print("synced")\n')
    await page.evaluate(async () => (await import('/js/app/github-sync.js')).syncPush({ quiet: true }))
    const rf = gh.remoteFiles()
    if (rf[`forgecode/${name}/${file}`] !== 'print("synced")\n') throw new Error(Object.keys(rf).join(', '))
    gh.remoteEdit({ [`forgecode/${name}/${file}`]: 'print("from github")\n' })
    await page.evaluate(async () => (await import('/js/app/github-sync.js')).syncPull({ quiet: true }))
    const now = await page.evaluate(() => window.__app.editors.activeView().state.doc.toString())
    if (now !== 'print("from github")\n') throw new Error(now)
  })
  await step(page, 'src: no console errors', async () => {
    if (!errors.length) return
    const stacks = await page.evaluate(() => window.__errs || []).catch(() => [])
    throw new Error(errors.join(' | ') + (stacks.length ? '\n' + stacks.join('\n') : ''))
  })
  await ctx.close()
}

await browser.close()
web.server.close()
gh.server.close()
console.log(results.join('\n'))
console.log(failed ? `${failed} step(s) failed (screenshots: tests/e2e/out/)` : 'e2e: all passed')
process.exit(failed ? 1 : 0)

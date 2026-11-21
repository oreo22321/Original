// v15 の新しい機能の通し確認 (git・テスト・プロファイル・Web プレビュー):  node tests/e2e/v15.mjs
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer } from '../../tools/serve.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, 'out')
mkdirSync(OUT, { recursive: true })
let playwright
for (const from of [path.join(here, '../../tools/package.json'), import.meta.url]) { try { playwright = createRequire(from)('playwright'); break } catch {} }
const { chromium, devices } = playwright
const web = createServer()
await new Promise(r => web.server.listen(0, '127.0.0.1', r))
const APP = `http://127.0.0.1:${web.server.address().port}/`
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
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto(APP + '?src')
await page.waitForSelector('.onboard, .cm-editor', { timeout: 30000 })
for (let i = 0; i < 6; i++) { const b = page.locator('.onboard button:has-text("スキップ")').first(); if (await b.count()) { await b.click(); await page.waitForTimeout(300) } else break }
await page.waitForSelector('.cm-editor', { timeout: 30000 })
await page.evaluate(async () => { window.__app = (await import('/js/app/app.js')).app; window.__appmod = await import('/js/app/app.js') })
const setDoc = t => page.evaluate(t => { const v = window.__app.editors.activeView(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } }) }, t)
const TI = '.term:not(.hidden) .term-input'
const termType = async t => { await page.locator(TI).fill(t); await page.locator(TI).press('Enter') }
const termIdle = (ms = 60000) => page.waitForFunction(() => !document.querySelector('.term.busy'), null, { timeout: ms })
const termText = () => page.evaluate(() => document.querySelector('.term:not(.hidden) .term-screen').innerText)

await step(page, 'v15: git in the terminal', async () => {
  await page.evaluate(() => window.__app.commands.get('terminal').run())
  await page.waitForSelector('.panel.term-full ' + TI, { timeout: 15000 })
  await termType('git init && git add . && git commit -m "はじめ" && git log --oneline')
  await termIdle()
  const t = await termText()
  if (!/\[main [0-9a-f]{7}\] はじめ/.test(t) || !/HEAD -> main/.test(t)) throw new Error(t.slice(-800))
  await page.evaluate(() => window.__app.runner.closeTerminal())
})
await step(page, 'v15: source control view shows changes and commits', async () => {
  await setDoc('print("changed")\n')
  await page.evaluate(() => window.__app.editors.saveAll())
  await page.evaluate(() => window.__app.wb.showView('scm'))
  await page.waitForSelector('.scm-row', { timeout: 15000 })
  await page.fill('.scm-msg', '変更した')
  await page.click('.scm-commit-btn')
  await page.waitForFunction(() => [...document.querySelectorAll('.scm-cmsg')].some(e => e.textContent === '変更した'), null, { timeout: 15000 })
  if (await page.locator('.scm-row').count()) throw new Error('changes left after commit')
  await page.locator('.scm-commit:has-text("はじめ")').first().click()
  await page.waitForSelector('.modal .scm-cfile', { timeout: 5000 })
  await page.locator('.modal .scm-cfile').first().click()
  await page.waitForSelector('.diff-view .dl', { timeout: 5000 })
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(e => e.remove()))
})
await step(page, 'v15: tests view runs tests', async () => {
  await page.evaluate(async () => {
    await window.__appmod.newFile('calc.py', 'def add(a, b):\n    return a + b\n')
    await window.__appmod.newFile('test_calc.py', 'from calc import add\n\ndef test_ok():\n    assert add(1, 2) == 3\n\ndef test_bad():\n    assert add(2, 2) == 5\n')
  })
  await page.evaluate(() => window.__app.commands.get('runTests').run())
  await page.waitForSelector('.tv-badge.ok', { timeout: 60000 })
  await page.waitForSelector('.tv-fail', { timeout: 30000 })
  const fail = await page.locator('.tv-fail').first().innerText()
  if (!/assert 4 == 5/.test(fail)) throw new Error(fail)
  const sum = await page.locator('.tv-summary').innerText()
  if (!/1[\s\S]*1/.test(sum)) throw new Error(sum)
})
await step(page, 'v15: pytest in the terminal', async () => {
  await page.evaluate(() => window.__app.commands.get('terminal').run())
  await page.waitForSelector('.panel.term-full ' + TI, { timeout: 15000 })
  await termType('pytest -q')
  await termIdle()
  const t = await termText()
  if (!/1 失敗, 1 成功/.test(t)) throw new Error(t.slice(-600))
  await page.evaluate(() => window.__app.runner.closeTerminal())
})
await step(page, 'v15: profile run shows the table', async () => {
  await page.evaluate(() => window.__app.wb.toggleSidebar(false))
  await page.evaluate(() => window.__app.editors.open('main.py'))
  await setDoc('def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\nprint(fib(15))\n')
  await page.evaluate(() => window.__app.commands.get('profileRun').run())
  await page.waitForSelector('.pf-row.mine', { timeout: 60000 })
  const t = await page.locator('.pf').innerText()
  if (!/fib/.test(t)) throw new Error(t)
  await page.evaluate(() => window.__app.runner.exitFull())
})
await step(page, 'v15: web preview of an HTML file', async () => {
  await page.evaluate(async () => {
    await window.__appmod.newFile('site/index.html', '<!doctype html><html><head><title>t</title><link rel="stylesheet" href="style.css"></head><body><h1 id="t">こんにちは</h1><a id="go" href="/site/b.html">b</a><script src="app.js"></script></body></html>')
    await window.__appmod.newFile('site/style.css', 'h1 { color: rgb(255, 0, 0) }')
    await window.__appmod.newFile('site/app.js', 'console.log("from js"); document.body.append(Object.assign(document.createElement("p"), { id: "js", textContent: "js ok" }))')
    await window.__appmod.newFile('site/b.html', '<p id="b">page b</p>')
  })
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 })
  await page.evaluate(() => import('/js/app/preview.js').then(m => m.openPreview('/site/index.html')))
  const f = page.frameLocator('.pv-frame')
  await f.locator('#t').waitFor({ timeout: 20000 })
  await f.locator('#js').waitFor({ timeout: 10000 })
  const color = await f.locator('#t').evaluate(e => getComputedStyle(e).color)
  if (color !== 'rgb(255, 0, 0)') throw new Error('css not applied: ' + color)
  await f.locator('#go').click()
  await f.locator('#b').waitFor({ timeout: 10000 })
  await page.waitForFunction(() => document.querySelector('.pv-badge') && !document.querySelector('.pv-badge').classList.contains('hidden'), null, { timeout: 5000 })
  await page.evaluate(() => import('/js/app/preview.js').then(m => m.closePreview()))
})
await step(page, 'v15: Python web app (WSGI) in the preview', async () => {
  await page.evaluate(() => window.__app.editors.open('main.py'))
  await setDoc('from wsgiref.simple_server import make_server\n\ndef app(env, start):\n    start("200 OK", [("Content-Type", "text/html; charset=utf-8")])\n    return [("<h1 id=w>Python %s</h1><a id=l href=/about>about</a>" % env["PATH_INFO"]).encode()]\n\nmake_server("", 8000, app).serve_forever()\n')
  await page.evaluate(() => window.__app.commands.get('run').run())
  await page.waitForSelector('.web-card', { timeout: 60000 })
  const f = page.frameLocator('.pv-frame')
  await f.locator('#w').waitFor({ timeout: 20000 })
  const t1 = await f.locator('#w').innerText()
  if (t1 !== 'Python /') throw new Error(t1)
  await f.locator('#l').click()
  await page.waitForFunction(() => { try { return document.querySelector('.pv-frame').contentDocument.querySelector('#w').textContent === 'Python /about' } catch { return false } }, null, { timeout: 15000 })
  await page.evaluate(() => import('/js/app/preview.js').then(m => m.closePreview()))
})
await step(page, 'v15: notebook runs cells with shared variables, tables and figures', async () => {
  await page.evaluate(() => window.__app.commands.get('newNotebook').run())
  await page.waitForSelector('.nb .nb-cell.code', { timeout: 15000 })
  // 最初のコードのセル (x = 21 / x * 2) を実行
  await page.locator('.nb .nb-cell.code .nb-run').first().click()
  await page.waitForFunction(() => /42/.test(document.querySelector('.nb .nb-cell.code .nb-out')?.textContent || ''), null, { timeout: 60000 })
  // 下にセルを足して、前のセルの変数・print・図を使う
  await page.locator('.nb .nb-add button:has-text("コード")').click()
  const ed = page.locator('.nb .nb-cell.code .cm-content').last()
  await ed.click()
  await page.keyboard.insertText('print("x is", x)\nclass T:\n    def _repr_html_(self):\n        return "<table><tr><td id=cellv>" + str(x) + "</td></tr></table>"\n\nT()')
  await page.keyboard.press('Shift+Enter')
  await page.waitForFunction(() => /x is 21/.test(document.querySelector('.nb').textContent), null, { timeout: 90000 })
  await page.waitForSelector('.nb .nb-html table', { timeout: 30000 })
  // エラーも出る
  await page.locator('.nb .nb-add button:has-text("コード")').click()
  await page.locator('.nb .nb-cell.code .cm-content').last().click()
  await page.keyboard.insertText('1 / 0')
  await page.keyboard.press('Control+Enter')
  await page.waitForSelector('.nb .nb-stream.err', { timeout: 30000 })
  // 保存された .ipynb
  await page.waitForTimeout(1200)
  const saved = await page.evaluate(() => window.__app.contents.get('notebook.ipynb'))
  const nb = JSON.parse(saved)
  if (nb.nbformat !== 4 || !nb.cells.some(c => c.outputs && c.outputs.some(o => o.output_type === 'execute_result' && /42/.test(o.data['text/plain'])))) throw new Error(saved.slice(0, 600))
  if (!nb.cells.some(c => c.outputs && c.outputs.some(o => o.data && o.data['text/html'] && /cellv/.test(o.data['text/html'])))) throw new Error('no html saved')
  if (!nb.cells.some(c => c.outputs && c.outputs.some(o => o.output_type === 'error' && o.ename === 'ZeroDivisionError'))) throw new Error('no error saved: ' + JSON.stringify(nb.cells.map(c => c.outputs)).slice(0, 500))
  await page.click('.nb .nb-bar button:has-text("戻る")')
})
await step(page, 'v15: more menu shows the version', async () => {
  await page.evaluate(() => window.__app.runner.exitFull && window.__app.runner.exitFull())
  await page.click('.top-actions button[aria-label="その他"]')
  await page.waitForSelector('.menu-list', { timeout: 5000 })
  const mt = await page.locator('.menu-list').evaluate(e => e.textContent)
  if (!/ForgeCode 15\.0\.0/.test(mt)) throw new Error(mt)
  await page.keyboard.press('Escape')
})
await step(page, 'v15: no console errors', async () => { const e = errors.filter(x => !/favicon|status of 404/.test(x)); if (e.length) throw new Error(e.join(' | ')) })

await ctx.close()
await browser.close()
web.server.close()
console.log(results.join('\n'))
process.exit(failed ? 1 : 0)

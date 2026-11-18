// ブラウザでの通し確認 (E2E):  node tests/e2e/run.mjs
// ・アプリは中継サーバー (relay/server.mjs) が配信。GitHub は偽物 (tests/mock-github.mjs)
// ・配信用 (dist) で起動・実行を確認し、ソースのまま (?src) で中の機能を確認します
// 失敗したときの画面は tests/e2e/out/ に保存します
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRelay } from '../../relay/server.mjs'
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

const relay = createRelay()
await new Promise(r => relay.server.listen(0, '127.0.0.1', r))
const APP = `http://127.0.0.1:${relay.server.address().port}/`
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
    results.push(`✗ ${name}: ${String(e.message).split('\n')[0]}`)
    try { await page.screenshot({ path: path.join(OUT, name.replace(/[^\w-]+/g, '_') + '.png') }) } catch {}
  }
}
async function open(url, { github = false } = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  if (github) await ctx.addInitScript(api => localStorage.setItem('forgecode.github', JSON.stringify({ token: 'tok', repo: 'me/proj', dir: 'forgecode', auto: false, api })), GH_API)
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
  await step(page, 'dist: run the template', async () => {
    await page.locator('.run-btn').click()
    await page.waitForFunction(() => /コイン/.test(document.querySelector('.output')?.innerText || ''), null, { timeout: 30000 })
  })
  await step(page, 'dist: no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
  await ctx.close()
}

// ---- 2. ソースのまま (?src): 中の機能 ----
{
  const { ctx, page, errors } = await open(APP + '?src', { github: true })
  await page.evaluate(async () => { window.__app = (await import('/js/app/app.js')).app })
  const setDoc = t => page.evaluate(t => { const v = window.__app.editors.activeView(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } }) }, t)

  await step(page, 'src: run prints output', async () => {
    await setDoc('for i = 1, 3 do print("line", i) end\nprint("DONE")\n')
    await page.evaluate(() => window.__app.commands.get('run').run())
    await page.waitForFunction(() => /DONE/.test(document.querySelector('.output')?.innerText || ''), null, { timeout: 30000 })
  })
  await step(page, 'src: runtime error shows a line link', async () => {
    await setDoc('local t = nil\nprint(t.x)\n')
    await page.evaluate(() => window.__app.commands.get('run').run())
    await page.waitForSelector('.out-error', { timeout: 30000 })
    if (!/2 行目/.test(await page.evaluate(() => document.querySelector('.out-error').innerText))) throw new Error(await output(page))
  })
  const hasDiag = re => page.evaluate(async re => {
    const { forEachDiagnostic } = await import('/vendor/codemirror.js')
    let hit = false
    forEachDiagnostic(window.__app.editors.activeView().state, d => { if (new RegExp(re).test(d.message)) hit = true })
    return hit
  }, re)
  await step(page, 'src: type check warning (lint worker)', async () => {
    if (await hasDiag('Transparency')) throw new Error('diagnostic before the code exists')
    await setDoc('local p = Instance.new("Part")\np.Transparency = "0.5"\n' + '-- filler\n'.repeat(400))
    let seen = false
    for (let i = 0; i < 60 && !seen; i++) { await page.waitForTimeout(250); seen = await hasDiag('Transparency') }
    if (!seen) throw new Error('no type warning')
    // 直したら消える
    await setDoc('local p = Instance.new("Part")\np.Transparency = 0.5\n' + '-- filler\n'.repeat(400))
    let gone = false
    for (let i = 0; i < 60 && !gone; i++) { await page.waitForTimeout(250); gone = !(await hasDiag('Transparency')) }
    if (!gone) throw new Error('warning stayed after the fix')
  })
  await step(page, 'src: AI answers a question', async () => {
    const r = await page.evaluate(async () => (await import('/js/app/ai-host.js')).askAi({ text: 'RemoteEvent の使い方は?' }))
    if (!/FireServer/.test(r.text)) throw new Error(r.text.slice(0, 120))
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
  await step(page, 'src: no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
  await ctx.close()
}

await browser.close()
relay.server.close()
gh.server.close()
console.log(results.join('\n'))
console.log(failed ? `${failed} step(s) failed (screenshots: tests/e2e/out/)` : 'e2e: all passed')
process.exit(failed ? 1 : 0)

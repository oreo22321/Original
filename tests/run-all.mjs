// すべてのユニットテストを実行:  node tests/run-all.mjs
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const files = readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort()
let failed = 0
for (const f of files) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 300000 })
  const last = (r.stdout || '').trim().split('\n').pop() || ''
  const ok = r.status === 0
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${f.padEnd(22)} ${last}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  if (!ok) console.log((r.stdout || '') + (r.stderr || ''))
}
console.log(failed ? `${failed} test file(s) failed` : `all ${files.length} test files passed`)
process.exit(failed ? 1 : 0)

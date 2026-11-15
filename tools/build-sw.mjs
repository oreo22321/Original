// sw.js のキャッシュ対象リストとバージョンを更新します:  node tools/build-sw.mjs
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = ['./', 'index.html', 'manifest.webmanifest']
// 高性能モード (端末内 LLM) は使う人だけが読み込む大きなファイルなので、事前キャッシュしない (使ったときにキャッシュされる)
const LAZY = new Set(['vendor/web-llm.js', 'js/workers/llm-worker.js', 'vendor/LICENSES.txt'])
const walk = dir => {
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = dir + '/' + name
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel)
    else if (!/\.(map|DS_Store)$/.test(name) && !LAZY.has(rel)) files.push(rel)
  }
}
for (const d of ['css', 'js', 'vendor', 'data', 'icons', 'live']) walk(d)

// index.html: 起動時に読み込むモジュールをすべて先読みする (import をたどって順に読むと、回線の往復の数だけ待つため)
const graph = new Set()
const visit = rel => {
  if (graph.has(rel)) return
  graph.add(rel)
  const src = readFileSync(path.join(root, rel), 'utf8')
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
    const spec = m[1] || m[2]
    if (spec.startsWith('.')) visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)))
  }
}
visit('js/app/main.js')
const preload = [...graph].filter(f => f !== 'js/app/main.js').sort((a, b) => (a.startsWith('vendor/') ? -1 : 0) - (b.startsWith('vendor/') ? -1 : 0) || a.localeCompare(b))
const indexPath = path.join(root, 'index.html')
let html = readFileSync(indexPath, 'utf8')
const block = '<!-- modulepreload:start (tools/build-sw.mjs) -->\n' + preload.map(f => `  <link rel="modulepreload" href="${f}">`).join('\n') + '\n  <!-- modulepreload:end -->'
if (/<!-- modulepreload:start[\s\S]*?<!-- modulepreload:end -->/.test(html)) html = html.replace(/<!-- modulepreload:start[\s\S]*?<!-- modulepreload:end -->/, block)
else html = html.replace('  <link rel="modulepreload" href="vendor/codemirror.js">', '  ' + block)
writeFileSync(indexPath, html)

const hash = createHash('sha1')
for (const f of files.slice(1)) hash.update(readFileSync(path.join(root, f)))
const version = hash.digest('hex').slice(0, 10)
const swPath = path.join(root, 'sw.js')
let sw = readFileSync(swPath, 'utf8')
sw = sw.replace(/const VERSION = '[^']*'/, `const VERSION = '${version}'`)
sw = sw.replace(/const PRECACHE = \[[\s\S]*?\]\n/, 'const PRECACHE = ' + JSON.stringify(files, null, 2) + '\n')
writeFileSync(swPath, sw)
console.log(`sw.js: ${files.length} files, version ${version}; index.html: ${preload.length} modulepreload`)

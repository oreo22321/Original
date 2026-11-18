// 配信用のファイルを作ります:  node tools/build.mjs
// 1. js/ のソースを esbuild でまとめて圧縮し、dist/ に出力 (起動時に読むファイルの数と大きさを減らす)
//    ・ワーカー (dist/workers/) とあとから読む部分 (dist/chunks/) も別ファイルとして出力
//    ・dist/ は js/ と同じ深さに置くので、ソース中の相対パス (../../data/… など) はそのまま使えます
// 2. index.html の先読み (modulepreload) を、起動時に必要な dist のファイルにする
// 3. sw.js の事前キャッシュの一覧とバージョンを更新
// ソースのまま動かしたいとき (開発・テスト): index.html?src で開く (boot.js が js/app/main.js を読みます)
import { readdirSync, statSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const require = createRequire(path.join(here, 'package.json'))
const esbuild = require('esbuild')

// ---- 1. まとめて圧縮 ----
const DIST = path.join(root, 'dist')
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true })
const ENTRIES = ['js/app/main.js', 'js/workers/luau-worker.js', 'js/workers/lint-worker.js', 'js/workers/llm-worker.js']
const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ENTRIES,
  outdir: 'dist',
  outbase: 'js',
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: ['es2020', 'safari15'],
  entryNames: '[dir]/[name]',
  chunkNames: 'chunks/[name]-[hash]',
  // 大きくて使う人だけが読むもの・ないことがあるものは、まとめずにそのまま読みに行く
  external: ['../../vendor/web-llm.js', '../../data/roblox-api.js'],
  legalComments: 'none',
  charset: 'utf8',
  metafile: true,
  logLevel: 'warning',
})
const outputs = result.metafile.outputs
const rel = p => p.replace(/\\/g, '/')

// ---- 2. 起動時に読むファイル (main と、そこから静的に読み込むチャンク) ----
const startup = new Set()
const visit = file => {
  if (startup.has(file)) return
  startup.add(file)
  for (const imp of outputs[file].imports || []) if (imp.kind === 'import-statement' && outputs[imp.path]) visit(imp.path)
}
visit('dist/app/main.js')
const preload = [...startup].map(rel).sort((a, b) => (a === 'dist/app/main.js' ? -1 : b === 'dist/app/main.js' ? 1 : a.localeCompare(b)))
const indexPath = path.join(root, 'index.html')
let html = readFileSync(indexPath, 'utf8')
const block = '<!-- modulepreload:start (tools/build.mjs) -->\n' + preload.map(f => `  <link rel="modulepreload" href="${f}">`).join('\n') + '\n  <!-- modulepreload:end -->'
if (!/<!-- modulepreload:start[\s\S]*?<!-- modulepreload:end -->/.test(html)) throw new Error('index.html に modulepreload の印がありません')
html = html.replace(/<!-- modulepreload:start[\s\S]*?<!-- modulepreload:end -->/, block)
writeFileSync(indexPath, html)

// ---- 3. Service Worker の事前キャッシュ ----
// 開発用のソース (js/) と、まとめたので使わなくなった vendor のファイルはキャッシュしない (使ったときにキャッシュされる)
const LAZY = new Set(['vendor/web-llm.js', 'dist/workers/llm-worker.js', 'vendor/LICENSES.txt', 'vendor/codemirror.js', 'vendor/fflate.js'])
const files = ['./', 'index.html', 'manifest.webmanifest', 'boot.js']
const walk = dir => {
  for (const name of readdirSync(path.join(root, dir)).sort()) {
    const r = dir + '/' + name
    if (statSync(path.join(root, r)).isDirectory()) walk(r)
    else if (!/\.(map|DS_Store)$/.test(name) && !LAZY.has(r)) files.push(r)
  }
}
for (const d of ['css', 'dist', 'vendor', 'data', 'icons', 'live']) walk(d)
const hash = createHash('sha1')
for (const f of files.slice(1)) hash.update(readFileSync(path.join(root, f)))
const version = hash.digest('hex').slice(0, 10)
const swPath = path.join(root, 'sw.js')
let sw = readFileSync(swPath, 'utf8')
sw = sw.replace(/const VERSION = '[^']*'/, `const VERSION = '${version}'`)
sw = sw.replace(/const PRECACHE = \[[\s\S]*?\]\n/, 'const PRECACHE = ' + JSON.stringify(files, null, 2) + '\n')
writeFileSync(swPath, sw)

// 大きさの報告
const size = f => statSync(path.join(root, f)).size
const startBytes = preload.reduce((n, f) => n + size(f), 0)
const total = Object.keys(outputs).reduce((n, f) => n + size(rel(f)), 0)
console.log(`dist: ${Object.keys(outputs).length} files, ${(total / 1024).toFixed(0)} KB (startup ${preload.length} files, ${(startBytes / 1024).toFixed(0)} KB)`)
console.log(`sw.js: ${files.length} files, version ${version}`)

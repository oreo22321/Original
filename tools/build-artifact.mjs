// claude.ai 版 (Artifact) の公開用ファイルを作ります:  node tools/build-artifact.mjs <出力フォルダ>
// ・claude.ai の画面内で動かすので、Service Worker・マニフェスト・API キー用の SDK は含めません
// ・通信が制限されても動くよう、Roblox API データを JS モジュールとしても置きます
// ・最後に、公開に使うファイル一覧 (公開パス → 出力フォルダ内のパス) を files.json に書きます
//   (Artifact の公開では root に出力フォルダ、files にこの一覧を渡します)
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] || path.join(root, 'dist-claude'))
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const SKIP = new Set(['vendor/anthropic.js', 'vendor/LICENSES.txt'])
const files = {}
const copy = rel => {
  const dst = path.join(out, rel)
  mkdirSync(path.dirname(dst), { recursive: true })
  copyFileSync(path.join(root, rel), dst)
  files[rel] = rel
}
const walk = dir => {
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = dir + '/' + name
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel)
    else if (!/\.(map|DS_Store)$/.test(name) && !SKIP.has(rel)) copy(rel)
  }
}
for (const d of ['css', 'js', 'vendor']) walk(d)
copy('data/roblox-api.json')
copy('icons/icon.svg')

// Roblox API データの JS 版 (fetch が使えない環境用)
const json = readFileSync(path.join(root, 'data/roblox-api.json'), 'utf8')
writeFileSync(path.join(out, 'data/roblox-api.js'), 'export default ' + json.trim() + '\n')
files['data/roblox-api.js'] = 'data/roblox-api.js'

// ページ本体 (公開時に <!doctype html><html><head>…</head><body> で包まれるので、中身だけ)
const page = `<title>ForgeCode</title>
<meta name="description" content="Roblox Luau editor with Claude built in">
<meta name="theme-color" content="#1e1e1e">
<meta name="color-scheme" content="dark light">
<link rel="stylesheet" href="css/app.css">
<link rel="modulepreload" href="vendor/codemirror.js">
<div id="app" class="app">
  <div id="boot" class="boot">
    <img class="boot-logo" src="icons/icon.svg" alt="" width="72" height="72">
    <div class="boot-title">ForgeCode</div>
    <div class="boot-sub">読み込み中…</div>
  </div>
</div>
<noscript>このアプリを使うには JavaScript を有効にしてください。</noscript>
<script type="module" src="js/app/main.js"></script>
`
writeFileSync(path.join(out, 'index.html'), page)
writeFileSync(path.join(out, 'files.json'), JSON.stringify(files, null, 1))
let total = 0
for (const f of Object.values(files)) total += statSync(path.join(out, f)).size
console.log(`${out}: index.html + ${Object.keys(files).length} files, ${(total / 1024 / 1024).toFixed(2)} MB`)

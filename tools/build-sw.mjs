// sw.js のキャッシュ対象リストとバージョンを更新します:  node tools/build-sw.mjs
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = ['./', 'index.html', 'manifest.webmanifest']
const walk = dir => {
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = dir + '/' + name
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel)
    else if (!/\.(map|DS_Store)$/.test(name)) files.push(rel)
  }
}
for (const d of ['css', 'js', 'vendor', 'data', 'icons', 'obfuscator']) walk(d)
const hash = createHash('sha1')
for (const f of files.slice(1)) hash.update(readFileSync(path.join(root, f)))
const version = hash.digest('hex').slice(0, 10)
const swPath = path.join(root, 'sw.js')
let sw = readFileSync(swPath, 'utf8')
sw = sw.replace(/const VERSION = '[^']*'/, `const VERSION = '${version}'`)
sw = sw.replace(/const PRECACHE = \[[\s\S]*?\]\n/, 'const PRECACHE = ' + JSON.stringify(files, null, 2) + '\n')
writeFileSync(swPath, sw)
console.log(`sw.js: ${files.length} files, version ${version}`)

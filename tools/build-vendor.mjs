// vendor/ 以下のバンドルを作り直すスクリプト（通常は実行不要。リポジトリに同梱済み）
//   cd tools && npm install && npm run vendor
// (端末内 LLM の vendor/web-llm.js は node vendor-webllm.mjs で作ります)
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const outdir = path.join(here, '..', 'vendor')
const common = { bundle: true, format: 'esm', minify: true, target: ['es2020', 'safari15'], legalComments: 'eof', logLevel: 'info' }

await build({ ...common, entryPoints: [path.join(here, 'vendor-codemirror.js')], outfile: path.join(outdir, 'codemirror.js') })
await build({ ...common, entryPoints: [path.join(here, 'vendor-fflate.js')], outfile: path.join(outdir, 'fflate.js'), platform: 'browser' })

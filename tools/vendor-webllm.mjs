// 端末内 LLM (WebLLM) を 1 つのファイルにまとめます:  node vendor-webllm.mjs
// 出力: ../vendor/web-llm.js (高性能モードをオンにしたときだけ読み込まれます。Service Worker の事前キャッシュには含めません)
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
await build({
  entryPoints: [path.join(here, 'node_modules/@mlc-ai/web-llm/lib/index.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  platform: 'browser',
  target: 'es2020',
  legalComments: 'none',
  outfile: path.join(here, '../vendor/web-llm.js'),
  banner: { js: '// @mlc-ai/web-llm 0.2.86 (Apache-2.0) — bundled by tools/vendor-webllm.mjs' },
})
console.log('vendor/web-llm.js written')

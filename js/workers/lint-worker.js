// エラーチェック用の Web Worker (モジュールワーカー)
// 画面のスレッドとは別に Luau のコードを調べるので、大きなファイルでも入力が止まりません
// 受け取るもの: { type: 'lint', id, text, opts, executor, modules: { 名前: ソース }, ext: { URL: 解析結果 } }
// 返すもの:     { type: 'result', id, diags } (直し方はデータのまま。画面側でエディタの操作にします)
import { lintLuauData } from '../editor/lint.js'
import { setRobloxApi } from '../editor/apidb.js'
import { intel } from '../editor/luau-intel.js'

let apiPromise = null
function loadApi() {
  if (!apiPromise) {
    apiPromise = fetch(new URL('../../data/roblox-api.json', import.meta.url))
      .then(r => { if (!r.ok) throw new Error('API ' + r.status); return r.json() })
      .then(d => { setRobloxApi(d); return true })
      .catch(() => { apiPromise = null; return false })
  }
  return apiPromise
}
loadApi()

const ext = new Map()
let modules = {}
intel.moduleSource = name => (Object.prototype.hasOwnProperty.call(modules, name) ? modules[name] : null)
intel.extLib = url => ext.get(url) || null

self.onmessage = async e => {
  const m = e.data
  if (!m || m.type !== 'lint') return
  await loadApi()
  try {
    intel.executor = !!m.executor
    modules = m.modules || {}
    for (const [url, api] of Object.entries(m.ext || {})) ext.set(url, api)
    const diags = lintLuauData(m.text, m.opts || {})
    self.postMessage({ type: 'result', id: m.id, diags })
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) })
  }
}

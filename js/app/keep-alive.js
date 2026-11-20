// 24 時間動かすための見張り役
// ・画面を消さない (Wake Lock): 実行中だけ / いつも / 使わない (設定 → 実行)。裏に回ると外れるので、戻ったら付け直す
// ・長い間、裏にあったあと: Python が応えるか確かめ、応えなければ立ち上げ直す
// ・長い間使っていない (裏にあって何も動いていない) ときは、Python を休ませてメモリを空ける
//   (iPhone などはメモリの多いページから閉じるため。戻ったらすぐ準備し直す)
// ・データを消えにくくする (ブラウザに「保存したデータを自動で消さない」よう頼む)
import { app } from './app.js'
import { getSettings, onSettings, on } from './store.js'
import * as vfs from './vfs.js'

let lock = null, want = false, asking = false
const supported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator

async function acquire() {
  if (!want || lock || asking || !supported() || document.hidden) return
  asking = true
  try {
    lock = await navigator.wakeLock.request('screen')
    lock.addEventListener('release', () => { lock = null; if (want && !document.hidden) setTimeout(acquire, 1000) })
  } catch { lock = null } finally { asking = false }
}
function release() {
  if (lock) { const l = lock; lock = null; l.release().catch(() => {}) }
}

// いま画面を消さないでおくか
function update() {
  const mode = getSettings().keepAwake || 'run'
  const r = app.runner
  const t = r && r.terminal
  const busy = !!(r && (r.running || r.evalBusy || (t && (t.busy || t.pending))))
  const next = mode === 'always' || (mode === 'run' && busy)
  if (next === want) { if (want && !lock) acquire(); return }
  want = next
  if (want) acquire(); else release()
}
export const keepAwakeActive = () => !!lock
export const keepAwakeSupported = supported

export function startKeepAlive() {
  on('running', () => setTimeout(update, 0))
  on('termState', () => setTimeout(update, 0))
  onSettings((s, prev) => { if (!prev || s.keepAwake !== prev.keepAwake) update() })
  update()

  let hiddenAt = 0, restTimer = 0
  document.addEventListener('visibilitychange', async () => {
    const r = app.runner
    if (document.hidden) {
      hiddenAt = Date.now()
      // 20 分たっても何も動いていなければ、Python を休ませる
      clearTimeout(restTimer)
      restTimer = setTimeout(() => {
        if (!document.hidden || !r || getSettings().keepAwake === 'always') return
        const t = r.terminal
        if (r.running || r.evalBusy || (t && (t.busy || t.pending)) || !r.worker) return
        r.rest()
      }, 20 * 60 * 1000)
      return
    }
    clearTimeout(restTimer)
    const away = hiddenAt ? Date.now() - hiddenAt : 0
    hiddenAt = 0
    update()
    if (!r) return
    // 休ませていたら、すぐ準備し直す
    if (r.rested) { r.rested = false; setTimeout(() => r.ensureWorker(), 400); return }
    // 1 分以上、裏にあった: Python が応えるか確かめる (実行中は確かめない)
    if (away > 60000 && r.worker && !r.running && !r.evalBusy) {
      const ok = await r.ping(8000)
      if (!ok && !r.running && !r.evalBusy && r.worker) r.recover('Python が応えなかったので、立ち上げ直しました')
    }
  })

  // データを消えにくくする (ブラウザが空き容量不足のときに、保存したデータを自動で消さない)
  // Firefox は確認の画面が出るので、自動では頼まない (設定 → データ から頼めます)
  setTimeout(async () => {
    try {
      if (/Firefox\//.test(navigator.userAgent) || !navigator.storage || !navigator.storage.persisted) return
      if (await navigator.storage.persisted()) return
      await vfs.requestPersist()
    } catch {}
  }, 15000)
}

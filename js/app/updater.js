// アプリを自動で最新版にする
// ・新しい版 (Service Worker) が入ったら、何も動いていないときに自動で切り替える
//   - アプリが裏に回ったとき (次に開いたときには最新)
//   - 裏から戻ったとき (しばらく裏にあった)
//   - 開いたまま 15 分さわっていないとき
// ・iPhone のホーム画面のアプリは開き直しても読み込み直さないことがあるので、戻ったときにも更新を確かめる
// ・実行中・ターミナルの処理中・ダイアログを開いている間は切り替えない (編集中の内容は下書きに残してから)
import { app } from './app.js'
import { emit } from './store.js'
import { toast } from './ui.js'

let reg = null, ready = false, lastCheck = 0, lastInput = Date.now(), hiddenAt = 0
const FLAG = 'forgecode.updated'

export const updateReady = () => ready

// いま切り替えても困らないか
export function busyForUpdate() {
  const r = app.runner
  if (r && (r.running || r.evalBusy || r.serving || (r.terminals || []).some(t => t.busy || t.pending))) return true
  if (app.notebook && app.notebook.busy && app.notebook.busy()) return true
  if (document.querySelector('.modal-overlay')) return true
  return false
}

export function applyUpdate() {
  try { if (app.editors) app.editors.flushDrafts() } catch {}
  try { sessionStorage.setItem(FLAG, '1') } catch {}
  try { if (app.editors) app.editors.saveAll().catch(() => {}) } catch {}
  setTimeout(() => location.reload(), 150)
}

function markReady() {
  if (ready) return
  ready = true
  emit('updateReady', true)
  if (app.wb) try { app.wb.updateStatus() } catch {}
  toast('新しいバージョンを入れました。次に開いたときに切り替わります', { icon: 'download', duration: 9000, action: { label: '今すぐ更新', run: applyUpdate } })
}

function check() {
  if (!reg || Date.now() - lastCheck < 5 * 60 * 1000) return
  lastCheck = Date.now()
  reg.update().catch(() => {})
}

// hadController: このページを開いたときに、もう Service Worker が動いていたか (はじめての登録は「更新」ではない)
export function startUpdater(registration, hadController) {
  reg = registration
  lastCheck = Date.now()
  // 前のページで待っていた新しい版 (別のタブ・前回の起動で入ったもの)
  if (reg.waiting && hadController) markReady()
  reg.addEventListener('updatefound', () => {
    const w = reg.installing
    if (!w) return
    w.addEventListener('statechange', () => {
      // はじめての登録 (controller がない) は更新ではない
      if ((w.state === 'installed' || w.state === 'activated') && hadController) markReady()
    })
  })
  // 開きっぱなしでも確かめる (裏にあると止まるので、戻ったときにも)
  setInterval(check, 30 * 60 * 1000)
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { lastInput = Date.now() }, { passive: true, capture: true })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now()
      if (ready && !busyForUpdate()) applyUpdate()
      return
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0
    hiddenAt = 0
    if (ready && away > 10000 && !busyForUpdate()) { applyUpdate(); return }
    check()
  })
  // 開いたまま、15 分さわっていない
  setInterval(() => {
    if (ready && !document.hidden && Date.now() - lastInput > 15 * 60 * 1000 && !busyForUpdate()) applyUpdate()
  }, 60 * 1000)
  // 自動で切り替えた直後: 知らせる (変更点は「新機能」で表示)
  try {
    if (sessionStorage.getItem(FLAG)) { sessionStorage.removeItem(FLAG); setTimeout(() => toast('最新のバージョンに更新しました', { icon: 'check', duration: 4000 }), 1200) }
  } catch {}
}

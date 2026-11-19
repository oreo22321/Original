// アプリが落ちる (端末のメモリ不足などでページが閉じる) ことが続かないようにする
// ・画面を閉じる / 裏に回るときに「きちんと終わった」と記録する。記録がないまま次に起動したら、前回は落ちたと分かる
// ・落ちたときに AI モデルを読み込んでいた → 次からは自動で読み込まない
// ・起動してすぐ落ちるのが続いた → 重い準備 (Python の先読み・AI) をしない「安全モード」で起動する
const KEY = 'forgecode.session-health.v1'
let cur = null

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(cur)) } catch {} }

// 起動のはじめに 1 回。前回の様子を返す
export function bootHealth() {
  const prev = read()
  const now = Date.now()
  const crashed = !!prev.t && !prev.clean
  const early = crashed && !prev.stable          // 起動して 30 秒もたたずに落ちた
  const streak = early ? (prev.streak || 0) + 1 : 0
  cur = { t: now, clean: false, stable: false, streak, llm: false, run: false, safe: streak >= 2 }
  save()
  // 30 秒動いたら「落ち着いた」
  setTimeout(() => { if (cur) { cur.stable = true; cur.streak = 0; save() } }, 30000)
  // 裏に回る・閉じるときは「きちんと終わった」。戻ってきたら、また見張る
  const bye = () => { if (cur) { cur.clean = true; save() } }
  addEventListener('pagehide', bye)
  document.addEventListener('visibilitychange', () => { if (!cur) return; cur.clean = document.visibilityState === 'hidden'; save() })
  return { crashed, safe: cur.safe, streak, duringLlm: crashed && !!prev.llm, duringRun: crashed && !!prev.run }
}

// 重い処理の始まりと終わり (落ちたとき、何をしていたか分かるように)
export function busy(kind, on) {
  if (!cur) return
  cur[kind] = !!on
  save()
}

export const safeMode = () => !!(cur && cur.safe)

// クラウド実行 (GitHub Actions) の画面: アプリを閉じても・スマホの電源を切っても、GitHub のサーバーで動かす
// 設定はプロジェクトの記録 (project.cloud) に保存します
import { app, command, runCommand } from './app.js'
import { h, icon, toast, modal, confirmDialog } from './ui.js'
import * as vfs from './vfs.js'
import { ghReady, ghConfig, ghClient, projDir, syncPush, syncPull, settingsDialog } from './github-sync.js'
import { SCHEDULES, TIMEOUTS, enableCloud, disableCloud, dispatchCloud, cloudRuns, cloudResult, monthlyMinutes } from './cloud-core.js'

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
export function cloudConfig(p = app.project) {
  const c = (p && p.cloud) || {}
  const py = app.files.filter(f => !f.dir && /\.py$/.test(f.path)).map(f => f.path)
  return {
    id: p ? p.id : '', name: p ? p.name : '', dir: p ? projDir(p) : '',
    entry: c.entry && py.includes(c.entry) ? c.entry : (p && p.runTarget) || py.find(x => /(^|\/)main\.py$/.test(x)) || py[0] || 'main.py',
    schedule: c.schedule || '1h', time: c.time || '08:00', timeout: c.timeout || 10, save: c.save !== false,
    enabled: !!c.enabled, tz: tz(), tzOffset: new Date().getTimezoneOffset(),
  }
}
async function saveCloud(patch) {
  const p = app.project
  p.cloud = { ...(p.cloud || {}), ...patch }
  await vfs.putProject(p)
}
const fmtTime = t => { try { return new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return String(t || '') } }
const RUN_STATE = r => (r.status !== 'completed' ? { text: r.status === 'in_progress' ? '実行中' : '待っています', cls: 'run' } : r.conclusion === 'success' ? { text: '完了', cls: 'ok' } : r.conclusion === 'cancelled' ? { text: '取り消し', cls: 'stop' } : { text: 'エラー', cls: 'err' })
const STATE_TEXT = { ok: '完了', error: 'エラーで終了', timeout: '時間切れ' }

// ---- 操作 (画面・ターミナル・コマンドから) ----
export async function cloudEnable(cfg) {
  if (!ghReady()) throw new Error('先に「GitHub と同期」を設定してください')
  await syncPush({ quiet: true })           // GitHub のファイルを最新に (クラウドはリポジトリのファイルを動かす)
  await enableCloud(ghClient(), cfg)
  await saveCloud({ entry: cfg.entry, schedule: cfg.schedule, time: cfg.time, timeout: cfg.timeout, save: cfg.save, enabled: true })
}
export async function cloudDisable() {
  const cfg = cloudConfig()
  await disableCloud(ghClient(), cfg)
  await saveCloud({ enabled: false })
}
export async function cloudRunNow() {
  const cfg = cloudConfig()
  if (!cfg.enabled) throw new Error('まだクラウドで動かす設定をしていません (cloud setup)')
  await syncPush({ quiet: true })
  await dispatchCloud(ghClient(), cfg)
}
export async function cloudStatus() {
  const cfg = cloudConfig()
  if (!ghReady()) return { cfg, runs: [], result: { log: null, status: null } }
  // 設定していないとき、ワークフローの記録は読まない (GitHub が 404 を返すため)
  const [runs, result] = await Promise.all([cfg.enabled ? cloudRuns(ghClient(), cfg, 5) : [], cloudResult(ghClient(), cfg)])
  return { cfg, runs, result }
}

// ---- 画面 ----
export function cloudDialog() {
  if (!app.project) return
  const cfg = cloudConfig()
  const py = app.files.filter(f => !f.dir && /\.py$/.test(f.path)).map(f => f.path)
  const entry = h('select', { class: 'select' }, (py.length ? py : ['main.py']).map(p => h('option', { value: p, selected: p === cfg.entry }, p)))
  const sched = h('select', { class: 'select' }, SCHEDULES.map(([v, l]) => h('option', { value: v, selected: v === cfg.schedule }, l)))
  const time = h('input', { class: 'input', type: 'time', value: cfg.time })
  const timeRow = h('label', { class: 'gh-field' }, h('span', { class: 'label' }, '時刻 (この端末の時刻)'), time)
  const timeout = h('select', { class: 'select' }, TIMEOUTS.map(m => h('option', { value: m, selected: m === Number(cfg.timeout) }, m >= 60 ? `${m / 60 | 0} 時間${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`)))
  const save = h('input', { type: 'checkbox', checked: cfg.save })
  const estimate = h('div', { class: 'set-desc' })
  const paint = () => {
    timeRow.classList.toggle('hidden', sched.value !== 'daily')
    const min = monthlyMinutes(sched.value, 1)
    estimate.textContent = sched.value === 'manual' ? '「今すぐ実行」を押したときだけ動きます' : `1 か月に約 ${min.toLocaleString()} 分 (1 回 1 分として) 使います。公開リポジトリは無料・使い放題、非公開リポジトリは無料で月 2,000 分まで${min > 2000 ? ' — 非公開なら間隔を長くしてください' : ''}`
  }
  sched.addEventListener('change', paint)
  paint()
  const note = h('div', { class: 'set-desc gh-status' })
  const runsBox = h('div', { class: 'cloud-runs' })
  const read = () => ({ ...cloudConfig(), entry: entry.value, schedule: sched.value, time: time.value || '08:00', timeout: Number(timeout.value), save: save.checked })
  const busy = async (label, fn) => {
    note.textContent = label
    try { await fn(); return true } catch (e) { note.textContent = e.message || String(e); return false }
  }
  const refresh = async () => {
    if (!ghReady()) return
    runsBox.replaceChildren(h('div', { class: 'set-desc' }, '読み込み中…'))
    try {
      const { runs, result } = await cloudStatus()
      runsBox.replaceChildren()
      const st = result.status
      if (st) runsBox.append(h('div', { class: 'cloud-last ' + st.state }, icon(st.state === 'ok' ? 'check' : 'alert', 15), h('span', null, `最後の実行: ${fmtTime(st.time)} — ${STATE_TEXT[st.state] || st.state} (${st.seconds} 秒)`)))
      for (const r of runs) {
        const s = RUN_STATE(r)
        runsBox.append(h('a', { class: 'cloud-run', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { class: 'rh-state ' + s.cls }, s.text), h('span', null, fmtTime(r.at)), h('span', { class: 'cr-ev' }, r.event === 'schedule' ? '時間になって' : r.event === 'workflow_dispatch' ? '今すぐ実行' : r.event)))
      }
      if (!st && !runs.length) runsBox.append(h('div', { class: 'set-desc' }, cloudConfig().enabled ? 'まだ動いていません (最初の実行まで少し待つか、「今すぐ実行」)' : 'まだ設定していません'))
      if (result.log) runsBox.append(h('button', { class: 'btn small ghost', onclick: () => showLog(result) }, icon('terminal', 14), '最後の出力を見る'))
    } catch (e) { runsBox.replaceChildren(h('div', { class: 'set-desc' }, '記録を読めませんでした: ' + e.message)) }
  }
  const body = h('div', { class: 'form gh-form' },
    h('div', { class: 'set-desc' }, 'GitHub のサーバーで Python を動かします。アプリを閉じても、スマホの電源を切っても、決めた間隔で動き続けます。結果のファイルは GitHub に保存され、「GitHub から取り込む」でアプリに入ります。'),
    !ghReady() ? h('div', { class: 'cloud-need' }, icon('github', 16), h('span', null, '先に「GitHub と同期」を設定してください'), h('button', { class: 'btn small primary', onclick: () => settingsDialog() }, '設定する')) : null,
    h('details', { class: 'cloud-help' }, h('summary', null, 'はじめに: トークンの許可を足す'),
      h('ol', { class: 'lv-steps' },
        h('li', null, 'GitHub の Settings → Developer settings → Fine-grained tokens で、同期に使っているトークンを開く'),
        h('li', null, 'Repository permissions に「Workflows: Read and write」と「Actions: Read and write」を足して保存 (Contents: Read and write はそのまま)'),
        h('li', null, '下で実行するファイルといつ動かすかを選んで「クラウドで動かす」'))),
    h('label', { class: 'gh-field' }, h('span', { class: 'label' }, '実行するファイル'), entry),
    h('label', { class: 'gh-field' }, h('span', { class: 'label' }, 'いつ動かすか'), sched),
    timeRow,
    estimate,
    h('label', { class: 'gh-field' }, h('span', { class: 'label' }, '1 回に動かす最大の時間'), timeout, h('span', { class: 'set-desc' }, 'この時間を過ぎたら止めて、そこまでの出力を残します (GitHub の上限は 6 時間)')),
    h('label', { class: 'lv-toggle' }, save, h('span', { class: 'lv-toggle-text' }, h('span', null, 'プログラムが書いたファイルを保存'), h('span', { class: 'lv-sub' }, '次の実行は、その続きから (記録・データの追加など)。input() には input.txt の中身が入ります'))),
    note,
    h('div', { class: 'lv-acts' },
      h('button', { class: 'btn small primary', onclick: () => busy('GitHub に設定しています…', async () => { await cloudEnable(read()); note.textContent = 'クラウドで動かす設定をしました。' + (sched.value === 'manual' ? '「今すぐ実行」で動きます' : '決めた間隔で動きます (最初は少し遅れることがあります)'); refresh() }) }, icon('cloud', 14), 'クラウドで動かす'),
      h('button', { class: 'btn small', onclick: () => busy('実行を頼んでいます…', async () => { await cloudRunNow(); note.textContent = '実行を頼みました。1〜2 分で動き始めます'; setTimeout(refresh, 4000) }) }, icon('play', 13), '今すぐ実行'),
      h('button', { class: 'btn small ghost', onclick: () => refresh() }, icon('refresh', 14), '記録を更新'),
      h('button', { class: 'btn small ghost', onclick: () => busy('結果のファイルを取り込んでいます…', async () => { await syncPull({}); note.textContent = '取り込みました' }) }, icon('download', 14), '結果を取り込む'),
      cfg.enabled ? h('button', { class: 'btn small ghost danger', onclick: async () => {
        if (!(await confirmDialog('クラウドで動かすのをやめますか?', 'GitHub のワークフローを消します。プロジェクトのファイルと記録は残ります', { okLabel: 'やめる', danger: true }))) return
        busy('止めています…', async () => { await cloudDisable(); note.textContent = '止めました' })
      } }, icon('stop', 13), '止める') : null),
    h('div', { class: 'set-group-title' }, icon('history', 15), '実行の記録'),
    runsBox)
  modal({ title: 'クラウドで動かす (24 時間)', body, wide: true })
  refresh()
}
function showLog(result) {
  const st = result.status || {}
  modal({
    title: `最後の出力 — ${STATE_TEXT[st.state] || ''}`, wide: true,
    body: h('div', null, st.time ? h('div', { class: 'set-desc' }, `${fmtTime(st.time)} ・ ${st.seconds} 秒 ・ 終了コード ${st.code}${st.saved ? ' ・ ファイルを保存しました' : ''}`) : null, h('pre', { class: 'err-log cloud-log' }, result.log || '')),
    actions: st.url ? [{ label: 'GitHub で見る', run: () => { window.open(st.url, '_blank', 'noopener'); return false } }, { label: '閉じる', primary: true, value: null }] : [{ label: '閉じる', primary: true, value: null }],
  })
}

void command, runCommand, toast

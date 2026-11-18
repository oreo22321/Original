// GitHub と同期 (自動バックアップ)
// ・保存すると、少し待ってから GitHub のリポジトリへまとめて保存します (1 回につき 1 コミット)
// ・プロジェクトを開いたとき・アプリに戻ったときに、GitHub 側の変更を取り込みます
// ・同じファイルを両方で変えていたら「衝突」として知らせ、どちらを残すか選べます (上書きされる側は履歴に残ります)
// トークンはこの端末にだけ保存します (GitHub の「Fine-grained token」で、1 つのリポジトリの Contents: Read and write だけを許可)
import { app, command, runCommand, refreshFiles } from './app.js'
import { emit, on } from './store.js'
import { h, icon, toast, modal, menu, confirmDialog } from './ui.js'
import * as vfs from './vfs.js'
import { GitHubClient, pushProject, pullProject, listRemoteProjects } from './github-core.js'

const KEY = 'forgecode.github'
export function ghConfig() {
  let c = {}
  try { c = JSON.parse(localStorage.getItem(KEY) || '{}') } catch {}
  return { token: c.token || '', repo: c.repo || '', branch: c.branch || '', dir: (c.dir || 'forgecode').replace(/^\/+|\/+$/g, ''), auto: c.auto !== false, api: c.api || '' }
}
function saveConfig(c) { try { localStorage.setItem(KEY, JSON.stringify(c)) } catch {} emit('github', status) }
export const ghReady = () => { const c = ghConfig(); return !!(c.token && c.repo) }
const client = () => { const c = ghConfig(); return new GitHubClient({ token: c.token, repo: c.repo, branch: c.branch, api: c.api || undefined }) }
const safeName = n => String(n || 'Project').replace(/[\\/:*?"<>|#%]+/g, '_').trim().slice(0, 80) || 'Project'

// プロジェクトごとの同期の状態 (プロジェクトの記録に保存)
const projDir = p => (p.github && p.github.dir) || `${ghConfig().dir}/${safeName(p.name)}`
async function saveState(p, st) {
  p.github = { ...(p.github || {}), dir: projDir(p), state: st, lastSync: Date.now() }
  if (app.project && app.project.id === p.id) app.project.github = p.github
  await vfs.putProject(p)
}

export const status = { state: 'off', at: 0, error: '', conflicts: [] }
function setStatus(state, extra = {}) { Object.assign(status, { state, ...extra }); emit('github', status) }

// この端末のファイル (開いているファイルは編集中の内容)
function localFiles() {
  const out = {}
  for (const f of app.files) {
    if (f.dir) continue
    const d = app.editors && app.editors.docs.get(f.path)
    out[f.path] = d && d.state ? d.state.doc.toString() : (app.contents.get(f.path) || '')
  }
  return out
}

// 同時に 2 つ動かさない
let chain = Promise.resolve()
const serial = fn => (chain = chain.then(fn, fn))

export function syncPush({ force = false, quiet = false } = {}) {
  return serial(async () => {
    const p = app.project
    if (!p || !ghReady()) return null
    setStatus('syncing')
    try {
      if (app.editors) await app.editors.saveAll().catch(() => {})
      const r = await pushProject(client(), { dir: projDir(p), files: localFiles(), state: p.github && p.github.state, message: `ForgeCode: ${p.name} を更新`, force })
      await saveState(p, r.state)
      setStatus(r.conflicts.length ? 'conflict' : 'ok', { at: Date.now(), error: '', conflicts: r.conflicts })
      if (r.conflicts.length) conflictToast(r.conflicts)
      else if (!quiet) toast(r.pushed ? `GitHub に保存しました (${r.pushed} ファイル)` : 'GitHub は最新です', { icon: 'github', duration: 2200 })
      if (r.remoteNewer.length && !r.conflicts.length && !quiet) toast('GitHub 側に新しい変更があります', { action: { label: '取り込む', run: () => syncPull() } })
      return r
    } catch (e) {
      setStatus('error', { error: e.message })
      if (!quiet || e.status === 401 || e.status === 403) toast('GitHub に保存できませんでした: ' + e.message, { kind: 'error', action: { label: '設定', run: () => runCommand('githubSync') } })
      return null
    }
  })
}

export function syncPull({ force = false, quiet = false } = {}) {
  return serial(async () => {
    const p = app.project
    if (!p || !ghReady()) return null
    setStatus('syncing')
    try {
      if (app.editors) await app.editors.saveAll().catch(() => {})
      const r = await pullProject(client(), { dir: projDir(p), files: localFiles(), state: p.github && p.github.state, force })
      await applyChanges(p, r.changes)
      await saveState(p, r.state)
      setStatus(r.conflicts.length ? 'conflict' : 'ok', { at: Date.now(), error: '', conflicts: r.conflicts })
      const n = Object.keys(r.changes).length
      if (r.conflicts.length) conflictToast(r.conflicts)
      else if (n) toast(`GitHub から ${n} ファイルを取り込みました`, { icon: 'github', duration: 2600 })
      else if (!quiet) toast('この端末は最新です', { icon: 'github', duration: 2000 })
      return r
    } catch (e) {
      setStatus('error', { error: e.message })
      if (!quiet) toast('GitHub から読み込めませんでした: ' + e.message, { kind: 'error' })
      return null
    }
  })
}

// GitHub の内容をこの端末に書く (上書きする前の内容は履歴に残す)
async function applyChanges(p, changes) {
  const entries = Object.entries(changes)
  if (!entries.length) return
  for (const [path, text] of entries) {
    const old = app.contents.get(path)
    if (old !== undefined && old !== null && old !== '') { try { await vfs.addHistory(p.id, path, old) } catch {} }
    if (text === null) {
      if (app.editors && app.editors.has(path)) { try { await app.editors.close(path, { force: true }) } catch {} }
      await vfs.remove(p.id, path)
    } else {
      await vfs.writeFile(p.id, path, text)
      app.contents.set(path, text)
      if (app.editors && app.editors.has(path)) app.editors.externalChange(path, text)
    }
  }
  await refreshFiles()
}

function conflictToast(list) {
  toast(`${list.length} ファイルが GitHub 側でも変更されています`, { kind: 'error', duration: 9000, action: { label: '解決', run: () => resolveConflicts(list) } })
}
function resolveConflicts(list) {
  const body = h('div', { class: 'form' },
    h('div', { class: 'set-desc' }, '同じファイルを、この端末と GitHub の両方で変更しました。どちらを残しますか? (残さなかった方は、この端末の履歴から戻せます)'),
    h('ul', { class: 'gh-conflicts' }, list.map(p => h('li', null, h('code', null, p)))))
  modal({
    title: '同期の衝突', body, actions: [
      { label: 'あとで', value: null },
      { label: 'GitHub 側を残す', run: () => { syncPull({ force: list }) } },
      { label: 'この端末を残す', primary: true, run: () => { syncPush({ force: list }) } },
    ],
  })
}

// ---- 自動で同期 ----
let pushTimer = 0
on('saved', () => {
  if (!ghReady() || !ghConfig().auto || !app.project) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => syncPush({ quiet: true }), 15000)
})
document.addEventListener('visibilitychange', () => {
  if (!ghReady() || !ghConfig().auto || !app.project) return
  if (document.hidden) { if (pushTimer) { clearTimeout(pushTimer); pushTimer = 0; syncPush({ quiet: true }) } }
  else if (Date.now() - status.at > 60000) syncPull({ quiet: true })
})
on('project', () => {
  if (!ghReady() || !ghConfig().auto) return
  setTimeout(() => syncPull({ quiet: true }), 1200)
})

// ---- 設定の画面 ----
function settingsDialog() {
  const c = ghConfig()
  const field = (label, input, desc) => h('label', { class: 'gh-field' }, h('span', { class: 'label' }, label), input, desc ? h('span', { class: 'set-desc' }, desc) : null)
  const token = h('input', { class: 'input', type: 'password', value: c.token, placeholder: 'github_pat_…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' })
  const repo = h('input', { class: 'input', value: c.repo, placeholder: 'ユーザー名/リポジトリ名', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
  const branch = h('input', { class: 'input', value: c.branch, placeholder: '空ならリポジトリの標準 (main など)', autocapitalize: 'off', spellcheck: 'false' })
  const dir = h('input', { class: 'input', value: c.dir, placeholder: 'forgecode', autocapitalize: 'off', spellcheck: 'false' })
  const auto = h('input', { type: 'checkbox', checked: c.auto })
  const note = h('div', { class: 'set-desc gh-status' }, statusText())
  const collect = () => ({ ...ghConfig(), token: token.value.trim(), repo: repo.value.trim(), branch: branch.value.trim(), dir: dir.value.trim() || 'forgecode', auto: auto.checked })
  const check = async () => {
    const next = collect()
    note.textContent = '確認しています…'
    try {
      const cl = new GitHubClient({ token: next.token, repo: next.repo, branch: next.branch, api: next.api || undefined })
      const info = await cl.info()
      if (info.permissions && info.permissions.push === false) throw new Error('このトークンでは書き込めません')
      saveConfig(next)
      note.textContent = `つながりました: ${info.full_name || next.repo} (${await cl.defaultBranch()})`
      return true
    } catch (e) { note.textContent = '接続できません: ' + e.message; return false }
  }
  const body = h('div', { class: 'form gh-form' },
    h('div', { class: 'set-desc' }, 'プロジェクトを GitHub のリポジトリに自動で保存します。端末が壊れても消えず、PC からも同じコードを開けます。'),
    h('ol', { class: 'lv-steps' },
      h('li', null, 'GitHub で保存用のリポジトリを作る (非公開でも OK)'),
      h('li', null, 'Settings → Developer settings → Fine-grained tokens で、そのリポジトリだけ・Contents を「Read and write」にしたトークンを作る'),
      h('li', null, 'トークンとリポジトリ名を下に入れて「保存して確認」')),
    field('トークン', token, 'この端末にだけ保存します。他の人に見せないでください'),
    field('リポジトリ', repo),
    field('ブランチ (任意)', branch),
    field('保存するフォルダ', dir, `プロジェクトは「${c.dir}/プロジェクト名」に保存されます`),
    h('label', { class: 'lv-toggle' }, auto, h('span', { class: 'lv-toggle-text' }, h('span', null, '自動で同期'), h('span', { class: 'lv-sub' }, '保存したら少し後に GitHub へ。開いたときと、アプリに戻ったときに GitHub の変更を取り込みます'))),
    note,
    h('div', { class: 'lv-acts' },
      h('button', { class: 'btn small primary', onclick: () => check() }, icon('check', 14), '保存して確認'),
      h('button', { class: 'btn small', onclick: async () => { if (!(await check())) return; await syncPull({}); await syncPush({}); note.textContent = statusText() } }, icon('refresh', 14), '今すぐ同期'),
      h('button', { class: 'btn small ghost', onclick: async () => { if (await check()) openFromGitHub() } }, icon('download', 14), 'GitHub から開く'),
      c.token ? h('button', { class: 'btn small ghost danger', onclick: async () => { if (await confirmDialog('GitHub 同期をやめますか?', 'この端末のトークンを消します。GitHub のファイルは消えません', { okLabel: 'やめる', danger: true })) { saveConfig({ ...collect(), token: '' }); token.value = ''; note.textContent = '同期をやめました' } } }, '同期をやめる') : null))
  modal({ title: 'GitHub と同期', body, wide: true, actions: [{ label: '閉じる', run: () => { const n = collect(); if (n.token || !ghConfig().token) saveConfig(n) } }] })
}
function statusText() {
  if (!ghReady()) return 'まだ設定されていません'
  const p = app.project
  const last = p && p.github && p.github.lastSync ? new Date(p.github.lastSync).toLocaleString() : 'まだ同期していません'
  if (status.state === 'error') return `エラー: ${status.error}`
  if (status.state === 'conflict') return `${status.conflicts.length} ファイルが衝突しています`
  return `${p ? `「${p.name}」→ ${projDir(p)}` : ''}  最後の同期: ${last}`
}

// GitHub にあるプロジェクトを、この端末に新しく作って開く
async function openFromGitHub() {
  let names
  try { names = await listRemoteProjects(client(), ghConfig().dir) } catch (e) { toast(e.message, { kind: 'error' }); return }
  if (!names.length) { toast(`GitHub の「${ghConfig().dir}」にプロジェクトがありません`); return }
  menu(names.map(n => ({ label: n, icon: 'folder', run: () => importProject(n) })), null, { title: 'GitHub から開く' })
}
async function importProject(name) {
  const dir = `${ghConfig().dir}/${name}`
  const all = await vfs.listProjects()
  const existing = all.find(p => p.github && p.github.dir === dir)
  if (existing) { const { openProject } = await import('./app.js'); await openProject(existing.id, { openMain: true }); syncPull({}); return }
  try {
    const r = await pullProject(client(), { dir, files: {}, state: null })
    const files = Object.fromEntries(Object.entries(r.changes).filter(([, t]) => t !== null))
    const kind = Object.keys(files).some(p => /\.(server|client)\.luau?$/.test(p)) ? 'studio' : 'executor'
    const p = await vfs.createProject(name, files, { kind, github: { dir, state: r.state, lastSync: Date.now() } })
    const { openProject } = await import('./app.js')
    await openProject(p.id, { openMain: true })
    toast(`GitHub から「${name}」を開きました (${Object.keys(files).length} ファイル)`, { icon: 'github' })
  } catch (e) { toast('開けませんでした: ' + e.message, { kind: 'error' }) }
}

command('githubSync', 'GitHub と同期 (設定)', () => settingsDialog(), { icon: 'github' })
command('githubPush', 'GitHub に保存', () => (ghReady() ? syncPush({}) : settingsDialog()), { icon: 'github' })
command('githubPull', 'GitHub から取り込む', () => (ghReady() ? syncPull({}) : settingsDialog()), { icon: 'github' })
command('githubOpen', 'GitHub から開く', () => (ghReady() ? openFromGitHub() : settingsDialog()), { icon: 'github' })

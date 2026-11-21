// ソース管理 (git) の画面: 変更の一覧・ステージ・コミット・履歴・ブランチ・差分
// 中身は git-core.js (ターミナルの git と同じ記録を使います)
import { app, runCommand, writeProjectFile, deletePath, refreshFiles } from './app.js'
import { on, emit } from './store.js'
import { h, icon, toast, modal, menu, confirmDialog, promptDialog } from './ui.js'
import * as vfs from './vfs.js'
import { GitRepo, GitError, short, firstLine, unifiedDiff } from './git-core.js'

const KIND = { A: ['A', '新規'], M: ['M', '変更'], D: ['D', '削除'], U: ['U', '衝突'], '?': ['U', '追跡していない'] }
const ago = t => {
  const s = Math.max(0, (Date.now() - t) / 1000)
  return s < 60 ? 'いま' : s < 3600 ? `${s / 60 | 0} 分前` : s < 86400 ? `${s / 3600 | 0} 時間前` : s < 86400 * 30 ? `${s / 86400 | 0} 日前` : new Date(t).toLocaleDateString('ja-JP')
}

// アプリのファイルを、git の作業ツリーとして使う
function appTree() {
  return {
    list: () => app.files.filter(f => !f.dir).map(f => f.path),
    read: async p => {
      const d = app.editors && app.editors.docs.get(p)
      if (d && d.state) return d.state.doc.toString()
      if (app.contents.has(p)) return app.contents.get(p)
      return vfs.readFile(app.project.id, p)
    },
    write: (p, c) => writeProjectFile(p, c),
    remove: p => deletePath(p),
  }
}
export function currentRepo() {
  if (!app.project) return null
  return new GitRepo(vfs.gitStore(app.project.id), appTree())
}
// 書き換えたあと: ファイル一覧とこの画面を新しくする
async function after(fn) {
  try {
    const r = await fn()
    await refreshFiles()
    emit('git')
    return r
  } catch (e) {
    if (e instanceof GitError) { toast(e.message, { kind: 'error', duration: 6000 }); return null }
    throw e
  }
}

export class ScmView {
  constructor(el) {
    this.el = el
    this.expanded = { staged: true, changes: true, history: true }
    this.timer = 0
    this.build()
    const later = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.visible() && this.render(), 600) }
    on('git', () => this.visible() && this.render())
    on('saved', later)
    on('files', later)
    on('project', () => this.render())
    this.render()
  }
  visible() { return !this.el.classList.contains('hidden') }
  build() {
    this.head = h('div', { class: 'side-head' }, h('span', { class: 'side-title' }, 'ソース管理'),
      h('div', { class: 'side-acts' },
        h('button', { class: 'icon-btn sm', title: '新しくする', 'aria-label': '新しくする', onclick: () => this.render() }, icon('refresh', 16)),
        h('button', { class: 'icon-btn sm', title: 'その他', 'aria-label': 'その他', onclick: e => this.moreMenu(e.currentTarget) }, icon('more', 16))))
    this.body = h('div', { class: 'scm-body' })
    this.el.append(this.head, this.body)
  }

  async render() {
    const repo = currentRepo()
    if (!repo) { this.body.replaceChildren(h('div', { class: 'tree-empty' }, 'プロジェクトを開いてください')); return }
    if (!(await repo.exists())) {
      this.body.replaceChildren(h('div', { class: 'scm-intro' },
        icon('branch', 28),
        h('p', null, 'git で変更を記録すると、いつでも前の版を見たり、戻したりできます。ブランチで別の案を試すこともできます。'),
        h('button', { class: 'btn primary', onclick: () => after(async () => { await repo.init(); await repo.add([], { all: true }); await repo.commit('最初のコミット') }).then(r => r !== null && toast('記録をはじめました (最初のコミット)', { icon: 'check' })) }, icon('branch', 15), '記録をはじめる (git init)'),
        h('p', { class: 'set-desc' }, 'ターミナルでも git status / git commit / git log などが使えます。記録はこの端末に保存されます。')))
      return
    }
    let st, log
    try { st = await repo.status(); log = st.head ? await repo.log({ n: 40 }) : [] } catch (e) { this.body.replaceChildren(h('div', { class: 'tree-empty' }, e.message)); return }
    this.repo = repo
    this.st = st
    const refs = await repo.refsByCommit()
    const staged = st.staged.filter(x => !st.conflicts.includes(x.path))
    const unstagedMap = new Map()
    for (const x of st.unstaged) unstagedMap.set(x.path, x)
    for (const p of st.untracked) unstagedMap.set(p, { path: p, kind: '?' })
    for (const p of st.conflicts) unstagedMap.set(p, { path: p, kind: 'U' })
    const changes = [...unstagedMap.values()].sort((a, b) => (a.path < b.path ? -1 : 1))

    const branchBtn = h('button', { class: 'scm-branch', onclick: e => this.branchMenu(e.currentTarget) }, icon('branch', 14), h('span', null, st.branch || `HEAD (${short(st.detached)})`), icon('chevronDown', 13))
    const msg = h('textarea', { class: 'input scm-msg', rows: 2, placeholder: st.merge ? st.merge.message : 'メッセージ (何を変えたか)', 'aria-label': 'コミットのメッセージ' })
    try { msg.value = sessionStorage.getItem('forgecode.scm.msg') || '' } catch {}
    msg.addEventListener('input', () => { try { sessionStorage.setItem('forgecode.scm.msg', msg.value) } catch {} })
    msg.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doCommit() } })
    const all = !staged.length && changes.length && !st.merge
    const doCommit = async () => {
      const text = msg.value.trim() || (st.merge ? st.merge.message : '')
      if (!text) { msg.focus(); toast('メッセージを書いてください'); return }
      const r = await after(async () => {
        if (all) await repo.add([], { all: true })
        return repo.commit(text)
      })
      if (r) { msg.value = ''; try { sessionStorage.removeItem('forgecode.scm.msg') } catch {} toast(`コミットしました (${short(r.id)})`, { icon: 'check' }) }
    }
    const commitBtn = h('button', { class: 'btn primary scm-commit-btn', disabled: !staged.length && !changes.length && !st.merge, onclick: doCommit }, icon('check', 15), all ? 'すべてコミット' : 'コミット')
    const parts = [h('div', { class: 'scm-top' }, branchBtn, st.head ? h('span', { class: 'scm-sub' }, `${log.length >= 40 ? '40+' : log.length} 件の記録`) : h('span', { class: 'scm-sub' }, 'まだ記録はありません'))]
    if (st.merge) parts.push(h('div', { class: 'scm-merge' }, icon('alert', 15), h('span', null, st.conflicts.length ? `衝突が ${st.conflicts.length} 個あります。<<<<<<< と >>>>>>> の間を直して、＋ でステージしてください` : 'マージの途中です。コミットで終わります'),
      h('button', { class: 'btn small ghost', onclick: async () => { if (await confirmDialog('マージをやめますか?', '始める前の状態に戻します', { okLabel: 'やめる', danger: true })) after(() => repo.abortMerge()) } }, 'やめる')))
    parts.push(msg, commitBtn)
    if (staged.length) parts.push(this.section('staged', 'ステージした変更', staged, [['diff', '外す', () => after(() => repo.unstage([]))]], x => [
      ['minus', 'ステージから外す', () => after(() => repo.unstage([x.path]))],
    ], 'INDEX'))
    parts.push(this.section('changes', '変更', changes, changes.length ? [
      ['undo', 'すべて元に戻す', async () => { if (await confirmDialog('すべての変更を元に戻しますか?', '最後にコミットした状態に戻します (追跡していないファイルは残ります)', { okLabel: '元に戻す', danger: true })) after(() => repo.restore([])) }],
      ['plus', 'すべてステージ', () => after(() => repo.add([], { all: true }))],
    ] : [], x => [
      x.kind !== '?' && x.kind !== 'U' ? ['undo', '元に戻す', async () => { if (await confirmDialog(`${x.path} の変更を元に戻しますか?`, '最後にステージ (コミット) した状態に戻します', { okLabel: '元に戻す', danger: true })) after(() => repo.restore([x.path])) }] : null,
      ['plus', 'ステージ', () => after(() => repo.add([x.path]))],
    ], 'WORK'))
    if (!changes.length && !staged.length && st.head) parts.push(h('div', { class: 'scm-clean' }, icon('check', 14), '変更はありません (最後のコミットと同じです)'))
    if (log.length) parts.push(this.historySection(log, refs))
    this.body.replaceChildren(...parts)
  }

  section(key, title, items, headActs, rowActs, side) {
    const open = this.expanded[key]
    const head = h('div', { class: 'scm-sec-head', onclick: e => { if (e.target.closest('button')) return; this.expanded[key] = !open; this.render() } },
      icon(open ? 'chevronDown' : 'chevronRight', 14), h('span', null, title), h('span', { class: 'scm-count' }, String(items.length)),
      h('span', { class: 'scm-acts' }, headActs.map(([ic, label, fn]) => h('button', { class: 'icon-btn xs', title: label, 'aria-label': label, onclick: fn }, icon(ic, 14)))))
    const list = open ? items.map(x => {
      const [badge, kindLabel] = KIND[x.kind] || [x.kind, '']
      const name = x.path.split('/').pop(), dir = x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) : ''
      return h('div', { class: 'scm-row', title: `${x.path} — ${kindLabel}`, onclick: e => { if (e.target.closest('button')) return; this.openDiff(x, side) } },
        h('span', { class: 'scm-name' + (x.kind === 'D' ? ' deleted' : '') }, name), dir ? h('span', { class: 'scm-dir' }, dir) : null,
        h('span', { class: 'scm-acts' }, rowActs(x).filter(Boolean).map(([ic, label, fn]) => h('button', { class: 'icon-btn xs', title: label, 'aria-label': label, onclick: fn }, icon(ic, 14)))),
        h('span', { class: 'scm-kind k-' + badge }, badge))
    }) : []
    return h('div', { class: 'scm-sec' }, head, ...list)
  }

  historySection(log, refs) {
    const open = this.expanded.history
    const head = h('div', { class: 'scm-sec-head', onclick: () => { this.expanded.history = !open; this.render() } }, icon(open ? 'chevronDown' : 'chevronRight', 14), h('span', null, '履歴'), h('span', { class: 'scm-count' }, String(log.length)))
    const rows = open ? log.map(c => h('div', { class: 'scm-commit', onclick: () => this.openCommit(c) },
      h('span', { class: 'scm-dot' + (c.parents.length > 1 ? ' merge' : '') }),
      h('span', { class: 'scm-cmsg' }, firstLine(c.message)),
      (refs.get(c.id) || []).map(r => h('span', { class: 'scm-ref' + (r.startsWith('tag:') ? ' tag' : r.startsWith('HEAD') ? ' head' : '') }, r.replace('HEAD -> ', '').replace('tag: ', ''))),
      h('span', { class: 'scm-meta' }, `${short(c.id)} · ${ago(c.time)}`))) : []
    return h('div', { class: 'scm-sec' }, head, ...rows)
  }

  // ---- 差分 ----
  async openDiff(x, side) {
    const repo = this.repo
    const from = side === 'INDEX' ? 'HEAD' : 'INDEX'
    let a = null, b = null
    if (x.kind === '?') b = await appTree().read(x.path)
    else {
      const list = await repo.diff({ from: from === 'HEAD' && !repo.headId() ? null : from, to: side, paths: [x.path] })
      const f = list.find(y => y.path === x.path)
      if (f) { a = f.a; b = f.b }
      else if (x.kind === 'U') b = await appTree().read(x.path)
    }
    showDiff(x.path, a, b, side === 'WORK' && x.kind !== 'D' ? [{ label: 'ファイルを開く', run: () => { app.editors.open(x.path); if (app.wb.layout === 'mobile') app.wb.toggleSidebar(false) } }] : [])
  }
  async openCommit(c) {
    const repo = this.repo
    const files = await repo.diff({ from: c.parents[0] || null, to: c.id })
    const list = h('div', { class: 'scm-cfiles' }, files.map(f => h('button', { class: 'scm-cfile', onclick: () => showDiff(f.path, f.a, f.b, [], `${short(c.id)} — ${f.path}`) },
      h('span', { class: 'scm-kind k-' + f.kind }, f.kind), h('span', { class: 'scm-name' }, f.path), h('span', { class: 'scm-stat' }, f.binary ? 'バイナリ' : h('span', null, h('span', { class: 'add' }, `+${f.add}`), ' ', h('span', { class: 'del' }, `-${f.del}`))))))
    const body = h('div', { class: 'scm-cdetail' },
      h('pre', { class: 'scm-cmessage' }, c.message),
      h('div', { class: 'set-desc' }, `${c.author.name} ・ ${new Date(c.time).toLocaleString('ja-JP')} ・ ${c.id.slice(0, 12)}${c.parents.length > 1 ? ' ・ マージ' : ''}`),
      list)
    const close = modal({
      title: firstLine(c.message), wide: true, body,
      actions: [
        { label: 'この変更を取り消す (revert)', run: () => { after(() => repo.pick(c.id, { revert: true })).then(r => r && (r.conflicts ? toast('衝突しました。直してからコミットしてください', { kind: 'error' }) : toast('取り消すコミットを作りました', { icon: 'check' }))); return true } },
        { label: 'ここからブランチ', run: () => { this.newBranch(c.id); return true } },
        { label: 'この時点に戻す', danger: true, run: () => { (async () => { if (await confirmDialog('この時点に戻しますか?', `${short(c.id)} より後のコミットと、コミットしていない変更は消えます (git reset --hard)`, { okLabel: '戻す', danger: true })) after(() => repo.reset(c.id, 'hard')) })(); return true } },
        { label: '閉じる', primary: true, value: null },
      ],
    })
    void close
  }

  // ---- ブランチ ----
  async branchMenu(anchor) {
    const repo = this.repo
    const list = await repo.branches()
    const st = this.st
    menu([
      { section: 'ブランチを切り替える' },
      ...list.map(b => ({ label: b.name, icon: b.current ? 'check' : 'branch', run: () => !b.current && after(() => repo.checkout(b.name)).then(r => r && toast(`${b.name} に切り替えました`)) })),
      { section: 'ブランチ' },
      { label: '新しいブランチ…', icon: 'plus', run: () => this.newBranch() },
      list.length > 1 && st.branch ? { label: `ほかのブランチを ${st.branch} に取り込む (マージ)…`, icon: 'swap', run: () => this.mergeMenu(anchor, list.filter(b => !b.current)) } : null,
      list.length > 1 ? { label: 'ブランチを消す…', icon: 'trash', run: () => this.deleteMenu(anchor, list.filter(b => !b.current)) } : null,
    ], anchor)
  }
  async newBranch(from = 'HEAD') {
    const name = await promptDialog('新しいブランチ', { label: '名前 (英数字と - _ /)', placeholder: 'new-feature', okLabel: '作る' })
    if (!name) return
    const repo = this.repo
    const r = await after(async () => {
      if (from === 'HEAD') return repo.checkout(name.trim(), { create: true })
      await repo.createBranch(name.trim(), from)
      return repo.checkout(name.trim())
    })
    if (r) toast(`ブランチ ${name.trim()} を作って切り替えました`, { icon: 'branch' })
  }
  mergeMenu(anchor, list) {
    menu(list.map(b => ({ label: b.name, icon: 'branch', run: async () => {
      const r = await after(() => this.repo.merge(b.name))
      if (!r) return
      toast(r.upToDate ? 'もう最新です' : r.conflicts ? `衝突が ${r.conflicts.length} 個あります。直してからコミットしてください` : r.fastForward ? `${b.name} を取り込みました (fast-forward)` : `${b.name} をマージしました`, { kind: r.conflicts ? 'error' : undefined, duration: r.conflicts ? 7000 : 3000 })
    } })), anchor)
  }
  deleteMenu(anchor, list) {
    menu(list.map(b => ({ label: b.name, icon: 'trash', run: async () => {
      if (!(await confirmDialog(`ブランチ ${b.name} を消しますか?`, 'マージしていないコミットも消えます', { okLabel: '消す', danger: true }))) return
      const r = await after(() => this.repo.deleteBranch(b.name, { force: true }))
      if (r) toast(`${b.name} を消しました`)
    } })), anchor)
  }
  moreMenu(anchor) {
    const repo = this.repo
    menu([
      { section: 'しまう (stash)' },
      { label: '変更をしまう', icon: 'download', run: () => after(() => repo.stash()).then(r => r !== null && toast(r ? '変更をしまいました' : 'しまう変更がありません')) },
      { label: 'しまった変更を戻す', icon: 'upload', run: () => after(() => repo.stashApply(0, { pop: true })).then(r => r && toast(r.conflicts.length ? '衝突しました (stash は残してあります)' : '戻しました', { kind: r.conflicts.length ? 'error' : undefined })) },
      { section: 'GitHub' },
      { label: 'GitHub に保存 (push)', icon: 'upload', run: () => runCommand('githubPush') },
      { label: 'GitHub から取り込む (pull)', icon: 'download', run: () => runCommand('githubPull') },
      { section: 'その他' },
      { label: 'ターミナルで git を使う', icon: 'terminal', run: () => runCommand('terminal') },
    ], anchor)
  }
}

// 差分の画面 (変わった行を色分け)
export function showDiff(path, a, b, actions = [], title = null) {
  const bin = a instanceof Uint8Array || b instanceof Uint8Array
  const pre = h('div', { class: 'diff-view' })
  if (bin) pre.append(h('div', { class: 'set-desc' }, 'バイナリのファイルなので、違いを表示できません'))
  else {
    const lines = unifiedDiff(a, b, 3)
    if (!lines.length) pre.append(h('div', { class: 'set-desc' }, '違いはありません'))
    let an = 0, bn = 0
    for (const l of lines) {
      if (l.t === '@') { const m = /-(\d+)(?:,\d+)? \+(\d+)/.exec(l.s); an = Number(m[1]) - (/-\d+,0 /.test(l.s) ? 0 : 1); bn = Number(m[2]) - (/\+\d+,0 /.test(l.s) ? 0 : 1); pre.append(h('div', { class: 'dl hunk' }, l.s)); continue }
      if (l.t === '\\') { pre.append(h('div', { class: 'dl note' }, l.s.trim())); continue }
      if (l.t !== '+') an++
      if (l.t !== '-') bn++
      pre.append(h('div', { class: 'dl ' + (l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx') }, h('span', { class: 'ln' }, l.t === '+' ? '' : String(an)), h('span', { class: 'ln' }, l.t === '-' ? '' : String(bn)), h('span', { class: 'sg' }, l.t === ' ' ? ' ' : l.t), h('span', { class: 'tx' }, l.s)))
    }
  }
  modal({ title: title || path, wide: true, body: pre, actions: [...actions, { label: '閉じる', primary: true, value: null }] })
}

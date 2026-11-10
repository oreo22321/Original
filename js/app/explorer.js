// エクスプローラー (ファイルツリー) とプロジェクト管理
import * as vfs from './vfs.js'
import { app, refreshFiles, newFile, newFolder, deletePath, renamePath, openProject, runCommand, command } from './app.js'
import { on, getSettings, emit } from './store.js'
import { h, icon, fileIcon, menu, onLongPress, promptDialog, confirmDialog, toast, modal, download, shareFile, copyText, relTime } from './ui.js'
import { TEMPLATES, NEW_FILE_TEMPLATES } from './templates.js'

export class Explorer {
  constructor(root) {
    this.root = root
    this.expanded = new Set(JSON.parse(localStorage.getItem('forgecode.expanded') || '[]'))
    this.selectedDir = ''
    this.build()
    on('files', () => this.render())
    on('active', () => this.render())
    on('tabs', () => this.renderDirty())
    on('project', () => { this.renderHeader(); this.render() })
  }

  build() {
    this.header = h('div', { class: 'side-head' })
    this.tree = h('div', { class: 'tree', role: 'tree' })
    this.root.append(this.header, this.tree)
    this.tree.addEventListener('dragover', e => { if (e.dataTransfer && e.dataTransfer.types.includes('Files')) { e.preventDefault(); this.tree.classList.add('drop') } })
    this.tree.addEventListener('dragleave', () => this.tree.classList.remove('drop'))
    this.tree.addEventListener('drop', e => {
      this.tree.classList.remove('drop')
      if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); importFileList(e.dataTransfer.files, this.selectedDir) }
    })
    this.renderHeader()
  }

  renderHeader() {
    this.header.innerHTML = ''
    const name = app.project ? app.project.name : 'プロジェクトなし'
    this.header.append(
      h('button', { class: 'project-btn', title: 'プロジェクトを切り替え', onclick: () => runCommand('projects') }, icon('folder', 16), h('span', { class: 'project-name' }, name), icon('chevronDown', 14)),
      h('div', { class: 'side-actions' },
        h('button', { class: 'icon-btn', title: '新しいファイル', 'aria-label': '新しいファイル', onclick: () => runCommand('newFile', this.selectedDir) }, icon('newFile', 18)),
        h('button', { class: 'icon-btn', title: '新しいフォルダ', 'aria-label': '新しいフォルダ', onclick: () => runCommand('newFolder', this.selectedDir) }, icon('newFolder', 18)),
        h('button', { class: 'icon-btn', title: 'その他', 'aria-label': 'その他', onclick: e => this.moreMenu(e.currentTarget) }, icon('more', 18))))
  }

  moreMenu(anchor) {
    menu([
      { label: '端末からファイルを読み込む', icon: 'upload', run: () => runCommand('importFiles') },
      { label: 'ZIP を読み込む', icon: 'zip', run: () => runCommand('importZip') },
      { label: 'プロジェクトを ZIP で保存', icon: 'download', run: () => runCommand('exportZip') },
      '-',
      { label: 'すべて折りたたむ', run: () => { this.expanded.clear(); this.saveExpanded(); this.render() } },
      { label: '再読み込み', run: () => refreshFiles() },
      { label: 'プロジェクト一覧', icon: 'folder', run: () => runCommand('projects') },
    ], anchor)
  }

  saveExpanded() { try { localStorage.setItem('forgecode.expanded', JSON.stringify([...this.expanded])) } catch {} }

  reveal(path) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) this.expanded.add(parts.slice(0, i).join('/'))
    this.saveExpanded()
    this.render()
    requestAnimationFrame(() => {
      const el = this.tree.querySelector(`[data-path="${CSS.escape(path)}"]`)
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900) }
    })
  }

  render() {
    const tree = this.tree
    tree.innerHTML = ''
    if (!app.project) return
    // ツリー構造
    const children = new Map([['', []]])
    for (const f of app.files) {
      const parent = vfs.dirname(f.path)
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent).push(f)
      if (f.dir && !children.has(f.path)) children.set(f.path, [])
    }
    const sortFn = (a, b) => (a.dir === b.dir ? a.path.localeCompare(b.path, 'ja') : a.dir ? -1 : 1)
    const active = app.editors && app.editors.active
    const walk = (dir, depth) => {
      const list = (children.get(dir) || []).sort(sortFn)
      for (const f of list) {
        const name = vfs.basename(f.path)
        const open = this.expanded.has(f.path)
        const doc = app.editors && app.editors.docs.get(f.path)
        const row = h('div', {
          class: 'tree-row' + (f.path === active ? ' active' : '') + (doc && doc.dirty ? ' dirty' : '') + (f.dir ? ' dir' : ''),
          style: { paddingLeft: (8 + depth * 14) + 'px' }, role: 'treeitem', 'data-path': f.path, tabindex: '0',
          onclick: () => this.activate(f),
        },
        f.dir ? icon(open ? 'chevronDown' : 'chevronRight', 14, 'twisty') : h('span', { class: 'twisty-space' }),
        fileIcon(f.path, f.dir, open),
        h('span', { class: 'tree-name' }, name),
        name === 'workspace' && depth === 0 && f.dir ? h('span', { class: 'tree-tag', title: 'readfile / writefile の保存先' }, 'FS') : null,
        h('span', { class: 'tree-dot' }),
        h('button', { class: 'tree-more icon-btn', 'aria-label': 'メニュー', onclick: e => { e.stopPropagation(); this.itemMenu(f, e.currentTarget) } }, icon('more', 16)))
        row.addEventListener('keydown', e => { if (e.key === 'Enter') this.activate(f); if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) this.remove(f) ; if (e.key === 'F2') this.rename(f) })
        onLongPress(row, () => this.itemMenu(f, row))
        tree.append(row)
        if (f.dir && open) walk(f.path, depth + 1)
      }
    }
    walk('', 0)
    if (!app.files.length) {
      tree.append(h('div', { class: 'tree-empty' }, 'ファイルがありません',
        h('button', { class: 'btn small', onclick: () => runCommand('newFile') }, icon('newFile', 16), '新しいファイル')))
    }
  }

  renderDirty() {
    for (const row of this.tree.querySelectorAll('.tree-row')) {
      const doc = app.editors && app.editors.docs.get(row.dataset.path)
      row.classList.toggle('dirty', !!(doc && doc.dirty))
    }
  }

  activate(f) {
    if (f.dir) {
      this.selectedDir = f.path
      if (this.expanded.has(f.path)) this.expanded.delete(f.path)
      else this.expanded.add(f.path)
      this.saveExpanded()
      this.render()
    } else {
      this.selectedDir = vfs.dirname(f.path)
      app.editors.open(f.path)
      emit('fileOpened', f.path)
    }
  }

  itemMenu(f, anchor) {
    const dir = f.dir ? f.path : vfs.dirname(f.path)
    const runnable = !f.dir && /\.(luau?|py)$/i.test(f.path)
    menu([
      runnable ? { label: '実行', icon: 'play', run: async () => { await app.editors.open(f.path); runCommand('run') } } : null,
      { label: '新しいファイル', icon: 'newFile', run: () => runCommand('newFile', dir) },
      { label: '新しいフォルダ', icon: 'newFolder', run: () => runCommand('newFolder', dir) },
      '-',
      { label: '名前を変更 / 移動', icon: 'edit', run: () => this.rename(f) },
      !f.dir ? { label: '複製', icon: 'copy', run: () => this.duplicate(f) } : null,
      !f.dir ? { label: '内容をコピー', icon: 'copy', run: async () => { const c = await vfs.readFile(app.project.id, f.path); await copyText(c || ''); toast('クリップボードにコピーしました') } } : null,
      { label: 'パスをコピー', run: () => copyText(f.path).then(() => toast('コピーしました')) },
      !f.dir ? { label: '共有 / ファイルに保存', icon: 'share', run: async () => { const c = await vfs.readFile(app.project.id, f.path); shareFile(vfs.basename(f.path), c || '') } } : null,
      !f.dir ? { label: '履歴', icon: 'history', run: () => runCommand('history', f.path) } : null,
      '-',
      { label: '削除', icon: 'trash', danger: true, run: () => this.remove(f) },
    ], anchor, { title: f.path })
  }

  async rename(f) {
    const to = await promptDialog(f.dir ? 'フォルダ名の変更' : 'ファイル名の変更', { value: f.path, label: 'フォルダを変えると移動できます', selectBase: !f.dir })
    if (!to || to === f.path) return
    try { await renamePath(f.path, to) } catch (e) { toast(e.message, { kind: 'error' }) }
  }

  async duplicate(f) {
    const ext = f.path.match(/(\.[\w.]+)$/)
    const base = ext ? f.path.slice(0, -ext[1].length) : f.path
    let n = 1, path
    do { path = `${base} copy${n > 1 ? ' ' + n : ''}${ext ? ext[1] : ''}`; n++ } while (await vfs.exists(app.project.id, path))
    const content = await vfs.readFile(app.project.id, f.path)
    await newFile(path, content || '')
  }

  async remove(f) {
    if (getSettings().confirmDelete) {
      const ok = await confirmDialog('削除', `"${f.path}"${f.dir ? ' フォルダとその中身' : ''} を削除しますか?`, { okLabel: '削除', danger: true })
      if (!ok) return
    }
    const content = f.dir ? null : await vfs.readFile(app.project.id, f.path)
    await deletePath(f.path)
    toast(`"${vfs.basename(f.path)}" を削除しました`, content !== null ? { action: { label: '元に戻す', run: () => newFile(f.path, content) }, duration: 5000 } : {})
  }
}

// ============================================================
// 読み込み / 書き出し
// ============================================================
const TEXT_EXT = /\.(luau?|py|txt|md|json|js|mjs|ts|html?|css|xml|ya?ml|toml|csv|ini|cfg|rbxs|server|client|sh|gitignore)$/i

export async function importFileList(fileList, dir = '') {
  let n = 0
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name)) { await importZipFile(file); continue }
    if (file.size > 5 * 1024 * 1024) { toast(`${file.name} は大きすぎます (5MB まで)`, { kind: 'error' }); continue }
    const text = await file.text()
    const path = (dir ? dir + '/' : '') + (file.webkitRelativePath || file.name)
    await vfs.writeFile(app.project.id, path, text)
    n++
    if (n === 1 && TEXT_EXT.test(file.name)) setTimeout(() => app.editors.open(vfs.normPath(path)), 50)
  }
  await refreshFiles()
  if (n) toast(`${n} 個のファイルを読み込みました`, { icon: 'check' })
}

export function pickFiles(opts = {}) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', multiple: true, accept: opts.accept || '', style: { display: 'none' } })
    input.addEventListener('change', () => { resolve(input.files); input.remove() })
    document.body.append(input)
    input.click()
  })
}

async function importZipFile(file) {
  const { unzipSync, strFromU8 } = await import('../../vendor/fflate.js')
  const data = new Uint8Array(await file.arrayBuffer())
  let entries
  try { entries = unzipSync(data) } catch { toast('ZIP を開けませんでした', { kind: 'error' }); return }
  const paths = Object.keys(entries).filter(p => !p.endsWith('/') && !p.startsWith('__MACOSX'))
  // 共通のトップフォルダを取り除く
  const tops = new Set(paths.map(p => p.split('/')[0]))
  const strip = tops.size === 1 && paths.every(p => p.includes('/')) ? [...tops][0] + '/' : ''
  let n = 0
  for (const p of paths) {
    const rel = p.slice(strip.length)
    if (!rel) continue
    await vfs.writeFile(app.project.id, rel, strFromU8(entries[p]))
    n++
  }
  await refreshFiles()
  toast(`ZIP から ${n} 個のファイルを読み込みました`, { icon: 'check' })
}

export async function exportZip() {
  const { zipSync, strToU8 } = await import('../../vendor/fflate.js')
  const all = await vfs.readAll(app.project.id)
  const obj = {}
  for (const f of all) if (!f.dir) obj[app.project.name + '/' + f.path] = strToU8(f.content || '')
  const zip = zipSync(obj, { level: 6 })
  const name = app.project.name.replace(/[\\/:*?"<>|]/g, '_') + '.zip'
  await shareFile(name, new Blob([zip], { type: 'application/zip' }), 'application/zip')
}

// ============================================================
// プロジェクト一覧
// ============================================================
export async function showProjects() {
  const list = await vfs.listProjects()
  const body = h('div', { class: 'projects' })
  const m = modal({ title: 'プロジェクト', body, wide: true })
  const render = (projects) => {
    body.innerHTML = ''
    body.append(h('div', { class: 'section-title' }, '新しく作る'))
    const grid = h('div', { class: 'template-grid' })
    for (const [key, t] of Object.entries(TEMPLATES)) {
      grid.append(h('button', { class: 'template-card', onclick: async () => { m.close(); await createFromTemplate(key) } },
        h('div', { class: 'tc-icon' }, t.icon), h('div', { class: 'tc-name' }, t.name), h('div', { class: 'tc-desc' }, t.desc)))
    }
    grid.append(h('button', { class: 'template-card', onclick: async () => {
      m.close()
      const files = await pickFiles({ accept: '.zip,application/zip' })
      if (!files || !files.length) return
      const p = await vfs.createProject(files[0].name.replace(/\.zip$/i, ''), {})
      await openProject(p.id)
      await importZipFile(files[0])
    } }, h('div', { class: 'tc-icon' }, '📦'), h('div', { class: 'tc-name' }, 'ZIP から作成'), h('div', { class: 'tc-desc' }, 'ZIP ファイルを読み込みます')))
    body.append(grid)
    body.append(h('div', { class: 'section-title' }, `保存済み (${projects.length})`))
    const ul = h('div', { class: 'project-list' })
    for (const p of projects) {
      const isCur = app.project && app.project.id === p.id
      ul.append(h('div', { class: 'project-row' + (isCur ? ' current' : '') },
        h('button', { class: 'project-open', onclick: async () => { m.close(); if (!isCur) await openProject(p.id, { openMain: true }) } },
          icon('folder', 18), h('div', null, h('div', { class: 'pr-name' }, p.name), h('div', { class: 'pr-meta' }, (isCur ? '開いています ・ ' : '') + relTime(p.opened || p.created)))),
        h('button', { class: 'icon-btn', 'aria-label': 'メニュー', onclick: e => menu([
          { label: '名前を変更', icon: 'edit', run: async () => {
            const name = await promptDialog('プロジェクト名', { value: p.name })
            if (!name) return
            p.name = name
            await vfs.putProject(p)
            if (isCur) { app.project.name = name; emit('project', app.project) }
            render(await vfs.listProjects())
          } },
          { label: '複製', icon: 'copy', run: async () => {
            const files = await vfs.readAll(p.id)
            const obj = {}
            for (const f of files) obj[f.path + (f.dir ? '/' : '')] = f.content || ''
            await vfs.createProject(p.name + ' のコピー', obj)
            render(await vfs.listProjects())
          } },
          { label: '削除', icon: 'trash', danger: true, run: async () => {
            if (!(await confirmDialog('プロジェクトの削除', `"${p.name}" とすべてのファイルを削除しますか? 元に戻せません。`, { okLabel: '削除', danger: true }))) return
            await vfs.deleteProject(p.id)
            const rest = await vfs.listProjects()
            if (isCur) {
              if (rest.length) await openProject(rest[0].id, { openMain: true })
              else await createFromTemplate('lua')
            }
            render(await vfs.listProjects())
          } },
        ], e.currentTarget) }, icon('more', 18))))
    }
    body.append(ul)
  }
  render(list)
}

export async function createFromTemplate(key, name) {
  const t = TEMPLATES[key] || TEMPLATES.empty
  const existing = await vfs.listProjects()
  let base = name || t.name
  let n = 1, pname = base
  while (existing.some(p => p.name === pname)) pname = `${base} ${++n}`
  const p = await vfs.createProject(pname, t.files)
  await openProject(p.id, { openMain: t.main })
  return p
}

export async function newFileDialog(dir = '') {
  const keys = Object.keys(NEW_FILE_TEMPLATES)
  const body = h('div', { class: 'form' })
  const input = h('input', { class: 'input', placeholder: '例: main.luau / src/utils.py', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
  const chips = h('div', { class: 'chips' })
  let chosen = null
  for (const k of keys) {
    const t = NEW_FILE_TEMPLATES[k]
    const chip = h('button', { class: 'chip', onclick: () => {
      chosen = t
      chips.querySelectorAll('.chip').forEach(c => c.classList.remove('on'))
      chip.classList.add('on')
      const cur = input.value.trim()
      const stem = cur ? cur.replace(/(\.server|\.client)?\.[\w]+$/, '') : (dir ? dir + '/' : '') + (t.ext.startsWith('.server') || t.ext.startsWith('.client') ? 'Script' : t.ext === '.py' ? 'main' : t.ext === '.md' ? 'README' : 'module')
      input.value = stem + t.ext
      input.focus()
    } }, k)
    chips.append(chip)
  }
  input.value = dir ? dir + '/' : ''
  body.append(h('label', { class: 'label' }, 'ファイル名 (フォルダは / で区切ります)'), input, h('label', { class: 'label' }, '種類'), chips)
  const create = async () => {
    const path = input.value.trim()
    if (!path || path.endsWith('/')) { toast('ファイル名を入力してください', { kind: 'error' }); return false }
    const t = chosen || Object.values(NEW_FILE_TEMPLATES).find(x => path.endsWith(x.ext))
    const ok = await newFile(path, t ? t.content : '')
    if (ok) m.close()
    return false
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') create() })
  const m = modal({ title: '新しいファイル', body, actions: [{ label: 'キャンセル', value: null }, { label: '作成', primary: true, run: create }], sheet: false })
  setTimeout(() => input.focus(), 50)
}

command('importFiles', '端末からファイルを読み込む', async () => { const files = await pickFiles(); if (files && files.length) importFileList(files) }, { icon: 'upload' })
command('importZip', 'ZIP を読み込む', async () => { const files = await pickFiles({ accept: '.zip,application/zip' }); if (files && files.length) importZipFile(files[0]) }, { icon: 'zip' })
command('exportZip', 'プロジェクトを ZIP で保存', () => exportZip(), { icon: 'download' })
command('projects', 'プロジェクト一覧を開く', () => showProjects(), { icon: 'folder' })
command('newFile', '新しいファイル', dir => newFileDialog(typeof dir === 'string' ? dir : ''), { icon: 'newFile', key: '' })
command('newFolder', '新しいフォルダ', async dir => {
  const name = await promptDialog('新しいフォルダ', { value: typeof dir === 'string' && dir ? dir + '/' : '', label: 'フォルダ名' })
  if (name) newFolder(name)
}, { icon: 'newFolder' })

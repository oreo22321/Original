// 設定画面
import { getSettings, setSettings, resetSettings, DEFAULTS } from './store.js'
import { THEMES } from '../editor/themes.js'
import { AI_MODELS } from '../editor/ai.js'
import { h, icon, toast, modal, confirmDialog, download } from './ui.js'
import * as vfs from './vfs.js'
import { apiVersion } from '../editor/apidb.js'
import { app, command } from './app.js'

export const APP_VERSION = '4.0.0'

const FONTS = [
  ['ui-monospace, "SF Mono", SFMono-Regular, Menlo, "Cascadia Code", Consolas, "Noto Sans Mono CJK JP", "Hiragino Sans", monospace', '標準 (端末の等幅フォント)'],
  ['Menlo, Monaco, "Hiragino Sans", monospace', 'Menlo (Apple)'],
  ['"Cascadia Code", Consolas, "Yu Gothic", monospace', 'Cascadia / Consolas (Windows)'],
  ['"Courier New", Courier, monospace', 'Courier'],
  ['"Roboto Mono", "Noto Sans Mono", "Droid Sans Mono", monospace', 'Roboto Mono (Android)'],
]

const PRESETS = [
  { name: '🎮 Roblox 開発', desc: 'Roblox API の補完・チェック、タブ字下げ', patch: { robloxApi: true, executorApi: false, insertSpaces: false, tabSize: 4, luaRuntime: 'roblox', lintUndefined: true, theme: 'roblox-dark' } },
  { name: '⚡ エグゼキューター', desc: 'エグゼキューター API も補完・実行', patch: { robloxApi: true, executorApi: true, insertSpaces: false, luaRuntime: 'roblox', lintUndefined: true } },
  { name: '🐍 Python 学習', desc: 'スペース 4 つで字下げ', patch: { insertSpaces: true, tabSize: 4, theme: 'one-dark' } },
  { name: '🌙 標準 Lua', desc: 'Roblox なしの素の Lua として実行', patch: { robloxApi: false, executorApi: false, luaRuntime: 'plain' } },
  { name: '🔍 大きな文字', desc: '見やすさ重視', patch: { fontSize: 18, lineHeight: 1.7, wordWrap: true } },
  { name: '⚙️ 初期設定に戻す', desc: 'すべての設定を元に戻します', reset: true },
]

const SCHEMA = [
  { group: '見た目', icon: 'sun', items: [
    { key: 'theme', type: 'theme', label: 'テーマ' },
    { key: 'fontSize', type: 'range', min: 10, max: 28, label: '文字の大きさ', unit: 'px', desc: '2 本指でピンチしても変えられます' },
    { key: 'fontFamily', type: 'select', label: 'フォント', options: FONTS },
    { key: 'lineHeight', type: 'range', min: 1.2, max: 2.2, step: 0.05, label: '行の高さ' },
    { key: 'wordWrap', type: 'bool', label: '長い行を折り返す' },
    { key: 'lineNumbers', type: 'bool', label: '行番号を表示' },
    { key: 'highlightLine', type: 'bool', label: 'カーソルのある行を強調' },
    { key: 'indentGuides', type: 'bool', label: 'インデントガイド (縦線)' },
    { key: 'rainbowBrackets', type: 'bool', label: '括弧を色分け' },
    { key: 'layout', type: 'select', label: '画面レイアウト', options: [['auto', '自動 (画面の幅で切り替え)'], ['mobile', 'スマホ向け'], ['desktop', 'タブレット / PC 向け']] },
  ] },
  { group: 'エディタ', icon: 'edit', items: [
    { key: 'tabSize', type: 'select', label: 'タブの幅', options: [[2, '2'], [4, '4'], [8, '8']], num: true },
    { key: 'insertSpaces', type: 'bool', label: 'タブの代わりにスペースを入れる', desc: 'Roblox Studio はタブ、Python はスペースが一般的です (Python は常にスペース)' },
    { key: 'autoClose', type: 'bool', label: '括弧・引用符を自動で閉じる' },
    { key: 'autoEnd', type: 'bool', label: 'end を自動で入力 (Lua)', desc: 'then / do / function の後で改行すると end を追加します' },
    { key: 'colorPicker', type: 'bool', label: 'Color3 の色見本とカラーピッカー' },
    { key: 'pinchZoom', type: 'bool', label: 'ピンチで文字サイズを変更' },
  ] },
  { group: '補完・候補', icon: 'sparkle', items: [
    { key: 'autocomplete', type: 'bool', label: '入力中に補完候補を表示' },
    { key: 'inlineSuggest', type: 'bool', label: 'インライン候補 (薄い文字の続き)', desc: 'Tab で確定。local Players = → game:GetService("Players") など' },
    { key: 'signatureHelp', type: 'bool', label: '関数の引数ヒント' },
    { key: 'hover', type: 'bool', label: 'マウスを乗せたときの説明 (iPad / PC)' },
  ] },
  { group: 'エラーチェック', icon: 'alert', items: [
    { key: 'lint', type: 'bool', label: 'エラー・警告を表示' },
    { key: 'lintUndefined', type: 'bool', label: '定義されていない変数を警告' },
    { key: 'lintUnused', type: 'bool', label: '使われていない変数を薄く表示' },
  ] },
  { group: 'API', icon: 'cube', items: [
    { key: 'robloxApi', type: 'bool', label: 'Roblox API', desc: '補完・チェック・実行で Roblox の API を使います' },
    { key: 'executorApi', type: 'bool', label: 'エグゼキューター API', desc: 'getgenv / hookfunction / readfile / Drawing などを補完・模擬実行します' },
  ] },
  { group: '保存', icon: 'save', items: [
    { key: 'autoSave', type: 'bool', label: '自動保存' },
    { key: 'autoSaveDelay', type: 'range', min: 200, max: 5000, step: 100, label: '自動保存までの時間', unit: 'ms' },
    { key: 'formatOnSave', type: 'bool', label: '保存時に整形 (Lua)', desc: '⌘/Ctrl + S で保存したとき' },
    { key: 'trimOnSave', type: 'bool', label: '保存時に行末の空白を削除' },
    { key: 'confirmDelete', type: 'bool', label: '削除の前に確認' },
  ] },
  { group: '実行', icon: 'play', items: [
    { key: 'luaRuntime', type: 'select', label: '.lua ファイルの実行環境', options: [['roblox', 'Roblox (Luau + Roblox API)'], ['plain', '標準 Lua (Roblox API なし)']], desc: '.luau ファイルは常に Roblox 環境で実行します' },
    { key: 'timeLimit', type: 'range', min: 1, max: 60, label: '連続実行の上限 (無限ループ対策)', unit: '秒' },
    { key: 'maxRunTime', type: 'range', min: 0, max: 600, step: 10, label: '最大実行時間', unit: '秒', desc: '0 で無制限 (Heartbeat などを使うスクリプト向け)' },
    { key: 'clearOnRun', type: 'bool', label: '実行前に出力をクリア' },
    { key: 'pyodideUrl', type: 'text', label: 'Python (Pyodide) の読み込み元', desc: '通常は変更不要です' },
  ] },
  { group: 'AI (Claude)', icon: 'sparkle', items: [
    { key: 'aiKey', type: 'password', label: 'Claude API キー', desc: 'console.anthropic.com で発行します。キーはこの端末のブラウザにのみ保存され、Anthropic の API にだけ送信されます。利用料金は API キーの持ち主に請求されます。' },
    { key: 'aiModel', type: 'select', label: 'モデル', options: AI_MODELS.map(m => [m.id, m.label]) },
    { key: 'aiInline', type: 'bool', label: 'AI のインライン候補', desc: '入力が止まると AI が続きを提案します (API の利用料金がかかります)' },
    { key: 'aiDelay', type: 'range', min: 300, max: 3000, step: 100, label: 'AI 候補を出すまでの待ち時間', unit: 'ms' },
    { key: 'aiIncludeFile', type: 'bool', label: 'AI チャットに開いているファイルを含める' },
  ] },
  { group: 'スマホ・タブレット', icon: 'keyboard', items: [
    { key: 'keybar', type: 'bool', label: 'キーボードバー (記号・矢印)' },
    { key: 'keybarKeys', type: 'text', label: 'キーボードバーの記号', desc: 'スペース区切りで並べます' },
    { key: 'haptics', type: 'bool', label: 'キーを押したときの振動 (対応端末のみ)' },
  ] },
]

export class SettingsView {
  constructor(root) {
    this.root = root
    this.filter = ''
    this.build()
  }

  build() {
    this.search = h('input', { class: 'input', placeholder: '設定を検索', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    this.search.addEventListener('input', () => { this.filter = this.search.value.trim().toLowerCase(); this.render() })
    this.body = h('div', { class: 'settings-body' })
    this.root.append(h('div', { class: 'side-head' }, h('div', { class: 'side-title' }, '設定')), h('div', { class: 'settings-search' }, this.search), this.body)
    this.render()
  }

  render() {
    const s = getSettings()
    const body = this.body
    body.innerHTML = ''
    if (!this.filter) {
      body.append(h('div', { class: 'set-group-title' }, icon('sparkle', 16), 'かんたん設定'))
      const grid = h('div', { class: 'preset-grid' })
      for (const p of PRESETS) {
        grid.append(h('button', { class: 'preset', onclick: async () => {
          if (p.reset) {
            if (await confirmDialog('設定のリセット', 'すべての設定を初期状態に戻しますか? (API キーは残ります)', { okLabel: 'リセット', danger: true })) { resetSettings(); this.render(); toast('初期設定に戻しました') }
            return
          }
          setSettings(p.patch); this.render(); toast(`「${p.name.replace(/^\S+\s/, '')}」の設定にしました`)
        } }, h('div', { class: 'preset-name' }, p.name), h('div', { class: 'preset-desc' }, p.desc)))
      }
      body.append(grid)
    }
    for (const g of SCHEMA) {
      const items = g.items.filter(it => !this.filter || (it.label + (it.desc || '') + g.group).toLowerCase().includes(this.filter))
      if (!items.length) continue
      body.append(h('div', { class: 'set-group-title' }, icon(g.icon, 16), g.group))
      const box = h('div', { class: 'set-group' })
      for (const it of items) box.append(this.row(it, s))
      body.append(box)
    }
    if (!this.filter || 'データ バックアップ'.includes(this.filter)) {
      body.append(h('div', { class: 'set-group-title' }, icon('save', 16), 'データ'))
      const box = h('div', { class: 'set-group' })
      box.append(
        this.actionRow('すべてのプロジェクトを ZIP で保存', 'バックアップや他の端末への移動に', '保存', () => backupAll()),
        this.actionRow('設定を JSON で編集', '上級者向け', '編集', () => editJson(() => this.render())),
        this.actionRow('ストレージの永続化', 'ブラウザがデータを自動削除しないように要求します', '要求', async () => { const ok = await vfs.requestPersist(); toast(ok ? '永続化されました' : 'ブラウザが許可しませんでした (ホーム画面に追加すると許可されやすくなります)') }),
      )
      const est = h('div', { class: 'set-desc' }, '計算中…')
      vfs.storageEstimate().then(e => { est.textContent = e ? `使用量: ${(e.usage / 1024 / 1024).toFixed(1)} MB / 上限 約 ${(e.quota / 1024 / 1024 / 1024).toFixed(1)} GB` : '使用量を取得できません' })
      box.append(h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'ストレージ'), est)))
      body.append(box)
      body.append(h('div', { class: 'set-group-title' }, icon('info', 16), '情報'))
      body.append(h('div', { class: 'set-group' },
        h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, `ForgeCode ${APP_VERSION}`), h('div', { class: 'set-desc' }, `Roblox API: ${apiVersion()} ・ エディタ: CodeMirror 6`))),
        this.actionRow('アプリを最新版に更新', 'キャッシュを消して再読み込みします', '更新', async () => {
          try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))) } catch {}
          try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.update())) } catch {}
          location.reload()
        }),
        this.actionRow('使い方', 'できること・操作方法', '表示', () => app.commands.get('help').run()),
        this.actionRow('はじめの設定をやり直す', 'ようこそ画面を表示します', '表示', () => app.commands.get('onboarding').run())))
    }
  }

  actionRow(label, desc, btn, run) {
    return h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, label), desc ? h('div', { class: 'set-desc' }, desc) : null), h('button', { class: 'btn small', onclick: run }, btn))
  }

  row(it, s) {
    const val = s[it.key]
    const set = v => { setSettings({ [it.key]: v }) }
    let control
    switch (it.type) {
      case 'bool': {
        control = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!val, onchange: e => set(e.target.checked) }), h('span', { class: 'slider' }))
        break
      }
      case 'range': {
        const out = h('span', { class: 'range-val' }, String(val) + (it.unit || ''))
        const inp = h('input', { type: 'range', min: it.min, max: it.max, step: it.step || 1, value: val, oninput: e => { out.textContent = e.target.value + (it.unit || '') }, onchange: e => set(Number(e.target.value)) })
        control = h('div', { class: 'range' }, inp, out)
        break
      }
      case 'select': {
        const sel = h('select', { class: 'select', onchange: e => set(it.num ? Number(e.target.value) : e.target.value) })
        for (const [v, label] of it.options) sel.append(h('option', { value: v, selected: String(v) === String(val) }, label))
        control = sel
        break
      }
      case 'text': case 'password': {
        const inp = h('input', { class: 'input', type: it.type === 'password' ? 'password' : 'text', value: val || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: it.type === 'password' ? 'sk-ant-...' : '' })
        inp.addEventListener('change', () => set(inp.value.trim()))
        control = it.type === 'password'
          ? h('div', { class: 'input-row' }, inp, h('button', { class: 'icon-btn', 'aria-label': '表示', onclick: () => { inp.type = inp.type === 'password' ? 'text' : 'password' } }, icon('eye', 18)))
          : inp
        break
      }
      case 'theme': {
        const grid = h('div', { class: 'theme-grid' })
        for (const [id, th] of Object.entries(THEMES)) {
          const c = th.c
          grid.append(h('button', { class: 'theme-card' + (id === val ? ' on' : ''), onclick: () => { set(id); this.render() }, style: { background: c.bg, color: c.fg } },
            h('div', { class: 'theme-code' }, h('span', { style: { color: c.keyword } }, 'local '), h('span', { style: { color: c.def } }, 'x'), ' = ', h('span', { style: { color: c.func } }, 'f'), '(', h('span', { style: { color: c.string } }, '"hi"'), ')'),
            h('div', { class: 'theme-name' }, th.name)))
        }
        return h('div', { class: 'set-row col' }, h('div', { class: 'set-label' }, it.label), grid)
      }
    }
    const wide = it.type === 'text' || it.type === 'password' || it.type === 'range'
    return h('div', { class: 'set-row' + (wide ? ' col' : '') }, h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, it.label), it.desc ? h('div', { class: 'set-desc' }, it.desc) : null), control)
  }
}

async function backupAll() {
  const { zipSync, strToU8 } = await import('../../vendor/fflate.js')
  const projects = await vfs.listProjects()
  const obj = {}
  for (const p of projects) {
    const files = await vfs.readAll(p.id)
    for (const f of files) if (!f.dir) obj[p.name.replace(/[\\/:*?"<>|]/g, '_') + '/' + f.path] = strToU8(f.content || '')
  }
  const zip = zipSync(obj, { level: 6 })
  download(`forgecode-backup-${new Date().toISOString().slice(0, 10)}.zip`, new Blob([zip], { type: 'application/zip' }))
}

function editJson(onDone) {
  const s = { ...getSettings() }
  delete s.aiKey
  const ta = h('textarea', { class: 'input mono json-edit', rows: '18', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' })
  ta.value = JSON.stringify(s, null, 2)
  modal({
    title: '設定 (JSON)', wide: true,
    body: h('div', { class: 'form' }, ta, h('div', { class: 'set-desc' }, '保存すると反映されます。不明な項目は無視されます。')),
    actions: [{ label: 'キャンセル', value: null }, { label: '保存', primary: true, run: () => {
      try {
        const obj = JSON.parse(ta.value)
        const patch = {}
        for (const k of Object.keys(DEFAULTS)) if (k in obj && k !== 'aiKey') patch[k] = obj[k]
        setSettings(patch)
        onDone()
        toast('設定を保存しました')
      } catch (e) { toast('JSON が正しくありません: ' + e.message, { kind: 'error' }); return false }
    } }],
  })
}

command('settings', '設定を開く', () => app.wb.showView('settings'), { icon: 'gear', key: '⌘,' })

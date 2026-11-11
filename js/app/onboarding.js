// はじめての起動時の案内 (3 ステップ)
import { getSettings, setSettings, isTouch } from './store.js'
import { THEMES } from '../editor/themes.js'
import { h, icon } from './ui.js'
import { createFromTemplate } from './explorer.js'
import { TEMPLATES } from './templates.js'
import { app, command } from './app.js'
import * as vfs from './vfs.js'

const PURPOSES = [
  ['studio', 'cube', 'Roblox Studio 用のスクリプト', 'ゲームを作る。Script / LocalScript / ModuleScript', ['Roblox の全 API を補完', 'サーバーとクライアントの間違いを指摘', 'GUI をその場でプレビュー']],
  ['executor', 'bolt', 'エグゼキューター用のスクリプト', 'getgenv・writefile・hookfunction などの専用 API', ['エグゼキューター API を補完・模擬実行', 'ファイル関数は workspace フォルダに保存', 'ワンタップでコード全体をコピー']],
]

export function showOnboarding() {
  return new Promise(resolve => {
    const overlay = h('div', { class: 'onboard' })
    const card = h('div', { class: 'onboard-card' })
    overlay.append(card)
    document.body.append(overlay)
    const state = { purpose: 'studio', theme: getSettings().theme, fontSize: getSettings().fontSize }
    let step = 0

    const dots = () => h('div', { class: 'ob-dots' }, [0, 1, 2].map(i => h('span', { class: i === step ? 'on' : '' })))
    const finish = async (skip) => {
      setSettings({ onboarded: true })
      overlay.classList.add('closing')
      setTimeout(() => overlay.remove(), 250)
      if (!skip || !app.project) {
        const existing = await vfs.listProjects()
        if (!skip || !existing.length) await createFromTemplate(state.purpose)
      }
      resolve()
    }

    const render = () => {
      card.textContent = ''
      if (step === 0) {
        card.append(
          h('div', { class: 'ob-hero' }, h('img', { class: 'ob-logo', src: 'icons/icon.svg', alt: '', width: '64', height: '64' }), h('h1', null, 'ForgeCode へようこそ'), h('p', null, 'スマホ・iPad で書ける、Roblox 専用の Luau エディタです。どちらのスクリプトを書きますか?')),
          h('div', { class: 'ob-options' }, PURPOSES.map(([key, ic, title, desc, points]) => h('button', {
            class: 'ob-option' + (state.purpose === key ? ' on' : ''),
            onclick: () => { state.purpose = key; render() },
          }, h('span', { class: 'ob-ico k-' + key }, icon(ic, 26)), h('span', { class: 'ob-otext' }, h('b', null, title), h('small', null, desc), state.purpose === key ? h('ul', { class: 'ob-points' }, points.map(p => h('li', null, p))) : null), state.purpose === key ? icon('check', 20, 'ob-check') : null))),
          h('p', { class: 'ob-sub' }, 'あとからプロジェクトごとに切り替えられます'),
          dots(),
          h('div', { class: 'ob-foot' }, h('button', { class: 'btn ghost', onclick: () => finish(true) }, 'スキップ'), h('button', { class: 'btn primary', onclick: () => { step = 1; render() } }, '次へ')))
      } else if (step === 1) {
        const preview = h('pre', { class: 'ob-preview' })
        const paint = () => {
          const c = THEMES[state.theme].c
          preview.style.background = c.bg
          preview.style.color = c.fg
          preview.style.fontSize = state.fontSize + 'px'
          preview.innerHTML = `<span style="color:${c.keyword}">local</span> <span style="color:${c.def}">Players</span> = <span style="color:${c.builtin}">game</span>:<span style="color:${c.func}">GetService</span>(<span style="color:${c.string}">"Players"</span>)\n<span style="color:${c.comment};font-style:italic">-- コメント</span>\n<span style="color:${c.control}">for</span> i = <span style="color:${c.number}">1</span>, <span style="color:${c.number}">3</span> <span style="color:${c.control}">do</span>\n\t<span style="color:${c.builtin}">print</span>(i)\n<span style="color:${c.control}">end</span>`
        }
        const themes = h('div', { class: 'ob-themes' }, Object.entries(THEMES).map(([id, th]) => h('button', {
          class: 'ob-theme' + (state.theme === id ? ' on' : ''), style: { background: th.c.bg, color: th.c.fg, borderColor: state.theme === id ? th.c.keyword : 'transparent' },
          onclick: () => { state.theme = id; setSettings({ theme: id }); render() },
        }, th.name)))
        const sizeLabel = h('span', { class: 'range-val' }, state.fontSize + 'px')
        const size = h('input', { type: 'range', min: 11, max: 24, value: state.fontSize, oninput: e => { state.fontSize = Number(e.target.value); sizeLabel.textContent = state.fontSize + 'px'; paint() }, onchange: () => setSettings({ fontSize: state.fontSize }) })
        paint()
        card.append(
          h('h2', null, '見た目を選ぶ'),
          h('p', { class: 'ob-sub' }, 'あとから設定でいつでも変更できます'),
          themes, preview,
          h('div', { class: 'ob-size' }, h('span', null, '文字の大きさ'), size, sizeLabel),
          dots(),
          h('div', { class: 'ob-foot' }, h('button', { class: 'btn ghost', onclick: () => { step = 0; render() } }, '戻る'), h('button', { class: 'btn primary', onclick: () => { setSettings({ fontSize: state.fontSize }); step = 2; render() } }, '次へ')))
      } else {
        const tips = isTouch
          ? [['menu', 'ファイル一覧', '左上のボタンで開きます'], ['play', '実行', '右上の ▶ で実行。結果とエラーの解説が下に出ます'], ['check', '候補の確定', '薄い文字の続きは、キーボードの上の ✓ で確定'], ['bulb', 'エラーの修正', '赤い説明をタップすると、直し方を選べます'], ['keyboard', 'キーボードバー', '記号・矢印・Tab をワンタップで入力'], ['download', 'ホーム画面に追加', '共有 → ホーム画面に追加 で全画面アプリになります']]
          : [['search', 'ファイルを開く  ⌘P', 'ファイル名で検索して開きます'], ['command', 'コマンド  ⌘⇧P', 'すべての機能を検索して実行'], ['play', '実行  ⌘Enter', '結果とエラーの解説が下に出ます'], ['check', '候補の確定  Tab', '薄い文字の続きを確定'], ['bulb', 'エラーの修正  ⌘.', 'その行の直し方を選べます'], ['save', '自動保存', '入力するたびに自動で保存されます']]
        card.append(
          h('h2', null, '準備ができました'),
          h('p', { class: 'ob-sub' }, `「${TEMPLATES[state.purpose].name}」のサンプルを作成します`),
          h('div', { class: 'ob-tips' }, tips.map(([ic, t, d]) => h('div', { class: 'ob-tip' }, h('span', { class: 'ob-key' }, icon(ic, 18)), h('div', null, h('b', null, t), h('small', null, d))))),
          dots(),
          h('div', { class: 'ob-foot' }, h('button', { class: 'btn ghost', onclick: () => { step = 1; render() } }, '戻る'), h('button', { class: 'btn primary big', onclick: () => finish(false) }, 'はじめる')))
      }
    }
    render()
    requestAnimationFrame(() => overlay.classList.add('show'))
  })
}

command('onboarding', 'ようこそ画面を表示', () => showOnboarding(), { icon: 'home' })

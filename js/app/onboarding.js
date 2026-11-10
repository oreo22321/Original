// はじめての起動時の案内 (3 ステップ)
import { getSettings, setSettings, isTouch } from './store.js'
import { THEMES } from '../editor/themes.js'
import { h, icon } from './ui.js'
import { createFromTemplate } from './explorer.js'
import { TEMPLATES } from './templates.js'
import { app, command } from './app.js'
import * as vfs from './vfs.js'

export function showOnboarding({ force = false } = {}) {
  return new Promise(resolve => {
    const overlay = h('div', { class: 'onboard' })
    const card = h('div', { class: 'onboard-card' })
    overlay.append(card)
    document.body.append(overlay)
    const state = { purpose: 'roblox', theme: getSettings().theme, fontSize: getSettings().fontSize }
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
      card.innerHTML = ''
      if (step === 0) {
        const purposes = [
          ['roblox', '🎮', 'Roblox のゲームを作る', 'Luau / Roblox Studio 用のスクリプト'],
          ['executor', '⚡', 'エグゼキューター用スクリプト', 'getgenv・writefile などの API も補完'],
          ['python', '🐍', 'Python を書く', 'ブラウザ内で Python 3 を実行'],
          ['lua', '🌙', 'Lua を練習する', '基本文法のサンプル付き'],
        ]
        card.append(
          h('div', { class: 'ob-hero' }, h('div', { class: 'ob-logo' }, '⚒︎'), h('h1', null, 'ForgeCode へようこそ'), h('p', null, 'スマホ・iPad で快適に使えるコードエディタです。まず、何を作るか選んでください。')),
          h('div', { class: 'ob-options' }, purposes.map(([key, emoji, title, desc]) => h('button', {
            class: 'ob-option' + (state.purpose === key ? ' on' : ''),
            onclick: () => {
              state.purpose = key
              const patch = key === 'python' ? { insertSpaces: true } : key === 'executor' ? { executorApi: true, robloxApi: true, insertSpaces: false } : key === 'roblox' ? { robloxApi: true, executorApi: false, insertSpaces: false } : { insertSpaces: false }
              setSettings(patch)
              render()
            },
          }, h('span', { class: 'ob-emoji' }, emoji), h('span', { class: 'ob-otext' }, h('b', null, title), h('small', null, desc)), state.purpose === key ? icon('check', 18) : null))),
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
          class: 'ob-theme' + (state.theme === id ? ' on' : ''), style: { background: th.c.bg, color: th.c.fg, borderColor: th.c.keyword },
          onclick: () => { state.theme = id; setSettings({ theme: id }); render() },
        }, th.name)))
        const size = h('input', { type: 'range', min: 11, max: 24, value: state.fontSize, oninput: e => { state.fontSize = Number(e.target.value); sizeLabel.textContent = state.fontSize + 'px'; paint() }, onchange: () => setSettings({ fontSize: state.fontSize }) })
        const sizeLabel = h('span', { class: 'range-val' }, state.fontSize + 'px')
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
          ? [['☰', 'ファイル一覧', '左上のボタンで開きます'], ['▶', '実行', '右上のボタンで実行。結果は下に表示'], ['⌨', 'キーボードバー', '記号・矢印・Tab をワンタップで入力'], ['✓', 'インライン候補', '薄い文字の続きは ✓ (Tab) で確定'], ['🤏', 'ピンチで拡大', '2 本指で文字の大きさを変更'], ['📲', 'ホーム画面に追加', '共有 → ホーム画面に追加で全画面アプリに']]
          : [['⌘P', 'ファイルを開く', 'ファイル名で検索して開きます'], ['⌘⇧P', 'コマンドパレット', 'すべての機能を検索して実行'], ['⌘Enter', '実行', '結果は下のパネルに表示'], ['Tab', 'インライン候補', '薄い文字の続きを確定'], ['⌘S', '保存', '自動保存もオンになっています'], ['⌘B / ⌘J', '表示切り替え', 'サイドバー / パネル']]
        card.append(
          h('h2', null, '準備ができました!'),
          h('p', { class: 'ob-sub' }, `「${TEMPLATES[state.purpose].name}」のサンプルプロジェクトを作成します`),
          h('div', { class: 'ob-tips' }, tips.map(([k, t, d]) => h('div', { class: 'ob-tip' }, h('span', { class: 'ob-key' }, k), h('div', null, h('b', null, t), h('small', null, d))))),
          dots(),
          h('div', { class: 'ob-foot' }, h('button', { class: 'btn ghost', onclick: () => { step = 1; render() } }, '戻る'), h('button', { class: 'btn primary big', onclick: () => finish(false) }, 'はじめる')))
      }
    }
    render()
    requestAnimationFrame(() => overlay.classList.add('show'))
    void force
  })
}

command('onboarding', 'ようこそ画面を表示', () => showOnboarding({ force: true }), { icon: 'home' })

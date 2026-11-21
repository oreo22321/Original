// プロファイル (時間のかかった関数・行) の表。実行画面の出力に出します (行をタップでその場所へ)
import { app } from './app.js'
import { h, icon } from './ui.js'

const sec = s => (s >= 1 ? `${s.toFixed(2)} 秒` : s >= 0.001 ? `${(s * 1000).toFixed(1)} ms` : `${(s * 1e6).toFixed(0)} µs`)

function goto(file, line) {
  if (!file || !app.files.some(f => f.path === file)) return
  if (app.runner.full) app.runner.exitFull()
  app.editors.open(file, { line })
}

export function profileBlock(d) {
  const total = d.total || 0
  const max = Math.max(1e-9, ...d.functions.map(f => f.self))
  const tabs = h('div', { class: 'pf-tabs' })
  const body = h('div', { class: 'pf-body' })
  const showFuncs = () => {
    body.replaceChildren(h('div', { class: 'pf-row pf-head' }, h('span', null, '関数'), h('span', null, '回数'), h('span', null, '中だけ'), h('span', null, '合計')),
      ...d.functions.slice(0, 40).map(f => h('div', { class: 'pf-row' + (f.project ? ' mine' : ''), onclick: () => goto(f.file, f.line), title: f.project ? `${f.file}:${f.line} へ` : f.where },
        h('span', { class: 'pf-name' }, h('span', { class: 'pf-bar', style: { width: `${Math.max(2, f.self / max * 100)}%` } }), h('b', null, f.name), h('small', null, f.line ? `${f.where}:${f.line}` : f.where)),
        h('span', { class: 'pf-n' }, f.calls === f.prim ? String(f.calls) : `${f.calls}/${f.prim}`),
        h('span', { class: 'pf-n' }, sec(f.self)),
        h('span', { class: 'pf-n' }, sec(f.total)))))
  }
  const showLines = () => {
    const lmax = Math.max(1e-9, ...d.lines.map(l => l.time))
    body.replaceChildren(h('div', { class: 'pf-row pf-head lines' }, h('span', null, '行'), h('span', null, '回数'), h('span', null, '時間')),
      ...(d.lines.length ? d.lines.slice(0, 40).map(l => h('div', { class: 'pf-row lines mine', onclick: () => goto(l.file, l.line), title: `${l.file}:${l.line} へ` },
        h('span', { class: 'pf-name' }, h('span', { class: 'pf-bar', style: { width: `${Math.max(2, l.time / lmax * 100)}%` } }), h('code', null, l.code || '(空)'), h('small', null, `${l.file}:${l.line}`)),
        h('span', { class: 'pf-n' }, String(l.hits)),
        h('span', { class: 'pf-n' }, sec(l.time)))) : [h('div', { class: 'pf-empty' }, '行ごとの記録はありません')]))
  }
  const tab = (label, fn) => h('button', { class: 'pf-tab', onclick: e => { tabs.querySelectorAll('.pf-tab').forEach(b => b.classList.toggle('on', b === e.currentTarget)); fn() } }, label)
  tabs.append(tab('関数', showFuncs), tab('行', showLines))
  tabs.firstChild.classList.add('on')
  showFuncs()
  const el = h('div', { class: 'out-html pf' },
    h('div', { class: 'pf-title' }, icon('gauge', 15), h('span', null, `時間のかかったところ — 合計 ${sec(total)}`)),
    tabs, body,
    h('div', { class: 'pf-note' }, '「中だけ」はその関数の中だけの時間、「合計」は中で呼んだ関数も含めた時間。行の時間は目安です (調べるために少し遅くなります)'))
  el.dataset.text = `プロファイル: 合計 ${sec(total)}`
  return el
}

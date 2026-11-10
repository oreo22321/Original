// UI 配線 + 演出。すべて端末内で処理。
import { obfuscate, PRESETS } from './engine.js'

const $ = (id) => document.getElementById(id)
const input = $('input'), output = $('output'), runBtn = $('run')
const statusEl = $('status'), overlay = $('overlay')
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const OPT_IDS = ['vm', 'vmDouble', 'hideApi', 'rename', 'hoist', 'numbers', 'strings', 'junk', 'wrap', 'minify']

const SAMPLE = `-- サンプル: 簡単なスクリプト
local Players = game:GetService("Players")

local config = {
	greeting = "ようこそ！",
	maxLives = 3,
}

local function onPlayerAdded(player)
	print(config.greeting, player.Name)
	local lives = config.maxLives
	for i = 1, lives do
		print("残りライフ:", lives - i + 1)
	end
end

Players.PlayerAdded:Connect(onPlayerAdded)
print("起動:", #Players:GetPlayers() .. "人")
`

/* ---------- プリセット ---------- */
function applyPreset(name) {
  const p = PRESETS[name]
  for (const k of OPT_IDS) $('opt-' + k).checked = !!p[k]
  for (const b of document.querySelectorAll('.preset')) b.classList.toggle('active', b.dataset.preset === name)
}
for (const b of document.querySelectorAll('.preset')) b.addEventListener('click', () => applyPreset(b.dataset.preset))
for (const k of OPT_IDS) $('opt-' + k).addEventListener('change', () => {
  for (const b of document.querySelectorAll('.preset')) b.classList.remove('active')
})
function readOptions() { const o = {}; for (const k of OPT_IDS) o[k] = $('opt-' + k).checked; return o }

/* ---------- 文字数 ---------- */
const fmt = (n) => n.toLocaleString()
function updateInStat() { $('inStat').textContent = `${fmt(input.value.length)} 文字` }
input.addEventListener('input', updateInStat)

/* ---------- 演出: スクランブル ---------- */
const GLYPHS = '0123456789ABCDEF{}[],.()<>=+-*/%:#$&|~^abcdef止回メ丁刀又卜'.split('')
function randLine(len) { let s = ''; for (let i = 0; i < len; i++) s += GLYPHS[(Math.random() * GLYPHS.length) | 0]; return s }
let scrambleTimer = null
function startScramble() {
  const el = $('scramble')
  if (reduceMotion) { el.textContent = ''; return }
  const tick = () => {
    let out = ''
    for (let i = 0; i < 6; i++) out += randLine(28 + ((Math.random() * 16) | 0)) + '\n'
    el.textContent = out
  }
  tick(); scrambleTimer = setInterval(tick, 70)
}
function stopScramble() { if (scrambleTimer) clearInterval(scrambleTimer); scrambleTimer = null; $('scramble').textContent = '' }

/* ---------- 演出: パイプライン ---------- */
const STAGES = [...document.querySelectorAll('.stage')]
function resetStages() { STAGES.forEach(s => s.classList.remove('active', 'done')); $('prog').style.width = '0%' }
function playStages() {
  // 4 段階を順に点灯。reduce-motion なら即完了。
  if (reduceMotion) { STAGES.forEach(s => s.classList.add('done')); $('prog').style.width = '100%'; return Promise.resolve() }
  return new Promise((resolve) => {
    let i = 0
    const step = () => {
      if (i > 0) STAGES[i - 1].classList.replace('active', 'done')
      if (i >= STAGES.length) { $('prog').style.width = '100%'; return resolve() }
      STAGES[i].classList.add('active')
      $('prog').style.width = `${((i + 1) / STAGES.length) * 100}%`
      i++
      setTimeout(step, 210)
    }
    step()
  })
}

/* ---------- 演出: 数値カウントアップ ---------- */
function countUp(el, to, suffix = '', ms = 500) {
  if (reduceMotion) { el.textContent = fmt(to) + suffix; return }
  const start = performance.now()
  const run = (t) => {
    const k = Math.min(1, (t - start) / ms)
    const e = 1 - Math.pow(1 - k, 3)
    el.textContent = fmt(Math.round(to * e)) + suffix
    if (k < 1) requestAnimationFrame(run)
  }
  requestAnimationFrame(run)
}

/* ---------- アイコン ---------- */
const ICON = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path class="check-draw" d="M20 6L9 17l-5-5"></path></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>',
  err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M15 9l-6 6M9 9l6 6"></path></svg>',
}
function showStatus(kind, title, sub) {
  statusEl.className = 'status show ' + kind
  $('badge').innerHTML = ICON[kind] || ''
  $('statusTitle').textContent = title
  $('statusSub').textContent = sub || ''
}

/* ---------- 実行 ---------- */
let busy = false
async function run() {
  if (busy) return
  const src = input.value
  if (!src.trim()) { showStatus('err', 'コードを入力してください', ''); return }
  busy = true

  runBtn.disabled = true
  runBtn.querySelector('.label').textContent = '処理中'
  const icon = runBtn.querySelector('svg'); const spin = document.createElement('span'); spin.className = 'spin'
  icon.replaceWith(spin)
  statusEl.classList.remove('show')

  resetStages()
  overlay.classList.add('on')
  startScramble()

  const minTime = reduceMotion ? 0 : 520
  const [result] = await Promise.all([
    obfuscate(src, readOptions()).catch(e => ({ ok: false, error: String((e && e.message) || e) })),
    playStages(),
    new Promise(r => setTimeout(r, minTime)),
  ])

  stopScramble()
  overlay.classList.remove('on')
  // ボタン復帰
  const back = document.createElement('svg')
  spin.outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 9-14 9V3z"></path></svg>'
  runBtn.querySelector('.label').textContent = '難読化する'
  runBtn.disabled = false
  busy = false

  if (!result.ok) {
    output.value = ''; setOutputActions(false); $('outStat').textContent = ''
    showStatus('err', '難読化できませんでした', result.error)
    return
  }

  output.value = result.code
  setOutputActions(true)
  // 出力フェード
  if (!reduceMotion) { output.animate([{ opacity: .2 }, { opacity: 1 }], { duration: 320, easing: 'ease' }) }

  const rep = result.report
  const applied = rep.applied || {}
  const ratio = rep.originalLength ? Math.round((rep.resultLength / rep.originalLength) * 100) : 100
  const outStat = $('outStat')
  outStat.innerHTML = '<span id="oc"></span> 文字 · <span class="ratio" id="orr"></span>'
  countUp($('oc'), result.code.length)
  countUp($('orr'), ratio, '%')

  const method = applied.vm ? (applied.vmDouble ? '二重バイトコードVM＋暗号化' : '独自バイトコードVM') : '名前/文字列/数値の難読化'
  const dropped = rep.dropped && rep.dropped.length ? ` 互換性のため一部変換を自動調整: ${rep.dropped.join(', ')}。` : ''
  if (rep.verified) {
    showStatus('ok', '実行検証済み — 元コードと同じ動作を確認', `方式: ${method}。${dropped}`)
  } else {
    showStatus('warn', '構文チェックOK（実行検証はスキップ）',
      `方式: ${method}。Roblox API など実機が必要なコードはここでは実行検証できません。適用した変換はいずれも動作を変えない設計です。実機でご確認ください。${dropped}`)
  }
}

function setOutputActions(on) { $('copy').disabled = !on; $('download').disabled = !on }

/* ---------- ボタン ---------- */
runBtn.addEventListener('click', run)
$('sample').addEventListener('click', () => { input.value = SAMPLE; updateInStat(); input.focus() })
$('clear').addEventListener('click', () => {
  input.value = ''; output.value = ''; updateInStat(); $('outStat').textContent = ''
  setOutputActions(false); statusEl.classList.remove('show'); input.focus()
})
$('copy').addEventListener('click', async () => {
  if (!output.value) return
  try { await navigator.clipboard.writeText(output.value); flash($('copy'), 'コピー済み') }
  catch { output.select(); try { document.execCommand('copy') } catch {} flash($('copy'), 'コピー済み') }
})
$('download').addEventListener('click', () => {
  if (!output.value) return
  const url = URL.createObjectURL(new Blob([output.value], { type: 'text/plain' }))
  const a = document.createElement('a'); a.href = url; a.download = 'obfuscated.lua'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
function flash(btn, text) { const o = btn.textContent; btn.textContent = text; setTimeout(() => btn.textContent = o, 1200) }

input.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() } })

/* 初期化 */
applyPreset('strong')
updateInStat()

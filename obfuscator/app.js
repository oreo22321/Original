// UI 配線: 入力 → エンジン → 出力。すべて端末内で処理。
import { obfuscate, PRESETS } from './engine.js'

const $ = (id) => document.getElementById(id)
const input = $('input')
const output = $('output')
const runBtn = $('run')
const statusEl = $('status')

const OPT_IDS = ['vm', 'vmDouble', 'rename', 'hoist', 'numbers', 'strings', 'junk', 'wrap', 'minify']
let currentPreset = 'strong'

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
print("スクリプト起動:", #Players:GetPlayers() .. "人")
`

// ---- プリセット選択 ----
function applyPreset(name) {
  currentPreset = name
  const p = PRESETS[name]
  for (const k of OPT_IDS) $('opt-' + k).checked = !!p[k]
  for (const b of document.querySelectorAll('.preset')) {
    b.classList.toggle('active', b.dataset.preset === name)
  }
}
for (const b of document.querySelectorAll('.preset')) {
  b.addEventListener('click', () => applyPreset(b.dataset.preset))
}
// 個別トグルを変えたらプリセット表示を外す
for (const k of OPT_IDS) {
  $('opt-' + k).addEventListener('change', () => {
    for (const b of document.querySelectorAll('.preset')) b.classList.remove('active')
  })
}

function readOptions() {
  const o = {}
  for (const k of OPT_IDS) o[k] = $('opt-' + k).checked
  return o
}

// ---- 文字数表示 ----
function updateInStat() {
  $('inStat').textContent = `${input.value.length.toLocaleString()} 文字`
}
input.addEventListener('input', updateInStat)

// ---- 実行 ----
async function run() {
  const src = input.value
  if (!src.trim()) { showStatus('err', 'コードを入力してください。'); return }

  runBtn.disabled = true
  runBtn.textContent = '難読化中…'
  showStatus('', '処理中…', '元コードと難読化後を実行して比較しています。')
  // UI を一度描画させる
  await new Promise((r) => setTimeout(r, 20))

  let result
  try {
    result = await obfuscate(src, readOptions())
  } catch (e) {
    result = { ok: false, error: String((e && e.message) || e) }
  }

  runBtn.disabled = false
  runBtn.textContent = '難読化する'

  if (!result.ok) {
    output.value = ''
    setOutputActions(false)
    showStatus('err', '難読化できませんでした', result.error)
    $('outStat').textContent = ''
    return
  }

  output.value = result.code
  setOutputActions(true)
  const rep = result.report
  const ratio = rep.originalLength ? Math.round((rep.resultLength / rep.originalLength) * 100) : 100
  $('outStat').textContent = `${result.code.length.toLocaleString()} 文字 (元比 ${ratio}%)`

  const applied = rep.applied || {}
  const method = applied.vm
    ? (applied.vmDouble ? '二重バイトコードVM＋暗号化' : '独自バイトコードVM')
    : '名前/文字列/数値の難読化'
  const methodTxt = `方式: ${method}。`
  const droppedTxt = rep.dropped && rep.dropped.length
    ? `互換性のため一部の変換を自動で外しました: ${rep.dropped.join(', ')}。`
    : ''

  if (rep.verified) {
    showStatus('ok', '✓ 実行検証: 元コードと同じ動作を確認しました', methodTxt + droppedTxt)
  } else {
    showStatus('warn', '✓ 構文チェックOK（実行検証はスキップ）',
      methodTxt +
      'Roblox の API など実機が必要なコードは、ここでは実行検証できません。' +
      '適用した変換はいずれも動作を変えない設計です。実機で動作をご確認ください。' +
      (droppedTxt ? ' ' + droppedTxt : ''))
  }
}

function setOutputActions(enabled) {
  $('copy').disabled = !enabled
  $('download').disabled = !enabled
}

function showStatus(kind, title, sub) {
  statusEl.hidden = false
  statusEl.className = 'status' + (kind ? ' ' + kind : '')
  statusEl.innerHTML = `<b>${escapeHtml(title)}</b>` + (sub ? `<div class="sub">${escapeHtml(sub)}</div>` : '')
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// ---- ボタン ----
runBtn.addEventListener('click', run)

$('sample').addEventListener('click', () => {
  input.value = SAMPLE
  updateInStat()
  input.focus()
})

$('clear').addEventListener('click', () => {
  input.value = ''
  output.value = ''
  updateInStat()
  $('outStat').textContent = ''
  setOutputActions(false)
  statusEl.hidden = true
  input.focus()
})

$('copy').addEventListener('click', async () => {
  if (!output.value) return
  try {
    await navigator.clipboard.writeText(output.value)
    flash($('copy'), 'コピー済み')
  } catch {
    output.select()
    document.execCommand && document.execCommand('copy')
    flash($('copy'), 'コピー済み')
  }
})

$('download').addEventListener('click', () => {
  if (!output.value) return
  const blob = new Blob([output.value], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'obfuscated.lua'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})

function flash(btn, text) {
  const old = btn.textContent
  btn.textContent = text
  setTimeout(() => { btn.textContent = old }, 1200)
}

// Ctrl/Cmd+Enter で実行
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() }
})

// 初期化
applyPreset('strong')
updateInStat()

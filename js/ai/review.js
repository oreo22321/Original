// Forge AI: コードレビュー (構文は正しいが、動きがおかしくなる・重くなる・危ない書き方を見つける)
// 返り値: [{ line, severity: 'error'|'warning'|'info', kind: 'bug'|'perf'|'security'|'style', message, fix?: { from, to, insert } }]
import { parse } from '../luau/parser.js'

const FRAME_SIGNALS = new Set(['Heartbeat', 'RenderStepped', 'Stepped', 'PreRender', 'PostSimulation', 'PreSimulation', 'PreAnimation'])
const PLAYERISH = /^(_|p|plr|player|players?_?|client|sender|user|who|caller|from|localplayer|pl|ply|owner)$/i
const DATAISH = /^(data|value|val|amount|item|items|msg|message|text|args?|info|damage|dmg|money|coins?|cash|name|id|pos|position|target|key|action|cmd|command|payload)$/i
const DEBOUNCE_RE = /(debounce|cooldown|cool|db|busy|touched|canhit|can_hit|enabled|ready|active|hitlist|hit_list|lasttouch|last|recent|used|done|processing|deb)/i

export function reviewCode(src, opts = {}) {
  let ast
  try { ast = parse(src) } catch { return [] }
  const out = []
  const add = (line, severity, kind, message, fix) => out.push({ line, severity, kind, message, fix })
  const slice = n => (n && n.s !== undefined && n.e !== undefined ? src.slice(n.s, n.e) : null)
  const declaredLocals = []        // スコープごとの local 名
  const topAssigned = new Set()    // トップレベルで代入されたグローバル
  const instanceVars = []          // Instance.new した local
  const lines = src.split('\n')

  const isLocal = name => declaredLocals.some(s => s.has(name))
  const declare = name => { if (declaredLocals.length) declaredLocals[declaredLocals.length - 1].add(name) }

  const keyOf = e => (e && e.t === 'Index' && e.key && e.key.t === 'String' ? e.key.v : null)
  const chainText = e => {
    const parts = []
    let x = e
    while (x && (x.t === 'Index' || x.t === 'Method')) { parts.unshift(x.t === 'Method' ? ':' + x.name + '()' : keyOf(x) ? '.' + keyOf(x) : '[]'); x = x.obj }
    if (x && x.t === 'Name') parts.unshift(x.name)
    else if (x && x.t === 'Call') parts.unshift('…()')
    return parts.join('')
  }
  const hasKeyInChain = (e, re) => { let x = e; while (x && (x.t === 'Index' || x.t === 'Method' || x.t === 'Call')) { if ((x.t === 'Index' && re.test(keyOf(x) || '')) || (x.t === 'Method' && re.test(x.name))) return true; x = x.obj || x.fn } return false }

  // 関数の本体のテキストに、デバウンス (連続実行の防止) らしいものがあるか
  const hasDebounce = f => {
    if (!f || f.line === undefined) return false
    const body = lines.slice(f.line, Math.max(f.line, (f.endLine || f.line) - 1)).join('\n')
    return DEBOUNCE_RE.test(body) || /task\.wait|wait\(|os\.clock|tick\(\)|:Disconnect\(\)|:Destroy\(\)|\.Parent\s*=\s*nil|Once\(/.test(body)
  }
  const bodyHasDamage = f => {
    if (!f || f.line === undefined) return false
    const body = lines.slice(f.line - 1, (f.endLine || f.line)).join('\n')
    return /TakeDamage|\.Health\s*(-|\+)?=|\.Value\s*(\+|-)?=|:Clone\(\)|Instance\.new|FireClient|FireAllClients/.test(body)
  }

  function visitFunc(f, ctx) {
    declaredLocals.push(new Set(f.params.map(p => p.name)))
    if (f.isMethod) declare('self')
    const len = (f.endLine || f.line) - f.line
    if (len > 150) add(f.line, 'info', 'style', `関数${f.name ? ` '${f.name}'` : ''} が ${len} 行あります。役割ごとに小さな関数に分けると読みやすく、直しやすくなります`)
    for (const st of f.body) stat(st, { ...ctx, func: (ctx.func || 0) + 1, loop: 0, depth: 0 })
    declaredLocals.pop()
  }

  function block(stats, ctx) {
    declaredLocals.push(new Set())
    for (const st of stats) stat(st, ctx)
    declaredLocals.pop()
  }

  function stat(st, ctx) {
    if (!st) return
    switch (st.t) {
      case 'Local':
        st.values.forEach(v => expr(v, ctx))
        st.names.forEach((n, i) => {
          declare(n.name)
          const v = st.values[i]
          if (v && v.t === 'Call' && v.fn.t === 'Index' && v.fn.obj.t === 'Name' && v.fn.obj.name === 'Instance' && keyOf(v.fn) === 'new' && v.args.length === 1) instanceVars.push({ name: n.name, line: st.line, cls: v.args[0] && v.args[0].v })
        })
        break
      case 'LocalFunction': declare(st.name.name); visitFunc(st.func, ctx); break
      case 'Function':
        if (st.target.t !== 'Name') expr(st.target.obj, ctx)
        visitFunc(st.func, ctx)
        break
      case 'Assign':
        st.values.forEach(v => expr(v, ctx))
        st.targets.forEach((t, i) => {
          if (t.t === 'Name') {
            if (!isLocal(t.name)) {
              if (!ctx.func) topAssigned.add(t.name)
              else if (!topAssigned.has(t.name) && !/^[A-Z_]+$/.test(t.name)) add(st.line, 'info', 'style', `'${t.name}' に local が付いていないため、グローバル変数になっています。関数の外で使わないなら 'local ${t.name} = …' にしましょう`)
            }
            // 文字列をループでつなげ続ける
            const v = st.values[i]
            if (ctx.loop && v && v.t === 'Bin' && v.op === '..' && v.l.t === 'Name' && v.l.name === t.name) add(st.line, 'info', 'perf', `ループの中で文字列 '${t.name}' をつなげ続けると遅くなります。テーブルに入れて最後に table.concat でまとめると速くなります`)
          } else expr(t, ctx)
        })
        break
      case 'Compound':
        expr(st.value, ctx); expr(st.target, ctx)
        if (ctx.loop && st.op === '..') add(st.line, 'info', 'perf', 'ループの中で ..= で文字列をつなげ続けると遅くなります。テーブルに入れて最後に table.concat でまとめると速くなります')
        break
      case 'CallStat': expr(st.call, ctx); break
      case 'If':
        for (const c of st.clauses) { expr(c.cond, ctx); block(c.body, { ...ctx, depth: (ctx.depth || 0) + 1 }) }
        if (st.orelse) block(st.orelse, { ...ctx, depth: (ctx.depth || 0) + 1 })
        if ((ctx.depth || 0) >= 6) add(st.line, 'info', 'style', '入れ子 (if の中の if …) が深くなっています。条件を満たさないときに早めに return / continue すると読みやすくなります')
        break
      case 'While': case 'Repeat':
        if (st.t === 'While') expr(st.cond, ctx)
        if (st.t === 'While' && st.cond && st.cond.t === 'Call' && st.cond.fn.t === 'Name' && st.cond.fn.name === 'wait') add(st.line, 'info', 'style', "'while wait() do' より 'while true do … task.wait() end' のほうが確実です (wait は非推奨)")
        block(st.body, { ...ctx, loop: (ctx.loop || 0) + 1, depth: (ctx.depth || 0) + 1 })
        if (st.t === 'Repeat') expr(st.cond, ctx)
        break
      case 'NumFor': {
        expr(st.start, ctx); expr(st.stop, ctx); expr(st.step, ctx)
        // for i = 1, #t do table.remove(t, i) → 要素を飛ばしてしまう
        if (st.stop && st.stop.t === 'Un' && st.stop.op === '#' && st.stop.e.t === 'Name' && (!st.step || (st.step.t === 'Number' && st.step.v > 0))) {
          const t = st.stop.e.name
          const body = lines.slice(st.line - 1, st.endLine || st.line).join('\n')
          if (new RegExp(`table\\.remove\\(\\s*${t}\\s*,\\s*${st.var.name}\\s*\\)`).test(body)) add(st.line, 'warning', 'bug', `前から順に table.remove(${t}, ${st.var.name}) すると、詰まった次の要素を飛ばしてしまいます。後ろから回してください: for ${st.var.name} = #${t}, 1, -1 do`)
        }
        declaredLocals.push(new Set([st.var.name]))
        block(st.body, { ...ctx, loop: (ctx.loop || 0) + 1, depth: (ctx.depth || 0) + 1 })
        declaredLocals.pop()
        break
      }
      case 'GenFor':
        st.exprs.forEach(e => expr(e, ctx))
        declaredLocals.push(new Set(st.vars.map(v => v.name)))
        block(st.body, { ...ctx, loop: (ctx.loop || 0) + 1, depth: (ctx.depth || 0) + 1 })
        declaredLocals.pop()
        break
      case 'Do': block(st.body, ctx); break
      case 'Return': st.values.forEach(v => expr(v, ctx)); break
    }
  }

  function connectCheck(e, ctx) {
    // e: Method (:Connect / :Once)
    const sig = e.obj
    const sigName = keyOf(sig)
    const fn = e.args[0]
    if (!fn) return
    // 関数を「呼び出した結果」を渡している: :Connect(onTouch())
    if (fn.t === 'Call' && fn.fn.t === 'Name' && fn.args.length === 0 && fn.s !== undefined && fn.fn.e !== undefined) {
      add(e.line, 'error', 'bug', `:${e.name}(${fn.fn.name}()) は ${fn.fn.name} を今すぐ呼び出して、その結果を渡しています。関数そのものを渡すには () を外して :${e.name}(${fn.fn.name}) にします`, { from: fn.fn.e, to: fn.e, insert: '' })
    }
    if (ctx.frame) add(e.line, 'warning', 'perf', '毎フレームの処理の中でイベントに接続しています。接続がフレームごとに増え続け、どんどん重くなります。接続は外で 1 回だけにしてください')
    else if (ctx.loop && sigName && !/Changed|Event/.test('')) add(e.line, 'info', 'perf', `ループの中で ${sigName || 'イベント'} に接続しています。ループが回るたびに接続が増えるので、不要になったら :Disconnect() してください`)
    if (fn.t !== 'Func') return
    const f = fn
    // RemoteEvent: 最初の引数はプレイヤー
    if (sigName === 'OnServerEvent') {
      const p0 = f.params[0]
      if (p0 && DATAISH.test(p0.name) && !PLAYERISH.test(p0.name)) add(f.line, 'warning', 'bug', `OnServerEvent の最初の引数は、送ってきたプレイヤーです ('${p0.name}' には Player が入ります)。送った値を受け取るには function(player, ${p0.name}) のように 2 つ目以降で受け取ります`)
      else if (f.params.length >= 2) {
        const body = lines.slice(f.line - 1, f.endLine || f.line).join('\n')
        const v = f.params[1].name
        const trusts = new RegExp(`(\\.Value|\\.Health|\\.WalkSpeed|\\.JumpPower|Coins|Money|Cash|Gems)\\s*(\\+|-)?=\\s*[^\\n]*\\b${v}\\b`).test(body)
        const validates = new RegExp(`typeof\\(\\s*${v}\\s*\\)|type\\(\\s*${v}\\s*\\)|tonumber\\(\\s*${v}|math\\.clamp\\([^)]*${v}|${v}\\s*[<>]=?|PRICES?\\[|table\\.find\\(`).test(body)
        if (trusts && !validates) add(f.line, 'warning', 'security', `クライアントから届いた '${v}' を、確かめずに値 (お金・体力・速さなど) に使っています。改造したクライアントは好きな値を送れるので、typeof・範囲・持ち物をサーバーで確かめてください`)
      }
    }
    if (sigName === 'OnClientEvent' && f.params[0] && PLAYERISH.test(f.params[0].name) && f.params[0].name !== '_' && /^(player|plr)$/i.test(f.params[0].name)) {
      add(f.line, 'info', 'bug', `OnClientEvent の引数にはプレイヤーは付きません (サーバーが FireClient で送った値がそのまま届きます)。'${f.params[0].name}' には 1 つ目の値が入ります`)
    }
    if (sigName === 'Touched' && bodyHasDamage(f) && !hasDebounce(f)) add(f.line, 'warning', 'bug', 'Touched は触れている間に何回も発生します。ダメージや付与が連続で実行されるので、デバウンス (クールダウン) を入れてください')
    const frame = FRAME_SIGNALS.has(sigName)
    visitFunc(f, { ...ctx, frame: ctx.frame || frame, loop: 0 })
    return true
  }

  function expr(e, ctx) {
    if (!e || typeof e !== 'object') return
    switch (e.t) {
      case 'Func': visitFunc(e, ctx); return
      case 'Method': {
        expr(e.obj, ctx)
        const n = e.name
        if ((n === 'Connect' || n === 'Once' || n === 'ConnectParallel') && connectCheck(e, ctx)) { e.args.slice(1).forEach(a => expr(a, ctx)); return }
        if (n === 'GetService' && (ctx.loop || ctx.frame)) add(e.line, 'info', 'perf', `${ctx.frame ? '毎フレームの処理' : 'ループ'}の中で GetService しています。スクリプトの先頭で 1 回だけ取得して変数に入れると速くなります`)
        if ((n === 'FindFirstChild' || n === 'WaitForChild' || n === 'GetChildren' || n === 'GetDescendants') && ctx.frame) add(e.line, 'info', 'perf', `毎フレームの処理の中で :${n} しています。見つけたものを外の変数に覚えておくと軽くなります`)
        if (n === 'WaitForChild' && ctx.frame) add(e.line, 'warning', 'bug', '毎フレームの処理の中で WaitForChild すると、待っている間に処理が溜まってしまいます')
        if (n === 'FireServer' && e.args[0] && e.args[0].t === 'Name' && /^(player|plr|localplayer|lp)$/i.test(e.args[0].name)) {
          const a0 = e.args[0], a1 = e.args[1]
          const fix = a0.s !== undefined ? (a1 && a1.s !== undefined ? { from: a0.s, to: a1.s, insert: '' } : null) : null
          add(e.line, 'info', 'bug', `FireServer に ${a0.name} を渡す必要はありません。サーバーの OnServerEvent には送ったプレイヤーが自動で最初の引数として届くので、${a0.name} が 2 回入ってしまいます`, fix)
        }
        if (n === 'BindToRenderStep' && e.args[2] && e.args[2].t === 'Func') { e.args.slice(0, 2).forEach(a => expr(a, ctx)); visitFunc(e.args[2], { ...ctx, frame: true }); return }
        e.args.forEach(a => expr(a, ctx))
        return
      }
      case 'Call': {
        const fn = e.fn
        expr(fn, ctx)
        if (fn.t === 'Name' && !isLocal(fn.name)) {
          // pcall に関数ではなく、呼び出した結果を渡している
          if ((fn.name === 'pcall' || fn.name === 'xpcall') && e.args[0] && (e.args[0].t === 'Call' || e.args[0].t === 'Method')) {
            const a = e.args[0]
            const txt = slice(a)
            add(e.line, 'error', 'bug', `${fn.name}(${txt ? txt.slice(0, 40) : '…'}) は、${fn.name} の外で先に実行されてしまうため、エラーから守られません。${fn.name}(function() return … end) のように関数で包んでください`, txt && a.s !== undefined ? { from: a.s, to: a.e, insert: `function()\n\treturn ${txt}\nend` } : undefined)
          }
          if (fn.name === 'require' && e.args[0] && e.args[0].t === 'Number') add(e.line, 'warning', 'security', `require(${e.args[0].v}) はインターネット上のモジュールを読み込みます。中身が見えないので、バックドア (乗っ取り) の可能性があります。信頼できるものだけにしてください`)
          if ((fn.name === 'loadstring' || fn.name === 'load') && !opts.executor) add(e.line, 'info', 'security', 'Roblox Studio のスクリプトでは loadstring は標準で使えません (ServerScriptService.LoadStringEnabled)。文字列からコードを実行するのは安全面でも避けましょう')
          if ((fn.name === 'wait') && ctx.frame) add(e.line, 'warning', 'bug', '毎フレームの処理の中で待機すると、処理が溜まって動きがおかしくなります')
          if ((fn.name === 'setfenv' || fn.name === 'getfenv')) add(e.line, 'info', 'style', `${fn.name} は非推奨で、Luau の高速化が効かなくなります`)
        }
        if (fn.t === 'Index' && fn.obj.t === 'Name' && fn.obj.name === 'Instance' && keyOf(fn) === 'new' && ctx.frame) add(e.line, 'info', 'perf', '毎フレーム Instance.new しています。作ったものを使い回す (オブジェクトプール) か、必要なときだけ作ると軽くなります')
        if (fn.t === 'Index' && fn.obj.t === 'Name' && fn.obj.name === 'task' && keyOf(fn) === 'wait' && ctx.frame) add(e.line, 'warning', 'bug', '毎フレームの処理の中で task.wait すると、処理が溜まって動きがおかしくなります')
        e.args.forEach(a => expr(a, ctx))
        return
      }
      case 'Index': {
        expr(e.obj, ctx)
        if (!e.dot) { expr(e.key, ctx); return }
        const k = keyOf(e)
        // hit.Parent.Humanoid
        if (k === 'Humanoid' && e.obj.t === 'Index' && keyOf(e.obj) === 'Parent' && e.obj.obj.t === 'Name' && /^(hit|part|otherpart|other|touch|toucher|obj|object|h)$/i.test(e.obj.obj.name)) {
          add(e.line, 'warning', 'bug', `${e.obj.obj.name}.Parent.Humanoid は、キャラクター以外 (落ちてきたパーツ・帽子など) が触れたときにエラーになります。local humanoid = ${e.obj.obj.name}.Parent:FindFirstChildOfClass("Humanoid") で探し、if humanoid then … で確かめてください`)
        }
        // FindFirstChild(...).X
        if (e.obj.t === 'Method' && e.obj.name === 'FindFirstChild') add(e.line, 'warning', 'bug', `:FindFirstChild(…) は見つからないと nil を返すので、そのまま .${k} を使うとエラーになることがあります。いったん変数に入れて if で確かめてください`)
        // LocalPlayer.Character.X (読み込み前は nil)
        if (e.obj.t === 'Index' && keyOf(e.obj) === 'Character' && e.obj.obj && ((e.obj.obj.t === 'Index' && keyOf(e.obj.obj) === 'LocalPlayer') || (e.obj.obj.t === 'Name' && /^(player|plr|lp|localplayer)$/i.test(e.obj.obj.name))) && !ctx.func) {
          add(e.line, 'info', 'bug', `スクリプトの開始直後は Character がまだ nil のことがあります。local character = player.Character or player.CharacterAdded:Wait() で待ってから使うと確実です`)
        }
        return
      }
      case 'Bin': {
        expr(e.l, ctx); expr(e.r, ctx)
        // leaderstats.Coins と数値を比べている / 計算している (.Value の付け忘れ)
        if (/^(<|>|<=|>=|\+|-|\*|\/)$/.test(e.op)) {
          for (const side of [e.l, e.r]) {
            if (side && side.t === 'Index' && side.dot && keyOf(side) !== 'Value' && hasKeyInChain(side.obj, /^leaderstats$/) && side.e !== undefined) {
              add(e.line, 'error', 'bug', `${chainText(side)} は IntValue などのオブジェクトです。数値として使うには .Value を付けます (${chainText(side)}.Value)`, { from: side.e, to: side.e, insert: '.Value' })
            }
          }
        }
        return
      }
      case 'Un': expr(e.e, ctx); return
      case 'Paren': case 'Cast': expr(e.e, ctx); return
      case 'Table': for (const it of e.items) { if (it.k === 'expr') expr(it.key, ctx); expr(it.value, ctx) } return
      case 'IfExpr': for (const c of e.clauses) { expr(c.cond, ctx); expr(c.val, ctx) } expr(e.orelse, ctx); return
      case 'Interp': for (const p of e.parts) if (typeof p !== 'string') expr(p, ctx); return
    }
  }

  declaredLocals.push(new Set())
  for (const st of ast.body) stat(st, { loop: 0, frame: false, func: 0, depth: 0 })
  declaredLocals.pop()

  // Instance.new したのに Parent を設定していない (どこにも表示されない)
  for (const v of instanceVars) {
    const re = new RegExp(`\\b${v.name}\\b`, 'g')
    const uses = src.match(re) || []
    const propSets = src.match(new RegExp(`\\b${v.name}\\.\\w+\\s*=`, 'g')) || []
    if (!new RegExp(`\\b${v.name}\\.Parent\\s*=`).test(src) && uses.length - 1 === propSets.length && !/^(Folder|Model|Attachment|Weld|WeldConstraint|Animation|TweenInfo|RaycastParams|OverlapParams|BindableEvent|BindableFunction)$/.test(v.cls || '')) {
      add(v.line, 'info', 'bug', `${v.name} (${v.cls || 'Instance'}) を作りましたが Parent を設定していないので、世界や画面に出てきません。最後に ${v.name}.Parent = workspace のように設定します`)
    }
  }

  // 同じ行・同じ内容はまとめる
  const seen = new Set()
  return out.filter(f => { const k = f.line + f.message; if (seen.has(k)) return false; seen.add(k); return true }).sort((a, b) => a.line - b.line)
}

// 自動で当てられる修正だけをまとめて当てる (後ろから)
export function applyReviewFixes(src, findings) {
  const list = findings.filter(f => f.fix).map(f => f.fix).sort((a, b) => b.from - a.from)
  let text = src, last = Infinity
  for (const f of list) {
    if (f.to > last) continue
    text = text.slice(0, f.from) + f.insert + text.slice(f.to)
    last = f.from
  }
  return text
}

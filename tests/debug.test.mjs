// デバッガーのテスト:  node tests/debug.test.mjs
import { createVM, formatError } from '../js/luau/vm.js'
import { Debugger, inspect } from '../js/luau/debug.js'
import { rt, LTable } from '../js/luau/runtime.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else { fail++; console.log(`✕ ${name}\n   got:  ${g}\n   want: ${w}`) }
}

// script を実行し、止まるたびに onPause(info, dbg) を呼ぶ。onPause の返り値 (action) で再開
function debugRun(src, breakpoints, onPause, { watches = [] } = {}) {
  return new Promise(resolve => {
    const out = [], pauses = []
    let vm
    const hooks = {
      output: (k, t) => out.push(k === 'print' ? t : `[${k}] ${t}`),
      onError: e => out.push('[error] ' + formatError(e)),
      onIdle: () => resolve({ out, pauses }),
    }
    vm = createVM(hooks, { timeLimit: 5000 })
    const dbg = new Debugger({
      env: vm.env,
      output: (k, t) => out.push(`[${k}] ${t}`),
      onPaused: info => {
        pauses.push(info)
        const action = onPause(info, dbg, pauses.length)
        if (pauses.length > 50) throw new Error('too many pauses')
        // 実際の画面と同じく、イベントループに戻ってから再開
        setTimeout(() => dbg.resume(action || 'continue'), 0)
      },
    })
    dbg.watches = watches
    rt.debugger = dbg
    dbg.markBuiltins()
    dbg.setBreakpoints(breakpoints)
    try { vm.run(src, 'main') } catch (e) { out.push('[syntax] ' + formatError(e)); resolve({ out, pauses }) }
  })
}
const loc = info => `${info.file}:${info.line}`
const vars = info => Object.fromEntries(info.locals.map(v => [v.name, v.value.v]))

// ---- ブレークポイントで止まり、変数が見える ----
{
  const src = `local a = 1
local b = a + 1
local t = {x = 5, 1, 2}
print(a, b)
for i = 1, 3 do
  print(i)
end
print("done")`
  const r = await debugRun(src, { main: [{ line: 4 }, { line: 6 }] }, () => 'continue')
  eq('bp lines', r.pauses.map(loc), ['main:4', 'main:6', 'main:6', 'main:6'])
  eq('locals at 4', vars(r.pauses[0]), { a: '1', b: '2', t: '{…} 3 個' })
  eq('loop var', vars(r.pauses[2]).i, '2')
  eq('output intact', r.out, ['1 2', '1', '2', '3', 'done'])
}

// ---- ステップオーバー / イン / アウト ----
{
  const src = `local function add(x, y)
  local s = x + y
  return s
end
local r = add(1, 2)
print(r)
print("end")`
  const actions = ['in', 'over', 'out', 'over', 'continue']
  const r = await debugRun(src, { main: [{ line: 5 }] }, (info, dbg, n) => actions[n - 1])
  eq('step path', r.pauses.map(loc), ['main:5', 'main:2', 'main:3', 'main:6', 'main:7'])
  eq('stack inside add', r.pauses[1].stack.map(f => f.name), ['add', '(メイン)'])
  eq('caller line in stack', r.pauses[1].stack[1].line, 5)
  eq('step over skips body', (await debugRun(src, { main: [{ line: 5 }] }, () => 'over')).pauses.map(loc), ['main:5', 'main:6', 'main:7'])
}

// ---- 条件付きブレークポイント・ログポイント ----
{
  const src = `for i = 1, 5 do
  local sq = i * i
  print(sq)
end`
  const r = await debugRun(src, { main: [{ line: 3, cond: 'i == 4' }] }, () => 'continue')
  eq('conditional', r.pauses.map(p => vars(p).i), ['4'])
  const r2 = await debugRun(src, { main: [{ line: 3, log: 'i={i} sq={sq}' }] }, () => 'continue')
  eq('logpoint no pause', r2.pauses.length, 0)
  eq('logpoint output', r2.out.filter(l => l.startsWith('[log]')).length, 5)
  eq('logpoint text', r2.out[0], '[log] main:3: i=1 sq=1')
}

// ---- task.wait をまたぐ / コルーチンの中で止まる ----
{
  const src = `task.spawn(function()
  task.wait(0.01)
  local inner = "spawned"
  print(inner)
end)
local co = coroutine.wrap(function(a)
  local got = a * 2
  coroutine.yield(got)
  return got + 1
end)
print(co(5))
print(co())`
  const r = await debugRun(src, { main: [{ line: 4 }, { line: 8 }] }, () => 'continue')
  eq('pause in wrap and spawn', r.pauses.map(loc), ['main:8', 'main:4'])
  eq('wrap results ok', r.out, ['10', '11', 'spawned'])
  eq('vars in coroutine', vars(r.pauses[0]).got, '10')
}

// ---- ウォッチと式の評価 ----
{
  const src = `local player = {Name = "Alex", hp = 90}
local n = 3
print(n)`
  let ev = null
  const r = await debugRun(src, { main: [{ line: 3 }] }, (info, dbg) => { ev = dbg.evaluate('player.hp + n'); return 'continue' }, { watches: ['player.Name', 'n * 2', 'nope.x'] })
  eq('watches', r.pauses[0].watches.map(w => w.value ? w.value.v : 'ERR'), ['"Alex"', '6', 'ERR'])
  eq('evaluate', ev.ok && ev.values[0].v, '93')
}

// ---- 止めずに一時停止ボタン ----
{
  const src = `local n = 0
for i = 1, 3 do
  task.wait(0.02)
  n += 1
end
print(n)`
  let dbgRef
  const p = debugRun(src, {}, () => 'continue')
  dbgRef = rt.debugger
  setTimeout(() => dbgRef.requestPause(), 15)
  const r = await p
  eq('pause request stops once', r.pauses.length, 1)
  eq('pause reason', r.pauses[0].reason.kind, 'pause')
  eq('still completes', r.out, ['3'])
}

// ---- 値の展開 ----
{
  const src = `local t = {1, "two", {deep = true}, name = "x"}
print(#t)`
  let items = null
  await debugRun(src, { main: [{ line: 2 }] }, (info, dbg) => { items = dbg.expand(info.locals.find(v => v.name === 't').value.ref); return 'continue' })
  eq('expand table', items.map(i => `${i.name}=${i.value.v}`), ['[1]=1', '[2]="two"', '[3]={…} 1 個', 'name="x"'])
}

{
  const t = new LTable(); t.set(1, 10); t.set(2, 'a'); t.set('k', true)
  const inner = new LTable(); inner.set('x', 1); t.set('sub', inner)
  eq('inspect', inspect(t), '{10, "a", k = true, sub = {x = 1}}')
  eq('inspect nil', inspect(undefined), 'nil')
}

console.log(`debug: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

// 整形のテスト:  node tests/format.test.mjs
import { Text } from '../vendor/codemirror.js'
import { formatLuau, formatLineSpacing, detectIndentUnit } from '../js/editor/format.js'
import { lightTokens } from '../js/editor/blocks.js'

let pass = 0, fail = 0
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`✕ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`) } }
const fmt = s => formatLuau(s, '\t', { finalNewline: false })

// ---- 空白 ----
eq('assign + ops', fmt('local x=1+2*3'), 'local x = 1 + 2 * 3')
eq('commas', fmt('foo(a,b ,c)'), 'foo(a, b, c)')
eq('paren inside', fmt('print( "x" )'), 'print("x")')
eq('keyword paren', fmt('if(x)then end'), 'if (x) then end')
eq('unary minus', fmt('x=-1'), 'x = -1')
eq('binary then unary', fmt('y=a*-b'), 'y = a * -b')
eq('minus minus stays apart', fmt('z = a - -b'), 'z = a - -b')
eq('length', fmt('n=# t'), 'n = #t')
eq('concat', fmt('s="a"..b'), 's = "a" .. b')
eq('table braces', fmt('t={a=1,b=2}'), 't = { a = 1, b = 2 }')
eq('empty table', fmt('t = { }'), 't = {}')
eq('index', fmt('v = t[ 1 ]'), 'v = t[1]')
eq('nested long string index', fmt('v = t[ [[k]] ]'), 'v = t[ [[k]] ]')
eq('method call', fmt('obj : Method ( 1 )'), 'obj:Method(1)')
eq('string call kept', fmt('require"mod"'), 'require"mod"')
eq('annotation', fmt('local x:number=5'), 'local x: number = 5')
eq('return annotation', fmt('function f(a:number):string end'), 'function f(a: number): string end')
eq('optional type', fmt('local y: string ? = nil'), 'local y: string? = nil')
eq('generic kept', fmt('local m: Map<string,number> = {}'), 'local m: Map<string, number> = {}')
eq('compare spaced', fmt('if a<b then end'), 'if a < b then end')
eq('cast', fmt('local v = x::any'), 'local v = x :: any')
eq('compound', fmt('x+=1'), 'x += 1')
eq('anon function', fmt('f = function (a) end'), 'f = function(a) end')
eq('varargs', fmt('print(select("#",...))'), 'print(select("#", ...))')
eq('numbers intact', fmt('n=1e-5+.5-0x1F'), 'n = 1e-5 + .5 - 0x1F')
eq('trailing comment gap kept', fmt('x = 1    -- note'), 'x = 1    -- note')
eq('comment needs space', fmt('x = 1-- note'), 'x = 1 -- note')
eq('semicolon', fmt('a = 1 ; b = 2'), 'a = 1; b = 2')
eq('strings untouched', fmt('s = "a  =  b,c"'), 's = "a  =  b,c"')

// ---- 字下げ・空行 ----
eq('indent blocks', fmt('if x then\nfoo()\nelse\nbar()\nend'), 'if x then\n\tfoo()\nelse\n\tbar()\nend')
eq('collapse blank lines', fmt('a()\n\n\n\nb()'), 'a()\n\nb()')
eq('no blank after opener', fmt('if x then\n\n\tfoo()\n\nend'), 'if x then\n\tfoo()\nend')
eq('no blank after function header', fmt('local function f()\n\n\treturn 1\nend'), 'local function f()\n\treturn 1\nend')
eq('leading blanks removed', fmt('\n\n\nprint(1)'), 'print(1)')
eq('continuation', fmt('local s = "a" ..\n"b" ..\n"c"'), 'local s = "a" ..\n\t"b" ..\n\t"c"')
eq('continuation in if', fmt('if a and\nb then\nc()\nend'), 'if a and\n\tb then\n\tc()\nend')
eq('method chain', fmt('local x = foo\n:bar()\n:baz()'), 'local x = foo\n\t:bar()\n\t:baz()')
eq('callback', fmt('x.E:Connect(function(p)\nprint(p)\nend)'), 'x.E:Connect(function(p)\n\tprint(p)\nend)')
eq('table lines', fmt('local t = {\na = 1,\n\nb = 2,\n}'), 'local t = {\n\ta = 1,\n\n\tb = 2,\n}')
eq('long string verbatim', fmt('local s = [[\n  a   b\n]]'), 'local s = [[\n  a   b\n]]')
eq('spaces unit', formatLuau('if x then\nfoo()\nend', '  ', { finalNewline: false }), 'if x then\n  foo()\nend')
eq('final newline', formatLuau('print(1)', '\t'), 'print(1)\n')

// ---- 意味を変えない (字句の並びが同じ) ----
const tricky = 'local a = b\n(c)()\nx = y - -z\nw = 1 .. 2\nq = t[ [=[s]=] ]\nr = -(-1)\n'
const out = formatLuau(tricky, '\t')
const toks = s => lightTokens(s, true).map(t => s.slice(t.s, t.e)).join(' ')
eq('same tokens', toks(out), toks(tricky))
eq('newline before (call) kept', out.includes('b\n(c)()'), true)
eq('idempotent', formatLuau(out, '\t'), out)

// ---- 1 行の整形 ----
eq('line spacing', formatLineSpacing('\tlocal x=1+2  '), '\tlocal x = 1 + 2')
eq('line keeps indent', formatLineSpacing('    foo(a,b)'), '    foo(a, b)')
eq('unterminated string untouched', formatLineSpacing('x = "abc'), 'x = "abc')
eq('open long comment untouched', formatLineSpacing('x=1 --[[ start'), 'x=1 --[[ start')
eq('blank line', formatLineSpacing('   '), '')

// ---- 字下げの単位の推定 ----
eq('detect tabs', detectIndentUnit('if x then\n\tfoo()\nend'), '\t')
eq('detect 2 spaces', detectIndentUnit('if x then\n  foo()\n  if y then\n    bar()\n  end\nend'), '  ')
eq('detect none', detectIndentUnit('print(1)'), null)

// ---- 自動整形の行の差分 ----
const { lineChanges } = await import('../js/editor/autoformat.js').catch(() => ({}))
if (lineChanges) {
  const doc = Text.of('local x=1\n\n\n\nif x then\nfoo()\nend'.split('\n'))
  const next = 'local x = 1\n\nif x then\n\tfoo()\nend'
  const ch = lineChanges(doc, next, 6)
  const apply = (d, cs) => { let t = d.toString(); for (const c of [...cs].sort((a, b) => b.from - a.from)) t = t.slice(0, c.from) + c.insert + t.slice(c.to); return t }
  eq('line diff skips cursor line', apply(doc, ch), 'local x = 1\n\nif x then\nfoo()\nend')
  eq('line diff all', apply(doc, lineChanges(doc, next, 99)), next)
  eq('line diff refuses content change', lineChanges(doc, 'local y = 1', 99), null)
}

console.log(`format: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

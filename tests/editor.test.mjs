// エディタの色分けのテスト:  node tests/editor.test.mjs
// VS Code (Pylance) と同じ考え方の意味による色分け・テーマの色・エディタの外のコードの色付け
globalThis.window = globalThis
globalThis.document = { createElement: () => ({ style: {} }), documentElement: { style: {} } }
const cm = await import('../vendor/codemirror.js')
const { _semantic } = await import('../js/editor/semantic.js')
const { THEMES, uiColors } = await import('../js/editor/themes.js')

let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

const code = `import math
import numpy as np
from tkinter import ttk, Tk
from helpers import load_data
MAX_SIZE = 10
class Player:
    pass
def greet(p):
    return p
data = load_data()
ttk.Button()
`
const state = cm.EditorState.create({ doc: code, extensions: [cm.python()] })
const tree = cm.pythonLanguage.parser.parse(code)
const t = _semantic.collect(state, tree)
ok('modules from import', t.modules.has('math') && t.modules.has('np') && t.modules.has('tkinter') && t.modules.has('ttk'), JSON.stringify([...t.modules]))
ok('functions and classes', t.funcs.has('greet') && t.funcs.has('load_data') && t.classes.has('Player') && t.classes.has('Tk'), JSON.stringify([...t.funcs, ...t.classes]))
const k = (n, role = 'ref') => _semantic.kindOf(n, t, role)
ok('builtin function', k('print', 'call') === 'func' && k('len') === 'func')
ok('builtin types are classes (Pylance)', k('range', 'call') === 'cls' && k('int') === 'cls' && k('ValueError') === 'cls')
ok('constants', k('MAX_SIZE') === 'const' && k('X') === 'var')
ok('self and plain variables', k('self') === 'var' && k('data') === 'var')
ok('capitalized calls are classes', k('Point', 'call') === 'cls' && k('make', 'call') === 'func')

const d = THEMES['vscode-dark'].c, l = THEMES['vscode-light'].c
ok('Dark Modern token colors', d.bg === '#1f1f1f' && d.control === '#c586c0' && d.keyword === '#569cd6' && d.func === '#dcdcaa' && d.cls === '#4ec9b0' && d.variable === '#9cdcfe' && d.string === '#ce9178' && d.number === '#b5cea8' && d.comment === '#6a9955' && d.constant === '#4fc1ff')
ok('Light Modern token colors', l.bg === '#ffffff' && l.control === '#af00db' && l.keyword === '#0000ff' && l.func === '#795e26' && l.cls === '#267f99' && l.variable === '#001080' && l.string === '#a31515')
const ui = uiColors('vscode-dark')
ok('Dark Modern UI colors and bracket colors', ui['--bg'] === '#1f1f1f' && ui['--panel'] === '#181818' && ui['--primary'] === '#0078d4' && ui['--rb0'] === '#ffd700' && ui['--rb1'] === '#da70d6' && ui['--rb2'] === '#179fff')
ok('every theme has UI colors', Object.keys(THEMES).every(id => uiColors(id)['--bg']))

console.log(`editor: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

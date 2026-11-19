// Python の意味に合わせた色分け (VS Code + Python 拡張 (Pylance) と同じ考え方)
// ・構文木から、ファイルの中の関数・クラス・import したモジュール・呼び出している名前を集め、
//   画面に見えている部分の名前を「変数 / 関数 / クラス / モジュール / 定数 / 属性」に分けて色を付ける
// ・print や len は関数、int や range はクラス、ALL_CAPS は定数、f"" や r"" の頭文字はキーワードの色
import { ViewPlugin, Decoration, RangeSetBuilder, syntaxTree, Prec } from '../../vendor/codemirror.js'

const BUILTIN_FUNCS = new Set('abs aiter all anext any ascii bin breakpoint callable chr compile delattr dir divmod eval exec format getattr globals hasattr hash help hex id input isinstance issubclass iter len locals max min next oct open ord pow print repr round setattr sorted sum vars __import__ display'.split(' '))
const BUILTIN_TYPES = new Set(('bool bytearray bytes classmethod complex dict enumerate filter float frozenset int list map memoryview object property range reversed set slice staticmethod str super tuple type zip '
  + 'BaseException BaseExceptionGroup Exception ExceptionGroup ArithmeticError AssertionError AttributeError BlockingIOError BrokenPipeError BufferError ChildProcessError ConnectionAbortedError ConnectionError ConnectionRefusedError ConnectionResetError EOFError EnvironmentError FileExistsError FileNotFoundError FloatingPointError GeneratorExit IOError ImportError IndentationError IndexError InterruptedError IsADirectoryError KeyError KeyboardInterrupt LookupError MemoryError ModuleNotFoundError NameError NotADirectoryError NotImplementedError OSError OverflowError PermissionError ProcessLookupError RecursionError ReferenceError RuntimeError StopAsyncIteration StopIteration SyntaxError SystemError SystemExit TabError TimeoutError TypeError UnboundLocalError UnicodeDecodeError UnicodeEncodeError UnicodeError UnicodeTranslateError ValueError ZeroDivisionError Warning UserWarning DeprecationWarning PendingDeprecationWarning SyntaxWarning RuntimeWarning FutureWarning ImportWarning UnicodeWarning BytesWarning ResourceWarning EncodingWarning').split(' '))
const CONST_RE = /^_*[A-Z][A-Z0-9_]*$/
const CAP_RE = /^_*[A-Z]/

const marks = {}
const mark = k => marks[k] || (marks[k] = Decoration.mark({ class: 'sx-' + k }))

// ファイル全体から名前の種類を集める
function collect(state, tree) {
  const t = { funcs: new Set(), classes: new Set(), modules: new Set(), imported: new Set(), called: new Set(), memberObj: new Set() }
  const doc = state.doc
  const text = (a, b) => doc.sliceString(a, b)
  const c = tree.cursor()
  do {
    const n = c.name
    if (n === 'FunctionDefinition' || n === 'ClassDefinition') {
      const node = c.node
      const name = node.getChild('VariableName')
      if (name) (n === 'FunctionDefinition' ? t.funcs : t.classes).add(text(name.from, name.to))
    } else if (n === 'ImportStatement') {
      const node = c.node
      let ch = node.firstChild
      const isFrom = ch && ch.name === 'from'
      let afterImport = false, prevAs = false
      for (; ch; ch = ch.nextSibling) {
        if (ch.name === 'import') { afterImport = true; continue }
        if (ch.name === 'as') { prevAs = true; continue }
        if (ch.name !== 'VariableName') { if (ch.name === ',') prevAs = false; continue }
        const name = text(ch.from, ch.to)
        if (!isFrom || !afterImport) t.modules.add(name)
        else t.imported.add(name)
        prevAs = false
      }
    } else if (n === 'CallExpression') {
      const f = c.node.firstChild
      if (f && f.name === 'VariableName') t.called.add(text(f.from, f.to))
    } else if (n === 'MemberExpression') {
      const f = c.node.firstChild
      if (f && f.name === 'VariableName') t.memberObj.add(text(f.from, f.to))
    }
  } while (c.next())
  // from x import y の y: 呼んでいれば関数、. を付けて使っていればモジュール、大文字ならクラス
  for (const name of t.imported) {
    if (CAP_RE.test(name) && !CONST_RE.test(name)) t.classes.add(name)
    else if (t.called.has(name)) t.funcs.add(name)
    else if (t.memberObj.has(name)) t.modules.add(name)
  }
  return t
}

function kindOf(name, t, role) {
  if (role === 'def-func' || role === 'deco') return 'func'
  if (role === 'def-class') return 'cls'
  if (name === 'self' || name === 'cls') return 'var'
  if (t.classes.has(name) || BUILTIN_TYPES.has(name)) return 'cls'
  if (t.modules.has(name)) return 'mod'
  if (t.funcs.has(name) || BUILTIN_FUNCS.has(name)) return 'func'
  if (CONST_RE.test(name) && name.replace(/_/g, '').length > 1) return 'const'
  if (role === 'call') return CAP_RE.test(name) ? 'cls' : 'func'
  if (role === 'type' && CAP_RE.test(name)) return 'cls'
  return 'var'
}

function roleOf(node) {
  const p = node.parent
  if (!p) return 'ref'
  switch (p.name) {
    case 'FunctionDefinition': return p.getChild('VariableName') && p.getChild('VariableName').from === node.from ? 'def-func' : 'ref'
    case 'ClassDefinition': return p.getChild('VariableName') && p.getChild('VariableName').from === node.from ? 'def-class' : 'ref'
    case 'CallExpression': return p.firstChild && p.firstChild.from === node.from ? 'call' : 'ref'
    case 'Decorator': return 'deco'
    case 'TypeDef': return 'type'
    case 'ImportStatement': return 'import'
    default: return 'ref'
  }
}

function build(view, table) {
  const b = new RangeSetBuilder()
  const { state } = view
  const tree = syntaxTree(state)
  const doc = state.doc
  let last = -1
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from, to,
      enter(nd) {
        const n = nd.name
        if (nd.from < last) return
        if (n === 'VariableName') {
          const name = doc.sliceString(nd.from, nd.to)
          const role = roleOf(nd.node)
          let k
          if (role === 'import') {
            const imp = nd.node.parent
            const isFrom = imp.firstChild && imp.firstChild.name === 'from'
            const imKw = imp.getChild('import')
            k = !isFrom || (imKw && nd.from < imKw.from) ? 'mod' : kindOf(name, table, 'ref')
          } else k = kindOf(name, table, role)
          b.add(nd.from, nd.to, mark(k)); last = nd.to
        } else if (n === 'PropertyName') {
          const name = doc.sliceString(nd.from, nd.to)
          const me = nd.node.parent
          const call = me && me.parent && me.parent.name === 'CallExpression' && me.parent.firstChild && me.parent.firstChild.from === me.from && me.to === nd.to
          const deco = me && me.parent && me.parent.name === 'Decorator'
          const k = call || deco ? (CAP_RE.test(name) && !CONST_RE.test(name) ? 'cls' : 'func') : CONST_RE.test(name) && name.replace(/_/g, '').length > 1 ? 'const' : CAP_RE.test(name) ? 'cls' : 'prop'
          b.add(nd.from, nd.to, mark(k)); last = nd.to
        } else if (n === 'from') {
          b.add(nd.from, nd.to, mark('kwc')); last = nd.to
        } else if (n === 'At') {
          b.add(nd.from, nd.to, mark('func')); last = nd.to
        } else if (n === 'String' || n === 'FormatString') {
          // f"" r"" b"" の頭文字
          const head = doc.sliceString(nd.from, Math.min(nd.to, nd.from + 3))
          const m = /^[rRbBuUfFtT]{1,2}(?=['"])/.exec(head)
          if (m) { b.add(nd.from, nd.from + m[0].length, mark('fpre')); last = nd.from + m[0].length }
        }
      },
    })
  }
  return b.finish()
}

export const pySemantic = Prec.highest(ViewPlugin.fromClass(class {
  constructor(view) {
    this.tree = syntaxTree(view.state)
    this.table = collect(view.state, this.tree)
    this.decorations = build(view, this.table)
  }
  update(u) {
    const tree = syntaxTree(u.state)
    const treeChanged = tree !== this.tree
    if (treeChanged) {
      this.tree = tree
      // 大きなファイルは、名前の一覧の作り直しを少し待つ
      if (u.state.doc.length < 20000) this.table = collect(u.state, tree)
      else {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => { if (!u.view.dom.isConnected) return; this.table = collect(u.view.state, syntaxTree(u.view.state)); this.decorations = build(u.view, this.table); u.view.dispatch({}) }, 350)
      }
    }
    if (treeChanged || u.docChanged || u.viewportChanged) this.decorations = build(u.view, this.table)
  }
  destroy() { clearTimeout(this.timer) }
}, { decorations: v => v.decorations }))

// テスト用
export const _semantic = { collect, kindOf, BUILTIN_FUNCS, BUILTIN_TYPES }

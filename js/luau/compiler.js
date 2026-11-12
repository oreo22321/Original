// Luau AST → JavaScript (generator 関数) コンパイラ
// すべての Lua 関数は「引数配列を受け取り戻り値配列を返す generator」になります。
// コルーチンや task.wait は generator の yield で実現しています。
import { parse } from './parser.js'
import { LuauSyntaxError, toBytes } from './lexer.js'

const HELPERS = 'topLocals:$topl,call:$call,callMethod:$callm,index:$idx,setindex:$set,T:$T,add:$add,sub:$sub,mul:$mul,div:$div,mod:$mod,pow:$pow,idiv:$idiv,unm:$unm,eq:$eq,lt:$lt,le:$le,gt:$gt,ge:$ge,concat:$cat,len:$len,chk:$chk,annot:$annot,fn:$fn0,tbl:$tbl,iter:$iter,interp:$interp,forNum:$forNum,EMPTY:$EMPTY,rtError:$err'

const ARITH = { '+': '$add', '-': '$sub', '*': '$mul', '/': '$div', '%': '$mod', '^': '$pow', '//': '$idiv', '..': '$cat' }
const CMP = { '==': '$eq', '<': '$lt', '<=': '$le', '>': '$gt', '>=': '$ge' }
const S = s => JSON.stringify(s)
const isMulti = e => e.t === 'Call' || e.t === 'Method' || e.t === 'Vararg'

function mangle(name, id) {
  return 'v' + id + '_' + name.replace(/[^A-Za-z0-9_]/g, c => '$' + c.charCodeAt(0).toString(16))
}

class Scope {
  constructor(parent) {
    this.parent = parent
    this.vars = new Map()
    // デバッグ用: 宣言した順の一覧と、変数を返す関数 (getter) の名前
    this.list = []
    this.covered = 0
    this.getter = parent ? parent.getter : null
  }
}

class Compiler {
  constructor(chunk, debug = false) {
    this.chunk = chunk
    this.debug = debug
    this.uid = 0
    this.fs = null
    this.scope = null
    this.loops = []
    this.stmtLine = 0
  }

  err(msg, line) { throw new LuauSyntaxError(msg, line || this.stmtLine, 1, 0) }

  declare(name) {
    const js = mangle(name, ++this.uid)
    this.scope.vars.set(name, js)
    this.scope.list.push([name, js])
    return js
  }

  // デバッグ用: 前回から増えたローカル変数を返す関数を作り、外側の関数につなげる
  // (文ごとに全変数を並べるとコードが大きくなるので、宣言のたびに 1 つだけ作る)
  syncGetter() {
    const sc = this.scope
    if (sc.covered >= sc.list.length) return ''
    const fresh = sc.list.slice(sc.covered).reverse()
    sc.covered = sc.list.length
    const name = '$g' + (++this.uid)
    const prev = sc.getter
    const vars = fresh.map(([n, js]) => `[${S(n)},${js}]`).join(',')
    sc.getter = name
    return `const ${name}=()=>[${vars}${prev ? `,...${prev}()` : ''}];`
  }
  resolve(name) {
    for (let s = this.scope; s; s = s.parent) {
      const v = s.vars.get(name)
      if (v) return v
    }
    return null
  }
  temp() { return '$t' + (++this.fs.temps) }

  pushScope() { this.scope = new Scope(this.scope) }
  popScope() { this.scope = this.scope.parent }

  // ---- 関数 ----
  func(node, isMethod) {
    const parentFs = this.fs
    const saveScope = this.scope
    const saveLoops = this.loops
    const saveLine = this.stmtLine
    this.fs = { temps: 0, isVararg: node.isVararg }
    this.loops = []
    this.pushScope()
    const params = []
    if (isMethod || node.isMethod) params.push(this.declare('self'))
    for (const p of node.params) params.push(this.declare(p.name))
    let head = ''
    params.forEach((p, i) => { head += `let ${p}=$A[${i}];` })
    if (node.isVararg) head += `const $va=$A.length>${params.length}?$A.slice(${params.length}):$EMPTY;`
    let body = this.stats(node.body)
    // チャンクの一番外側のローカル変数を、実行後もコンソールから読めるように登録
    if (node.isChunk && this.scope.vars.size) {
      const vars = [...this.scope.vars].slice(0, 400)
      body = `$topl($CH,()=>{const o=[];${vars.map(([n, js]) => `try{o.push([${S(n)},${js}])}catch(e){}`).join('')}return o});` + body
    }
    const temps = this.fs.temps ? 'let ' + Array.from({ length: this.fs.temps }, (_, i) => '$t' + (i + 1)).join(',') + ';' : ''
    const name = node.name || 'anonymous'
    this.popScope()
    this.fs = parentFs
    this.scope = saveScope
    this.loops = saveLoops
    this.stmtLine = saveLine
    const envNow = parentFs ? '($F.env||$Ep)' : '$E0'
    if (this.debug) {
      // デバッグ実行: 呼び出し履歴 (どの関数の何行目か) を記録する
      return `$fn((($Ep)=>function*($A){const $F=this||$NOF;let $L=${node.line};const $fr=$D.e(${S(name)},()=>$L);${head}${temps}try{${body}return $EMPTY;}catch($e){throw $annot($e,$L,$CH,${S(name)})}finally{$D.x($fr)}})(${envNow}),${S(name)},${envNow})`
    }
    // 関数ごとの環境 (setfenv で変えられる)。作られたときの、作った関数の環境を引き継ぐ (Lua 5.1 と同じ)。
    // グローバル変数を使うたびに $F.env を見るので、実行中に setfenv(1, t) しても反映されます
    return `$fn((($Ep)=>function*($A){const $F=this||$NOF;let $L=${node.line};${head}${temps}try{${body}return $EMPTY;}catch($e){throw $annot($e,$L,$CH,${S(name)})}})(${envNow}),${S(name)},${envNow})`
  }

  // ---- 文 ----
  block(stats) {
    this.pushScope()
    const code = this.stats(stats)
    this.popScope()
    return code
  }

  stats(stats, hoist) {
    let out = ''
    for (const st of stats) {
      if (this.debug) out += this.syncGetter()
      out += this.stat(st, hoist)
    }
    return out
  }

  stat(st, hoist) {
    this.stmtLine = st.line
    // デバッグ実行: 文の前でブレークポイント・ステップ実行を確認し、止まるときは yield で実行を中断する
    const L = this.debug && st.t !== 'TypeAlias'
      ? `$L=${st.line};if($D.a&&$D.h(${st.line})&&$D.q(${st.line},${this.scope.getter || 'null'}))yield $D.sig;`
      : `$L=${st.line};`
    switch (st.t) {
      case 'Local': return L + this.local(st, hoist)
      case 'LocalFunction': {
        if (hoist) {
          const js = this.declare(st.name.name)
          hoist.push(js)
          return `${L}${js}=${this.func(st.func)};`
        }
        const js = this.declare(st.name.name)
        return `${L}let ${js};${js}=${this.func(st.func)};`
      }
      case 'Function': {
        const f = this.func(st.func, st.isMethod)
        return L + this.assignTo(st.target, f) + ';'
      }
      case 'Assign': return L + this.assign(st)
      case 'Compound': return L + this.compound(st)
      case 'CallStat': return L + this.callExpr(st.call) + ';'
      case 'If': {
        let s = L
        st.clauses.forEach((c, i) => {
          this.stmtLine = c.line
          s += (i ? `else if(($L=${c.line},` : 'if((') + this.cond(c.cond) + ')){' + this.block(c.body) + '}'
        })
        if (st.orelse) s += 'else{' + this.block(st.orelse) + '}'
        return s
      }
      case 'While': {
        this.loops.push({ kind: 'while' })
        const s = `${L}while(${this.cond(st.cond)}){$chk();${this.block(st.body)}}`
        this.loops.pop()
        return s
      }
      case 'Repeat': {
        const label = '$c' + (++this.uid)
        const loop = { kind: 'repeat', label, used: false }
        this.loops.push(loop)
        this.pushScope()
        const hoisted = []
        const body = this.stats(st.body, hoisted)
        this.stmtLine = st.line
        const cond = this.cond(st.cond)
        this.popScope()
        this.loops.pop()
        const decl = hoisted.length ? `let ${hoisted.join(',')};` : ''
        const inner = loop.used ? `${label}:{${body}}` : body
        return `${L}while(true){$chk();${decl}${inner}if(${cond})break;}`
      }
      case 'NumFor': {
        const start = this.single(st.start), stop = this.single(st.stop)
        let stepCode = '1', cond
        if (st.step) {
          if (st.step.t === 'Number') {
            stepCode = String(st.step.v)
            cond = st.step.v > 0 ? '$i<=$b' : '$i>=$b'
            if (st.step.v === 0) cond = null
          } else if (st.step.t === 'Un' && st.step.op === '-' && st.step.e.t === 'Number') {
            stepCode = String(-st.step.e.v)
            cond = '$i>=$b'
          } else stepCode = `$forNum(${this.single(st.step)},'step')`
        } else cond = '$i<=$b'
        if (!cond) cond = '($c>0?$i<=$b:$i>=$b)'
        this.loops.push({ kind: 'for' })
        this.pushScope()
        const v = this.declare(st.var.name)
        const body = this.stats(st.body)
        this.popScope()
        this.loops.pop()
        return `${L}{let $a=$forNum(${start},'initial value'),$b=$forNum(${stop},'limit'),$c=${stepCode};if($c===0)throw $err("'for' step is zero");for(let $i=$a;${cond};$i+=$c){$chk();let ${v}=$i;${body}}}`
      }
      case 'GenFor': {
        const exprs = this.explist(st.exprs)
        this.loops.push({ kind: 'for' })
        this.pushScope()
        const vars = st.vars.map(v => this.declare(v.name))
        const body = this.stats(st.body)
        this.popScope()
        this.loops.pop()
        const binds = vars.map((v, i) => `${v}=$r[${i}]`).join(',')
        return `${L}{const $it=$iter(${exprs});for(;;){$chk();const $r=$it.f?$it.step():(yield* $it.g());if($r===null)break;let ${binds};${body}}}`
      }
      case 'Do': return `${L}{${this.block(st.body)}}`
      case 'Return': {
        const v = st.values
        if (!v.length) return `${L}return $EMPTY;`
        return `${L}return ${this.explist(v)};`
      }
      case 'Break': return 'break;'
      case 'Continue': {
        const loop = this.loops[this.loops.length - 1]
        if (!loop) this.err("'continue' はループの中でしか使えません", st.line)
        if (loop.kind === 'repeat') { loop.used = true; return `break ${loop.label};` }
        return 'continue;'
      }
      case 'TypeAlias': return ''
      default:
        this.err('未対応の文: ' + st.t, st.line)
    }
  }

  local(st, hoist) {
    const vals = st.values
    const n = st.names.length
    const emit = (names, rhs) => {
      if (hoist) {
        hoist.push(...names)
        return names.length === 1 ? `${names[0]}=${rhs};` : `[${names.join(',')}]=${rhs};`
      }
      return names.length === 1 ? `let ${names[0]}=${rhs};` : `let [${names.join(',')}]=${rhs};`
    }
    if (!vals.length) {
      const names = st.names.map(b => this.declare(b.name))
      if (hoist) { hoist.push(...names); return names.map(x => `${x}=undefined;`).join('') }
      return `let ${names.join(',')};`
    }
    if (n === 1 && vals.length === 1) {
      const rhs = this.single(vals[0])
      return emit([this.declare(st.names[0].name)], rhs)
    }
    if (vals.length >= n) {
      // 値が十分ある: 1 つずつ評価 (余った式は副作用のために評価)
      const rhs = vals.slice(0, n).map(v => this.single(v))
      const extra = vals.slice(n).map(v => this.single(v) + ';').join('')
      const names = st.names.map(b => this.declare(b.name))
      if (hoist) {
        hoist.push(...names)
        return names.map((x, i) => `${x}=${rhs[i]};`).join('') + extra
      }
      return `let ${names.map((x, i) => `${x}=${rhs[i]}`).join(',')};${extra}`
    }
    const rhs = this.explist(vals)
    return emit(st.names.map(b => this.declare(b.name)), rhs)
  }

  assignTo(target, valueJs) {
    if (target.t === 'Name') {
      const js = this.resolve(target.name)
      if (js) return `${js}=${valueJs}`
      return `$set(($F.env||$Ep),${S(toBytes(target.name))},${valueJs})`
    }
    return `$set(${this.single(target.obj)},${this.key(target)},${valueJs})`
  }

  key(indexNode) {
    if (indexNode.dot) return S(toBytes(indexNode.key.v))
    return this.single(indexNode.key)
  }

  assign(st) {
    const { targets, values } = st
    if (targets.length === 1 && values.length === 1) return this.assignTo(targets[0], this.single(values[0])) + ';'
    let out = ''
    // 右辺を先に評価して一時変数へ
    const tmps = []
    if (values.length >= targets.length) {
      values.forEach((v, i) => {
        if (i < targets.length) {
          const t = this.temp()
          tmps.push(t)
          out += `${t}=${this.single(v)};`
        } else out += this.single(v) + ';'
      })
    } else {
      const arr = this.temp()
      out += `${arr}=${this.explist(values)};`
      targets.forEach((_, i) => tmps.push(`${arr}[${i}]`))
    }
    targets.forEach((tg, i) => { out += this.assignTo(tg, tmps[i]) + ';' })
    return out
  }

  compound(st) {
    const op = ARITH[st.op]
    const tg = st.target
    const val = this.single(st.value)
    if (tg.t === 'Name') {
      const js = this.resolve(tg.name)
      if (js) return `${js}=${op}(${js},${val});`
      const k = S(toBytes(tg.name))
      return `{const $g=$F.env||$Ep;$set($g,${k},${op}($idx($g,${k}),${val}));}`
    }
    const o = this.temp(), k = this.temp()
    return `${o}=${this.single(tg.obj)};${k}=${this.key(tg)};$set(${o},${k},${op}($idx(${o},${k}),${val}));`
  }

  // ---- 式 ----
  explist(list) {
    if (!list.length) return '$EMPTY'
    const last = list[list.length - 1]
    if (list.length === 1 && isMulti(last)) return this.multi(last)
    const items = list.map((x, i) => (i === list.length - 1 && isMulti(x)) ? '...' + this.multi(x) : this.single(x))
    return `[${items.join(',')}]`
  }

  multi(e) {
    if (e.t === 'Vararg') { this.checkVararg(e); return '$va' }
    return this.callExpr(e)
  }

  checkVararg(e) {
    if (!this.fs.isVararg) this.err("'...' は可変長引数の関数の中でしか使えません", e.line)
  }

  callHint(fnNode) {
    if (fnNode.t === 'Name') return (this.resolve(fnNode.name) ? 'local ' : 'global ') + `'${fnNode.name}'`
    if (fnNode.t === 'Index' && fnNode.dot) return `field '${fnNode.key.v}'`
    return ''
  }

  callExpr(e) {
    let code
    if (e.t === 'Method') {
      code = `(yield* $callm(${this.single(e.obj)},${S(toBytes(e.name))},${this.explist(e.args)}))`
    } else {
      const hint = this.callHint(e.fn)
      code = `(yield* $call(${this.single(e.fn)},${this.explist(e.args)}${hint ? ',' + S(hint) : ''}))`
    }
    if (e.line !== this.stmtLine) code = `($L=${e.line},${code})`
    return code
  }

  cond(e) {
    switch (e.t) {
      case 'True': return 'true'
      case 'False': case 'Nil': return 'false'
      case 'Bin':
        if (CMP[e.op]) return `${CMP[e.op]}(${this.single(e.l)},${this.single(e.r)})`
        if (e.op === '~=') return `!$eq(${this.single(e.l)},${this.single(e.r)})`
        if (e.op === 'and') return `(${this.cond(e.l)}&&${this.cond(e.r)})`
        if (e.op === 'or') return `(${this.cond(e.l)}||${this.cond(e.r)})`
        break
      case 'Un':
        if (e.op === 'not') return `!${this.cond(e.e)}`
        break
      case 'Paren': return this.cond(e.e)
    }
    return `$T(${this.single(e)})`
  }

  single(e) {
    switch (e.t) {
      case 'Nil': return 'undefined'
      case 'True': return 'true'
      case 'False': return 'false'
      case 'Number': return e.v === Infinity ? 'Infinity' : e.v !== e.v ? 'NaN' : String(e.v)
      case 'String': return S(e.v)
      case 'Vararg': this.checkVararg(e); return '$va[0]'
      case 'Func': return this.func(e)
      case 'Table': return this.table(e)
      case 'Bin': return this.bin(e)
      case 'Un': {
        if (e.op === '-') {
          if (e.e.t === 'Number') return `(-${this.single(e.e)})`
          return `$unm(${this.single(e.e)})`
        }
        if (e.op === 'not') return `!${this.cond(e.e)}`
        return `$len(${this.single(e.e)})`
      }
      case 'Name': {
        const js = this.resolve(e.name)
        return js || `$idx(($F.env||$Ep),${S(toBytes(e.name))})`
      }
      case 'Index': return `$idx(${this.single(e.obj)},${this.key(e)})`
      case 'Call': case 'Method': return `${this.callExpr(e)}[0]`
      case 'Paren': return this.single(e.e)
      case 'Cast': return this.single(e.e)
      case 'IfExpr': {
        let s = '('
        for (const c of e.clauses) s += `${this.cond(c.cond)}?${this.single(c.val)}:`
        return s + this.single(e.orelse) + ')'
      }
      case 'Interp': {
        const parts = e.parts.map(p => typeof p === 'string' ? S(p) : this.single(p))
        return `$interp([${parts.join(',')}])`
      }
    }
    this.err('未対応の式: ' + e.t, e.line)
  }

  bin(e) {
    const op = e.op
    if (ARITH[op]) return `${ARITH[op]}(${this.single(e.l)},${this.single(e.r)})`
    if (CMP[op]) return `${CMP[op]}(${this.single(e.l)},${this.single(e.r)})`
    if (op === '~=') return `!$eq(${this.single(e.l)},${this.single(e.r)})`
    const t = this.temp()
    if (op === 'and') return `(${t}=${this.single(e.l)},$T(${t})?${this.single(e.r)}:${t})`
    if (op === 'or') return `(${t}=${this.single(e.l)},$T(${t})?${t}:${this.single(e.r)})`
    this.err('未対応の演算子: ' + op, e.line)
  }

  table(e) {
    if (!e.items.length) return '$tbl()'
    const pos = [], pairs = []
    e.items.forEach((it, i) => {
      if (it.k === 'pos') {
        if (i === e.items.length - 1 && isMulti(it.value)) pos.push('...' + this.multi(it.value))
        else pos.push(this.single(it.value))
      } else if (it.k === 'named') {
        pairs.push(S(toBytes(it.key)), this.single(it.value))
      } else {
        pairs.push(this.single(it.key), this.single(it.value))
      }
    })
    if (!pairs.length) return `$tbl([${pos.join(',')}])`
    return `$tbl(${pos.length ? '[' + pos.join(',') + ']' : 'null'},[${pairs.join(',')}])`
  }
}

// Luau ソースを JS ソースに変換
export function compileToJs(src, chunkname = 'main', debug = false) {
  const ast = parse(src)
  const c = new Compiler(chunkname, debug)
  const main = { t: 'Func', params: [], isVararg: true, body: ast.body, name: null, line: 1, isChunk: true }
  const code = c.func(main)
  // 関数ごとの環境: $F.env (setfenv で設定) か、作られたときの環境 $Ep。envD は getfenv 用
  return `"use strict";const {${HELPERS}}=$;const $NOF={};const $fn=(g,n,e)=>{const f=$fn0(g,n);f.envD=e;return f};return ${code};`
}

// ソースを読み込み LFunc を返す
export function loadChunk(src, chunkname, env, helpers) {
  const dbg = helpers.rt && helpers.rt.debugger
  const js = compileToJs(src, chunkname, !!dbg)
  const factory = new Function('$', '$E0', '$CH', '$D', js)
  const f = factory(helpers, env, chunkname, dbg ? dbg.handle(chunkname) : null)
  f.name = chunkname
  return f
}

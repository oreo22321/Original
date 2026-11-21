#!/usr/bin/env node
'use strict';
// Windows のバッチファイル (.bat / .cmd) を Linux で動かす、小さな cmd.exe です。
//   node cmd.js start.bat [引数…]
//   node cmd.js /c "python main.py & pause"
// bot の起動によく使うもの (echo・set・if・for・goto・call・cd・timeout・start・pause など) に対応しています。
// python / py / pip / node / java / .exe / .bat などは、このサーバーで動くものに置き換えて実行します。
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const BOT_DIR = process.env.BOTHOST_BOT_DIR || process.cwd();

class GotoSignal { constructor(label) { this.label = label; } }
class ExitSignal { constructor(code, all) { this.code = code; this.all = all; } }

// ----- ファイルを読む (UTF-8 でなければ Shift_JIS) -----
function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* 日本語の Windows のファイル */ }
  try { return new TextDecoder('shift_jis').decode(buf); } catch { return buf.toString('latin1'); }
}

// ----- 環境変数 (Windows のように大文字・小文字を区別しない) -----
class Env {
  constructor(src) { this.map = new Map(); for (const [k, v] of Object.entries(src)) if (v !== undefined) this.map.set(k.toUpperCase(), [k, v]); }
  get(k) { const e = this.map.get(String(k).toUpperCase()); return e ? e[1] : undefined; }
  set(k, v) {
    if (v === '' || v === undefined) { this.map.delete(String(k).toUpperCase()); return; }
    const old = this.map.get(String(k).toUpperCase());
    this.map.set(String(k).toUpperCase(), [old ? old[0] : k, v]);
  }
  has(k) { return this.map.has(String(k).toUpperCase()); }
  clone() { const e = new Env({}); e.map = new Map(this.map); return e; }
  object() { const o = {}; for (const [k, v] of this.map.values()) o[k] = v; return o; }
  entries() { return [...this.map.values()].sort((a, b) => a[0].localeCompare(b[0])); }
}

const out = (s) => { try { fs.writeSync(1, s); } catch { /* 出力先が閉じた */ } };
const err = (s) => { try { fs.writeSync(2, s); } catch { /* 出力先が閉じた */ } };
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms)); }

// 標準入力から 1 行 (set /p 用)
function readLine() {
  const buf = Buffer.alloc(1);
  const bytes = [];
  for (;;) {
    let n;
    try { n = fs.readSync(0, buf, 0, 1, null); } catch (e) { if (e.code === 'EAGAIN') { sleepMs(50); continue; } return null; }
    if (n === 0) return bytes.length ? Buffer.from(bytes).toString('utf8') : null;
    if (buf[0] === 0x0a) break;
    bytes.push(buf[0]);
  }
  return Buffer.from(bytes).toString('utf8').replace(/\r$/, '');
}

// ----- パスを Linux 用に -----
// C:\Users\me\Desktop\mybot\main.py → (bot のフォルダー)/main.py、src\main.py → src/main.py
function winPath(p, cwd) {
  if (typeof p !== 'string' || !p) return p;
  if (/^nul$/i.test(p)) return '/dev/null';
  if (/^[A-Za-z]:([\\/]|$)/.test(p)) {
    const parts = p.slice(2).split(/[\\/]+/).filter(Boolean);
    // 後ろの方から、bot のフォルダーにあるものを探す
    for (let i = 0; i < parts.length; i++) {
      const cand = path.join(BOT_DIR, ...parts.slice(i));
      if (fs.existsSync(cand)) return cand;
    }
    return parts.length ? path.join(BOT_DIR, parts[parts.length - 1]) : BOT_DIR;
  }
  if (p.includes('\\')) {
    const q = p.replace(/\\/g, '/');
    return q;
  }
  void cwd;
  return p;
}

// 大文字・小文字の違いを許してファイルを探す
function findCase(cwd, p) {
  const full = path.resolve(cwd, p);
  if (fs.existsSync(full)) return full;
  let cur = path.parse(full).root;
  for (const part of full.slice(cur.length).split(path.sep).filter(Boolean)) {
    let names;
    try { names = fs.readdirSync(cur); } catch { return null; }
    const hit = names.find((n) => n === part) || names.find((n) => n.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

// ----- 文字の分け方 -----
// 引用符の外の ^ を外す (^& → &)
function unescape(s) {
  let r = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    if (c === '^' && !q && i + 1 < s.length) { r += s[++i]; continue; }
    if (c === '^' && !q) continue;
    r += c;
  }
  return r;
}

// 外部コマンドに渡す引数に分ける (引用符でまとめる)
function splitArgs(s) {
  const args = [];
  let cur = '';
  let q = false;
  let has = false;
  for (const c of s) {
    if (c === '"') { q = !q; has = true; continue; }
    if (!q && (c === ' ' || c === '\t')) { if (cur || has) { args.push(cur); cur = ''; has = false; } continue; }
    cur += c;
  }
  if (cur || has) args.push(cur);
  return args;
}

// 組み込みコマンドの引数 (, ; = も区切り)
function splitBuiltin(s) { return splitArgs(s.replace(/[,;=](?=(?:[^"]*"[^"]*")*[^"]*$)/g, ' ')); }

// ----- 解析: 1 つの文 (行やかっこのまとまり) を、コマンドの並びに -----
class Parser {
  constructor(src) { this.s = src; this.i = 0; }
  peek(n = 0) { return this.s[this.i + n]; }
  eof() { return this.i >= this.s.length; }
  ws() { while (!this.eof() && (this.peek() === ' ' || this.peek() === '\t')) this.i++; }
  ws2() { this.ws(); }

  // 並び: cmd (op cmd)*。op = & && || |
  chain(depth) {
    const items = [];
    let op = null;
    for (;;) {
      this.ws();
      while (!this.eof() && this.peek() === '\n') { this.i++; this.ws(); if (items.length) op = op || '&'; }
      if (this.eof()) break;
      if (depth > 0 && this.peek() === ')') break;
      const cmd = this.command(depth);
      if (cmd) items.push({ op: items.length ? (op || '&') : null, cmd });
      op = null;
      this.ws2();
      if (this.eof()) break;
      const c = this.peek();
      if (c === '&') { if (this.peek(1) === '&') { op = '&&'; this.i += 2; } else { op = '&'; this.i++; } continue; }
      if (c === '|') { if (this.peek(1) === '|') { op = '||'; this.i += 2; } else { op = '|'; this.i++; } continue; }
      if (c === '\n') { this.i++; if (depth === 0) break; op = '&'; continue; }
      if (c === ')' && depth > 0) break;
    }
    return items;
  }

  block(depth) {
    this.i++; // (
    const items = this.chain(depth + 1);
    if (this.peek() === ')') this.i++;
    return { type: 'block', items };
  }

  word() {
    const st = this.i;
    while (!this.eof() && !' \t\n&|()<>'.includes(this.peek())) this.i++;
    return this.s.slice(st, this.i);
  }

  // 1 つのコマンドの本体 (ブロックか、ふつうのコマンド)
  body(depth) {
    this.ws();
    if (this.peek() === '(') return this.block(depth);
    return this.command(depth);
  }

  command(depth) {
    this.ws();
    let silent = false;
    while (this.peek() === '@') { silent = true; this.i++; this.ws(); }
    if (this.peek() === '(') return this.block(depth);
    const save = this.i;
    const w = this.word().toLowerCase();
    // rem・:: (コメント)、ブロックの中の :ラベル は飛ばす
    if (w === 'rem' || w.startsWith(':')) { while (!this.eof() && this.peek() !== '\n') this.i++; return null; }
    if (w === 'if') return this.ifCmd(depth);
    if (w === 'for') return this.forCmd(depth);
    this.i = save;
    const node = this.simple(depth);
    if (node) node.silent = silent;
    return node;
  }

  // ふつうのコマンド: & | 改行 ) (ブロックの中) までの文字
  simple(depth) {
    const st = this.i;
    let q = false;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '"') q = !q;
      else if (c === '^' && !q) { this.i += 2; continue; } else if (!q && (c === '&' || c === '|' || c === '\n')) break;
      else if (!q && c === ')' && depth > 0) break;
      this.i++;
    }
    const raw = this.s.slice(st, this.i).replace(/\s+$/, '');
    return raw ? { type: 'simple', raw } : null;
  }

  // if [/i] [not] 条件 本体 [else 本体]
  ifCmd(depth) {
    const node = { type: 'if', ci: false, not: false };
    for (;;) {
      this.ws2();
      const save = this.i;
      const w = this.word().toLowerCase();
      if (w === '/i') { node.ci = true; continue; }
      if (w === 'not') { node.not = true; continue; }
      if (w === 'exist' || w === 'defined' || w === 'errorlevel' || w === 'cmdextversion') {
        this.ws2();
        node.cond = w;
        node.arg = this.token();
        break;
      }
      this.i = save;
      // 比べる: a==b / a EQU b
      node.cond = 'cmp';
      node.a = this.token(true);
      this.ws2();
      if (this.s.startsWith('==', this.i)) { this.i += 2; node.op = '=='; } else {
        const opw = this.word().toUpperCase();
        node.op = ['EQU', 'NEQ', 'LSS', 'LEQ', 'GTR', 'GEQ'].includes(opw) ? opw : '==';
      }
      this.ws2();
      node.b = this.token(true);
      break;
    }
    node.then = this.body(depth);
    // else (同じ行、または ) else ( の形)
    const save = this.i;
    this.ws();
    if (/^else\b/i.test(this.s.slice(this.i, this.i + 5)) && (this.s[this.i + 4] === undefined || /[\s(]/.test(this.s[this.i + 4]))) {
      this.i += 4;
      node.else = this.body(depth);
    } else this.i = save;
    return node;
  }

  // 引用符でまとめた 1 つの文字 (== の前後も区切る)
  token(stopEq = false) {
    let r = '';
    let q = false;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '"') { q = !q; r += c; this.i++; continue; }
      if (!q && (c === ' ' || c === '\t' || c === '\n' || c === '(' || c === '&' || c === '|')) break;
      if (!q && stopEq && c === '=' && this.peek(1) === '=') break;
      if (c === '^' && !q && this.i + 1 < this.s.length) { r += this.s[this.i + 1]; this.i += 2; continue; }
      r += c; this.i++;
    }
    return r;
  }

  // for [/l /f /d /r] [オプション] %%v in (…) do 本体
  forCmd(depth) {
    const node = { type: 'for', flag: null, opts: '', root: null };
    this.ws2();
    if (this.peek() === '/') {
      node.flag = this.word().toLowerCase();
      this.ws2();
      if (node.flag === '/f' && this.peek() === '"') node.opts = this.token();
      else if (node.flag === '/r' && this.peek() !== '%') { node.root = this.token(); }
      this.ws2();
    }
    node.v = this.word().replace(/^%+/, '');
    this.ws2();
    this.word(); // in
    this.ws2();
    if (this.peek() === '(') {
      this.i++;
      const st = this.i;
      let q = false;
      while (!this.eof() && (q || this.peek() !== ')')) { if (this.peek() === '"' || this.peek() === "'" || this.peek() === '`') q = q === this.peek() ? false : (q || this.peek()); this.i++; }
      node.set = this.s.slice(st, this.i).trim();
      this.i++;
    }
    this.ws2();
    this.word(); // do
    const st = this.i;
    node.body = this.body(depth);
    node.bodySrc = this.s.slice(st, this.i);
    return node;
  }
}

// 文の長さ: かっこが閉じるまで、次の行も同じ文
function splitStatements(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const stmts = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // 行の終わりの ^ は、次の行とつなぐ
    while (/(^|[^^])(\^\^)*\^$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i];
    const t = line.trim().replace(/^@+/, '');
    if (!t) continue;
    if (t.startsWith(':')) {
      if (t.startsWith('::')) continue;
      stmts.push({ label: t.slice(1).split(/[\s:+]/)[0].toLowerCase(), line: i + 1 });
      continue;
    }
    let depth = Math.max(0, depthOf(line, false));
    while (depth > 0 && i + 1 < lines.length) {
      const next = lines[++i];
      line += '\n' + next;
      depth += depthOf(next, true);
    }
    stmts.push({ text: line, line: i + 1 });
  }
  return stmts;
}

// かっこの数 (開く +1・閉じる -1)。echo の行のかっこは文字なので数えない (ブロックの中の ) だけは閉じる)
function depthOf(line, inBlock) {
  const t = line.trim().toLowerCase().replace(/^@+/, '');
  if (/^(rem\b|::)/.test(t)) return 0;
  const echo = /^echo[\s.:(]/.test(t) && !/[&|]/.test(t);
  let d = 0;
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === '^' && !q) i++;
    else if (!q && c === '(' && !echo) d++;
    else if (!q && c === ')' && (!echo || inBlock)) d--;
  }
  return d;
}

// ----- 実行 -----
class Batch {
  constructor(file, args, ctx) {
    this.file = file; // フルパス (/c のときは null)
    this.args = args; // %1 …
    this.ctx = ctx;
  }
}

class Interp {
  constructor() {
    this.env = new Env(process.env);
    this.cwd = process.cwd();
    this.echo = true;
    this.delayed = false;
    this.errorlevel = 0;
    this.locals = [];
    this.dirs = [];
    this.background = [];
    if (!this.env.has('USERNAME')) this.env.set('USERNAME', process.env.USER || 'bot');
    if (!this.env.has('USERPROFILE')) this.env.set('USERPROFILE', process.env.HOME || BOT_DIR);
    if (!this.env.has('APPDATA')) this.env.set('APPDATA', path.join(process.env.HOME || BOT_DIR, '.config'));
    if (!this.env.has('TEMP')) { this.env.set('TEMP', '/tmp'); this.env.set('TMP', '/tmp'); }
    if (!this.env.has('OS')) this.env.set('OS', 'Windows_NT');
    if (!this.env.has('COMSPEC')) this.env.set('COMSPEC', 'cmd.exe');
    if (!this.env.has('PATHEXT')) this.env.set('PATHEXT', '.COM;.EXE;.BAT;.CMD;.PY;.JS');
  }

  // %VAR% %1 %~dp0 %%i → 値に (行を読んだときに 1 回)
  expand(text, batch) {
    let r = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c !== '%') { r += c; continue; }
      const nx = text[i + 1];
      if (nx === undefined) break;
      if (nx === '%') { r += '%'; i++; continue; }
      if (batch && (nx === '*')) { r += batch.args.map((a) => (/\s/.test(a) && !a.startsWith('"') ? `"${a}"` : a)).join(' '); i++; continue; }
      const m = /^~([fdpnxsatz]*)([0-9])/i.exec(text.slice(i + 1));
      if (batch && m) { r += this.argMod(m[1], Number(m[2]) === 0 && batch.file ? batch.file : this.argVal(batch, Number(m[2]))); i += m[0].length; continue; }
      if (batch && /[0-9]/.test(nx)) { r += this.argVal(batch, Number(nx)); i++; continue; }
      const end = text.indexOf('%', i + 1);
      if (end < 0) { if (!batch) r += '%'; continue; }
      const name = text.slice(i + 1, end);
      if (!name || name.includes('\n')) { if (!batch) r += '%'; continue; }
      const v = this.varValue(name);
      if (v === undefined) { if (!batch) r += `%${name}%`; i = end; continue; }
      r += v;
      i = end;
    }
    return r;
  }

  expandDelayed(text) {
    if (!this.delayed || !text.includes('!')) return text;
    return text.replace(/!([^!\n]+)!/g, (all, name) => { const v = this.varValue(name); return v === undefined ? '' : v; });
  }

  argVal(batch, n) {
    if (n === 0) return batch.file ? path.relative(this.cwd, batch.file) || batch.file : 'cmd';
    const a = batch.args[n - 1];
    // cmd では、空白のある引数は引用符ごと渡る ("y z")。%~1 で引用符を外せる
    return a === undefined ? '' : (/\s/.test(a) && !a.startsWith('"') ? `"${a}"` : a);
  }

  argMod(mods, val) {
    let v = val.replace(/^"|"$/g, '');
    if (!mods) return v;
    const full = v ? path.resolve(this.cwd, winPath(v)) : this.cwd;
    const m = mods.toLowerCase();
    if (m === 'f') return full;
    let s = '';
    if (m.includes('d')) s += '';
    if (m.includes('p')) s += path.dirname(full) + '/';
    if (m.includes('n')) s += path.basename(full, path.extname(full));
    if (m.includes('x')) s += path.extname(full);
    if (m.includes('z')) { try { s += String(fs.statSync(full).size); } catch { /* ない */ } }
    if (m.includes('t')) { try { s += fs.statSync(full).mtime.toLocaleString('ja-JP'); } catch { /* ない */ } }
    if (m.includes('a')) s += '--a------';
    return s || (m.includes('d') ? '/' : v);
  }

  varValue(spec) {
    // %VAR:~1,3% / %VAR:a=b%
    const m = /^([^:]+):(.*)$/s.exec(spec);
    const name = m ? m[1] : spec;
    let v = this.dynamic(name);
    if (v === undefined) return undefined;
    if (!m) return v;
    const op = m[2];
    const sub = /^~(-?\d+)(?:,(-?\d+))?$/.exec(op);
    if (sub) {
      let st = Number(sub[1]);
      if (st < 0) st = Math.max(0, v.length + st);
      let end = v.length;
      if (sub[2] !== undefined) { const n = Number(sub[2]); end = n < 0 ? v.length + n : st + n; }
      return v.slice(st, Math.max(st, end));
    }
    const eq = op.indexOf('=');
    if (eq >= 0) {
      let from = op.slice(0, eq);
      const to = op.slice(eq + 1);
      if (!from) return v;
      let star = false;
      if (from.startsWith('*')) { star = true; from = from.slice(1); }
      const idx = v.toLowerCase().indexOf(from.toLowerCase());
      if (star) return idx < 0 ? v : to + v.slice(idx + from.length);
      const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      return v.replace(re, () => to);
    }
    return v;
  }

  dynamic(name) {
    const v = this.env.get(name);
    if (v !== undefined) return v;
    const now = new Date();
    switch (name.toUpperCase()) {
      case 'CD': return this.cwd;
      case 'ERRORLEVEL': return String(this.errorlevel);
      case 'RANDOM': return String(Math.floor(Math.random() * 32768));
      case 'DATE': return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
      case 'TIME': return `${String(now.getHours()).padStart(2, ' ')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0')}`;
      case 'CMDCMDLINE': return 'cmd.exe';
      case 'CMDEXTVERSION': return '2';
      case 'NUMBER_OF_PROCESSORS': return String(require('os').cpus().length);
      default: return undefined;
    }
  }

  // ----- スクリプトを動かす -----
  runFile(file, args, { start } = {}) {
    let text;
    try { text = decode(fs.readFileSync(file)); } catch (e) {
      err(`${path.basename(file)} を読めません: ${e.message}\n`);
      return 1;
    }
    const stmts = splitStatements(text);
    const batch = new Batch(file, args);
    return this.runStmts(stmts, batch, start);
  }

  runStmts(stmts, batch, startLabel) {
    const labels = new Map();
    stmts.forEach((s, i) => { if (s.label && !labels.has(s.label)) labels.set(s.label, i); });
    let i = 0;
    if (startLabel) {
      if (!labels.has(startLabel)) { err(`ラベル :${startLabel} が見つかりません\n`); return 1; }
      i = labels.get(startLabel) + 1;
    }
    const localDepth = this.locals.length;
    try {
      while (i < stmts.length) {
        const s = stmts[i++];
        if (s.label) continue;
        try {
          this.runText(this.expand(s.text, batch), batch);
        } catch (e) {
          if (e instanceof GotoSignal) {
            if (e.label === 'eof') return this.errorlevel;
            if (!labels.has(e.label)) { err(`ラベル :${e.label} が見つかりません\n`); this.errorlevel = 1; return 1; }
            i = labels.get(e.label) + 1;
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      if (e instanceof ExitSignal && !e.all) { this.errorlevel = e.code; return e.code; }
      throw e;
    } finally {
      while (this.locals.length > localDepth) this.endlocal();
    }
    return this.errorlevel;
  }

  runText(text, batch) {
    const items = new Parser(text).chain(0);
    this.runChain(items, batch);
  }

  runChain(items, batch) {
    for (let k = 0; k < items.length; k++) {
      const { op, cmd } = items[k];
      if (op === '&&' && this.errorlevel !== 0) continue;
      if (op === '||' && this.errorlevel === 0) continue;
      // パイプ: a | b | c
      if (items[k + 1] && items[k + 1].op === '|') {
        const stages = [cmd];
        while (items[k + 1] && items[k + 1].op === '|') stages.push(items[++k].cmd);
        this.runPipe(stages, batch);
        continue;
      }
      this.runCmd(cmd, batch);
    }
  }

  runCmd(cmd, batch, io) {
    if (!cmd) return;
    if (cmd.type === 'block') { this.runChain(cmd.items, batch); return; }
    if (cmd.type === 'if') { this.runIf(cmd, batch); return; }
    if (cmd.type === 'for') { this.runFor(cmd, batch); return; }
    this.simple(cmd.raw, batch, io, cmd.silent);
  }

  runIf(node, batch) {
    let ok;
    const strip = (s) => this.expandDelayed(s).replace(/^"|"$/g, '');
    if (node.cond === 'exist') ok = this.existGlob(strip(node.arg));
    else if (node.cond === 'defined') ok = this.dynamic(node.arg) !== undefined;
    else if (node.cond === 'errorlevel') ok = this.errorlevel >= Number(node.arg);
    else if (node.cond === 'cmdextversion') ok = 2 >= Number(node.arg);
    else {
      let a = this.expandDelayed(node.a);
      let b = this.expandDelayed(node.b);
      if (node.op === '==') {
        ok = node.ci ? a.toLowerCase() === b.toLowerCase() : a === b;
      } else {
        a = a.replace(/^"|"$/g, ''); b = b.replace(/^"|"$/g, '');
        const na = Number(a); const nb = Number(b);
        const num = a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb);
        const x = num ? na : (node.ci ? a.toLowerCase() : a);
        const y = num ? nb : (node.ci ? b.toLowerCase() : b);
        ok = { EQU: x === y, NEQ: x !== y, LSS: x < y, LEQ: x <= y, GTR: x > y, GEQ: x >= y }[node.op];
      }
    }
    if (node.not) ok = !ok;
    if (ok) this.runCmd(node.then, batch);
    else if (node.else) this.runCmd(node.else, batch);
  }

  existGlob(p) {
    const q = winPath(p);
    if (!/[*?]/.test(q)) return !!findCase(this.cwd, q);
    return this.glob(q).length > 0;
  }

  glob(pattern) {
    const dir = path.dirname(pattern);
    const base = path.basename(pattern);
    const re = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    let names = [];
    try { names = fs.readdirSync(path.resolve(this.cwd, dir)); } catch { return []; }
    return names.filter((n) => re.test(n)).sort().map((n) => (dir === '.' ? n : path.join(dir, n)));
  }

  runFor(node, batch) {
    const v = node.v;
    const items = [];
    const set = this.expandDelayed(node.set || '');
    if (node.flag === '/l') {
      const [a, s, b] = set.split(/[\s,]+/).map(Number);
      if (s > 0) for (let x = a; x <= b; x += s) items.push(String(x));
      else if (s < 0) for (let x = a; x >= b; x += s) items.push(String(x));
    } else if (node.flag === '/f') {
      const o = this.forOpts(node.opts.replace(/^"|"$/g, ''));
      let text = '';
      const t = set.trim();
      const cmdQuote = o.usebackq ? '`' : "'";
      const strQuote = o.usebackq ? "'" : '"';
      if (t.startsWith(cmdQuote)) text = this.capture(t.slice(1, -1));
      else if (t.startsWith(strQuote)) text = t.slice(1, -1);
      else {
        for (const f of splitArgs(t)) { try { text += decode(fs.readFileSync(path.resolve(this.cwd, winPath(f)))) + '\n'; } catch { /* ない */ } }
      }
      const lines = text.replace(/\r\n?/g, '\n').split('\n').slice(o.skip);
      for (const line of lines) {
        if (!line || (o.eol && line.startsWith(o.eol))) continue;
        // 区切りで分けた位置 (tokens=* は、その位置から行の最後まで)
        const spans = [];
        if (!o.delims) spans.push([0, line.length]);
        else {
          let st = -1;
          for (let p = 0; p <= line.length; p++) {
            const isDelim = p === line.length || o.delims.includes(line[p]);
            if (!isDelim && st < 0) st = p;
            if (isDelim && st >= 0) { spans.push([st, p]); st = -1; }
          }
        }
        if (!spans.length) continue;
        const nums = o.tokens.filter((x) => x !== '*');
        const vals = [];
        for (const tk of o.tokens) {
          if (tk === '*') { const k = nums.length ? Math.max(...nums) : 0; vals.push(spans[k] ? line.slice(spans[k][0]) : ''); } else vals.push(spans[tk - 1] ? line.slice(spans[tk - 1][0], spans[tk - 1][1]) : '');
        }
        items.push(vals);
      }
    } else {
      for (const w of splitArgs(set.replace(/[,;]/g, ' '))) {
        if (/[*?]/.test(w)) {
          const found = this.glob(winPath(w));
          for (const f of found) {
            const isDir = (() => { try { return fs.statSync(path.resolve(this.cwd, f)).isDirectory(); } catch { return false; } })();
            if (node.flag === '/d' ? isDir : !isDir) items.push(f);
          }
        } else items.push(w);
      }
    }
    for (const it of items) {
      let src = node.bodySrc;
      const vals = Array.isArray(it) ? it : [it];
      vals.forEach((val, idx) => {
        const name = String.fromCharCode(v.charCodeAt(0) + idx);
        src = src.replace(new RegExp(`%(~[fdpnxsatz]*)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), (all, mods) => (mods ? this.argMod(mods.slice(1), val) : val));
      });
      this.runText(src.replace(/^\s+/, ''), batch);
    }
  }

  forOpts(s) {
    const o = { tokens: [1], delims: ' \t', skip: 0, eol: ';', usebackq: false };
    const m = (re) => { const x = re.exec(s); return x ? x[1] : null; };
    const tk = m(/tokens=([^\s]+)/i);
    if (tk) {
      o.tokens = [];
      for (const part of tk.split(',')) {
        if (part === '*') o.tokens.push('*');
        else if (part.endsWith('*')) { o.tokens.push(Number(part.slice(0, -1))); o.tokens.push('*'); } else if (part.includes('-')) { const [a, b] = part.split('-').map(Number); for (let x = a; x <= b; x++) o.tokens.push(x); } else o.tokens.push(Number(part));
      }
    }
    const dl = /delims=(.*?)(?=\s+(?:tokens|skip|eol|usebackq)=?|$)/i.exec(s);
    if (dl) o.delims = dl[1];
    const sk = m(/skip=(\d+)/i);
    if (sk) o.skip = Number(sk);
    const eol = /eol=(.)/i.exec(s);
    if (eol) o.eol = eol[1];
    if (/usebackq/i.test(s)) o.usebackq = true;
    return o;
  }

  // コマンドの出力を文字で受け取る (for /f の 'command')
  capture(command) {
    const r = spawnSync('node', [__filename, '/c', command], { cwd: this.cwd, env: this.env.object(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return r.stdout || '';
  }

  runPipe(stages, batch) {
    let input = null;
    for (let s = 0; s < stages.length; s++) {
      const last = s === stages.length - 1;
      const cmd = stages[s];
      if (cmd.type !== 'simple') { this.runCmd(cmd, batch); continue; }
      const io = { input, capture: !last };
      this.simple(cmd.raw, batch, io);
      input = io.output ?? '';
    }
  }

  // ----- ふつうのコマンド -----
  simple(raw0, batch, io = {}, silent = false) {
    let raw = this.expandDelayed(raw0);
    // リダイレクト (> >> < 2> 2>&1) を取り出す
    const redir = { out: null, err: null, in: null, append: false, errAppend: false, errToOut: false, outToErr: false };
    raw = this.takeRedirects(raw, redir);
    raw = raw.replace(/^[\s@]+/, '');
    if (!raw) return;
    if (this.echo && !silent) out(`${this.cwd}>${unescape(raw)}\n`);
    raw = raw.replace(/^(cd|chdir)(?=\.\.|[\\/])/i, '$1 ');
    const m = /^("[^"]*"|[^\s,;=(]+)([\s\S]*)$/.exec(raw);
    if (!m) return;
    let name = m[1].replace(/^"|"$/g, '');
    let rest = m[2];
    // echo. echo: echo( など
    const em = /^(echo)([.:(\\/+[\]])(.*)$/i.exec(raw);
    if (em) { name = 'echo'; rest = '\0' + em[3]; }
    const lower = name.toLowerCase();
    const fd = this.openRedirects(redir, io);
    try {
      const builtin = BUILTINS[lower];
      if (builtin) {
        const res = builtin.call(this, rest, batch, fd, io);
        this.errorlevel = typeof res === 'number' ? res : this.errorlevel;
      } else {
        this.errorlevel = this.external(name, rest, batch, fd, io);
      }
    } finally {
      for (const f of fd.close) { try { fs.closeSync(f); } catch { /* もう閉じた */ } }
    }
  }

  takeRedirects(raw, r) {
    let res = '';
    let q = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') { q = !q; res += c; continue; }
      if (c === '^' && !q) { res += c + (raw[i + 1] ?? ''); i++; continue; }
      if (q || (c !== '>' && c !== '<')) { res += c; continue; }
      // 直前の 1 / 2 (ストリームの番号)
      let stream = c === '<' ? 0 : 1;
      if (c === '>' && /[12]$/.test(res) && (res.length === 1 || /\s/.test(res[res.length - 2]))) { stream = Number(res[res.length - 1]); res = res.slice(0, -1); }
      let append = false;
      if (c === '>' && raw[i + 1] === '>') { append = true; i++; }
      if (raw[i + 1] === '&' && /[12]/.test(raw[i + 2] || '')) {
        const target = Number(raw[i + 2]);
        i += 2;
        if (stream === 2 && target === 1) r.errToOut = true;
        if (stream === 1 && target === 2) r.outToErr = true;
        continue;
      }
      while (raw[i + 1] === ' ' || raw[i + 1] === '\t') i++;
      let target = '';
      let tq = false;
      while (i + 1 < raw.length) {
        const d = raw[i + 1];
        if (d === '"') { tq = !tq; i++; continue; }
        if (!tq && /[\s<>&|]/.test(d)) break;
        target += d; i++;
      }
      if (stream === 0) r.in = target;
      else if (stream === 2) { r.err = target; r.errAppend = append; } else { r.out = target; r.append = append; }
    }
    return res;
  }

  openRedirects(r, io) {
    const fd = { out: 1, err: 2, in: 0, close: [] };
    const open = (target, flags) => {
      const p = winPath(target);
      const f = fs.openSync(p === '/dev/null' ? p : path.resolve(this.cwd, p), flags);
      fd.close.push(f);
      return f;
    };
    try {
      if (r.out) fd.out = open(r.out, r.append ? 'a' : 'w');
      if (r.err) fd.err = open(r.err, r.errAppend ? 'a' : 'w');
      if (r.in) fd.in = open(r.in, 'r');
    } catch (e) { err(`${e.message}\n`); }
    if (r.errToOut) fd.err = fd.out;
    if (r.outToErr) fd.out = fd.err;
    if (io.capture && !r.out) fd.out = 'capture';
    return fd;
  }

  write(fd, text, io) {
    if (fd.out === 'capture') { io.output = (io.output || '') + text; return; }
    try { fs.writeSync(fd.out, text); } catch { /* 出力先が閉じた */ }
  }

  // ----- 外部のコマンド -----
  external(name, rest, batch, fd, io, { wait = true } = {}) {
    const args = splitArgs(unescape(rest)).map((a) => winPath(a, this.cwd));
    let cmd = winPath(name.replace(/^"|"$/g, ''));
    const base = path.basename(cmd).toLowerCase();
    const noExt = base.replace(/\.(exe|cmd|bat|com)$/, '');
    // ファイルそのもの (start.bat / bot.exe / main.py)
    let file = null;
    if (/[\\/]/.test(cmd) || /\.\w+$/.test(cmd)) file = findCase(this.cwd, cmd);
    if (!file && !/[\\/]/.test(cmd) && !MAPPED[noExt]) {
      for (const ext of ['.bat', '.cmd', '.exe']) { const f = findCase(this.cwd, cmd + ext); if (f) { file = f; break; } }
    }
    if (file && fs.statSync(file).isFile()) {
      const ext = path.extname(file).toLowerCase();
      if (ext === '.bat' || ext === '.cmd') {
        // call なしで別のバッチを動かすと、元のバッチには戻りません
        const code = this.runFile(file, args);
        throw new ExitSignal(code, false);
      }
      const argv = launchFile(file, args);
      if (!argv) { err(`'${name}' を動かせません\n`); return 1; }
      return this.spawn(argv, fd, io, wait);
    }
    // Windows の仮想環境 (venv\Scripts\python.exe など) は、このサーバーの Python に置き換える
    // (ライブラリは BotHost が requirements.txt から入れるので、仮想環境は要りません)
    const venv = /(^|\/)(scripts|bin)\/(python|pythonw|python3|pip|pip3|activate|deactivate)(\.exe|\.bat)?$/i.exec(cmd);
    if (venv && !file) {
      const tool = venv[3].toLowerCase();
      if (tool === 'activate' || tool === 'deactivate') return 0;
      return this.spawn(MAPPED[tool.replace(/3$/, '')](args), fd, io, wait);
    }
    // python -m venv … (仮想環境を作る) は飛ばす
    if (/^python[3w]?$|^py$/.test(noExt) && args[0] === '-m' && /^(venv|virtualenv)$/.test(args[1] || '')) { out('(仮想環境は使わずに、BotHost が入れたライブラリで動かします)\n'); return 0; }
    let argv;
    if (MAPPED[noExt]) argv = MAPPED[noExt](args);
    else argv = [cmd, ...args];
    if (!argv) return 0;
    if (argv[0] === null) { err(`(${name} はここでは使えないので飛ばします)\n`); return 0; }
    return this.spawn(argv, fd, io, wait);
  }

  spawn(argv, fd, io, wait) {
    if (argv[0] === '__builtin_sleep') { sleepMs(Number(argv[1]) * 1000); return 0; }
    const env = this.env.object();
    if (!wait) {
      const child = spawn(argv[0], argv.slice(1), { cwd: this.cwd, env, stdio: ['inherit', fd.out === 'capture' ? 'inherit' : fd.out, fd.err] });
      child.on('error', (e) => err(`'${argv[0]}' を動かせません: ${e.code === 'ENOENT' ? '見つかりません' : e.message}\n`));
      this.background.push(child);
      return 0;
    }
    const capture = fd.out === 'capture';
    const r = spawnSync(argv[0], argv.slice(1), {
      cwd: this.cwd, env,
      stdio: [io.input != null ? 'pipe' : fd.in, capture ? 'pipe' : fd.out, fd.err],
      input: io.input != null ? io.input : undefined,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) {
      if (r.error.code === 'ENOENT') {
        err(`'${argv[0]}' は、内部コマンドまたは外部コマンドとして認識されていません。\n`);
        return 9009;
      }
      err(`${argv[0]}: ${r.error.message}\n`);
      return 1;
    }
    if (capture) io.output = (io.output || '') + (r.stdout ? r.stdout.toString('utf8') : '');
    if (r.signal) return 128 + (require('os').constants.signals[r.signal] || 0);
    return r.status ?? 0;
  }

  endlocal() {
    const s = this.locals.pop();
    if (!s) return;
    this.env = s.env;
    this.delayed = s.delayed;
  }
}

// ファイルを動かすコマンド (.exe → Wine / .NET、.py → python3 など)
function launchFile(file, args) {
  const launch = require('./launch');
  const dir = path.dirname(file);
  const r = launch.fileLaunch(dir, file, args, Number(process.env.BOTHOST_MEMORY_MB) || 256);
  if (r.problem) { err(`${r.problem}\n`); return null; }
  // resolve はファイルのフォルダーから見た名前を返すので、フルパスに (後ろの args はそのまま)
  const fixed = r.argv.length - args.length;
  const argv = r.argv.map((a, i) => (i > 0 && i < fixed && !a.startsWith('-') && fs.existsSync(path.join(dir, a)) ? path.join(dir, a) : a));
  if (argv[0].startsWith('./')) argv[0] = path.join(dir, argv[0].slice(2));
  return argv;
}

// Windows のコマンドを、ここで動くものに
const MAPPED = {
  python: (a) => ['python3', ...dropPyFlag(a)],
  python3: (a) => ['python3', ...a],
  py: (a) => ['python3', ...dropPyFlag(a)],
  pythonw: (a) => ['python3', ...dropPyFlag(a)],
  pip: (a) => pipArgs(a),
  pip3: (a) => pipArgs(a),
  node: (a) => ['node', ...a],
  npm: (a) => ['npm', ...a],
  npx: (a) => ['npx', ...a],
  yarn: (a) => ['yarn', ...a],
  pnpm: (a) => ['pnpm', ...a],
  java: (a) => ['java', ...a],
  javaw: (a) => ['java', ...a],
  dotnet: (a) => ['dotnet', ...a],
  // ping -n 6 127.0.0.1 > nul は「5 秒待つ」の書き方
  ping: (a) => {
    const i = a.findIndex((x) => /^[-/]n$/i.test(x));
    if (i >= 0 && /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i.test(a.find((x, k) => k !== i && k !== i + 1 && !x.startsWith('-') && !x.startsWith('/')) || '')) return ['__builtin_sleep', String(Math.max(0, Number(a[i + 1]) - 1))];
    return ['ping', ...a.map((x) => (/^\/n$/i.test(x) ? '-c' : x))];
  },
  choice: (a) => { const t = a.findIndex((x) => /^\/t$/i.test(x)); return t >= 0 ? ['__builtin_sleep', a[t + 1] || '0'] : ['__builtin_sleep', '0']; },
  powershell: () => [null], pwsh: () => [null], explorer: () => [null], notepad: () => [null], msg: () => [null],
  reg: () => [null], taskkill: () => [null], tasklist: () => [null], netsh: () => [null], schtasks: () => [null],
  wmic: () => [null], attrib: () => [null], icacls: () => [null], runas: () => [null], shutdown: () => [null], sc: () => [null],
  clip: () => [null], mshta: () => [null], cscript: () => [null], wscript: () => [null],
};

function dropPyFlag(a) { return /^-[23](\.\d+)?$/.test(a[0] || '') ? a.slice(1) : a; }

// pip install -r requirements.txt は、BotHost が起動の前に入れているので飛ばす
function pipArgs(a) {
  if ((a[0] || '').toLowerCase() === 'install' && /^-r$/i.test(a[1] || '') && /^requirements\.txt$/i.test(path.basename(a[2] || '')) && process.env.BOTHOST_DEPS_READY === '1' && a.length === 3) {
    out('(requirements.txt のライブラリは、もう入っているので飛ばします)\n');
    return null;
  }
  return ['python3', '-m', 'pip', ...a];
}

// ----- 組み込みのコマンド -----
const BUILTINS = {
  echo(rest, batch, fd, io) {
    if (rest.startsWith('\0')) { this.write(fd, unescape(rest.slice(1)) + '\n', io); return 0; }
    const t = rest.replace(/^\s/, '');
    if (/^\s*off\s*$/i.test(t)) { this.echo = false; return 0; }
    if (/^\s*on\s*$/i.test(t)) { this.echo = true; return 0; }
    if (!t.trim()) { this.write(fd, `ECHO は ${this.echo ? '<ON>' : '<OFF>'} です。\n`, io); return 0; }
    this.write(fd, unescape(t) + '\n', io);
    return 0;
  },
  set(rest, batch, fd, io) {
    let t = rest.replace(/^\s+/, '');
    const a = /^\/a\s*/i.exec(t);
    if (a) {
      const expr = unescape(t.slice(a[0].length)).replace(/^"|"$/g, '');
      try { arith(expr, this); } catch (e) { err(`${e.message}\n`); return 1; }
      return 0;
    }
    const p = /^\/p\s*/i.exec(t);
    if (p) {
      t = t.slice(p[0].length);
      const s = unescape(t).replace(/^"(.*)"$/s, '$1');
      const eq = s.indexOf('=');
      if (eq < 0) return 1;
      out(s.slice(eq + 1));
      const line = readLine();
      if (line === null) return 1;
      this.env.set(s.slice(0, eq), line);
      return 0;
    }
    let s = unescape(t);
    if (s.startsWith('"')) { const end = s.lastIndexOf('"'); s = s.slice(1, end > 0 ? end : undefined); }
    const eq = s.indexOf('=');
    if (eq < 0) {
      const prefix = s.trim().toLowerCase();
      const list = this.env.entries().filter(([k]) => k.toLowerCase().startsWith(prefix));
      for (const [k, v] of list) this.write(fd, `${k}=${v}\n`, io);
      return list.length ? 0 : 1;
    }
    const name = s.slice(0, eq);
    let val = s.slice(eq + 1);
    if (name.toUpperCase() === 'PATH') val = fixPath(val, this.env.get('PATH'));
    this.env.set(name, val);
    return 0;
  },
  setlocal(rest) {
    this.locals.push({ env: this.env.clone(), delayed: this.delayed });
    if (/enabledelayedexpansion/i.test(rest)) this.delayed = true;
    if (/disabledelayedexpansion/i.test(rest)) this.delayed = false;
    return 0;
  },
  endlocal() { this.endlocal(); return 0; },
  cd(rest, batch, fd, io) {
    let t = unescape(rest).trim().replace(/^\/d\s*/i, '').replace(/^"|"$/g, '');
    if (!t) { this.write(fd, this.cwd + '\n', io); return 0; }
    t = winPath(t);
    const p = findCase(this.cwd, t);
    if (!p || !fs.statSync(p).isDirectory()) { err('指定されたパスが見つかりません。\n'); return 1; }
    this.cwd = p;
    return 0;
  },
  pushd(rest) {
    const t = winPath(unescape(rest).trim().replace(/^"|"$/g, ''));
    this.dirs.push(this.cwd);
    if (!t) return 0;
    const p = findCase(this.cwd, t);
    if (!p) { this.dirs.pop(); err('指定されたパスが見つかりません。\n'); return 1; }
    this.cwd = p;
    return 0;
  },
  popd() { if (this.dirs.length) this.cwd = this.dirs.pop(); return 0; },
  goto(rest) {
    const l = unescape(rest).trim().replace(/^:/, '').split(/\s/)[0].toLowerCase();
    throw new GotoSignal(l);
  },
  call(rest, batch) {
    const t = rest.trim();
    if (t.startsWith(':')) {
      const parts = splitArgs(unescape(t));
      const label = parts[0].slice(1).toLowerCase();
      if (!batch || !batch.file) return 1;
      const text = decode(fs.readFileSync(batch.file));
      const sub = new Batch(batch.file, parts.slice(1));
      return this.runStmts(splitStatements(text), sub, label);
    }
    const m = /^("[^"]*"|\S+)([\s\S]*)$/.exec(t);
    if (!m) return 0;
    const name = winPath(m[1].replace(/^"|"$/g, ''));
    if (/(^|\/)(scripts|bin)\/(activate|deactivate)(\.bat)?$/i.test(name)) return 0; // 仮想環境は使わない
    const file = findCase(this.cwd, name) || findCase(this.cwd, name + '.bat') || findCase(this.cwd, name + '.cmd');
    if (file && /\.(bat|cmd)$/i.test(file)) return this.runFile(file, splitArgs(unescape(m[2])).map((a) => winPath(a)));
    this.simple(t, batch);
    return this.errorlevel;
  },
  exit(rest) {
    const parts = splitBuiltin(unescape(rest));
    const b = parts[0] && parts[0].toLowerCase() === '/b';
    const code = Number((b ? parts[1] : parts[0]) ?? this.errorlevel) || 0;
    throw new ExitSignal(code, !b);
  },
  shift(rest, batch) { if (batch) batch.args.shift(); return 0; },
  title() { return 0; },
  cls() { return 0; },
  color() { return 0; },
  chcp() { return 0; },
  mode() { return 0; },
  prompt() { return 0; },
  verify() { return 0; },
  break() { return 0; },
  ver(rest, batch, fd, io) { this.write(fd, '\nMicrosoft Windows [Version 10.0 (BotHost)]\n', io); return 0; },
  // pause: 画面がないので待たずに進みます
  pause() { return 0; },
  timeout(rest) {
    const a = splitBuiltin(unescape(rest));
    const i = a.findIndex((x) => /^\/t$/i.test(x));
    const n = Number(i >= 0 ? a[i + 1] : a.find((x) => /^-?\d+$/.test(x)));
    if (n > 0) sleepMs(n * 1000);
    return 0;
  },
  start(rest, batch, fd, io) {
    // start "タイトル" [/b] [/wait] [/min] [/d フォルダー] コマンド
    let t = unescape(rest).trim();
    if (t.startsWith('"')) { const e = t.indexOf('"', 1); t = t.slice(e + 1).trim(); }
    let wait = false;
    let dir = null;
    for (;;) {
      const m = /^\/(\w+)\s*/.exec(t);
      if (!m) break;
      const f = m[1].toLowerCase();
      t = t.slice(m[0].length);
      if (f === 'wait') wait = true;
      if (f === 'd') { const d = /^("[^"]*"|\S+)\s*/.exec(t); dir = d[1].replace(/^"|"$/g, ''); t = t.slice(d[0].length); }
    }
    if (!t) return 0;
    const m = /^("[^"]*"|\S+)([\s\S]*)$/.exec(t);
    const saved = this.cwd;
    if (dir) { const p = findCase(this.cwd, winPath(dir)); if (p) this.cwd = p; }
    try {
      const name = m[1].replace(/^"|"$/g, '');
      if (/^https?:/.test(name)) return 0;
      const file = findCase(this.cwd, winPath(name));
      if (file && /\.(bat|cmd)$/i.test(file)) return this.spawn(['node', __filename, file, ...splitArgs(m[2]).map((a) => winPath(a))], fd, io, wait);
      return this.external(name, m[2], batch, fd, io, { wait });
    } finally { this.cwd = saved; }
  },
  md(rest) {
    for (const d of splitBuiltin(unescape(rest))) { try { fs.mkdirSync(path.resolve(this.cwd, winPath(d)), { recursive: true }); } catch (e) { err(`${e.message}\n`); return 1; } }
    return 0;
  },
  rd(rest) {
    const a = splitBuiltin(unescape(rest));
    const recursive = a.some((x) => /^\/s$/i.test(x));
    for (const d of a.filter((x) => !x.startsWith('/'))) {
      try { fs.rmSync(path.resolve(this.cwd, winPath(d)), { recursive, force: false }); } catch (e) { if (e.code !== 'ENOENT') { err(`${e.message}\n`); return 1; } }
    }
    return 0;
  },
  del(rest) {
    const a = splitBuiltin(unescape(rest)).filter((x) => !x.startsWith('/'));
    for (const p of a) {
      const q = winPath(p);
      const list = /[*?]/.test(q) ? this.glob(q) : [q];
      for (const f of list) { try { const full = path.resolve(this.cwd, f); if (fs.statSync(full).isFile()) fs.rmSync(full); } catch { /* ない */ } }
    }
    return 0;
  },
  copy(rest) {
    const a = splitBuiltin(unescape(rest)).filter((x) => !x.startsWith('/'));
    if (a.length < 2) return 1;
    const dest = path.resolve(this.cwd, winPath(a[a.length - 1]));
    for (const src of a.slice(0, -1)) {
      const list = /[*?]/.test(src) ? this.glob(winPath(src)) : [winPath(src)];
      for (const f of list) {
        try {
          const from = path.resolve(this.cwd, f);
          const to = fs.existsSync(dest) && fs.statSync(dest).isDirectory() ? path.join(dest, path.basename(from)) : dest;
          fs.cpSync(from, to, { recursive: true });
        } catch (e) { err(`${e.message}\n`); return 1; }
      }
    }
    return 0;
  },
  xcopy(rest) { return BUILTINS.copy.call(this, rest); },
  robocopy(rest) { return BUILTINS.copy.call(this, rest); },
  move(rest) {
    const a = splitBuiltin(unescape(rest)).filter((x) => !x.startsWith('/'));
    if (a.length < 2) return 1;
    const from = path.resolve(this.cwd, winPath(a[0]));
    let to = path.resolve(this.cwd, winPath(a[1]));
    try {
      if (fs.existsSync(to) && fs.statSync(to).isDirectory()) to = path.join(to, path.basename(from));
      fs.renameSync(from, to);
    } catch (e) { err(`${e.message}\n`); return 1; }
    return 0;
  },
  ren(rest) {
    const a = splitBuiltin(unescape(rest));
    if (a.length < 2) return 1;
    const from = path.resolve(this.cwd, winPath(a[0]));
    try { fs.renameSync(from, path.join(path.dirname(from), a[1])); } catch (e) { err(`${e.message}\n`); return 1; }
    return 0;
  },
  type(rest, batch, fd, io) {
    for (const f of splitBuiltin(unescape(rest))) {
      try { this.write(fd, decode(fs.readFileSync(path.resolve(this.cwd, winPath(f)))), io); } catch { err('指定されたファイルが見つかりません。\n'); return 1; }
    }
    return 0;
  },
  dir(rest, batch, fd, io) {
    const a = splitBuiltin(unescape(rest));
    const bare = a.some((x) => /^\/b$/i.test(x));
    const target = a.find((x) => !x.startsWith('/')) || '.';
    const q = winPath(target);
    const list = /[*?]/.test(q) ? this.glob(q) : (() => { try { return fs.readdirSync(path.resolve(this.cwd, q)).sort(); } catch { return []; } })();
    if (!list.length) { err('ファイルが見つかりません\n'); return 1; }
    for (const n of list) this.write(fd, (bare ? path.basename(n) : `  ${path.basename(n)}`) + '\n', io);
    return 0;
  },
  where(rest, batch, fd, io) {
    const a = splitBuiltin(unescape(rest));
    let found = false;
    for (const n of a) {
      const r = spawnSync('sh', ['-c', 'command -v "$1"', 'sh', MAPPED[n.toLowerCase()] ? (MAPPED[n.toLowerCase()]([])[0] || n) : n], { encoding: 'utf8', env: this.env.object() });
      if (r.status === 0 && r.stdout.trim()) { this.write(fd, r.stdout, io); found = true; }
    }
    return found ? 0 : 1;
  },
  path(rest, batch, fd, io) {
    const t = unescape(rest).replace(/^\s*=?\s*/, '');
    if (!t) { this.write(fd, `PATH=${this.env.get('PATH') || ''}\n`, io); return 0; }
    this.env.set('PATH', fixPath(t, this.env.get('PATH')));
    return 0;
  },
  find(rest, batch, fd, io) {
    const a = splitArgs(unescape(rest));
    const ci = a.some((x) => /^\/i$/i.test(x));
    const neg = a.some((x) => /^\/v$/i.test(x));
    const word = (a.find((x) => !x.startsWith('/')) || '').replace(/^"|"$/g, '');
    const text = io.input != null ? String(io.input) : '';
    const lines = text.split(/\r?\n/).filter((l) => l !== '');
    const hit = lines.filter((l) => (ci ? l.toLowerCase().includes(word.toLowerCase()) : l.includes(word)) !== neg);
    for (const l of hit) this.write(fd, l + '\n', io);
    return hit.length ? 0 : 1;
  },
  cmd(rest, batch, fd, io) {
    const m = /^\s*\/[ckCK]\s*([\s\S]*)$/.exec(rest);
    if (!m) return 0;
    const t = m[1].replace(/^"([\s\S]*)"$/, '$1');
    const r = spawnSync('node', [__filename, '/c', t], { cwd: this.cwd, env: this.env.object(), stdio: ['inherit', fd.out === 'capture' ? 'pipe' : fd.out, fd.err] });
    if (fd.out === 'capture') io.output = (io.output || '') + (r.stdout ? r.stdout.toString() : '');
    return r.status ?? 1;
  },
};
BUILTINS.chdir = BUILTINS.cd;
BUILTINS.mkdir = BUILTINS.md;
BUILTINS.rmdir = BUILTINS.rd;
BUILTINS.erase = BUILTINS.del;
BUILTINS.rename = BUILTINS.ren;
BUILTINS.findstr = BUILTINS.find;

// set PATH=%PATH%;C:\foo → Linux の PATH を残す
function fixPath(val, old) {
  if (!val.includes(';')) return val;
  const parts = val.split(';').filter(Boolean).map((p) => p.replace(/\\/g, '/'));
  const keep = parts.filter((p) => p.startsWith('/') || p === old);
  const set = new Set();
  for (const p of keep.join(':').split(':')) if (p) set.add(p);
  return [...set].join(':') || old;
}

// set /a の計算
function arith(expr, interp) {
  let result = 0;
  for (const part of splitTopLevel(expr, ',')) {
    const m = /^\s*([A-Za-z_][\w.]*)\s*([-+*/%&|^]|<<|>>)?=(?!=)\s*([\s\S]*)$/.exec(part);
    if (m) {
      const cur = Number(interp.env.get(m[1])) || 0;
      let v = evalExpr(m[3], interp);
      if (m[2]) v = applyOp(m[2], cur, v);
      v = Math.trunc(v) | 0;
      interp.env.set(m[1], String(v));
      result = v;
    } else result = evalExpr(part, interp);
  }
  return result;
}
function splitTopLevel(s, sep) {
  const out = [];
  let d = 0;
  let cur = '';
  for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (c === sep && d === 0) { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur);
  return out;
}
function applyOp(op, a, b) {
  switch (op) {
    case '+': return a + b; case '-': return a - b; case '*': return a * b;
    case '/': if (b === 0) throw new Error('0 で割ろうとしました。'); return Math.trunc(a / b);
    case '%': if (b === 0) throw new Error('0 で割ろうとしました。'); return a % b;
    case '&': return a & b; case '|': return a | b; case '^': return a ^ b; case '<<': return a << b; case '>>': return a >> b;
    default: return b;
  }
}
function evalExpr(src, interp) {
  const toks = src.match(/0x[0-9a-f]+|\d+|[A-Za-z_][\w.]*|<<|>>|[-+*/%()&|^!~]/gi) || [];
  let i = 0;
  const prec = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  const unary = () => {
    const t = toks[i++];
    if (t === '(') { const v = bin(0); i++; return v; }
    if (t === '-') return -unary();
    if (t === '+') return unary();
    if (t === '!') return unary() ? 0 : 1;
    if (t === '~') return ~unary();
    if (t === undefined) return 0;
    if (/^0x/i.test(t)) return parseInt(t, 16);
    if (/^0\d+$/.test(t)) return parseInt(t, 8);
    if (/^\d+$/.test(t)) return Number(t);
    return Number(interp.env.get(t)) || 0;
  };
  const bin = (min) => {
    let left = unary();
    while (i < toks.length && prec[toks[i]] !== undefined && prec[toks[i]] > min) {
      const op = toks[i++];
      const right = bin(prec[op]);
      left = applyOp(op, left, right);
    }
    return left;
  };
  return Math.trunc(bin(0)) | 0;
}

// ----- 入口 -----
function main(argv) {
  const it = new Interp();
  let code = 0;
  try {
    if (argv[0] && /^\/[ck]$/i.test(argv[0])) {
      it.echo = false;
      it.runText(it.expand(argv.slice(1).join(' '), null), null);
      code = it.errorlevel;
    } else if (argv[0]) {
      const file = findCase(process.cwd(), winPath(argv[0]));
      if (!file) { err(`${argv[0]} が見つかりません\n`); return 1; }
      code = it.runFile(file, argv.slice(1));
    } else {
      err('使い方: cmd.js ファイル.bat [引数…]\n');
      return 1;
    }
  } catch (e) {
    if (e instanceof ExitSignal) code = e.code;
    else if (e instanceof GotoSignal) code = it.errorlevel;
    else { err(`バッチの実行でエラー: ${e.message}\n`); code = 1; }
  }
  // start で裏で動かしたもの (bot など) が終わるまで待つ
  const alive = it.background.filter((c) => c.exitCode === null && c.signalCode === null);
  if (alive.length) {
    let left = alive.length;
    for (const c of alive) {
      c.on('exit', (cc) => {
        if (--left === 0) process.exit(cc ?? code);
      });
    }
    return undefined;
  }
  return code;
}

if (require.main === module) {
  const code = main(process.argv.slice(2));
  if (code !== undefined) process.exitCode = code;
}

module.exports = { main, Interp, Parser, splitStatements, decode, winPath, arith };

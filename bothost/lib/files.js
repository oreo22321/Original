'use strict';
// bot のフォルダーの中のファイル操作。フォルダーの外 (../ やシンボリックリンクの先) には触れません。
const fs = require('fs');
const path = require('path');

const HIDDEN_DIRS = new Set(['.deps', 'node_modules', '__pycache__', '.git', '.npm', '.cache']);
const MAX_LIST = 2000;

class PathError extends Error {}

function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new PathError('ファイル名が正しくありません');
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = path.resolve(root, clean);
  if (full !== root && !full.startsWith(root + path.sep)) throw new PathError('フォルダーの外は指定できません');
  if (full === root) throw new PathError('ファイル名が正しくありません');
  // シンボリックリンクをたどった先も中にあるか (いちばん近い、実在する親で確かめる)
  const realRoot = fs.realpathSync(root);
  let probe = full;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new PathError('フォルダーの外は指定できません');
  if (fs.existsSync(full) && fs.lstatSync(full).isSymbolicLink()) throw new PathError('シンボリックリンクは扱えません');
  return full;
}

function list(root) {
  const out = [];
  const hidden = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_LIST) return;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (HIDDEN_DIRS.has(e.name)) { hidden.push(rel); continue; }
        walk(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        const st = fs.statSync(path.join(dir, e.name));
        out.push({ path: rel, size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  walk(root, '');
  return { files: out, hidden, truncated: out.length >= MAX_LIST };
}

function read(root, rel) {
  const full = resolveInside(root, rel);
  return fs.readFileSync(full);
}

function write(root, rel, buf) {
  const full = resolveInside(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
}

function remove(root, rel) {
  const full = resolveInside(root, rel);
  fs.rmSync(full, { recursive: true, force: true });
}

function rename(root, from, to) {
  const a = resolveInside(root, from);
  const b = resolveInside(root, to);
  if (fs.existsSync(b)) throw new PathError('その名前のファイルはもうあります');
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.renameSync(a, b);
}

function copyTemplate(templateDir, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (!templateDir || !fs.existsSync(templateDir)) return;
  fs.cpSync(templateDir, dest, { recursive: true });
}

function dirSize(root) {
  let total = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { try { total += fs.statSync(p).size; } catch { /* 消えた */ } }
    }
  };
  walk(root);
  return total;
}

// ZIP 用: ライブラリのフォルダーを除いた全部のファイル
function collect(root, maxFile = 20 * 1024 * 1024) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!HIDDEN_DIRS.has(e.name)) walk(full, rel); continue; }
      if (!e.isFile()) continue;
      const st = fs.statSync(full);
      if (st.size > maxFile) continue;
      out.push({ name: rel, data: fs.readFileSync(full), mtime: st.mtime });
    }
  };
  walk(root, '');
  return out;
}

// ZIP の中身を入れる。全部が 1 つのフォルダーに入っているなら、そのフォルダーは外します
function importEntries(root, entries, { replace = false } = {}) {
  const files = entries.filter((e) => !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.name));
  const tops = new Set(files.map((e) => e.name.split('/')[0]));
  const strip = tops.size === 1 && files.every((e) => e.name.includes('/')) ? [...tops][0] + '/' : '';
  // 先に全部の名前を確かめてから書く (途中までだけ入るのを防ぐ)
  const plan = files.map((e) => {
    const rel = strip ? e.name.slice(strip.length) : e.name;
    const parts = rel.split('/');
    if (parts.some((p) => HIDDEN_DIRS.has(p))) return null;
    return { rel, data: e.data, full: resolveInside(root, rel) };
  }).filter(Boolean);
  if (replace) {
    for (const name of fs.readdirSync(root)) {
      if (HIDDEN_DIRS.has(name)) continue;
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  }
  for (const f of plan) {
    fs.mkdirSync(path.dirname(f.full), { recursive: true });
    fs.writeFileSync(f.full, f.data);
  }
  return plan.length;
}

module.exports = {
  list, read, write, remove, rename, copyTemplate, dirSize, resolveInside, collect, importEntries, PathError, HIDDEN_DIRS,
};

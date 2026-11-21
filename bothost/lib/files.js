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

module.exports = { list, read, write, remove, rename, copyTemplate, dirSize, resolveInside, PathError };

'use strict';
// bot のフォルダーの中のファイル操作。フォルダーの外 (../ やシンボリックリンクの先) には触れません。
const fs = require('fs');
const path = require('path');

// ライブラリや、起動のたびに作り直せるもの (一覧・バックアップ・ZIP に入れない)
const HIDDEN_DIRS = new Set(['.deps', 'node_modules', '__pycache__', '.git', '.npm', '.cache', '.wine', '.local', '.gems', '.bundle', '.npm-global', '.dotnet', '.nuget', '.pnpm-store', '.fontconfig', '.java', '.pki']);
// 容量の計算に入れないもの (Windows の環境は、どの bot でも同じものを作るので)
const NOT_COUNTED = new Set(['.wine']);
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

// 送られてきたデータを、そのままファイルに書く (大きなファイルもメモリに全部載せない)
async function writeStream(root, rel, stream, limit) {
  const full = resolveInside(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = `${full}.uploading-${process.pid}-${Date.now()}`;
  const out = fs.createWriteStream(tmp, { flags: 'wx' });
  let size = 0;
  let tooBig = false;
  try {
    await new Promise((resolve, reject) => {
      const tooBigError = () => { const e = new PathError(`ファイルが大きすぎます (${Math.round(limit / 1048576)} MB まで)`); e.status = 413; return e; };
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (tooBig) {
          // 残りは読み捨てる (途中で切ると、相手に「大きすぎる」と返せない)。あまりに大きければ切る
          if (size > limit + 64 * 1048576) { stream.destroy(); reject(tooBigError()); }
          return;
        }
        if (size > limit) { tooBig = true; return; }
        if (!out.write(chunk)) { stream.pause(); out.once('drain', () => stream.resume()); }
      });
      stream.on('end', () => { if (tooBig) reject(tooBigError()); else out.end(resolve); });
      stream.on('error', reject);
      stream.on('aborted', () => reject(new PathError('送信が途中で切れました')));
      out.on('error', reject);
    });
    fs.renameSync(tmp, full);
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return { full, size };
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
      if (e.isDirectory()) { if (!NOT_COUNTED.has(e.name)) walk(p); }
      else if (e.isFile()) { try { total += fs.statSync(p).size; } catch { /* 消えた */ } }
    }
  };
  walk(root);
  return total;
}

// ZIP 用: ライブラリのフォルダーを除いた全部のファイル (中身は読まずに、場所だけ)
function collect(root) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!HIDDEN_DIRS.has(e.name)) walk(full, rel); continue; }
      if (!e.isFile() || /\.uploading-\d+-\d+$/.test(e.name)) continue;
      const st = fs.statSync(full);
      out.push({ name: rel, file: full, mtime: st.mtime, size: st.size, executable: (st.mode & 0o111) !== 0 });
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
    return { rel, entry: e, full: resolveInside(root, rel) };
  }).filter(Boolean);
  if (replace) {
    for (const name of fs.readdirSync(root)) {
      if (HIDDEN_DIRS.has(name)) continue;
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  }
  for (const f of plan) {
    fs.mkdirSync(path.dirname(f.full), { recursive: true });
    // 中身は 1 つずつ取り出す (大きな ZIP でもメモリを使いすぎないように)
    fs.writeFileSync(f.full, f.entry.data || f.entry.read());
    if (f.entry.executable) { try { fs.chmodSync(f.full, 0o755); } catch { /* なくてもよい */ } }
  }
  return plan.length;
}

module.exports = {
  list, read, write, writeStream, remove, rename, copyTemplate, dirSize, resolveInside, collect, importEntries, PathError, HIDDEN_DIRS,
};

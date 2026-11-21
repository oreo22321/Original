'use strict';
// 使う bot があるときだけ入れる道具 (イメージを小さくするため)。
//   ffmpeg … 音楽 bot (discord.py の FFmpegPCMAudio、yt-dlp など)。PyPI の imageio-ffmpeg の中のものを使う
//   bun    … Bun で書かれた bot。npm の @oven/bun-linux-x64-baseline を使う
// どちらも、決まった版を、決まったハッシュ (sha256 / sha512) と一致したときだけ使います (中身のすり替えを防ぐ)。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');

const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const TOOLS = {
  ffmpeg: {
    label: 'ffmpeg (音声・動画)',
    sizeMB: 68,
    file: {
      x64: { url: 'https://files.pythonhosted.org/packages/de/0f/49292fbef69ee10ebcf97bb741602521caafcc6966d5fa1a2b868cc15655/imageio_ffmpeg-0.8.1-py3-none-manylinux_2_28_x86_64.whl', sha256: '050d6850601c3b3890bd2b28306f3b842b3daea390a561101174375a1c460bda' },
      arm64: { url: 'https://files.pythonhosted.org/packages/53/02/e139e53a71f33f728cb2ce6c1124edc29e4c008427923f01a4d37f9a1867/imageio_ffmpeg-0.8.1-py3-none-manylinux_2_28_aarch64.whl', sha256: 'fad3176f859b25869e60a8ed79957d4e3ed74a97a95e5f0cdcb91455f6c6d00e' },
    },
    // wheel (ZIP) の中の ffmpeg を取り出す
    extract: async (archive, dir) => {
      await run('unzip', ['-o', '-j', archive, 'imageio_ffmpeg/binaries/ffmpeg-linux*', '-d', dir]);
      const name = fs.readdirSync(dir).find((n) => n.startsWith('ffmpeg-linux'));
      if (!name) throw new Error('ffmpeg が見つかりませんでした');
      fs.renameSync(path.join(dir, name), path.join(dir, 'ffmpeg'));
      return { ffmpeg: path.join(dir, 'ffmpeg') };
    },
  },
  bun: {
    label: 'Bun',
    sizeMB: 40,
    file: {
      x64: { url: 'https://registry.npmjs.org/@oven/bun-linux-x64-baseline/-/bun-linux-x64-baseline-1.4.5.tgz', sha512: 's8yMwYcFnnrA178gji0gZbkE2WVDej/Ti1x770oPfihxyRxSMNhGhiAQNXV53aDeraZxksdvKV/RAdQBCd0qPA==' },
    },
    extract: async (archive, dir) => {
      await run('tar', ['-xzf', archive, '-C', dir, '--strip-components=2', 'package/bin/bun']);
      return { bun: path.join(dir, 'bun'), bunx: path.join(dir, 'bun') };
    },
  },
};

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 300e3, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.message = `${err.message}\n${stderr || ''}`.trim(); reject(err); } else resolve(stdout);
    });
  });
}

class Tools {
  constructor(dir) {
    this.dir = dir;
    this.bin = path.join(dir, 'bin');
    this.busy = new Map();
    fs.mkdirSync(this.bin, { recursive: true });
    try { fs.chmodSync(dir, 0o755); fs.chmodSync(this.bin, 0o755); } catch { /* なくてもよい */ }
  }

  has(name) { return fs.existsSync(path.join(this.bin, name)); }
  available(name) { return !!TOOLS[name] && !!TOOLS[name].file[ARCH]; }

  // 入っていなければ入れる (同時に頼まれても 1 回だけ)
  ensure(name, log = () => {}) {
    if (this.has(name)) return Promise.resolve(true);
    const tool = TOOLS[name];
    if (!tool || !tool.file[ARCH]) return Promise.reject(new Error(`${name} はこのサーバーでは使えません`));
    if (this.busy.has(name)) return this.busy.get(name);
    const p = (async () => {
      log(`${tool.label} を準備しています (初回だけ・約 ${tool.sizeMB} MB)…`);
      const started = Date.now();
      const work = fs.mkdtempSync(path.join(this.dir, `.${name}-`));
      try {
        const archive = path.join(work, 'download');
        await download(tool.file[ARCH], archive);
        const out = path.join(work, 'out');
        fs.mkdirSync(out);
        const bins = await tool.extract(archive, out);
        const dest = path.join(this.dir, name);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(out, dest);
        for (const [bin, file] of Object.entries(bins)) {
          const target = path.join(dest, path.relative(out, file));
          fs.chmodSync(target, 0o755);
          const link = path.join(this.bin, bin);
          fs.rmSync(link, { force: true });
          fs.symlinkSync(target, link);
        }
        try { fs.chmodSync(dest, 0o755); } catch { /* なくてもよい */ }
        log(`${tool.label} の準備ができました (${Math.round((Date.now() - started) / 100) / 10} 秒)。`);
        return true;
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
        this.busy.delete(name);
      }
    })();
    this.busy.set(name, p);
    return p;
  }
}

// ダウンロードしながらハッシュを計算して、合わなければ捨てる (メモリには全部を載せない)
async function download(file, dest) {
  const res = await fetch(file.url, { signal: AbortSignal.timeout(10 * 60e3) });
  if (!res.ok || !res.body) throw new Error(`ダウンロードできませんでした (${res.status})`);
  const algo = file.sha256 ? 'sha256' : 'sha512';
  const hash = crypto.createHash(algo);
  const tap = new Transform({ transform(chunk, enc, cb) { hash.update(chunk); cb(null, chunk); } });
  await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(dest));
  const got = file.sha256 ? hash.digest('hex') : hash.digest('base64');
  const want = file.sha256 || file.sha512.replace(/^sha512-/, '');
  if (got !== want) throw new Error('ダウンロードしたファイルが正しくありません (ハッシュが違います)');
}

// bot のファイルに ffmpeg を使いそうなものがあるか (音楽 bot など)
const FFMPEG_HINT = /ffmpeg|FFmpegPCMAudio|FFmpegOpusAudio|yt[-_]dlp|youtube[-_]dl|pytube|wavelink|@discordjs\/voice|discord-player|distube|play-dl|ytdl-core|prism-media|fluent-ffmpeg/i;
const SCAN_EXT = /\.(py|js|mjs|cjs|ts|txt|json|toml|rb|bat|cmd|sh|cs|java|go)$/i;
const SKIP_DIRS = new Set(['.deps', 'node_modules', '.git', '.wine', '.cache', '.npm', '.local', '.gems', 'vendor', '__pycache__', '.npm-global']);
function needsFfmpeg(dir) {
  // ffmpeg を自分で持っている (ffmpeg-static など) なら要らない
  let budget = 400;
  let found = false;
  let bundled = false;
  const walk = (d, depth) => {
    if (found || depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found || --budget < 0) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1); continue; }
      if (!e.isFile() || !SCAN_EXT.test(e.name)) continue;
      let text;
      try { if (fs.statSync(full).size > 512 * 1024) continue; text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (e.name === 'package.json' && /"ffmpeg-static"|"@ffmpeg-installer\//.test(text)) { bundled = true; found = true; return; }
      if (FFMPEG_HINT.test(text)) found = true;
    }
  };
  walk(dir, 0);
  return found && !bundled;
}

module.exports = { Tools, TOOLS, needsFfmpeg };

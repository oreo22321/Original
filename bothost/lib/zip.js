'use strict';
// 小さな ZIP の読み書き (外部ライブラリなし)。ZIP64 には対応していません。
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// entries: [{ name, data: Buffer, mtime?: Date }]
function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const deflated = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const crc = crc32(raw);
    const { time, date } = dosTime(e.mtime || new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 の名前
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // UNIX
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

class ZipError extends Error {}

// ファイル名: UTF-8 の印がなければ、UTF-8 → Shift_JIS (日本語の Windows で作った ZIP) の順に試す
function decodeName(raw, flags, extra) {
  // Info-ZIP の Unicode の名前 (0x7075) があれば、それを使う
  for (let i = 0; i + 4 <= extra.length;) {
    const id = extra.readUInt16LE(i);
    const len = extra.readUInt16LE(i + 2);
    if (id === 0x7075 && len > 5 && extra[i + 4] === 1) return extra.slice(i + 9, i + 4 + len).toString('utf8');
    i += 4 + len;
  }
  if (flags & 0x0800) return raw.toString('utf8');
  if (raw.every((b) => b < 0x80)) return raw.toString('latin1');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { /* UTF-8 ではない */ }
  try { return new TextDecoder('shift_jis', { fatal: true }).decode(raw); } catch { /* Shift_JIS でもない */ }
  return raw.toString('latin1');
}

// ZIP の目次を読む。read(start, len) で、ZIP のその場所のバイトを返す関数を渡す
function readDirectory(size, read, { maxTotal, maxEntries }) {
  const tailLen = Math.min(size, 22 + 65535);
  const tail = read(size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('ZIP ファイルではありません');
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOff = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new ZipError('大きすぎる ZIP (ZIP64) には対応していません');
  if (count > maxEntries) throw new ZipError(`ファイルが多すぎます (${maxEntries} 個まで)`);
  if (cdOff + cdSize > size) throw new ZipError('ZIP が壊れています');
  const cd = read(cdOff, cdSize);
  const out = [];
  let total = 0;
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new ZipError('ZIP が壊れています');
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const csize = cd.readUInt32LE(p + 20);
    const usize = cd.readUInt32LE(p + 24);
    const nlen = cd.readUInt16LE(p + 28);
    const xlen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    const attr = cd.readUInt32LE(p + 38);
    const lho = cd.readUInt32LE(p + 42);
    const name = decodeName(cd.slice(p + 46, p + 46 + nlen), flags, cd.slice(p + 46 + nlen, p + 46 + nlen + xlen)).replace(/\\/g, '/');
    p += 46 + nlen + xlen + clen;
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ZipError('大きすぎる ZIP (ZIP64) には対応していません');
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new ZipError('パスワード付きの ZIP には対応していません');
    if (method !== 0 && method !== 8) throw new ZipError(`対応していない圧縮方式です (${method})`);
    total += usize;
    if (total > maxTotal) throw new ZipError('展開すると大きすぎます');
    const executable = ((attr >>> 16) & 0o111) !== 0;
    out.push({
      name, size: usize, executable,
      read: () => {
        const head = read(lho, 30);
        if (head.readUInt32LE(0) !== 0x04034b50) throw new ZipError('ZIP が壊れています');
        const start = lho + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
        const comp = read(start, csize);
        if (method === 0) return comp;
        return zlib.inflateRawSync(comp, { maxOutputLength: Math.max(usize, 1) });
      },
    });
  }
  return out;
}

// → [{ name, data }] (フォルダーの項目は飛ばします)
function readZip(buf, { maxTotal = 100 * 1024 * 1024, maxEntries = 5000 } = {}) {
  const entries = readDirectory(buf.length, (start, len) => {
    if (start < 0 || start + len > buf.length) throw new ZipError('ZIP が壊れています');
    return buf.subarray(start, start + len);
  }, { maxTotal, maxEntries });
  return entries.map((e) => ({ name: e.name, data: e.read(), executable: e.executable }));
}

// ディスクの ZIP を、1 つずつ読む (大きな ZIP でもメモリを使いすぎないように)
function openZip(file, { maxTotal = 300 * 1024 * 1024, maxEntries = 10000 } = {}) {
  const fs = require('fs');
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const read = (start, len) => {
    if (start < 0 || start + len > size) throw new ZipError('ZIP が壊れています');
    const b = Buffer.alloc(len);
    let off = 0;
    while (off < len) { const n = fs.readSync(fd, b, off, len - off, start + off); if (!n) break; off += n; }
    return b;
  };
  try {
    return { entries: readDirectory(size, read, { maxTotal, maxEntries }), close: () => fs.closeSync(fd) };
  } catch (e) { fs.closeSync(fd); throw e; }
}

// ZIP を書きながら送る (1 ファイルずつ読むので、大きくてもメモリを使いすぎない)
// items: [{ name, file (ディスクの場所), mtime }]
async function streamZip(out, items) {
  const fs = require('fs');
  const write = (buf) => new Promise((resolve, reject) => {
    if (out.destroyed) { reject(new Error('closed')); return; }
    if (out.write(buf)) resolve(); else out.once('drain', resolve);
  });
  const centrals = [];
  let offset = 0;
  let count = 0;
  for (const it of items) {
    let raw;
    try { raw = fs.readFileSync(it.file); } catch { continue; }
    const name = Buffer.from(it.name, 'utf8');
    const deflated = raw.length > 64 ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const crc = crc32(raw);
    const { time, date } = dosTime(it.mtime || new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    await write(Buffer.concat([local, name]));
    await write(data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((it.executable ? 0o100755 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
    count++;
    if (offset > 0xfff00000) break; // ZIP64 は使わない
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(Buffer.concat([cd, end]));
}

module.exports = { createZip, readZip, openZip, streamZip, crc32, ZipError, decodeName };

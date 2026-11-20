// バイナリファイル (画像・Excel・SQLite・pickle など) の扱い
// プロジェクトのファイルは、文字のファイルは文字列、それ以外は Uint8Array のまま保存します
// (画面・Python のワーカー・GitHub 同期・ZIP で同じ判定を使います)
export const isBin = v => v instanceof Uint8Array

// 中身を見なくてもバイナリと分かる拡張子
export const BIN_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|tiff?|heic|avif|xlsx|xlsm|xls|docx|pptx|odt|ods|pdf|zip|gz|tgz|bz2|xz|tar|7z|db|sqlite3?|pkl|pickle|joblib|npy|npz|h5|hdf5|parquet|feather|mp3|wav|ogg|flac|m4a|aac|mp4|mov|webm|avi|ttf|otf|woff2?|pyc|bin|exe|dll|so|wasm|class|jar|whl|onnx|pt|pth|model)$/i
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i

// NUL を含む・UTF-8 として読めない → バイナリ
export function looksBinary(bytes) {
  const n = Math.min(bytes.length, 8192)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return false } catch { return true }
}

// 読み込んだバイト列 → プロジェクトに置く形 (文字なら文字列、そうでなければそのまま)
export function bytesToContent(bytes, name = '') {
  if (BIN_EXT.test(name) || looksBinary(bytes)) return bytes
  return new TextDecoder().decode(bytes)
}
export const contentBytes = c => (isBin(c) ? c : new TextEncoder().encode(String(c ?? '')))

export function sameContent(a, b) {
  if (isBin(a) || isBin(b)) {
    if (!isBin(a) || !isBin(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  return a === b
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', pdf: 'application/pdf', zip: 'application/zip', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm' }
export function mimeOf(name) {
  const m = /\.([\w]+)$/.exec(name || '')
  return (m && MIME[m[1].toLowerCase()]) || 'application/octet-stream'
}
export function humanSize(n) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`
}
// 種類の説明 (file コマンド・プレビュー)
export function kindOf(name, content) {
  if (!isBin(content)) return 'テキスト'
  if (IMAGE_EXT.test(name)) return '画像'
  if (/\.(xlsx|xlsm|xls|ods)$/i.test(name)) return '表計算 (Excel など)'
  if (/\.(db|sqlite3?)$/i.test(name)) return 'SQLite のデータベース'
  if (/\.(pkl|pickle|joblib)$/i.test(name)) return 'pickle (Python のデータ)'
  if (/\.(npy|npz)$/i.test(name)) return 'NumPy の配列'
  if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(name)) return '音声'
  if (/\.(mp4|mov|webm|avi)$/i.test(name)) return '動画'
  if (/\.pdf$/i.test(name)) return 'PDF'
  if (/\.(zip|gz|tgz|tar|7z|bz2|xz)$/i.test(name)) return '圧縮ファイル'
  return 'バイナリ'
}

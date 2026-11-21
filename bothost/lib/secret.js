'use strict';
// 暗号化 (AES-256-GCM)。バックアップを GitHub に置くときに使います。
// 鍵は BOTHOST_SECRET_KEY (どんな文字列でもよい。SHA-256 で 32 バイトにします)。
// 鍵をなくすと、暗号化したバックアップは誰にも (自分にも) 読めなくなります。
const crypto = require('crypto');

const MAGIC = Buffer.from('BHENC1\0'); // 暗号化したデータの目印

function deriveKey(secret) {
  if (!secret) return null;
  return crypto.createHash('sha256').update(`bothost:${secret}`).digest();
}

function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function isEncrypted(buf) {
  return buf.length > MAGIC.length + 28 && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

function decrypt(key, buf) {
  if (!key) throw new Error('バックアップは暗号化されていますが、鍵 (BOTHOST_SECRET_KEY) がありません');
  const iv = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buf.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(buf.subarray(MAGIC.length + 28)), decipher.final()]);
  } catch {
    throw new Error('バックアップを復号できません (BOTHOST_SECRET_KEY が違います)');
  }
}

// セッションのトークンは、そのままではなくハッシュで保存する (データやバックアップが漏れても使えない)
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('base64url');
}

module.exports = { deriveKey, encrypt, decrypt, isEncrypted, hashToken };

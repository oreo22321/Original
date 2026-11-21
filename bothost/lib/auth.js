'use strict';
// パスワード (scrypt) とログインのセッション
const crypto = require('crypto');

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function newId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function createSession(store, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  store.sessions[token] = { userId, expires: Date.now() + SESSION_DAYS * 86400e3 };
  store.save();
  return token;
}

function getSessionUser(store, token) {
  if (!token) return null;
  const s = store.sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) {
    delete store.sessions[token];
    store.save();
    return null;
  }
  return store.users.find((u) => u.id === s.userId) || null;
}

function destroySession(store, token) {
  if (store.sessions[token]) {
    delete store.sessions[token];
    store.save();
  }
}

function pruneSessions(store) {
  const now = Date.now();
  let changed = false;
  for (const [t, s] of Object.entries(store.sessions)) {
    if (s.expires < now) { delete store.sessions[t]; changed = true; }
  }
  if (changed) store.save();
}

// ログインの総当たりを遅くする (IP ごとに 10 分で 20 回まで)
const attempts = new Map();
function allowAttempt(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= 20) { attempts.set(ip, list); return false; }
  list.push(now);
  attempts.set(ip, list);
  return true;
}

module.exports = {
  hashPassword, verifyPassword, newId,
  createSession, getSessionUser, destroySession, pruneSessions, allowAttempt,
  SESSION_DAYS,
};

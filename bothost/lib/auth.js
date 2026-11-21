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

const { hashToken } = require('./secret');
const MAX_SESSIONS_PER_USER = 20;

// セッション: 保存するのはトークンのハッシュだけ (データやバックアップが漏れても、ログインには使えない)
function createSession(store, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  store.sessions[hashToken(token)] = { userId, expires: Date.now() + SESSION_DAYS * 86400e3, created: Date.now() };
  // 1 人のセッションが増えすぎたら古いものから消す
  const mine = Object.entries(store.sessions).filter(([, s]) => s.userId === userId)
    .sort((a, b) => (a[1].created || 0) - (b[1].created || 0));
  for (const [k] of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS_PER_USER))) delete store.sessions[k];
  store.save();
  return token;
}

function findSession(store, token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const key = hashToken(token);
  if (store.sessions[key]) return key;
  // 前の版 (トークンをそのまま保存していた) からの移し替え
  if (store.sessions[token]) {
    store.sessions[key] = store.sessions[token];
    delete store.sessions[token];
    store.save();
    return key;
  }
  return null;
}

function getSessionUser(store, token) {
  const key = findSession(store, token);
  if (!key) return null;
  const s = store.sessions[key];
  if (s.expires < Date.now()) {
    delete store.sessions[key];
    store.save();
    return null;
  }
  return store.users.find((u) => u.id === s.userId) || null;
}

function destroySession(store, token) {
  const key = findSession(store, token);
  if (key) {
    delete store.sessions[key];
    store.save();
  }
}

function destroyUserSessions(store, userId, exceptToken) {
  const keep = exceptToken ? hashToken(exceptToken) : null;
  let changed = false;
  for (const [k, s] of Object.entries(store.sessions)) {
    if (s.userId === userId && k !== keep) { delete store.sessions[k]; changed = true; }
  }
  if (changed) store.save();
}

function pruneSessions(store) {
  const now = Date.now();
  let changed = false;
  for (const [t, s] of Object.entries(store.sessions)) {
    if (s.expires < now) { delete store.sessions[t]; changed = true; }
  }
  if (changed) store.save();
}

// ログインの総当たりを遅くする: IP ごとに 10 分で 20 回、同じユーザー名へは 10 分で 10 回まで
const attempts = new Map();
function allowAttempt(key, max = 20) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= max) { attempts.set(key, list); return false; }
  list.push(now);
  attempts.set(key, list);
  if (attempts.size > 5000) { // 古い記録を捨てて、メモリが増え続けないように
    for (const [k, v] of attempts) if (!v.length || now - v[v.length - 1] > 10 * 60e3) attempts.delete(k);
  }
  return true;
}
function allowLogin(ip, username) {
  return allowAttempt(`ip:${ip}`, 20) && allowAttempt(`user:${String(username || '').toLowerCase()}`, 10);
}

// テスト用: 試した回数の記録を消す
function resetAttempts() { attempts.clear(); }

module.exports = {
  hashPassword, verifyPassword, newId,
  createSession, getSessionUser, destroySession, destroyUserSessions, pruneSessions, allowAttempt, allowLogin, resetAttempts,
  SESSION_DAYS,
};

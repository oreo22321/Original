'use strict';

const STATUS = {
  quote: { label: '見積もり待ち', emoji: '📝', color: 0x95a5a6 },
  pending: { label: 'お支払い待ち', emoji: '⏳', color: 0xf1c40f },
  paid: { label: '支払い確認済み・対応中', emoji: '💰', color: 0x3498db },
  delivered: { label: '納品済み', emoji: '📦', color: 0x2ecc71 },
  closed: { label: '完了', emoji: '✅', color: 0x2c3e50 },
  cancelled: { label: 'キャンセル', emoji: '❌', color: 0xe74c3c },
};

const COLORS = {
  brand: 0x5865f2,
  success: 0x2ecc71,
  warn: 0xf1c40f,
  danger: 0xe74c3c,
  review: 0xf39c12,
};

function yen(n) {
  if (n === null || n === undefined) return '未定';
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}

function orderNo(n) {
  return `#${String(n).padStart(4, '0')}`;
}

function statusText(status) {
  const s = STATUS[status];
  return s ? `${s.emoji} ${s.label}` : status;
}

function stars(n) {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return '★'.repeat(k) + '☆'.repeat(5 - k);
}

function stockText(stock) {
  if (stock === null || stock === undefined) return '在庫あり';
  if (stock <= 0) return '売り切れ';
  return `残り ${stock} 個`;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Discord のタイムスタンプ表記 (見る人の時間帯で表示される) */
function ts(ms, style = 'f') {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

module.exports = { STATUS, COLORS, yen, orderNo, statusText, stars, stockText, truncate, ts };

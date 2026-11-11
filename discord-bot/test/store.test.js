'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { parseAmount } = require('../src/handlers/components');
const { yen, orderNo, stars } = require('../src/lib/format');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopbot-'));
  return { store: new Store(path.join(dir, 'db.json')), file: path.join(dir, 'db.json') };
}

const G = 'guild1';

test('商品の追加・検索・編集・削除', () => {
  const { store } = tmpStore();
  const p = store.addProduct(G, { name: 'ゲームコード', price: 1500, stock: 3 });
  assert.equal(p.id, 'p1');
  assert.equal(store.findProduct(G, 'p1').name, 'ゲームコード');
  assert.equal(store.findProduct(G, 'ゲームコード').id, 'p1');
  store.updateProduct(G, 'p1', { price: 2000, stock: null });
  assert.equal(store.getProduct(G, 'p1').price, 2000);
  assert.equal(store.getProduct(G, 'p1').stock, null);
  assert.equal(store.removeProduct(G, 'p1').name, 'ゲームコード');
  assert.equal(store.listProducts(G).length, 0);
});

test('不正な価格・在庫はエラー', () => {
  const { store } = tmpStore();
  assert.throws(() => store.addProduct(G, { name: 'x', price: -1 }), /価格/);
  assert.throws(() => store.addProduct(G, { name: 'x', price: 100, stock: 1.5 }), /在庫/);
  assert.throws(() => store.addProduct(G, { name: '  ', price: 100 }), /商品名/);
});

test('在庫の増減 (不足時は減らさない / 無制限は常に OK)', () => {
  const { store } = tmpStore();
  const p = store.addProduct(G, { name: 'A', price: 100, stock: 2 });
  assert.equal(store.adjustStock(G, p.id, -2), true);
  assert.equal(store.getProduct(G, p.id).stock, 0);
  assert.equal(store.adjustStock(G, p.id, -1), false);
  assert.equal(store.getProduct(G, p.id).stock, 0);
  assert.equal(store.adjustStock(G, p.id, 1), true);
  const u = store.addProduct(G, { name: 'B', price: 100 });
  assert.equal(store.adjustStock(G, u.id, -100), true);
  assert.equal(store.getProduct(G, u.id).stock, null);
});

test('注文の連番とステータス遷移', () => {
  const { store } = tmpStore();
  const a = store.createOrder(G, { type: 'product', userId: 'u1', productName: 'A', price: 100 });
  const b = store.createOrder(G, { type: 'service', userId: 'u1', details: { content: 'x' } });
  assert.equal(a.number, 1);
  assert.equal(b.number, 2);
  assert.equal(a.status, 'pending');
  assert.equal(b.status, 'quote');

  assert.throws(() => store.setStatus(G, 1, 'delivered', 's'), /お支払い待ち/);
  store.setStatus(G, 1, 'paid', 's');
  store.setStatus(G, 1, 'delivered', 's');
  store.setStatus(G, 1, 'closed', 'u1');
  assert.throws(() => store.setStatus(G, 1, 'cancelled', 's'));
  assert.equal(store.getOrder(G, 1).history.length, 4);

  store.setStatus(G, 2, 'pending', 's', { price: 5000 });
  assert.equal(store.getOrder(G, 2).price, 5000);
  assert.equal(store.openOrdersOf(G, 'u1').length, 1);
});

test('集計', () => {
  const { store } = tmpStore();
  store.createOrder(G, { type: 'product', userId: 'u1', price: 1000 });
  store.createOrder(G, { type: 'product', userId: 'u2', price: 2000 });
  store.setStatus(G, 1, 'paid', 's');
  store.setStatus(G, 1, 'delivered', 's');
  store.updateOrder(G, 1, { reviewed: true, rating: 4 });
  const s = store.stats(G);
  assert.equal(s.total, 2);
  assert.equal(s.revenue, 1000);
  assert.equal(s.completed, 1);
  assert.equal(s.avgRating, 4);
  assert.equal(s.byStatus.pending, 1);
});

test('保存して読み直してもデータが残る', () => {
  const { store, file } = tmpStore();
  store.addProduct(G, { name: 'A', price: 100 });
  store.setConfig(G, { paymentInfo: 'PayPay: test' });
  const again = new Store(file);
  assert.equal(again.listProducts(G).length, 1);
  assert.equal(again.getConfig(G).paymentInfo, 'PayPay: test');
  assert.equal(again.addProduct(G, { name: 'B', price: 1 }).id, 'p2');
});

test('金額の入力を読み取る', () => {
  assert.equal(parseAmount('3000'), 3000);
  assert.equal(parseAmount('¥3,000'), 3000);
  assert.equal(parseAmount('３０００円'), 3000);
  assert.throws(() => parseAmount('三千'));
  assert.throws(() => parseAmount('-5'));
});

test('表示の書式', () => {
  assert.equal(yen(1234567), '¥1,234,567');
  assert.equal(yen(null), '未定');
  assert.equal(orderNo(12), '#0012');
  assert.equal(stars(4), '★★★★☆');
});

'use strict';

// Discord に接続せずに、コマンド定義・パネル・モーダルが正しく作れるかを確認する
const fs = require('node:fs');
const path = require('node:path');
const { buildShopPanel, buildServicePanel, buildVerifyPanel, buildProductCard, buildCategoryMenu } = require('../src/lib/panels');
const { buildOrderView } = require('../src/lib/orderView');
const { modal } = require('../src/lib/modal');

const dir = path.join(__dirname, '..', 'src', 'commands');
let count = 0;
for (const file of fs.readdirSync(dir)) {
  const cmd = require(path.join(dir, file));
  const json = cmd.data.toJSON();
  if (JSON.stringify(json).length > 8000) throw new Error(`${json.name} の定義が大きすぎます`);
  count++;
}
console.log(`✅ スラッシュコマンド ${count} 個の定義 OK`);

const products = [
  { id: 'p1', name: 'テスト商品', price: 500, stock: null, description: '説明', emoji: '🎮', createdAt: 1 },
  { id: 'p2', name: '売り切れ商品', price: 900, stock: 0, description: '', emoji: null, createdAt: 2 },
];
for (const payload of [buildShopPanel(products), buildShopPanel([]), buildServicePanel(), buildVerifyPanel()]) {
  payload.embeds.forEach((e) => e.toJSON());
  payload.components.forEach((c) => c.toJSON());
}
// 商品が 25 個を超えるとカテゴリ選択になる
const many = Array.from({ length: 40 }, (_, i) => ({
  id: `p${i}`, name: `商品${i}`, price: 100 * i, stock: i % 7 === 0 ? 0 : null, category: `カテゴリ${i % 4}`, createdAt: i,
}));
const big = buildShopPanel(many);
const bigJson = big.components[0].toJSON();
if (bigJson.components[0].custom_id !== 'shop:cat') throw new Error('26 個以上でカテゴリ選択になっていません');
big.embeds.forEach((e) => e.toJSON());
buildCategoryMenu(many, 'カテゴリ1').components.forEach((c) => c.toJSON());
const card = buildProductCard({ ...products[0], imageUrl: 'https://example.com/a.png', codes: ['x'] });
card.embeds.forEach((e) => e.toJSON());
card.components.forEach((c) => c.toJSON());
console.log('✅ パネル OK (カテゴリ・商品カード含む)');

const config = { paymentInfo: 'PayPay' };
for (const status of ['quote', 'pending', 'paid', 'delivered', 'closed', 'cancelled']) {
  const order = {
    number: 1, type: 'service', userId: '1', status, price: 1000, quantity: 1, note: 'メモ',
    details: { content: '内容', budget: '', deadline: '' }, createdAt: Date.now(), updatedAt: Date.now(),
  };
  const view = buildOrderView(order, config);
  view.embeds.forEach((e) => e.toJSON());
  view.components.forEach((c) => c.toJSON());
}
console.log('✅ 注文カード OK');

modal('x', 'テスト', [{ id: 'a', label: 'A', long: true, required: false, value: 'v', max: 100 }]).toJSON();
console.log('✅ モーダル OK');

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { STATUS } = require('./lib/format');
const { UserError } = require('./lib/errors');

/** 注文のステータスと、そこから移れる次のステータス */
const TRANSITIONS = {
  quote: ['pending', 'cancelled'],
  pending: ['paid', 'cancelled'],
  paid: ['delivered', 'cancelled'],
  delivered: ['closed'],
  closed: [],
  cancelled: [],
};

const OPEN_STATUSES = ['quote', 'pending', 'paid', 'delivered'];

function defaultConfig() {
  return {
    staffRoleId: null,
    verifiedRoleId: null,
    buyerRoleId: null,
    ticketCategoryId: null,
    logChannelId: null,
    reviewChannelId: null,
    shopPanel: null, // { channelId, messageId }
    paymentInfo:
      'お支払い方法はスタッフからご案内します。\n（管理者は `/config payment` でここに PayPay・銀行振込などの案内を設定してください）',
    maxOpenTickets: 3,
  };
}

/**
 * JSON ファイルにデータを保存するシンプルなストア。
 * 書き込みは一時ファイル → rename で行うので、途中で落ちてもファイルが壊れにくい。
 */
class Store {
  constructor(file) {
    this.file = file;
    this.data = { guilds: {} };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = parsed && typeof parsed === 'object' ? parsed : { guilds: {} };
      if (!this.data.guilds) this.data.guilds = {};
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  guild(guildId) {
    let g = this.data.guilds[guildId];
    if (!g) {
      g = this.data.guilds[guildId] = {
        config: defaultConfig(),
        products: {},
        orders: {},
        counters: { product: 0, order: 0 },
      };
    }
    g.config = { ...defaultConfig(), ...g.config };
    return g;
  }

  // ---------- 設定 ----------
  getConfig(guildId) {
    return this.guild(guildId).config;
  }

  setConfig(guildId, patch) {
    const g = this.guild(guildId);
    g.config = { ...g.config, ...patch };
    this.save();
    return g.config;
  }

  // ---------- 商品 ----------
  addProduct(guildId, { name, price, stock = null, description = '', emoji = null, delivery = '' }) {
    if (!name || !name.trim()) throw new UserError('商品名を入力してください');
    validatePrice(price);
    validateStock(stock);
    const g = this.guild(guildId);
    const id = `p${++g.counters.product}`;
    const product = {
      id,
      name: name.trim(),
      price,
      stock,
      description,
      emoji,
      delivery,
      createdAt: Date.now(),
    };
    g.products[id] = product;
    this.save();
    return product;
  }

  getProduct(guildId, id) {
    return this.guild(guildId).products[id] || null;
  }

  /** ID (p1) か商品名で探す */
  findProduct(guildId, query) {
    if (!query) return null;
    const products = this.guild(guildId).products;
    if (products[query]) return products[query];
    const q = query.trim().toLowerCase();
    return Object.values(products).find((p) => p.name.toLowerCase() === q) || null;
  }

  listProducts(guildId) {
    return Object.values(this.guild(guildId).products).sort((a, b) => a.createdAt - b.createdAt);
  }

  updateProduct(guildId, id, patch) {
    const product = this.getProduct(guildId, id);
    if (!product) throw new UserError('商品が見つかりません');
    if ('price' in patch) validatePrice(patch.price);
    if ('stock' in patch) validateStock(patch.stock);
    Object.assign(product, patch);
    this.save();
    return product;
  }

  removeProduct(guildId, id) {
    const g = this.guild(guildId);
    const product = g.products[id];
    if (!product) return null;
    delete g.products[id];
    this.save();
    return product;
  }

  /** 在庫を増減する。在庫不足なら false を返して何もしない。在庫 null は無制限。 */
  adjustStock(guildId, id, delta) {
    const product = this.getProduct(guildId, id);
    if (!product) return false;
    if (product.stock === null || product.stock === undefined) return true;
    if (product.stock + delta < 0) return false;
    product.stock += delta;
    this.save();
    return true;
  }

  // ---------- 注文 ----------
  createOrder(guildId, data) {
    const g = this.guild(guildId);
    const number = ++g.counters.order;
    const now = Date.now();
    const order = {
      number,
      type: data.type, // 'product' | 'service'
      userId: data.userId,
      productId: data.productId || null,
      productName: data.productName || null,
      quantity: data.quantity || 1,
      price: data.price ?? null, // 合計金額 (代行は見積もり後に決まる)
      note: data.note || '',
      details: data.details || null, // 代行: { content, budget, deadline }
      status: data.type === 'service' ? 'quote' : 'pending',
      stockTaken: false,
      channelId: null,
      controlMessageId: null,
      reviewed: false,
      createdAt: now,
      updatedAt: now,
      history: [{ status: data.type === 'service' ? 'quote' : 'pending', at: now, by: data.userId }],
    };
    g.orders[number] = order;
    this.save();
    return order;
  }

  getOrder(guildId, number) {
    return this.guild(guildId).orders[number] || null;
  }

  getOrderByChannel(guildId, channelId) {
    return Object.values(this.guild(guildId).orders).find((o) => o.channelId === channelId) || null;
  }

  updateOrder(guildId, number, patch) {
    const order = this.getOrder(guildId, number);
    if (!order) throw new UserError('注文が見つかりません');
    Object.assign(order, patch, { updatedAt: Date.now() });
    this.save();
    return order;
  }

  /** ステータスを変更する。許可されていない変更なら例外。 */
  setStatus(guildId, number, status, byUserId, extra = {}) {
    const order = this.getOrder(guildId, number);
    if (!order) throw new UserError('注文が見つかりません');
    if (!TRANSITIONS[order.status].includes(status)) {
      throw new UserError(`この注文は今「${STATUS[order.status]?.label ?? order.status}」なので、その操作はできません`);
    }
    const now = Date.now();
    Object.assign(order, extra, { status, updatedAt: now });
    order.history.push({ status, at: now, by: byUserId });
    this.save();
    return order;
  }

  listOrders(guildId, { status, userId } = {}) {
    return Object.values(this.guild(guildId).orders)
      .filter((o) => (!status || o.status === status) && (!userId || o.userId === userId))
      .sort((a, b) => b.number - a.number);
  }

  openOrdersOf(guildId, userId) {
    return this.listOrders(guildId, { userId }).filter((o) => OPEN_STATUSES.includes(o.status));
  }

  stats(guildId) {
    const orders = Object.values(this.guild(guildId).orders);
    const byStatus = {};
    for (const s of Object.keys(TRANSITIONS)) byStatus[s] = 0;
    let revenue = 0;
    let completed = 0;
    for (const o of orders) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      if (o.status === 'delivered' || o.status === 'closed') {
        revenue += o.price || 0;
        completed++;
      }
    }
    const reviews = orders.filter((o) => o.reviewed && o.rating);
    const avgRating = reviews.length
      ? reviews.reduce((sum, o) => sum + o.rating, 0) / reviews.length
      : null;
    return { total: orders.length, byStatus, revenue, completed, avgRating, reviewCount: reviews.length };
  }
}

function validatePrice(price) {
  if (!Number.isInteger(price) || price < 0) throw new UserError('価格は 0 以上の整数で入力してください');
}

function validateStock(stock) {
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
    throw new UserError('在庫は 0 以上の整数で入力してください（空欄なら無制限）');
  }
}

module.exports = { Store, TRANSITIONS, OPEN_STATUSES };

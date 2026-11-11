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
    newsChannelId: null,
    autoCancelHours: 24, // お支払い待ちのまま放置された注文を自動キャンセルするまでの時間 (0 = しない)
    announceProducts: true, // 新商品・再入荷をお知らせチャンネルに自動投稿
    blacklist: {}, // userId → { reason, at, by }
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
    if (!g.coupons) g.coupons = {};
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
  addProduct(
    guildId,
    { name, price, stock = null, description = '', emoji = null, delivery = '', category = '', imageUrl = null, autoDeliver = true },
  ) {
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
      category: (category || '').trim() || 'その他',
      imageUrl,
      autoDeliver,
      codes: null, // コード在庫 (1 個ずつ違うコードを自動で渡す商品)。null なら通常の在庫
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
    if ('stock' in patch) {
      if (Array.isArray(product.codes)) {
        throw new UserError('この商品はコード在庫で管理しています。在庫は `/codes add` で増やしてください');
      }
      validateStock(patch.stock);
    }
    if ('category' in patch) patch.category = (patch.category || '').trim() || 'その他';
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

  /** 登録されているカテゴリの一覧 (登録順) */
  categories(guildId) {
    return [...new Set(this.listProducts(guildId).map((p) => p.category || 'その他'))];
  }

  // ---------- コード在庫 (自動納品) ----------
  /** コードを追加する。重複・空行は無視。在庫数 = コードの数 になる */
  addCodes(guildId, id, list) {
    const product = this.getProduct(guildId, id);
    if (!product) throw new UserError('商品が見つかりません');
    const codes = Array.isArray(product.codes) ? product.codes : [];
    const seen = new Set(codes);
    let added = 0;
    let duplicates = 0;
    for (const raw of list) {
      const code = String(raw).trim();
      if (!code) continue;
      if (seen.has(code)) {
        duplicates++;
        continue;
      }
      seen.add(code);
      codes.push(code);
      added++;
    }
    product.codes = codes;
    product.stock = codes.length;
    this.save();
    return { added, duplicates, total: codes.length };
  }

  /** コードを n 個取り出す。コード在庫でない商品は null、足りなければ false */
  takeCodes(guildId, id, n) {
    const product = this.getProduct(guildId, id);
    if (!product || !Array.isArray(product.codes)) return null;
    if (product.codes.length < n) return false;
    const taken = product.codes.splice(0, n);
    product.stock = product.codes.length;
    this.save();
    return taken;
  }

  /** 取り出したコードを在庫に戻す (キャンセル時) */
  returnCodes(guildId, id, codes) {
    const product = this.getProduct(guildId, id);
    if (!product || !codes?.length) return;
    product.codes = [...codes, ...(product.codes || [])];
    product.stock = product.codes.length;
    this.save();
  }

  /** コード在庫をやめて通常在庫 (在庫 0) に戻す */
  clearCodes(guildId, id) {
    const product = this.getProduct(guildId, id);
    if (!product) throw new UserError('商品が見つかりません');
    const removed = product.codes?.length ?? 0;
    product.codes = null;
    product.stock = 0;
    this.save();
    return removed;
  }

  // ---------- クーポン ----------
  createCoupon(guildId, { code, type, value, maxUses = null, expiresAt = null, productId = null }) {
    const key = normalizeCode(code);
    if (!/^[A-Z0-9_-]{2,32}$/.test(key)) throw new UserError('クーポンコードは英数字・-・_ の 2〜32 文字にしてください');
    if (type === 'percent' && (value < 1 || value > 100)) throw new UserError('割引率は 1〜100 % で入力してください');
    if (!Number.isInteger(value) || value < 1) throw new UserError('割引額は 1 以上の整数で入力してください');
    const g = this.guild(guildId);
    if (g.coupons[key]) throw new UserError(`クーポン ${key} はすでにあります`);
    g.coupons[key] = { code: key, type, value, maxUses, uses: 0, expiresAt, productId, createdAt: Date.now() };
    this.save();
    return g.coupons[key];
  }

  getCoupon(guildId, code) {
    return this.guild(guildId).coupons[normalizeCode(code)] || null;
  }

  listCoupons(guildId) {
    return Object.values(this.guild(guildId).coupons).sort((a, b) => a.createdAt - b.createdAt);
  }

  deleteCoupon(guildId, code) {
    const g = this.guild(guildId);
    const key = normalizeCode(code);
    const coupon = g.coupons[key];
    if (coupon) {
      delete g.coupons[key];
      this.save();
    }
    return coupon || null;
  }

  /** クーポンが使えるか確かめて、割引額を返す (使えなければ UserError) */
  checkCoupon(guildId, code, productId, basePrice, now = Date.now()) {
    const coupon = this.getCoupon(guildId, code);
    if (!coupon) throw new UserError('そのクーポンコードは見つかりません');
    if (coupon.expiresAt && now > coupon.expiresAt) throw new UserError('このクーポンは有効期限が切れています');
    if (coupon.maxUses !== null && coupon.uses >= coupon.maxUses) throw new UserError('このクーポンは使用上限に達しています');
    if (coupon.productId && coupon.productId !== productId) throw new UserError('このクーポンはこの商品には使えません');
    const discount =
      coupon.type === 'percent' ? Math.floor((basePrice * coupon.value) / 100) : Math.min(coupon.value, basePrice);
    return { coupon, discount };
  }

  useCoupon(guildId, code, delta = 1) {
    const coupon = this.getCoupon(guildId, code);
    if (!coupon) return;
    coupon.uses = Math.max(0, coupon.uses + delta);
    this.save();
  }

  // ---------- ブラックリスト ----------
  isBlacklisted(guildId, userId) {
    return this.getConfig(guildId).blacklist[userId] || null;
  }

  setBlacklist(guildId, userId, entry) {
    const config = this.getConfig(guildId);
    const blacklist = { ...config.blacklist };
    if (entry) blacklist[userId] = entry;
    else delete blacklist[userId];
    this.setConfig(guildId, { blacklist });
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
      coupon: data.coupon || null,
      discount: data.discount || 0,
      deliveredCodes: [],
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

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
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

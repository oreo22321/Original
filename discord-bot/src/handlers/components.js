'use strict';

const { LabelBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { modal } = require('../lib/modal');
const { isStaff } = require('../lib/perms');
const { createTicket, UserError } = require('../lib/tickets');
const { buildCategoryMenu, buildProductCard, inStock, refreshShopPanel } = require('../lib/panels');
const actions = require('../lib/actions');
const { orderNo, yen, stars } = require('../lib/format');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

function toHalfWidth(text) {
  return String(text).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

function parseAmount(text) {
  const n = Number(toHalfWidth(text).replace(/[¥￥,，円\s]/g, ''));
  if (!Number.isInteger(n) || n < 0) throw new UserError('金額は数字で入力してください (例: 3000)');
  return n;
}

// ---------------------------------------------------------------- 購入
function fromEphemeral(interaction) {
  return interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? false;
}

/** 商品を選んだ → 詳細カードを本人だけに表示 */
async function onShopSelect(interaction, { store }) {
  const product = store.getProduct(interaction.guildId, interaction.values[0]);
  if (!product) throw new UserError('この商品は販売終了しました。');
  const card = buildProductCard(product);
  if (fromEphemeral(interaction)) return interaction.update(card);
  await interaction.reply({ ...card, ...EPHEMERAL });
  // 共有パネルのメニューの選択状態を戻す (同じ商品をもう一度選べるように)
  return refreshShopPanel(interaction.guild, store);
}

/** カテゴリを選んだ → そのカテゴリの商品メニューを本人だけに表示 */
async function onShopCategory(interaction, { store }) {
  const view = buildCategoryMenu(store.listProducts(interaction.guildId), interaction.values[0]);
  if (fromEphemeral(interaction)) return interaction.update(view);
  await interaction.reply({ ...view, ...EPHEMERAL });
  return refreshShopPanel(interaction.guild, store);
}

/** 「購入する」ボタン → 数量・クーポン・備考の入力 */
async function onShopBuy(interaction, { store }, productId) {
  const product = store.getProduct(interaction.guildId, productId);
  if (!product) throw new UserError('この商品は販売終了しました。');
  if (!inStock(product)) throw new UserError('申し訳ありません、この商品は売り切れです。');
  const maxQty = product.stock === null ? 99 : Math.min(99, product.stock);
  const hasCoupons = store.listCoupons(interaction.guildId).length > 0;
  const inputs = [{ id: 'qty', label: `数量 (1〜${maxQty})`, description: `1 個 ${yen(product.price)}`, value: '1', max: 2 }];
  if (hasCoupons) inputs.push({ id: 'coupon', label: 'クーポンコード (任意)', required: false, max: 32 });
  inputs.push({ id: 'note', label: '備考 (任意)', long: true, required: false, max: 1000, placeholder: 'スタッフへの連絡事項があれば' });
  return interaction.showModal(modal(`shop:order:${product.id}`, `ご注文: ${product.name}`.slice(0, 45), inputs));
}

function optionalField(interaction, id) {
  try {
    return interaction.fields.getTextInputValue(id) ?? '';
  } catch {
    return '';
  }
}

async function onShopOrderModal(interaction, { store }, productId) {
  const gid = interaction.guildId;
  const product = store.getProduct(gid, productId);
  if (!product) throw new UserError('この商品は販売終了しました。');
  const qty = Number(toHalfWidth(interaction.fields.getTextInputValue('qty')).trim());
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new UserError('数量は 1〜99 の数字で入力してください。');
  if (product.stock !== null && product.stock < qty) {
    throw new UserError(product.stock > 0 ? `在庫が足りません (残り ${product.stock} 個)。` : 'この商品は売り切れです。');
  }
  const base = product.price * qty;
  const couponCode = optionalField(interaction, 'coupon').trim();
  let discount = 0;
  let coupon = null;
  if (couponCode) {
    const res = store.checkCoupon(gid, couponCode, product.id, base);
    discount = res.discount;
    coupon = res.coupon.code;
  }
  await interaction.deferReply(EPHEMERAL);
  const { order, channel } = await createTicket(interaction, store, {
    type: 'product',
    productId: product.id,
    productName: product.name,
    quantity: qty,
    price: base - discount,
    coupon,
    discount,
    note: optionalField(interaction, 'note'),
  });
  if (coupon) store.useCoupon(gid, coupon, 1);
  return interaction.editReply(
    `✅ ご注文 ${orderNo(order.number)} を受け付けました！${coupon ? ` (クーポンで ${yen(discount)} 引き)` : ''}\n${channel} でお支払い方法をご確認ください。`,
  );
}

// ---------------------------------------------------------------- 代行
async function onServiceRequest(interaction) {
  return interaction.showModal(
    modal('service:modal', '代行のご依頼', [
      { id: 'content', label: '依頼内容', long: true, max: 1000, placeholder: 'できるだけ詳しく書いてください' },
      { id: 'budget', label: 'ご予算', required: false, max: 100, placeholder: '例: 3,000円くらい' },
      { id: 'deadline', label: '希望納期', required: false, max: 100, placeholder: '例: 今週末まで' },
    ]),
  );
}

async function onServiceModal(interaction, { store }) {
  await interaction.deferReply(EPHEMERAL);
  const { order, channel } = await createTicket(interaction, store, {
    type: 'service',
    details: {
      content: interaction.fields.getTextInputValue('content'),
      budget: interaction.fields.getTextInputValue('budget'),
      deadline: interaction.fields.getTextInputValue('deadline'),
    },
  });
  return interaction.editReply(`✅ ご依頼 ${orderNo(order.number)} を受け付けました！ ${channel} でスタッフからのお見積もりをお待ちください。`);
}

// ---------------------------------------------------------------- 認証
async function onVerify(interaction, { store }) {
  const { verifiedRoleId } = store.getConfig(interaction.guildId);
  if (!verifiedRoleId) throw new UserError('認証ロールが設定されていません。管理者にお問い合わせください。');
  if (interaction.member.roles.cache.has(verifiedRoleId)) {
    return interaction.reply({ content: 'すでに認証済みです！', ...EPHEMERAL });
  }
  try {
    await interaction.member.roles.add(verifiedRoleId, '認証ボタン');
  } catch {
    throw new UserError('ロールを付けられませんでした。管理者は Bot のロールを「認証済み」より上に移動してください。');
  }
  return interaction.reply({ content: '✅ 認証しました！ショップのチャンネルが見られるようになりました。', ...EPHEMERAL });
}

// ---------------------------------------------------------------- 注文チケットのボタン
async function onOrderButton(interaction, ctx, action, number) {
  const { store } = ctx;
  const guild = interaction.guild;
  const config = store.getConfig(guild.id);
  const order = store.getOrder(guild.id, number);
  if (!order) throw new UserError('この注文は見つかりません。');
  const staff = isStaff(interaction.member, config);
  const isBuyer = interaction.user.id === order.userId;
  const needStaff = () => {
    if (!staff) throw new UserError('この操作はスタッフ専用です。');
  };

  switch (action) {
    case 'quote':
      needStaff();
      return interaction.showModal(
        modal(`order:quotemodal:${number}`, `見積もり ${orderNo(number)}`, [
          { id: 'price', label: '金額 (円)', max: 12, placeholder: '例: 3000' },
          { id: 'note', label: 'お客様へのメモ (任意)', long: true, required: false, max: 1000, placeholder: '作業内容・納期の目安など' },
        ]),
      );

    case 'paid':
      needStaff();
      await interaction.deferReply(EPHEMERAL);
      {
        const res = await actions.markPaid(guild, store, order, interaction.user.id);
        if (res.autoDelivered) {
          return interaction.editReply(
            `✅ 支払いを確認し、自動で納品しました。${res.dmOk ? '' : '\n⚠️ お客様の DM が閉じていたため、DM は送れませんでした (チャンネルには投稿済み)。'}`,
          );
        }
        return interaction.editReply('✅ 支払い確認済みにしました。準備ができたら「納品する」を押してください。');
      }

    case 'report':
      if (!isBuyer) throw new UserError('支払いの報告は注文したご本人だけができます。');
      if (order.status !== 'pending') throw new UserError('この注文は今、お支払い待ちではありません。');
      return interaction.showModal(
        modal(`order:reportmodal:${number}`, `お支払いの報告 ${orderNo(number)}`, [
          { id: 'method', label: 'お支払い方法', max: 100, placeholder: '例: PayPay / 銀行振込' },
          {
            id: 'note',
            label: 'メモ (任意)',
            long: true,
            required: false,
            max: 500,
            placeholder: '送金時の名前・取引番号など。スクリーンショットは報告後にチャンネルに貼ってください',
          },
        ]),
      );

    case 'deliver': {
      needStaff();
      const product = order.productId ? store.getProduct(guild.id, order.productId) : null;
      return interaction.showModal(
        modal(`order:delivermodal:${number}`, `納品 ${orderNo(number)}`, [
          {
            id: 'content',
            label: '納品内容',
            description: 'お客様にチャンネルと DM で送られます (ファイルはチャンネルに直接貼ってください)',
            long: true,
            required: false,
            max: 4000,
            value: product?.delivery || '',
            placeholder: 'コード・URL・完了報告など',
          },
        ]),
      );
    }

    case 'cancel':
      if (!staff) {
        if (!isBuyer) throw new UserError('この注文を操作する権限がありません。');
        if (!['quote', 'pending'].includes(order.status)) {
          throw new UserError('お支払い後のキャンセルはスタッフにご相談ください。');
        }
      }
      await interaction.reply({ content: 'キャンセルしています…', ...EPHEMERAL });
      await actions.cancelOrder(guild, store, order, interaction.user.id, staff && !isBuyer ? 'スタッフによるキャンセル' : 'お客様によるキャンセル');
      return null;

    case 'close':
      if (!staff && !isBuyer) throw new UserError('この注文を操作する権限がありません。');
      await interaction.reply({ content: 'チケットを閉じています…', ...EPHEMERAL });
      await actions.completeOrder(guild, store, order, interaction.user.id);
      return null;

    case 'review': {
      if (!isBuyer) throw new UserError('レビューは注文したご本人だけが書けます。');
      if (order.reviewed) throw new UserError('この注文はレビュー済みです。ありがとうございました！');
      const rating = new StringSelectMenuBuilder()
        .setCustomId('rating')
        .addOptions([5, 4, 3, 2, 1].map((n) => ({ label: `${stars(n)} (${n})`, value: String(n), default: n === 5 })));
      const comment = new TextInputBuilder()
        .setCustomId('comment')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000)
        .setPlaceholder('対応の早さ・品質など、ご感想をどうぞ');
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`order:reviewmodal:${number}`)
          .setTitle('レビューを書く')
          .addLabelComponents(
            new LabelBuilder().setLabel('評価').setStringSelectMenuComponent(rating),
            new LabelBuilder().setLabel('コメント (任意)').setTextInputComponent(comment),
          ),
      );
    }

    default:
      throw new UserError('不明な操作です。');
  }
}

async function onOrderModal(interaction, { store }, kind, number) {
  const guild = interaction.guild;
  const config = store.getConfig(guild.id);
  const order = store.getOrder(guild.id, number);
  if (!order) throw new UserError('この注文は見つかりません。');

  if (kind === 'reviewmodal') {
    if (interaction.user.id !== order.userId) throw new UserError('レビューは注文したご本人だけが書けます。');
    if (order.reviewed) throw new UserError('この注文はレビュー済みです。');
    const rating = Number(interaction.fields.getStringSelectValues('rating')[0] ?? 5);
    await interaction.deferReply(EPHEMERAL);
    await actions.postReview(guild, store, order, interaction.member ?? interaction.user, rating, interaction.fields.getTextInputValue('comment'));
    return interaction.editReply('⭐ レビューありがとうございました！');
  }

  if (kind === 'reportmodal') {
    if (interaction.user.id !== order.userId) throw new UserError('支払いの報告は注文したご本人だけができます。');
    await interaction.deferReply(EPHEMERAL);
    await actions.reportPayment(guild, store, order, interaction.user.id, {
      method: interaction.fields.getTextInputValue('method'),
      note: interaction.fields.getTextInputValue('note'),
    });
    return interaction.editReply('✅ 報告しました！スクリーンショットがあれば、このチャンネルに貼ってください。スタッフが確認します。');
  }

  if (!isStaff(interaction.member, config)) throw new UserError('この操作はスタッフ専用です。');

  if (kind === 'quotemodal') {
    const price = parseAmount(interaction.fields.getTextInputValue('price'));
    await interaction.deferReply(EPHEMERAL);
    await actions.quoteOrder(guild, store, order, interaction.user.id, { price, note: interaction.fields.getTextInputValue('note') });
    return interaction.editReply(`✅ ${yen(price)} で見積もりを提示しました。`);
  }

  if (kind === 'delivermodal') {
    await interaction.deferReply(EPHEMERAL);
    const { dmOk } = await actions.deliverOrder(guild, store, order, interaction.user.id, interaction.fields.getTextInputValue('content'));
    return interaction.editReply(`✅ 納品しました。${dmOk ? '' : '\n⚠️ お客様の DM が閉じていたため、DM は送れませんでした (チャンネルには投稿済み)。'}`);
  }
  throw new UserError('不明な操作です。');
}

// ---------------------------------------------------------------- 振り分け
async function handleComponent(interaction, ctx) {
  const [scope, action, arg] = interaction.customId.split(':');

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'shop:select') return onShopSelect(interaction, ctx);
    if (interaction.customId === 'shop:cat') return onShopCategory(interaction, ctx);
  }
  if (interaction.isButton()) {
    if (scope === 'shop' && action === 'buy') return onShopBuy(interaction, ctx, arg);
    if (interaction.customId === 'service:request') return onServiceRequest(interaction);
    if (interaction.customId === 'verify') return onVerify(interaction, ctx);
    if (scope === 'order') return onOrderButton(interaction, ctx, action, Number(arg));
  }
  if (interaction.isModalSubmit()) {
    if (scope === 'shop' && action === 'order') return onShopOrderModal(interaction, ctx, arg);
    if (interaction.customId === 'service:modal') return onServiceModal(interaction, ctx);
    if (scope === 'order') return onOrderModal(interaction, ctx, action, Number(arg));
    if (scope === 'codes' && action === 'add') {
      if (!isStaff(interaction.member, ctx.store.getConfig(interaction.guildId))) throw new UserError('この操作は管理者専用です。');
      await interaction.deferReply(EPHEMERAL);
      const { addCodes } = require('../commands/codes');
      const lines = interaction.fields.getTextInputValue('codes').split(/\r?\n/);
      return interaction.editReply(await addCodes(interaction, ctx.store, arg, lines));
    }
    if (scope === 'announce' && action === 'post') {
      if (!isStaff(interaction.member, ctx.store.getConfig(interaction.guildId))) throw new UserError('この操作は管理者専用です。');
      const imageUrl = interaction.fields.getTextInputValue('image').trim();
      if (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl)) throw new UserError('画像は https:// で始まる URL にしてください');
      const ok = await actions.announce(interaction.guild, ctx.store, {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('body'),
        imageUrl: imageUrl || null,
        ping: arg === '1',
      });
      if (!ok) throw new UserError('お知らせチャンネルが未設定か、投稿できませんでした。`/config channels news:` で設定してください。');
      return interaction.reply({ content: '📣 お知らせを投稿しました。', ...EPHEMERAL });
    }
    if (interaction.customId === 'config:payment') {
      const text = interaction.fields.getTextInputValue('text').trim();
      ctx.store.setConfig(interaction.guildId, { paymentInfo: text });
      return interaction.reply({ content: `✅ お支払い方法を保存しました。\n>>> ${text}`, ...EPHEMERAL });
    }
  }
  return null;
}

module.exports = { handleComponent, parseAmount };

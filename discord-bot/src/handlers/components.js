'use strict';

const { LabelBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { modal } = require('../lib/modal');
const { isStaff } = require('../lib/perms');
const { createTicket, UserError } = require('../lib/tickets');
const { inStock, refreshShopPanel } = require('../lib/panels');
const actions = require('../lib/actions');
const { orderNo, yen, stars } = require('../lib/format');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

function parseAmount(text) {
  const n = Number(String(text).replace(/[¥￥,，円\s]/g, '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)));
  if (!Number.isInteger(n) || n < 0) throw new UserError('金額は数字で入力してください (例: 3000)');
  return n;
}

// ---------------------------------------------------------------- 購入
async function onShopSelect(interaction, { store }) {
  const product = store.getProduct(interaction.guildId, interaction.values[0]);
  if (!product) throw new UserError('この商品は販売終了しました。');
  if (!inStock(product)) throw new UserError('申し訳ありません、この商品は売り切れです。');
  const maxQty = product.stock === null ? 99 : Math.min(99, product.stock);
  return interaction.showModal(
    modal(`shop:order:${product.id}`, `ご注文: ${product.name}`.slice(0, 45), [
      { id: 'qty', label: `数量 (1〜${maxQty})`, description: `1 個 ${yen(product.price)}`, value: '1', max: 2 },
      { id: 'note', label: '備考 (任意)', long: true, required: false, max: 1000, placeholder: 'スタッフへの連絡事項があれば' },
    ]),
  );
}

async function onShopOrderModal(interaction, { store }, productId) {
  const product = store.getProduct(interaction.guildId, productId);
  if (!product) throw new UserError('この商品は販売終了しました。');
  const qty = Number(interaction.fields.getTextInputValue('qty').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)));
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new UserError('数量は 1〜99 の数字で入力してください。');
  if (product.stock !== null && product.stock < qty) {
    throw new UserError(product.stock > 0 ? `在庫が足りません (残り ${product.stock} 個)。` : 'この商品は売り切れです。');
  }
  await interaction.deferReply(EPHEMERAL);
  const { order, channel } = await createTicket(interaction, store, {
    type: 'product',
    productId: product.id,
    productName: product.name,
    quantity: qty,
    price: product.price * qty,
    note: interaction.fields.getTextInputValue('note'),
  });
  // メニューの選択状態を戻す (同じ商品をもう一度選べるように)
  await refreshShopPanel(interaction.guild, store);
  return interaction.editReply(`✅ ご注文 ${orderNo(order.number)} を受け付けました！ ${channel} でお支払い方法をご確認ください。`);
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
      await actions.markPaid(guild, store, order, interaction.user.id);
      return interaction.editReply('✅ 支払い確認済みにしました。準備ができたら「納品する」を押してください。');

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

  if (interaction.isStringSelectMenu() && interaction.customId === 'shop:select') return onShopSelect(interaction, ctx);
  if (interaction.isButton()) {
    if (interaction.customId === 'service:request') return onServiceRequest(interaction);
    if (interaction.customId === 'verify') return onVerify(interaction, ctx);
    if (scope === 'order') return onOrderButton(interaction, ctx, action, Number(arg));
  }
  if (interaction.isModalSubmit()) {
    if (scope === 'shop' && action === 'order') return onShopOrderModal(interaction, ctx, arg);
    if (interaction.customId === 'service:modal') return onServiceModal(interaction, ctx);
    if (scope === 'order') return onOrderModal(interaction, ctx, action, Number(arg));
    if (interaction.customId === 'config:payment') {
      const text = interaction.fields.getTextInputValue('text').trim();
      ctx.store.setConfig(interaction.guildId, { paymentInfo: text });
      return interaction.reply({ content: `✅ お支払い方法を保存しました。\n>>> ${text}`, ...EPHEMERAL });
    }
  }
  return null;
}

module.exports = { handleComponent, parseAmount };

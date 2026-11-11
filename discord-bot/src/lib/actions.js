'use strict';

const { EmbedBuilder } = require('discord.js');
const { closeTicket, refreshOrderMessage, UserError } = require('./tickets');
const { sendLog } = require('./log');
const { refreshShopPanel } = require('./panels');
const { COLORS, orderNo, yen, stars, truncate } = require('./format');

async function postToTicket(guild, order, payload) {
  if (!order.channelId) return;
  const channel = await guild.channels.fetch(order.channelId).catch(() => null);
  if (channel) await channel.send(payload).catch(() => {});
}

/** 代行の見積もりを提示 → お支払い待ちへ */
async function quoteOrder(guild, store, order, byUserId, { price, note }) {
  const updated = store.setStatus(guild.id, order.number, 'pending', byUserId, { price, quoteNote: note || '' });
  await refreshOrderMessage(guild, store, updated);
  await postToTicket(guild, updated, {
    content: `<@${updated.userId}> お見積もりは **${yen(price)}** です。内容をご確認のうえ、ピン留めの案内に沿ってお支払いください。`,
    allowedMentions: { users: [updated.userId] },
  });
  await sendLog(guild, store.getConfig(guild.id), {
    title: `💴 見積もり提示 ${orderNo(order.number)}`,
    color: COLORS.warn,
    description: `${yen(price)} — <@${byUserId}>`,
  });
  return updated;
}

/** 支払い確認 → 在庫を減らして対応中へ */
async function markPaid(guild, store, order, byUserId) {
  // 二重クリックで在庫を二回減らさないよう、在庫を触る前に最新の状態を確認する
  if (store.getOrder(guild.id, order.number)?.status !== 'pending') {
    throw new UserError('この注文はすでに処理済みか、お支払い待ちではありません。');
  }
  let stockTaken = false;
  if (order.type === 'product' && order.productId) {
    const product = store.getProduct(guild.id, order.productId);
    if (product) {
      if (!store.adjustStock(guild.id, order.productId, -order.quantity)) {
        throw new UserError(`在庫が足りません (残り ${product.stock} 個)。\`/product edit\` で在庫を増やすか、注文をキャンセルしてください。`);
      }
      stockTaken = true;
    }
  }
  const updated = store.setStatus(guild.id, order.number, 'paid', byUserId, { stockTaken });
  await refreshOrderMessage(guild, store, updated);
  if (stockTaken) await refreshShopPanel(guild, store);
  await postToTicket(guild, updated, {
    content: `<@${updated.userId}> ✅ お支払いを確認しました！ただいま準備しています。`,
    allowedMentions: { users: [updated.userId] },
  });
  await sendLog(guild, store.getConfig(guild.id), {
    title: `💰 支払い確認 ${orderNo(order.number)}`,
    color: COLORS.success,
    description: `${yen(updated.price)} — 確認: <@${byUserId}>`,
  });
  return updated;
}

/** 納品 → チケットに投稿・DM 送信・購入者ロール付与 */
async function deliverOrder(guild, store, order, byUserId, content) {
  const updated = store.setStatus(guild.id, order.number, 'delivered', byUserId, { deliveredAt: Date.now() });
  const config = store.getConfig(guild.id);

  const embed = new EmbedBuilder()
    .setTitle(`📦 納品 ${orderNo(order.number)}`)
    .setColor(COLORS.success)
    .setDescription(content ? truncate(content, 4000) : 'スタッフから納品されました。')
    .setFooter({ text: guild.name })
    .setTimestamp();
  if (updated.productName) embed.addFields({ name: '商品', value: `${updated.productName} × ${updated.quantity}` });

  await postToTicket(guild, updated, {
    content: `<@${updated.userId}> 納品しました！ご確認ください。`,
    embeds: [embed],
    allowedMentions: { users: [updated.userId] },
  });

  let dmOk = true;
  const member = await guild.members.fetch(updated.userId).catch(() => null);
  if (member) {
    await member.send({ content: `**${guild.name}** からの納品です。ご利用ありがとうございました！`, embeds: [embed] }).catch(() => {
      dmOk = false;
    });
    if (config.buyerRoleId) await member.roles.add(config.buyerRoleId, `注文 ${orderNo(order.number)} の納品`).catch(() => {});
  }

  await refreshOrderMessage(guild, store, updated);
  await sendLog(guild, config, {
    title: `📦 納品 ${orderNo(order.number)}`,
    color: COLORS.success,
    description: `お客様: <@${updated.userId}> / 担当: <@${byUserId}>${dmOk ? '' : '\n(お客様の DM が閉じていたため、DM は送れませんでした)'}`,
  });
  return { order: updated, dmOk };
}

/** キャンセル → 在庫を戻してチャンネルを閉じる */
async function cancelOrder(guild, store, order, byUserId, reason = '') {
  const updated = store.setStatus(guild.id, order.number, 'cancelled', byUserId, { cancelReason: reason });
  if (updated.stockTaken && updated.productId) {
    store.adjustStock(guild.id, updated.productId, updated.quantity);
    store.updateOrder(guild.id, updated.number, { stockTaken: false });
    await refreshShopPanel(guild, store);
  }
  await refreshOrderMessage(guild, store, updated);
  await postToTicket(guild, updated, `❌ この注文はキャンセルされました。${reason ? `\n理由: ${reason}` : ''}`);
  await closeTicket(guild, store, updated, { byUserId, title: `❌ キャンセル ${orderNo(order.number)}`, delayMs: 15000 });
  return updated;
}

/** 完了 → チャンネルを閉じる */
async function completeOrder(guild, store, order, byUserId) {
  const updated = store.setStatus(guild.id, order.number, 'closed', byUserId);
  await refreshOrderMessage(guild, store, updated);
  await closeTicket(guild, store, updated, { byUserId, title: `✅ 完了 ${orderNo(order.number)}` });
  return updated;
}

/** レビューを実績チャンネルに投稿 */
async function postReview(guild, store, order, user, rating, comment) {
  const updated = store.updateOrder(guild.id, order.number, { reviewed: true, rating, reviewComment: comment });
  const config = store.getConfig(guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.review)
    .setAuthor({ name: user.displayName ?? user.username, iconURL: user.displayAvatarURL() })
    .setTitle(`${stars(rating)}  (${rating}/5)`)
    .setDescription(comment ? truncate(comment, 2000) : 'コメントなし')
    .addFields({ name: 'ご利用内容', value: updated.productName ?? '代行サービス', inline: true })
    .setFooter({ text: `注文 ${orderNo(order.number)}` })
    .setTimestamp();
  if (config.reviewChannelId) {
    const channel = await guild.channels.fetch(config.reviewChannelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => {});
  }
  await refreshOrderMessage(guild, store, updated);
  return updated;
}

module.exports = { quoteOrder, markPaid, deliverOrder, cancelOrder, completeOrder, postReview };

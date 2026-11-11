'use strict';

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
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

/**
 * 支払い確認 → 在庫を減らして対応中へ。
 * 納品内容 (固定テキスト or コード在庫) がある商品は、そのまま自動で納品まで行う。
 */
async function markPaid(guild, store, order, byUserId) {
  // 二重クリックで在庫を二回減らさないよう、在庫を触る前に最新の状態を確認する
  if (store.getOrder(guild.id, order.number)?.status !== 'pending') {
    throw new UserError('この注文はすでに処理済みか、お支払い待ちではありません。');
  }
  const product = order.productId ? store.getProduct(guild.id, order.productId) : null;
  let stockTaken = false;
  let codes = [];
  if (order.type === 'product' && product) {
    if (Array.isArray(product.codes)) {
      const taken = store.takeCodes(guild.id, product.id, order.quantity);
      if (!taken) {
        throw new UserError(`コード在庫が足りません (残り ${product.codes.length} 個)。\`/codes add\` で追加するか、注文をキャンセルしてください。`);
      }
      codes = taken;
    } else if (!store.adjustStock(guild.id, product.id, -order.quantity)) {
      throw new UserError(`在庫が足りません (残り ${product.stock} 個)。\`/product edit\` で在庫を増やすか、注文をキャンセルしてください。`);
    }
    stockTaken = true;
  }
  const updated = store.setStatus(guild.id, order.number, 'paid', byUserId, { stockTaken, deliveredCodes: codes });
  if (stockTaken) await refreshShopPanel(guild, store);
  await sendLog(guild, store.getConfig(guild.id), {
    title: `💰 支払い確認 ${orderNo(order.number)}`,
    color: COLORS.success,
    description: `${yen(updated.price)} — 確認: <@${byUserId}>`,
  });

  const auto = product && product.autoDeliver !== false && (codes.length > 0 || product.delivery);
  if (auto) {
    const res = await deliverOrder(guild, store, updated, byUserId, product.delivery || '');
    return { order: res.order, autoDelivered: true, dmOk: res.dmOk };
  }

  await refreshOrderMessage(guild, store, updated);
  await postToTicket(guild, updated, {
    content: `<@${updated.userId}> ✅ お支払いを確認しました！ただいま準備しています。`,
    allowedMentions: { users: [updated.userId] },
  });
  return { order: updated, autoDelivered: false };
}

/** 納品メッセージ (コードが多いときは txt ファイルにする) */
function deliveryPayload(guild, order, content) {
  const embed = new EmbedBuilder()
    .setTitle(`📦 納品 ${orderNo(order.number)}`)
    .setColor(COLORS.success)
    .setDescription(content ? truncate(content, 4000) : 'ご注文の品をお渡しします。')
    .setFooter({ text: guild.name })
    .setTimestamp();
  if (order.productName) embed.addFields({ name: '商品', value: `${order.productName} × ${order.quantity}` });
  const files = [];
  const codes = order.deliveredCodes || [];
  if (codes.length) {
    const block = `\`\`\`\n${codes.join('\n')}\n\`\`\``;
    if (block.length <= 1024) {
      embed.addFields({ name: `🔑 コード (${codes.length})`, value: block });
    } else {
      embed.addFields({ name: `🔑 コード (${codes.length})`, value: '添付の txt ファイルをご確認ください' });
      files.push(new AttachmentBuilder(Buffer.from(codes.join('\n'), 'utf8'), { name: `codes-${order.number}.txt` }));
    }
  }
  return { embeds: [embed], files };
}

/** 納品 → チケットに投稿・DM 送信・購入者ロール付与 */
async function deliverOrder(guild, store, order, byUserId, content) {
  const updated = store.setStatus(guild.id, order.number, 'delivered', byUserId, { deliveredAt: Date.now() });
  const config = store.getConfig(guild.id);

  await postToTicket(guild, updated, {
    content: `<@${updated.userId}> 納品しました！ご確認ください。`,
    ...deliveryPayload(guild, updated, content),
    allowedMentions: { users: [updated.userId] },
  });

  let dmOk = false;
  const member = await guild.members.fetch(updated.userId).catch(() => null);
  if (member) {
    dmOk = await member
      .send({ content: `**${guild.name}** からの納品です。ご利用ありがとうございました！`, ...deliveryPayload(guild, updated, content) })
      .then(() => true)
      .catch(() => false);
    if (config.buyerRoleId) await member.roles.add(config.buyerRoleId, `注文 ${orderNo(order.number)} の納品`).catch(() => {});
  }

  await refreshOrderMessage(guild, store, updated);
  await sendLog(guild, config, {
    title: `📦 納品 ${orderNo(order.number)}`,
    color: COLORS.success,
    description: `お客様: <@${updated.userId}> / 担当: <@${byUserId}>${updated.deliveredCodes?.length ? ` / コード ${updated.deliveredCodes.length} 個` : ''}${dmOk ? '' : '\n(お客様の DM が閉じていたため、DM は送れませんでした)'}`,
  });
  return { order: updated, dmOk };
}

/** お客様からの「支払いました」報告 */
async function reportPayment(guild, store, order, userId, { method, note }) {
  if (order.status !== 'pending') throw new UserError('この注文は今、お支払い待ちではありません。');
  const updated = store.updateOrder(guild.id, order.number, { paymentReport: { method, note, at: Date.now() } });
  const config = store.getConfig(guild.id);
  const embed = new EmbedBuilder()
    .setTitle('💸 お支払いの報告がありました')
    .setColor(COLORS.warn)
    .addFields(
      { name: '支払い方法', value: truncate(method, 1024) || '—', inline: true },
      { name: '金額', value: yen(updated.price), inline: true },
      { name: 'メモ', value: truncate(note, 1024) || '—' },
    )
    .setFooter({ text: 'スタッフは入金を確認したら「支払いを確認」を押してください' });
  await postToTicket(guild, updated, {
    content: config.staffRoleId ? `<@&${config.staffRoleId}>` : '',
    embeds: [embed],
    allowedMentions: { roles: config.staffRoleId ? [config.staffRoleId] : [] },
  });
  await refreshOrderMessage(guild, store, updated);
  await sendLog(guild, config, {
    title: `💸 支払い報告 ${orderNo(order.number)}`,
    color: COLORS.warn,
    description: `<@${userId}> — ${truncate(method, 200)} / ${yen(updated.price)}${updated.channelId ? ` / <#${updated.channelId}>` : ''}`,
  });
  return updated;
}

/** キャンセル → 在庫を戻してチャンネルを閉じる */
async function cancelOrder(guild, store, order, byUserId, reason = '') {
  const updated = store.setStatus(guild.id, order.number, 'cancelled', byUserId, { cancelReason: reason });
  if (updated.stockTaken && updated.productId) {
    if (updated.deliveredCodes?.length) store.returnCodes(guild.id, updated.productId, updated.deliveredCodes);
    else store.adjustStock(guild.id, updated.productId, updated.quantity);
    store.updateOrder(guild.id, updated.number, { stockTaken: false, deliveredCodes: [] });
    await refreshShopPanel(guild, store);
  }
  if (updated.coupon) store.useCoupon(guild.id, updated.coupon, -1);
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

/** お知らせチャンネルに投稿 */
async function announce(guild, store, { title, description, imageUrl, color = COLORS.brand, ping = false }) {
  const config = store.getConfig(guild.id);
  if (!config.newsChannelId) return false;
  const channel = await guild.channels.fetch(config.newsChannelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const embed = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp();
  if (description) embed.setDescription(truncate(description, 4000));
  if (imageUrl) embed.setImage(imageUrl);
  const payload = { embeds: [embed] };
  if (ping) {
    payload.content = '@everyone';
    payload.allowedMentions = { parse: ['everyone'] };
  }
  return channel.send(payload).then(() => true).catch(() => false);
}

/** 新商品・再入荷を自動でお知らせする */
async function notifyProductChange(guild, store, product, { isNew = false, prevStock } = {}) {
  const config = store.getConfig(guild.id);
  if (!config.announceProducts || !product) return;
  const available = product.stock === null || product.stock > 0;
  if (!available) return;
  const where = config.shopPanel ? `\n<#${config.shopPanel.channelId}> から購入できます。` : '';
  if (isNew) {
    await announce(guild, store, {
      title: `🆕 新商品: ${product.emoji ? `${product.emoji} ` : ''}${product.name}`,
      description: `**${yen(product.price)}**\n${product.description || ''}${where}`,
      imageUrl: product.imageUrl,
      color: COLORS.success,
    });
  } else if (prevStock === 0) {
    await announce(guild, store, {
      title: `📦 再入荷: ${product.emoji ? `${product.emoji} ` : ''}${product.name}`,
      description: `**${yen(product.price)}** / ${product.stock === null ? '在庫あり' : `残り ${product.stock} 個`}${where}`,
      imageUrl: product.imageUrl,
      color: COLORS.success,
    });
  }
}

/** お支払い待ちのまま放置された注文を自動キャンセルする (定期実行) */
async function sweepExpiredOrders(client, store, now = Date.now()) {
  let count = 0;
  for (const guildId of Object.keys(store.data.guilds)) {
    const config = store.getConfig(guildId);
    if (!config.autoCancelHours) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const order of store.listOrders(guildId, { status: 'pending' })) {
      if (order.paymentReport) continue; // 支払い報告済みはスタッフの確認待ちなので消さない
      const since = [...order.history].reverse().find((h) => h.status === 'pending')?.at ?? order.createdAt;
      if (now - since < config.autoCancelHours * 3600_000) continue;
      try {
        await cancelOrder(guild, store, order, client.user.id, `${config.autoCancelHours} 時間以内にお支払いが確認できなかったため、自動でキャンセルしました`);
        count++;
      } catch (err) {
        console.warn('[sweep] 自動キャンセルに失敗:', err.message);
      }
    }
  }
  return count;
}

module.exports = {
  quoteOrder,
  markPaid,
  deliverOrder,
  reportPayment,
  cancelOrder,
  completeOrder,
  postReview,
  announce,
  notifyProductChange,
  sweepExpiredOrders,
};

'use strict';

const { AttachmentBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { buildOrderView } = require('./orderView');
const { sendLog } = require('./log');
const { COLORS, orderNo, yen, statusText } = require('./format');
const { UserError } = require('./errors');

const P = PermissionFlagsBits;
const MEMBER_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];


/** 注文を作り、お客様とスタッフだけが見られるチケットチャンネルを作成する */
async function createTicket(interaction, store, data) {
  const guild = interaction.guild;
  const config = store.getConfig(guild.id);
  const userId = interaction.user.id;

  const open = store.openOrdersOf(guild.id, userId);
  if (open.length >= config.maxOpenTickets) {
    const links = open.map((o) => (o.channelId ? `<#${o.channelId}>` : orderNo(o.number))).join(' ');
    throw new UserError(`進行中の注文が ${open.length} 件あります。完了してから新しく注文してください。\n${links}`);
  }

  const order = store.createOrder(guild.id, { ...data, userId });

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    { id: userId, allow: MEMBER_ALLOW },
    { id: interaction.client.user.id, allow: [...MEMBER_ALLOW, P.ManageChannels, P.ManageMessages] },
  ];
  if (config.staffRoleId && guild.roles.cache.has(config.staffRoleId)) {
    overwrites.push({ id: config.staffRoleId, allow: [...MEMBER_ALLOW, P.ManageMessages] });
  }

  let parent = null;
  if (config.ticketCategoryId) {
    parent = await guild.channels.fetch(config.ticketCategoryId).catch(() => null);
  }

  let channel;
  try {
    channel = await guild.channels.create({
      name: `${data.type === 'service' ? '代行' : '注文'}-${String(order.number).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent: parent?.type === ChannelType.GuildCategory ? parent.id : null,
      topic: `${orderNo(order.number)} / お客様: ${interaction.user.tag} (${userId})`,
      permissionOverwrites: overwrites,
      reason: `注文 ${orderNo(order.number)} のチケット`,
    });
  } catch (err) {
    store.setStatus(guild.id, order.number, 'cancelled', interaction.client.user.id, { cancelReason: 'チャンネル作成に失敗' });
    console.error('[ticket] チャンネル作成に失敗:', err);
    throw new UserError('注文チャンネルを作れませんでした。Bot に「チャンネルの管理」権限があるか、管理者に確認してください。');
  }

  const mention = [`<@${userId}>`];
  if (config.staffRoleId) mention.push(`<@&${config.staffRoleId}>`);
  const message = await channel.send({
    content: `${mention.join(' ')} 新しい${data.type === 'service' ? '代行依頼' : '注文'}です。`,
    ...buildOrderView(order, config),
    allowedMentions: { users: [userId], roles: config.staffRoleId ? [config.staffRoleId] : [] },
  });
  await message.pin().catch(() => {});
  store.updateOrder(guild.id, order.number, { channelId: channel.id, controlMessageId: message.id });

  await sendLog(guild, config, {
    title: `🆕 ${data.type === 'service' ? '代行依頼' : '注文'} ${orderNo(order.number)}`,
    color: COLORS.brand,
    fields: [
      { name: 'お客様', value: `<@${userId}>`, inline: true },
      { name: '内容', value: order.productName ? `${order.productName} × ${order.quantity}` : '代行', inline: true },
      { name: '金額', value: yen(order.price), inline: true },
      { name: 'チャンネル', value: `<#${channel.id}>` },
    ],
  });

  return { order, channel };
}

/** チケット内の注文カードを最新の状態に書き換える */
async function refreshOrderMessage(guild, store, order) {
  const config = store.getConfig(guild.id);
  if (!order.channelId || !order.controlMessageId) return;
  const channel = await guild.channels.fetch(order.channelId).catch(() => null);
  if (!channel) return;
  const message = await channel.messages.fetch(order.controlMessageId).catch(() => null);
  const view = buildOrderView(order, config);
  if (message) await message.edit(view).catch(() => {});
  else await channel.send(view).catch(() => {});
}

/** チャンネルの会話をテキストにまとめる (最大 500 件) */
async function buildTranscript(channel) {
  const all = [];
  let before;
  for (let i = 0; i < 5; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  all.reverse();
  const lines = all.map((m) => {
    const time = new Date(m.createdTimestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    let text = m.content || '';
    for (const e of m.embeds) {
      text += `\n  [埋め込み] ${e.title ?? ''} ${e.description ?? ''}`;
      for (const f of e.fields ?? []) text += `\n    ${f.name}: ${f.value}`;
    }
    for (const a of m.attachments.values()) text += `\n  [添付] ${a.url}`;
    return `[${time}] ${m.author.tag}: ${text}`;
  });
  return lines.join('\n');
}

/** 会話ログをログチャンネルに保存してからチャンネルを削除する */
async function closeTicket(guild, store, order, { byUserId, title, delayMs = 5000 }) {
  const config = store.getConfig(guild.id);
  const channel = order.channelId ? await guild.channels.fetch(order.channelId).catch(() => null) : null;
  const files = [];
  if (channel) {
    const transcript = await buildTranscript(channel);
    if (transcript) {
      files.push(
        new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `order-${String(order.number).padStart(4, '0')}.txt` }),
      );
    }
  }
  await sendLog(guild, config, {
    title,
    color: order.status === 'cancelled' ? COLORS.danger : COLORS.success,
    fields: [
      { name: 'お客様', value: `<@${order.userId}>`, inline: true },
      { name: '状態', value: statusText(order.status), inline: true },
      { name: '金額', value: yen(order.price), inline: true },
      { name: '操作した人', value: `<@${byUserId}>` },
    ],
    files,
  });
  if (channel) {
    await channel.send(`🔒 このチャンネルは ${Math.round(delayMs / 1000)} 秒後に削除されます。`).catch(() => {});
    setTimeout(() => {
      channel.delete(`注文 ${orderNo(order.number)} を閉じました`).catch((err) => console.warn('[ticket] 削除に失敗:', err.message));
    }, delayMs);
  }
}

module.exports = { createTicket, refreshOrderMessage, closeTicket, UserError };

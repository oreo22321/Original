'use strict';

const { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isStaff } = require('../lib/perms');
const { cancelOrder } = require('../lib/actions');
const { buildOrderView } = require('../lib/orderView');
const { COLORS, STATUS, orderNo, statusText, yen, ts } = require('../lib/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('order')
    .setDescription('注文の管理 (スタッフ用)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('注文の一覧')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('状態で絞り込む')
            .addChoices(...Object.entries(STATUS).map(([value, s]) => ({ name: `${s.emoji} ${s.label}`, value }))),
        )
        .addUserOption((o) => o.setName('user').setDescription('お客様で絞り込む')),
    )
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('注文の詳細')
        .addIntegerOption((o) => o.setName('number').setDescription('注文番号 (#0012 なら 12)').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('注文をキャンセル (チャンネルも閉じます)')
        .addIntegerOption((o) => o.setName('number').setDescription('注文番号').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('reason').setDescription('理由 (お客様にも表示)').setMaxLength(500)),
    ),

  async execute(interaction, { store }) {
    const gid = interaction.guildId;
    const config = store.getConfig(gid);
    if (!isStaff(interaction.member, config)) {
      return interaction.reply({ content: '❌ このコマンドはスタッフ専用です。', flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const status = interaction.options.getString('status');
      const user = interaction.options.getUser('user');
      const orders = store.listOrders(gid, { status: status ?? undefined, userId: user?.id });
      const lines = orders.slice(0, 30).map(
        (o) =>
          `**${orderNo(o.number)}** ${statusText(o.status)} — ${o.productName ? `${o.productName}×${o.quantity}` : '代行'} / ${yen(o.price)} / <@${o.userId}> ${o.channelId && !['closed', 'cancelled'].includes(o.status) ? `<#${o.channelId}>` : ''} ${ts(o.createdAt, 'R')}`,
      );
      const embed = new EmbedBuilder()
        .setTitle(`📋 注文一覧 (${orders.length} 件)`)
        .setColor(COLORS.brand)
        .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : '該当する注文はありません。');
      if (orders.length > 30) embed.setFooter({ text: '新しい 30 件だけ表示しています' });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const order = store.getOrder(gid, interaction.options.getInteger('number'));
    if (!order) return interaction.reply({ content: '❌ その注文は見つかりません。', flags: MessageFlags.Ephemeral });

    if (sub === 'info') {
      const view = buildOrderView(order, config);
      view.embeds[0].addFields({
        name: '履歴',
        value: order.history.map((h) => `${ts(h.at, 'f')} ${statusText(h.status)} (<@${h.by}>)`).join('\n').slice(0, 1024),
      });
      return interaction.reply({ embeds: view.embeds, flags: MessageFlags.Ephemeral });
    }

    // cancel
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await cancelOrder(interaction.guild, store, order, interaction.user.id, interaction.options.getString('reason') ?? '');
    return interaction.editReply(`✅ ${orderNo(order.number)} をキャンセルしました。`);
  },
};

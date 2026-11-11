'use strict';

const { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { COLORS, orderNo, statusText, yen, ts } = require('../lib/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myorders')
    .setDescription('自分の注文履歴を見る (自分だけに表示)')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction, { store }) {
    const orders = store.listOrders(interaction.guildId, { userId: interaction.user.id }).slice(0, 20);
    const open = ['quote', 'pending', 'paid', 'delivered'];
    const embed = new EmbedBuilder()
      .setTitle('🧾 あなたの注文')
      .setColor(COLORS.brand)
      .setDescription(
        orders.length
          ? orders
              .map(
                (o) =>
                  `**${orderNo(o.number)}** ${statusText(o.status)} — ${o.productName ? `${o.productName}×${o.quantity}` : '代行'} / ${yen(o.price)} ${ts(o.createdAt, 'd')}${open.includes(o.status) && o.channelId ? ` → <#${o.channelId}>` : ''}`,
              )
              .join('\n')
          : 'まだ注文はありません。',
      )
      .setFooter({ text: '納品済みの内容は、Bot からの DM でも確認できます' });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

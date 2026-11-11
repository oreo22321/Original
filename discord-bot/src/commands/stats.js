'use strict';

const {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { COLORS, STATUS, yen } = require('../lib/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('売上と注文の集計 (管理者用)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction, { store }) {
    const s = store.stats(interaction.guildId);
    const embed = new EmbedBuilder()
      .setTitle('📊 売上レポート')
      .setColor(COLORS.brand)
      .addFields(
        { name: '売上合計 (納品済み)', value: yen(s.revenue), inline: true },
        { name: '納品件数', value: `${s.completed} 件`, inline: true },
        {
          name: '平均評価',
          value: s.avgRating === null ? 'レビューなし' : `★ ${s.avgRating.toFixed(2)} (${s.reviewCount} 件)`,
          inline: true,
        },
        {
          name: `注文の状態 (全 ${s.total} 件)`,
          value: Object.entries(STATUS)
            .map(([k, v]) => `${v.emoji} ${v.label}: **${s.byStatus[k] ?? 0}**`)
            .join('\n'),
        },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

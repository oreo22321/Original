'use strict';

const { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isStaff } = require('../lib/perms');
const { COLORS } = require('../lib/format');

const CUSTOMER = [
  '`/shop` 商品一覧を見て購入',
  '`/myorders` 自分の注文履歴',
  '注文すると専用チャンネルができます。お支払い後に **「支払いました」** を押してください。',
].join('\n');

const STAFF = [
  '**はじめに**: `/setup` → `/config payment` → `/product add`',
  '`/product add|edit|remove|list` 商品の管理',
  '`/codes add|view|clear` 1 個ずつ違うコードの自動納品在庫',
  '`/coupon create|list|delete` 割引クーポン',
  '`/order list|info|cancel` 注文の管理',
  '`/announce` お知らせを投稿 / `/stats` 売上',
  '`/blacklist` 注文できない人の管理',
  '`/panel` パネルの設置 / `/config` 各種設定',
  '',
  '**注文チャンネルでの操作**',
  '💴 見積もり (代行) → 💰 支払いを確認 → 📦 納品 (自動納品の商品は支払い確認だけで完了)',
].join('\n');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('使い方を見る').setContexts(InteractionContextType.Guild),

  async execute(interaction, { store }) {
    const embed = new EmbedBuilder()
      .setTitle('📖 使い方')
      .setColor(COLORS.brand)
      .addFields({ name: '🛒 お客様', value: CUSTOMER });
    if (isStaff(interaction.member, store.getConfig(interaction.guildId))) {
      embed.addFields({ name: '🛠️ スタッフ・管理者', value: STAFF });
    }
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

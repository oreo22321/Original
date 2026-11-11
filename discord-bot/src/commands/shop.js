'use strict';

const { InteractionContextType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { buildShopPanel } = require('../lib/panels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('商品一覧を見て購入する (自分だけに表示)')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction, { store }) {
    return interaction.reply({ ...buildShopPanel(store.listProducts(interaction.guildId)), flags: MessageFlags.Ephemeral });
  },
};

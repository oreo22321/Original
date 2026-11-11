'use strict';

const {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { buildServicePanel, buildShopPanel, buildVerifyPanel } = require('../lib/panels');

function channelOption(o) {
  return o
    .setName('channel')
    .setDescription('設置するチャンネル (省略するとこのチャンネル)')
    .addChannelTypes(ChannelType.GuildText);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('購入・依頼・認証のパネルを設置 (管理者用)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('shop').setDescription('商品一覧と購入メニュー (商品を変えると自動で更新)').addChannelOption(channelOption))
    .addSubcommand((s) => s.setName('service').setDescription('代行依頼ボタン').addChannelOption(channelOption))
    .addSubcommand((s) => s.setName('verify').setDescription('認証ボタン').addChannelOption(channelOption)),

  async execute(interaction, { store }) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const payload =
      sub === 'shop'
        ? buildShopPanel(store.listProducts(interaction.guildId))
        : sub === 'service'
          ? buildServicePanel()
          : buildVerifyPanel();

    const message = await channel.send(payload);
    if (sub === 'shop') store.setConfig(interaction.guildId, { shopPanel: { channelId: channel.id, messageId: message.id } });

    let note = '';
    if (sub === 'verify' && !store.getConfig(interaction.guildId).verifiedRoleId) {
      note = '\n⚠️ 認証ロールが未設定です。`/config roles` で設定するか `/setup` を実行してください。';
    }
    return interaction.reply({ content: `✅ <#${channel.id}> にパネルを設置しました。${note}`, flags: MessageFlags.Ephemeral });
  },
};

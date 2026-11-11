'use strict';

const {
  AttachmentBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('このサーバーの商品・注文・設定データをファイルで受け取る (管理者用)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction, { store }) {
    const data = store.guild(interaction.guildId);
    const date = new Date().toISOString().slice(0, 10);
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2), 'utf8'), {
      name: `shop-backup-${date}.json`,
    });
    return interaction.reply({
      content:
        '💾 バックアップです (自分だけに表示)。スマホなら長押し →「保存」で端末に保存できます。\n' +
        '⚠️ 自動納品用のコードも含まれるので、他の人に渡さないでください。',
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
  },
};

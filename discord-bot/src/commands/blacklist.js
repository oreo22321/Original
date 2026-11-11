'use strict';

const { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { ts } = require('../lib/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('注文できない人を管理 (いたずら・未払い対策 / 管理者用)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('注文できないようにする')
        .addUserOption((o) => o.setName('user').setDescription('ユーザー').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('理由 (スタッフ用のメモ)').setMaxLength(200)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('解除する')
        .addUserOption((o) => o.setName('user').setDescription('ユーザー').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('一覧')),

  async execute(interaction, { store }) {
    const gid = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');

    if (sub === 'add') {
      store.setBlacklist(gid, user.id, {
        reason: interaction.options.getString('reason') ?? '',
        at: Date.now(),
        by: interaction.user.id,
      });
      return interaction.reply({ content: `🚫 ${user} は注文できなくなりました。`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'remove') {
      store.setBlacklist(gid, user.id, null);
      return interaction.reply({ content: `✅ ${user} のブラックリストを解除しました。`, flags: MessageFlags.Ephemeral });
    }
    const entries = Object.entries(store.getConfig(gid).blacklist);
    return interaction.reply({
      content: entries.length
        ? entries.map(([id, e]) => `<@${id}> — ${e.reason || '理由なし'} (${ts(e.at, 'd')} / <@${e.by}>)`).join('\n').slice(0, 1900)
        : 'ブラックリストは空です。',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

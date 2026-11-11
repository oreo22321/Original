'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { modal } = require('../lib/modal');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('お知らせチャンネルに投稿 (セール・営業時間など / 管理者用)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addBooleanOption((o) => o.setName('everyone').setDescription('@everyone で全員に通知する')),

  async execute(interaction) {
    const ping = interaction.options.getBoolean('everyone') ? '1' : '0';
    return interaction.showModal(
      modal(`announce:post:${ping}`, 'お知らせを投稿', [
        { id: 'title', label: 'タイトル', max: 200, placeholder: '例: 🎉 週末セール開催！' },
        { id: 'body', label: '本文', long: true, max: 4000 },
        { id: 'image', label: '画像 URL (任意)', required: false, max: 500, placeholder: 'https://...' },
      ]),
    );
  },
};

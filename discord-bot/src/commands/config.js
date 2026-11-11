'use strict';

const {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { modal } = require('../lib/modal');
const { COLORS } = require('../lib/format');

const show = (id, kind) => (id ? (kind === 'role' ? `<@&${id}>` : `<#${id}>`) : '未設定');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('ショップの設定 (管理者用)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('show').setDescription('今の設定を見る'))
    .addSubcommand((s) => s.setName('payment').setDescription('お支払い方法の案内文を設定 (PayPay・振込先など)'))
    .addSubcommand((s) =>
      s
        .setName('roles')
        .setDescription('ロールを設定')
        .addRoleOption((o) => o.setName('staff').setDescription('スタッフロール (注文チャンネルが見られる)'))
        .addRoleOption((o) => o.setName('buyer').setDescription('購入者ロール (納品時に自動で付く)'))
        .addRoleOption((o) => o.setName('verified').setDescription('認証ボタンで付くロール')),
    )
    .addSubcommand((s) =>
      s
        .setName('channels')
        .setDescription('チャンネルを設定')
        .addChannelOption((o) => o.setName('log').setDescription('ログチャンネル').addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('review').setDescription('レビュー投稿先').addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('news').setDescription('お知らせ (新商品・再入荷・/announce) の投稿先').addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) =>
          o.setName('ticket_category').setDescription('注文チャンネルを作るカテゴリ').addChannelTypes(ChannelType.GuildCategory),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('autocancel')
        .setDescription('お支払い待ちのまま放置された注文を自動キャンセルするまでの時間')
        .addIntegerOption((o) => o.setName('hours').setDescription('時間 (0 で自動キャンセルしない)').setRequired(true).setMinValue(0).setMaxValue(720)),
    )
    .addSubcommand((s) =>
      s
        .setName('notify')
        .setDescription('新商品・再入荷をお知らせチャンネルに自動投稿するか')
        .addBooleanOption((o) => o.setName('enabled').setDescription('する / しない').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('limit')
        .setDescription('1 人が同時に開ける注文の数')
        .addIntegerOption((o) => o.setName('count').setDescription('件数 (1〜10)').setRequired(true).setMinValue(1).setMaxValue(10)),
    ),

  async execute(interaction, { store }) {
    const gid = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const opt = interaction.options;

    if (sub === 'payment') {
      const current = store.getConfig(gid).paymentInfo;
      return interaction.showModal(
        modal('config:payment', 'お支払い方法の案内', [
          {
            id: 'text',
            label: '案内文',
            description: '注文チャンネルでお客様に表示されます',
            long: true,
            max: 1500,
            value: current.includes('/config payment') ? '' : current,
            placeholder: '例)\n・PayPay: ID xxxxx (送金後にスクショを送ってください)\n・銀行振込: ○○銀行 ○○支店 普通 1234567',
          },
        ]),
      );
    }

    if (sub === 'roles') {
      const patch = {};
      if (opt.getRole('staff')) patch.staffRoleId = opt.getRole('staff').id;
      if (opt.getRole('buyer')) patch.buyerRoleId = opt.getRole('buyer').id;
      if (opt.getRole('verified')) patch.verifiedRoleId = opt.getRole('verified').id;
      store.setConfig(gid, patch);
    } else if (sub === 'channels') {
      const patch = {};
      if (opt.getChannel('log')) patch.logChannelId = opt.getChannel('log').id;
      if (opt.getChannel('review')) patch.reviewChannelId = opt.getChannel('review').id;
      if (opt.getChannel('news')) patch.newsChannelId = opt.getChannel('news').id;
      if (opt.getChannel('ticket_category')) patch.ticketCategoryId = opt.getChannel('ticket_category').id;
      store.setConfig(gid, patch);
    } else if (sub === 'autocancel') {
      store.setConfig(gid, { autoCancelHours: opt.getInteger('hours') });
    } else if (sub === 'notify') {
      store.setConfig(gid, { announceProducts: opt.getBoolean('enabled') });
    } else if (sub === 'limit') {
      store.setConfig(gid, { maxOpenTickets: opt.getInteger('count') });
    }

    const c = store.getConfig(gid);
    const embed = new EmbedBuilder()
      .setTitle(sub === 'show' ? '⚙️ 現在の設定' : '✅ 設定を保存しました')
      .setColor(COLORS.brand)
      .addFields(
        { name: 'スタッフロール', value: show(c.staffRoleId, 'role'), inline: true },
        { name: '購入者ロール', value: show(c.buyerRoleId, 'role'), inline: true },
        { name: '認証ロール', value: show(c.verifiedRoleId, 'role'), inline: true },
        { name: 'ログ', value: show(c.logChannelId), inline: true },
        { name: 'レビュー', value: show(c.reviewChannelId), inline: true },
        { name: '注文カテゴリ', value: show(c.ticketCategoryId), inline: true },
        { name: '商品一覧パネル', value: c.shopPanel ? `<#${c.shopPanel.channelId}>` : '未設置', inline: true },
        { name: 'お知らせ', value: show(c.newsChannelId), inline: true },
        { name: '同時注文数の上限', value: `${c.maxOpenTickets} 件`, inline: true },
        { name: '未払いの自動キャンセル', value: c.autoCancelHours ? `${c.autoCancelHours} 時間後` : 'しない', inline: true },
        { name: '新商品・再入荷のお知らせ', value: c.announceProducts ? 'する' : 'しない', inline: true },
        { name: 'お支払い方法', value: c.paymentInfo.slice(0, 1024) },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

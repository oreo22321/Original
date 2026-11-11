'use strict';

const {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { buildServicePanel, buildShopPanel, buildVerifyPanel } = require('../lib/panels');
const { COLORS } = require('../lib/format');

const P = PermissionFlagsBits;
const BOT_ALLOW = [
  P.ViewChannel,
  P.SendMessages,
  P.ReadMessageHistory,
  P.EmbedLinks,
  P.AttachFiles,
  P.ManageChannels,
  P.ManageMessages,
];

const ROLES = {
  staff: { name: 'スタッフ', color: 0x3498db, hoist: true },
  buyer: { name: '購入者', color: 0x2ecc71, hoist: true },
  verified: { name: '認証済み', color: 0x95a5a6, hoist: false },
};

// access: public = 誰でも見える / verified = 認証済みのみ / staff = スタッフのみ
const LAYOUT = [
  {
    name: '📢 インフォメーション',
    access: 'public',
    channels: [
      { key: 'rules', name: '📌｜ルール', readOnly: true, topic: 'サーバーのルールと利用規約' },
      { key: 'news', name: '📣｜お知らせ', readOnly: true, topic: '新商品・セール・営業時間などのお知らせ' },
      { key: 'verify', name: '✅｜認証', readOnly: true, topic: 'ボタンを押すとショップが見られるようになります' },
    ],
  },
  {
    name: '🛒 ショップ',
    access: 'verified',
    channels: [
      { key: 'shop', name: '🛍️｜商品一覧', readOnly: true, topic: 'メニューから商品を選んで購入できます' },
      { key: 'service', name: '🧾｜代行依頼', readOnly: true, topic: 'ボタンから代行を依頼できます' },
      { key: 'reviews', name: '⭐｜実績・レビュー', readOnly: true, topic: 'お客様からのレビュー' },
    ],
  },
  {
    name: '💬 コミュニティ',
    access: 'verified',
    channels: [
      { key: 'chat', name: '💬｜雑談', topic: 'ご自由にどうぞ' },
      { key: 'help', name: '❓｜質問', topic: '商品や代行についての質問はこちら' },
    ],
  },
  { key: 'tickets', name: '🎫 チケット', access: 'staff', channels: [] },
  {
    name: '🔒 スタッフ',
    access: 'staff',
    channels: [
      { key: 'staffchat', name: '📋｜スタッフ連絡', topic: 'スタッフ専用' },
      { key: 'log', name: '📜｜ログ', readOnly: true, topic: '注文・支払い・納品の記録 (Bot が自動で書き込みます)' },
    ],
  },
];

const RULES_TEXT = [
  '**1. 基本ルール**',
  '・他の利用者への迷惑行為、荒らし、宣伝、なりすましは禁止です。',
  '・Discord の利用規約・コミュニティガイドラインを守ってください。',
  '',
  '**2. ご購入・ご依頼について**',
  '・ご注文は「商品一覧」、代行は「代行依頼」チャンネルから行えます。',
  '・注文するとあなた専用のチャンネルが作られ、スタッフとやり取りできます。',
  '・お支払いの確認後に納品・作業開始となります。',
  '・お支払い後のキャンセル・返金は、原則としてお受けできません（当店に原因がある場合を除く）。',
  '',
  '**3. 禁止事項**',
  '・購入した商品の無断転売・再配布',
  '・虚偽の支払い報告',
  '・スタッフへの暴言・脅迫',
  '',
  '違反があった場合、警告なくサーバーから退出いただく場合があります。',
  '上記に同意いただける方は「✅｜認証」チャンネルのボタンを押してください。',
].join('\n');

function overwritesFor(access, readOnly, guild, roles, botId) {
  const everyone = guild.roles.everyone.id;
  const list = [{ id: botId, allow: BOT_ALLOW }];
  const everyoneDeny = [];
  const everyoneAllow = [];
  if (access === 'public') everyoneAllow.push(P.ViewChannel);
  else everyoneDeny.push(P.ViewChannel);
  if (readOnly) everyoneDeny.push(P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads);
  list.push({ id: everyone, allow: everyoneAllow, deny: everyoneDeny });
  if (access === 'verified') list.push({ id: roles.verified.id, allow: [P.ViewChannel] });
  list.push({ id: roles.staff.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages] });
  return list;
}

async function ensureRole(guild, spec, created) {
  const existing = guild.roles.cache.find((r) => r.name === spec.name);
  if (existing) return existing;
  created.push(`ロール「${spec.name}」`);
  return guild.roles.create({
    name: spec.name,
    colors: { primaryColor: spec.color },
    hoist: spec.hoist,
    mentionable: false,
    permissions: [],
    reason: '/setup によるショップ構築',
  });
}

async function ensureChannel(guild, { name, type, parent, topic, permissionOverwrites }, created) {
  const existing = guild.channels.cache.find(
    (c) => c.name === name && c.type === type && (type === ChannelType.GuildCategory || c.parentId === (parent ?? null)),
  );
  if (existing) {
    await existing.permissionOverwrites.set(permissionOverwrites, '/setup による権限の更新');
    return { channel: existing, isNew: false };
  }
  created.push(`${type === ChannelType.GuildCategory ? 'カテゴリ' : 'チャンネル'}「${name}」`);
  const channel = await guild.channels.create({
    name,
    type,
    parent: parent ?? undefined,
    topic: type === ChannelType.GuildText ? topic : undefined,
    permissionOverwrites,
    reason: '/setup によるショップ構築',
  });
  return { channel, isNew: true };
}

/** Bot がまだ投稿していないチャンネルにだけ投稿する (再実行で重複させない) */
async function postOnce(channel, botId, payload) {
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (recent && recent.some((m) => m.author.id === botId)) return null;
  return channel.send(payload);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('ショップ用のロール・チャンネル・パネルを自動で作ります (管理者用)')
    .setDefaultMemberPermissions(P.ManageGuild)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction, { store }) {
    const guild = interaction.guild;
    const me = guild.members.me;
    const missing = [];
    if (!me.permissions.has(P.ManageChannels)) missing.push('チャンネルの管理');
    if (!me.permissions.has(P.ManageRoles)) missing.push('ロールの管理');
    if (missing.length) {
      return interaction.reply({
        content: `❌ Bot に次の権限がありません: **${missing.join('・')}**\nサーバー設定 → ロール → Bot のロールで権限を付けてから、もう一度実行してください。`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const created = [];
    const botId = interaction.client.user.id;

    const roles = {};
    for (const [key, spec] of Object.entries(ROLES)) roles[key] = await ensureRole(guild, spec, created);

    const channels = {};
    const fresh = {};
    for (const cat of LAYOUT) {
      const { channel: category } = await ensureChannel(
        guild,
        {
          name: cat.name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: overwritesFor(cat.access, false, guild, roles, botId),
        },
        created,
      );
      if (cat.key) channels[cat.key] = category;
      for (const ch of cat.channels) {
        const { channel, isNew } = await ensureChannel(
          guild,
          {
            name: ch.name,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: ch.topic,
            permissionOverwrites: overwritesFor(cat.access, ch.readOnly, guild, roles, botId),
          },
          created,
        );
        channels[ch.key] = channel;
        fresh[ch.key] = isNew;
      }
    }

    // 各チャンネルに案内・パネルを投稿
    await postOnce(channels.rules, botId, {
      embeds: [new EmbedBuilder().setTitle('📌 ルール・利用規約').setColor(COLORS.brand).setDescription(RULES_TEXT)],
    });
    await postOnce(channels.verify, botId, buildVerifyPanel());
    await postOnce(channels.service, botId, buildServicePanel());
    const shopMsg = await postOnce(channels.shop, botId, buildShopPanel(store.listProducts(guild.id)));

    const patch = {
      staffRoleId: roles.staff.id,
      buyerRoleId: roles.buyer.id,
      verifiedRoleId: roles.verified.id,
      ticketCategoryId: channels.tickets.id,
      logChannelId: channels.log.id,
      reviewChannelId: channels.reviews.id,
      newsChannelId: channels.news.id,
    };
    if (shopMsg) patch.shopPanel = { channelId: channels.shop.id, messageId: shopMsg.id };
    const config = store.setConfig(guild.id, patch);

    const embed = new EmbedBuilder()
      .setTitle('✅ ショップの準備ができました')
      .setColor(COLORS.success)
      .setDescription(
        [
          created.length ? `**新しく作ったもの**\n${created.map((c) => `・${c}`).join('\n')}` : '作り直すものはありませんでした（権限だけ最新にしました）。',
          '',
          '**次にやること**',
          '1. `/config payment` で支払い方法 (PayPay・振込先など) を登録',
          `2. スタッフに <@&${roles.staff.id}> ロールを付ける`,
          '3. `/product add` で商品を登録 (商品一覧パネルが自動で更新され、お知らせにも投稿されます)',
          '　 1 個ずつ違うコードを売るなら `/codes add` で登録すると、支払い確認だけで自動納品されます',
          '4. ルール文は「📌｜ルール」のメッセージを自分のお店に合わせて投稿し直してください',
          '',
          `⚠️ Bot のロールは、サーバー設定 → ロール で **${roles.staff.name}・${roles.buyer.name}・${roles.verified.name} より上** に置いてください（ロールを付けられなくなります）。`,
        ].join('\n'),
      );
    if (!config.paymentInfo || config.paymentInfo.includes('/config payment')) {
      embed.setFooter({ text: '支払い方法がまだ未設定です' });
    }
    await interaction.editReply({ embeds: [embed] });
  },
};

'use strict';

const {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { COLORS, yen, ts } = require('../lib/format');
const { UserError } = require('../lib/errors');

function describe(c, store, guildId) {
  const off = c.type === 'percent' ? `${c.value}% OFF` : `${yen(c.value)} 引き`;
  const uses = c.maxUses === null ? `${c.uses} 回使用` : `${c.uses}/${c.maxUses} 回`;
  const exp = c.expiresAt ? `〜${ts(c.expiresAt, 'f')}${Date.now() > c.expiresAt ? ' (期限切れ)' : ''}` : '期限なし';
  const target = c.productId ? store.getProduct(guildId, c.productId)?.name ?? '(削除された商品)' : '全商品';
  return `\`${c.code}\` **${off}** / ${uses} / ${exp} / ${target}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coupon')
    .setDescription('割引クーポンの管理 (管理者用)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('クーポンを作る')
        .addStringOption((o) => o.setName('code').setDescription('コード (例: SALE10)').setRequired(true).setMaxLength(32))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('割引の種類')
            .setRequired(true)
            .addChoices({ name: '％ 引き', value: 'percent' }, { name: '円 引き', value: 'yen' }),
        )
        .addIntegerOption((o) => o.setName('value').setDescription('割引率 (%) または 割引額 (円)').setRequired(true).setMinValue(1))
        .addIntegerOption((o) => o.setName('max_uses').setDescription('使える回数 (入力しないと無制限)').setMinValue(1))
        .addIntegerOption((o) => o.setName('days').setDescription('有効日数 (入力しないと期限なし)').setMinValue(1).setMaxValue(365))
        .addStringOption((o) => o.setName('product').setDescription('特定の商品だけに使う場合').setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('クーポンの一覧'))
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('クーポンを削除')
        .addStringOption((o) => o.setName('code').setDescription('コード').setRequired(true).setAutocomplete(true)),
    ),

  async autocomplete(interaction, { store }) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'product') return require('./product').autocomplete(interaction, { store });
    const q = focused.value.toUpperCase();
    return interaction.respond(
      store
        .listCoupons(interaction.guildId)
        .filter((c) => c.code.includes(q))
        .slice(0, 25)
        .map((c) => ({ name: c.code, value: c.code })),
    );
  },

  async execute(interaction, { store }) {
    const gid = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const opt = interaction.options;

    if (sub === 'create') {
      let productId = null;
      if (opt.getString('product')) {
        const p = store.findProduct(gid, opt.getString('product'));
        if (!p) throw new UserError('その商品は見つかりませんでした。');
        productId = p.id;
      }
      const days = opt.getInteger('days');
      const coupon = store.createCoupon(gid, {
        code: opt.getString('code'),
        type: opt.getString('type'),
        value: opt.getInteger('value'),
        maxUses: opt.getInteger('max_uses'),
        expiresAt: days ? Date.now() + days * 86400_000 : null,
        productId,
      });
      return interaction.reply({
        content: `🎟️ クーポンを作りました\n${describe(coupon, store, gid)}\nお客様は購入時の入力欄にこのコードを入れると割引されます。`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'delete') {
      const removed = store.deleteCoupon(gid, opt.getString('code'));
      if (!removed) throw new UserError('そのクーポンは見つかりませんでした。');
      return interaction.reply({ content: `🗑️ クーポン \`${removed.code}\` を削除しました。`, flags: MessageFlags.Ephemeral });
    }

    const list = store.listCoupons(gid);
    const embed = new EmbedBuilder()
      .setTitle('🎟️ クーポン一覧')
      .setColor(COLORS.brand)
      .setDescription(list.length ? list.map((c) => describe(c, store, gid)).join('\n').slice(0, 4000) : 'クーポンはありません。');
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

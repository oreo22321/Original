'use strict';

const {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { refreshShopPanel } = require('../lib/panels');
const { COLORS, yen, stockText, truncate } = require('../lib/format');
const { UserError } = require('../lib/errors');

const EMOJI_RE = /^(<a?:\w{2,32}:\d{17,20}>|\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*)$/u;

function productOption(o) {
  return o.setName('product').setDescription('商品 (名前を入力すると候補が出ます)').setRequired(true).setAutocomplete(true);
}

function checkEmoji(emoji) {
  if (emoji && !EMOJI_RE.test(emoji.trim())) {
    throw new UserError('絵文字は 🍎 のような絵文字 1 つか、サーバーのカスタム絵文字にしてください');
  }
  return emoji ? emoji.trim() : null;
}

function productEmbed(p, title) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(COLORS.success)
    .addFields(
      { name: '商品', value: `${p.emoji ? `${p.emoji} ` : ''}${p.name} (\`${p.id}\`)` },
      { name: '価格', value: yen(p.price), inline: true },
      { name: '在庫', value: p.stock === null ? '無制限' : stockText(p.stock), inline: true },
      { name: '説明', value: truncate(p.description, 1024) || '—' },
      { name: '納品内容 (お客様には納品時のみ表示)', value: p.delivery ? `||${truncate(p.delivery, 1000)}||` : '未設定 (納品時に入力)' },
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('product')
    .setDescription('商品の管理 (管理者用)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('商品を追加')
        .addStringOption((o) => o.setName('name').setDescription('商品名').setRequired(true).setMaxLength(100))
        .addIntegerOption((o) => o.setName('price').setDescription('価格 (円)').setRequired(true).setMinValue(0))
        .addIntegerOption((o) => o.setName('stock').setDescription('在庫数 (入力しないと無制限)').setMinValue(0))
        .addStringOption((o) => o.setName('description').setDescription('商品の説明').setMaxLength(1000))
        .addStringOption((o) => o.setName('emoji').setDescription('一覧に表示する絵文字 (例: 🎮)'))
        .addStringOption((o) =>
          o.setName('delivery').setDescription('納品内容 (コード・URL など。納品時に自動入力されます)').setMaxLength(4000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('商品を編集 (変えたい項目だけ入力)')
        .addStringOption(productOption)
        .addStringOption((o) => o.setName('name').setDescription('新しい商品名').setMaxLength(100))
        .addIntegerOption((o) => o.setName('price').setDescription('新しい価格 (円)').setMinValue(0))
        .addIntegerOption((o) => o.setName('stock').setDescription('新しい在庫数').setMinValue(0))
        .addBooleanOption((o) => o.setName('unlimited').setDescription('在庫を無制限にする'))
        .addStringOption((o) => o.setName('description').setDescription('新しい説明').setMaxLength(1000))
        .addStringOption((o) => o.setName('emoji').setDescription('新しい絵文字 (「なし」で削除)'))
        .addStringOption((o) => o.setName('delivery').setDescription('新しい納品内容 (「なし」で削除)').setMaxLength(4000)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('商品を削除').addStringOption(productOption))
    .addSubcommand((s) => s.setName('list').setDescription('商品の一覧 (在庫・ID 付き)')),

  async autocomplete(interaction, { store }) {
    const q = interaction.options.getFocused().toLowerCase();
    const choices = store
      .listProducts(interaction.guildId)
      .filter((p) => p.name.toLowerCase().includes(q) || p.id === q)
      .slice(0, 25)
      .map((p) => ({ name: truncate(`${p.name} (${yen(p.price)} / ${stockText(p.stock)})`, 100), value: p.id }));
    await interaction.respond(choices);
  },

  async execute(interaction, { store }) {
    const sub = interaction.options.getSubcommand();
    const gid = interaction.guildId;
    const opt = interaction.options;

    if (sub === 'list') {
      const products = store.listProducts(gid);
      const embed = new EmbedBuilder().setTitle('📦 商品一覧 (管理用)').setColor(COLORS.brand);
      embed.setDescription(
        products.length
          ? products
              .map((p) => `\`${p.id}\` ${p.emoji ?? ''} **${p.name}** — ${yen(p.price)} / ${p.stock === null ? '無制限' : stockText(p.stock)}${p.delivery ? ' / 📦納品内容あり' : ''}`)
              .join('\n')
              .slice(0, 4000)
          : 'まだ商品がありません。`/product add` で追加してください。',
      );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    let product;
    let title;
    if (sub === 'add') {
      product = store.addProduct(gid, {
        name: opt.getString('name'),
        price: opt.getInteger('price'),
        stock: opt.getInteger('stock'),
        description: opt.getString('description') ?? '',
        emoji: checkEmoji(opt.getString('emoji')),
        delivery: opt.getString('delivery') ?? '',
      });
      title = '✅ 商品を追加しました';
    } else {
      product = store.findProduct(gid, opt.getString('product'));
      if (!product) {
        return interaction.reply({ content: '❌ その商品は見つかりませんでした。', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'remove') {
        store.removeProduct(gid, product.id);
        const updated = await refreshShopPanel(interaction.guild, store);
        return interaction.reply({
          content: `🗑️ 「${product.name}」を削除しました。${updated ? '商品一覧パネルも更新しました。' : ''}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const patch = {};
      if (opt.getString('name')) patch.name = opt.getString('name').trim();
      if (opt.getInteger('price') !== null) patch.price = opt.getInteger('price');
      if (opt.getInteger('stock') !== null) patch.stock = opt.getInteger('stock');
      if (opt.getBoolean('unlimited')) patch.stock = null;
      if (opt.getString('description') !== null) patch.description = opt.getString('description');
      const emoji = opt.getString('emoji');
      if (emoji !== null) patch.emoji = emoji === 'なし' ? null : checkEmoji(emoji);
      const delivery = opt.getString('delivery');
      if (delivery !== null) patch.delivery = delivery === 'なし' ? '' : delivery;
      if (!Object.keys(patch).length) {
        return interaction.reply({ content: '変更する項目を 1 つ以上入力してください。', flags: MessageFlags.Ephemeral });
      }
      product = store.updateProduct(gid, product.id, patch);
      title = '✏️ 商品を更新しました';
    }

    const updated = await refreshShopPanel(interaction.guild, store);
    const embed = productEmbed(product, title);
    if (!updated) embed.setFooter({ text: '商品一覧パネルが未設置です。/panel shop で設置できます' });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

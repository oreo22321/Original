'use strict';

const {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { refreshShopPanel } = require('../lib/panels');
const { notifyProductChange } = require('../lib/actions');
const { COLORS, yen, stockText, truncate } = require('../lib/format');
const { UserError } = require('../lib/errors');

const EMOJI_RE = /^(<a?:\w{2,32}:\d{17,20}>|\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*)$/u;

function productOption(o) {
  return o.setName('product').setDescription('商品 (名前を入力すると候補が出ます)').setRequired(true).setAutocomplete(true);
}

function categoryOption(o) {
  return o.setName('category').setDescription('カテゴリ (例: ゲーム / 素材 / テンプレート)').setMaxLength(50).setAutocomplete(true);
}

function checkImage(url) {
  if (!url) return null;
  if (!/^https:\/\/\S+$/i.test(url.trim())) throw new UserError('画像は https:// で始まる URL にしてください');
  return url.trim();
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
      { name: '在庫', value: Array.isArray(p.codes) ? `コード在庫 ${p.codes.length} 個` : p.stock === null ? '無制限' : stockText(p.stock), inline: true },
      { name: 'カテゴリ', value: p.category || 'その他', inline: true },
      { name: '受け渡し', value: Array.isArray(p.codes) || p.delivery ? (p.autoDeliver === false ? '手動 (スタッフが納品ボタン)' : '⚡ 支払い確認で自動納品') : '手動 (納品時に入力)', inline: true },
      { name: '説明', value: truncate(p.description, 1024) || '—' },
      { name: '納品内容 (お客様には納品時のみ表示)', value: p.delivery ? `||${truncate(p.delivery, 1000)}||` : '未設定' },
    )
    .setThumbnail(p.imageUrl || null);
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
        .addStringOption(categoryOption)
        .addStringOption((o) =>
          o.setName('delivery').setDescription('全員に同じものを渡す納品内容 (URL など)。1個ずつ違うコードは /codes add').setMaxLength(4000),
        )
        .addStringOption((o) => o.setName('image_url').setDescription('商品画像の URL (https://...)'))
        .addBooleanOption((o) => o.setName('auto_deliver').setDescription('支払い確認と同時に自動納品する (初期値: する)')),
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
        .addStringOption((o) => o.setName('delivery').setDescription('新しい納品内容 (「なし」で削除)').setMaxLength(4000))
        .addStringOption(categoryOption)
        .addStringOption((o) => o.setName('image_url').setDescription('新しい画像 URL (「なし」で削除)'))
        .addBooleanOption((o) => o.setName('auto_deliver').setDescription('支払い確認と同時に自動納品する')),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('商品を削除').addStringOption(productOption))
    .addSubcommand((s) => s.setName('list').setDescription('商品の一覧 (在庫・ID 付き)')),

  async autocomplete(interaction, { store }) {
    const focused = interaction.options.getFocused(true);
    const q = focused.value.toLowerCase();
    if (focused.name === 'category') {
      const cats = store.categories(interaction.guildId).filter((c) => c.toLowerCase().includes(q));
      if (focused.value && !cats.includes(focused.value)) cats.unshift(focused.value);
      return interaction.respond(cats.slice(0, 25).map((c) => ({ name: truncate(c, 100), value: truncate(c, 100) })));
    }
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
              .map(
                (p) =>
                  `\`${p.id}\` ${p.emoji ?? ''} **${p.name}** [${p.category || 'その他'}] — ${yen(p.price)} / ${Array.isArray(p.codes) ? `🔑コード ${p.codes.length}` : p.stock === null ? '無制限' : stockText(p.stock)}${(Array.isArray(p.codes) || p.delivery) && p.autoDeliver !== false ? ' / ⚡自動納品' : ''}`,
              )
              .join('\n')
              .slice(0, 4000)
          : 'まだ商品がありません。`/product add` で追加してください。',
      );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    let product;
    let title;
    let isNew = false;
    let prevStock;
    if (sub === 'add') {
      product = store.addProduct(gid, {
        name: opt.getString('name'),
        price: opt.getInteger('price'),
        stock: opt.getInteger('stock'),
        description: opt.getString('description') ?? '',
        emoji: checkEmoji(opt.getString('emoji')),
        delivery: opt.getString('delivery') ?? '',
        category: opt.getString('category') ?? '',
        imageUrl: checkImage(opt.getString('image_url')),
        autoDeliver: opt.getBoolean('auto_deliver') ?? true,
      });
      title = '✅ 商品を追加しました';
      isNew = true;
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
      if (opt.getString('category') !== null) patch.category = opt.getString('category');
      const image = opt.getString('image_url');
      if (image !== null) patch.imageUrl = image === 'なし' ? null : checkImage(image);
      if (opt.getBoolean('auto_deliver') !== null) patch.autoDeliver = opt.getBoolean('auto_deliver');
      prevStock = product.stock;
      if (!Object.keys(patch).length) {
        return interaction.reply({ content: '変更する項目を 1 つ以上入力してください。', flags: MessageFlags.Ephemeral });
      }
      product = store.updateProduct(gid, product.id, patch);
      title = '✏️ 商品を更新しました';
    }

    const updated = await refreshShopPanel(interaction.guild, store);
    await notifyProductChange(interaction.guild, store, product, { isNew, prevStock });
    const embed = productEmbed(product, title);
    if (!updated) embed.setFooter({ text: '商品一覧パネルが未設置です。/panel shop で設置できます' });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

'use strict';

const { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { modal } = require('../lib/modal');
const { refreshShopPanel } = require('../lib/panels');
const { notifyProductChange } = require('../lib/actions');
const { UserError } = require('../lib/errors');
const productCmd = require('./product');

function productOption(o) {
  return o.setName('product').setDescription('商品').setRequired(true).setAutocomplete(true);
}

/** コードを追加して結果メッセージを返す (モーダル・ファイル共通) */
async function addCodes(interaction, store, productId, lines) {
  const before = store.getProduct(interaction.guildId, productId);
  if (!before) throw new UserError('商品が見つかりません');
  const prevStock = before.stock;
  const res = store.addCodes(interaction.guildId, productId, lines);
  const product = store.getProduct(interaction.guildId, productId);
  await refreshShopPanel(interaction.guild, store);
  await notifyProductChange(interaction.guild, store, product, { prevStock });
  return (
    `🔑 「${product.name}」にコードを **${res.added} 個** 追加しました（在庫 ${res.total} 個）。` +
    (res.duplicates ? `\n重複していた ${res.duplicates} 個はスキップしました。` : '') +
    (product.autoDeliver === false ? '\n⚠️ この商品は自動納品がオフです。`/product edit auto_deliver:True` でオンにできます。' : '\n⚡ 支払い確認と同時に 1 人ずつ違うコードが自動で渡されます。')
  );
}

module.exports = {
  addCodes,
  data: new SlashCommandBuilder()
    .setName('codes')
    .setDescription('1 個ずつ違うコード (シリアル・ギフトコードなど) の自動納品在庫 (管理者用)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('コードを追加 (1 行に 1 個)。txt ファイルでも OK')
        .addStringOption(productOption)
        .addAttachmentOption((o) => o.setName('file').setDescription('コードが 1 行ずつ書かれた .txt ファイル (大量に入れるとき)')),
    )
    .addSubcommand((s) => s.setName('view').setDescription('残りのコードを確認 (自分だけに表示)').addStringOption(productOption))
    .addSubcommand((s) => s.setName('clear').setDescription('コード在庫をすべて削除して通常の在庫に戻す').addStringOption(productOption)),

  autocomplete: productCmd.autocomplete,

  async execute(interaction, { store }) {
    const sub = interaction.options.getSubcommand();
    const product = store.findProduct(interaction.guildId, interaction.options.getString('product'));
    if (!product) throw new UserError('その商品は見つかりませんでした。');

    if (sub === 'add') {
      const file = interaction.options.getAttachment('file');
      if (!file) {
        return interaction.showModal(
          modal(`codes:add:${product.id}`, `コード追加: ${product.name}`.slice(0, 45), [
            {
              id: 'codes',
              label: 'コード (1 行に 1 個)',
              description: '大量にある場合は /codes add の file に txt を添付してください',
              long: true,
              max: 4000,
              placeholder: 'AAAA-BBBB-CCCC\nDDDD-EEEE-FFFF',
            },
          ]),
        );
      }
      if (file.size > 1_000_000) throw new UserError('ファイルが大きすぎます (1MB まで)');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await fetch(file.url);
      if (!res.ok) throw new UserError('ファイルを読み込めませんでした。もう一度お試しください。');
      const text = await res.text();
      return interaction.editReply(await addCodes(interaction, store, product.id, text.split(/\r?\n/)));
    }

    if (sub === 'view') {
      const codes = product.codes || [];
      if (!codes.length) {
        return interaction.reply({ content: `「${product.name}」にコード在庫はありません。`, flags: MessageFlags.Ephemeral });
      }
      const text = codes.join('\n');
      if (text.length < 1800) {
        return interaction.reply({
          content: `🔑 「${product.name}」の残りコード ${codes.length} 個\n\`\`\`\n${text}\n\`\`\``,
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({
        content: `🔑 「${product.name}」の残りコード ${codes.length} 個`,
        files: [{ attachment: Buffer.from(text, 'utf8'), name: `${product.id}-codes.txt` }],
        flags: MessageFlags.Ephemeral,
      });
    }

    // clear
    const removed = store.clearCodes(interaction.guildId, product.id);
    await refreshShopPanel(interaction.guild, store);
    return interaction.reply({
      content: `🗑️ 「${product.name}」のコード ${removed} 個を削除し、通常の在庫 (0 個) に戻しました。`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

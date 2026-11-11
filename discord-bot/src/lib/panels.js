'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  parseEmoji,
} = require('discord.js');
const { COLORS, yen, stockText, truncate } = require('./format');

function inStock(p) {
  return p.stock === null || p.stock === undefined || p.stock > 0;
}

/** 商品一覧 + 購入セレクトメニュー */
function buildShopPanel(products) {
  const embed = new EmbedBuilder()
    .setTitle('🛍️ 商品一覧')
    .setColor(COLORS.brand)
    .setFooter({ text: '下のメニューから商品を選ぶと、あなた専用の注文チャンネルが作られます' });

  if (!products.length) {
    embed.setDescription('現在販売中の商品はありません。入荷をお待ちください！');
    return { embeds: [embed], components: [] };
  }

  // 埋め込みのフィールドは最大 25 個
  embed.setDescription('ご希望の商品を下のメニューから選んでください。');
  for (const p of products.slice(0, 25)) {
    embed.addFields({
      name: `${p.emoji ? `${p.emoji} ` : ''}${truncate(p.name, 200)} — ${yen(p.price)}`,
      value: `${truncate(p.description, 900) || '—'}\n\`${stockText(p.stock)}\``,
    });
  }

  const available = products.filter(inStock).slice(0, 25);
  if (!available.length) {
    embed.setDescription('ただいま全商品が売り切れです。入荷をお待ちください！');
    return { embeds: [embed], components: [] };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('shop:select')
    .setPlaceholder('🛒 購入する商品を選択')
    .addOptions(
      available.map((p) => {
        const opt = {
          label: truncate(p.name, 100),
          value: p.id,
          description: truncate(`${yen(p.price)} / ${stockText(p.stock)}`, 100),
        };
        if (p.emoji) opt.emoji = parseEmoji(p.emoji);
        return opt;
      }),
    );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function buildServicePanel() {
  const embed = new EmbedBuilder()
    .setTitle('🧾 代行のご依頼')
    .setColor(COLORS.brand)
    .setDescription(
      [
        '各種代行を承っています。下のボタンから依頼内容を送ってください。',
        '',
        '**ご依頼の流れ**',
        '1️⃣ 「依頼する」ボタンから内容・ご予算・希望納期を入力',
        '2️⃣ あなた専用のチャンネルでスタッフが見積もりを提示',
        '3️⃣ お支払い → スタッフが確認後に作業開始',
        '4️⃣ 納品・レビュー',
      ].join('\n'),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('service:request').setLabel('依頼する').setStyle(ButtonStyle.Primary).setEmoji('📝'),
  );
  return { embeds: [embed], components: [row] };
}

function buildVerifyPanel() {
  const embed = new EmbedBuilder()
    .setTitle('✅ 認証')
    .setColor(COLORS.success)
    .setDescription('ルールを読んで同意いただけたら、下のボタンを押してください。\nショップやコミュニティのチャンネルが見られるようになります。');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify').setLabel('ルールに同意して認証').setStyle(ButtonStyle.Success).setEmoji('✅'),
  );
  return { embeds: [embed], components: [row] };
}

/** 商品が変わったら、設置済みの商品一覧パネルを最新にする */
async function refreshShopPanel(guild, store) {
  const config = store.getConfig(guild.id);
  if (!config.shopPanel) return false;
  try {
    const channel = await guild.channels.fetch(config.shopPanel.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return false;
    const message = await channel.messages.fetch(config.shopPanel.messageId).catch(() => null);
    if (!message) return false;
    await message.edit(buildShopPanel(store.listProducts(guild.id)));
    return true;
  } catch (err) {
    console.warn('[panel] 商品一覧パネルの更新に失敗しました:', err.message);
    return false;
  }
}

module.exports = { buildShopPanel, buildServicePanel, buildVerifyPanel, refreshShopPanel, inStock };

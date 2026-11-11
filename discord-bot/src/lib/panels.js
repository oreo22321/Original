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

function categoryOf(p) {
  return p.category || 'その他';
}

function productOption(p, withCategory) {
  const opt = {
    label: truncate(p.name, 100),
    value: p.id,
    description: truncate(`${withCategory ? `[${categoryOf(p)}] ` : ''}${yen(p.price)} / ${stockText(p.stock)}`, 100),
  };
  if (p.emoji) opt.emoji = parseEmoji(p.emoji);
  return opt;
}

/** カテゴリごとにまとめる (登録順を保つ) */
function groupByCategory(products) {
  const groups = new Map();
  for (const p of products) {
    const c = categoryOf(p);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(p);
  }
  return groups;
}

/**
 * 商品一覧パネル。
 * - 販売中が 25 個以下: 商品メニュー 1 つ
 * - 26 個以上: まずカテゴリを選び、そのカテゴリの商品メニューを本人だけに表示
 */
function buildShopPanel(products) {
  const embed = new EmbedBuilder()
    .setTitle('🛍️ 商品一覧')
    .setColor(COLORS.brand)
    .setFooter({ text: '商品を選ぶと詳細が表示され、そこから購入できます' });

  if (!products.length) {
    embed.setDescription('現在販売中の商品はありません。入荷をお待ちください！');
    return { embeds: [embed], components: [] };
  }

  const groups = groupByCategory(products);
  for (const [category, list] of [...groups].slice(0, 25)) {
    const lines = list.map(
      (p) => `${p.emoji ? `${p.emoji} ` : '・'}**${truncate(p.name, 60)}** — ${yen(p.price)}${inStock(p) ? '' : ' ~~売り切れ~~'}`,
    );
    let value = '';
    for (const line of lines) {
      if (value.length + line.length + 20 > 1024) {
        value += '\n…ほか';
        break;
      }
      value += (value ? '\n' : '') + line;
    }
    embed.addFields({ name: groups.size > 1 ? `📁 ${truncate(category, 200)}` : '​', value });
  }

  const available = products.filter(inStock);
  if (!available.length) {
    embed.setDescription('ただいま全商品が売り切れです。入荷をお待ちください！');
    return { embeds: [embed], components: [] };
  }

  let menu;
  if (available.length <= 25) {
    embed.setDescription('下のメニューから気になる商品を選んでください。');
    menu = new StringSelectMenuBuilder()
      .setCustomId('shop:select')
      .setPlaceholder('🛒 商品を選ぶ')
      .addOptions(available.map((p) => productOption(p, groups.size > 1)));
  } else {
    embed.setDescription('まず下のメニューでカテゴリを選んでください。');
    const cats = [...groupByCategory(available)].slice(0, 25);
    menu = new StringSelectMenuBuilder()
      .setCustomId('shop:cat')
      .setPlaceholder('📁 カテゴリを選ぶ')
      .addOptions(
        cats.map(([c, list]) => ({
          label: truncate(c, 100),
          value: truncate(c, 100),
          description: `${list.length} 商品`,
        })),
      );
  }
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

/** カテゴリ内の商品メニュー (本人だけに表示) */
function buildCategoryMenu(products, category) {
  const list = products.filter((p) => inStock(p) && truncate(categoryOf(p), 100) === category).slice(0, 25);
  if (!list.length) return { content: 'このカテゴリの商品は現在売り切れです。', embeds: [], components: [] };
  const menu = new StringSelectMenuBuilder()
    .setCustomId('shop:select')
    .setPlaceholder(`🛒 ${truncate(category, 80)} の商品を選ぶ`)
    .addOptions(list.map((p) => productOption(p, false)));
  return { content: `📁 **${category}**`, embeds: [], components: [new ActionRowBuilder().addComponents(menu)] };
}

/** 商品の詳細カード + 購入ボタン (本人だけに表示) */
function buildProductCard(p) {
  const embed = new EmbedBuilder()
    .setTitle(`${p.emoji ? `${p.emoji} ` : ''}${truncate(p.name, 200)}`)
    .setColor(COLORS.brand)
    .setDescription(truncate(p.description, 4000) || '—')
    .addFields(
      { name: '価格', value: yen(p.price), inline: true },
      { name: '在庫', value: stockText(p.stock), inline: true },
      { name: 'カテゴリ', value: categoryOf(p), inline: true },
    );
  if (Array.isArray(p.codes) || (p.delivery && p.autoDeliver !== false)) {
    embed.addFields({ name: '受け取り', value: '⚡ お支払い確認後すぐに自動でお渡しします' });
  }
  if (p.imageUrl) embed.setImage(p.imageUrl);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop:buy:${p.id}`)
      .setLabel(inStock(p) ? '購入する' : '売り切れ')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🛒')
      .setDisabled(!inStock(p)),
  );
  return { content: '', embeds: [embed], components: [row] };
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

module.exports = {
  buildShopPanel,
  buildCategoryMenu,
  buildProductCard,
  buildServicePanel,
  buildVerifyPanel,
  refreshShopPanel,
  inStock,
};

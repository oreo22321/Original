'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { STATUS, yen, orderNo, statusText, truncate, ts } = require('./format');

function btn(id, label, style, emoji) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

/** チケット内に表示する「注文カード」(状態に応じてボタンが変わる) */
function buildOrderView(order, config) {
  const embed = new EmbedBuilder()
    .setTitle(`${order.type === 'service' ? '🧾 代行依頼' : '🛒 ご注文'} ${orderNo(order.number)}`)
    .setColor(STATUS[order.status]?.color ?? 0x5865f2)
    .addFields(
      { name: 'お客様', value: `<@${order.userId}>`, inline: true },
      { name: '状態', value: statusText(order.status), inline: true },
      { name: '金額', value: yen(order.price), inline: true },
    )
    .setFooter({ text: '受付日時' })
    .setTimestamp(order.createdAt);

  if (order.type === 'product') {
    embed.addFields({ name: '商品', value: `${order.productName} × ${order.quantity}` });
  } else if (order.details) {
    embed.addFields(
      { name: '依頼内容', value: truncate(order.details.content, 1024) || '—' },
      { name: 'ご予算', value: truncate(order.details.budget, 1024) || '—', inline: true },
      { name: '希望納期', value: truncate(order.details.deadline, 1024) || '—', inline: true },
    );
  }
  if (order.coupon) embed.addFields({ name: 'クーポン', value: `\`${order.coupon}\` (−${yen(order.discount)})`, inline: true });
  if (order.paymentReport) {
    embed.addFields({ name: '支払い報告', value: `✅ ${truncate(order.paymentReport.method, 200)} (${ts(order.paymentReport.at, 'R')})`, inline: true });
  }
  if (order.note) embed.addFields({ name: '備考', value: truncate(order.note, 1024) });
  if (order.quoteNote) embed.addFields({ name: '見積もりメモ', value: truncate(order.quoteNote, 1024) });

  let guide = '';
  const n = order.number;
  const rows = [];
  switch (order.status) {
    case 'quote':
      guide = 'スタッフが内容を確認して見積もりをお出しします。少々お待ちください。';
      rows.push(
        new ActionRowBuilder().addComponents(
          btn(`order:quote:${n}`, '見積もりを提示 (スタッフ)', ButtonStyle.Primary, '💴'),
          btn(`order:cancel:${n}`, 'キャンセル', ButtonStyle.Secondary, '✖️'),
        ),
      );
      break;
    case 'pending':
      guide =
        `**お支払い方法**\n${config.paymentInfo}\n\n` +
        'お支払いが済んだら **「支払いました」** を押して、このチャンネルにスクリーンショットを貼ってください。スタッフが確認します。' +
        (config.autoCancelHours ? `\n⏰ ${config.autoCancelHours} 時間以内にお支払いがない場合は自動でキャンセルされます。` : '');
      rows.push(
        new ActionRowBuilder().addComponents(
          btn(`order:report:${n}`, order.paymentReport ? '支払い報告済み' : '支払いました', ButtonStyle.Primary, '💸').setDisabled(
            !!order.paymentReport,
          ),
          btn(`order:paid:${n}`, '支払いを確認 (スタッフ)', ButtonStyle.Success, '💰'),
          btn(`order:cancel:${n}`, 'キャンセル', ButtonStyle.Secondary, '✖️'),
        ),
      );
      break;
    case 'paid':
      guide = 'お支払いを確認しました。ただいま対応中です。納品までお待ちください。';
      rows.push(
        new ActionRowBuilder().addComponents(
          btn(`order:deliver:${n}`, '納品する (スタッフ)', ButtonStyle.Success, '📦'),
          btn(`order:cancel:${n}`, 'キャンセル (スタッフ)', ButtonStyle.Danger, '✖️'),
        ),
      );
      break;
    case 'delivered':
      guide = '納品が完了しました！ご利用ありがとうございました。よろしければレビューをお願いします。\n問題がなければ「チケットを閉じる」を押してください。';
      rows.push(
        new ActionRowBuilder().addComponents(
          btn(`order:review:${n}`, order.reviewed ? 'レビュー済み' : 'レビューを書く', ButtonStyle.Primary, '⭐').setDisabled(
            !!order.reviewed,
          ),
          btn(`order:close:${n}`, 'チケットを閉じる', ButtonStyle.Secondary, '🔒'),
        ),
      );
      break;
    case 'closed':
      guide = 'この注文は完了しました。';
      break;
    case 'cancelled':
      guide = 'この注文はキャンセルされました。';
      break;
    default:
      break;
  }
  embed.setDescription(`${guide}\n\n最終更新: ${ts(order.updatedAt)}`);
  return { embeds: [embed], components: rows };
}

module.exports = { buildOrderView };

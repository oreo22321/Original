'use strict';

const { EmbedBuilder } = require('discord.js');
const { COLORS } = require('./format');

/** ログチャンネルにメッセージを送る (未設定・失敗時は何もしない) */
async function sendLog(guild, config, { title, description, color = COLORS.brand, fields = [], files = [] }) {
  if (!config.logChannelId) return;
  try {
    const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const embed = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp();
    if (description) embed.setDescription(description);
    if (fields.length) embed.addFields(fields);
    await channel.send({ embeds: [embed], files });
  } catch (err) {
    console.warn('[log] ログ送信に失敗しました:', err.message);
  }
}

module.exports = { sendLog };

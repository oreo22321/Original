'use strict';

const { PermissionFlagsBits } = require('discord.js');

/** 管理者・サーバー管理権限・スタッフロールのいずれかを持っていればスタッフ扱い */
function isStaff(member, config) {
  if (!member) return false;
  const perms = member.permissions;
  if (perms && typeof perms !== 'string') {
    if (perms.has(PermissionFlagsBits.Administrator) || perms.has(PermissionFlagsBits.ManageGuild)) return true;
  }
  if (!config.staffRoleId) return false;
  const roles = member.roles;
  if (Array.isArray(roles)) return roles.includes(config.staffRoleId); // API の生データの場合
  return roles?.cache?.has(config.staffRoleId) ?? false;
}

module.exports = { isStaff };

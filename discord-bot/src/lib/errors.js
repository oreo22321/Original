'use strict';

/** お客様・管理者にそのまま見せてよいエラー (入力ミスや在庫切れなど) */
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

module.exports = { UserError };

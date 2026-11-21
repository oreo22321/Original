'use strict';
// データの保存 (JSON ファイル 1 つ)。
// 書き込みは一時ファイル → rename で、途中で落ちても壊れないようにします。
// 1 つ前の版を .bak に残し、本体が読めないときはそちらから戻します。
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.data = { users: [], bots: [], sessions: {}, settings: {} };
    this.timer = null;
    this.onSave = null;
    const loaded = this.tryLoad(file) || this.tryLoad(file + '.bak');
    if (loaded) this.data = Object.assign(this.data, loaded);
  }

  tryLoad(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`${file} を読めませんでした: ${e.message}`);
      return null;
    }
  }

  save() {
    if (this.onSave) this.onSave();
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.flush(); } catch (e) { console.error('保存に失敗しました:', e); }
    }, 100);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    try { fs.copyFileSync(this.file, this.file + '.bak'); fs.chmodSync(this.file + '.bak', 0o600); } catch { /* 初回 */ }
    fs.renameSync(tmp, this.file);
  }

  // バックアップから戻したデータで置き換える
  replace(data) {
    this.data = Object.assign({ users: [], bots: [], sessions: {}, settings: {} }, data);
    this.flush();
  }

  get users() { return this.data.users; }
  get bots() { return this.data.bots; }
  get sessions() { return this.data.sessions; }
  get settings() { return this.data.settings; }
}

module.exports = { Store };

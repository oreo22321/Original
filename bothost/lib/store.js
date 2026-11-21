'use strict';
// データの保存 (JSON ファイル 1 つ)。書き込みは一時ファイル → rename で、途中で落ちても壊れないようにします。
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.data = { users: [], bots: [], sessions: {} };
    this.timer = null;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      this.data = Object.assign(this.data, JSON.parse(raw));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 50);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get users() { return this.data.users; }
  get bots() { return this.data.bots; }
  get sessions() { return this.data.sessions; }
}

module.exports = { Store };

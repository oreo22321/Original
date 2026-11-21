'use strict';
// GitHub のリポジトリへの自動バックアップ。
// Render の無料プランなどはサーバーが再起動するとファイルが消えるので、
// アカウント・bot の設定・bot のファイルを 1 つのファイル (gzip した JSON) にまとめて GitHub に置き、
// 起動したときにデータがなければそこから戻します。
// ライブラリのフォルダー (.deps・node_modules など) とログは含めません (起動のときに入れ直します)。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { HIDDEN_DIRS } = require('./files');

const MAX_FILE = 5 * 1024 * 1024;

class Backup {
  constructor(opts) {
    this.store = opts.store;
    this.botsDir = opts.botsDir;
    this.repo = opts.repo || '';
    this.token = opts.token || '';
    this.branch = opts.branch || '';
    this.file = opts.file || 'bothost-backup.json.gz';
    this.api = (opts.api || 'https://api.github.com').replace(/\/$/, '');
    this.intervalMs = opts.intervalMs || 60e3;
    this.dirty = false;
    this.running = null;
    this.sha = null;
    this.status = { lastAt: null, lastError: null, lastSize: null, restoredAt: null };
    this.timer = null;
  }

  get enabled() { return !!(this.repo && this.token && /^[\w.-]+\/[\w.-]+$/.test(this.repo)); }

  info() {
    return { enabled: this.enabled, repo: this.enabled ? this.repo : null, dirty: this.dirty, ...this.status };
  }

  markDirty() { this.dirty = true; }

  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => { if (this.dirty) this.run().catch(() => {}); }, this.intervalMs);
    this.timer.unref();
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bothost',
      ...extra,
    };
  }

  url() {
    const ref = this.branch ? `?ref=${encodeURIComponent(this.branch)}` : '';
    return `${this.api}/repos/${this.repo}/contents/${this.file.split('/').map(encodeURIComponent).join('/')}${ref}`;
  }

  bundle() {
    const bots = {};
    for (const bot of this.store.bots) {
      const root = path.join(this.botsDir, bot.id);
      const files = {};
      const walk = (dir, prefix) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { if (!HIDDEN_DIRS.has(e.name)) walk(full, rel); continue; }
          if (!e.isFile()) continue;
          const st = fs.statSync(full);
          if (st.size > MAX_FILE) continue;
          files[rel] = fs.readFileSync(full).toString('base64');
        }
      };
      walk(root, '');
      bots[bot.id] = files;
    }
    const json = JSON.stringify({ version: 1, createdAt: Date.now(), db: this.store.data, bots });
    return zlib.gzipSync(json, { level: 9 });
  }

  async fetchSha() {
    const res = await fetch(this.url(), { headers: this.headers({ Accept: 'application/vnd.github+json' }) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub から読めませんでした (${res.status})`);
    return (await res.json()).sha || null;
  }

  // 今すぐバックアップ (同時には 1 つだけ)
  run() {
    if (!this.enabled) return Promise.reject(new Error('バックアップが設定されていません'));
    if (this.running) return this.running;
    this.running = (async () => {
      this.dirty = false;
      try {
        const gz = this.bundle();
        if (this.sha === null) this.sha = await this.fetchSha();
        const put = async () => fetch(this.url().split('?')[0], {
          method: 'PUT',
          headers: this.headers({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            message: `BotHost のバックアップ (${new Date().toISOString()})`,
            content: gz.toString('base64'),
            ...(this.sha ? { sha: this.sha } : {}),
            ...(this.branch ? { branch: this.branch } : {}),
          }),
        });
        let res = await put();
        if (res.status === 409 || res.status === 422) { // sha が古い → 取り直してもう一度
          this.sha = await this.fetchSha();
          res = await put();
        }
        if (!res.ok) {
          let msg = '';
          try { msg = (await res.json()).message || ''; } catch { /* JSON ではない */ }
          throw new Error(`GitHub に保存できませんでした (${res.status}${msg ? ': ' + msg : ''})`);
        }
        this.sha = (await res.json()).content?.sha || null;
        this.status.lastAt = Date.now();
        this.status.lastSize = gz.length;
        this.status.lastError = null;
      } catch (e) {
        this.dirty = true;
        this.status.lastError = e.message;
        throw e;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  // データがなければ (新しいサーバー・ファイルが消えた) GitHub から戻す
  async restoreIfEmpty(dbFile) {
    if (!this.enabled || fs.existsSync(dbFile)) return false;
    const res = await fetch(this.url(), { headers: this.headers({ Accept: 'application/vnd.github.raw' }) });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`バックアップを読めませんでした (${res.status})`);
    const gz = Buffer.from(await res.arrayBuffer());
    const data = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
    if (data.version !== 1 || !data.db) throw new Error('バックアップの形式が違います');
    for (const [id, files] of Object.entries(data.bots || {})) {
      if (!/^[0-9a-f]+$/.test(id)) continue;
      const root = path.join(this.botsDir, id);
      for (const [rel, b64] of Object.entries(files)) {
        const full = path.resolve(root, rel);
        if (!full.startsWith(root + path.sep)) continue;
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, Buffer.from(b64, 'base64'));
      }
    }
    this.store.replace(data.db);
    this.status.restoredAt = Date.now();
    this.dirty = false;
    return true;
  }
}

module.exports = { Backup };

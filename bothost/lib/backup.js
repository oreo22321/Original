'use strict';
// GitHub のリポジトリへの自動バックアップ。
// Render の無料プランなどはサーバーが再起動するとファイルが消えるので、
// アカウント・bot の設定・bot のファイルを 1 つのファイル (gzip した JSON) にまとめて GitHub に置き、
// 起動したときにデータがなければそこから戻します。
// ライブラリのフォルダー (.deps・node_modules など) とログは含めません (起動のときに入れ直します)。
//
// 置き方は 2 つ:
//   git … SSH の鍵 (リポジトリの「デプロイキー」) で git push する。鍵はそのリポジトリにしか使えないので安全
//          (BOTHOST_BACKUP_SSH_KEY)。いつも最新の 1 つだけを置く (履歴は残さないので、リポジトリが大きくならない)
//   api … GitHub のトークンで、ファイルの API (contents) を使う (BOTHOST_BACKUP_TOKEN)
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { HIDDEN_DIRS } = require('./files');

const MAX_FILE = 5 * 1024 * 1024;
// GitHub の SSH のホスト鍵 (起動のときに https://api.github.com/meta から取り直します。取れないときの予備)
const GITHUB_HOST_KEYS = ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'];

class BackupBlocked extends Error {}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120e3, maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || ''); err.message = `${err.message}\n${err.stderr}`.trim(); reject(err); } else resolve(stdout);
    });
  });
}

// 環境変数の鍵: そのままの PEM でも、base64 にしたものでも受け付ける
function decodeKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (k.includes('PRIVATE KEY')) return k.replace(/\\n/g, '\n') + '\n';
  try {
    const d = Buffer.from(k, 'base64').toString('utf8');
    if (d.includes('PRIVATE KEY')) return d.trim() + '\n';
  } catch { /* base64 ではない */ }
  return '';
}

class Backup {
  constructor(opts) {
    this.store = opts.store;
    this.botsDir = opts.botsDir;
    this.repo = opts.repo || '';
    this.token = opts.token || '';
    this.sshKey = decodeKey(opts.sshKey);
    this.gitUrl = opts.gitUrl || ''; // テスト用 (file:// など)
    this.branch = opts.branch || '';
    this.file = opts.file || 'bothost-backup.json.gz';
    this.api = (opts.api || 'https://api.github.com').replace(/\/$/, '');
    this.intervalMs = opts.intervalMs || 60e3;
    this.dirty = false;
    this.blocked = null; // 起動のときに戻せなかったら、上書きしないようにバックアップを止める
    this.running = null;
    this.sha = null;
    this.sshDir = null;
    this.status = { lastAt: null, lastError: null, lastSize: null, restoredAt: null, connected: null };
    this.timer = null;
  }

  get method() { return this.sshKey || this.gitUrl ? 'git' : 'api'; }

  get enabled() {
    if (this.gitUrl) return true;
    return !!(this.repo && /^[\w.-]+\/[\w.-]+$/.test(this.repo) && (this.token || this.sshKey));
  }

  info() {
    return {
      enabled: this.enabled, method: this.enabled ? this.method : null, repo: this.enabled ? this.repo || null : null,
      dirty: this.dirty, blocked: this.blocked, ...this.status,
    };
  }

  markDirty() { this.dirty = true; }

  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      if (this.blocked) this.retryBlocked().catch(() => {});
      else if (this.dirty) this.run().catch(() => {});
    }, this.intervalMs);
    this.timer.unref();
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  // ----- git (SSH の鍵) -----
  async sshEnv() {
    if (this.gitUrl && !this.sshKey) return { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (!this.sshDir) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bothost-ssh-'));
      fs.chmodSync(dir, 0o700);
      fs.writeFileSync(path.join(dir, 'key'), this.sshKey, { mode: 0o600 });
      let keys = GITHUB_HOST_KEYS;
      try {
        const res = await fetch('https://api.github.com/meta', { headers: { 'User-Agent': 'bothost' }, signal: AbortSignal.timeout(10000) });
        const meta = await res.json();
        if (Array.isArray(meta.ssh_keys) && meta.ssh_keys.length) keys = meta.ssh_keys;
      } catch { /* 予備の鍵を使う */ }
      const hosts = keys.flatMap((k) => [`github.com ${k}`, `[ssh.github.com]:443 ${k}`]);
      fs.writeFileSync(path.join(dir, 'known_hosts'), hosts.join('\n') + '\n');
      this.sshDir = dir;
    }
    const q = (p) => `'${p.replace(/'/g, "'\\''")}'`;
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: `ssh -i ${q(path.join(this.sshDir, 'key'))} -o IdentitiesOnly=yes -o UserKnownHostsFile=${q(path.join(this.sshDir, 'known_hosts'))} -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=20`,
    };
  }

  gitUrls() {
    if (this.gitUrl) return [this.gitUrl];
    // 22 番が使えない場所のために、443 番 (ssh.github.com) も試す
    return [`git@github.com:${this.repo}.git`, `ssh://git@ssh.github.com:443/${this.repo}.git`];
  }

  async git(args, opts = {}) {
    const env = await this.sshEnv();
    let lastErr;
    for (const url of this.gitUrls()) {
      try {
        return await run('git', args(url), { env, ...opts });
      } catch (e) {
        lastErr = e;
        if (!/Could not resolve|Connection (timed out|refused)|Network is unreachable|connect to host/i.test(e.stderr || '')) break;
      }
    }
    throw lastErr;
  }

  get gitBranch() { return this.branch || 'main'; }

  async gitPush(gz) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bothost-bk-'));
    try {
      await run('git', ['init', '-q', '-b', this.gitBranch, dir]);
      const full = path.join(dir, this.file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, gz);
      fs.writeFileSync(path.join(dir, 'README.md'),
        '# BotHost のバックアップ\n\nBotHost が自動で保存しています。手で書き換えないでください。\n'
        + '中身にはアカウントや bot の設定 (トークンなどの環境変数を含む) が入っているので、このリポジトリは非公開のままにしてください。\n');
      await run('git', ['-C', dir, 'add', '-A']);
      await run('git', ['-C', dir, '-c', 'user.name=BotHost', '-c', 'user.email=bothost@users.noreply.github.com',
        'commit', '-q', '-m', `BotHost のバックアップ (${new Date().toISOString()})`]);
      // いつも最新の 1 つだけ (履歴を積み上げない)
      await this.git((url) => ['-C', dir, 'push', '-q', '-f', url, `HEAD:refs/heads/${this.gitBranch}`]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async gitFetch() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bothost-rs-'));
    try {
      try {
        await this.git((url) => ['clone', '-q', '--depth', '1', '--branch', this.gitBranch, url, path.join(dir, 'r')]);
      } catch (e) {
        // 空のリポジトリ・ブランチがない = まだバックアップがない
        if (/not found in upstream|Remote branch .* not found|empty repository/i.test(e.stderr || '')) return null;
        throw e;
      }
      const full = path.join(dir, 'r', this.file);
      return fs.existsSync(full) ? fs.readFileSync(full) : null;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ----- api (トークン) -----
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

  async fetchSha() {
    const res = await fetch(this.url(), { headers: this.headers({ Accept: 'application/vnd.github+json' }) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub から読めませんでした (${res.status})`);
    return (await res.json()).sha || null;
  }

  async apiPush(gz) {
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
  }

  async apiFetch() {
    const res = await fetch(this.url(), { headers: this.headers({ Accept: 'application/vnd.github.raw' }) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`バックアップを読めませんでした (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  // ----- 共通 -----
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

  // 繋がるか確かめる (起動のときにログに出す)
  async check() {
    if (!this.enabled) return false;
    try {
      if (this.method === 'git') await this.git((url) => ['ls-remote', '--heads', url]);
      else {
        const res = await fetch(`${this.api}/repos/${this.repo}`, { headers: this.headers() });
        if (!res.ok) throw new Error(`GitHub に繋がりません (${res.status})`);
      }
      this.status.connected = true;
      return true;
    } catch (e) {
      this.status.connected = false;
      this.status.lastError = friendly(e);
      return false;
    }
  }

  // 今すぐバックアップ (同時には 1 つだけ)。force: 起動のときに戻せなかったあとでも保存する
  run({ force = false } = {}) {
    if (!this.enabled) return Promise.reject(new Error('バックアップが設定されていません'));
    if (this.blocked && !force) return Promise.reject(new BackupBlocked(this.blocked));
    if (this.running) return this.running;
    this.running = (async () => {
      this.dirty = false;
      try {
        const gz = this.bundle();
        if (this.method === 'git') await this.gitPush(gz); else await this.apiPush(gz);
        this.blocked = null;
        this.status.lastAt = Date.now();
        this.status.lastSize = gz.length;
        this.status.lastError = null;
        this.status.connected = true;
      } catch (e) {
        this.dirty = true;
        this.status.lastError = friendly(e);
        throw new Error(this.status.lastError);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  fetchBackup() { return this.method === 'git' ? this.gitFetch() : this.apiFetch(); }

  // 保存を止めている間 (起動のときに戻せなかった) は、1 分ごとに確かめ直す:
  //   GitHub にまだバックアップがない → 上書きするものがないので再開
  //   こちらのデータが空 → バックアップから戻して再開
  //   どちらにもデータがある → 勝手には選ばない (管理画面の「今すぐバックアップ」で決める)
  async retryBlocked() {
    if (!this.blocked || this.retrying) return;
    this.retrying = true;
    try {
      const gz = await this.fetchBackup();
      this.status.connected = true;
      if (!gz) {
        this.blocked = null;
        this.status.lastError = null;
      } else if (!this.store.users.length && !this.store.bots.length) {
        this.apply(gz);
        this.blocked = null;
        this.status.lastError = null;
        if (this.onRestored) this.onRestored();
      } else {
        this.blocked = 'GitHub のバックアップと、このサーバーの両方にデータがあるので、上書きしないように保存を止めています。このサーバーのデータで上書きしてよければ、管理画面の「今すぐバックアップ」を押してください。';
      }
    } catch (e) {
      this.status.lastError = friendly(e);
      this.status.connected = false;
    } finally {
      this.retrying = false;
    }
  }

  // データがなければ (新しいサーバー・ファイルが消えた) GitHub から戻す
  async restoreIfEmpty(dbFile) {
    if (!this.enabled || fs.existsSync(dbFile)) return false;
    const gz = await this.fetchBackup();
    if (!gz) return false;
    this.apply(gz);
    return true;
  }

  apply(gz) {
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
  }

  // 起動のとき: 戻せなければ何回か試す。それでもだめなら、古いデータで上書きしないようにバックアップを止める
  async restoreWithRetry(dbFile, { tries = 4, waitMs = 5000 } = {}) {
    for (let i = 1; ; i++) {
      try {
        const restored = await this.restoreIfEmpty(dbFile);
        this.blocked = null;
        return restored;
      } catch (e) {
        this.status.lastError = friendly(e);
        if (i >= tries) {
          this.blocked = `起動のときにバックアップから戻せなかったので、上書きしないように保存を止めています (${this.status.lastError})。管理画面の「今すぐバックアップ」で再開できます。`;
          throw e;
        }
        await new Promise((r) => setTimeout(r, waitMs * i));
      }
    }
  }
}

// git や GitHub のエラーを、わかる言葉に
function friendly(e) {
  const s = `${e.message || ''}`;
  if (/Permission denied \(publickey\)|ERROR: The key you are authenticating with/i.test(s)) {
    return 'GitHub に鍵が登録されていないか、書き込みが許可されていません (リポジトリの Settings → Deploy keys で「Allow write access」にしてください)';
  }
  if (/Repository not found|could not read from remote/i.test(s)) return 'リポジトリが見つからないか、鍵でアクセスできません';
  if (/Host key verification failed/i.test(s)) return 'GitHub のサーバーを確かめられませんでした';
  if (/Could not resolve|timed out|Network is unreachable/i.test(s)) return 'GitHub に繋がりません (ネットワーク)';
  return s.split('\n').filter(Boolean).slice(-1)[0] || 'エラー';
}

module.exports = { Backup, BackupBlocked, decodeKey };

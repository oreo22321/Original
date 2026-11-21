// ターミナルのコマンド: git (git-core.js のリポジトリを、本物の git と同じ書き方で使う)
// push / pull は「GitHub と同期」につながります (コミットのメッセージ付き)
import { C, dirName, getopts } from './util.js'
import { GitRepo, GitError, short, firstLine, unifiedDiff } from '../git-core.js'

const KIND = { A: '新規', M: '変更', D: '削除' }
const fmtDate = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` }
const rel = t => {
  const s = Math.max(0, (Date.now() - t) / 1000)
  return s < 60 ? `${s | 0} 秒前` : s < 3600 ? `${s / 60 | 0} 分前` : s < 86400 ? `${s / 3600 | 0} 時間前` : `${s / 86400 | 0} 日前`
}

// シェルのファイル (上書き ov も見る) を、git の作業ツリーとして使う
function shellTree(sh) {
  return {
    list: () => [...sh.index().entries()].filter(([p, i]) => p && !i.dir).map(([p]) => p),
    read: p => sh.host.read(p),
    write: async (p, c) => { const d = dirName(p); if (d && !sh.isDir(d)) await sh.fsMkdir(d); await sh.fsWrite(p, c) },
    remove: p => (sh.stat(p) ? sh.fsRemove(p) : null),
  }
}
export function repoFor(sh) {
  const store = sh.host.gitStore && sh.host.gitStore()
  if (!store) throw new GitError('プロジェクトを開いてから使ってください')
  return new GitRepo(store, shellTree(sh))
}

function printDiff(ctx, files, { stat = false, nameOnly = false, nameStatus = false } = {}) {
  if (nameOnly) { for (const f of files) ctx.print(f.path); return }
  if (nameStatus) { for (const f of files) ctx.print(`${f.kind}\t${f.path}`); return }
  if (stat) {
    const w = Math.min(40, Math.max(0, ...files.map(f => f.path.length)))
    let add = 0, del = 0
    for (const f of files) {
      add += f.add; del += f.del
      const n = f.add + f.del
      const scale = n > 40 ? 40 / n : 1
      ctx.print(` ${f.path.padEnd(w)} | ${f.binary ? 'Bin' : String(n).padStart(4) + ' ' + C.green + '+'.repeat(Math.round(f.add * scale)) + C.red + '-'.repeat(Math.round(f.del * scale)) + C.reset}`)
    }
    ctx.print(` ${files.length} 個のファイルを変更, ${add} 行追加(+), ${del} 行削除(-)`)
    return
  }
  for (const f of files) {
    ctx.print(`${C.bold}diff --git a/${f.path} b/${f.path}${C.reset}`)
    if (f.kind === 'A') ctx.print(`${C.bold}new file${C.reset}`)
    if (f.kind === 'D') ctx.print(`${C.bold}deleted file${C.reset}`)
    if (f.binary) { ctx.print(`Binary files ${f.kind === 'A' ? '/dev/null' : 'a/' + f.path} and ${f.kind === 'D' ? '/dev/null' : 'b/' + f.path} differ`); continue }
    ctx.print(`${C.bold}--- ${f.kind === 'A' ? '/dev/null' : 'a/' + f.path}${C.reset}`)
    ctx.print(`${C.bold}+++ ${f.kind === 'D' ? '/dev/null' : 'b/' + f.path}${C.reset}`)
    for (const l of unifiedDiff(f.a, f.b)) {
      const col = l.t === '@' ? C.cyan : l.t === '+' ? C.green : l.t === '-' ? C.red : ''
      ctx.print(l.t === '@' ? `${col}${l.s}${C.reset}` : `${col}${l.t === '\\' ? '\\' : l.t}${l.s}${col ? C.reset : ''}`)
    }
  }
}

function refsText(refs, id) {
  const r = refs.get(id)
  if (!r) return ''
  return ` ${C.yellow}(${r.map(x => (x.startsWith('HEAD') ? `${C.bcyan || C.cyan}${x}${C.yellow}` : x.startsWith('tag:') ? `${C.byellow}${x}${C.yellow}` : `${C.bgreen}${x}${C.yellow}`)).join(', ')})${C.reset}`
}

const HELP = `使い方: git <コマンド>
  ${C.cyan}init${C.reset}                     記録をはじめる
  ${C.cyan}status${C.reset} [-s]              変更の一覧
  ${C.cyan}add${C.reset} <ファイル | .>         ステージする (-A ですべて)
  ${C.cyan}commit${C.reset} -m "メッセージ"     記録する (-a 変更をまとめて, --amend 直前のを直す)
  ${C.cyan}log${C.reset} [--oneline] [-n 5]   履歴 (--graph --all --stat -p ファイル)
  ${C.cyan}diff${C.reset} [--staged] [A [B]]  違い (--stat --name-only)
  ${C.cyan}show${C.reset} [コミット]           コミットの中身
  ${C.cyan}restore${C.reset} <ファイル>         変更を取り消す (--staged ステージだけ, --source=コミット)
  ${C.cyan}reset${C.reset} [--hard] [コミット]   戻す
  ${C.cyan}branch${C.reset} [名前]             ブランチ (-d 消す, -m 名前を変える)
  ${C.cyan}switch${C.reset} [-c] <ブランチ>      切り替え (checkout も)
  ${C.cyan}merge${C.reset} <ブランチ>           取り込む (--abort でやめる)
  ${C.cyan}revert${C.reset} / ${C.cyan}cherry-pick${C.reset} <コミット>  取り消す / 当てる
  ${C.cyan}stash${C.reset} [pop|list|apply|drop|show]  変更を一時的にしまう
  ${C.cyan}tag${C.reset} [名前] [-d]            タグ
  ${C.cyan}blame${C.reset} <ファイル>           行ごとに、最後に変えたコミット
  ${C.cyan}rm${C.reset} / ${C.cyan}mv${C.reset} / ${C.cyan}ls-files${C.reset} / ${C.cyan}rev-parse${C.reset} / ${C.cyan}config user.name 名前${C.reset}
  ${C.cyan}push${C.reset} / ${C.cyan}pull${C.reset}             GitHub と同期 (設定 → 保存 → GitHub と同期)
コミットはこの端末に保存されます (ソース管理の画面からも使えます)`

export default {
  async git(args, ctx) {
    let sub = args[0]
    const rest = args.slice(1)
    if (!sub || sub === 'help' || sub === '--help' || sub === '-h') { ctx.print(HELP); return 0 }
    if (sub === '--version' || sub === 'version') { ctx.print('git version 2.47.0 (ForgeCode)'); return 0 }
    if (sub === 'checkout' && rest[0] === '--') sub = 'restore', rest.shift()
    let repo
    try { repo = repoFor(this) } catch (e) { ctx.err(`fatal: ${e.message}\n`); return 128 }
    try {
      const fn = SUB[sub]
      if (!fn) { ctx.err(`git: '${sub}' は git のコマンドではありません。git help で一覧を出します\n`); return 1 }
      if (sub !== 'init' && sub !== 'clone' && sub !== 'push' && sub !== 'pull' && sub !== 'fetch' && sub !== 'config' && !(await repo.exists())) {
        ctx.err('fatal: ここはまだ git のリポジトリではありません (git init で記録をはじめられます)\n')
        return 128
      }
      const code = (await fn.call(this, repo, rest, ctx)) ?? 0
      if (this.host.gitChanged) this.host.gitChanged()
      return code
    } catch (e) {
      if (e instanceof GitError) { ctx.err(`${/^(error|fatal|warning):/.test(e.message) ? '' : 'error: '}${e.message}\n`); return 1 }
      throw e
    }
  },
}

const SUB = {
  async init(repo, args, ctx) {
    const { o } = getopts(args, 'q', 'b')
    const made = await repo.init(o.b || 'main')
    ctx.print(made ? `空の Git リポジトリを作りました (ブランチ ${o.b || 'main'})` : 'もう Git のリポジトリです')
  },
  async status(repo, args, ctx) {
    const { o } = getopts(args, 'sb', '', { num: null })
    const short_ = o.s || args.includes('--short') || args.includes('--porcelain')
    const st = await repo.status()
    const staged = new Map(st.staged.map(x => [x.path, x.kind]))
    const unst = new Map(st.unstaged.map(x => [x.path, x.kind]))
    if (short_) {
      if (o.b || args.includes('--branch')) ctx.print(`## ${st.branch || 'HEAD (ブランチなし)'}`)
      for (const p of [...new Set([...staged.keys(), ...unst.keys()])].sort()) {
        const conf = st.conflicts.includes(p)
        ctx.print(conf ? `${C.red}UU${C.reset} ${p}` : `${C.green}${staged.get(p) || ' '}${C.red}${unst.get(p) || ' '}${C.reset} ${p}`)
      }
      for (const p of st.untracked) ctx.print(`${C.red}??${C.reset} ${p}`)
      return
    }
    ctx.print(st.branch ? `ブランチ ${C.bold}${st.branch}${C.reset}` : `${C.red}HEAD はブランチではありません (${short(st.detached)})${C.reset}`)
    if (!st.head) ctx.print('\nまだコミットはありません')
    if (st.merge) ctx.print(`\n${st.merge.kind === 'revert' ? 'revert' : st.merge.kind === 'cherry-pick' ? 'cherry-pick' : 'マージ'}の途中です${st.conflicts.length ? ' (衝突を直して git add し、git commit)' : ' (git commit で終わります)'}${st.merge.kind === 'merge' || !st.merge.kind ? '\n  (git merge --abort でやめる)' : ''}`)
    if (st.conflicts.length) {
      ctx.print(`\n衝突しているファイル:\n  (直してから git add <ファイル>)`)
      for (const p of st.conflicts) ctx.print(`\t${C.red}両方で変更: ${p}${C.reset}`)
    }
    const sl = st.staged.filter(x => !st.conflicts.includes(x.path))
    if (sl.length) {
      ctx.print(`\nコミットする変更:\n  (git restore --staged <ファイル> でステージから外す)`)
      for (const x of sl) ctx.print(`\t${C.green}${KIND[x.kind]}:   ${x.path}${C.reset}`)
    }
    const ul = st.unstaged.filter(x => !st.conflicts.includes(x.path))
    if (ul.length) {
      ctx.print(`\nステージしていない変更:\n  (git add <ファイル> でステージ / git restore <ファイル> で元に戻す)`)
      for (const x of ul) ctx.print(`\t${C.red}${KIND[x.kind]}:   ${x.path}${C.reset}`)
    }
    if (st.untracked.length) {
      ctx.print(`\n追跡していないファイル:\n  (git add <ファイル> で追跡する)`)
      for (const p of st.untracked) ctx.print(`\t${C.red}${p}${C.reset}`)
    }
    if (st.clean && !st.merge) ctx.print(`\nコミットするものはありません。作業中のファイルは記録と同じです`)
    else if (!sl.length && !st.merge) ctx.print(`\nコミットするものはまだありません (git add でステージ / git commit -a でまとめて)`)
  },
  async add(repo, args, ctx) {
    const all = args.includes('-A') || args.includes('--all')
    const specs = args.filter(a => !a.startsWith('-')).map(a => this.resolve(a))
    if (!all && !specs.length) { ctx.err('ステージするファイルを指定してください (例: git add . / git add main.py)\n'); return 1 }
    // 「.」はいまの場所 (cd した場所) の中
    const spec = specs.map(s => s || '.')
    await repo.add(all ? [] : spec, { all })
  },
  async rm(repo, args, ctx) {
    const { o, rest } = getopts(args, 'rfq')
    const cached = args.includes('--cached')
    const specs = rest.filter(a => a !== '--cached').map(a => this.resolve(a))
    if (!specs.length) { ctx.err('消すファイルを指定してください\n'); return 1 }
    const n = await repo.rmCached(specs)
    if (!n) { ctx.err(`fatal: pathspec '${specs[0]}' に当てはまる記録したファイルがありません\n`); return 128 }
    if (!cached) for (const s of specs) if (this.stat(s)) await this.fsRemove(s)
    if (!o.q) for (const s of specs) ctx.print(`rm '${s}'`)
  },
  async mv(repo, args, ctx) {
    const [a, b] = args.filter(x => !x.startsWith('-')).map(x => this.resolve(x))
    if (!a || !b) { ctx.err('使い方: git mv <元> <先>\n'); return 1 }
    const dest = this.isDir(b) ? `${b}/${a.split('/').pop()}` : b
    await this.fsRename(a, dest)
    await repo.rmCached([a])
    await repo.add([dest])
  },
  async 'ls-files'(repo, args, ctx) { for (const p of await repo.files()) ctx.print(p) },
  async commit(repo, args, ctx) {
    const msgs = []
    let all = false, amend = false, allowEmpty = false
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === '-m' || a === '--message') msgs.push(args[++i] ?? '')
      else if (/^-m./.test(a)) msgs.push(a.slice(2))
      else if (/^--message=/.test(a)) msgs.push(a.slice(10))
      else if (a === '-a' || a === '--all') all = true
      else if (a === '-am') { all = true; msgs.push(args[++i] ?? '') }
      else if (a === '--amend') amend = true
      else if (a === '--allow-empty') allowEmpty = true
      else if (a === '--no-edit' || a === '-q' || a === '-v') {}
      else if (a.startsWith('-')) { ctx.err(`commit: ${a} は使えません\n`); return 1 }
    }
    let message = msgs.join('\n\n')
    await repo.load()
    if (!message && amend && repo.headId()) message = (await repo.commitObj(repo.headId())).message
    if (!message && repo.meta.merge) message = repo.meta.merge.message
    if (!message && ctx.term && ctx.term.readLine && !ctx.piped) {
      ctx.out('コミットのメッセージ: ')
      message = (await ctx.term.readLine({})) || ''
    }
    if (!message.trim()) { ctx.err('メッセージがないので、コミットをやめました (git commit -m "メッセージ")\n'); return 1 }
    const r = await repo.commit(message, { all, amend, allowEmpty })
    const st = repo.meta
    const where = st.detached ? `HEAD ${short(r.id)}` : `${st.head}${r.root ? ' (root-commit)' : ''} ${short(r.id)}`
    ctx.print(`[${where}] ${firstLine(message)}`)
    ctx.print(` ${r.files} 個のファイルを変更${r.added ? ` (新規 ${r.added})` : ''}${r.deleted ? ` (削除 ${r.deleted})` : ''}`)
  },
  async log(repo, args, ctx) {
    let n = Infinity, oneline = false, graph = false, all = false, stat = false, patch = false, rev = 'HEAD', path = null
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === '-n' || a === '--max-count') n = Number(args[++i]) || 1
      else if (/^-\d+$/.test(a)) n = Number(a.slice(1))
      else if (/^--max-count=/.test(a)) n = Number(a.split('=')[1]) || 1
      else if (a === '--oneline' || a === '--pretty=oneline' || a === '--format=oneline') oneline = true
      else if (a === '--graph') graph = true
      else if (a === '--all') all = true
      else if (a === '--stat') stat = true
      else if (a === '-p' || a === '--patch') patch = true
      else if (a === '--') { path = args[i + 1] ? this.resolve(args[i + 1]) : null; break }
      else if (a === '--decorate' || a === '--no-decorate') {}
      else if (!a.startsWith('-')) {
        let isRev = true
        try { await repo.load(); await repo.resolve(a) } catch { isRev = false }
        if (isRev) rev = a; else path = this.resolve(a)
      }
    }
    await repo.load()
    if (!repo.headId() && !all) { ctx.err(`fatal: ブランチ '${repo.meta.head}' にはまだコミットがありません\n`); return 128 }
    const list = await repo.log({ rev, n, path, all })
    const refs = await repo.refsByCommit()
    const g = graph ? `${C.red}*${C.reset} ` : ''
    for (const c of list) {
      if (oneline) ctx.print(`${g}${C.yellow}${short(c.id)}${C.reset}${refsText(refs, c.id)} ${firstLine(c.message)}`)
      else {
        ctx.print(`${g}${C.yellow}commit ${c.id}${C.reset}${refsText(refs, c.id)}`)
        const p = graph ? `${C.red}|${C.reset} ` : ''
        if (c.parents.length > 1) ctx.print(`${p}Merge: ${c.parents.map(short).join(' ')}`)
        ctx.print(`${p}Author: ${c.author.name}${c.author.email ? ` <${c.author.email}>` : ''}`)
        ctx.print(`${p}Date:   ${fmtDate(c.time)} (${rel(c.time)})`)
        ctx.print(p)
        for (const l of c.message.split('\n')) ctx.print(`${p}    ${l}`)
        ctx.print(p)
      }
      if (stat || patch) {
        const files = await repo.diff({ from: c.parents[0] || null, to: c.id })
        printDiff(ctx, files, { stat: stat && !patch })
        if (oneline) ctx.print('')
      }
    }
  },
  async diff(repo, args, ctx) {
    const opts = { stat: args.includes('--stat'), nameOnly: args.includes('--name-only'), nameStatus: args.includes('--name-status') }
    const staged = args.includes('--staged') || args.includes('--cached')
    const revs = [], paths = []
    let afterDash = false
    for (const a of args) {
      if (a === '--') { afterDash = true; continue }
      if (a.startsWith('-')) continue
      if (afterDash) { paths.push(this.resolve(a)); continue }
      if (a.includes('..')) { const [x, y] = a.split(/\.\.\.?/); revs.push(x || 'HEAD', y || 'HEAD'); continue }
      let isRev = true
      try { await repo.load(); await repo.resolve(a) } catch { isRev = false }
      if (isRev) revs.push(a); else paths.push(this.resolve(a))
    }
    let from = 'INDEX', to = 'WORK'
    if (revs.length >= 2) { from = revs[0]; to = revs[1] }
    else if (revs.length === 1) { from = revs[0]; to = staged ? 'INDEX' : 'WORK' }
    else if (staged) { from = 'HEAD'; to = 'INDEX' }
    const files = await repo.diff({ from, to, paths })
    printDiff(ctx, files, opts)
    return args.includes('--exit-code') && files.length ? 1 : 0
  },
  async show(repo, args, ctx) {
    const rev = args.find(a => !a.startsWith('-')) || 'HEAD'
    // コミット:ファイル (その時点のファイルの中身)
    const m = /^([^:]*):(.+)$/.exec(rev)
    if (m) {
      const c = await repo.fileAt(m[1] || 'HEAD', m[2])
      if (c === null) { ctx.err(`fatal: ${m[2]} は ${m[1] || 'HEAD'} にありません\n`); return 128 }
      ctx.out(typeof c === 'string' ? c : `(バイナリ ${c.length} バイト)\n`)
      return
    }
    const { commit: c, files } = await repo.show(rev)
    const refs = await repo.refsByCommit()
    ctx.print(`${C.yellow}commit ${c.id}${C.reset}${refsText(refs, c.id)}`)
    ctx.print(`Author: ${c.author.name}${c.author.email ? ` <${c.author.email}>` : ''}\nDate:   ${fmtDate(c.time)}\n`)
    for (const l of c.message.split('\n')) ctx.print(`    ${l}`)
    ctx.print('')
    printDiff(ctx, files, { stat: args.includes('--stat'), nameOnly: args.includes('--name-only'), nameStatus: args.includes('--name-status') })
  },
  async restore(repo, args, ctx) {
    const staged = args.includes('--staged') || args.includes('-S')
    const worktree = args.includes('--worktree') || args.includes('-W') || !staged
    const src = (args.find(a => a.startsWith('--source=')) || '').slice(9) || (args.includes('-s') ? args[args.indexOf('-s') + 1] : null)
    const specs = args.filter((a, i) => !a.startsWith('-') && !(args[i - 1] === '-s')).map(a => this.resolve(a) || '.')
    if (!specs.length) { ctx.err('fatal: 戻すファイルを指定してください (例: git restore main.py / git restore .)\n'); return 128 }
    if (staged) await repo.unstage(specs)
    if (worktree && !(staged && !args.includes('--worktree') && !args.includes('-W'))) await repo.restore(specs, { source: src })
  },
  async reset(repo, args, ctx) {
    const mode = args.includes('--hard') ? 'hard' : args.includes('--soft') ? 'soft' : 'mixed'
    const plain = args.filter(a => !a.startsWith('-'))
    let rev = 'HEAD', paths = []
    for (const a of plain) {
      let isRev = true
      try { await repo.load(); await repo.resolve(a) } catch { isRev = false }
      if (isRev && !paths.length) rev = a; else paths.push(this.resolve(a))
    }
    if (paths.length) { await repo.unstage(paths); ctx.print('ステージから外しました'); return }
    const id = await repo.reset(rev, mode)
    const c = await repo.commitObj(id)
    if (mode === 'hard') ctx.print(`HEAD は ${C.yellow}${short(id)}${C.reset} ${firstLine(c.message)} になりました`)
    else {
      const st = await repo.status()
      if (st.unstaged.length) { ctx.print('ステージしていない変更:'); for (const x of st.unstaged) ctx.print(`${x.kind}\t${x.path}`) }
    }
  },
  async branch(repo, args, ctx) {
    const { o, rest } = getopts(args, 'dDmMavlf', '', { num: null })
    if (o.d || o.D || args.includes('--delete')) {
      for (const b of rest) { const id = await repo.deleteBranch(b, { force: !!o.D || !!o.f }); ctx.print(`ブランチ ${b} を消しました (${short(id)})`) }
      return
    }
    if (o.m || o.M) { await repo.renameBranch(rest[0], rest[1]); return }
    if (rest.length && !o.l && !args.includes('--list')) { await repo.createBranch(rest[0], rest[1] || 'HEAD'); return }
    const list = await repo.branches()
    if (!list.length) { await repo.load(); ctx.print(`* ${C.green}${repo.meta.head}${C.reset} (まだコミットがありません)`); return }
    if (repo.meta.detached) ctx.print(`* ${C.green}(HEAD はブランチではありません ${short(repo.meta.detached)})${C.reset}`)
    for (const b of list) {
      let line = `${b.current ? '* ' + C.green : '  '}${b.name}${C.reset}`
      if (o.v) { const c = await repo.commitObj(b.id); line += `  ${C.yellow}${short(b.id)}${C.reset} ${firstLine(c.message)}` }
      ctx.print(line)
    }
  },
  async switch(repo, args, ctx) {
    const create = args.includes('-c') || args.includes('-C') || args.includes('--create')
    const detach = args.includes('--detach') || args.includes('-d')
    const force = args.includes('-f') || args.includes('--force') || args.includes('--discard-changes')
    const name = args.filter(a => !a.startsWith('-'))[0]
    if (!name) { ctx.err('fatal: 切り替える先のブランチを指定してください\n'); return 128 }
    if (name === '-') { ctx.err('switch -: 使えません。ブランチ名を指定してください\n'); return 1 }
    const r = await repo.checkout(name, { create, force, detach })
    ctx.print(r.created ? `新しいブランチ '${name}' に切り替えました` : r.branch ? `ブランチ '${name}' に切り替えました` : `HEAD を ${short(r.detached)} にしました (ブランチではありません。続けるなら git switch -c 新しい名前)`)
  },
  async checkout(repo, args, ctx) {
    const create = args.includes('-b') || args.includes('-B')
    const force = args.includes('-f') || args.includes('--force')
    const plain = args.filter(a => !a.startsWith('-'))
    if (!plain.length) { ctx.err('fatal: ブランチかファイルを指定してください\n'); return 128 }
    if (create) return SUB.switch.call(this, repo, ['-c', plain[0]], ctx)
    await repo.load()
    // ブランチ・コミットでなければファイル (git checkout main.py → 変更を取り消す)
    let isRev = true
    try { await repo.resolve(plain[0]) } catch { isRev = plain[0] in repo.meta.branches }
    if (!isRev) { await repo.restore(plain.map(a => this.resolve(a))); return }
    if (plain.length > 1) { await repo.restore(plain.slice(1).map(a => this.resolve(a)), { source: plain[0] }); return }
    return SUB.switch.call(this, repo, [...(force ? ['-f'] : []), ...(plain[0] in repo.meta.branches ? [] : ['--detach']), plain[0]], ctx)
  },
  async merge(repo, args, ctx) {
    if (args.includes('--abort')) { await repo.abortMerge(); ctx.print('マージをやめて、前の状態に戻しました'); return }
    if (args.includes('--continue')) return SUB.commit.call(this, repo, [], ctx)
    const name = args.filter(a => !a.startsWith('-'))[0]
    if (!name) { ctx.err('fatal: 取り込むブランチを指定してください\n'); return 128 }
    const mi = args.indexOf('-m')
    const r = await repo.merge(name, { noFF: args.includes('--no-ff'), message: mi >= 0 ? args[mi + 1] : null })
    if (r.upToDate) ctx.print('もう最新です (取り込むものはありません)')
    else if (r.fastForward) {
      ctx.print(`更新 ${short(r.from)}..${short(r.id)}\nFast-forward (そのまま進めました)`)
      printDiff(ctx, await repo.diff({ from: r.from, to: r.id }), { stat: true })
    } else if (r.conflicts) {
      for (const p of r.conflicts) ctx.print(`${C.red}衝突: ${p}${C.reset}`)
      ctx.print(`自動ではマージできませんでした。<<<<<<< と >>>>>>> の間を直して git add し、git commit してください (やめるなら git merge --abort)`)
      return 1
    } else ctx.print(`マージしました (${short(r.id)})`)
  },
  async revert(repo, args, ctx) { return pick.call(this, repo, args, ctx, true) },
  async 'cherry-pick'(repo, args, ctx) { return pick.call(this, repo, args, ctx, false) },
  async stash(repo, args, ctx) {
    let sub = args[0] && !args[0].startsWith('-') ? args[0] : 'push'
    const rest = sub === args[0] ? args.slice(1) : args
    const num = () => { const a = rest.find(x => !x.startsWith('-')); const m = a && /(\d+)/.exec(a); return m ? Number(m[1]) : 0 }
    if (sub === 'save') sub = 'push'
    if (sub === 'push') {
      const mi = rest.indexOf('-m')
      const r = await repo.stash(mi >= 0 ? rest[mi + 1] : rest.filter(a => !a.startsWith('-')).join(' '), { untracked: rest.includes('-u') || rest.includes('--include-untracked') })
      ctx.print(r ? `作業中の変更をしまいました: ${r.message}` : 'しまう変更がありません')
      return
    }
    if (sub === 'list') { (await repo.stashList()).forEach((s, i) => ctx.print(`stash@{${i}}: ${s.message}`)); return }
    if (sub === 'pop' || sub === 'apply') {
      const r = await repo.stashApply(num(), { pop: sub === 'pop' })
      if (r.conflicts.length) { for (const p of r.conflicts) ctx.print(`${C.red}衝突: ${p}${C.reset}`); ctx.print('衝突したので、stash は残してあります (直したら git stash drop)'); return 1 }
      ctx.print(r.dropped ? `stash@{${num()}} を戻して、消しました` : `stash@{${num()}} を戻しました`)
      return
    }
    if (sub === 'drop') { const s = await repo.stashDrop(num()); ctx.print(`stash@{${num()}} を消しました (${short(s.id)})`); return }
    if (sub === 'clear') { await repo.load(); repo.meta.stash = []; await repo.save(); return }
    if (sub === 'show') {
      await repo.load()
      const s = repo.meta.stash[num()]
      if (!s) { ctx.err('stash はありません\n'); return 1 }
      printDiff(ctx, await repo.diff({ from: s.base, to: s.id }), { stat: !rest.includes('-p') })
      return
    }
    ctx.err(`stash: ${sub} は使えません (push / pop / apply / list / drop / show / clear)\n`)
    return 1
  },
  async tag(repo, args, ctx) {
    const { o, rest } = getopts(args, 'dlfa', 'm')
    if (o.d) { for (const t of rest) { await repo.deleteTag(t); ctx.print(`タグ '${t}' を消しました`) } return }
    if (rest.length && !o.l) { await repo.createTag(rest[0], rest[1] || 'HEAD', { force: !!o.f }); return }
    for (const t of await repo.tags()) ctx.print(t.name)
  },
  async blame(repo, args, ctx) {
    const file = args.filter(a => !a.startsWith('-'))[0]
    if (!file) { ctx.err('使い方: git blame <ファイル>\n'); return 1 }
    const rows = await repo.blame(this.resolve(file))
    const w = String(rows.length).length
    for (const [i, r] of rows.entries()) {
      const c = r.commit
      ctx.print(`${C.yellow}${short(c && c.id)}${C.reset} (${(c ? c.author.name : '').slice(0, 10).padEnd(10)} ${c ? fmtDate(c.time).slice(0, 10) : ''} ${String(i + 1).padStart(w)}) ${r.line}`)
    }
  },
  async 'rev-parse'(repo, args, ctx) {
    await repo.load()
    for (const a of args) {
      if (a === '--abbrev-ref' || a === '--short' || a === '--verify' || a === '-q') continue
      if (a === '--show-toplevel') { ctx.print('~'); continue }
      if (args.includes('--abbrev-ref') && a === 'HEAD') { ctx.print(repo.meta.detached ? 'HEAD' : repo.meta.head); continue }
      const id = await repo.resolve(a)
      ctx.print(args.includes('--short') ? short(id) : id)
    }
  },
  async config(repo, args, ctx) {
    const plain = args.filter(a => !a.startsWith('--'))
    const key = plain[0]
    if (args.includes('--list') || args.includes('-l') || !key) {
      if (!(await repo.exists())) return
      await repo.load()
      const u = repo.user()
      ctx.print(`user.name=${u.name}\nuser.email=${u.email}\ninit.defaultbranch=main`)
      return
    }
    if (!(await repo.exists())) await repo.init()
    if (key !== 'user.name' && key !== 'user.email') { if (plain.length > 1) ctx.print(`(${key} は覚えておくだけで、使いません)`); return }
    const field = key.split('.')[1]
    if (plain.length < 2) { await repo.load(); ctx.print(repo.user()[field] || ''); return }
    await repo.setUser({ [field]: plain.slice(1).join(' ') })
  },
  async remote(repo, args, ctx) {
    const info = this.host.githubInfo ? this.host.githubInfo() : null
    if (!info) { ctx.print('(GitHub と同期はまだ設定していません: 設定 → 保存 → GitHub と同期)'); return }
    ctx.print(args.includes('-v') ? `origin\thttps://github.com/${info.repo} (fetch)\norigin\thttps://github.com/${info.repo} (push)` : 'origin')
  },
  async push(repo, args, ctx) {
    let message = null
    if (await repo.exists()) { await repo.load(); const id = repo.headId(); if (id) message = firstLine((await repo.commitObj(id)).message) }
    ctx.print('GitHub に保存します…')
    if (this.host.githubPush) await this.host.githubPush(message)
    else await this.host.command('githubPush')
  },
  async pull(repo, args, ctx) {
    ctx.print('GitHub から取り込みます…')
    await this.host.command('githubPull')
    if (await repo.exists()) ctx.print(`${C.gray}(取り込んだ変更は git status で確かめて、git commit で記録できます)${C.reset}`)
  },
  async fetch(repo, args, ctx) { return SUB.pull.call(this, repo, args, ctx) },
  async clone(repo, args, ctx) { ctx.print('GitHub のプロジェクトは「プロジェクト一覧 → GitHub から開く」で開けます'); return SUB.pull.call(this, repo, args, ctx) },
}

async function pick(repo, args, ctx, revert) {
  if (args.includes('--abort')) { await repo.abortMerge(); ctx.print('やめて、前の状態に戻しました'); return }
  if (args.includes('--continue')) return SUB.commit.call(this, repo, [], ctx)
  const rev = args.filter(a => !a.startsWith('-'))[0]
  if (!rev) { ctx.err(`使い方: git ${revert ? 'revert' : 'cherry-pick'} <コミット>\n`); return 1 }
  const r = await repo.pick(rev, { revert })
  if (r.conflicts) {
    for (const p of r.conflicts) ctx.print(`${C.red}衝突: ${p}${C.reset}`)
    ctx.print('自動ではできませんでした。直して git add し、git commit してください (やめるなら --abort)')
    return 1
  }
  const c = await repo.commitObj(r.id)
  ctx.print(`[${repo.meta.detached ? 'HEAD' : repo.meta.head} ${short(r.id)}] ${firstLine(c.message)}`)
}

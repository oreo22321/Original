// git (git-core.js とターミナルの git コマンド) のテスト:  node tests/git.test.mjs
import { Shell } from '../js/app/shell.js'
import { GitRepo, memoryStore, unifiedDiff, merge3, diffOps, ignoreMatcher } from '../js/app/git-core.js'

let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

// ---- 差分・マージの道具 ----
{
  const ops = diffOps(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])
  ok('diffOps keeps equal lines', ops.filter(o => o[0] === '=').length === 3)
  const d = unifiedDiff('a\nb\nc\n', 'a\nB\nc\nd\n').map(l => (l.t === '@' ? l.s : l.t + l.s))
  ok('unified diff', d[0] === '@@ -1,3 +1,4 @@' && d.includes('-b') && d.includes('+B') && d.includes('+d'), JSON.stringify(d))
  const nn = unifiedDiff('a\nb', 'a\nb\n').map(l => l.t + l.s)
  ok('diff no newline at end', nn.includes('\\ No newline at end of file'), JSON.stringify(nn))
  ok('diff new file', unifiedDiff(null, 'x\ny\n')[0].s === '@@ -0,0 +1,2 @@')
  const m = merge3('1\n2\n3\n4\n5\n', '1\nTWO\n3\n4\n5\n', '1\n2\n3\n4\nFIVE\n')
  ok('merge3 clean', m.conflicts === 0 && m.text === '1\nTWO\n3\n4\nFIVE\n', JSON.stringify(m))
  const c = merge3('a\nb\nc\n', 'a\nX\nc\n', 'a\nY\nc\n', { ours: 'HEAD', theirs: 'feat' })
  ok('merge3 conflict markers', c.conflicts === 1 && c.text.includes('<<<<<<< HEAD\nX\n=======\nY\n>>>>>>> feat'), c.text)
  ok('merge3 same change', merge3('a\nb\n', 'a\nZ\n', 'a\nZ\n').conflicts === 0)
  const ig = ignoreMatcher('*.log\nbuild/\n/secret.txt\n!keep.log')
  ok('gitignore', ig('x.log') && ig('a/b.log') && !ig('keep.log') && ig('build/out.js') && ig('secret.txt') && !ig('a/secret.txt') && ig('__pycache__/m.pyc') && !ig('main.py'))
  // 長いファイル: 1 行だけ違う
  const big = Array.from({ length: 5000 }, (_, i) => 'line ' + i)
  const big2 = big.slice(); big2[2500] = 'changed'
  const t0 = Date.now()
  const bd = unifiedDiff(big.join('\n') + '\n', big2.join('\n') + '\n')
  ok('big diff is fast and small', Date.now() - t0 < 500 && bd.length === 9, `${Date.now() - t0}ms ${bd.length}`)
}

// ---- ターミナルの git ----
const files = new Map(Object.entries({ 'main.py': 'print("hi")\n', 'util.py': 'def f():\n    return 1\n' }))
const dirs = new Set()
const listNow = () => [...[...dirs].map(p => ({ path: p, dir: true })), ...[...files].map(([p, c]) => ({ path: p, dir: false, size: c.length, mtime: 1 }))]
let snapshot = listNow()
const store = memoryStore()
const calls = []
const host = {
  files: () => snapshot,
  read: async p => (files.has(p) ? files.get(p) : null),
  write: async (p, t) => { files.set(p, t) },
  mkdir: async p => { dirs.add(p) },
  remove: async p => { for (const k of [...files.keys()]) if (k === p || k.startsWith(p + '/')) files.delete(k) },
  rename: async (a, b) => { const v = files.get(a); files.delete(a); files.set(b, v) },
  changed: async () => { snapshot = listNow() },
  gitStore: () => store,
  githubPush: async msg => { calls.push(['push', msg]) },
  command: async id => { calls.push(['command', id]) },
  pyVersion: () => 'Python 3.14',
}
const sh = new Shell(host)
async function run(line) {
  const out = [], err = []
  const status = await sh.run(line, { out: s => out.push(s), err: s => err.push(s), tty: true, cols: () => 80, signal: new AbortController().signal })
  return { status, out: strip(out.join('')), err: strip(err.join('')) }
}

let r = await run('git status')
ok('not a repo yet', r.status === 128 && /git init/.test(r.err), r.err)
r = await run('git init')
ok('git init', r.status === 0 && /リポジトリを作りました/.test(r.out))
r = await run('git status')
ok('status untracked', /追跡していないファイル/.test(r.out) && /main\.py/.test(r.out) && /まだコミットはありません/.test(r.out), r.out)
r = await run('git commit -m "first"')
ok('commit nothing staged', r.status === 1 && /git add/.test(r.err), r.err)
await run('git config user.name "Hana"')
r = await run('git add . && git commit -m "最初のコミット"')
ok('first commit', r.status === 0 && /\[main [0-9a-f]{7}\] 最初のコミット/.test(r.out) && /2 個のファイル/.test(r.out), r.out + r.err)
r = await run('git status -s')
ok('clean status', r.out.trim() === '', JSON.stringify(r.out))
r = await run('git log --oneline')
ok('log oneline', /^[0-9a-f]{7} \(HEAD -> main\) 最初のコミット/.test(r.out.trim()), r.out)
r = await run('git log')
ok('log author', /Author: Hana/.test(r.out) && /commit [0-9a-f]{40}/.test(r.out))

// 変更 → diff → commit -a
await run('echo "print(f())" >> main.py')
r = await run('git status -s')
ok('modified short', r.out.trim() === 'M main.py', JSON.stringify(r.out))
r = await run('git diff')
ok('git diff', /diff --git a\/main.py b\/main.py/.test(r.out) && /\+print\(f\(\)\)/.test(r.out) && /@@ -1 ?,?1? \+1,2 @@|@@ -1,1 \+1,2 @@/.test(r.out), r.out)
r = await run('git diff --stat')
ok('diff --stat', /main\.py \|\s+1 \+/.test(r.out) && /1 行追加/.test(r.out), r.out)
await run('git add main.py')
r = await run('git diff --staged --name-only')
ok('diff --staged', r.out.trim() === 'main.py', r.out)
r = await run('git commit -m "f を呼ぶ"')
ok('second commit', /f を呼ぶ/.test(r.out))
r = await run('git log --oneline -n 1')
ok('log -n', r.out.trim().split('\n').length === 1 && /f を呼ぶ/.test(r.out))

// 新しいファイル・削除
await run('echo "x = 1" > new.py && rm util.py')
r = await run('git status -s')
ok('untracked + deleted', /\?\? new\.py/.test(r.out) && / D util\.py/.test(r.out), JSON.stringify(r.out))
r = await run('git add -A && git commit -m "整理"')
ok('commit add -A', r.status === 0 && /新規 1/.test(r.out) && /削除 1/.test(r.out), r.out)
r = await run('git show --name-status HEAD')
ok('show name-status', /A\tnew\.py/.test(r.out) && /D\tutil\.py/.test(r.out), r.out)
r = await run('git show HEAD~1:util.py')
ok('show file at commit', r.out === 'def f():\n    return 1\n', JSON.stringify(r.out))

// restore / reset
await run('echo "broken" > main.py')
await run('git restore main.py')
ok('restore file', files.get('main.py') === 'print("hi")\nprint(f())\n', files.get('main.py'))
r = await run('git reset --hard HEAD~1')
ok('reset --hard', files.has('util.py') && !files.has('new.py') && /HEAD は/.test(r.out), [...files.keys()].join(','))
r = await run('git log --oneline')
ok('reset moved branch', r.out.trim().split('\n').length === 2, r.out)

// ブランチ・マージ (fast-forward と 3-way と衝突)
r = await run('git switch -c feature')
ok('switch -c', /新しいブランチ 'feature'/.test(r.out))
await run('echo "def g():\n    return 2" >> util.py')
await run('git commit -am "g を追加"')
await run('git switch main')
ok('switch back restores file', !files.get('util.py').includes('def g'), files.get('util.py'))
r = await run('git branch')
ok('branch list', /\* main/.test(r.out) && /  feature/.test(r.out), r.out)
r = await run('git merge feature')
ok('fast-forward merge', /Fast-forward/.test(r.out) && files.get('util.py').includes('def g'), r.out)
// 3-way (きれいに)
await run('git switch -c b2')
await run("sed -i 's/hi/hello/' main.py")
await run('git commit -am "hello に"')
await run('git switch main')
await run('echo "# note" >> util.py')
await run('git commit -am "メモ"')
r = await run('git merge b2')
ok('3-way merge commit', /マージしました/.test(r.out) && files.get('main.py').includes('hello') && files.get('util.py').includes('# note'), r.out + r.err)
r = await run('git log --oneline -n 1')
ok('merge message', /Merge branch 'b2' into main/.test(r.out), r.out)
// 衝突
await run('git switch -c b3')
await run("sed -i 's/hello/こんにちは/' main.py")
await run('git commit -am "日本語"')
await run('git switch main')
await run("sed -i 's/hello/hola/' main.py")
await run('git commit -am "スペイン語"')
r = await run('git merge b3')
ok('merge conflict', r.status === 1 && /衝突: main\.py/.test(r.out) && files.get('main.py').includes('<<<<<<< HEAD'), r.out + files.get('main.py'))
r = await run('git status')
ok('status shows conflict', /衝突しているファイル/.test(r.out) && /マージの途中/.test(r.out), r.out)
r = await run('git commit -m x')
ok('cannot commit with conflict', r.status === 1 && /衝突/.test(r.err), r.err)
await run('printf \'print("hola こんにちは")\\nprint(f())\\n\' > main.py')
await run('git add main.py')
r = await run('git commit')
ok('commit resolves merge', r.status === 0 && /Merge branch 'b3'/.test(r.out), r.out + r.err)
await repoCheck()
async function repoCheck() {
  const repo = new GitRepo(store, { list: () => [...files.keys()], read: async p => files.get(p) ?? null, write: async (p, c) => files.set(p, c), remove: async p => files.delete(p) })
  await repo.load()
  const c = await repo.commitObj(repo.headId())
  ok('merge commit has two parents', c.parents.length === 2)
}
// merge --abort
await run('git switch b3')
await run("sed -i 's/こんにちは/やあ/' main.py")
await run('git commit -am "やあ"')
await run('git switch main')
r = await run('git merge b3')
if (r.status === 1) { await run('git merge --abort'); ok('merge --abort', !files.get('main.py').includes('<<<<<<<')) } else ok('merge --abort (merged cleanly instead)', true)

// stash
await run('echo "tmp = 1" >> main.py')
r = await run('git stash')
ok('stash push', /しまいました/.test(r.out) && !files.get('main.py').includes('tmp = 1'), r.out)
r = await run('git stash list')
ok('stash list', /stash@\{0\}: WIP on main/.test(r.out), r.out)
r = await run('git stash pop')
ok('stash pop', files.get('main.py').includes('tmp = 1') && /戻して、消しました/.test(r.out), r.out + r.err)
await run('git checkout -- main.py')
ok('checkout -- file', !files.get('main.py').includes('tmp = 1'))

// switch が変更を守る
await run('echo "dirty" >> util.py')
await run('git switch -c side')
await run('git switch main')
r = await run('git status -s')
ok('switch keeps unrelated changes', /M util\.py/.test(r.out), r.out)
await run('git restore util.py')

// revert / cherry-pick
await run('echo "VERSION = 1" > version.py && git add version.py && git commit -m "版"')
r = await run('git revert HEAD')
ok('revert', r.status === 0 && !files.has('version.py') && /Revert "版"/.test(r.out), r.out + r.err)
await run('git switch side')
r = await run('git cherry-pick main~1')
ok('cherry-pick', r.status === 0 && files.get('version.py') === 'VERSION = 1\n', r.out + r.err)
await run('git switch main')

// tag・blame・branch -d・rev-parse
await run('git tag v1.0')
r = await run('git log --oneline -n 1')
ok('tag decoration', /tag: v1\.0/.test(r.out), r.out)
r = await run('git blame util.py')
ok('blame', /^[0-9a-f]{7} \(Hana/.test(r.out) && r.out.trim().split('\n').length === files.get('util.py').trim().split('\n').length, r.out)
r = await run('git branch -d side')
ok('branch -d unmerged refuses', r.status === 1 && /-D/.test(r.err), r.err)
r = await run('git branch -D side')
ok('branch -D', /消しました/.test(r.out))
r = await run('git rev-parse --short HEAD')
ok('rev-parse', /^[0-9a-f]{7}$/.test(r.out.trim()))
r = await run('git rev-parse --abbrev-ref HEAD')
ok('rev-parse abbrev', r.out.trim() === 'main')
// .gitignore
await run('echo "secret" > secret.txt && echo "secret.txt" > .gitignore')
r = await run('git status -s')
ok('gitignore hides file', !/secret\.txt/.test(r.out) && /\?\? \.gitignore/.test(r.out), r.out)
// push はメッセージ付きで同期へ
await run('git add .gitignore && git commit -m "無視するファイル"')
await run('git push')
ok('push uses last message', calls.some(c => c[0] === 'push' && c[1] === '無視するファイル'), JSON.stringify(calls))
// amend
r = await run('git commit --amend -m "無視の設定"')
r = await run('git log --oneline -n 1')
ok('amend', /無視の設定/.test(r.out) && !/無視するファイル/.test(r.out), r.out)
r = await run('git nope')
ok('unknown sub', r.status === 1 && /git help/.test(r.err))
// 詳しいことはヘルプ
r = await run('git')
ok('git help', /init .*記録をはじめる/.test(r.out) && /push/.test(r.out))
// バイナリ
files.set('img.png', new Uint8Array([137, 80, 78, 71, 1, 2, 3])); snapshot = listNow()
await run('git add img.png && git commit -m "画像"')
files.set('img.png', new Uint8Array([137, 80, 78, 71, 9, 9]))
r = await run('git diff')
ok('binary diff', /Binary files a\/img\.png and b\/img\.png differ/.test(r.out), r.out)
await run('git restore img.png')
ok('restore binary', files.get('img.png') instanceof Uint8Array && files.get('img.png')[4] === 1)

console.log(`\ngit: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

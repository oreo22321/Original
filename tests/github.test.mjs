// GitHub 同期のテスト (偽の GitHub を相手に):  node tests/github.test.mjs
import { createMockGitHub } from './mock-github.mjs'
import { GitHubClient, pushProject, pullProject, listRemoteProjects, blobSha, toBase64, fromBase64 } from '../js/app/github-core.js'
import { createHash } from 'node:crypto'

let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

const gh = createMockGitHub()
await new Promise(r => gh.server.listen(0, r))
const api = `http://127.0.0.1:${gh.server.address().port}`
const client = () => new GitHubClient({ token: 'tok', repo: 'me/proj', api })
const DIR = 'forgecode/MyGame'

// 基本
ok('base64 utf8 round trip', fromBase64(toBase64('日本語 abc\n')) === '日本語 abc\n')
const ref = createHash('sha1').update(Buffer.concat([Buffer.from('blob 6\0'), Buffer.from('hello\n')])).digest('hex')
ok('git blob sha', (await blobSha('hello\n')) === ref)
ok('repo name check', (() => { try { new GitHubClient({ repo: 'bad' }); return false } catch { return true } })())
ok('repo url accepted', new GitHubClient({ repo: 'https://github.com/a/b.git' }).name === 'b')
let err = null
try { await new GitHubClient({ token: 'wrong', repo: 'me/proj', api }).head() } catch (e) { err = e }
ok('bad token → friendly error', err && err.status === 401 && /トークン/.test(err.message))

// 空のリポジトリに最初の同期
let files = { 'main.lua': 'print(1)\n', 'src/util.luau': 'return {}\n' }
let r = await pushProject(client(), { dir: DIR, files })
ok('first push', r.pushed === 2 && !r.conflicts.length, JSON.stringify(r))
ok('remote has files', gh.remoteFiles()[`${DIR}/main.lua`] === 'print(1)\n' && gh.remoteFiles()['README.md'])
let state = r.state
// 変更なし → コミットしない
const before = gh.stats.commits
r = await pushProject(client(), { dir: DIR, files, state })
ok('no-op push makes no commit', r.pushed === 0 && gh.stats.commits === before)
// 編集・削除・追加
files = { 'main.lua': 'print(2)\n', 'new.lua': 'x = 1\n' }
r = await pushProject(client(), { dir: DIR, files, state })
state = r.state
const rf = gh.remoteFiles()
ok('edit + add + delete pushed in one commit', r.pushed === 3 && rf[`${DIR}/main.lua`] === 'print(2)\n' && rf[`${DIR}/new.lua`] === 'x = 1\n' && !(`${DIR}/src/util.luau` in rf), JSON.stringify(Object.keys(rf)))

// GitHub で誰かが編集 → 読み込み
gh.remoteEdit({ [`${DIR}/new.lua`]: 'x = 2\n', [`${DIR}/extra.lua`]: 'print("from web")\n' })
r = await pullProject(client(), { dir: DIR, files, state })
ok('pull brings remote edits', r.changes['new.lua'] === 'x = 2\n' && r.changes['extra.lua'] === 'print("from web")\n' && !r.conflicts.length, JSON.stringify(r))
files = { ...files, ...r.changes }
state = r.state
// 送ろうとしても、GitHub だけが変わったファイルは上書きしない
gh.remoteEdit({ [`${DIR}/main.lua`]: 'print("web")\n' })
r = await pushProject(client(), { dir: DIR, files, state })
ok('push does not overwrite remote-only change', r.pushed === 0 && r.remoteNewer.includes('main.lua') && gh.remoteFiles()[`${DIR}/main.lua`] === 'print("web")\n')
r = await pullProject(client(), { dir: DIR, files, state: r.state })
files = { ...files, ...r.changes }
state = r.state
ok('then pull takes it', files['main.lua'] === 'print("web")\n')

// 両方で変更 → 衝突 (どちらも勝手に上書きしない)
gh.remoteEdit({ [`${DIR}/main.lua`]: 'print("web 2")\n' })
files = { ...files, 'main.lua': 'print("phone 2")\n' }
r = await pushProject(client(), { dir: DIR, files, state })
ok('conflict detected on push', r.conflicts.includes('main.lua') && gh.remoteFiles()[`${DIR}/main.lua`] === 'print("web 2")\n')
const p2 = await pullProject(client(), { dir: DIR, files, state: r.state })
ok('conflict detected on pull', p2.conflicts.includes('main.lua') && !('main.lua' in p2.changes))
// この端末の内容で解決
r = await pushProject(client(), { dir: DIR, files, state: r.state, force: ['main.lua'] })
state = r.state
ok('force push resolves', r.pushed === 1 && gh.remoteFiles()[`${DIR}/main.lua`] === 'print("phone 2")\n')
// GitHub の内容で解決
gh.remoteEdit({ [`${DIR}/main.lua`]: 'print("web 3")\n' })
files = { ...files, 'main.lua': 'print("phone 3")\n' }
r = await pullProject(client(), { dir: DIR, files, state, force: true })
ok('force pull resolves', r.changes['main.lua'] === 'print("web 3")\n')
files = { ...files, ...r.changes }
state = r.state

// GitHub で削除 → この端末でも削除 (この端末で変えていなければ)
gh.remoteEdit({ [`${DIR}/extra.lua`]: null })
r = await pullProject(client(), { dir: DIR, files, state })
ok('remote delete propagates', r.changes['extra.lua'] === null)

// 他のプロジェクト
await pushProject(client(), { dir: 'forgecode/Other', files: { 'a.lua': '' } })
ok('list remote projects', JSON.stringify(await listRemoteProjects(client(), 'forgecode')) === JSON.stringify(['MyGame', 'Other']))
// 他の人が同時に進めた (fast-forward でない) → やり直して成功
const c = client()
const realCommit = c.commit.bind(c)
let raced = false
c.commit = async (head, entries, message) => { if (!raced) { raced = true; gh.remoteEdit({ 'other.txt': 'x' }) } return realCommit(head, entries, message) }
r = await pushProject(c, { dir: DIR, files: { ...files, 'race.lua': 'r\n' }, state })
ok('retries after a race', raced && r.pushed >= 1 && gh.remoteFiles()[`${DIR}/race.lua`] === 'r\n' && gh.remoteFiles()['other.txt'] === 'x')
// 危ないパスは送らない
r = await pushProject(client(), { dir: DIR, files: { ...files, '../evil.lua': 'x' }, state: r.state })
ok('unsafe paths ignored', !Object.keys(gh.remoteFiles()).some(p => p.includes('evil')))
// 空のプロジェクトで GitHub のファイルを消さない
const count = Object.keys(gh.remoteFiles()).length
r = await pushProject(client(), { dir: DIR, files: {}, state: r.state })
ok('empty local never wipes remote', r.skipped === 'empty' && Object.keys(gh.remoteFiles()).length === count)

gh.server.close()
console.log(`github: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

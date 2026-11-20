// クラウド実行 (GitHub Actions) のテスト:  node tests/cloud.test.mjs
// ・ワークフローの中身・置く/消す・今すぐ実行・記録の読み出しを、偽の GitHub で確かめる
// ・GitHub のサーバーで動く道具 (cloud.py) を、この PC の python3 と git で実際に動かす (python3 / git がなければ飛ばす)
import { createMockGitHub } from './mock-github.mjs'
import { GitHubClient } from '../js/app/github-core.js'
import { cronOf, workflowYaml, workflowPath, HELPER_PATH, CLOUD_PY, enableCloud, disableCloud, dispatchCloud, cloudRuns, cloudResult, monthlyMinutes, LOG_BRANCH } from '../js/app/cloud-core.js'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

// ---- いつ動かすか ----
ok('cron every 5 minutes', cronOf('5m') === '*/5 * * * *')
ok('cron hourly is spread out', /^\d+ \* \* \* \*$/.test(cronOf('1h', { id: 'p1' })) && cronOf('1h', { id: 'p1' }) !== '0 * * * *')
ok('cron daily converts local time to UTC', cronOf('daily', { time: '08:30', tzOffset: -540 }) === '30 23 * * *', cronOf('daily', { time: '08:30', tzOffset: -540 }))
ok('manual has no cron', cronOf('manual') === null)
ok('monthly minutes estimate', monthlyMinutes('5m') === 8640 && monthlyMinutes('daily') === 30)
const cfg = { id: 'p123', name: 'Bot "テスト"', dir: 'forgecode/Bot', entry: 'main.py', schedule: '15m', timeout: 10, save: true, tz: 'Asia/Tokyo' }
const yml = workflowYaml(cfg)
ok('workflow has schedule, dispatch and env', /workflow_dispatch:/.test(yml) && /cron: "\d+-59\/15 \* \* \* \*"/.test(yml) && /FORGECODE_DIR: "forgecode\/Bot"/.test(yml) && /timeout-minutes: 15/.test(yml) && /TZ: "Asia\/Tokyo"/.test(yml), yml)
ok('workflow quotes names safely', /name: "ForgeCode: Bot \\"テスト\\""/.test(yml))
ok('workflow uses the GitHub token from Actions', /GITHUB_TOKEN: \$\{\{ github\.token \}\}/.test(yml))
ok('manual workflow has no schedule', !/schedule:/.test(workflowYaml({ ...cfg, schedule: 'manual' })))

// ---- 偽の GitHub で: 置く・今すぐ実行・記録・止める ----
const gh = createMockGitHub()
await new Promise(r => gh.server.listen(0, r))
const api = `http://127.0.0.1:${gh.server.address().port}`
const client = () => new GitHubClient({ token: 'tok', repo: 'me/proj', api })
gh.remoteEdit({ 'forgecode/Bot/main.py': 'print("hi")\n' })
let err = null
try { await dispatchCloud(client(), cfg) } catch (e) { err = e }
ok('dispatch before setup explains', err && /ワークフローが見つかりません/.test(err.message))
await enableCloud(client(), cfg)
let rf = gh.remoteFiles()
ok('workflow and helper are committed', rf[workflowPath(cfg.id)] === yml && rf[HELPER_PATH] === CLOUD_PY && rf['forgecode/Bot/main.py'])
await dispatchCloud(client(), cfg)
const runs = await cloudRuns(client(), cfg)
ok('run now shows up in the run list', runs.length === 1 && runs[0].event === 'workflow_dispatch' && runs[0].url, JSON.stringify(runs))
let res = await cloudResult(client(), cfg)
ok('no result before the first run', res.log === null && res.status === null)

// ---- cloud.py を実際に動かす ----
const hasTool = cmd => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0
if (hasTool('python3') && hasTool('git')) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'fc-cloud-'))
  const bare = path.join(tmp, 'remote.git'), work = path.join(tmp, 'work')
  const sh = (args, cwd) => spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8' })
  sh(['git', 'init', '-q', '--bare', '-b', 'main', bare], tmp)
  sh(['git', 'clone', '-q', bare, work], tmp)
  mkdirSync(path.join(work, 'forgecode/Bot'), { recursive: true })
  mkdirSync(path.join(work, '.forgecode'), { recursive: true })
  writeFileSync(path.join(work, HELPER_PATH), CLOUD_PY)
  writeFileSync(path.join(work, 'forgecode/Bot/main.py'), 'import os, datetime, json\nname = input()\nn = int(open("count.txt").read()) + 1 if os.path.exists("count.txt") else 1\nopen("count.txt", "w").write(str(n))\nprint("hello", name, n)\n')
  writeFileSync(path.join(work, 'forgecode/Bot/input.txt'), 'cloud\n')
  sh(['git', '-c', 'user.name=t', '-c', 'user.email=t@x', 'add', '-A'], work)
  sh(['git', '-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'init'], work)
  sh(['git', 'push', '-q', 'origin', 'HEAD:main'], work)
  const env = { ...process.env, FORGECODE_ID: cfg.id, FORGECODE_DIR: 'forgecode/Bot', FORGECODE_ENTRY: 'main.py', FORGECODE_LIMIT: '60', FORGECODE_SAVE: '1', FORGECODE_EVENT: 'schedule', GITHUB_REPOSITORY: 'me/proj', GITHUB_TOKEN: 'tok', GITHUB_API_URL: api, GITHUB_RUN_ID: '42', PYTHONDONTWRITEBYTECODE: '1' }
  const runHelper = () => new Promise(resolve => {
    import('node:child_process').then(({ spawn }) => {
      const p = spawn('python3', [HELPER_PATH], { cwd: work, env })
      let o = ''
      p.stdout.on('data', d => { o += d }); p.stderr.on('data', d => { o += d })
      p.on('close', code => resolve({ code, out: o }))
    })
  })
  let r = await runHelper()
  ok('helper runs the program with input.txt', r.code === 0 && /hello cloud 1/.test(r.out), r.out)
  res = await cloudResult(client(), cfg)
  ok('log and status saved on the log branch', /hello cloud 1/.test(res.log || '') && res.status && res.status.state === 'ok' && res.status.event === 'schedule' && /runs\/42/.test(res.status.url), JSON.stringify(res.status))
  const pushed = sh(['git', '--git-dir', bare, 'show', 'main:forgecode/Bot/count.txt'], tmp).stdout
  ok('files written by the program are saved to the repo', pushed === '1', pushed)
  r = await runHelper()
  res = await cloudResult(client(), cfg)
  ok('second run continues from saved files and keeps history', /hello cloud 2/.test(res.log || '') && res.status.history.length === 2, res.log)
  ok('log branch does not grow (one commit)', Object.keys(gh.remoteFiles(LOG_BRANCH)).length === 2)
  writeFileSync(path.join(work, 'forgecode/Bot/main.py'), 'raise ValueError("boom")\n')
  r = await runHelper()
  res = await cloudResult(client(), cfg)
  ok('errors are reported and fail the job', r.code === 1 && res.status.state === 'error' && /ValueError: boom/.test(res.log), r.out)
  writeFileSync(path.join(work, 'forgecode/Bot/main.py'), 'import time\nprint("start", flush=True)\ntime.sleep(30)\n')
  r = await runHelper.call(null, (env.FORGECODE_LIMIT = '2'))
  res = await cloudResult(client(), cfg)
  ok('long runs stop at the time limit and still save the log', res.status.state === 'timeout' && /start/.test(res.log) && /止めました/.test(res.log), res.log)
  rmSync(tmp, { recursive: true, force: true })
} else console.log('(python3 / git がないので cloud.py の実行は飛ばしました)')

await disableCloud(client(), cfg)
rf = gh.remoteFiles()
ok('stop removes the workflow but keeps the project', !(workflowPath(cfg.id) in rf) && rf['forgecode/Bot/main.py'] && rf[HELPER_PATH])

gh.server.close()
console.log(`cloud: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

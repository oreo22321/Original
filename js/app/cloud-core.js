// クラウド実行 (GitHub Actions) の中身 (画面に触らない部分。テストでも使います)
// ・GitHub の同期先のリポジトリに「ワークフロー」を置き、GitHub のサーバーで Python を動かします
//   → アプリを閉じても、スマホの電源を切っても、決めた間隔 (5 分ごと〜毎日) で動きます
// ・プログラムが書いたファイルはリポジトリに保存 (アプリは「GitHub から取り込む」で受け取る)
// ・出力と結果は forgecode-cloud ブランチに 1 つだけ残します (コミットが増え続けないよう、毎回置き換え)
export const LOG_BRANCH = 'forgecode-cloud'
export const SCHEDULES = [
  ['manual', '手動 (「今すぐ実行」のときだけ)'],
  ['5m', '5 分ごと'],
  ['15m', '15 分ごと'],
  ['30m', '30 分ごと'],
  ['1h', '1 時間ごと'],
  ['3h', '3 時間ごと'],
  ['6h', '6 時間ごと'],
  ['daily', '毎日 (決まった時刻)'],
]
export const TIMEOUTS = [5, 10, 30, 60, 120, 240, 340]
const RUNS_PER_DAY = { manual: 0, '5m': 288, '15m': 96, '30m': 48, '1h': 24, '3h': 8, '6h': 4, daily: 1 }

// プロジェクトごとのワークフローのファイル名 (名前に日本語があっても大丈夫なように id で)
export const workflowFile = id => `forgecode-cloud-${String(id).replace(/[^\w-]/g, '')}.yml`
export const workflowPath = id => `.github/workflows/${workflowFile(id)}`
export const HELPER_PATH = '.forgecode/cloud.py'

// 毎回同じ分 (00 分) に集まらないよう、プロジェクトごとに少しずらす
function minuteOf(id) {
  let h = 7
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 997
  return 3 + (h % 50)
}
// tzOffset: Date#getTimezoneOffset() (日本は -540)。GitHub の時刻は UTC
export function cronOf(schedule, { id = '', time = '08:00', tzOffset = 0 } = {}) {
  const m = minuteOf(id)
  switch (schedule) {
    case '5m': return '*/5 * * * *'
    case '15m': return `${m % 15}-59/15 * * * *`
    case '30m': return `${m % 30}-59/30 * * * *`
    case '1h': return `${m} * * * *`
    case '3h': return `${m} */3 * * *`
    case '6h': return `${m} */6 * * *`
    case 'daily': {
      const [hh, mm] = String(time || '08:00').split(':').map(Number)
      const utc = (((hh || 0) * 60 + (mm || 0) + tzOffset) % 1440 + 1440) % 1440
      return `${utc % 60} ${Math.floor(utc / 60)} * * *`
    }
    default: return null
  }
}
// 1 か月に使う時間のおおよそ (分)。準備に 1 分ほどかかる
export function monthlyMinutes(schedule, avgMinutes = 1) {
  return Math.round((RUNS_PER_DAY[schedule] || 0) * 30 * Math.max(1, avgMinutes))
}

const q = s => JSON.stringify(String(s))   // YAML の "…" (JSON の文字列は YAML でもそのまま使える)

// cfg: { id, name, dir, entry, schedule, time, timeout (分), save, tz, tzOffset }
export function workflowYaml(cfg) {
  const cron = cronOf(cfg.schedule, cfg)
  const timeout = Math.max(1, Math.min(340, Number(cfg.timeout) || 10))
  return `# ForgeCode が作ったファイルです。アプリの「クラウドで動かす」から変えられます
# ${cfg.name} の ${cfg.entry} を GitHub のサーバーで動かします (アプリを閉じても、スマホの電源を切っても動きます)
name: ${q('ForgeCode: ' + cfg.name)}
on:
  workflow_dispatch:
${cron ? `  schedule:\n    - cron: ${q(cron)}\n` : ''}permissions:
  contents: write
concurrency:
  group: ${q('forgecode-cloud-' + cfg.id)}
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: ${timeout + 5}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.x"
      - name: ${q('Python で ' + cfg.entry + ' を実行')}
        env:
          FORGECODE_ID: ${q(cfg.id)}
          FORGECODE_DIR: ${q(cfg.dir)}
          FORGECODE_ENTRY: ${q(cfg.entry)}
          FORGECODE_LIMIT: "${timeout * 60}"
          FORGECODE_SAVE: "${cfg.save === false ? 0 : 1}"
          FORGECODE_EVENT: \${{ github.event_name }}
          GITHUB_TOKEN: \${{ github.token }}
          TZ: ${q(cfg.tz || 'UTC')}
          MPLBACKEND: Agg
          SDL_VIDEODRIVER: dummy
          SDL_AUDIODRIVER: dummy
          PYTHONUNBUFFERED: "1"
          PYTHONIOENCODING: utf-8
          PYTHONDONTWRITEBYTECODE: "1"
        run: python ${HELPER_PATH}
`
}

// GitHub のサーバーで動く道具 (ライブラリを入れて実行し、結果と出力を保存する)
export const CLOUD_PY = String.raw`"""ForgeCode のクラウド実行 (GitHub Actions で動きます)。ForgeCode が作ったファイルです

1. プロジェクトの .py が import しているライブラリを pip で入れる (requirements.txt も)
2. 決めたファイルを実行する (input() には input.txt の中身。なければ空)
3. プログラムが書いたファイルをリポジトリに保存し、出力と結果を forgecode-cloud ブランチに残す
"""
import ast, datetime, json, os, pathlib, subprocess, sys, threading, time, urllib.error, urllib.request

ID = os.environ["FORGECODE_ID"]
PDIR = pathlib.Path(os.environ["FORGECODE_DIR"])
ENTRY = os.environ["FORGECODE_ENTRY"]
LIMIT = int(os.environ.get("FORGECODE_LIMIT", "600"))
SAVE = os.environ.get("FORGECODE_SAVE", "1") == "1"
REPO = os.environ.get("GITHUB_REPOSITORY", "")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
RUN_URL = "%s/%s/actions/runs/%s" % (os.environ.get("GITHUB_SERVER_URL", "https://github.com"), REPO, os.environ.get("GITHUB_RUN_ID", ""))
LOG_BRANCH = "forgecode-cloud"
PIP = {"PIL": "pillow", "cv2": "opencv-python-headless", "sklearn": "scikit-learn", "bs4": "beautifulsoup4", "yaml": "pyyaml",
       "dateutil": "python-dateutil", "dotenv": "python-dotenv", "skimage": "scikit-image", "Crypto": "pycryptodome",
       "serial": "pyserial", "jwt": "PyJWT", "docx": "python-docx", "pptx": "python-pptx", "fitz": "pymupdf",
       "telegram": "python-telegram-bot", "discord": "discord.py", "googleapiclient": "google-api-python-client"}
SKIP = {"js", "pyodide", "pyodide_js", "micropip", "_forgecode", "_fcshell", "msvcrt", "winsound"}
log = []
MAX_LOG = 300000


def out(s):
    sys.stdout.write(s)
    sys.stdout.flush()
    log.append(s)
    while sum(len(x) for x in log) > MAX_LOG and len(log) > 1:
        log.pop(0)


def deps():
    local = {p.stem for p in PDIR.glob("*.py")} | {p.name for p in PDIR.iterdir() if p.is_dir()}
    names = set()
    for f in PDIR.rglob("*.py"):
        try:
            tree = ast.parse(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                names |= {a.name.split(".")[0] for a in n.names}
            elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
                names.add(n.module.split(".")[0])
    return sorted(n for n in names - local - SKIP if n not in sys.stdlib_module_names)


def install():
    req = PDIR / "requirements.txt"
    if req.exists():
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(req)])
    for n in deps():
        try:
            __import__(n)
            continue
        except Exception:
            pass
        name = PIP.get(n, n)
        r = subprocess.run([sys.executable, "-m", "pip", "install", "-q", name], capture_output=True, text=True)
        out("[ForgeCode] %s を入れました\n" % name if r.returncode == 0 else "[ForgeCode] %s を入れられませんでした\n" % name)


def run_program():
    stdin_path = PDIR / "input.txt"
    stdin = open(stdin_path, "rb") if stdin_path.exists() else subprocess.DEVNULL
    p = subprocess.Popen([sys.executable, "-u", ENTRY], cwd=PDIR, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    def pump():
        for raw in iter(p.stdout.readline, b""):
            out(raw.decode("utf-8", "replace"))

    t = threading.Thread(target=pump, daemon=True)
    t.start()
    try:
        code = p.wait(timeout=LIMIT)
        state = "ok" if code == 0 else "error"
    except subprocess.TimeoutExpired:
        p.kill()
        code, state = -1, "timeout"
        out("\n[ForgeCode] 決めた時間 (%d 分) になったので止めました\n" % (LIMIT // 60))
    t.join(5)
    return code, state


def git(*args, check=False):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=check)


def save_files(stamp):
    if not SAVE:
        return False
    git("config", "user.name", "ForgeCode Cloud")
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    git("add", "-A", "--", str(PDIR))
    if git("diff", "--cached", "--quiet").returncode == 0:
        return False
    git("commit", "-q", "-m", "ForgeCode: クラウドで実行した結果 (%s)" % stamp)
    for _ in range(4):
        if git("push", "-q").returncode == 0:
            return True
        git("pull", "--rebase", "-q")
    out("[ForgeCode] 結果のファイルを保存できませんでした\n")
    return False


def api(method, path, body=None):
    req = urllib.request.Request(API + "/repos/" + REPO + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
        return json.loads(data) if data else None


def save_log(status):
    # 出力と結果を forgecode-cloud ブランチに置く (毎回 1 つのコミットに置き換えるので、履歴は増えない)
    try:
        try:
            ref = api("GET", "/git/ref/heads/" + LOG_BRANCH)
            base = api("GET", "/git/commits/" + ref["object"]["sha"])["tree"]["sha"]
        except urllib.error.HTTPError as e:
            if e.code not in (404, 409):
                raise
            ref, base = None, None
        history = []
        if base:
            for e in api("GET", "/git/trees/%s?recursive=1" % base).get("tree", []):
                if e["path"] == ID + "/status.json":
                    import base64
                    blob = api("GET", "/git/blobs/" + e["sha"])
                    try:
                        prev = json.loads(base64.b64decode(blob["content"]).decode("utf-8"))
                        history = prev.get("history", [])
                    except Exception:
                        pass
        history = ([{k: status[k] for k in ("time", "state", "seconds", "code", "event")}] + history)[:30]
        status["history"] = history
        tree = {"tree": [
            {"path": ID + "/log.txt", "mode": "100644", "type": "blob", "content": "".join(log)},
            {"path": ID + "/status.json", "mode": "100644", "type": "blob", "content": json.dumps(status, ensure_ascii=False, indent=1)},
        ]}
        if base:
            tree["base_tree"] = base
        t = api("POST", "/git/trees", tree)["sha"]
        c = api("POST", "/git/commits", {"message": "ForgeCode: 実行の記録", "tree": t, "parents": []})["sha"]
        if ref:
            api("PATCH", "/git/refs/heads/" + LOG_BRANCH, {"sha": c, "force": True})
        else:
            api("POST", "/git/refs", {"ref": "refs/heads/" + LOG_BRANCH, "sha": c})
    except Exception as e:
        print("[ForgeCode] 実行の記録を保存できませんでした:", e)


def main():
    t0 = time.time()
    started = datetime.datetime.now().astimezone()
    stamp = started.strftime("%Y-%m-%d %H:%M")
    if not (PDIR / ENTRY).exists():
        out("[ForgeCode] %s/%s がありません (アプリで「GitHub に保存」してください)\n" % (PDIR, ENTRY))
        code, state = 2, "error"
    else:
        install()
        out("[ForgeCode] %s を実行します (%s)\n" % (ENTRY, stamp))
        code, state = run_program()
    saved = save_files(stamp)
    secs = round(time.time() - t0, 1)
    out("[ForgeCode] %s (%s 秒)\n" % ({"ok": "完了", "error": "エラーで終了", "timeout": "時間切れ"}[state], secs))
    save_log({"time": started.isoformat(), "finished": datetime.datetime.now().astimezone().isoformat(), "seconds": secs,
              "code": code, "state": state, "event": os.environ.get("FORGECODE_EVENT", ""), "entry": ENTRY, "saved": saved, "url": RUN_URL})
    sys.exit(0 if state == "ok" else 1)


if __name__ == "__main__":
    main()
`

// ---- GitHub とのやりとり ----
// ワークフローと道具を置く (1 つのコミット)
export async function enableCloud(client, cfg) {
  let head = await client.head()
  if (!head) { await client.init(); head = await client.head() }
  const entries = [
    { path: workflowPath(cfg.id), mode: '100644', type: 'blob', content: workflowYaml(cfg) },
    { path: HELPER_PATH, mode: '100644', type: 'blob', content: CLOUD_PY },
  ]
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await client.commit(head, entries, `ForgeCode: ${cfg.name} をクラウドで動かす`) } catch (e) {
      if (/workflow/i.test(e.message || '')) throw Object.assign(new Error('ワークフローを置けませんでした。トークンに「Workflows: Read and write」の許可を足してください'), { status: e.status })
      if (e.status === 422 || e.status === 409) { head = await client.head(); continue }
      if (e.status === 403 || e.status === 404) throw Object.assign(new Error('ワークフローを置けませんでした。トークンに「Workflows: Read and write」の許可を足してください'), { status: e.status })
      throw e
    }
  }
  throw new Error('GitHub 側の変更と重なりました。もう一度試してください')
}
// ワークフローを消す (道具は、ほかのプロジェクトも使うので残す)
export async function disableCloud(client, cfg) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await client.head()
    if (!head) return null
    const { files } = await client.listDir(head.tree, '.github/workflows')
    if (!files.has(workflowFile(cfg.id))) return null
    try { return await client.commit(head, [{ path: workflowPath(cfg.id), mode: '100644', type: 'blob', sha: null }], `ForgeCode: ${cfg.name} のクラウド実行を止める`) } catch (e) {
      if (e.status === 422 || e.status === 409) continue
      throw e
    }
  }
  throw new Error('GitHub 側の変更と重なりました。もう一度試してください')
}
// 今すぐ実行
export async function dispatchCloud(client, cfg) {
  const ref = await client.defaultBranch()
  try { await client.req('POST', `/actions/workflows/${workflowFile(cfg.id)}/dispatches`, { ref }) } catch (e) {
    if (e.status === 404) throw Object.assign(new Error('ワークフローが見つかりません (保存した直後は、GitHub が読み込むまで少し待ってください)'), { status: 404 })
    if (e.status === 403) throw Object.assign(new Error('実行できませんでした。トークンに「Actions: Read and write」の許可を足してください'), { status: 403 })
    throw e
  }
}
// 最近の実行 (GitHub Actions の記録)
export async function cloudRuns(client, cfg, n = 10) {
  try {
    const r = await client.req('GET', `/actions/workflows/${workflowFile(cfg.id)}/runs?per_page=${n}`)
    return (r && r.workflow_runs || []).map(w => ({ id: w.id, status: w.status, conclusion: w.conclusion, event: w.event, at: w.run_started_at || w.created_at, updated: w.updated_at, url: w.html_url }))
  } catch (e) { if (e.status === 404) return []; throw e }
}
// 最後の出力と結果 (forgecode-cloud ブランチ)
export async function cloudResult(client, cfg) {
  const [log, st] = await Promise.all([client.readFileAt(LOG_BRANCH, `${cfg.id}/log.txt`), client.readFileAt(LOG_BRANCH, `${cfg.id}/status.json`)])
  let status = null
  try { status = st ? JSON.parse(st) : null } catch {}
  return { log, status }
}

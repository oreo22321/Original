var d="forgecode-cloud",b=[["manual","手動 (「今すぐ実行」のときだけ)"],["5m","5 分ごと"],["15m","15 分ごと"],["30m","30 分ごと"],["1h","1 時間ごと"],["3h","3 時間ごと"],["6h","6 時間ごと"],["daily","毎日 (決まった時刻)"]],y=[5,10,30,60,120,240,340],m={manual:0,"5m":288,"15m":96,"30m":48,"1h":24,"3h":8,"6h":4,daily:1},i=e=>`forgecode-cloud-${String(e).replace(/[^\w-]/g,"")}.yml`,p=e=>`.github/workflows/${i(e)}`,c=".forgecode/cloud.py";function h(e){let t=7;for(let s of String(e))t=(t*31+s.charCodeAt(0))%997;return 3+t%50}function f(e,{id:t="",time:s="08:00",tzOffset:r=0}={}){let o=h(t);switch(e){case"5m":return"*/5 * * * *";case"15m":return`${o%15}-59/15 * * * *`;case"30m":return`${o%30}-59/30 * * * *`;case"1h":return`${o} * * * *`;case"3h":return`${o} */3 * * *`;case"6h":return`${o} */6 * * *`;case"daily":{let[n,l]=String(s||"08:00").split(":").map(Number),u=(((n||0)*60+(l||0)+r)%1440+1440)%1440;return`${u%60} ${Math.floor(u/60)} * * *`}default:return null}}function _(e,t=1){return Math.round((m[e]||0)*30*Math.max(1,t))}var a=e=>JSON.stringify(String(e));function g(e){let t=f(e.schedule,e),s=Math.max(1,Math.min(340,Number(e.timeout)||10));return`# ForgeCode が作ったファイルです。アプリの「クラウドで動かす」から変えられます
# ${e.name} の ${e.entry} を GitHub のサーバーで動かします (アプリを閉じても、スマホの電源を切っても動きます)
name: ${a("ForgeCode: "+e.name)}
on:
  workflow_dispatch:
${t?`  schedule:
    - cron: ${a(t)}
`:""}permissions:
  contents: write
concurrency:
  group: ${a("forgecode-cloud-"+e.id)}
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: ${s+5}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.x"
      - name: ${a("Python で "+e.entry+" を実行")}
        env:
          FORGECODE_ID: ${a(e.id)}
          FORGECODE_DIR: ${a(e.dir)}
          FORGECODE_ENTRY: ${a(e.entry)}
          FORGECODE_LIMIT: "${s*60}"
          FORGECODE_SAVE: "${e.save===!1?0:1}"
          FORGECODE_EVENT: \${{ github.event_name }}
          GITHUB_TOKEN: \${{ github.token }}
          TZ: ${a(e.tz||"UTC")}
          MPLBACKEND: Agg
          SDL_VIDEODRIVER: dummy
          SDL_AUDIODRIVER: dummy
          PYTHONUNBUFFERED: "1"
          PYTHONIOENCODING: utf-8
          PYTHONDONTWRITEBYTECODE: "1"
        run: python ${c}
`}var E=String.raw`"""ForgeCode のクラウド実行 (GitHub Actions で動きます)。ForgeCode が作ったファイルです

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
`;async function R(e,t){let s=await e.head();s||(await e.init(),s=await e.head());let r=[{path:p(t.id),mode:"100644",type:"blob",content:g(t)},{path:c,mode:"100644",type:"blob",content:E}];for(let o=0;o<3;o++)try{return await e.commit(s,r,`ForgeCode: ${t.name} をクラウドで動かす`)}catch(n){if(/workflow/i.test(n.message||""))throw Object.assign(new Error("ワークフローを置けませんでした。トークンに「Workflows: Read and write」の許可を足してください"),{status:n.status});if(n.status===422||n.status===409){s=await e.head();continue}throw n.status===403||n.status===404?Object.assign(new Error("ワークフローを置けませんでした。トークンに「Workflows: Read and write」の許可を足してください"),{status:n.status}):n}throw new Error("GitHub 側の変更と重なりました。もう一度試してください")}async function w(e,t){for(let s=0;s<3;s++){let r=await e.head();if(!r)return null;let{files:o}=await e.listDir(r.tree,".github/workflows");if(!o.has(i(t.id)))return null;try{return await e.commit(r,[{path:p(t.id),mode:"100644",type:"blob",sha:null}],`ForgeCode: ${t.name} のクラウド実行を止める`)}catch(n){if(n.status===422||n.status===409)continue;throw n}}throw new Error("GitHub 側の変更と重なりました。もう一度試してください")}async function O(e,t){let s=await e.defaultBranch();try{await e.req("POST",`/actions/workflows/${i(t.id)}/dispatches`,{ref:s})}catch(r){throw r.status===404?Object.assign(new Error("ワークフローが見つかりません (保存した直後は、GitHub が読み込むまで少し待ってください)"),{status:404}):r.status===403?Object.assign(new Error("実行できませんでした。トークンに「Actions: Read and write」の許可を足してください"),{status:403}):r}}async function T(e,t,s=10){try{let r=await e.req("GET",`/actions/workflows/${i(t.id)}/runs?per_page=${s}`);return(r&&r.workflow_runs||[]).map(o=>({id:o.id,status:o.status,conclusion:o.conclusion,event:o.event,at:o.run_started_at||o.created_at,updated:o.updated_at,url:o.html_url}))}catch(r){if(r.status===404)return[];throw r}}async function I(e,t){let[s,r]=await Promise.all([e.readFileAt(d,`${t.id}/log.txt`),e.readFileAt(d,`${t.id}/status.json`)]),o=null;try{o=r?JSON.parse(r):null}catch{}return{log:s,status:o}}export{d as a,b,y as c,i as d,p as e,c as f,f as g,_ as h,g as i,E as j,R as k,w as l,O as m,T as n,I as o};

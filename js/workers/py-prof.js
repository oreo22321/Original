// プロファイラー (_fcprof): プログラムを実行して、時間のかかった関数と行を調べる
// ・関数: cProfile (呼ばれた回数・その中だけの時間・中で呼んだものも含めた時間)
// ・行: sys.monitoring の LINE (プロジェクトのファイルだけ。行ごとの回数と時間の目安)
// 結果は画面に表で送り (_event 'profile')、ターミナルでは文字の表でも出す
// (python-worker の Python に置くファイル。py-runtime.js の runtimeFiles で集めます)

export const FCPROF = String.raw`"""ForgeCode のプロファイラー"""
import sys, os, time, json, traceback

PROJECT = "/home/pyodide/project"


def _rel(path):
    try:
        ap = os.path.abspath(path)
    except Exception:
        return path
    if ap.startswith(PROJECT + "/"):
        return ap[len(PROJECT) + 1:]
    return None


def _event(data):
    try:
        import js
        js.__fc_event("profile", json.dumps(data, ensure_ascii=False, default=str))
    except Exception:
        pass


class LineTimer:
    """プロジェクトのファイルの行ごとに、通った回数と、次の行までの時間 (その行の時間の目安) を数える"""
    TOOL = 1   # sys.monitoring.COVERAGE_ID (デバッガーは 0、cProfile は 2 を使う)

    def __init__(self):
        self.hits = {}
        self.time = {}
        self.last = None
        self.t = 0.0
        self.on = False

    def start(self):
        mon = getattr(sys, "monitoring", None)
        if mon is None:
            return False
        try:
            mon.use_tool_id(self.TOOL, "forgecode-lines")
        except ValueError:
            return False
        mon.register_callback(self.TOOL, mon.events.LINE, self.line)
        mon.set_events(self.TOOL, mon.events.LINE)
        self.on = True
        self.t = time.perf_counter()
        return True

    def line(self, code, lineno):
        now = time.perf_counter()
        f = code.co_filename
        if not f.startswith(PROJECT):
            return sys.monitoring.DISABLE
        if self.last is not None:
            self.time[self.last] = self.time.get(self.last, 0.0) + (now - self.t)
        key = (f, lineno)
        self.hits[key] = self.hits.get(key, 0) + 1
        self.last = key
        self.t = time.perf_counter()

    def stop(self):
        if not self.on:
            return
        mon = sys.monitoring
        now = time.perf_counter()
        if self.last is not None:
            self.time[self.last] = self.time.get(self.last, 0.0) + (now - self.t)
        mon.set_events(self.TOOL, 0)
        mon.register_callback(self.TOOL, mon.events.LINE, None)
        mon.free_tool_id(self.TOOL)
        self.on = False


def _source_line(path, n):
    try:
        import linecache
        return linecache.getline(path, n).strip()
    except Exception:
        return ""


def report(prof, lines, total, text=True, top=40):
    import pstats
    st = pstats.Stats(prof)
    rows = []
    for (fname, lineno, func), (cc, nc, tt, ct, callers) in st.stats.items():
        rel = _rel(fname)
        if rel is None:
            if fname == "~":
                where = "(組み込み)"
            else:
                parts = fname.replace("\\", "/").split("/")
                where = "/".join(parts[-2:]) if "site-packages" in fname or "lib/python" in fname else fname
        else:
            where = rel
        if func in ("<module>",) and rel is None:
            continue
        if func.startswith("<built-in method builtins.exec>") or func == "<method 'disable' of '_lsprof.Profiler' objects>":
            continue
        rows.append({"file": rel, "where": where, "line": lineno, "name": func, "calls": nc, "prim": cc, "self": tt, "total": ct, "project": rel is not None})
    rows.sort(key=lambda r: (-r["self"], -r["total"]))
    funcs = rows[:top]
    # プロジェクトの関数は、上位に入らなくても入れる
    for r in rows[top:]:
        if r["project"] and len(funcs) < top + 20:
            funcs.append(r)
    lrows = []
    if lines is not None:
        for (f, n), hits in lines.hits.items():
            lrows.append({"file": _rel(f), "line": n, "hits": hits, "time": lines.time.get((f, n), 0.0), "code": _source_line(f, n)})
        lrows.sort(key=lambda r: -r["time"])
        lrows = lrows[:60]
    data = {"total": total, "functions": funcs, "lines": lrows}
    _event(data)
    if text:
        w = sys.stdout.write
        w("\n\x1b[1m===== 時間のかかった関数 (合計 %.3f 秒) =====\x1b[0m\n" % total)
        w("%8s %10s %10s  %s\n" % ("回数", "中だけ(秒)", "合計(秒)", "関数"))
        for r in funcs[:15]:
            loc = "%s:%d" % (r["where"], r["line"]) if r["line"] else r["where"]
            name = r["name"]
            w("%8s %10.4f %10.4f  %s%s\x1b[0m  \x1b[90m%s\x1b[0m\n" % (r["calls"] if r["calls"] == r["prim"] else "%d/%d" % (r["calls"], r["prim"]), r["self"], r["total"], "\x1b[36m" if r["project"] else "", name, loc))
        if lrows:
            w("\n\x1b[1m===== 時間のかかった行 =====\x1b[0m\n")
            for r in lrows[:10]:
                w("%8d回 %8.4f 秒  \x1b[90m%s:%d\x1b[0m  %s\n" % (r["hits"], r["time"], r["file"], r["line"], r["code"][:60]))
    return data


def run_file(path, argv=None, text=True, lines=True):
    import cProfile
    full = path if os.path.isabs(path) else os.path.join(PROJECT, path)
    with open(full, encoding="utf-8") as fp:
        src = fp.read()
    code = compile(src, full, "exec")
    g = {"__name__": "__main__", "__file__": full, "__builtins__": __builtins__}
    old_argv = sys.argv
    sys.argv = list(argv or [path])
    d = os.path.dirname(full)
    if d not in sys.path:
        sys.path.insert(0, d)
    lt = LineTimer() if lines else None
    prof = cProfile.Profile()
    err = None
    t0 = time.perf_counter()
    if lt is not None and not lt.start():
        lt = None
    prof.enable()
    try:
        exec(code, g)
    except SystemExit:
        pass
    except KeyboardInterrupt:
        err = "止めました"
    except BaseException as e:
        err = e
    finally:
        prof.disable()
        if lt is not None:
            lt.stop()
        sys.argv = old_argv
    total = time.perf_counter() - t0
    if err is not None and not isinstance(err, str):
        tb = [f for f in traceback.extract_tb(err.__traceback__) if f.filename.startswith(PROJECT)]
        sys.stderr.write("Traceback (most recent call last):\n" + "".join(traceback.format_list(tb)).replace(PROJECT + "/", "") + "%s: %s\n" % (type(err).__name__, err))
    elif err:
        sys.stderr.write(err + "\n")
    return report(prof, lt, total, text=text)
`

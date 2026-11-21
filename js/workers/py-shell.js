// subprocess / os.system の中身 (_fcshell) と msvcrt
// (python-worker の Python に置くファイル。py-runtime.js の runtimeFiles で集めます)

// subprocess / os.system の中身: よく使うコマンドを Python の中で再現する
export const FCSHELL = String.raw`"""ForgeCode の subprocess / os.system (よく使うコマンドを、この中で再現します)

使えるもの: cls / clear (画面を消す)・pause・echo・python (ほかの .py)・ls / dir・cat / type・pwd / cd・
mkdir・rm / del・sleep / timeout・date・whoami・exit・color / title / chcp (何もしない)
ほかのプログラム (git など) は、ブラウザの中では起動できません
"""
import io, os, sys, shlex, time, runpy, contextlib

CLEAR = "\x1b[2J\x1b[H"


class _Exit(Exception):
    def __init__(self, code):
        self.code = code


def _split(cmd, shell):
    if isinstance(cmd, (list, tuple)):
        args = [os.fspath(a) if not isinstance(a, str) else a for a in cmd]
        if shell and len(args) == 1:
            return _split(args[0], True)
        return [args]
    cmd = os.fspath(cmd) if not isinstance(cmd, str) else cmd
    # && ; で区切った複数のコマンド (かんたんに)
    out = []
    for part in cmd.replace("&&", ";").split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(shlex.split(part, posix=os.name != "nt"))
        except ValueError:
            out.append(part.split())
    return out


def _python(args, out, err, stdin):
    # python ファイル.py 引数 / -c コード / -m モジュール を、この Python の中で実行
    argv0 = sys.argv
    saved_in = sys.stdin
    try:
        if stdin is not None:
            sys.stdin = io.StringIO(stdin)
        if not args:
            raise _Exit(0)
        if args[0] == "-c":
            sys.argv = ["-c"] + args[2:]
            g = {"__name__": "__main__"}
            exec(compile(args[1] if len(args) > 1 else "", "<string>", "exec"), g)
        elif args[0] == "-m":
            sys.argv = [args[1]] + args[2:]
            runpy.run_module(args[1], run_name="__main__", alter_sys=True)
        elif args[0] in ("-V", "--version"):
            print("Python " + sys.version.split()[0])
        else:
            sys.argv = list(args)
            runpy.run_path(args[0], run_name="__main__")
        return 0
    except SystemExit as e:
        c = e.code
        if c is None:
            return 0
        if isinstance(c, int):
            return c
        print(c, file=sys.stderr)
        return 1
    except _Exit as e:
        return e.code
    except Exception:
        import traceback
        traceback.print_exc()
        return 1
    finally:
        sys.argv = argv0
        sys.stdin = saved_in


def _one(args, shell, stdin):
    name = os.path.basename(args[0]).lower()
    if name.endswith(".exe"):
        name = name[:-4]
    rest = args[1:]
    if name in ("cls", "clear"):
        sys.stdout.write(CLEAR)
        return 0
    if name == "pause":
        try:
            input("続行するには Enter キーを押してください . . . ")
        except EOFError:
            pass
        return 0
    if name == "echo":
        if rest == ["."] or rest == []:
            print()
        else:
            print(" ".join(rest))
        return 0
    if name in ("python", "python3", "py") or args[0] == sys.executable:
        return _python(rest, None, None, stdin)
    if name in ("pip", "pip3"):
        print("pip はターミナルで使ってください (例: pip install 名前)。import するだけでも自動で入ります", file=sys.stderr)
        return 1
    if name in ("ls", "dir"):
        path = next((a for a in rest if not a.startswith("-") and not a.startswith("/")), ".")
        try:
            names = sorted(n for n in os.listdir(path) if not n.startswith(".") and n != "__pycache__")
        except OSError as e:
            print(e, file=sys.stderr)
            return 1
        print("\n".join(names))
        return 0
    if name in ("cat", "type"):
        code = 0
        for f in rest:
            try:
                with open(f, encoding="utf-8") as fh:
                    sys.stdout.write(fh.read())
            except OSError as e:
                print(e, file=sys.stderr)
                code = 1
        return code
    if name == "pwd" or (name == "cd" and not rest):
        print(os.getcwd())
        return 0
    if name == "cd":
        try:
            os.chdir(rest[0])
            return 0
        except OSError as e:
            print(e, file=sys.stderr)
            return 1
    if name in ("mkdir", "md"):
        for d in rest:
            if not d.startswith("-"):
                os.makedirs(d, exist_ok=True)
        return 0
    if name in ("rm", "del", "erase"):
        code = 0
        for f in rest:
            if f.startswith("-") or f.startswith("/"):
                continue
            try:
                if os.path.isdir(f):
                    import shutil
                    shutil.rmtree(f)
                else:
                    os.remove(f)
            except OSError as e:
                print(e, file=sys.stderr)
                code = 1
        return code
    if name in ("sleep", "timeout"):
        nums = [a for a in rest if a.replace(".", "", 1).isdigit()]
        time.sleep(float(nums[0]) if nums else 1)
        return 0
    if name == "date":
        import datetime
        print(datetime.datetime.now().strftime("%Y年 %m月 %d日 %H:%M:%S"))
        return 0
    if name == "whoami":
        print("forge")
        return 0
    if name == "exit":
        raise _Exit(int(rest[0]) if rest and rest[0].lstrip("-").isdigit() else 0)
    if name in ("color", "title", "chcp", "mode", "true", "rem", ":"):
        return 0
    if name == "false":
        return 1
    if shell:
        print("'%s' はこの環境では使えません (ブラウザの中では、ほかのプログラムを起動できません)" % args[0], file=sys.stderr)
        return 127
    raise FileNotFoundError(2, "No such file or directory: '%s' (ブラウザの中では、ほかのプログラムを起動できません)" % args[0], args[0])


def run(cmd, shell=False, capture=False, input=None, cwd=None, text=True):
    """戻り値: (終了コード, 出力, エラー出力)"""
    out, err = io.StringIO(), io.StringIO()
    old = os.getcwd()
    code = 0
    try:
        if cwd is not None:
            os.chdir(cwd)
        ctx_out = contextlib.redirect_stdout(out) if capture else contextlib.nullcontext()
        ctx_err = contextlib.redirect_stderr(err) if capture else contextlib.nullcontext()
        with ctx_out, ctx_err:
            for args in _split(cmd, shell):
                if not args:
                    continue
                try:
                    code = _one(args, shell, input)
                except _Exit as e:
                    code = e.code
                    break
    finally:
        if cwd is not None:
            os.chdir(old)
    return code, out.getvalue(), err.getvalue()


def install(sp):
    """subprocess の run / call / check_output などを置き換える"""
    def _data(v, text):
        if v is None:
            return None
        return v if text else v.encode()

    def _run(args, *, stdin=None, input=None, stdout=None, stderr=None, capture_output=False, shell=False, cwd=None,
             timeout=None, check=False, text=None, universal_newlines=None, encoding=None, errors=None, env=None, **kw):
        txt = bool(text or universal_newlines or encoding or errors)
        cap_out = capture_output or stdout in (sp.PIPE, sp.DEVNULL)
        cap_err = capture_output or stderr in (sp.PIPE, sp.DEVNULL, sp.STDOUT)
        if isinstance(input, bytes):
            input = input.decode("utf-8", "replace")
        code, out, err = run(args, shell=shell, capture=cap_out or cap_err, input=input, cwd=cwd)
        if stderr == sp.STDOUT and cap_out:
            out, err = out + err, ""
        # 受け取らないものは、そのまま画面へ
        if not cap_out:
            if out:
                sys.stdout.write(out)
            out = None
        elif stdout == sp.DEVNULL:
            out = None
        if not cap_err:
            if err:
                sys.stderr.write(err)
            err = None
        elif stderr in (sp.DEVNULL, sp.STDOUT):
            err = None
        cp = sp.CompletedProcess(args, code, _data(out, txt), _data(err, txt))
        if check and code:
            raise sp.CalledProcessError(code, args, cp.stdout, cp.stderr)
        return cp

    def _call(args, **kw):
        kw.pop("check", None)
        return _run(args, **kw).returncode

    def _check_call(args, **kw):
        kw["check"] = True
        _run(args, **kw)
        return 0

    def _check_output(args, **kw):
        kw.setdefault("stdout", sp.PIPE)
        kw["check"] = True
        return _run(args, **kw).stdout

    def _getstatusoutput(cmd, **kw):
        code, out, err = run(cmd, shell=True, capture=True)
        data = (out + err)
        if data.endswith("\n"):
            data = data[:-1]
        return code, data

    def _getoutput(cmd, **kw):
        return _getstatusoutput(cmd)[1]

    class Popen:
        """かんたんな Popen (作った時点で最後まで実行します)"""
        def __init__(self, args, stdin=None, stdout=None, stderr=None, shell=False, cwd=None, text=None, universal_newlines=None, encoding=None, **kw):
            self.args = args
            self._txt = bool(text or universal_newlines or encoding)
            self._kw = dict(stdout=stdout, stderr=stderr, shell=shell, cwd=cwd)
            self._done = None
            self.stdin = None
            self.pid = 2
            if stdin != sp.PIPE:
                self._finish(None)

        def _finish(self, input):
            if self._done is None:
                self._done = _run(self.args, input=input, text=self._txt, **self._kw)
                self.returncode = self._done.returncode
                self.stdout = io.StringIO(self._done.stdout) if isinstance(self._done.stdout, str) else io.BytesIO(self._done.stdout) if self._done.stdout is not None else None
                self.stderr = io.StringIO(self._done.stderr) if isinstance(self._done.stderr, str) else io.BytesIO(self._done.stderr) if self._done.stderr is not None else None
            return self._done

        def communicate(self, input=None, timeout=None):
            d = self._finish(input)
            return d.stdout, d.stderr

        def wait(self, timeout=None):
            self._finish(None)
            return self.returncode

        def poll(self):
            return self.returncode if self._done is not None else None

        def kill(self):
            pass

        terminate = kill

        def __enter__(self):
            return self

        def __exit__(self, *a):
            self.wait()

    sp.run = _run
    sp.call = _call
    sp.check_call = _check_call
    sp.check_output = _check_output
    sp.getoutput = _getoutput
    sp.getstatusoutput = _getstatusoutput
    sp.Popen = Popen
`

// msvcrt (Windows のキー入力): getch() は 1 行の入力の最初の文字を返す
export const MSVCRT = String.raw`"""msvcrt (ForgeCode 互換版: キーを押す代わりに、入力欄に入れて Enter)"""
_buf = []


def _line():
    if not _buf:
        try:
            s = input()
        except EOFError:
            s = ""
        _buf.extend(list(s) or ["\r"])
    return _buf.pop(0)


def getwch():
    return _line()


def getwche():
    c = _line()
    print(c, end="")
    return c


def getch():
    return getwch().encode("utf-8")[:1] or b"\r"


def getche():
    return getwche().encode("utf-8")[:1] or b"\r"


def kbhit():
    return bool(_buf)


def putch(c):
    print(c.decode() if isinstance(c, bytes) else c, end="")


def putwch(c):
    print(c, end="")
`

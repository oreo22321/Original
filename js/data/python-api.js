// Python の補完・ホバー用データ
import { parseEntries } from './luau-api.js'

export const PY_KEYWORDS = ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'match', 'case', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']

export const PY_BUILTINS = parseEntries([
  'print(*values, sep=" ", end="\\n", file=None, flush=False) — 値を出力します',
  'input(prompt="") -> str — 1 行読み込みます (実行パネルの「標準入力」に入力した値が使われます)',
  'len(obj) -> int — 長さ・要素数',
  'range(start, stop=None, step=1) -> range — 連続した整数',
  'int(x=0, base=10) -> int — 整数に変換', 'float(x=0.0) -> float — 小数に変換', 'str(obj="") -> str — 文字列に変換', 'bool(x=False) -> bool — 真偽値に変換',
  'list(iterable=()) -> list — リスト', 'dict(**kwargs) -> dict — 辞書', 'set(iterable=()) -> set — 集合', 'tuple(iterable=()) -> tuple — タプル', 'frozenset(iterable=()) -> frozenset',
  'bytes(source=b"") -> bytes', 'bytearray(source=b"") -> bytearray', 'complex(real=0, imag=0) -> complex',
  'abs(x) — 絶対値', 'round(number, ndigits=None) — 丸め (偶数丸め)', 'min(*args, key=None, default=None) — 最小値', 'max(*args, key=None, default=None) — 最大値',
  'sum(iterable, start=0) — 合計', 'pow(base, exp, mod=None) — べき乗', 'divmod(a, b) -> tuple — 商と余り',
  'sorted(iterable, key=None, reverse=False) -> list — 並べ替えた新しいリスト', 'reversed(seq) — 逆順のイテレータ',
  'enumerate(iterable, start=0) — (番号, 要素) のイテレータ', 'zip(*iterables, strict=False) — 複数のイテラブルを束ねる',
  'map(func, *iterables) — 関数を適用したイテレータ', 'filter(func, iterable) — 条件に合う要素のイテレータ',
  'any(iterable) -> bool — いずれかが真か', 'all(iterable) -> bool — すべて真か',
  'isinstance(obj, classinfo) -> bool — 型を確認', 'issubclass(cls, classinfo) -> bool', 'type(obj) -> type — 型を返す',
  'id(obj) -> int', 'hash(obj) -> int', 'callable(obj) -> bool', 'dir(obj=None) -> list — 属性の一覧', 'vars(obj=None) -> dict',
  'getattr(obj, name, default=None) — 属性を取得', 'setattr(obj, name, value) — 属性を設定', 'hasattr(obj, name) -> bool', 'delattr(obj, name)',
  'open(file, mode="r", encoding=None) — ファイルを開きます (プロジェクト内のファイルを読み書きできます)',
  'chr(i) -> str — 文字コードから文字', 'ord(c) -> int — 文字から文字コード', 'bin(x) -> str', 'oct(x) -> str', 'hex(x) -> str',
  'format(value, format_spec="") -> str', 'repr(obj) -> str', 'ascii(obj) -> str', 'iter(obj) — イテレータ', 'next(iterator, default) — 次の要素',
  'slice(start, stop, step=None)', 'super() — 親クラス', 'object()', 'property(fget=None, fset=None)', 'staticmethod(func)', 'classmethod(func)',
  'globals() -> dict', 'locals() -> dict', 'eval(source, globals=None, locals=None)', 'exec(source, globals=None, locals=None)', 'help(obj)', 'breakpoint()',
  'Exception(*args) — 例外の基底クラス', 'ValueError(*args)', 'TypeError(*args)', 'KeyError(*args)', 'IndexError(*args)', 'ZeroDivisionError(*args)', 'RuntimeError(*args)', 'StopIteration(*args)', 'FileNotFoundError(*args)', 'NotImplementedError(*args)', 'AttributeError(*args)', 'NameError(*args)',
].map(s => s.replace(/^(\w+)\((.*?)\)( -> \S+)?/, (m, n, p, r) => `${n}(${p})${r ? ': ' + r.slice(4) : ''}`)), { cat: 'builtin' })

const mod = list => parseEntries(list.map(s => s.replace(/^(\w+)\((.*?)\)( -> \S+)?/, (m, n, p, r) => `${n}(${p})${r ? ': ' + r.slice(4) : ''}`)), { cat: 'module' })

export const PY_MODULES = {
  math: mod(['sqrt(x) — 平方根', 'floor(x) — 切り捨て', 'ceil(x) — 切り上げ', 'pow(x, y)', 'log(x, base=e)', 'log10(x)', 'log2(x)', 'exp(x)', 'sin(x)', 'cos(x)', 'tan(x)', 'asin(x)', 'acos(x)', 'atan(x)', 'atan2(y, x)', 'degrees(x)', 'radians(x)', 'hypot(*coords)', 'factorial(n)', 'gcd(*integers)', 'lcm(*integers)', 'comb(n, k)', 'perm(n, k=None)', 'isclose(a, b)', 'fabs(x)', 'trunc(x)', 'prod(iterable)', 'dist(p, q)', 'isqrt(n)', 'pi: float — 円周率', 'e: float — ネイピア数', 'tau: float', 'inf: float', 'nan: float']),
  random: mod(['random() -> float — 0〜1 の乱数', 'randint(a, b) -> int — a〜b の整数', 'choice(seq) — ランダムに 1 つ選ぶ', 'choices(population, k=1) -> list', 'sample(population, k) -> list — 重複なしで k 個', 'shuffle(x) — リストをシャッフル', 'uniform(a, b) -> float', 'randrange(start, stop=None, step=1) -> int', 'seed(a=None) — 乱数の種', 'gauss(mu, sigma) -> float']),
  os: mod(['listdir(path=".") -> list — フォルダ内の一覧', 'getcwd() -> str', 'mkdir(path)', 'makedirs(path, exist_ok=False)', 'remove(path)', 'rename(src, dst)', 'getenv(key, default=None)', 'path: module — パス操作 (os.path.join など)', 'sep: str', 'environ: dict']),
  sys: mod(['argv: list', 'path: list', 'version: str — Python のバージョン', 'platform: str', 'exit(code=0)', 'stdin: TextIO', 'stdout: TextIO', 'stderr: TextIO', 'getrecursionlimit() -> int', 'setrecursionlimit(n)', 'maxsize: int']),
  json: mod(['loads(s) — JSON 文字列を Python の値に', 'dumps(obj, indent=None, ensure_ascii=True) -> str — Python の値を JSON 文字列に (日本語は ensure_ascii=False)', 'load(fp)', 'dump(obj, fp, indent=None)']),
  re: mod(['match(pattern, string, flags=0) — 先頭で一致', 'search(pattern, string, flags=0) — 最初の一致', 'findall(pattern, string, flags=0) -> list — すべての一致', 'finditer(pattern, string, flags=0)', 'sub(pattern, repl, string, count=0) -> str — 置換', 'split(pattern, string, maxsplit=0) -> list', 'compile(pattern, flags=0)', 'fullmatch(pattern, string)', 'escape(pattern) -> str', 'IGNORECASE: int', 'MULTILINE: int', 'DOTALL: int']),
  time: mod(['time() -> float — UNIX 時間', 'sleep(secs) — 待機', 'perf_counter() -> float — 高精度タイマー', 'monotonic() -> float', 'strftime(format, t=None) -> str', 'localtime(secs=None)', 'gmtime(secs=None)']),
  datetime: mod(['datetime: type — 日時 (datetime.now() など)', 'date: type — 日付', 'time: type — 時刻', 'timedelta: type — 時間の差', 'timezone: type']),
  collections: mod(['Counter(iterable=None) — 要素を数える辞書', 'defaultdict(default_factory) — 既定値つき辞書', 'deque(iterable=(), maxlen=None) — 両端キュー', 'OrderedDict()', 'namedtuple(typename, field_names) — 名前付きタプル', 'ChainMap(*maps)']),
  itertools: mod(['count(start=0, step=1)', 'cycle(iterable)', 'repeat(obj, times=None)', 'chain(*iterables)', 'combinations(iterable, r)', 'permutations(iterable, r=None)', 'product(*iterables, repeat=1)', 'groupby(iterable, key=None)', 'accumulate(iterable, func=None)', 'islice(iterable, stop)', 'zip_longest(*iterables, fillvalue=None)', 'takewhile(pred, iterable)', 'dropwhile(pred, iterable)']),
  functools: mod(['reduce(function, iterable, initial=None)', 'lru_cache(maxsize=128) — 関数の結果をキャッシュ', 'cache(func)', 'partial(func, *args, **kwargs)', 'wraps(wrapped)', 'cmp_to_key(func)', 'total_ordering(cls)']),
  string: mod(['ascii_letters: str', 'ascii_lowercase: str', 'ascii_uppercase: str', 'digits: str', 'hexdigits: str', 'punctuation: str', 'whitespace: str', 'Template(template)']),
  typing: mod(['Any', 'List', 'Dict', 'Set', 'Tuple', 'Optional', 'Union', 'Callable', 'Iterable', 'Iterator', 'TypeVar(name)', 'Generic', 'Literal', 'Protocol', 'NamedTuple', 'TypedDict']),
  pathlib: mod(['Path(*parts) — パスオブジェクト (Path("a.txt").read_text() など)', 'PurePath(*parts)']),
  statistics: mod(['mean(data) — 平均', 'median(data) — 中央値', 'mode(data) — 最頻値', 'stdev(data) — 標本標準偏差', 'pstdev(data)', 'variance(data)']),
  dataclasses: mod(['dataclass(cls=None) — データクラスのデコレータ', 'field(default=None)', 'asdict(obj) -> dict', 'astuple(obj) -> tuple']),
  copy: mod(['copy(x) — 浅いコピー', 'deepcopy(x) — 深いコピー']),
  heapq: mod(['heappush(heap, item)', 'heappop(heap)', 'heapify(x)', 'nlargest(n, iterable)', 'nsmallest(n, iterable)']),
  bisect: mod(['bisect_left(a, x)', 'bisect_right(a, x)', 'insort(a, x)']),
  asyncio: mod(['run(main) — 非同期関数を実行', 'sleep(delay) — 非同期の待機', 'gather(*aws)', 'create_task(coro)', 'wait_for(aw, timeout)']),
  numpy: mod(['array(object) — 配列', 'zeros(shape)', 'ones(shape)', 'arange(start, stop, step)', 'linspace(start, stop, num=50)', 'mean(a)', 'sum(a)', 'sqrt(x)', 'dot(a, b)', 'random: module', 'reshape(a, shape)', 'max(a)', 'min(a)']),
}

export const PY_STR_METHODS = ['upper()', 'lower()', 'strip(chars=None)', 'lstrip()', 'rstrip()', 'split(sep=None, maxsplit=-1)', 'join(iterable)', 'replace(old, new, count=-1)', 'startswith(prefix)', 'endswith(suffix)', 'find(sub)', 'index(sub)', 'count(sub)', 'format(*args, **kwargs)', 'isdigit()', 'isalpha()', 'isalnum()', 'isspace()', 'title()', 'capitalize()', 'zfill(width)', 'center(width)', 'ljust(width)', 'rjust(width)', 'encode(encoding="utf-8")', 'splitlines()', 'partition(sep)', 'casefold()', 'swapcase()']
export const PY_LIST_METHODS = ['append(x)', 'extend(iterable)', 'insert(i, x)', 'remove(x)', 'pop(i=-1)', 'clear()', 'index(x)', 'count(x)', 'sort(key=None, reverse=False)', 'reverse()', 'copy()']
export const PY_DICT_METHODS = ['keys()', 'values()', 'items()', 'get(key, default=None)', 'pop(key, default)', 'popitem()', 'update(other)', 'setdefault(key, default=None)', 'clear()', 'copy()']

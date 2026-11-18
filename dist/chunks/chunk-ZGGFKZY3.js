var t=[{id:"print",t:"print (画面に表示する)",k:"表示 出力 print プリント 画面 改行 end sep 区切り 並べて",b:'`print(…)` で値を表示します。カンマで区切ると、空白をはさんで並べて表示します。\n- 改行させたくないときは `end=""`、区切りを変えるときは `sep=","`\n- 文字と数を混ぜるときは **f-string** (`f"…{値}…"`) が便利です',c:`print("こんにちは")
print("合計:", 10 + 5)
name = "Taro"
print(f"{name} さん、ようこそ")
print("A", "B", "C", sep="-")  # A-B-C
print("改行しない", end="")`},{id:"input",t:"input (キーボードから入力する)",k:"入力 input キーボード 受け取る 聞く 文字列 int 変換 数字を入力",b:'`input("案内")` で、ユーザーが入力した文字を受け取ります。ForgeCode では出力の下に入力欄が出ます。\n- **input の結果はいつも文字列 (str)** です。数として計算するなら `int(…)` や `float(…)` で変換します\n- 数字以外が入力されると `ValueError` になるので、`isdigit()` や `try` で確かめると安全です',c:`name = input("名前は? ")
age = int(input("年齢は? "))
print(f"{name} さんは来年 {age + 1} 歳です")

text = input("数を入れてください: ")
if text.isdigit():
    print(int(text) * 2)
else:
    print("数字を入れてください")`},{id:"variables",t:"変数と代入",k:"変数 代入 variable 名前 = 宣言 値を入れる 複数 同時 入れ替え",b:"`名前 = 値` で変数を作ります (宣言は要りません)。同じ名前に入れ直すと上書きされます。\n- 名前は英字・数字・`_`。数字から始めない。大文字と小文字は別の名前です\n- まとめて代入: `a, b = 1, 2`。入れ替え: `a, b = b, a`\n- 変数名は `total_price` のように小文字と `_` で書くのが Python の習慣 (PEP 8) です",c:`count = 0
count = count + 1
count += 1  # 同じ意味
x, y = 10, 20
x, y = y, x
print(x, y)  # 20 10`},{id:"types",t:"データの種類 (int・float・str・bool・None)",k:"型 種類 int float str bool None type 整数 小数 文字列 真偽値 データ型",b:'よく使う値の種類 (型) です。`type(値)` で調べられます。\n- `int` 整数 (`10`)・`float` 小数 (`3.14`)・`str` 文字列 (`"abc"`)・`bool` 真偽値 (`True` / `False`)・`None` 何もない\n- **True / False / None は先頭が大文字** です (true や null ではありません)\n- 条件式で「偽」になるのは `False`・`None`・`0`・`""`・空のリスト `[]` などです',c:`print(type(10))      # <class 'int'>
print(type(3.14))    # <class 'float'>
print(type("hi"))    # <class 'str'>
print(type(True))    # <class 'bool'>
result = None
if not result:
    print("まだ何もありません")`},{id:"convert",t:"型の変換 (int・float・str)",k:"変換 int() float() str() 文字列を数に 数を文字列に 型変換 キャスト",b:'`int("12")` → 12、`float("1.5")` → 1.5、`str(10)` → "10" のように変換します。\n- 文字列と数は `+` でつなげられないので、`str(…)` にするか f-string を使います\n- `int(3.9)` は 3 (切り捨て)。四捨五入は `round(3.9)`',c:`price = int("120")
total = price * 3
print("合計は " + str(total) + " 円")
print(f"合計は {total} 円")
print(int(3.9), round(3.9), round(2.567, 2))`},{id:"operators",t:"計算 (四則演算・余り・累乗)",k:"計算 足し算 引き算 掛け算 割り算 余り 累乗 + - * / // % ** 演算子 商",b:"`+` `-` `*` `/` のほか、`//` (切り捨ての割り算)、`%` (余り)、`**` (累乗) があります。\n- `/` の結果はいつも小数 (`7 / 2` → 3.5)。整数が欲しいときは `//`\n- 偶数かどうか: `n % 2 == 0`",c:`print(7 / 2)   # 3.5
print(7 // 2)  # 3
print(7 % 2)   # 1
print(2 ** 10) # 1024
n = 8
if n % 2 == 0:
    print(n, "は偶数")`},{id:"fstring",t:"f-string (文字の中に値を入れる)",k:"f-string f文字列 フォーマット format 埋め込み 桁 小数点 書式 {} 0埋め カンマ区切り",b:"文字列の前に `f` を付けると、`{ }` の中に変数や式を書けます。\n- 小数点以下 2 桁: `{x:.2f}`、3 桁ごとのカンマ: `{n:,}`、0 で埋めて 3 桁: `{n:03}`、右寄せ 10 文字: `{s:>10}`\n- `{x=}` と書くと「x=値」の形で表示します (デバッグに便利)",c:`name = "Hanako"
score = 92.456
print(f"{name} さんの点数は {score:.1f} 点")
print(f"{1234567:,} 円")
print(f"{7:03}")
x = 10
print(f"{x=}")`},{id:"string",t:"文字列の操作",k:"文字列 str 長さ len 大文字 小文字 upper lower 置き換え replace 分割 split 結合 join 空白 strip 含む in 探す find 何文字目",b:'文字列はたくさんの便利なメソッドを持っています。元の文字列は変わらず、新しい文字列が返ります。\n- 長さ `len(s)`、n 文字目 `s[0]` (0 から数える)、一部 `s[1:4]`\n- `s.upper()` / `s.lower()`・`s.replace("a", "b")`・`s.strip()` (前後の空白を消す)\n- `s.split(",")` で分けてリストに、`",".join(リスト)` でつなげる\n- `"py" in s` で含むかどうか、`s.startswith("…")` / `s.endswith("…")`',c:`s = "  Hello, Python  "
t = s.strip()
print(len(t), t.upper(), t.lower())
print(t.replace("Python", "World"))
words = "りんご,みかん,ぶどう".split(",")
print(words)
print(" / ".join(words))
print("Py" in t, t[0], t[-1], t[0:5])`},{id:"if",t:"if 文 (条件分岐)",k:"if 文 条件 分岐 elif else もし 比較 == != and or not 等しい 等しくない 以上 以下",b:"`if 条件:` の次の行から **字下げ (スペース 4 つ)** した部分が、条件が成り立つときに実行されます。\n- 比較: `==` (等しい)・`!=` (等しくない)・`<` `>` `<=` `>=`\n- 組み合わせ: `and`・`or`・`not` (`&&` `||` `!` は使えません)\n- 2 つ目からの条件は **`elif`** (else if ではありません)\n- 範囲は `0 <= x < 10` のようにまとめて書けます",c:`score = int(input("点数: "))
if score >= 80:
    print("よくできました")
elif score >= 60:
    print("合格")
else:
    print("もう少し")

age = 15
if 13 <= age < 20 and age != 18:
    print("ティーン")`},{id:"for",t:"for 文 (くり返し)",k:"for 文 くり返し 繰り返し ループ range 回 何回 リストの中身を順番に in",b:"`for 変数 in くり返すもの:` で、中身を 1 つずつ取り出してくり返します。\n- 決まった回数なら `range`: `range(5)` は 0〜4、`range(1, 11)` は 1〜10、`range(0, 10, 2)` は 2 つおき\n- リスト・文字列・辞書などもそのままくり返せます\n- 番号も欲しいときは `enumerate`、2 つのリストを同時に回すなら `zip`",c:`for i in range(1, 6):
    print(i, "回目")

fruits = ["りんご", "みかん", "ぶどう"]
for fruit in fruits:
    print(fruit)

for i, fruit in enumerate(fruits, start=1):
    print(i, fruit)

for name, score in zip(["A", "B"], [80, 95]):
    print(name, score)`},{id:"while",t:"while 文 (条件が成り立つ間くり返す)",k:"while 文 くり返し ループ 無限ループ break continue 条件 ずっと 終わるまで",b:"`while 条件:` は、条件が成り立つ間くり返します。回数が決まっていないときに使います。\n- `while True:` はずっとくり返します。`break` で抜けます\n- `continue` はその回の残りを飛ばして次へ\n- 終わらないループは ■ (停止) で止められます",c:`n = 1
while n <= 100:
    n *= 2
print(n)

while True:
    text = input("終わるときは q: ")
    if text == "q":
        break
    print("入力:", text)`},{id:"break-continue",t:"break と continue",k:"break continue 抜ける 飛ばす ループを止める 次へ スキップ",b:"- `break`: いちばん内側のループをすぐに抜けます\n- `continue`: その回の残りを飛ばして、次の回へ進みます\n- for / while の `else:` は、break せずに最後まで回ったときだけ実行されます",c:`for n in range(1, 20):
    if n % 3 == 0:
        continue  # 3 の倍数は飛ばす
    if n > 10:
        break
    print(n)`},{id:"list",t:"リスト (list)",k:"リスト list 配列 append 追加 削除 remove pop 要素 長さ len 何番目 index 中身 スライス 最後",b:"`[ ]` でいくつもの値をまとめて持てます。番号 (インデックス) は 0 から数えます。\n- 追加 `append(x)`・挿入 `insert(i, x)`・削除 `remove(x)` / `pop()` (最後を取り出す)\n- 長さ `len(a)`・最後の要素 `a[-1]`・一部 `a[1:3]`・含むか `x in a`\n- 並べ替え `a.sort()` (リストが変わる) / `sorted(a)` (新しいリスト)",c:`scores = [70, 85, 90]
scores.append(60)
scores.insert(0, 100)
print(scores, len(scores))
print(scores[0], scores[-1], scores[1:3])
scores.remove(85)
last = scores.pop()
print(max(scores), min(scores), sum(scores) / len(scores))`},{id:"slice",t:"スライス (一部を取り出す)",k:"スライス slice 一部 切り出し 先頭から 最後から 逆順 [::-1] [1:3]",b:"`a[開始:終わり:間隔]` で一部を取り出します (終わりの番号は含みません)。リストにも文字列にも使えます。\n- 先頭から 3 つ `a[:3]`、最後の 2 つ `a[-2:]`、逆順 `a[::-1]`、1 つおき `a[::2]`",c:`nums = [0, 1, 2, 3, 4, 5]
print(nums[:3], nums[-2:], nums[::-1], nums[::2])
print("Python"[::-1])`},{id:"dict",t:"辞書 (dict)",k:"辞書 dict キー 値 key value 連想配列 get items keys values 追加 削除 存在 in",b:'`{キー: 値}` で、名前で値を引けるデータです。\n- 読む `d["name"]` (ないと KeyError)・安全に読む `d.get("name", 既定値)`\n- 追加・変更 `d["age"] = 20`、削除 `del d["age"]`、あるか `"age" in d`\n- 全部回すなら `for key, value in d.items():`',c:`user = {"name": "Taro", "age": 14}
user["age"] = 15
user["city"] = "Tokyo"
print(user.get("email", "なし"))
for key, value in user.items():
    print(key, "=", value)
if "name" in user:
    print(user["name"])`},{id:"set",t:"集合 (set)",k:"集合 set 重複 ユニーク 重複を消す 共通 和 差 intersection union",b:"`{1, 2, 3}` や `set(リスト)` で、**重複のない** 値の集まりを作ります。順番はありません。\n- 重複を消す `list(set(a))`、共通 `a & b`、どちらか `a | b`、差 `a - b`\n- `x in s` の確認がリストより速いです",c:`tags = ["a", "b", "a", "c", "b"]
unique = set(tags)
print(unique, len(unique))
x = {1, 2, 3}
y = {2, 3, 4}
print(x & y, x | y, x - y)`},{id:"tuple",t:"タプル (tuple)",k:"タプル tuple 変更できない 組 ペア 座標 複数の値を返す",b:"`(1, 2)` のように、**変更できない** 並びです。座標や「組」をまとめるときに使います。\n- 関数から複数の値を返すと、タプルになります (`return a, b`)\n- 取り出し: `x, y = point`",c:`point = (3, 4)
x, y = point
print(x, y)

def min_max(nums):
    return min(nums), max(nums)

lo, hi = min_max([5, 2, 9])
print(lo, hi)`},{id:"comprehension",t:"内包表記 (リストを 1 行で作る)",k:"内包表記 comprehension リスト内包 1行 短く 変換 フィルター 条件",b:"`[式 for 変数 in くり返すもの if 条件]` で、新しいリストを 1 行で作れます。for で append するより短く、速いです。\n- 辞書なら `{k: v for …}`、集合なら `{x for …}`",c:`squares = [n * n for n in range(1, 6)]
evens = [n for n in range(20) if n % 2 == 0]
words = ["apple", "banana", "cherry"]
lengths = {w: len(w) for w in words}
print(squares, evens, lengths)`},{id:"function",t:"関数 (def)",k:"関数 def function 引数 戻り値 return 呼び出す まとめる 再利用 作り方",b:'`def 名前(引数):` で処理に名前を付けてまとめます。`return` で結果を返します (return がないと None)。\n- 呼び出す前に定義しておく必要があります\n- 最初の行に `"""説明"""` を書くと、補完やホバーで説明が出ます',c:`def area(width, height):
    """長方形の面積を求める"""
    return width * height


print(area(3, 4))


def greet(name, greeting="こんにちは"):
    print(f"{greeting}、{name} さん")


greet("Taro")
greet("Hanako", greeting="おはよう")`},{id:"args",t:"引数の書き方 (既定値・キーワード・*args・**kwargs)",k:"引数 既定値 デフォルト キーワード引数 可変長 *args **kwargs 名前付き",b:"- 既定値: `def f(x, n=1)` (n を省略すると 1)\n- キーワード引数: `f(x=3, n=2)` のように名前で渡せます\n- `*args` はいくつでも位置引数を受け取り (タプル)、`**kwargs` は名前付きの引数を受け取ります (辞書)\n- 既定値に `[]` や `{}` を使うと、呼び出しごとに同じリストが使い回されてバグの元になります。`None` にして中で作ります",c:`def total(*nums, tax=0.1):
    return sum(nums) * (1 + tax)


print(total(100, 200, tax=0.08))


def add_item(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items`},{id:"scope",t:"スコープ (global)",k:"スコープ global グローバル 関数の外 関数の中 ローカル変数 UnboundLocalError nonlocal",b:"関数の中で代入した変数は、その関数の中だけのもの (ローカル変数) です。\n- 関数の外の変数を **書き換える** には、関数の先頭で `global 名前` と書きます (読むだけなら不要)\n- ただ、引数で受け取って return で返す書き方の方が分かりやすく、バグも減ります",c:`score = 0


def add_score(points):
    global score
    score += points


add_score(10)
print(score)`},{id:"lambda",t:"lambda (名前のない小さな関数)",k:"lambda ラムダ 無名関数 key sorted map filter",b:"`lambda 引数: 式` で、1 行の小さな関数を作れます。`sorted` の `key` によく使います。",c:`people = [("Taro", 15), ("Hanako", 12), ("Jiro", 17)]
by_age = sorted(people, key=lambda p: p[1])
print(by_age)
doubled = list(map(lambda x: x * 2, [1, 2, 3]))
print(doubled)`},{id:"recursion",t:"再帰 (自分自身を呼ぶ関数)",k:"再帰 recursion 自分自身 階乗 フィボナッチ RecursionError 終了条件",b:"関数の中で同じ関数を呼ぶことを再帰と言います。**止まる条件 (終了条件)** を必ず書きます。書き忘れると RecursionError になります。",c:`def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)


print(factorial(5))  # 120`},{id:"class",t:"クラス (class) とオブジェクト",k:"クラス class オブジェクト インスタンス self __init__ コンストラクタ メソッド 属性 オブジェクト指向 設計図",b:"クラスは「データ (属性) と処理 (メソッド) をまとめた設計図」です。クラスから作った物をインスタンスと呼びます。\n- `__init__` は作るときに呼ばれ、`self.名前 = 値` で属性を作ります\n- メソッドの最初の引数は必ず `self` (そのインスタンス自身)\n- `__str__` を書くと print したときの表示を決められます",c:`class Dog:
    def __init__(self, name, age):
        self.name = name
        self.age = age

    def bark(self):
        return f"{self.name}: ワン!"

    def __str__(self):
        return f"Dog({self.name}, {self.age} 歳)"


pochi = Dog("ポチ", 3)
print(pochi.bark())
print(pochi)`},{id:"inheritance",t:"継承 (クラスを引き継ぐ)",k:"継承 inheritance 親クラス 子クラス super オーバーライド 上書き 拡張",b:"`class 子(親):` で、親クラスの属性とメソッドを引き継げます。同じ名前のメソッドを書くと上書き (オーバーライド) されます。`super().__init__(…)` で親の初期化を呼びます。",c:`class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return "…"


class Cat(Animal):
    def speak(self):
        return f"{self.name}: ニャー"


print(Cat("タマ").speak())`},{id:"dataclass",t:"dataclass (データ用のクラスを簡単に)",k:"dataclass データクラス @dataclass フィールド 自動 __init__",b:"`@dataclass` を付けると、`__init__`・表示・比較を自動で作ってくれます。データをまとめるだけのクラスに便利です。",c:`from dataclasses import dataclass, field


@dataclass
class Item:
    name: str
    price: int
    tags: list = field(default_factory=list)


apple = Item("りんご", 120)
print(apple, apple.price)`},{id:"module",t:"import とモジュール (ファイルを分ける)",k:"import モジュール module ライブラリ from as 別のファイル 複数のファイル パッケージ __init__ 読み込む",b:"`import 名前` で、ライブラリや自分の別のファイルを読み込みます。\n- `from math import sqrt` で一部だけ、`import numpy as np` で短い別名\n- 自分のファイル `helpers.py` は `import helpers` (同じプロジェクト内)。フォルダに分けるなら中に `__init__.py` を置きます\n- **自分のファイルに標準ライブラリと同じ名前 (random.py など) を付けない** ようにします",c:`import math
from random import randint, choice
import statistics as st

print(math.sqrt(16), randint(1, 6), choice(["A", "B"]))
print(st.mean([1, 2, 3]))`},{id:"main-guard",t:'if __name__ == "__main__":',k:"__name__ __main__ main 直接実行 import されたとき メイン",b:"そのファイルを **直接実行したときだけ** 動かしたい処理を書く場所です。別のファイルから import されたときは実行されません。",c:`def main():
    print("メインの処理")


if __name__ == "__main__":
    main()`},{id:"exceptions",t:"例外処理 (try / except)",k:"例外 try except finally エラー処理 エラーにならない 例外処理 else raise ValueError 失敗したら",b:"`try:` の中でエラーが起きると、`except` の部分に飛びます。プログラムを止めずにエラーに対応できます。\n- `except ValueError:` のように **起こりうるエラーの種類を書く** のがおすすめ (何でも受ける `except:` はバグを隠します)\n- `as e` でエラーの内容を受け取れます。`finally:` は必ず最後に実行されます",c:`while True:
    try:
        n = int(input("整数: "))
        print(10 / n)
        break
    except ValueError:
        print("整数を入れてください")
    except ZeroDivisionError:
        print("0 では割れません")`},{id:"raise",t:"raise (エラーを起こす) と自分の例外",k:"raise 例外を投げる 自作 例外クラス Exception 継承 エラーを出す",b:'`raise ValueError("理由")` で、自分でエラーを起こせます。おかしな値を早めに見つけるのに使います。自分の例外は `Exception` を継承して作ります。',c:`class NotEnoughMoney(Exception):
    pass


def pay(balance, price):
    if price > balance:
        raise NotEnoughMoney(f"{price - balance} 円足りません")
    return balance - price


try:
    pay(100, 300)
except NotEnoughMoney as e:
    print("エラー:", e)`},{id:"files",t:"ファイルの読み書き (open と with)",k:"ファイル 読み込み 書き込み open with read write 保存 txt テキストファイル 追記 encoding readlines",b:'`with open(ファイル名, モード, encoding="utf-8") as f:` で開くと、終わったら自動で閉じます。\n- モード: `"r"` 読む (省略時)・`"w"` 書く (上書き)・`"a"` 追記\n- ForgeCode では、プロジェクトのファイルを読めます。プログラムが書いたファイルはプロジェクトに追加されます\n- 日本語を扱うので `encoding="utf-8"` を付けると安心です',c:`with open("memo.txt", "w", encoding="utf-8") as f:
    f.write("1 行目\\n")
    f.write("2 行目\\n")

with open("memo.txt", encoding="utf-8") as f:
    for line in f:
        print(line.strip())`},{id:"csv",t:"CSV ファイル (表のデータ)",k:"csv 表 エクセル 読み込み 書き込み DictReader writer カンマ区切り 集計",b:"標準ライブラリの `csv` で読み書きします。1 行目が見出しなら `csv.DictReader` で辞書として読めると便利です。たくさんの集計には pandas も使えます。",c:`import csv

with open("scores.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["name", "score"])
    writer.writerows([["Taro", 80], ["Hanako", 95]])

with open("scores.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        print(row["name"], int(row["score"]))`},{id:"json",t:"JSON (データの保存と読み込み)",k:"json 保存 読み込み dump load dumps loads 辞書を保存 セーブ データ",b:"辞書やリストを、そのままファイルに保存して読み戻せます。`ensure_ascii=False` で日本語をそのまま保存できます。",c:`import json

data = {"name": "Taro", "items": ["剣", "盾"], "level": 3}
with open("save.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

with open("save.json", encoding="utf-8") as f:
    loaded = json.load(f)
print(loaded["items"])`},{id:"pathlib",t:"ファイルとフォルダ (pathlib・os)",k:"pathlib os フォルダ ディレクトリ 一覧 存在 exists listdir mkdir パス ファイル名",b:'`pathlib.Path` でファイルやフォルダを扱えます。`exists()` で存在確認、`glob("*.txt")` で一覧、`read_text()` / `write_text()` で手軽に読み書きできます。',c:`from pathlib import Path

p = Path("notes")
p.mkdir(exist_ok=True)
(p / "a.txt").write_text("hello", encoding="utf-8")
for f in Path(".").glob("*.py"):
    print(f.name)
print(Path("notes/a.txt").exists())`},{id:"random",t:"random (乱数・ランダム)",k:"random ランダム 乱数 randint choice shuffle sample サイコロ くじ 抽選 確率 uniform",b:"- `random.randint(1, 6)`: 1〜6 の整数 (6 も含む)\n- `random.random()`: 0 以上 1 未満の小数、`random.uniform(a, b)`: a〜b の小数\n- `random.choice(リスト)`: 1 つ選ぶ、`random.sample(リスト, 3)`: 重ならずに 3 つ、`random.shuffle(リスト)`: 並びを混ぜる",c:`import random

print(random.randint(1, 6))
print(random.choice(["大吉", "中吉", "小吉", "凶"]))
cards = list(range(1, 11))
random.shuffle(cards)
print(cards, random.sample(cards, 3))
if random.random() < 0.3:
    print("30% の確率で当たり")`},{id:"math",t:"math (数学の関数)",k:"math 数学 sqrt 平方根 ルート pi 円周率 sin cos tan 三角関数 log 対数 切り上げ ceil floor 階乗 factorial gcd",b:"`import math` で数学の関数が使えます。`math.sqrt`・`math.pi`・`math.ceil` (切り上げ)・`math.floor` (切り捨て)・`math.gcd` (最大公約数)・`math.factorial` など。",c:`import math

print(math.sqrt(2), math.pi)
print(math.ceil(2.1), math.floor(2.9))
print(math.gcd(12, 18), math.factorial(5))
r = 3
print(f"円の面積: {math.pi * r ** 2:.2f}")`},{id:"time",t:"time (待つ・時間を計る)",k:"time sleep 待つ 秒 時間 計る 経過時間 ストップウォッチ タイマー カウントダウン",b:"`time.sleep(秒)` で待ちます。`time.time()` は今の時刻 (秒) なので、差を取ると経過時間が分かります。",c:`import time

for n in range(3, 0, -1):
    print(n)
    time.sleep(1)
print("スタート!")

start = time.time()
total = sum(range(1_000_000))
print(f"{time.time() - start:.3f} 秒かかりました")`},{id:"datetime",t:"datetime (日付と時刻)",k:"datetime 日付 時刻 今日 現在 曜日 何日 日数 差 誕生日 年齢 timedelta strftime",b:'`datetime.date.today()` で今日、`datetime.datetime.now()` で今の時刻。引き算で日数の差 (`timedelta`) が分かります。表示の形は `strftime("%Y/%m/%d")` で決めます。',c:`from datetime import date, datetime, timedelta

today = date.today()
print(today, today.strftime("%Y年%m月%d日"))
print(["月", "火", "水", "木", "金", "土", "日"][today.weekday()] + "曜日")
new_year = date(today.year + 1, 1, 1)
print("お正月まで", (new_year - today).days, "日")
print(datetime.now() + timedelta(hours=3))`},{id:"sort",t:"並べ替え (sort・sorted)",k:"並べ替え ソート sort sorted 昇順 降順 reverse key 大きい順 小さい順 ランキング 順位",b:"`sorted(リスト)` は並べ替えた新しいリストを返し、`リスト.sort()` はそのリスト自体を並べ替えます (戻り値は None)。\n- 大きい順: `reverse=True`\n- 何で並べるか: `key=` (例: `key=len`、`key=lambda x: x[1]`)",c:`scores = {"Taro": 80, "Hanako": 95, "Jiro": 70}
ranking = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
for rank, (name, score) in enumerate(ranking, start=1):
    print(rank, name, score)
words = ["banana", "fig", "apple"]
print(sorted(words), sorted(words, key=len))`},{id:"aggregate",t:"合計・平均・最大・最小",k:"合計 平均 最大 最小 sum max min len 集計 平均値 statistics mean",b:"`sum(a)`・`max(a)`・`min(a)`・`len(a)` で集計できます。平均は `sum(a) / len(a)` か `statistics.mean(a)`。空のリストに max や平均を使うとエラーになるので注意します。",c:`import statistics

scores = [72, 88, 95, 60]
print("合計", sum(scores))
print("平均", sum(scores) / len(scores))
print("最大", max(scores), "最小", min(scores))
print("中央値", statistics.median(scores))`},{id:"collections",t:"collections (Counter・defaultdict・deque)",k:"collections counter 数える 出現回数 頻度 defaultdict deque キュー most_common",b:"- `Counter`: 数を数える (`most_common(3)` で多い順)\n- `defaultdict(int)`: ないキーにアクセスすると 0 から始まる辞書\n- `deque`: 先頭への追加・削除が速いリスト (キュー)",c:`from collections import Counter, defaultdict

words = "apple banana apple cherry banana apple".split()
count = Counter(words)
print(count.most_common(2))

groups = defaultdict(list)
for w in words:
    groups[w[0]].append(w)
print(dict(groups))`},{id:"enumerate-zip",t:"enumerate と zip",k:"enumerate zip 番号付き インデックス 同時に 2つのリスト ペア",b:"- `enumerate(リスト, start=1)`: 番号と値を一緒に取り出す (`range(len(…))` より読みやすい)\n- `zip(a, b)`: 2 つ以上のリストを同時に回す (短い方で終わる)",c:`names = ["Taro", "Hanako"]
scores = [80, 95]
for i, name in enumerate(names, start=1):
    print(i, name)
for name, score in zip(names, scores):
    print(f"{name}: {score}")`},{id:"generator",t:"ジェネレーター (yield)",k:"ジェネレーター generator yield イテレーター 遅延 メモリ next",b:"`yield` を使う関数は、値を 1 つずつ作って渡すジェネレーターになります。大きなデータを少しずつ扱えるのでメモリを節約できます。",c:`def countdown(n):
    while n > 0:
        yield n
        n -= 1


for x in countdown(3):
    print(x)
total = sum(n * n for n in range(1000))`},{id:"decorator",t:"デコレーター (@)",k:"デコレーター decorator @ 関数を包む wrapper functools",b:"`@名前` を関数の上に書くと、その関数に処理を付け足せます。時間を計る・ログを出すなどに使います。",c:`import functools
import time


def timer(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        print(f"{func.__name__}: {time.time() - start:.3f} 秒")
        return result
    return wrapper


@timer
def slow():
    time.sleep(0.2)


slow()`},{id:"typehint",t:"型ヒント",k:"型ヒント 型注釈 type hint typing アノテーション -> list[int] Optional",b:"`def f(name: str, n: int = 1) -> bool:` のように、引数や戻り値の型を書けます。実行には影響しませんが、補完が賢くなり、読みやすくなります。\n- リスト `list[int]`、辞書 `dict[str, int]`、None もありうる `int | None`",c:`def average(nums: list[float]) -> float:
    return sum(nums) / len(nums)


def find(names: list[str], key: str) -> int | None:
    for i, n in enumerate(names):
        if n == key:
            return i
    return None`},{id:"regex",t:"正規表現 (re)",k:"正規表現 re regex パターン 検索 置換 findall search sub match メールアドレス 電話番号",b:'`re` モジュールで、文字のパターンを探したり置き換えたりできます。パターンは `r"…"` (raw 文字列) で書くと \\ をそのまま書けます。',c:`import re

text = "電話: 090-1234-5678、03-1111-2222"
print(re.findall(r"\\d+-\\d+-\\d+", text))
print(re.sub(r"\\d", "*", "pass1234"))
m = re.search(r"(\\w+)@(\\w+\\.\\w+)", "mail: taro@example.com")
if m:
    print(m.group(1), m.group(2))`},{id:"none-is",t:"None と is",k:"None is is not == 比較 何もない null nil 空",b:"`None` は「何もない」ことを表す値です。None かどうかは `x is None` / `x is not None` で比べるのが決まりです (`== None` ではなく)。",c:`result = None
if result is None:
    print("まだ結果がありません")`},{id:"mutable",t:"変更できる型・できない型 (コピーの注意)",k:"ミュータブル イミュータブル コピー copy 参照 同じリスト 変わってしまう deepcopy",b:"リスト・辞書・集合は「変更できる」型です。`b = a` は同じリストに 2 つの名前を付けるだけなので、b を変えると a も変わります。別のリストにするには `a.copy()` や `list(a)`、入れ子なら `copy.deepcopy(a)`。",c:`a = [1, 2, 3]
b = a
b.append(4)
print(a)  # [1, 2, 3, 4] (a も変わる)
c = a.copy()
c.append(5)
print(a, c)`},{id:"pep8",t:"読みやすい書き方 (PEP 8)",k:"pep8 pep 8 書き方 スタイル 命名 規則 インデント スペース 読みやすく きれいに 整形",b:"Python の公式の書き方の決まりです。ForgeCode の「整形」(⇧⌥F) で自動でそろえられます。\n- 字下げはスペース 4 つ、1 行は長くしすぎない\n- 変数・関数は `snake_case`、クラスは `CamelCase`、定数は `UPPER_CASE`\n- `=` や `+` の前後に空白、カンマの後ろに空白\n- 関数やクラスの間は 2 行空ける",c:`MAX_COUNT = 10


class ScoreBoard:
    def add_score(self, player_name, points):
        total = points * 2
        return total`},{id:"indent",t:"字下げ (インデント) のルール",k:"字下げ インデント indent スペース タブ ブロック IndentationError 揃える コロン",b:"Python は **字下げでブロック (if や for の中身) を表します**。`:` で終わる行の次は、スペース 4 つ下げます。ブロックを終えるときは字下げを戻します。\n- タブとスペースを混ぜるとエラーになります (ForgeCode はスペース 4 つを入れます)",c:`for i in range(3):
    if i == 1:
        print("真ん中")
    print(i)
print("終わり")`},{id:"unittest",t:"テストを書く (unittest・assert)",k:"テスト unittest assert assertEqual テストコード 確かめる 検証 pytest",b:"`assert 条件` は、条件が成り立たないと AssertionError で止まります。まとまったテストは `unittest` で書けます。ForgeCode では `unittest.main()` を書いたファイルを ▶ で実行するとテストが走ります。",c:`import unittest


def add(a, b):
    return a + b


class AddTest(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)

    def test_negative(self):
        self.assertEqual(add(-1, 1), 0)


if __name__ == "__main__":
    unittest.main()`},{id:"matplotlib",t:"グラフを描く (matplotlib)",k:"グラフ matplotlib plot 折れ線 棒グラフ bar 円グラフ pie 散布図 scatter ヒストグラム hist 図 表示 タイトル 軸",b:"`import matplotlib.pyplot as plt` でグラフを描き、`plt.show()` で ForgeCode の出力に図が表示されます (タップで拡大・保存)。はじめて使うときは読み込みに少し時間がかかります。\n- 折れ線 `plt.plot(x, y)`・棒 `plt.bar`・円 `plt.pie`・散布図 `plt.scatter`・ヒストグラム `plt.hist`\n- 日本語の文字は表示できないことがあるので、タイトルや軸の名前は英語にすると確実です",c:`import matplotlib.pyplot as plt

x = [1, 2, 3, 4, 5]
y = [2, 4, 3, 6, 8]
plt.plot(x, y, marker="o", label="sales")
plt.bar(x, [1, 3, 2, 4, 3], alpha=0.4, label="count")
plt.title("Monthly data")
plt.xlabel("month")
plt.ylabel("value")
plt.legend()
plt.show()`},{id:"numpy",t:"numpy (数値の計算をまとめて)",k:"numpy np 配列 array 行列 ベクトル 平均 標準偏差 まとめて計算 linspace arange",b:"`import numpy as np` で、たくさんの数をまとめて速く計算できます。`np.array`・`np.arange`・`np.linspace`・`.mean()`・`.std()` など。配列どうしの計算は要素ごとに行われます。",c:`import numpy as np

a = np.array([1, 2, 3, 4])
print(a * 2, a.mean(), a.std())
m = np.arange(6).reshape(2, 3)
print(m, m.T, m.sum(axis=0))
x = np.linspace(0, 1, 5)
print(x)`},{id:"pandas",t:"pandas (表のデータを分析)",k:"pandas pd データフレーム dataframe 表 分析 集計 グループ groupby read_csv 平均 並べ替え",b:"`import pandas as pd` で表のデータ (DataFrame) を扱えます。`pd.read_csv` で CSV を読み、`groupby` で集計、`sort_values` で並べ替え。結果は print で表示できます。",c:`import pandas as pd

df = pd.DataFrame({
    "name": ["Taro", "Hanako", "Jiro", "Yuki"],
    "class": ["A", "B", "A", "B"],
    "score": [80, 95, 70, 88],
})
print(df.describe())
print(df.groupby("class")["score"].mean())
print(df.sort_values("score", ascending=False).head(3))`},{id:"packages",t:"使えるライブラリ",k:"ライブラリ パッケージ pip install 使える numpy pandas matplotlib scipy requests インストール モジュールがない",b:"ForgeCode の Python はブラウザの中で動く **Pyodide (Python 3.14)** です。\n- 標準ライブラリ (math・random・datetime・json・csv・re・collections など) はすぐ使えます\n- **numpy・pandas・matplotlib・scipy・scikit-learn・sympy・pillow** なども `import` するだけで使えます (初回だけインターネットから読み込みます)\n- `pip install` はできません。また、tkinter (ウィンドウ)・turtle など画面を開くもの、インターネットへの自由な通信は使えません",c:`import sympy

x = sympy.symbols("x")
print(sympy.solve(x ** 2 - 4, x))`},{id:"err-syntax",t:"SyntaxError (書き方の間違い)",k:"SyntaxError invalid syntax 構文エラー 書き方 間違い コロン 括弧 閉じ",b:"書き方 (文法) が正しくないときのエラーです。よくある原因:\n- if / for / def / class の行の最後の `:` を忘れた\n- 括弧 `( [ {` や引用符 `\" '` を閉じ忘れた (エラーの行より **前の行** が原因のことも)\n- 全角の記号 (（ ） ： ＝ など) が混ざった\n- 比較に `=` を使った (`==` が正しい)",c:`# 間違い: if x = 1
x = 1
if x == 1:
    print("OK")`},{id:"err-indent",t:"IndentationError (字下げの間違い)",k:"IndentationError unexpected indent expected an indented block 字下げ インデント タブ スペース",b:"字下げがおかしいときのエラーです。\n- `expected an indented block`: `:` の次の行を字下げしていない\n- `unexpected indent`: 必要ないのに字下げしている\n- タブとスペースが混ざっている → 整形 (⇧⌥F) で直せます",c:`def hello():
    print("字下げはスペース 4 つ")`},{id:"err-name",t:"NameError (名前が見つからない)",k:"NameError is not defined 定義されていない 名前 スペル import 忘れ",b:'まだ作っていない名前を使ったときのエラーです。スペルミス、使う前に代入していない、`import` 忘れ、文字列の `" "` 忘れがよくある原因です。`true` → `True` のような大文字・小文字の違いも別の名前になります。',c:`import math

radius = 2
print(math.pi * radius ** 2)`},{id:"err-type",t:"TypeError (型が合わない)",k:"TypeError can only concatenate unsupported operand not callable not subscriptable 型 合わない",b:"値の種類 (型) に合わない使い方をしたときのエラーです。\n- 文字列と数を `+` でつなげた → `str(…)` か f-string を使う\n- `input()` の文字列で計算した → `int(…)` で変換\n- 関数の引数の数が違う、関数ではないものを () で呼んだ",c:`age = int(input("年齢: "))
print("来年は " + str(age + 1) + " 歳")`},{id:"err-value",t:"ValueError (値がおかしい)",k:"ValueError invalid literal for int 変換できない 値 数字以外",b:'型は合っているのに値がおかしいときのエラーです。よくあるのは `int("abc")` のように数字ではない文字を整数にしようとしたとき。`isdigit()` で確かめるか、`try / except ValueError` で受けます。',c:`text = input("数: ")
try:
    n = int(text)
except ValueError:
    print("数字を入れてください")`},{id:"err-index",t:"IndexError・KeyError (範囲外・キーがない)",k:"IndexError list index out of range KeyError 範囲 番号 キー 辞書 ない",b:"- `IndexError`: リストの番号が範囲外 (番号は 0 から 長さ-1)。`len(…)` を確認します\n- `KeyError`: 辞書にそのキーがない。`d.get(キー)` や `キー in d` で確かめます",c:`items = ["a", "b"]
if len(items) > 2:
    print(items[2])
d = {"x": 1}
print(d.get("y", 0))`},{id:"err-attribute",t:"AttributeError (そのメソッド・属性はない)",k:"AttributeError has no attribute NoneType メソッド 属性 ない",b:"その値にない属性やメソッドを使ったときのエラーです。スペルを確認し、`'NoneType' object has no attribute` なら値が None になっていないか (関数が return しているか、`list.sort()` の戻り値を使っていないか) を確認します。",c:`nums = [3, 1, 2]
nums.sort()       # nums が並び替わる (戻り値は None)
print(nums)
print(sorted([3, 1, 2]))`},{id:"err-zero",t:"ZeroDivisionError (0 で割った)",k:"ZeroDivisionError division by zero 0で割る ゼロ除算 割り算",b:"0 で割り算をしたときのエラーです。割る前に 0 でないか確認します。リストの平均を出すときは、空のリストに注意します。",c:`nums = []
average = sum(nums) / len(nums) if nums else 0
print(average)`},{id:"err-module",t:"ModuleNotFoundError (モジュールが見つからない)",k:"ModuleNotFoundError No module named ImportError import できない ライブラリがない",b:"import しようとしたモジュールが見つからないときのエラーです。名前のスペル、自分のファイルならプロジェクトにあるか、フォルダなら `__init__.py` があるかを確認します。ForgeCode で使えるライブラリは「使えるライブラリ」を見てください。",c:"import json  # 標準ライブラリはいつでも使えます"},{id:"err-recursion",t:"RecursionError と無限ループ",k:"RecursionError maximum recursion depth 無限ループ 終わらない 止まらない フリーズ",b:"- `RecursionError`: 関数が自分を呼び続けて止まらない → 終了条件を書きます\n- 無限ループ: 実行が終わらないときは ■ (停止) で止められます。while の条件がいつか偽になるか、break があるか確認します。設定の「最大実行時間」で自動で止めることもできます",c:`count = 0
while count < 5:
    count += 1  # これを忘れると無限ループ
print(count)`},{id:"app-run",mode:"app",t:"ForgeCode: 実行する",k:"実行 run ▶ 動かす 試す 出力 停止 止める 実行ファイル コンソール 入力欄 再起動",b:`右上の **▶ (実行)** か ⌘/Ctrl + Enter で、開いているファイル (なければ main.py) を実行します。
- 結果は下の「出力」に表示。\`input()\` は出力の下に入力欄が出ます
- **■** で停止。止まらないときも数秒で止まります
- 実行のあと、出力の下の \`>>>\` に式を書くと、そのプログラムの変数を使って試せます (コンソール)
- エラーはタップで該当の行へ。「AI で直す」で修正案を作れます
- ファイル一覧の … メニューで「▶ で常にこのファイルを実行」にできます`},{id:"app-debug",mode:"app",t:"ForgeCode: デバッガー (ブレークポイント・ステップ実行)",k:"デバッグ debug ブレークポイント breakpoint ステップ 一時停止 変数 中身 確認 行番号 ウォッチ",b:"行番号の左をタップすると **赤い点 (ブレークポイント)** が付き、▶ で実行するとその行で止まります。\n- 止まっている間は「デバッグ」タブで変数の中身 (リストや辞書は開いて中身も)・呼び出し履歴を確認できます\n- 続行 (F5)・ステップ (F10)・中へ (F11)・外へ (⇧F11) で 1 行ずつ進めます\n- 赤い点を長押しすると、条件付き (例: `i == 10`) やログ (止めずに `{i}` の値を表示) にできます\n- コードに `breakpoint()` と書いても止まります。実行中に「一時停止」も使えます\n- 止まっている間のコンソールでは、その場所の変数を使えます (値を変えることもできます)"},{id:"app-projects",mode:"app",t:"ForgeCode: プロジェクトとファイル",k:"プロジェクト ファイル 保存 zip バックアップ 読み込み 新規 フォルダ 削除 名前変更 エクスポート インポート 消えた github",b:`ファイルは端末の中に自動保存されます (入力が止まるとすぐ)。
- 左上のプロジェクト名から、プロジェクトの切り替え・新規作成 (サンプルから作れます)
- ファイル一覧の … から ZIP で保存・ZIP を読み込み・端末のファイルを読み込み
- **GitHub と同期** を設定すると、リポジトリに自動でバックアップします
- 各ファイルの「履歴」から、前の内容に戻せます`},{id:"app-editor",mode:"app",t:"ForgeCode: エディタの便利な機能",k:"補完 候補 整形 フォーマット 定義へ移動 名前の変更 検索 置換 ショートカット キーボードバー 全角 自動修正",b:`- 補完: 入力すると候補が出ます (Python の解析 jedi による本物の補完)。( を打つと引数のヒント
- 整形: ⇧⌥F (または … メニュー) で PEP 8 に合わせて整えます
- 定義へ移動 F12・参照を検索 ⇧F12・名前の変更 F2 (ほかのファイルも一緒に変わります)
- エラーは赤・黄色の波線。タップ (または ⌘.) で直し方を選べます
- 全角の記号 (（ ） ： など) は自動で半角に、pirnt( のような打ち間違いも自動で直します
- スマホでは、キーボードの上のバーで記号や Tab を入力できます`},{id:"app-ai",mode:"app",t:"ForgeCode: Forge AI でできること",k:"ai forge ai できること 何ができる 頼み方 使い方 説明 直す 作る 生成 オフライン",b:`Forge AI はアプリに内蔵された AI です。端末の中だけで動き、変更はいつでも元に戻せます。
- **作る**: 「数当てゲームを作って」「CSV を読んでグラフにして」
- **直す**: 「このエラーを直して」(実行エラーの「AI で直す」からも)
- **説明**: 「このコードを説明して」(選択した範囲だけも)
- **チェック**: 「レビューして」で、よくある問題と直し方
- **整える**: 「整形して」「コメントを付けて」「型ヒントを付けて」
- **質問**: 「リストと辞書の違いは?」「for 文の使い方」
- 入力が止まると、薄い文字で続きを提案します (Tab で確定)。\`# 1 から 10 まで足す\` のようなコメントの次の行で Alt + \\ を押すと、コードを組み立てます`}],r=new Map(t.map(e=>[e.id,e]));export{t as a,r as b};

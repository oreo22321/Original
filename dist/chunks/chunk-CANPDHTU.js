import{a as h,e as b,i as u}from"./chunk-4MYTFDFL.js";var d=(t,e,{min:n=-1/0,max:a=1/0,unit:i}={})=>{let r=i?t.numbers.filter(m=>i.test(m.unit||"")):t.numbers,s=r.length?r[0].v:e;return Math.max(n,Math.min(a,Number.isFinite(s)?s:e))},c=t=>t.numbers.map(e=>e.v),f=t=>JSON.stringify(String(t)),w=(t,e)=>String(t||"").normalize("NFKC").replace(/[^A-Za-z0-9_]/g,"_").replace(/^(\d)/,"_$1").replace(/_+/g,"_").replace(/^_|_$/g,"")||e,$=t=>w(t,"MyClass").split("_").filter(Boolean).map(e=>e[0].toUpperCase()+e.slice(1)).join(""),g=[{id:"guess",title:"数当てゲーム",name:"guess_game.py",example:"数当てゲーム",match:(t,e)=>(e.has("guess")?6:0)+(e.has("game")&&e.has("random")&&/数/.test(t)?3:0),build:t=>{let e=d(t,100,{min:2,max:1e6,unit:/^$/}),n=t.times||0;return{summary:[`1〜${e} の数をコンピューターが決めて、当てるまでくり返します`,"大きいか小さいかヒントを出します",n?`${n} 回までに当てないと負けです`:"何回で当たったかを表示します","数字以外を入れても止まりません"],code:`# 数当てゲーム: 1〜${e} の数を当てます
import random

answer = random.randint(1, ${e})
${n?`max_tries = ${n}
`:""}tries = 0

print("1〜${e} の数を当ててください!")
while ${n?"tries < max_tries":"True"}:
    text = input("あなたの予想: ")
    if not text.isdigit():
        print("数字を入れてください")
        continue
    guess = int(text)
    tries += 1
    if guess < answer:
        print("もっと大きいです")
    elif guess > answer:
        print("もっと小さいです")
    else:
        print(f"正解! {tries} 回で当たりました")
        break
${n?`else:
    print(f"残念! 正解は {answer} でした")
`:""}`}}},{id:"janken",title:"じゃんけんゲーム",name:"janken.py",example:"じゃんけん",match:(t,e)=>e.has("janken")?7:0,build:t=>{let e=t.times||3;return{summary:[`コンピューターと ${e} 回勝負します`,"グー・チョキ・パーは番号 (1〜3) で選びます","最後に勝ち・負け・あいこの数を表示します"],code:`# じゃんけんゲーム (${e} 回勝負)
import random

HANDS = ["グー", "チョキ", "パー"]
wins = losses = draws = 0

for game in range(1, ${e} + 1):
    print(f"--- {game} 回目 ---")
    text = input("1: グー  2: チョキ  3: パー > ")
    if text not in ("1", "2", "3"):
        print("1〜3 で選んでください (この回はあいこにします)")
        draws += 1
        continue
    me = int(text) - 1
    cpu = random.randint(0, 2)
    print(f"あなた: {HANDS[me]}  コンピューター: {HANDS[cpu]}")
    result = (me - cpu) % 3
    if result == 0:
        print("あいこ")
        draws += 1
    elif result == 2:
        print("あなたの勝ち!")
        wins += 1
    else:
        print("あなたの負け…")
        losses += 1

print(f"結果: {wins} 勝 {losses} 敗 {draws} 分け")
`}}},{id:"omikuji",title:"おみくじ",name:"omikuji.py",example:"おみくじ",match:t=>/おみくじ|占い|運勢/.test(t)?7:0,build:()=>({summary:["大吉〜凶をランダムに選んで表示します","出やすさ (重み) を変えられます"],code:`# おみくじ
import random

results = ["大吉", "中吉", "小吉", "吉", "凶"]
weights = [10, 20, 30, 30, 10]  # 出やすさ

name = input("名前を入れてください: ")
fortune = random.choices(results, weights=weights)[0]
print(f"{name} さんの今日の運勢は… {fortune}!")
`})},{id:"dice",title:"サイコロ",name:"dice.py",example:"サイコロ",match:(t,e)=>/サイコロ|さいころ|ダイス|dice/.test(t)?7:0,build:t=>{let e=t.times||d(t,10,{min:1,max:1e5});return{summary:[`サイコロを ${e} 回ふって、出た目と回数を数えます`,"目ごとの回数を棒グラフ風に表示します"],code:`# サイコロを ${e} 回ふる
import random
from collections import Counter

rolls = [random.randint(1, 6) for _ in range(${e})]
count = Counter(rolls)
print("出た目:", rolls[:20], "…" if len(rolls) > 20 else "")
for face in range(1, 7):
    n = count[face]
    print(f"{face}: {'■' * round(n / ${e} * 30)} {n} 回")
print("平均:", round(sum(rolls) / len(rolls), 2))
`}}},{id:"quiz",title:"クイズ",name:"quiz.py",example:"クイズ",match:(t,e)=>e.has("quiz")?6:0,build:()=>({summary:["問題と答えをリストにまとめて、順番に出題します","問題の順番は毎回シャッフルします","最後に点数を表示します"],code:`# クイズ
import random

questions = [
    ("日本でいちばん高い山は?", "富士山"),
    ("1 週間は何日?", "7"),
    ("Python で画面に表示する関数は?", "print"),
    ("水が凍る温度は何度?", "0"),
]
random.shuffle(questions)

score = 0
for i, (question, answer) in enumerate(questions, start=1):
    reply = input(f"Q{i}. {question} ").strip()
    if reply == answer:
        print("正解!")
        score += 1
    else:
        print(f"不正解… 正解は「{answer}」")

print(f"{len(questions)} 問中 {score} 問正解でした")
`})},{id:"tictactoe",title:"三目並べ (まるばつ)",name:"tictactoe.py",example:"三目並べ",match:(t,e)=>e.has("tictactoe")?8:0,build:()=>({summary:["2 人で交互にマスの番号 (1〜9) を入れて遊びます","縦・横・ななめに 3 つ並んだら勝ち","盤面はリストで、勝ちの判定は 8 通りの並びを調べます"],code:`# 三目並べ (2 人で遊ぶ)
board = [" "] * 9
LINES = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6)]


def show():
    for row in range(3):
        cells = board[row * 3:row * 3 + 3]
        print(" " + " | ".join(c if c != " " else str(row * 3 + i + 1) for i, c in enumerate(cells)))
        if row < 2:
            print("---+---+---")


def winner():
    for a, b, c in LINES:
        if board[a] != " " and board[a] == board[b] == board[c]:
            return board[a]
    return None


player = "○"
for turn in range(9):
    show()
    while True:
        text = input(f"{player} の番です。マスの番号 (1〜9): ")
        if text.isdigit() and 1 <= int(text) <= 9 and board[int(text) - 1] == " ":
            break
        print("空いているマスの番号を入れてください")
    board[int(text) - 1] = player
    if winner():
        show()
        print(f"{player} の勝ち!")
        break
    player = "×" if player == "○" else "○"
else:
    show()
    print("引き分け")
`})},{id:"hangman",title:"単語当てゲーム (ハングマン)",name:"hangman.py",example:"単語当てゲーム",match:(t,e)=>e.has("hangman")?8:0,build:t=>{let e=t.times||6;return{summary:["かくれた英単語を 1 文字ずつ当てます",`${e} 回まちがえたら負けです`],code:`# 単語当てゲーム
import random

words = ["python", "apple", "banana", "computer", "keyboard"]
word = random.choice(words)
found = set()
lives = ${e}

while lives > 0:
    shown = " ".join(ch if ch in found else "_" for ch in word)
    print(shown, f"(残り {lives} 回)")
    if all(ch in found for ch in word):
        print("クリア!")
        break
    guess = input("アルファベットを 1 文字: ").lower().strip()
    if len(guess) != 1 or not guess.isalpha():
        print("1 文字だけ入れてください")
    elif guess in found:
        print("その文字はもう当てています")
    elif guess in word:
        found.add(guess)
    else:
        lives -= 1
        print("その文字はありません")
else:
    print(f"ゲームオーバー! 答えは {word} でした")
`}}},{id:"calculator",title:"電卓",name:"calculator.py",example:"電卓",match:(t,e)=>e.has("calculator")?7:0,build:()=>({summary:["「12 + 5」のように入れると計算します (+ - * / // % **)","0 で割ったときや、書き方が違うときはメッセージを出します","q で終わります"],code:`# 電卓: 「数 演算子 数」を入れると計算します (q で終わり)
import operator

OPS = {"+": operator.add, "-": operator.sub, "*": operator.mul, "/": operator.truediv,
       "//": operator.floordiv, "%": operator.mod, "**": operator.pow}

while True:
    text = input("式 (例: 12 + 5) > ").strip()
    if text == "q":
        break
    parts = text.split()
    if len(parts) != 3 or parts[1] not in OPS:
        print("「数 演算子 数」の形で、間に空白を入れてください")
        continue
    try:
        a, b = float(parts[0]), float(parts[2])
        result = OPS[parts[1]](a, b)
    except ValueError:
        print("数を入れてください")
        continue
    except ZeroDivisionError:
        print("0 では割れません")
        continue
    print("=", int(result) if result == int(result) else round(result, 10))
`})},{id:"todo",title:"ToDo リスト",name:"todo.py",example:"ToDo リスト",match:(t,e)=>e.has("todo")?7:0,build:()=>({summary:["追加・一覧・完了・削除ができる ToDo リストです","内容は todo.json に保存するので、次に実行しても残ります","番号を選んで操作します"],code:`# ToDo リスト (todo.json に保存)
import json
from pathlib import Path

FILE = Path("todo.json")


def load():
    if FILE.exists():
        return json.loads(FILE.read_text(encoding="utf-8"))
    return []


def save(todos):
    FILE.write_text(json.dumps(todos, ensure_ascii=False, indent=2), encoding="utf-8")


def show(todos):
    if not todos:
        print("(やることはありません)")
    for i, t in enumerate(todos, start=1):
        mark = "✓" if t["done"] else " "
        print(f"{i}. [{mark}] {t['title']}")


todos = load()
while True:
    print()
    show(todos)
    cmd = input("a: 追加  d: 完了  r: 削除  q: 終わり > ").strip()
    if cmd == "a":
        title = input("やること: ").strip()
        if title:
            todos.append({"title": title, "done": False})
    elif cmd in ("d", "r"):
        text = input("番号: ")
        if text.isdigit() and 1 <= int(text) <= len(todos):
            i = int(text) - 1
            if cmd == "d":
                todos[i]["done"] = True
            else:
                todos.pop(i)
        else:
            print("番号が正しくありません")
    elif cmd == "q":
        break
    save(todos)
print("保存しました")
`})},{id:"kakeibo",title:"家計簿",name:"kakeibo.py",example:"家計簿",match:(t,e)=>e.has("kakeibo")?7:0,build:()=>({summary:["収入と支出を入力して kakeibo.csv に記録します","項目ごとの合計と残高を表示します"],code:`# 家計簿 (kakeibo.csv に記録)
import csv
from collections import defaultdict
from datetime import date
from pathlib import Path

FILE = Path("kakeibo.csv")
if not FILE.exists():
    FILE.write_text("date,item,amount\\n", encoding="utf-8")

while True:
    item = input("項目 (例: 食費。空で終わり): ").strip()
    if not item:
        break
    text = input("金額 (収入はプラス、支出はマイナス): ").strip()
    try:
        amount = int(text)
    except ValueError:
        print("整数で入れてください")
        continue
    with FILE.open("a", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow([date.today().isoformat(), item, amount])

totals = defaultdict(int)
with FILE.open(encoding="utf-8") as f:
    for row in csv.DictReader(f):
        totals[row["item"]] += int(row["amount"])

for item, total in sorted(totals.items(), key=lambda kv: kv[1]):
    print(f"{item}: {total:,} 円")
print(f"残高: {sum(totals.values()):,} 円")
`})},{id:"grades",title:"成績の集計",name:"grades.py",example:"成績の集計",match:(t,e)=>(e.has("grades")?6:0)+(e.has("sum")&&/点/.test(t)?2:0),build:()=>({summary:["名前と点数を辞書で持ち、平均・最高・最低を出します","点数の高い順に順位を付けて表示します","平均より上かどうかも表示します"],code:`# 成績の集計
scores = {"Taro": 78, "Hanako": 92, "Jiro": 65, "Yuki": 88, "Ken": 71}

average = sum(scores.values()) / len(scores)
print(f"平均: {average:.1f} 点")
print("最高:", max(scores, key=scores.get), max(scores.values()), "点")
print("最低:", min(scores, key=scores.get), min(scores.values()), "点")

ranking = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
for rank, (name, score) in enumerate(ranking, start=1):
    mark = "↑" if score >= average else "↓"
    print(f"{rank} 位 {name:<8} {score:>3} 点 {mark}")
`})},{id:"wordbook",title:"単語帳 (暗記クイズ)",name:"wordbook.py",example:"英単語の単語帳",match:(t,e)=>e.has("wordbook")?7:0,build:()=>({summary:["英単語と意味を辞書に入れて、ランダムに出題します","まちがえた単語は最後にもう一度出します"],code:`# 単語帳: 意味を見て英単語を答える
import random

words = {"apple": "りんご", "dog": "犬", "book": "本", "water": "水", "school": "学校"}
quiz = list(words.items())
random.shuffle(quiz)
missed = []

for english, japanese in quiz:
    reply = input(f"「{japanese}」は英語で? ").strip().lower()
    if reply == english:
        print("正解!")
    else:
        print(f"正解は {english}")
        missed.append((english, japanese))

if missed:
    print("--- まちがえた単語 ---")
    for english, japanese in missed:
        print(english, "=", japanese)
else:
    print("全問正解!")
`})},{id:"fizzbuzz",title:"FizzBuzz",name:"fizzbuzz.py",example:"FizzBuzz",match:(t,e)=>e.has("fizzbuzz")?9:0,build:t=>{let e=d(t,30,{min:1,max:1e5});return{summary:[`1〜${e} の数を順に表示します`,"3 の倍数は Fizz、5 の倍数は Buzz、両方は FizzBuzz"],code:`# FizzBuzz (1〜${e})
for i in range(1, ${e} + 1):
    if i % 15 == 0:
        print("FizzBuzz")
    elif i % 3 == 0:
        print("Fizz")
    elif i % 5 == 0:
        print("Buzz")
    else:
        print(i)
`}}},{id:"prime",title:"素数",name:"prime.py",example:"素数の一覧",match:(t,e)=>e.has("prime")?8:0,build:t=>{let e=d(t,100,{min:2,max:1e7});return{summary:["is_prime 関数で素数かどうかを判定します (平方根までの数で割り切れるか調べる)",`${e} までの素数を一覧にします`,"入力した数が素数かどうかも調べます"],code:`# 素数
def is_prime(n):
    """n が素数なら True"""
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True


primes = [n for n in range(2, ${e} + 1) if is_prime(n)]
print(f"${e} までの素数 ({len(primes)} 個):", primes[:50], "…" if len(primes) > 50 else "")

text = input("調べたい数: ")
if text.isdigit():
    n = int(text)
    print(n, "は素数です" if is_prime(n) else "は素数ではありません")
`}}},{id:"fibonacci",title:"フィボナッチ数列",name:"fibonacci.py",example:"フィボナッチ数列",match:(t,e)=>e.has("fibonacci")?8:0,build:t=>{let e=d(t,20,{min:1,max:1e4});return{summary:[`フィボナッチ数列を最初から ${e} 個作ります (前の 2 つを足すと次の数)`,"ループで作るので大きな数でも速いです"],code:`# フィボナッチ数列 (${e} 個)
def fibonacci(count):
    numbers = []
    a, b = 0, 1
    for _ in range(count):
        numbers.append(a)
        a, b = b, a + b
    return numbers


print(fibonacci(${e}))
`}}},{id:"factorial",title:"階乗",name:"factorial.py",example:"階乗の計算",match:(t,e)=>e.has("factorial")?8:0,build:t=>{let e=d(t,10,{min:0,max:5e3});return{summary:["ループで階乗を計算する関数と、math.factorial の両方を使います",`1〜${e} の階乗を表示します`],code:`# 階乗 (n! = 1 × 2 × … × n)
import math


def factorial(n):
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result


for n in range(1, ${e} + 1):
    print(f"{n}! = {factorial(n)}")
print(math.factorial(${e}) == factorial(${e}))
`}}},{id:"kuku",title:"九九の表",name:"kuku.py",example:"九九の表",match:(t,e)=>e.has("multiplication")?8:0,build:t=>{let e=d(t,9,{min:1,max:30});return{summary:[`${e}×${e} までのかけ算の表を、2 重の for ループで作ります`,"桁をそろえて表示します"],code:`# 九九の表 (${e}×${e})
for a in range(1, ${e} + 1):
    row = ""
    for b in range(1, ${e} + 1):
        row += f"{a * b:4}"
    print(row)
`}}},{id:"sumrange",title:"連続した数の合計",name:"sum_numbers.py",example:"1 から 100 まで足す",match:(t,e)=>((e.has("sum")||/足/.test(t))&&/から|まで|～|~/.test(t)&&y(t).numbers.length?6:0)-(e.has("func")?2:0),build:t=>{let e=c(t),n=e.length>=2?Math.min(e[0],e[1]):1,a=e.length>=2?Math.max(e[0],e[1]):e[0]||100;return{summary:[`${n} から ${a} までの整数を足します`,"for ループで足す方法と、sum(range(...)) の方法の両方を書いています"],code:`# ${n} から ${a} までの合計
total = 0
for i in range(${n}, ${a} + 1):
    total += i
print("合計:", total)

# sum と range を使うと 1 行で書けます
print("合計:", sum(range(${n}, ${a} + 1)))
`}}},{id:"average",title:"平均・最大・最小",name:"average.py",example:"入力した数の平均",match:(t,e)=>(e.has("sum")&&!/から.*まで/.test(t)?4:0)+(/平均/.test(t)?2:0)-(e.has("func")?4:0),build:()=>({summary:["数をいくつか入力してもらい、合計・平均・最大・最小を出します","空のまま Enter で入力を終えます"],code:`# 入力した数の合計・平均・最大・最小
numbers = []
while True:
    text = input("数 (空で終わり): ").strip()
    if not text:
        break
    try:
        numbers.append(float(text))
    except ValueError:
        print("数を入れてください")

if numbers:
    print("合計:", sum(numbers))
    print("平均:", round(sum(numbers) / len(numbers), 2))
    print("最大:", max(numbers), "最小:", min(numbers))
else:
    print("数が入力されませんでした")
`})},{id:"sortdemo",title:"並べ替え",name:"sort_demo.py",example:"点数を大きい順に並べ替え",match:(t,e)=>e.has("sort")?5:0,build:()=>({summary:["リストを小さい順・大きい順に並べ替えます (sorted と sort)","辞書を値で並べ替えて順位を表示します","key= で「何で並べるか」を決められます"],code:`# 並べ替え
numbers = [5, 2, 9, 1, 7]
print("小さい順:", sorted(numbers))
print("大きい順:", sorted(numbers, reverse=True))

words = ["banana", "kiwi", "apple", "cherry"]
print("文字数の順:", sorted(words, key=len))

scores = {"Taro": 80, "Hanako": 95, "Jiro": 72}
for rank, (name, score) in enumerate(sorted(scores.items(), key=lambda kv: kv[1], reverse=True), start=1):
    print(rank, name, score)
`})},{id:"leap",title:"うるう年の判定",name:"leap_year.py",example:"うるう年の判定",match:(t,e)=>e.has("leap")?8:0,build:()=>({summary:["4 で割り切れて 100 で割り切れない、または 400 で割り切れる年がうるう年","calendar.isleap でも確かめます"],code:`# うるう年の判定
import calendar


def is_leap(year):
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


year = int(input("西暦: "))
print(year, "年はうるう年です" if is_leap(year) else "年はうるう年ではありません")
print("calendar.isleap:", calendar.isleap(year))
`})},{id:"bmi",title:"BMI の計算",name:"bmi.py",example:"BMI 計算",match:(t,e)=>e.has("bmi")?7:0,build:()=>({summary:["身長 (cm) と体重 (kg) から BMI = 体重 ÷ (身長 m)² を計算します","判定 (やせ・普通・肥満) も表示します"],code:`# BMI の計算
height = float(input("身長 (cm): ")) / 100
weight = float(input("体重 (kg): "))
bmi = weight / height ** 2

if bmi < 18.5:
    label = "やせ"
elif bmi < 25:
    label = "普通"
else:
    label = "肥満"
print(f"BMI: {bmi:.1f} ({label})")
`})},{id:"temperature",title:"温度の変換 (摂氏・華氏)",name:"temperature.py",example:"摂氏と華氏の変換",match:(t,e)=>e.has("temperature")?7:0,build:()=>({summary:["摂氏 → 華氏: F = C × 9 / 5 + 32","華氏 → 摂氏: C = (F - 32) × 5 / 9","対応表も表示します"],code:`# 温度の変換
def c_to_f(c):
    return c * 9 / 5 + 32


def f_to_c(f):
    return (f - 32) * 5 / 9


c = float(input("摂氏 (℃): "))
print(f"{c}℃ は {c_to_f(c):.1f}°F")
for c in range(-10, 41, 10):
    print(f"{c:>4}℃ = {c_to_f(c):6.1f}°F")
`})},{id:"tax",title:"税込み・割引・割り勘の計算",name:"price.py",example:"税込み価格の計算",match:(t,e)=>e.has("tax")?6:0,build:(t,e)=>{let n=t.percent!=null?t.percent:10;return/割り勘|わりかん/.test(e)?{title:"割り勘の計算",summary:["合計金額と人数から、1 人あたりの金額を出します","1 円未満は切り上げ、余りも表示します"],code:`# 割り勘の計算
import math

total = int(input("合計金額 (円): "))
people = int(input("人数: "))
each = math.ceil(total / people)
print(f"1 人 {each:,} 円 (集めると {each * people - total} 円あまります)")
`}:/おつり|お釣り/.test(e)?{title:"おつりの計算",summary:["払った金額と値段から、おつりと、お札・硬貨の枚数を出します"],code:`# おつりの計算
price = int(input("値段 (円): "))
paid = int(input("払った金額 (円): "))
change = paid - price
if change < 0:
    print(f"{-change} 円足りません")
else:
    print(f"おつり: {change:,} 円")
    for coin in [10000, 5000, 1000, 500, 100, 50, 10, 5, 1]:
        count, change = divmod(change, coin)
        if count:
            print(f"{coin} 円 × {count}")
`}:{summary:[`税抜きの値段から、税込み (${n}%) を計算します`,"割引 (%) も入れられます","1 円未満は切り捨てます"],code:`# 税込み価格の計算
import math

TAX_RATE = ${n/100}

price = int(input("税抜きの値段 (円): "))
discount = int(input("割引 (%。なければ 0): ") or 0)
discounted = price * (100 - discount) / 100
total = math.floor(discounted * (1 + TAX_RATE))
print(f"割引後: {discounted:,.0f} 円 → 税込み: {total:,} 円")
`}}},{id:"password",title:"パスワードを作る",name:"password.py",example:"パスワード生成",match:(t,e)=>e.has("password")?7:0,build:t=>{let e=d(t,12,{min:4,max:128});return{summary:[`${e} 文字のランダムなパスワードを作ります`,"英大文字・小文字・数字・記号をそれぞれ 1 つ以上入れます","安全な乱数 (secrets) を使います"],code:`# パスワードを作る (${e} 文字)
import secrets
import string

CHARS = string.ascii_letters + string.digits + "!#$%&*+-?@"


def make_password(length=${e}):
    while True:
        pw = "".join(secrets.choice(CHARS) for _ in range(length))
        if (any(c.islower() for c in pw) and any(c.isupper() for c in pw)
                and any(c.isdigit() for c in pw) and any(not c.isalnum() for c in pw)):
            return pw


for _ in range(3):
    print(make_password())
`}}},{id:"palindrome",title:"回文の判定",name:"palindrome.py",example:"回文の判定",match:(t,e)=>e.has("palindrome")?8:0,build:()=>({summary:["逆から読んでも同じかどうかを調べます (s == s[::-1])","空白と大文字・小文字の違いは無視します"],code:`# 回文の判定
def is_palindrome(text):
    s = "".join(text.split()).lower()
    return s == s[::-1]


for word in ["たけやぶやけた", "level", "Python", "Never odd or even"]:
    print(word, "→", "回文です" if is_palindrome(word) else "回文ではありません")
`})},{id:"gcd",title:"最大公約数・最小公倍数",name:"gcd.py",example:"最大公約数",match:(t,e)=>e.has("gcd")?8:0,build:t=>{let e=c(t),n=e[0]||12,a=e[1]||18;return{summary:["ユークリッドの互除法で最大公約数を求めます","最小公倍数 = a × b ÷ 最大公約数"],code:`# 最大公約数・最小公倍数
import math


def gcd(a, b):
    while b:
        a, b = b, a % b
    return a


a, b = ${n}, ${a}
print("最大公約数:", gcd(a, b), math.gcd(a, b))
print("最小公倍数:", a * b // gcd(a, b))
`}}},{id:"wordcount",title:"文字数・単語の出現回数",name:"word_count.py",example:"単語の出現回数を数える",match:(t,e)=>(e.has("wordcount")?7:0)+(e.has("count")&&e.has("string")?3:0),build:()=>({summary:["文章の文字数 (空白を除く) と行数を数えます","Counter で単語の出現回数を数え、多い順に表示します"],code:`# 文字数と単語の出現回数
from collections import Counter

text = """Python is easy to learn.
Python is fun, and Python is powerful."""

print("文字数:", len(text))
print("空白を除いた文字数:", len("".join(text.split())))
print("行数:", len(text.splitlines()))

words = [w.strip(".,!?").lower() for w in text.split()]
for word, n in Counter(words).most_common(5):
    print(f"{word}: {n} 回")
`})},{id:"countdown",title:"カウントダウンタイマー",name:"timer.py",example:"10 秒のカウントダウン",match:(t,e)=>e.has("time")&&/(カウントダウン|タイマー|timer|秒数える|秒待)/.test(t)?6:0,build:t=>{let e=t.seconds||d(t,10,{min:1,max:3600});return{summary:[`${e} 秒から 1 秒ずつ数を減らして表示します (time.sleep)`,"0 になったらお知らせします"],code:`# カウントダウンタイマー (${e} 秒)
import time

for remaining in range(${e}, 0, -1):
    minutes, seconds = divmod(remaining, 60)
    print(f"残り {minutes:02}:{seconds:02}")
    time.sleep(1)
print("時間です!")
`}}},{id:"stopwatch",title:"ストップウォッチ",name:"stopwatch.py",example:"ストップウォッチ",match:t=>/ストップウォッチ|stopwatch|反応速度|早押し/.test(t)?7:0,build:()=>({summary:["Enter でスタートとストップ、かかった時間を表示します","time.perf_counter で正確に計ります"],code:`# ストップウォッチ
import time

input("Enter でスタート")
start = time.perf_counter()
input("Enter でストップ")
elapsed = time.perf_counter() - start
print(f"{elapsed:.2f} 秒でした")
`})},{id:"dates",title:"日付の計算",name:"dates.py",example:"誕生日まであと何日",match:(t,e)=>e.has("datetime")?5:0,build:()=>({summary:["今日の日付と曜日を表示します","誕生日を入れると、年齢と次の誕生日までの日数を出します"],code:`# 日付の計算
from datetime import date

today = date.today()
WEEK = ["月", "火", "水", "木", "金", "土", "日"]
print(f"今日は {today:%Y年%m月%d日} ({WEEK[today.weekday()]})")

text = input("誕生日 (例: 2010-04-15): ")
birthday = date.fromisoformat(text)
age = today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day))
next_birthday = birthday.replace(year=today.year)
if next_birthday < today:
    next_birthday = next_birthday.replace(year=today.year + 1)
print(f"{age} 歳です。次の誕生日まで {(next_birthday - today).days} 日")
`})},{id:"memo",title:"メモをファイルに保存",name:"memo.py",example:"メモをファイルに保存",match:(t,e)=>(e.has("file")&&!e.has("csv")&&!e.has("json")?4:0)+(/メモ/.test(t)?2:0),build:t=>{let e=t.files.find(n=>/\.txt$/.test(n))||"memo.txt";return{summary:[`入力した文を ${e} に書き足します (追記モード "a")`,"これまでのメモを全部読み込んで表示します","ForgeCode では、書いたファイルがプロジェクトに追加されます"],code:`# メモをファイルに保存する
from datetime import datetime

FILE = ${f(e)}

text = input("メモ: ")
with open(FILE, "a", encoding="utf-8") as f:
    f.write(f"{datetime.now():%m/%d %H:%M} {text}\\n")

print("--- これまでのメモ ---")
with open(FILE, encoding="utf-8") as f:
    for line in f:
        print(line.rstrip())
`}}},{id:"csvsum",title:"CSV を読んで集計",name:"csv_report.py",example:"CSV を読んで集計",match:(t,e)=>(e.has("csv")?6:0)+(e.has("plot")?-2:0),build:t=>{let e=t.files.find(n=>/\.csv$/.test(n))||"data.csv";return{summary:[`${e} を csv.DictReader で読みます (なければサンプルを作ります)`,"項目ごとに合計と平均を出して表示します"],code:`# CSV を読んで集計
import csv
from collections import defaultdict
from pathlib import Path

FILE = Path(${f(e)})
if not FILE.exists():
    FILE.write_text("name,category,amount\\napple,fruit,120\\nmilk,drink,180\\nbanana,fruit,90\\ntea,drink,150\\n", encoding="utf-8")

totals = defaultdict(int)
counts = defaultdict(int)
with FILE.open(encoding="utf-8") as f:
    for row in csv.DictReader(f):
        totals[row["category"]] += int(row["amount"])
        counts[row["category"]] += 1

for category, total in totals.items():
    print(f"{category}: 合計 {total} / 平均 {total / counts[category]:.1f}")
`}}},{id:"jsonsave",title:"JSON で保存と読み込み",name:"save_data.py",example:"データを JSON で保存",match:(t,e)=>e.has("json")?6:0,build:()=>({summary:["辞書を save.json に保存して、読み込み直します","実行するたびに回数が 1 ずつ増えます (データが残ることを確認できます)"],code:`# JSON でデータを保存・読み込み
import json
from pathlib import Path

FILE = Path("save.json")
if FILE.exists():
    data = json.loads(FILE.read_text(encoding="utf-8"))
else:
    data = {"name": "player", "level": 1, "count": 0}

data["count"] += 1
print(f"{data['count']} 回目の実行です (レベル {data['level']})")
FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
`})},{id:"plot",title:"グラフ",name:"graph.py",example:"棒グラフを描く",match:(t,e)=>e.has("plot")?7:0,build:(t,e)=>{let n=/円グラフ|pie/.test(e)?"pie":/散布|scatter/.test(e)?"scatter":/ヒストグラム|hist|分布/.test(e)?"hist":/折れ線|line|推移|変化/.test(e)?"line":/棒|bar/.test(e)?"bar":/sin|cos|関数|数式|y ?=/.test(e)?"func":"bar",a=/csv/.test(e),i={pie:"円グラフ",scatter:"散布図",hist:"ヒストグラム",line:"折れ線グラフ",bar:"棒グラフ",func:"関数のグラフ"}[n],r={bar:`labels = ["Mon", "Tue", "Wed", "Thu", "Fri"]
values = [12, 18, 9, 22, 15]
plt.bar(labels, values, color="#5b8def")
plt.title("Visitors")
plt.ylabel("people")`,line:`months = list(range(1, 13))
sales = [30, 35, 32, 40, 48, 52, 60, 58, 50, 45, 40, 55]
plt.plot(months, sales, marker="o")
plt.title("Monthly sales")
plt.xlabel("month")
plt.ylabel("sales")
plt.grid(True)`,pie:`labels = ["Python", "JavaScript", "Java", "Other"]
sizes = [45, 25, 15, 15]
plt.pie(sizes, labels=labels, autopct="%1.0f%%", startangle=90)
plt.title("Favorite languages")`,scatter:`import random

x = [random.uniform(0, 10) for _ in range(50)]
y = [v * 2 + random.gauss(0, 2) for v in x]
plt.scatter(x, y, alpha=0.7)
plt.title("Scatter")
plt.xlabel("x")
plt.ylabel("y")`,hist:`import random

data = [random.gauss(60, 12) for _ in range(500)]
plt.hist(data, bins=20, color="#7fb36e", edgecolor="white")
plt.title("Score distribution")
plt.xlabel("score")`,func:`import numpy as np

x = np.linspace(-2 * np.pi, 2 * np.pi, 400)
plt.plot(x, np.sin(x), label="sin(x)")
plt.plot(x, np.cos(x), label="cos(x)")
plt.axhline(0, color="gray", linewidth=0.5)
plt.legend()
plt.title("sin and cos")`}[n],s=`import csv
from pathlib import Path

FILE = Path("data.csv")
if not FILE.exists():
    FILE.write_text("label,value\\nA,12\\nB,18\\nC,9\\nD,22\\n", encoding="utf-8")
labels, values = [], []
with FILE.open(encoding="utf-8") as f:
    for row in csv.DictReader(f):
        labels.append(row["label"])
        values.append(float(row["value"]))
plt.${n==="line"?'plot(labels, values, marker="o")':n==="pie"?'pie(values, labels=labels, autopct="%1.0f%%")':"bar(labels, values)"}
plt.title("data.csv")`;return{title:i,summary:[`matplotlib で${i}を描きます`,"plt.show() で、図が出力に表示されます (タップで拡大・保存)","はじめて使うときは、ライブラリの読み込みに少し時間がかかります","タイトルや軸の文字は英語にしています (日本語は表示できないことがあるため)"],code:`# ${i}
import matplotlib.pyplot as plt

${a?s:r}
plt.show()
`}}},{id:"numpy",title:"numpy で計算",name:"numpy_demo.py",example:"numpy で行列の計算",match:(t,e)=>e.has("numpy")?6:0,build:()=>({summary:["numpy の配列で、まとめて計算します","平均・標準偏差・行列のかけ算などを表示します"],code:`# numpy で計算
import numpy as np

scores = np.array([72, 88, 95, 60, 81])
print("平均:", scores.mean(), "標準偏差:", round(scores.std(), 2))
print("80 点以上:", scores[scores >= 80])
print("全員 +5 点:", scores + 5)

a = np.array([[1, 2], [3, 4]])
b = np.array([[5, 6], [7, 8]])
print("行列の積:\\n", a @ b)
print("転置:\\n", a.T)
`})},{id:"pandas",title:"pandas でデータ分析",name:"pandas_demo.py",example:"pandas でデータ分析",match:(t,e)=>e.has("pandas")?6:0,build:()=>({summary:["DataFrame (表) を作って、集計・並べ替え・絞り込みをします","groupby でクラスごとの平均を出します"],code:`# pandas でデータ分析
import pandas as pd

df = pd.DataFrame({
    "name": ["Taro", "Hanako", "Jiro", "Yuki", "Ken", "Mai"],
    "class": ["A", "B", "A", "B", "A", "B"],
    "math": [80, 95, 62, 88, 71, 90],
    "english": [70, 85, 90, 76, 68, 94],
})
df["total"] = df["math"] + df["english"]

print(df)
print(df.describe())
print(df.groupby("class")[["math", "english"]].mean())
print(df.sort_values("total", ascending=False).head(3))
print(df[df["math"] >= 80])
`})},{id:"class",title:"クラス",name:"models.py",example:"犬のクラス",match:(t,e)=>e.has("classKw")?5:0,build:(t,e)=>{let n=t.quoted[0]||t.identifiers.find(o=>/^[A-Z]/.test(o))||(/(犬|dog)/i.test(e)?"Dog":/(猫|cat)/i.test(e)?"Cat":/(車|car)/i.test(e)?"Car":/(人|person|生徒|学生|student)/i.test(e)?"Student":/(口座|銀行|bank|account)/i.test(e)?"BankAccount":/(商品|item|product)/i.test(e)?"Item":"Character"),a=$(n),r={Dog:[["name","str",'"ポチ"'],["age","int","3"]],Cat:[["name","str",'"タマ"'],["age","int","2"]],Car:[["maker","str",'"Toyota"'],["speed","int","0"]],Student:[["name","str",'"Taro"'],["score","int","80"]],BankAccount:[["owner","str",'"Taro"'],["balance","int","1000"]],Item:[["name","str",'"りんご"'],["price","int","120"]],Character:[["name","str",'"勇者"'],["hp","int","100"]]}[a]||[["name","str",'"sample"'],["value","int","0"]],s=/継承|親クラス|子クラス/.test(e),m=a==="BankAccount"?`    def deposit(self, amount: int) -> None:
        """お金を預ける"""
        if amount <= 0:
            raise ValueError("金額は 1 円以上にしてください")
        self.balance += amount

    def withdraw(self, amount: int) -> None:
        """お金を引き出す"""
        if amount > self.balance:
            raise ValueError("残高が足りません")
        self.balance -= amount`:a==="Character"?`    def damage(self, amount: int) -> None:
        """ダメージを受ける (0 より下にはならない)"""
        self.hp = max(0, self.hp - amount)

    def is_alive(self) -> bool:
        return self.hp > 0`:`    def describe(self) -> str:
        """説明の文を返す"""
        return f"${a}: ${r.map(o=>`{self.${o[0]}}`).join(" / ")}"`,p=a==="BankAccount"?`account = BankAccount("Taro", 1000)
account.deposit(500)
account.withdraw(300)
print(account)`:a==="Character"?`hero = Character("勇者", 100)
hero.damage(30)
print(hero, hero.is_alive())`:`obj = ${a}(${r.map(o=>o[2]).join(", ")})
print(obj)
print(obj.describe())`;return{title:`${a} クラス`,summary:[`${a} クラスを作り、__init__ で ${r.map(o=>o[0]).join("・")} を属性にします`,"__str__ で print したときの表示を決めています","メソッドの最初の引数は self (そのインスタンス自身) です",s?"継承の例として、子クラスでメソッドを上書きしています":null].filter(Boolean),code:`# ${a} クラス
class ${a}:
    def __init__(self, ${r.map(o=>`${o[0]}: ${o[1]}`).join(", ")}) -> None:
${r.map(o=>`        self.${o[0]} = ${o[0]}`).join(`
`)}

${m}

    def __str__(self) -> str:
        return f"${a}(${r.map(o=>`${o[0]}={self.${o[0]}!r}`).join(", ")})"
${s?`

class Special${a}(${a}):
    def __str__(self) -> str:
        return "★" + super().__str__()
`:""}

${p}
${s?`print(Special${a}(${r.map(o=>o[2]).join(", ")}))
`:""}`}}},{id:"function",title:"関数",name:"functions.py",example:"2 つの数を足す関数",match:(t,e)=>(e.has("func")?5:0)+(/(関数|function|def)/.test(t)?1:0),build:(t,e)=>{let n=[[/(足|加|合計|sum|add)/,"add",["a","b"],"a + b","2 つの数を足す","3, 4"],[/(引|差|sub)/,"subtract",["a","b"],"a - b","a から b を引く","10, 4"],[/(掛|かけ|積|mul)/,"multiply",["a","b"],"a * b","2 つの数を掛ける","3, 4"],[/(割|商|div)/,"divide",["a","b"],"a / b if b != 0 else None","a を b で割る (0 のときは None)","10, 4"],[/(平均|average|mean)/,"average",["numbers"],"sum(numbers) / len(numbers) if numbers else 0","リストの平均","[70, 80, 90]"],[/(偶数|奇数|even|odd)/,"is_even",["n"],"n % 2 == 0","偶数なら True","7"],[/(最大|大きい方|max)/,"larger",["a","b"],"a if a > b else b","大きい方を返す","3, 8"],[/(挨拶|あいさつ|greet|hello)/,"greet",["name"],'f"こんにちは、{name} さん"',"あいさつの文を作る",'"Taro"'],[/(円|面積|area)/,"circle_area",["radius"],"math.pi * radius ** 2","円の面積","3"]],a=n.find(o=>o[0].test(e))||n[0],[,i,r,s,m,p]=a;return{title:`関数 ${i}`,summary:[`def で ${i} 関数を作ります (${m})`,"return で結果を返し、呼び出した側で print します",'"""…""" の説明は、補完やホバーで表示されます'],code:`${i==="circle_area"?`import math


`:""}def ${i}(${r.join(", ")}):
    """${m}"""
    return ${s}


print(${i}(${p}))
`}}},{id:"loopdemo",title:"くり返しで表示",name:"loop.py",example:"1 から 10 まで表示",match:(t,e)=>(e.has("loop")||/まで(表示|出力|print)/.test(t)?3:0)+(y(t).numbers.length?1:0)+(e.has("print")?1:0),build:(t,e)=>{let n=c(t),a=n.length>=2?n[0]:1,i=n.length>=2?n[1]:n[0]||10,r=/(偶数|2 ?つおき|ひとつ飛ばし)/.test(e)?2:1,s=i<a;return{summary:[`${a} から ${i} まで${r>1?` ${r} つおきに`:""}数を表示します`,`range(${a}, ${s?i-1:i+1}${r>1||s?`, ${s?-r:r}`:""}) は ${a} 以上 ${i}${s?" 以上":" 以下"} (終わりの数は含まない書き方です)`],code:`# ${a} から ${i} まで表示
for i in range(${a}, ${s?i-1:i+1}${r>1||s?`, ${s?-r:r}`:""}):
    print(i)
`}}},{id:"inputdemo",title:"入力してあいさつ",name:"hello.py",example:"名前を聞いてあいさつ",match:(t,e)=>(e.has("input")?3:0)+(/(名前|あいさつ|挨拶)/.test(t)?2:0),build:()=>({summary:["input で名前と年齢を聞きます","年齢は int() で数にして計算します","f-string で文を組み立てて表示します"],code:`# 名前を聞いてあいさつ
name = input("名前は? ")
age = int(input("年齢は? "))
print(f"こんにちは、{name} さん!")
print(f"10 年後は {age + 10} 歳ですね")
`})},{id:"randomdemo",title:"ランダムに選ぶ (抽選)",name:"lottery.py",example:"くじ引き",match:(t,e)=>(e.has("random")?3:0)+(/(抽選|くじ|選ぶ|シャッフル|当番)/.test(t)?3:0),build:t=>{let e=t.quoted.length>=2?t.quoted:["Taro","Hanako","Jiro","Yuki","Ken"];return{summary:["random.choice で 1 人選び、random.sample で重ならずに何人か選びます","random.shuffle で順番を混ぜます"],code:`# ランダムに選ぶ
import random

members = [${e.map(f).join(", ")}]
print("当たり:", random.choice(members))
print("2 人選ぶ:", random.sample(members, 2))
order = members[:]
random.shuffle(order)
print("順番:", order)
`}}},{id:"dictdemo",title:"辞書を使う (電話帳)",name:"phonebook.py",example:"辞書で電話帳",match:(t,e)=>e.has("dict")?4:0,build:()=>({summary:["名前 → 電話番号の辞書を作ります","名前を入れると番号を探し、なければ登録できます","最後に一覧を表示します"],code:`# 辞書で電話帳
phonebook = {"Taro": "090-1111-2222", "Hanako": "080-3333-4444"}

while True:
    name = input("名前 (空で終わり): ").strip()
    if not name:
        break
    if name in phonebook:
        print(name, "の番号は", phonebook[name])
    else:
        number = input("見つかりません。番号を登録してください: ")
        phonebook[name] = number

for name, number in sorted(phonebook.items()):
    print(f"{name}: {number}")
`})},{id:"listdemo",title:"リストの操作",name:"list_demo.py",example:"リストの使い方",match:(t,e)=>e.has("list")?3:0,build:()=>({summary:["リストに追加・削除・並べ替え・検索をします","内包表記で新しいリストを作ります"],code:`# リストの操作
fruits = ["りんご", "みかん"]
fruits.append("ぶどう")
fruits.insert(0, "もも")
print(fruits, len(fruits))

if "みかん" in fruits:
    fruits.remove("みかん")
print(fruits, fruits[0], fruits[-1])

numbers = [5, 3, 8, 1]
numbers.sort()
print(numbers, sum(numbers), max(numbers))
squares = [n * n for n in numbers]
print(squares)
`})},{id:"trydemo",title:"エラーに強い入力 (try / except)",name:"safe_input.py",example:"エラーにならない入力",match:(t,e)=>e.has("exception")?5:0,build:()=>({summary:["数字以外や 0 が入っても止まらないように、try / except で受けます","正しく入力されるまで聞き直します"],code:`# エラーに強い入力
def ask_int(prompt):
    while True:
        try:
            return int(input(prompt))
        except ValueError:
            print("整数を入れてください")


a = ask_int("割られる数: ")
b = ask_int("割る数: ")
try:
    print("答え:", a / b)
except ZeroDivisionError:
    print("0 では割れません")
`})},{id:"recursion",title:"再帰",name:"recursion.py",example:"再帰で計算",match:(t,e)=>e.has("recursion")?6:0,build:()=>({summary:["関数が自分自身を呼ぶ「再帰」の例です","終わる条件 (n <= 1 など) を必ず書きます","ハノイの塔の手順も表示します"],code:`# 再帰
def total(n):
    """1〜n の合計"""
    if n <= 1:
        return n
    return n + total(n - 1)


def hanoi(n, src, dst, tmp):
    if n == 0:
        return
    hanoi(n - 1, src, tmp, dst)
    print(f"{n} 番の円盤を {src} → {dst}")
    hanoi(n - 1, tmp, dst, src)


print(total(10))
hanoi(3, "A", "C", "B")
`})},{id:"regex",title:"正規表現で探す",name:"regex_demo.py",example:"メールアドレスを取り出す",match:(t,e)=>(e.has("regex")?6:0)+(/(メールアドレス|電話番号|郵便番号)/.test(t)?4:0),build:()=>({summary:["re.findall で、文章の中からメールアドレス・電話番号を取り出します","re.sub で数字を伏せ字にします"],code:`# 正規表現で探す
import re

text = """お問い合わせ: info@example.com / sales@example.jp
電話: 03-1234-5678, 090-1111-2222"""

print(re.findall(r"[\\w.+-]+@[\\w-]+\\.[\\w.]+", text))
print(re.findall(r"\\d{2,4}-\\d{2,4}-\\d{4}", text))
print(re.sub(r"\\d", "*", "カード番号 1234-5678"))
`})},{id:"unittest",title:"テストコード (unittest)",name:"test_sample.py",example:"テストコード",match:(t,e)=>e.has("unittest")?6:0,build:()=>({summary:["unittest でテストを書きます (test_ で始まるメソッドがテスト)","assertEqual で結果が正しいか確かめます","▶ で実行すると、テストの結果が表示されます"],code:`# テストコード
import unittest


def add(a, b):
    return a + b


def is_even(n):
    return n % 2 == 0


class SampleTest(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)

    def test_is_even(self):
        self.assertTrue(is_even(4))
        self.assertFalse(is_even(7))


if __name__ == "__main__":
    unittest.main()
`})}];function y(t){return u(t)}var k=g.map(t=>t.example).filter(Boolean);function v(t,{concepts:e,slots:n}={}){let a=h(t),i=e||b(t),r=n||u(t),s=g.map(l=>({r:l,s:l.match(a,i)})).filter(l=>l.s>0).sort((l,x)=>x.s-l.s);if(!s.length||s[0].s<3)return null;let m=s[0].r,p=m.build(r,a);if(!p)return null;let o=p.name||m.name;return{title:p.title||m.title,summary:p.summary,files:[{name:o,code:p.code.replace(/\n{3,}$/,`
`).replace(/\n*$/,`
`)}],spec:{kind:"recipe",id:m.id},alternatives:s.slice(1,4).filter(l=>l.s>=s[0].s*.6).map(l=>l.r.example)}}export{g as a,k as b,v as c};

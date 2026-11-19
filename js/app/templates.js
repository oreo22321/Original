// 新規プロジェクトのテンプレート (Python)
export const TEMPLATES = {
  basics: {
    name: 'はじめての Python',
    desc: '出力・変数・if・for・関数・input の基本',
    icon: 'bulb',
    main: 'main.py',
    files: {
      'main.py': `# はじめての Python
# ▶ ボタンで実行すると、下の「出力」に結果が表示されます

# 1. 出力
print("こんにちは、Python!")

# 2. 変数と計算
price = 120
count = 3
total = price * count
print(f"{price} 円 × {count} 個 = {total} 円")

# 3. 条件分岐
if total >= 300:
    print("300 円以上なので送料無料です")
else:
    print("あと", 300 - total, "円で送料無料です")

# 4. くり返し
fruits = ["りんご", "みかん", "ぶどう"]
for i, fruit in enumerate(fruits, start=1):
    print(i, fruit)

# 5. 関数
def greet(name: str) -> str:
    """あいさつの文を作る"""
    return f"{name} さん、ようこそ!"


print(greet("ForgeCode"))

# 6. 入力 (実行すると、出力の下に入力欄が出ます)
name = input("名前を入れてください: ")
print(greet(name))
`,
      'README.md': `# はじめての Python

- \`main.py\` を開いて ▶ で実行します
- 書き間違いは、赤や黄色の波線で教えてくれます (タップすると直し方が出ます)
- 分からないことは AI (右上の ✦) に聞けます
`,
    },
  },
  game: {
    name: '数当てゲーム',
    desc: 'random と input で遊べる小さなゲーム',
    icon: 'gamepad',
    main: 'main.py',
    files: {
      'main.py': `# 数当てゲーム: 1〜100 の数を当てます
import random

answer = random.randint(1, 100)
tries = 0

print("1〜100 の数を当ててください!")
while True:
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
`,
    },
  },
  data: {
    name: 'データの集計とグラフ',
    desc: 'CSV を読んで集計し、matplotlib でグラフに',
    icon: 'layers',
    main: 'main.py',
    files: {
      'main.py': `# CSV のデータを集計して、グラフにします
# (はじめての実行では、ライブラリの読み込みに少し時間がかかります)
import csv
from collections import defaultdict

import matplotlib.pyplot as plt

totals = defaultdict(int)
with open("sales.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        totals[row["month"]] += int(row["sales"])

for month, value in totals.items():
    print(f"{month}: {value:,} 円")

plt.bar(list(totals.keys()), list(totals.values()), color="#5b8def")
plt.title("Sales by month")
plt.ylabel("yen")
plt.show()  # 図は出力に表示されます

# 結果をファイルに保存 (プロジェクトにファイルが増えます)
with open("summary.txt", "w", encoding="utf-8") as f:
    for month, value in totals.items():
        f.write(f"{month},{value}\\n")
print("summary.txt に保存しました")
`,
      'sales.csv': `month,item,sales
Jan,apple,1200
Jan,orange,800
Feb,apple,1500
Feb,orange,900
Mar,apple,1700
Mar,orange,1100
`,
    },
  },
  app: {
    name: '複数ファイルのアプリ',
    desc: 'モジュールに分けた ToDo 管理 (クラス・import)',
    icon: 'folder',
    main: 'main.py',
    files: {
      'main.py': `# ToDo 管理: モジュールに分けたプログラムの例
from todo.models import TodoList


def main():
    todos = TodoList()
    todos.add("Python の勉強")
    todos.add("買い物")
    todos.add("部屋の掃除")
    todos.done(2)

    print("ToDo 一覧")
    for item in todos:
        print(item)
    print(f"残り {todos.remaining()} 件")


if __name__ == "__main__":
    main()
`,
      'todo/__init__.py': '',
      'todo/models.py': `from dataclasses import dataclass


@dataclass
class Todo:
    id: int
    title: str
    finished: bool = False

    def __str__(self) -> str:
        mark = "✓" if self.finished else " "
        return f"[{mark}] {self.id}. {self.title}"


class TodoList:
    def __init__(self) -> None:
        self.items: list[Todo] = []

    def add(self, title: str) -> Todo:
        todo = Todo(len(self.items) + 1, title)
        self.items.append(todo)
        return todo

    def done(self, todo_id: int) -> None:
        for todo in self.items:
            if todo.id == todo_id:
                todo.finished = True

    def remaining(self) -> int:
        return sum(1 for t in self.items if not t.finished)

    def __iter__(self):
        return iter(self.items)
`,
    },
  },
  turtle: {
    name: 'タートルで絵とゲーム',
    desc: 'turtle で図形を描き、矢印キーで動かす',
    icon: 'brush',
    main: 'main.py',
    files: {
      'main.py': `# タートルで絵とゲーム
# ▶ で実行すると、出力に絵が描かれます。描き終わったら矢印キー (スマホは下のボタン) で動かせます
import turtle

screen = turtle.Screen()
screen.title("タートル")
screen.bgcolor("white")

pen = turtle.Turtle()
pen.speed(8)


def star(size, color):
    """星を描く"""
    pen.color(color, color)
    pen.begin_fill()
    for _ in range(5):
        pen.forward(size)
        pen.right(144)
    pen.end_fill()


# 1. 星をいくつか描く
for x, color in [(-200, "gold"), (-50, "tomato"), (100, "skyblue")]:
    pen.penup()
    pen.goto(x, 120)
    pen.pendown()
    star(80, color)

# 2. 文字を書く
pen.penup()
pen.goto(0, -20)
pen.color("black")
pen.write("矢印キーで動かそう", align="center", font=("Arial", 16, "bold"))
pen.hideturtle()

# 3. 矢印キーで動くタートル
player = turtle.Turtle()
player.shape("turtle")
player.color("seagreen")
player.penup()
player.goto(0, -120)


def move(dx, dy, heading):
    player.setheading(heading)
    player.goto(player.xcor() + dx, player.ycor() + dy)


screen.onkeypress(lambda: move(0, 20, 90), "Up")
screen.onkeypress(lambda: move(0, -20, 270), "Down")
screen.onkeypress(lambda: move(-20, 0, 180), "Left")
screen.onkeypress(lambda: move(20, 0, 0), "Right")
screen.listen()
turtle.done()  # ■ で終わります
`,
    },
  },
  empty: {
    name: '空のプロジェクト',
    desc: 'main.py だけ',
    icon: 'file',
    main: 'main.py',
    files: { 'main.py': '' },
  },
}

// 「新しいファイル」の種類
export const NEW_FILE_TEMPLATES = {
  'Python': { ext: '.py', stem: 'script', content: '' },
  'モジュール': { ext: '.py', stem: 'module', content: '"""モジュールの説明"""\n\n\ndef hello():\n    return "hello"\n' },
  'テスト': { ext: '.py', stem: 'test_sample', content: 'import unittest\n\n\nclass SampleTest(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(1 + 1, 2)\n\n\nif __name__ == "__main__":\n    unittest.main()\n' },
  'CSV': { ext: '.csv', stem: 'data', content: 'name,value\n' },
  'JSON': { ext: '.json', stem: 'data', content: '{\n  \n}\n' },
  'テキスト': { ext: '.txt', stem: 'note', content: '' },
  'メモ': { ext: '.md', stem: 'README', content: '# タイトル\n' },
}

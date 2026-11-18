// 実行時エラーの解説 (よくある Python のエラーを日本語で説明し、直し方を提案します)
// explainError(err): err は { type, message, text?, frames? } か、エラーの文字列 ("NameError: name 'x' is not defined")
// 返り値: { why: string, fixes: string[] } | null
const q = s => `「${s}」`

const RULES = {
  NameError: [
    [/name '(\w+)' is not defined\. Did you mean: '(\w+)'\?/, m => ({ why: `${q(m[1])} という名前は定義されていません。${q(m[2])} の書き間違いかもしれません。`, fixes: [`${m[1]} → ${m[2]} に直します`, '大文字・小文字の違いも別の名前になります'] })],
    [/name '(\w+)' is not defined/, m => ({
      why: `${q(m[1])} という名前 (変数・関数) はまだ作られていません。`,
      fixes: [
        /^(np|pd|plt|math|random|time|os|sys|json|re|datetime|csv)$/.test(m[1]) ? `ファイルの先頭で import します (例: ${({ np: 'import numpy as np', pd: 'import pandas as pd', plt: 'import matplotlib.pyplot as plt' })[m[1]] || 'import ' + m[1]})` : null,
        /^(true|false|null|none|nil)$/i.test(m[1]) ? `Python では ${({ true: 'True', false: 'False', null: 'None', none: 'None', nil: 'None' })[m[1].toLowerCase()]} と書きます (最初が大文字)` : null,
        'スペル (大文字・小文字) を確認します',
        '使う行より上で、変数に値を入れたり def で関数を作ったりします',
        '文字列のつもりなら "" で囲みます',
      ],
    })],
    [/cannot access local variable '(\w+)'|local variable '(\w+)' referenced before assignment/, m => ({ why: `関数の中で ${q(m[1] || m[2])} に値を入れる前に使いました。関数の中で代入すると、その名前は関数の中だけの変数になります。`, fixes: ['関数の外の変数を書き換えたいなら、関数の先頭に global 名前 と書きます', '値は引数で受け取り、結果は return で返す書き方がおすすめです'] })],
  ],
  TypeError: [
    [/can only concatenate str \(not "(\w+)"\) to str/, m => ({ why: `文字列と ${m[1]} は + でつなげられません。`, fixes: ['str(値) で文字列に変換します', 'f-string が便利です: f"合計は {total} です"'] })],
    [/unsupported operand type\(s\) for ([^:]+): '(\w+)' and '(\w+)'/, m => ({ why: `${m[2]} と ${m[3]} は ${m[1].trim()} で計算できません。`, fixes: [m[2] === 'str' || m[3] === 'str' ? 'input() の結果は文字列です。int(…) や float(…) で数値にします' : null, m[2] === 'NoneType' || m[3] === 'NoneType' ? 'None が混ざっています。関数が return で値を返しているか確認します' : null, '値の型は print(type(値)) で確かめられます'] })],
    [/'(\w+)' object is not callable/, m => ({ why: `${m[1]} の値を関数のように () で呼び出しました。`, fixes: [`組み込み関数と同じ名前 (list, str, sum など) の変数を作っていないか確認します`, '余分な () が付いていないか確認します'] })],
    [/'(\w+)' object is not subscriptable/, m => ({ why: `${m[1]} の値に [ ] は使えません。`, fixes: [m[1] === 'NoneType' ? '値が None です。関数が return しているか確認します' : null, m[1] === 'function' || m[1] === 'method' ? '関数を呼び出すときは [ ] ではなく ( ) を使います' : null, 'リスト・辞書・文字列のつもりの変数に、別の値が入っていないか確認します'] })],
    [/'(\w+)' object is not iterable/, m => ({ why: `${m[1]} の値は for でくり返せません。`, fixes: [m[1] === 'int' ? '数だけくり返すなら range(n) を使います (例: for i in range(10))' : null, 'リストや文字列が入っているか確認します'] })],
    [/'(\w+)' object does not support item assignment/, m => ({ why: `${m[1]} は中身を書き換えられません${m[1] === 'str' || m[1] === 'tuple' ? ` (${m[1]} は変更できない型です)` : ''}。`, fixes: [m[1] === 'str' ? '新しい文字列を作ります (例: s = s[:i] + "x" + s[i+1:])' : null, m[1] === 'tuple' ? 'list(…) でリストにしてから変更します' : null] })],
    [/(\w+)\(\) missing (\d+) required positional arguments?: (.+)/, m => ({ why: `${m[1]}() に必要な引数 ${m[3]} が足りません。`, fixes: [`呼び出すときに引数を ${m[2]} 個増やします`, 'クラスのメソッドなら、def の最初の引数が self になっているか確認します'] })],
    [/(\w+)\(\) takes (\d+) positional arguments? but (\d+) (?:was|were) given/, m => ({ why: `${m[1]}() の引数は ${m[2]} 個ですが、${m[3]} 個渡しました。`, fixes: ['呼び出しの引数の数を確認します', 'メソッドなら def に self を書き忘れていないか確認します'] })],
    [/(\w+)\(\) got an unexpected keyword argument '(\w+)'/, m => ({ why: `${m[1]}() に ${q(m[2])} という名前の引数はありません。`, fixes: ['引数の名前のスペルを確認します', '関数の上で長押し (またはマウスを乗せる) と、使える引数が分かります'] })],
    [/'(<|>|<=|>=)' not supported between instances of '(\w+)' and '(\w+)'/, m => ({ why: `${m[2]} と ${m[3]} は ${m[1]} で比べられません。`, fixes: ['input() の結果は文字列です。int(…) で数値にしてから比べます', 'None が混ざっていないか確認します'] })],
    [/list indices must be integers or slices, not (\w+)/, m => ({ why: `リストの [ ] には整数を入れます (${m[1]} を入れました)。`, fixes: [m[1] === 'str' ? 'int(…) で数値にします。辞書のつもりなら {} で作ります' : null, m[1] === 'float' ? 'int(…) か // (切り捨ての割り算) で整数にします' : null] })],
  ],
  ValueError: [
    [/invalid literal for int\(\) with base 10: '(.*)'/, m => ({ why: `${q(m[1])} は整数に変換できません。`, fixes: [m[1] === '' ? '何も入力されていません。空のときの処理を入れます' : null, /\./.test(m[1]) ? '小数は float(…) を使います' : null, '数字だけが入っているか確認します (全角の数字や空白も使えません)', 'try: … except ValueError: で、変換できないときの処理を書けます'] })],
    [/could not convert string to float: '(.*)'/, m => ({ why: `${q(m[1])} は小数に変換できません。`, fixes: ['数字と . だけが入っているか確認します'] })],
    [/too many values to unpack|not enough values to unpack/, (m, e) => ({ why: `左側の変数の数と、右側の値の数が合っていません。(${e.message})`, fixes: ['a, b = … の変数の数を確認します', '辞書を for で回すときは .items() を付けます'] })],
    [/math domain error/, () => ({ why: '数学的に計算できない値を渡しました (例: math.sqrt(-1)、math.log(0))。', fixes: ['渡す値の範囲を確認します'] })],
    [/(\S+) is not in list/, m => ({ why: `リストの中に ${m[1]} はありません。`, fixes: ['先に if 値 in リスト: で確かめます'] })],
  ],
  IndexError: [[/(list|string|tuple) index out of range/, m => ({ why: `${({ list: 'リスト', string: '文字列', tuple: 'タプル' })[m[1]]}の範囲の外の番号を使いました。番号は 0 から 長さ-1 までです。`, fixes: ['len(…) で長さを確認します', 'for i in range(len(items)) の範囲を確認します', '空のリストではないか確認します'] })]],
  KeyError: [[/^'?(.*?)'?$/, m => ({ why: `辞書にキー ${q(m[1])} がありません。`, fixes: ['キーのスペル (大文字・小文字) を確認します', 'd.get(キー) を使うと、ないときに None (または既定値) になります', 'if キー in d: で先に確かめられます'] })]],
  AttributeError: [
    [/'NoneType' object has no attribute '(\w+)'/, m => ({ why: `値が None なので .${m[1]} を使えません。`, fixes: ['関数が return で値を返しているか確認します', 'list.sort() や list.append() は None を返します (結果はリスト自体が変わります)'] })],
    [/'(\w+)' object has no attribute '(\w+)'(?:\. Did you mean: '(\w+)'\?)?/, m => ({ why: `${m[1]} には ${q(m[2])} という属性 (メソッド) はありません。`, fixes: [m[3] ? `${q(m[3])} の書き間違いかもしれません` : null, m[1] === 'str' && /^(append|push)$/.test(m[2]) ? '文字列は + でつなげます' : null, m[1] === 'list' && /^(push|add|length|size)$/.test(m[2]) ? 'リストは append(…) で追加、len(…) で長さです' : null, 'スペルを確認します。. を打つと使える名前が候補に出ます'] })],
    [/module '(\w+)' has no attribute '(\w+)'/, m => ({ why: `モジュール ${m[1]} に ${q(m[2])} はありません。`, fixes: ['名前のスペルを確認します', `自分のファイル名が ${m[1]}.py になっていると、本物の ${m[1]} の代わりに読み込まれます。ファイル名を変えます`] })],
  ],
  ZeroDivisionError: [[/./, () => ({ why: '0 で割り算をしました。', fixes: ['割る数が 0 のときの処理を if で分けます', 'リストの長さで割るときは、空でないか確認します'] })]],
  ModuleNotFoundError: [[/No module named '([\w.]+)'/, m => ({ why: `${q(m[1])} というモジュール (ライブラリ) が見つかりません。`, fixes: ['名前のスペルを確認します', '自分のファイルなら、同じプロジェクトにあるか、フォルダに __init__.py があるか確認します', 'pip install はできません。使えるライブラリは「使い方 → 使えるライブラリ」で確認できます'] })]],
  ImportError: [[/cannot import name '(\w+)' from '([\w.]+)'/, m => ({ why: `${m[2]} に ${q(m[1])} はありません。`, fixes: ['名前のスペルを確認します', 'ファイル同士がお互いを import している (循環 import) と起きることがあります'] })]],
  RecursionError: [[/./, () => ({ why: '関数が自分自身を呼び出し続けて、終わらなくなりました。', fixes: ['再帰を止める条件 (if で return) があるか確認します', 'くり返しは for / while でも書けます'] })]],
  IndentationError: [[/./, () => ({ why: '字下げ (行の先頭の空白) が正しくありません。Python は字下げでブロックを表します。', fixes: ['if / for / def などの次の行は、スペース 4 つ下げます', 'タブとスペースを混ぜないようにします (整形 ⇧⌥F で直せます)'] })]],
  TabError: [[/./, () => ({ why: '字下げにタブとスペースが混ざっています。', fixes: ['整形 (⇧⌥F) で、スペースにそろえます'] })]],
  SyntaxError: [
    [/invalid character '(.)'/, m => ({ why: `使えない文字 ${q(m[1])} があります。全角の記号かもしれません。`, fixes: ['半角の記号に直します (エラーの行の電球から直せます)'] })],
    [/expected ':'/, () => ({ why: 'if / for / while / def / class の行の最後に : が必要です。', fixes: ['行の最後に : を付けます'] })],
    [/was never closed/, () => ({ why: '括弧が閉じられていません。', fixes: ['( [ { に対応する ) ] } を付けます'] })],
    [/Missing parentheses in call to 'print'/, () => ({ why: 'Python 3 では print は関数です。', fixes: ['print("こんにちは") のように ( ) で囲みます'] })],
    [/unterminated string literal/, () => ({ why: '文字列の " か \' が閉じられていません。', fixes: ['文字列の最後に、最初と同じ引用符を付けます'] })],
    [/Maybe you meant '==' or ':=' instead of '='/, () => ({ why: '比べるときは == を使います (= は代入です)。', fixes: ['if a = b: → if a == b:'] })],
    [/./, () => ({ why: '書き方 (文法) が正しくありません。', fixes: ['エラーの行と、その 1 つ上の行を確認します (括弧や : の付け忘れが多いです)'] })],
  ],
  FileNotFoundError: [[/No such file or directory: '(.+)'/, m => ({ why: `ファイル ${q(m[1])} が見つかりません。`, fixes: ['ファイル名のスペルを確認します', 'プロジェクトにそのファイルがあるか確認します (ファイルは ＋ で作れます)', 'フォルダの中なら "フォルダ名/ファイル名" と書きます'] })]],
  UnicodeDecodeError: [[/./, () => ({ why: '文字コードの違うファイルを読もうとしました。', fixes: ['open(…, encoding="utf-8") を付けます。Excel の CSV なら encoding="cp932" を試します'] })]],
  OverflowError: [[/./, () => ({ why: '数が大きすぎて計算できません。', fixes: ['小数 (float) の計算なら、整数 (int) で計算できないか考えます'] })]],
  StopIteration: [[/./, () => ({ why: 'next(…) で、もう取り出す値がありません。', fixes: ['for ループを使うと、終わりを自動で扱えます'] })]],
  AssertionError: [[/./, () => ({ why: 'assert の条件が成り立ちませんでした。', fixes: ['assert の式と、その時の値を確認します'] })]],
  EOFError: [[/./, () => ({ why: 'input() で入力を待っている途中で、入力が終わりました。', fixes: ['入力欄に値を入れて「送る」を押します'] })]],
  MemoryError: [[/./, () => ({ why: 'メモリが足りません。', fixes: ['大きなリストを一度に作らず、少しずつ処理します'] })]],
}

export function explainError(err) {
  let type, message
  if (typeof err === 'string') {
    const lines = err.trim().split('\n')
    const last = lines[lines.length - 1] || ''
    const m = /^(\w+(?:Error|Exception|Interrupt|Exit|Warning|Iteration))(?::\s*(.*))?$/.exec(last.trim())
    if (!m) return null
    type = m[1]; message = m[2] || ''
  } else if (err) {
    type = err.type; message = err.message || ''
  }
  const rules = RULES[type]
  if (!rules) return null
  for (const [re, fn] of rules) {
    const m = re.exec(message)
    if (m) {
      const r = fn(m, { type, message })
      return { why: r.why, fixes: (r.fixes || []).filter(Boolean) }
    }
  }
  return null
}

// Forge AI: ことばの理解 (日本語・英語)
// ・normalize: 全角/半角・大文字/小文字の違いをそろえる
// ・tokens: 検索用の語 (英単語 + camelCase の分割 + 日本語の 2 文字ずつ)
// ・concepts: 同じ意味の言い方 (「並べ替え」「ソート」「sort」…) を 1 つの概念にまとめて見つける
// ・detectIntents: 何を頼まれているか (説明・修正・生成・質問 …) を点数で判定
// ・slots: 数値・秒数・キー・色・名前などの値を取り出す
// ・Bm25: 知識ベースの検索 (BM25)

// ============================================================
// 正規化
// ============================================================
export function normalize(s) {
  return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[〜~]/g, '~')
}

// 文中の英単語 (識別子) を camelCase / snake_case で分割したものも含めて返す
export function words(s) {
  const out = []
  const re = /[A-Za-z_][A-Za-z0-9_]*/g
  const src = String(s || '').normalize('NFKC')
  let m
  while ((m = re.exec(src))) {
    const w = m[0]
    out.push(w.toLowerCase())
    const parts = w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_]+/).filter(p => p.length > 1)
    if (parts.length > 1) for (const p of parts) out.push(p.toLowerCase())
  }
  return out
}

// 意味の薄い 2 文字 (助詞・語尾など)
const STOP2 = new Set(['して', 'しま', 'ます', 'です', 'くだ', 'ださ', 'さい', 'たい', 'ので', 'から', 'ある', 'いる', 'この', 'その', 'これ', 'それ', 'って', 'った', 'てる', 'ても', 'でき', 'きる', 'ない', 'なる', 'ため', 'よう', 'こと', 'もの', 'とき', 'には', 'では', 'とは', 'には', 'のは', 'ので', 'まし', 'した', 'する', 'すれ', 'れば', 'たら', 'だけ', 'まで', 'など', 'ほし', 'しい', 'おね', 'ねが', 'がい', 'いし', 'ちょ', 'ょっ', 'っと', 'てく', 'くれ', 'れる', 'れて', 'いて', 'いた', 'んで', 'んだ', 'なの', 'かな', 'でし', 'しょ', 'ょう', 'うか', 'すか', 'ませ', 'せん', 'ている', 'とか', 'みた', 'てみ', 'てほ'])

export function tokens(s) {
  const out = words(s)
  const n = normalize(s)
  const re = /[\u3040-\u30ff\u4e00-\u9fff\u3005]+/g
  let m
  while ((m = re.exec(n))) {
    const r = m[0]
    if (r.length === 1) { if (/[\u4e00-\u9fff]/.test(r)) out.push(r); continue }
    for (let i = 0; i + 1 < r.length; i++) {
      const bg = r.slice(i, i + 2)
      if (!STOP2.has(bg)) out.push(bg)
    }
    // 漢字 1 文字も (「剣」「床」のような 1 文字の語のため)
    for (const ch of r) if (/[\u4e00-\u9fff]/.test(ch)) out.push(ch)
  }
  return out
}

// ============================================================
// 概念 (同じ意味の言い方をまとめる)
// ============================================================
// 英字の言い方は単語の区切りで、日本語の言い方は部分一致で探します
export const CONCEPTS = {
  // ---- 入出力 ----
  print: ['表示', '出力', 'print', 'プリント', '画面に出', '書き出'],
  input: ['入力', 'input', 'キーボードから', '打ち込', '聞いて', 'ユーザーに聞', '受け取'],
  file: ['ファイル', 'file', 'open', '読み込', '書き込', '保存', 'テキストファイル', 'txt', 'with open'],
  csv: ['csv', '表計算', 'エクセル', 'excel', 'スプレッドシート'],
  json: ['json', 'ジェイソン'],
  // ---- データ ----
  variable: ['変数', 'variable', '代入', 'グローバル', 'global', 'スコープ', 'scope'],
  number: ['数値', '数字', 'number', '整数', '小数', 'int', 'float', '計算', '四則', '足し算', '引き算', '掛け算', '割り算', '余り', '割った余り', '累乗', '四捨五入', '切り捨て', '切り上げ'],
  string: ['文字列', 'string', 'str', '文字', 'テキスト', '連結', 'f-string', 'f文字列', 'フォーマット', '大文字', '小文字', '置き換え', '分割', 'split', 'join'],
  list: ['リスト', 'list', '配列', 'array', 'append', '要素', 'スライス', 'slice'],
  dict: ['辞書', 'dict', 'dictionary', 'ディクショナリ', 'キーと値', '連想配列', 'マップ', 'keys', 'items'],
  set: ['集合', 'set', '重複を', '重複なし', 'ユニーク'],
  tuple: ['タプル', 'tuple'],
  bool: ['真偽', 'true', 'false', 'bool', 'ブール', 'none'],
  sort: ['並べ替え', 'ならべかえ', 'ソート', 'sort', 'sorted', '順番に', '昇順', '降順', '大きい順', '小さい順', '順位', 'ランキング'],
  sum: ['合計', '足す', '総和', 'sum', '平均', 'average', 'mean', '最大', '最小', 'max', 'min', '集計'],
  count: ['数える', '数え', 'カウント', 'count', '何回', '出現', '頻度', 'counter'],
  // ---- 文法 ----
  ifStmt: ['if文', 'if 文', '条件分岐', '条件', 'if', 'elif', 'else', 'もし', '場合'],
  loop: ['for文', 'for 文', 'while', 'ループ', '繰り返', 'くり返', 'for', 'range', '回くり返', '回繰り返', 'ずっと'],
  func: ['関数', 'function', 'def', 'ファンクション', '引数', 'return', '戻り値', '返り値'],
  classKw: ['クラス', 'class', 'オブジェクト', 'object', 'インスタンス', 'instance', '継承', 'メソッド', 'method', 'self', '__init__', 'コンストラクタ', 'オブジェクト指向', 'dataclass', 'データクラス'],
  module: ['モジュール', 'module', 'import', 'インポート', 'ライブラリ', 'パッケージ', '別のファイル', '複数のファイル', '__name__'],
  exception: ['例外', 'エラー処理', 'try', 'except', 'raise', 'finally', 'エラーにならない', '例外処理'],
  comprehension: ['内包表記', '内包', 'comprehension'],
  lambda: ['lambda', 'ラムダ', '無名関数'],
  generator: ['ジェネレーター', 'ジェネレータ', 'generator', 'yield', 'イテレーター', 'iterator'],
  decorator: ['デコレーター', 'デコレータ', 'decorator', '@'],
  typehint: ['型ヒント', '型注釈', 'type hint', 'typing', 'アノテーション'],
  recursion: ['再帰', 'recursion', '自分自身を呼'],
  regex: ['正規表現', 'regex', 're.', 'パターン', 'マッチ'],
  // ---- よく使うライブラリ ----
  random: ['ランダム', 'random', '乱数', 'くじ', 'サイコロ', 'さいころ', 'ダイス', 'シャッフル', 'shuffle', 'choice', '抽選', 'おみくじ'],
  math: ['math', '数学', '平方根', 'ルート', 'sqrt', '円周率', 'pi', '三角関数', 'sin', 'cos', '対数', 'log'],
  time: ['time', '時間', '秒', 'タイマー', 'timer', 'sleep', '待つ', '待って', 'カウントダウン', 'ストップウォッチ', '時計'],
  datetime: ['datetime', '日付', '今日', '何日', '曜日', '年齢', '誕生日', '時刻', '現在時刻', 'カレンダー', 'calendar'],
  plot: ['グラフ', 'graph', 'plot', 'matplotlib', 'プロット', '棒グラフ', '折れ線', '円グラフ', '散布図', 'ヒストグラム', '図', 'チャート', 'chart'],
  numpy: ['numpy', 'ナンパイ', '行列', 'ベクトル', 'ndarray'],
  pandas: ['pandas', 'パンダス', 'データフレーム', 'dataframe', 'データ分析', '分析'],
  statistics: ['統計', 'statistics', '中央値', 'median', '標準偏差', '分散', '最頻値'],
  // ---- 作るもの ----
  game: ['ゲーム', 'game', '遊べ', 'あそべ'],
  guess: ['数当て', '数あて', '当てる', 'あてる', '当てゲーム', 'ハイアンドロー', 'high and low', '推測'],
  janken: ['じゃんけん', 'ジャンケン', 'rock paper', 'グーチョキパー'],
  quiz: ['クイズ', 'quiz', '問題を出', '問題集', 'テスト問題', '正解'],
  tictactoe: ['三目並べ', 'まるばつ', '〇×', 'マルバツ', 'tic tac toe', 'tictactoe', 'tic-tac-toe'],
  hangman: ['ハングマン', 'hangman', '単語当て'],
  calculator: ['電卓', '計算機', 'calculator', '計算する'],
  todo: ['todo', 'やること', 'タスク管理', 'タスク', 'メモ帳', 'to do', 'to-do'],
  kakeibo: ['家計簿', 'お小遣い', 'おこづかい', '出費', '支出', '収入', '残高'],
  grades: ['成績', '点数', 'テストの点', '平均点', '通知表', '偏差値'],
  wordbook: ['単語帳', '暗記', 'フラッシュカード', '英単語'],
  fizzbuzz: ['fizzbuzz', 'fizz buzz', 'フィズバズ'],
  prime: ['素数', 'prime'],
  fibonacci: ['フィボナッチ', 'fibonacci'],
  factorial: ['階乗', 'factorial'],
  multiplication: ['九九', 'くく', '掛け算表', 'かけ算表', '掛け算の表'],
  leap: ['うるう年', '閏年', 'leap year'],
  bmi: ['bmi', '肥満度', '体重', '身長'],
  temperature: ['温度', '摂氏', '華氏', 'celsius', 'fahrenheit'],
  tax: ['消費税', '税込', '税抜', '割引', '値引き', 'セール', '割り勘', 'わりかん', 'おつり', 'お釣り'],
  password: ['パスワード', 'password', '暗証'],
  palindrome: ['回文', 'palindrome'],
  gcd: ['最大公約数', '最小公倍数', 'gcd', 'lcm'],
  wordcount: ['文字数', '単語数', '何文字', '出現回数', '単語の数'],
  unittest: ['テストを書', 'ユニットテスト', 'unittest', 'pytest', 'テストコード', 'assert'],
  // ---- アプリ ----
  debug: ['デバッグ', 'ブレークポイント', 'breakpoint', 'ステップ実行', 'debugger', '止めて', '変数の中身'],
}

// 概念ごとの判定 (英字は単語境界で、それ以外は部分一致で)
const CONCEPT_MATCHERS = Object.entries(CONCEPTS).map(([id, forms]) => {
  const ascii = [], jp = []
  for (const f of forms) {
    const n = normalize(f)
    if (/^[\x20-\x7e]+$/.test(n)) ascii.push(n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/ /g, '\\s*'))
    else jp.push(n)
  }
  const re = ascii.length ? new RegExp(`(?:^|[^a-z0-9_])(?:${ascii.join('|')})(?![a-z0-9_])`) : null
  return { id, re, jp }
})

export function concepts(s) {
  const n = normalize(s)
  const found = new Set()
  for (const c of CONCEPT_MATCHERS) {
    if (c.re && c.re.test(n)) { found.add(c.id); continue }
    for (const f of c.jp) if (n.includes(f)) { found.add(c.id); break }
  }
  return found
}

// ============================================================
// 依頼の種類
// ============================================================
// [種類, 正規表現 (正規化後の文に対して), 点数]
const INTENT_RULES = [
  ['greet', /^(こんにちは|こんばんは|おはよう|はじめまして|やあ|hello|hi|hey|よろしく)[!！。、\s]*$/, 6],
  ['thanks', /(ありがと|thanks|thank you|さんきゅ|助かった|たすかった|完璧|いいね|最高)/, 3],
  ['help', /(何ができ|なにができ|できること|^使い方を?教えて|^使い方$|ヘルプ|^help$|機能一覧|どんなことができ|あなたは(誰|だれ|何)|君は(誰|何))/, 4],
  ['explain', /(説明|解説|何をして|なにをして|何して|なにして|どういう(意味|こと|処理|動き)|どんな処理|読み解|わから|分から|理解|explain|what does|walk me through)/, 3],
  ['fix', /(直して|なおして|直す|なおす|修正|治して|バグ|ばぐ|動かない|うごかない|動きません|うまくいかない|おかしい|効かない|反応しない|直らない|fix|debug|not working|doesn'?t work|broken)/, 3],
  ['format', /(整形|インデント|字下げ|フォーマット|format|indent)/, 4],
  ['tidy', /(整理|リファクタ|りふぁくた|きれいに|綺麗に|キレイに|読みやすく|見やすく|refactor|clean ?up|tidy|モダン|最新の書き方|新しい書き方|古い書き方|非推奨)/, 3],
  ['comment', /(コメント|comment)/, 4],
  ['types', /(型注釈|型ヒント|型を(付|つ)け|型を書|type ?hint|type annotation)/, 4],
  ['optimize', /(最適化|速く|はやく|軽く|かるく|高速化|重い|おもい|ラグ|カクカク|パフォーマンス|optimi[sz]e|faster|performance|lag)/, 3],
  ['review', /(チェック|ちぇっく|レビュー|確認して|見て|みて|問題(は|が)(ある|ない)|おかしいところ|改善点|ダメなところ|review|check)/, 2],
  ['run', /(実行して|動かして|試して|ためして|走らせ|run (it|this|the)|^実行$|^run$)/, 3],
  ['rename', /(名前を?(変え|変更|かえ)|リネーム|rename)/, 3],
  ['generate', /(作って|つくって|作れ|つくれ|作成|作りたい|つくりたい|書いて|かいて|生成|欲しい|ほしい|実装|追加して|入れて|できるように|ようにして|make|create|write|generate|build|add a)/, 3],
  ['question', /(とは|ってなに|って何|ってなん|どうやって|どうすれば|どうしたら|どうやる|方法|やり方|使い方|違い|ちがい|なぜ|なんで|何で|どこ|いつ|教えて|おしえて|知りたい|わかる\?|[?？]$|\bhow\b|\bwhat\b|\bwhy\b|\bwhen\b|\bwhich\b|difference)/, 2],
  ['undo', /(元に戻して|もとに戻して|取り消して|やっぱりやめ|undo|revert)/, 4],
  ['more', /^(もっと|さらに|続けて|つづけて|他には|ほかには|続き)/, 2],
]
// 実行時エラーの文によくある言い回し
const ERROR_RE = /(Traceback \(most recent call last\)|\b[A-Z]\w*(Error|Exception): |File "[^"]+", line \d+|SyntaxError|IndentationError|NameError|TypeError|ValueError|IndexError|KeyError|AttributeError|ZeroDivisionError|ModuleNotFoundError|構文エラー|invalid syntax|is not defined)/

export function detectIntents(text) {
  const n = normalize(text)
  const scores = {}
  for (const [id, re, w] of INTENT_RULES) if (re.test(n)) scores[id] = (scores[id] || 0) + w
  if (ERROR_RE.test(text)) scores.error = 3
  // 「〜を作って」でも、説明・修正の語が先なら優先 (例:「このバグを直して」)
  if (scores.fix && scores.generate && /(直|修正|バグ|fix)/.test(n) && !/(新しく|新規)/.test(n)) scores.generate -= 1.5
  if (scores.question && scores.generate && /(作り方|作るには|どうやって作)/.test(n)) { scores.question += 1; scores.generate -= 1 }
  if (scores.explain && scores.question) scores.question -= 0.5
  return Object.entries(scores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, score]) => ({ id, score }))
}

// ============================================================
// 値の取り出し
// ============================================================
const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 半: 0.5 }
function kanjiNumber(s) {
  if (/^[0-9.]+$/.test(s)) return Number(s)
  let total = 0, cur = 0
  for (const ch of s) {
    const v = KANJI_NUM[ch]
    if (v === undefined) return NaN
    if (v === 10 || v === 100) { total += (cur || 1) * v; cur = 0 } else cur = v
  }
  return total + cur
}

export const KEY_NAMES = {
  shift: 'LeftShift', leftshift: 'LeftShift', rightshift: 'RightShift', ctrl: 'LeftControl', control: 'LeftControl', alt: 'LeftAlt',
  space: 'Space', スペース: 'Space', enter: 'Return', return: 'Return', エンター: 'Return', tab: 'Tab', backspace: 'Backspace', escape: 'Escape', esc: 'Escape',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', 上: 'Up', 下: 'Down', 左: 'Left', 右: 'Right',
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5', f6: 'F6', f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10',
}
const DIGIT_KEYS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

export const COLOR_NAMES = [
  [['赤', 'あか', 'red', 'レッド'], [255, 60, 60], 'Really red'],
  [['青', 'あお', 'blue', 'ブルー'], [60, 120, 255], 'Really blue'],
  [['緑', 'みどり', 'green', 'グリーン'], [60, 200, 90], 'Lime green'],
  [['黄', 'きいろ', 'yellow', 'イエロー'], [255, 220, 50], 'New Yeller'],
  [['白', 'しろ', 'white', 'ホワイト'], [255, 255, 255], 'Institutional white'],
  [['黒', 'くろ', 'black', 'ブラック'], [20, 20, 20], 'Really black'],
  [['紫', 'むらさき', 'purple', 'パープル'], [160, 80, 255], 'Royal purple'],
  [['橙', 'オレンジ', 'orange'], [255, 150, 40], 'Deep orange'],
  [['ピンク', 'もも色', 'pink'], [255, 120, 200], 'Hot pink'],
  [['水色', 'みずいろ', 'cyan', 'シアン'], [80, 220, 255], 'Cyan'],
  [['灰色', 'グレー', 'gray', 'grey'], [140, 140, 140], 'Medium stone grey'],
  [['金色', 'ゴールド', 'gold'], [255, 200, 40], 'Gold'],
]

export function slots(text) {
  const raw = String(text || '').normalize('NFKC')
  const n = normalize(raw)
  const out = { numbers: [], seconds: null, times: null, percent: null, multiplier: null, keys: [], colors: [], names: [], quoted: [], files: [], identifiers: [] }
  // 数値 (単位つき)
  const numRe = /(\d+(?:\.\d+)?|[一二三四五六七八九十百半]+)\s*(秒|びょう|s\b|sec|分|ふん|回|かい|倍|ばい|%|パーセント|個|こ|人|つ|円|点|歳|日|行|文字|桁)?/g
  let m
  while ((m = numRe.exec(n))) {
    const v = kanjiNumber(m[1])
    if (!isFinite(v)) continue
    const unit = m[2] || ''
    out.numbers.push({ v, unit, at: m.index })
    if (/^(秒|びょう|s|sec)$/.test(unit) && out.seconds === null) out.seconds = v
    else if (/^(分|ふん)$/.test(unit) && out.seconds === null) out.seconds = v * 60
    else if (/^(回|かい)$/.test(unit) && out.times === null) out.times = v
    else if (/^(倍|ばい)$/.test(unit) && out.multiplier === null) out.multiplier = v
    else if (/^(%|パーセント)$/.test(unit) && out.percent === null) out.percent = v
  }
  // キー:「E キー」「Eを押す」「key E」「Shift」
  const keyRe = /(?:^|[^a-z0-9])([a-z]|[0-9]|f[0-9]{1,2}|shift|leftshift|rightshift|ctrl|control|alt|space|enter|return|tab|backspace|esc|escape|up|down|left|right)\s*(?:キー|key|を押|をおし|で|押し|ボタン)/g
  while ((m = keyRe.exec(n))) addKey(out, m[1])
  const keyRe2 = /(?:key|キー)\s*(?:は|を|:|=)?\s*([a-z]|shift|ctrl|space|enter|tab|f[0-9]{1,2})(?![a-z])/g
  while ((m = keyRe2.exec(n))) addKey(out, m[1])
  for (const [jp, k] of [['スペース', 'Space'], ['エンター', 'Return'], ['シフト', 'LeftShift'], ['左クリック', 'MouseButton1'], ['右クリック', 'MouseButton2']]) if (n.includes(normalize(jp)) && !out.keys.includes(k)) out.keys.push(k)
  // 色
  for (const [forms, rgb, brick] of COLOR_NAMES) {
    for (const f of forms) {
      const nf = normalize(f)
      const ok = /^[a-z]+$/.test(nf) ? new RegExp(`(^|[^a-z])${nf}([^a-z]|$)`).test(n) : n.includes(nf)
      if (ok) { out.colors.push({ rgb, brick, name: forms[0] }); break }
    }
  }
  if (n.includes('虹') || /rainbow/.test(n)) out.colors.push({ rainbow: true, name: '虹色' })
  // 「」や "" で囲んだ名前
  const qre = /[「『"'`]([^」』"'`\n]{1,60})[」』"'`]/g
  while ((m = qre.exec(raw))) out.quoted.push(m[1].trim())
  // ファイル名
  const fre = /([\w\-./]+\.(?:py|txt|csv|json|md))\b/gi
  while ((m = fre.exec(raw))) out.files.push(m[1])
  // 識別子らしい英単語 (大文字を含む・ドット区切りなど)
  const ire = /[A-Za-z_][\w]*(?:[.:][A-Za-z_]\w*)*/g
  while ((m = ire.exec(raw))) if (/[A-Z]/.test(m[0]) || /[.:_]/.test(m[0]) || m[0].length >= 3) out.identifiers.push(m[0])
  return out
}
function addKey(out, k) {
  k = k.toLowerCase()
  let code
  if (/^[a-z]$/.test(k)) code = k.toUpperCase()
  else if (/^[0-9]$/.test(k)) code = DIGIT_KEYS[+k]
  else code = KEY_NAMES[k]
  if (code && !out.keys.includes(code)) out.keys.push(code)
}

// ============================================================
// BM25 検索
// ============================================================
export class Bm25 {
  constructor(docs, { k1 = 1.4, b = 0.7 } = {}) {
    // docs: [{ id, fields: [[text, weight], ...] }]
    this.k1 = k1; this.b = b
    this.docs = []
    this.df = new Map()
    let total = 0
    for (const d of docs) {
      const tf = new Map()
      let len = 0
      for (const [text, w] of d.fields) {
        for (const t of tokens(text)) { tf.set(t, (tf.get(t) || 0) + w); len += w }
      }
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1)
      this.docs.push({ id: d.id, tf, len, ref: d.ref })
      total += len
    }
    this.avg = total / Math.max(1, this.docs.length)
    this.N = this.docs.length
  }
  idf(t) {
    const df = this.df.get(t) || 0
    return Math.log(1 + (this.N - df + 0.5) / (df + 0.5))
  }
  search(query, limit = 5, boost = null) {
    const q = [...new Set(tokens(query))]
    const res = []
    for (const d of this.docs) {
      let s = 0
      for (const t of q) {
        const f = d.tf.get(t)
        if (!f) continue
        s += this.idf(t) * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * d.len / this.avg))
      }
      if (boost) s += boost(d) || 0
      if (s > 0) res.push({ id: d.id, score: s, ref: d.ref })
    }
    return res.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

// 「〜して、〜して」のような複数の依頼を分ける (最大 3 つ)
export function splitRequests(text) {
  const parts = String(text).split(/(?:。|\n|、そして|、それと|、あと|それから|そのあと|and then)/).map(s => s.trim()).filter(s => s.length > 1)
  return parts.length > 1 && parts.length <= 3 ? parts : [String(text).trim()]
}

// 文がコードを含むか (貼り付けられたコード)
export { extractCode } from './pycode.js'

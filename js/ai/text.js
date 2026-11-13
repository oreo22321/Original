// Forge AI: ことばの理解 (日本語・英語)
// ・normalize: 全角/半角・大文字/小文字の違いをそろえる
// ・tokens: 検索用の語 (英単語 + camelCase の分割 + 日本語の 2 文字ずつ)
// ・concepts: 同じ意味の言い方 (「速さ」「スピード」「WalkSpeed」…) を 1 つの概念にまとめて見つける
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
  // ---- きっかけ ----
  touch: ['触れ', 'ふれ', '触っ', 'さわ', '触る', '踏', '当たっ', 'あたっ', '当たる', 'ぶつか', 'touch', 'touched', 'collide'],
  click: ['クリック', 'click', 'clickdetector', 'タップ', 'tap'],
  prompt: ['プロンプト', 'proximityprompt', '近づいて', '近くで', '長押し'],
  key: ['キーを押', 'キーで', 'キー入力', 'キーボード', 'を押すと', 'を押したら', 'を押して', 'keybind', 'userinputservice', 'inputbegan', 'shift', 'ctrl', 'スペースキー'],
  button: ['ボタン', 'button', 'textbutton', 'imagebutton'],
  chat: ['チャット', 'chat', 'chatted', 'チャットコマンド', 'command'],
  timer: ['秒ごと', '秒おき', '毎秒', '定期的', '繰り返し', 'ずっと', '一定時間ごと', 'every', 'loop', 'ループ'],
  join: ['参加', '入ってき', '入った', 'join', 'playeradded', 'ログイン', '入室'],
  spawnEv: ['リスポーン', 'スポーンした', 'characteradded', '生き返'],
  die: ['死んだら', '死んだとき', '倒れたら', 'died', '死亡時'],
  // ---- 動作 ----
  kill: ['死ぬ', '死なせ', '殺', '即死', 'キル', 'kill', '倒す', 'killbrick', 'デスブロック', '溶岩', 'ようがん', 'lava'],
  damage: ['ダメージ', 'damage', 'takedamage', '痛い', '減らす', '攻撃'],
  heal: ['回復', 'ヒール', 'heal', '体力を戻', '体力を増'],
  health: ['体力', 'hp', 'health', 'ヘルス', 'ライフ'],
  speed: ['速さ', '速度', 'スピード', 'speed', 'walkspeed', '足を速く', '走る速さ', '速く走', '移動速度', '速く歩', '早く歩', '歩く速', '足が速'],
  sprint: ['ダッシュ', '走る', 'sprint', '走れる', '走り'],
  jump: ['ジャンプ', 'jump', 'jumppower', 'jumpheight', '跳'],
  doubleJump: ['二段ジャンプ', '2段ジャンプ', 'ダブルジャンプ', 'double jump', 'doublejump', '空中ジャンプ'],
  teleport: ['テレポート', '瞬間移動', 'ワープ', 'teleport', 'tp', '移動させ'],
  color: ['色', 'いろ', 'カラー', 'color', 'colour', 'brickcolor', '虹'],
  disappear: ['消える', '消えて', '消す', '透明', 'なくな', 'disappear', 'vanish', 'invisible', 'fade'],
  destroy: ['削除', '壊れ', '壊す', 'destroy', '破壊'],
  coin: ['コイン', 'お金', 'coin', 'money', 'cash', 'ゴールド', 'gold', '通貨'],
  points: ['ポイント', 'point', 'スコア', 'score', 'キル数'],
  sound: ['音', 'サウンド', 'sound', '効果音', 'bgm', '音楽', 'music'],
  explode: ['爆発', 'explosion', 'explode', '爆弾', 'bomb'],
  light: ['ライト', '照明', 'light', '光', '明かり', 'pointlight'],
  message: ['メッセージ', '表示', 'print', '出力', 'お知らせ', '通知', 'notification', 'notify'],
  spawnPart: ['降ってく', '降る', '落ちてく', '雨', '出現', '生成', 'スポナー', 'spawner', '湧'],
  give: ['あげる', '与え', 'もらえ', '渡す', 'give', 'award', '付与'],
  // ---- もの ----
  part: ['パーツ', 'ブロック', '床', '壁', 'part', 'brick', 'block', 'パート', '足場'],
  door: ['ドア', '扉', 'とびら', 'door', 'gate', 'ゲート'],
  platform: ['動く床', '往復', '移動する床', 'moving platform', 'エレベーター', 'elevator', 'リフト'],
  spin: ['回転', '回る', 'まわる', 'spin', 'rotate', 'くるくる'],
  leaderstats: ['リーダーボード', 'リーダースタッツ', 'leaderstats', 'leaderboard', 'ランキング', 'スコアボード', 'ステータス'],
  datastore: ['データストア', 'datastore', 'セーブ', '保存', 'ロード', '読み込', 'save', 'load', 'データを残', '記録'],
  gui: ['gui', 'ui', '画面', 'メニュー', 'ウィンドウ', 'window', 'frame', 'フレーム', 'screengui', 'hud', 'インターフェース', 'パネル'],
  shop: ['ショップ', '店', 'shop', 'store', '購入', '買う', 'buy', '商品'],
  label: ['ラベル', 'テキスト', 'textlabel', '文字を表示', 'label'],
  checkpoint: ['チェックポイント', 'checkpoint', 'セーブポイント', '中間地点', 'リスポーン地点'],
  daynight: ['昼夜', '昼と夜', '時間帯', 'day night', 'daynight', 'clocktime', '朝昼夜', '時刻'],
  countdown: ['カウントダウン', 'countdown', 'タイマー', 'timer', '制限時間', '残り時間', 'ストップウォッチ'],
  round: ['ラウンド', 'round', 'ゲームループ', 'intermission', '試合'],
  npc: ['npc', 'ノンプレイヤー', '敵', 'ゾンビ', 'zombie', 'モンスター', 'enemy', 'ついてくる', '追いかけ', 'follow', 'pathfinding', '経路'],
  tool: ['ツール', 'tool', '剣', 'sword', '武器', 'weapon', '銃', 'gun'],
  remote: ['リモート', 'remoteevent', 'remotefunction', 'remote', 'サーバーに送', 'クライアントに送', '通信', 'fireserver', 'fireclient', 'onserverevent'],
  module: ['モジュール', 'module', 'modulescript', 'require', 'クラス', 'class', 'oop', 'オブジェクト指向'],
  tween: ['トゥイーン', 'tween', 'tweenservice', 'アニメーション', 'なめらか', '滑らか', 'ふわっと', 'スムーズ'],
  animation: ['アニメーション', 'animation', 'animator', 'loadanimation', 'モーション', 'ダンス', 'emote', 'エモート'],
  camera: ['カメラ', 'camera', '視点'],
  raycast: ['レイキャスト', 'raycast', 'レイ', '光線', '視線'],
  cframe: ['cframe', '向き', '回転させ', '位置と向き', 'lookat'],
  vector: ['vector3', 'ベクトル', '座標', '位置', 'position'],
  input: ['userinputservice', 'contextactionservice', '入力', 'input', 'マウス', 'mouse', 'タッチ操作'],
  runservice: ['runservice', 'heartbeat', 'renderstepped', 'stepped', '毎フレーム', 'フレームごと'],
  players: ['プレイヤー', 'player', 'players', 'localplayer', 'ユーザー', '自分'],
  character: ['キャラクター', 'キャラ', 'character', 'humanoid', 'ヒューマノイド', 'アバター', 'humanoidrootpart'],
  team: ['チーム', 'team', 'teams'],
  badge: ['バッジ', 'badge', 'ゲームパス', 'gamepass', '課金', 'devproduct', 'marketplace', 'robux'],
  physics: ['物理', 'physics', 'anchored', 'cancollide', '重力', 'gravity', 'velocity', '速度ベクトル', '吹き飛', 'ノックバック', 'knockback'],
  attribute: ['属性', 'attribute', 'setattribute', 'getattribute'],
  tag: ['タグ', 'collectionservice', 'tag', 'addtag', 'hastag'],
  workspaceKw: ['workspace', 'ワークスペース'],
  esp: ['esp', 'ハイライト', 'highlight', '透視', '壁越し', '名前を表示'],
  drawing: ['drawing', 'ドローイング', '描画'],
  fly: ['飛ぶ', '飛べる', '空を飛', 'fly', 'フライ'],
  noclip: ['noclip', 'ノークリップ', '壁抜け', 'すり抜け'],
  infJump: ['無限ジャンプ', 'infinite jump', 'infjump', '何回でもジャンプ'],
  executorKw: ['エグゼキューター', 'executor', 'エクスプロイト', 'exploit', 'getgenv', 'loadstring', 'httpget', 'gethui', 'syn'],
  uiLib: ['uiライブラリ', 'ui library', 'rayfield', 'orion', 'fluent', 'obsidian', 'kavo', 'linoria', 'wally'],
  // ---- Luau の文法 ----
  variable: ['変数', 'variable', 'local', 'ローカル', 'グローバル', 'global', 'スコープ', 'scope'],
  ifStmt: ['if文', 'if 文', '条件分岐', '条件', 'if', 'elseif', 'もし'],
  loop: ['for文', 'for 文', 'while', 'repeat', 'ループ', '繰り返', 'for', 'ipairs', 'pairs'],
  func: ['関数', 'function', 'ファンクション', '引数', 'return', '戻り値', 'メソッド'],
  table: ['テーブル', 'table', '配列', 'array', '辞書', 'dictionary', 'リスト', 'list', 'table.insert', '連想配列'],
  string: ['文字列', 'string', 'テキスト', 'string.format', '連結', '..', '補間'],
  number: ['数値', '数字', 'number', 'math', '計算', '乱数', 'ランダム', 'random', '四捨五入', '切り捨て'],
  wait: ['待つ', '待機', 'wait', 'task.wait', 'delay', '遅らせ', '何秒後', '秒後'],
  spawnTask: ['task.spawn', 'spawn', 'coroutine', 'コルーチン', '並列', '同時に'],
  pcall: ['pcall', 'エラー処理', '例外', 'xpcall', 'error', 'try'],
  metatable: ['メタテーブル', 'metatable', 'setmetatable', '__index'],
  types: ['型', 'type', '型注釈', 'typeof', '--!strict', 'strict'],
  event: ['イベント', 'event', 'connect', 'シグナル', 'signal', '接続', 'disconnect', 'bindableevent'],
  instance: ['instance', 'instance.new', 'インスタンス', 'オブジェクトを作', '親', 'parent', 'clone', '複製', 'findfirstchild', 'waitforchild', 'getchildren', '子'],
  service: ['サービス', 'getservice', 'service'],
  server: ['サーバー', 'server', 'serverscriptservice', 'script'],
  client: ['クライアント', 'client', 'localscript', 'ローカルスクリプト'],
  debug: ['デバッグ', 'ブレークポイント', 'breakpoint', 'ステップ実行', 'debugger'],
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
  ['types', /(型注釈|型を(付|つ)け|型を書|type annotation|--!strict)/, 4],
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
const ERROR_RE = /(attempt to (index|call|perform|compare|concatenate)|expected .* got|is not a valid member|infinite yield|stack overflow|nil value|syntax error|構文エラー|が必要です|unexpected symbol|attempt to|script timeout|exhausted|not a valid|invalid argument|bad argument|:\d+:)/i

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
  const numRe = /(\d+(?:\.\d+)?|[一二三四五六七八九十百半]+)\s*(秒|びょう|s\b|sec|分|ふん|回|かい|倍|ばい|%|パーセント|スタッド|studs?|個|こ|人|つ|コイン|ポイント|ダメージ|hp)?/g
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
  const fre = /([\w\-./]+\.(?:server\.|client\.)?luau?)\b/gi
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
export function extractCode(text) {
  const fence = /```(?:lua|luau)?\s*\n([\s\S]*?)```/i.exec(text)
  if (fence) return fence[1].replace(/\n$/, '')
  const lines = String(text).split('\n')
  const codeish = lines.filter(l => /^\s*(local |function |end\b|if .* then|for .* do|while .* do|return\b|--|[\w.:]+\(.*\)\s*$|[\w.]+\s*=\s*.+)/.test(l))
  if (lines.length >= 3 && codeish.length >= Math.max(2, lines.length * 0.6)) return text.trim()
  return null
}

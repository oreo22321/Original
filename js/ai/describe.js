// Forge AI: コードを日本語で説明する
// ・explainCode: ファイル (または選択範囲) の概要・流れ・注意点を Markdown で
// ・describeStat: 1 つの文を 1 文の日本語に (行ごとの説明・コメントの自動追加に使う)
// ・addComments: 関数・イベント接続・ループなどの上に説明コメントを入れる
// ・addTypes: 引数・戻り値の型を使われ方から推測して型注釈を付ける
import { parse } from '../luau/parser.js'
import { reviewCode } from './review.js'

// ============================================================
// 部品
// ============================================================
const SIGNALS = {
  Touched: '何かが触れた', TouchEnded: '触れていたものが離れた', MouseClick: 'クリックされた', RightMouseClick: '右クリックされた',
  Activated: 'ボタンが押された', MouseButton1Click: 'ボタンがクリックされた', MouseButton1Down: 'ボタンが押し下げられた', MouseEnter: 'マウスが乗った', MouseLeave: 'マウスが離れた',
  Triggered: 'プロンプトが使われた', PromptTriggered: 'プロンプトが使われた', PlayerAdded: 'プレイヤーが参加した', PlayerRemoving: 'プレイヤーが退出する',
  CharacterAdded: 'キャラクターが出現した', CharacterRemoving: 'キャラクターが消える', Died: 'キャラクターが倒された', HealthChanged: '体力が変わった', Running: '走り始めた/止まった', Jumping: 'ジャンプした', StateChanged: '状態が変わった',
  Heartbeat: '毎フレーム (物理の後)', RenderStepped: '毎フレーム (描画の前)', Stepped: '毎フレーム (物理の前)', PreRender: '毎フレーム (描画の前)', PostSimulation: '毎フレーム (物理の後)',
  InputBegan: 'キー・マウス・タッチの入力が始まった', InputEnded: '入力が終わった', InputChanged: '入力が変わった', JumpRequest: 'ジャンプしようとした',
  OnServerEvent: 'クライアントから送られてきた', OnClientEvent: 'サーバーから送られてきた', Event: 'イベントが発生した',
  Changed: '値が変わった', Chatted: 'チャットした', Completed: '終わった', Ended: '鳴り終わった', Equipped: 'ツールを持った', Unequipped: 'ツールをしまった',
  ChildAdded: '子が追加された', ChildRemoved: '子が削除された', DescendantAdded: '子孫が追加された', FocusLost: '入力欄から離れた', MoveToFinished: '移動し終わった',
  AncestryChanged: '置き場所が変わった', Destroying: '削除される', Idled: '放置された',
}
const METHOD_VERBS = {
  Destroy: '削除する', Clone: '複製する', Play: '再生する', Stop: '止める', Pause: '一時停止する', TakeDamage: 'ダメージを与える', MoveTo: '移動させる', PivotTo: '移動させる',
  FireServer: 'サーバーに送る', FireClient: 'クライアントに送る', FireAllClients: '全員のクライアントに送る', InvokeServer: 'サーバーに問い合わせる', Fire: '通知する',
  GetAsync: 'データを読み込む', SetAsync: 'データを保存する', UpdateAsync: 'データを更新する', RemoveAsync: 'データを削除する', IncrementAsync: 'データを増やす',
  Kick: 'キックする', LoadAnimation: 'アニメーションを読み込む', Create: 'トゥイーンを作る', ClearAllChildren: '中身を全部消す', Disconnect: '接続を解除する',
  SetAttribute: '属性を設定する', GetAttribute: '属性を読む', AddItem: '時間で消えるように登録する', Raycast: 'レイキャストで当たりを調べる', Wait: '発生するまで待つ',
  JSONEncode: 'JSON 文字列にする', JSONDecode: 'JSON を読み取る', HttpGet: 'URL から読み込む', SetCore: '通知などを表示する', ApplyImpulse: '力を加える', BreakJoints: 'バラバラにする',
  GetPlayers: 'プレイヤー一覧を取る', GetChildren: '子の一覧を取る', GetDescendants: '子孫の一覧を取る', BindAction: '操作を登録する', UnbindAction: '操作の登録を解除する',
  AwardBadge: 'バッジを渡す', PromptGamePassPurchase: '購入画面を出す', SetPrimaryPartCFrame: '移動させる', ComputeAsync: '経路を計算する', Remove: '削除する',
}
const PROP_PHRASES = {
  Parent: v => (v === 'nil' ? 'から外す (消える)' : `を ${v} に置く`), Text: v => `の文字を ${v} にする`, Visible: v => (v === 'true' ? 'を表示する' : v === 'false' ? 'を隠す' : 'の表示/非表示を切り替える'),
  WalkSpeed: v => `の歩く速さを ${v} にする`, JumpPower: v => `のジャンプ力を ${v} にする`, JumpHeight: v => `のジャンプの高さを ${v} にする`, Health: v => (v === '0' ? 'の体力を 0 にする (倒す)' : `の体力を ${v} にする`), MaxHealth: v => `の最大体力を ${v} にする`,
  Position: () => 'の位置を変える', CFrame: () => 'の位置と向きを変える', Size: () => 'の大きさを変える', Color: () => 'の色を変える', BrickColor: () => 'の色を変える', BackgroundColor3: () => 'の背景色を変える', TextColor3: () => 'の文字色を変える',
  Transparency: v => (v === '1' ? 'を見えなくする' : v === '0' ? 'を見えるようにする' : `の透明度を ${v} にする`), Anchored: v => (v === 'true' ? 'を固定する' : 'の固定を外す'), CanCollide: v => (v === 'false' ? 'をすり抜けられるようにする' : 'に当たり判定を付ける'),
  Value: v => `の値を ${v} にする`, Name: v => `の名前を ${v} にする`, Material: () => 'の素材を変える', Enabled: v => (v === 'false' ? 'を無効にする' : 'を有効にする'), Velocity: () => 'の速度を変える', AssemblyLinearVelocity: () => 'の速度を変える',
  ClockTime: v => `の時刻を ${v} 時にする`, Brightness: v => `の明るさを ${v} にする`, Image: () => 'の画像を変える', SoundId: () => 'の音を設定する', AnimationId: () => 'のアニメーションを設定する', Volume: v => `の音量を ${v} にする`,
  CameraType: () => 'の種類を変える', FieldOfView: v => `の視野角を ${v} にする`, Gravity: v => `の重力を ${v} にする`, RespawnLocation: () => 'の復活地点を変える', Team: () => 'のチームを変える',
}
const FN_WORDS = { get: '取得', set: '設定', create: '作成', make: '作成', build: '作成', update: '更新', refresh: '更新', on: '', handle: '処理', toggle: '切り替え', spawn: '出現', kill: '倒す', damage: 'ダメージ', heal: '回復', teleport: 'テレポート', save: '保存', load: '読み込み', give: '付与', add: '追加', remove: '削除', destroy: '削除', clear: '消去', reset: 'リセット', start: '開始', stop: '停止', open: '開く', close: '閉じる', show: '表示', hide: '隠す', check: '確認', is: '判定', has: '判定', can: '判定', calc: '計算', calculate: '計算', format: '整形', init: '初期化', setup: '準備', apply: '適用', play: '再生', buy: '購入', sell: '売却', fire: '発射', shoot: '発射', attack: '攻撃', jump: 'ジャンプ', run: '走る', move: '移動', touch: '触れたとき', touched: '触れたとき', click: 'クリック', clicked: 'クリック', player: 'プレイヤー', character: 'キャラクター', coin: 'コイン', coins: 'コイン', data: 'データ', ui: 'UI', gui: 'UI', button: 'ボタン', speed: '速さ', door: 'ドア', round: 'ラウンド', timer: 'タイマー', count: 'カウント', esp: 'ESP', target: '対象' }

const md = s => '`' + String(s).replace(/`/g, "'").slice(0, 60) + '`'
const keyOf = e => (e && e.t === 'Index' && e.key && e.key.t === 'String' ? e.key.v : null)
const strOf = e => (e && e.t === 'String' && typeof e.v === 'string' ? e.v : null)

export function makeDescriber(src) {
  const text = n => (n && n.s !== undefined && n.e !== undefined ? src.slice(n.s, n.e) : null)
  function chain(e) {
    if (!e) return '?'
    switch (e.t) {
      case 'Name': return e.name
      case 'Index': return e.dot ? `${chain(e.obj)}.${keyOf(e)}` : `${chain(e.obj)}[${short(e.key)}]`
      case 'Method': return `${chain(e.obj)}:${e.name}(${e.args.map(short).join(', ')})`
      case 'Call': return `${chain(e.fn)}(${e.args.map(short).join(', ')})`
      case 'Paren': return `(${short(e.e)})`
      default: return short(e)
    }
  }
  function short(e) {
    if (!e) return 'nil'
    switch (e.t) {
      case 'Number': return String(e.v)
      case 'String': return JSON.stringify(e.v.length > 30 ? e.v.slice(0, 30) + '…' : e.v)
      case 'True': return 'true'
      case 'False': return 'false'
      case 'Nil': return 'nil'
      case 'Vararg': return '...'
      case 'Func': return 'function'
      case 'Table': return e.items.length ? '{…}' : '{}'
      case 'Name': case 'Index': case 'Method': case 'Call': {
        const c = chain(e)
        return c.length > 48 ? c.slice(0, 46) + '…' : c
      }
      case 'Bin': return `${short(e.l)} ${e.op} ${short(e.r)}`
      case 'Un': return `${e.op === 'not' ? 'not ' : e.op}${short(e.e)}`
      case 'Paren': return `(${short(e.e)})`
      case 'Interp': return '`…`'
      case 'IfExpr': return 'if … then … else …'
      default: return '…'
    }
  }

  // 式 → 名詞句
  function noun(e) {
    if (!e) return 'nil'
    if (e.t === 'Method') {
      const a0 = strOf(e.args[0])
      if (e.name === 'GetService' && a0) return `${a0} サービス`
      if (e.name === 'WaitForChild' && a0) return `${md(chain(e.obj))} の中の ${a0} (出てくるまで待つ)`
      if (e.name === 'FindFirstChild' && a0) return `${md(chain(e.obj))} の中の ${a0} (なければ nil)`
      if (e.name === 'FindFirstChildOfClass' && a0) return `${md(chain(e.obj))} の中の ${a0}`
      if (e.name === 'GetPlayers') return '参加している全プレイヤー'
      if (e.name === 'GetChildren') return `${md(chain(e.obj))} の子の一覧`
      if (e.name === 'GetDescendants') return `${md(chain(e.obj))} の中身すべて`
      if (e.name === 'Clone') return `${md(chain(e.obj))} の複製`
      if (e.name === 'GetDataStore' && a0) return `データストア "${a0}"`
      if (e.name === 'GetAsync') return '保存されているデータ'
      if (e.name === 'Create') return 'トゥイーン (なめらかな変化)'
      if (e.name === 'LoadAnimation') return 'アニメーション'
      if (e.name === 'Raycast') return 'レイキャストの結果'
      if (e.name === 'GetMouse') return 'マウス'
      if (e.name === 'Wait') return `${SIGNALS[keyOf(e.obj)] ? SIGNALS[keyOf(e.obj)] + 'もの' : '発生した値'}`
      if (e.name === 'IsA' && a0) return `${a0} かどうか`
      if (e.name === 'HttpGet') return 'URL から読み込んだ文字列'
    }
    if (e.t === 'Call') {
      const f = e.fn
      const c = chain(f)
      const a0 = strOf(e.args[0])
      if (c === 'Instance.new' && a0) return `新しい ${a0}`
      if (c === 'Vector3.new') return `座標 (${e.args.map(short).join(', ')})`
      if (c === 'Vector2.new') return `2D の座標 (${e.args.map(short).join(', ')})`
      if (c === 'CFrame.new') return '位置と向き (CFrame)'
      if (/^Color3\.(fromRGB|new|fromHSV|fromHex)$/.test(c)) return `色 (${e.args.map(short).join(', ')})`
      if (/^UDim2\./.test(c)) return 'UI の位置・大きさ (UDim2)'
      if (c === 'TweenInfo.new') return `${e.args[0] ? short(e.args[0]) + ' 秒の' : ''}動き方の設定 (TweenInfo)`
      if (c === 'math.random') return e.args.length >= 2 ? `${short(e.args[0])}〜${short(e.args[1])} の乱数` : e.args.length === 1 ? `1〜${short(e.args[0])} の乱数` : '0〜1 の乱数'
      if (c === 'require') return `モジュール ${md(short(e.args[0]))}`
      if (c === 'tostring') return `${md(short(e.args[0]))} を文字にしたもの`
      if (c === 'tonumber') return `${md(short(e.args[0]))} を数値にしたもの`
      if (c === 'setmetatable') return 'メタテーブル付きのテーブル (オブジェクト)'
      if (c === 'loadstring') return '文字列から作った関数'
      if (c === 'Drawing.new' && a0) return `Drawing の ${a0}`
      if (c === 'string.format') return '書式に当てはめた文字列'
      if (c === 'os.clock' || c === 'tick' || c === 'os.time') return '現在の時刻'
      if (c === 'getgenv') return 'エグゼキューターの共有グローバル'
      if (c === 'pcall') return 'pcall の結果 (成功したか, 値)'
    }
    if (e.t === 'Index') {
      const k = keyOf(e)
      if (k === 'LocalPlayer') return '自分 (LocalPlayer)'
      if (k === 'Parent' && e.obj.t === 'Name' && e.obj.name === 'script') return 'このスクリプトが入っているもの (script.Parent)'
      if (k === 'Character') return `${md(chain(e.obj))} のキャラクター`
      if (k === 'Parent') return `${md(chain(e.obj))} の親`
      if (k === 'CurrentCamera') return 'カメラ'
    }
    if (e.t === 'Bin') {
      const ops = { '==': 'と等しい', '~=': 'と違う', '<': 'より小さい', '<=': '以下', '>': 'より大きい', '>=': '以上' }
      if (ops[e.op]) return `${md(short(e.l))} が ${md(short(e.r))} ${ops[e.op]}`
      if (e.op === 'and') return `${noun(e.l)} かつ ${noun(e.r)}`
      if (e.op === 'or' && e.r && (e.r.t === 'Method' || e.r.t === 'Call') && /Wait$|:Wait\(/.test(chain(e.r))) return `${noun(e.l)} (まだなければ出てくるまで待つ)`
      if (e.op === 'or') return `${noun(e.l)} または ${noun(e.r)}`
    }
    if (e.t === 'Un' && e.op === 'not') return `${noun(e.e)} ではない`
    if (e.t === 'Un' && e.op === '#') return `${md(short(e.e))} の長さ`
    if (e.t === 'Func') return '関数'
    if (e.t === 'Table') {
      if (!e.items.length) return '空のテーブル'
      if (e.items.every(it => it.k === 'pos')) return `${e.items.length} 個の値の配列`
      const keys = e.items.filter(it => it.k === 'named').map(it => it.key)
      return keys.length ? `${keys.slice(0, 4).join('・')}${keys.length > 4 ? ' など' : ''} を持つテーブル` : 'テーブル'
    }
    return md(short(e))
  }

  // 呼び出し → 動詞句 (「〜する」)
  function callPhrase(e) {
    if (e.t === 'Method') {
      const n = e.name
      const obj = md(chain(e.obj))
      if ((n === 'Connect' || n === 'Once') && e.args[0]) {
        const sig = keyOf(e.obj) || (e.obj.t === 'Method' && e.obj.name === 'GetPropertyChangedSignal' ? `${strOf(e.obj.args[0]) || '?'} が変わった` : null)
        const when = SIGNALS[sig] || (sig ? `${sig} が発生した` : 'イベントが発生した')
        const who = e.obj.t === 'Index' ? md(chain(e.obj.obj)) : obj
        const what = e.args[0].t === 'Func' ? funcSummary(e.args[0]) : `${md(short(e.args[0]))} を実行`
        return `${who} で${when}とき${/毎フレーム/.test(when) ? '' : ''}、${what}${n === 'Once' ? ' (1 回だけ)' : ''}`
      }
      if (n === 'TakeDamage') return `${obj} に ${short(e.args[0])} ダメージを与える`
      if (n === 'MoveTo') return `${obj} を ${noun(e.args[0])} へ移動させる`
      if (n === 'FireServer') return `サーバーに ${e.args.map(short).join(', ') || '合図'} を送る`
      if (n === 'FireClient') return `${md(short(e.args[0]))} のクライアントに ${e.args.slice(1).map(short).join(', ') || '合図'} を送る`
      if (n === 'FireAllClients') return `全員に ${e.args.map(short).join(', ') || '合図'} を送る`
      if (n === 'SetAsync') return `データ (${short(e.args[0])}) を保存する`
      if (n === 'Kick') return `${obj} をキックする`
      if (n === 'SetAttribute') return `${obj} の属性 ${short(e.args[0])} を ${short(e.args[1])} にする`
      if (n === 'AddItem') return `${md(short(e.args[0]))} を ${short(e.args[1])} 秒後に自動で消す`
      if (n === 'Play' && /tween/i.test(chain(e.obj))) return `トゥイーン ${obj} を再生する (なめらかに変化)`
      if (n === 'Create' && e.args.length >= 3) return `${md(short(e.args[0]))} をなめらかに変化させるトゥイーンを作る`
      if (n === 'SetCore') return `${short(e.args[0])} を表示する`
      if (n === 'PivotTo') return `${obj} を ${noun(e.args[0])} へ移動させる`
      if (n === 'Wait') return `${obj} が起きるまで待つ`
      if (METHOD_VERBS[n]) return `${obj} を${METHOD_VERBS[n].replace(/^(.*)する$/, '$1する')}`.replace(/をデータを/, 'の').replace(/を(サーバー|クライアント|全員)/, ' から$1')
      return `${obj} の ${n} を呼ぶ`
    }
    const c = chain(e.fn)
    const args = e.args
    if (c === 'print') return `${args.map(noun).join('、') || '空行'} を出力に表示する`
    if (c === 'warn') return `${args.map(noun).join('、')} を警告として表示する`
    if (c === 'error') return `エラーを起こして止める (${short(args[0])})`
    if (c === 'task.wait' || c === 'wait') return args.length ? `${short(args[0])} 秒待つ` : '1 フレーム待つ'
    if (c === 'task.spawn' || c === 'spawn' || c === 'coroutine.wrap') return `${args[0] && args[0].t === 'Func' ? funcSummary(args[0]) : md(short(args[0]))} を並行して実行する`
    if (c === 'task.delay' || c === 'delay') return `${short(args[0])} 秒後に ${args[1] && args[1].t === 'Func' ? funcSummary(args[1]) : md(short(args[1]))}`
    if (c === 'task.defer') return '今の処理の後で実行する'
    if (c === 'table.insert') return `${md(short(args[0]))} に ${noun(args[args.length - 1])} を追加する`
    if (c === 'table.remove') return `${md(short(args[0]))} から ${args[1] ? short(args[1]) + ' 番目' : '最後'} を取り除く`
    if (c === 'table.sort') return `${md(short(args[0]))} を並べ替える`
    if (c === 'table.clear') return `${md(short(args[0]))} を空にする`
    if (c === 'pcall' || c === 'xpcall') return `${args[0] && args[0].t === 'Func' ? funcSummary(args[0]) : md(short(args[0]))} をエラーから守って実行する`
    if (c === 'loadstring' || /^loadstring\(/.test(c)) return '文字列のコードを実行する'
    if (/^loadstring\(.*HttpGet/.test(c)) return 'URL から取ってきたコードを実行する'
    if (c === 'setmetatable') return `${md(short(args[0]))} にメタテーブルを設定する`
    if (c === 'assert') return `${noun(args[0])} でなければエラーにする`
    if (e.fn.t === 'Call' && /^loadstring/.test(chain(e.fn.fn))) return 'URL から取ってきたコードを実行する'
    return `${md(c.replace(/\(.*$/, ''))} を呼ぶ`
  }

  // 関数の要約 (中でしていることを 3〜4 個)
  function funcSummary(f, max = 4) {
    const acts = []
    const seen = new Set()
    const push = s => { if (s && !seen.has(s) && acts.length < 12) { seen.add(s); acts.push(s) } }
    const walk = (stats, depth) => {
      for (const st of stats) {
        if (!st) continue
        if (st.t === 'CallStat') {
          const c = st.call
          if (c.t === 'Method' && (c.name === 'Connect' || c.name === 'Once')) push(`${SIGNALS[keyOf(c.obj)] || 'イベントが起きた'}ときの処理を登録`)
          else push(shortVerb(c))
        } else if (st.t === 'Assign' && st.targets[0].t === 'Index' && PROP_PHRASES[keyOf(st.targets[0])]) push(`${PROP_NOUN[keyOf(st.targets[0])] || keyOf(st.targets[0])}を変える`)
        else if (st.t === 'Compound') push(`${st.target.t === 'Index' ? (PROP_NOUN[keyOf(st.target)] || keyOf(st.target)) : md(short(st.target))}を${st.op === '+' ? '増やす' : st.op === '-' ? '減らす' : '変える'}`)
        else if (st.t === 'Local') { for (const v of st.values) if (v && (v.t === 'Call' || v.t === 'Method')) { const s = shortVerb(v, true); if (s) push(s) } }
        else if (st.t === 'Return' && st.values.length && depth === 0) push(`${noun(st.values[0])} を返す`)
        if (depth < 2) {
          if (st.t === 'If') { for (const c of st.clauses) walk(c.body, depth + 1); if (st.orelse) walk(st.orelse, depth + 1) }
          else if (st.body && Array.isArray(st.body)) walk(st.body, depth + 1)
        }
      }
    }
    walk(f.body, 0)
    const list = acts.filter(Boolean).slice(0, max)
    if (!list.length) return f.body.length ? '処理をする' : '何もしない'
    return list.join('・') + (acts.length > max ? ' など' : '')
  }
  const PROP_NOUN = { Parent: '置き場所', Text: '文字', Visible: '表示', WalkSpeed: '歩く速さ', JumpPower: 'ジャンプ力', JumpHeight: 'ジャンプの高さ', Health: '体力', MaxHealth: '最大体力', Position: '位置', CFrame: '位置と向き', Size: '大きさ', Color: '色', BrickColor: '色', BackgroundColor3: '背景色', TextColor3: '文字色', Transparency: '透明度', Anchored: '固定', CanCollide: '当たり判定', Value: '値', Name: '名前', Material: '素材', Enabled: '有効/無効', ClockTime: '時刻', Velocity: '速度', AssemblyLinearVelocity: '速度', Image: '画像', Volume: '音量' }
  function shortVerb(c, quiet) {
    if (c.t === 'Method') {
      if (c.name === 'GetService' || c.name === 'WaitForChild' || c.name === 'FindFirstChild' || c.name === 'FindFirstChildOfClass') return quiet ? null : `${strOf(c.args[0]) || ''} を取得`
      if (METHOD_VERBS[c.name]) return METHOD_VERBS[c.name].replace(/する$/, '')
      return quiet ? null : `${c.name} を呼ぶ`
    }
    if (c.t !== 'Call') return null
    const n = chain(c.fn)
    if (n === 'print' || n === 'warn') return quiet ? null : '出力に表示'
    if (n === 'task.wait' || n === 'wait') return c.args.length ? `${short(c.args[0])} 秒待つ` : '少し待つ'
    if (n === 'Instance.new') return `${strOf(c.args[0]) || 'オブジェクト'} を作る`
    if (n === 'task.spawn' || n === 'spawn') return '並行して実行'
    if (n === 'task.delay') return `${short(c.args[0])} 秒後に実行`
    if (n === 'table.insert') return '一覧に追加'
    if (n === 'pcall') return 'エラーから守って実行'
    if (n === 'Drawing.new') return `Drawing の ${strOf(c.args[0]) || '図形'} を作る`
    if (/^math\.random/.test(n)) return quiet ? null : '乱数を作る'
    return quiet ? null : `${n.replace(/\(.*$/, '')} を呼ぶ`
  }

  function condPhrase(e) {
    if (!e) return '?'
    if (e.t === 'True') return 'ずっと'
    if (e.t === 'Paren') return condPhrase(e.e)
    if (e.t === 'Name' || e.t === 'Index') return `${md(short(e))} がある`
    if (e.t === 'Un' && e.op === 'not') {
      if (e.e.t === 'Name' || e.e.t === 'Index') return `${md(short(e.e))} がない`
      if (e.e.t === 'Method' && e.e.name === 'IsA') return `${md(chain(e.e.obj))} が ${strOf(e.e.args[0]) || '?'} ではない`
      return `${condPhrase(e.e)} ではない`
    }
    if (e.t === 'Bin' && (e.op === 'and' || e.op === 'or')) return `${condPhrase(e.l)} ${e.op === 'and' ? 'かつ' : 'または'} ${condPhrase(e.r)}`
    if (e.t === 'Method' && e.name === 'IsA') return `${md(chain(e.obj))} が ${strOf(e.args[0]) || '?'}`
    if (e.t === 'Method' && /^(FindFirstChild|FindFirstChildOfClass)$/.test(e.name)) return `${md(chain(e.obj))} の中に ${strOf(e.args[0]) || '?'} がある`
    return noun(e)
  }

  // 文 → 1 文
  function describeStat(st) {
    switch (st.t) {
      case 'Local': {
        const names = st.names.map(n => md(n.name)).join('、')
        const v = st.values[0]
        if (!v) return `変数 ${names} を用意する (中身は nil)`
        if (st.values.length === 1 && st.names.length > 1 && (v.t === 'Call' || v.t === 'Method')) return `${noun(v)} の結果を ${names} に受け取る`
        if (v.t === 'Method' && v.name === 'GetService') return `${strOf(v.args[0]) || 'サービス'} サービスを取得して ${names} に入れる`
        if (v.t === 'Func') return `関数 ${names}(${v.params.map(p => p.name).join(', ')}) を作る — ${funcSummary(v)}`
        return `${names} に ${noun(v)} を入れる`
      }
      case 'LocalFunction': case 'Function': {
        const f = st.func
        const name = st.t === 'LocalFunction' ? st.name.name : st.name
        const params = f.params.map(p => p.name).concat(f.isVararg ? ['...'] : []).join(', ')
        const label = nameHint(name)
        return `関数 ${md(`${name}(${params})`)} を定義する${label ? ` (${label})` : ''} — ${funcSummary(f)}`
      }
      case 'Assign': {
        const t = st.targets[0], v = st.values[0]
        if (st.targets.length > 1) return `${st.targets.map(x => md(short(x))).join('、')} に値を入れる`
        if (t.t === 'Index' && t.dot) {
          const k = keyOf(t)
          const val = v ? short(v) : 'nil'
          if (k === 'Visible' && v && v.t === 'Un' && v.op === 'not') return `${md(chain(t.obj))} の表示/非表示を切り替える`
          if (PROP_PHRASES[k]) return `${md(chain(t.obj))} ${PROP_PHRASES[k](val)}`
          if (v && v.t === 'Func') return `関数 ${md(chain(t))} を定義する — ${funcSummary(v)}`
          return `${md(chain(t))} を ${noun(v)} にする`
        }
        if (v && v.t === 'Func') return `関数 ${md(short(t))} を作る — ${funcSummary(v)}`
        return `${md(short(t))} を ${noun(v)} にする`
      }
      case 'Compound': {
        const ops = { '+': '足す', '-': '引く', '*': '掛ける', '/': '割る', '..': 'つなげる' }
        const tgt = st.target.t === 'Index' && PROP_NOUN[keyOf(st.target)] ? `${md(chain(st.target.obj))} の${PROP_NOUN[keyOf(st.target)]}` : md(short(st.target))
        return `${tgt} に ${noun(st.value)} を${ops[st.op] || '計算する'}`
      }
      case 'CallStat': return callPhrase(st.call)
      case 'If': {
        const c = st.clauses[0]
        let s = `もし ${condPhrase(c.cond)} なら、${bodyGist(c.body)}`
        if (st.clauses.length > 1) s += `。そうでなく ${condPhrase(st.clauses[1].cond)} なら、${bodyGist(st.clauses[1].body)}`
        if (st.clauses.length > 2) s += ` (ほかに ${st.clauses.length - 2} 通り)`
        if (st.orelse) s += `。どれでもなければ、${bodyGist(st.orelse)}`
        return s
      }
      case 'While': return st.cond && st.cond.t === 'True' ? `ずっとくり返す: ${bodyGist(st.body)}` : `${condPhrase(st.cond)} の間くり返す: ${bodyGist(st.body)}`
      case 'Repeat': return `${condPhrase(st.cond)} になるまでくり返す: ${bodyGist(st.body)}`
      case 'NumFor': return `${md(st.var.name)} を ${short(st.start)} から ${short(st.stop)} まで${st.step ? ` (${short(st.step)} ずつ)` : ''}変えながらくり返す: ${bodyGist(st.body)}`
      case 'GenFor': {
        const src0 = st.exprs[0]
        let what = noun(src0)
        if (src0 && src0.t === 'Call' && /^(i?pairs)$/.test(chain(src0.fn))) what = noun(src0.args[0])
        return `${what} を 1 つずつ (${st.vars.map(v => v.name).join(', ')}) 取り出してくり返す: ${bodyGist(st.body)}`
      }
      case 'Do': return `ブロックの中で: ${bodyGist(st.body)}`
      case 'Return': return st.values.length ? `${st.values.map(noun).join('、')} を返す` : 'ここで終わる (return)'
      case 'Break': return 'ループを抜ける'
      case 'Continue': return 'この回を飛ばして次の回へ'
      case 'TypeAlias': return `型 ${md(st.name)} を定義する`
      default: return ''
    }
  }
  function bodyGist(stats) {
    if (!stats || !stats.length) return '何もしない'
    const parts = []
    for (const st of stats.slice(0, 3)) {
      const d = describeStat(st)
      if (d) parts.push(d.replace(/ — .*$/, ''))
    }
    let s = parts.join(' → ')
    if (s.length > 160) s = s.slice(0, 158) + '…'
    return s + (stats.length > 3 ? ' …' : '')
  }
  function nameHint(name) {
    const ws = String(name).split(/[.:]/).pop().replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_]+/).filter(Boolean)
    const jp = ws.map(w => FN_WORDS[w]).filter(x => x !== undefined && x !== '')
    return jp.length >= 1 && jp.length >= ws.length - 1 ? jp.join('・') : ''
  }

  return { describeStat, funcSummary, noun, short, chain, callPhrase, text, nameHint }
}

// ============================================================
// ファイル全体・選択範囲の説明
// ============================================================
export function scriptKind(path, mode, src) {
  if (mode === 'executor') return 'エグゼキュータースクリプト (自分のクライアントで動く)'
  if (/\.server\.luau?$/i.test(path || '')) return 'Script (サーバー)'
  if (/\.client\.luau?$/i.test(path || '')) return 'LocalScript (クライアント)'
  if (/^return\b|\nreturn\s+[A-Za-z_]\w*\s*$/.test(src.trim().split('\n').slice(-1)[0] || '') && !/LocalPlayer/.test(src)) return 'ModuleScript (require で読み込む部品)'
  if (/LocalPlayer|UserInputService|PlayerGui|CurrentCamera|RenderStepped/.test(src)) return 'LocalScript (クライアント) と思われます'
  if (/PlayerAdded|DataStoreService|OnServerEvent|ServerStorage/.test(src)) return 'Script (サーバー) と思われます'
  return 'スクリプト'
}

export function explainCode(src, { path = '', mode = 'studio', from = null, to = null, lintProblems = [] } = {}) {
  let ast
  try { ast = parse(src) } catch (e) {
    return { ok: false, markdown: `このコードには構文エラーがあるため、まだ説明できません (${e.line ? e.line + ' 行目: ' : ''}${e.message})。「直して」と頼むと、先に自動で直します。` }
  }
  const D = makeDescriber(src)
  const lineOf = pos => src.slice(0, pos).split('\n').length
  const out = []
  if (from !== null && to !== null && to > from) {
    // 選択範囲: 行ごとに
    const a = lineOf(from), b = lineOf(to)
    out.push(`### ${a === b ? a + ' 行目' : `${a}〜${b} 行目`}の説明`)
    const items = []
    const walk = (stats, depth) => {
      for (const st of stats) {
        const end = st.endLine || (st.func && st.func.endLine) || st.line
        if (end < a || st.line > b) continue
        const d = D.describeStat(st)
        if (d) items.push(`${'  '.repeat(depth)}- **${st.line} 行目**: ${d}`)
        if (depth < 3) {
          const inner = st.t === 'If' ? [...st.clauses.flatMap(c => c.body), ...(st.orelse || [])] : st.func ? st.func.body : st.t === 'CallStat' && st.call.t === 'Method' && st.call.args[0] && st.call.args[0].t === 'Func' ? st.call.args[0].body : st.t === 'Local' && st.values[0] && st.values[0].t === 'Func' ? st.values[0].body : st.body
          if (Array.isArray(inner) && end > st.line && (st.line < a || end > b || inner.length <= 12)) walk(inner.filter(x => x.line > st.line || (x.endLine || x.line) > st.line), depth + 1)
        }
      }
    }
    walk(ast.body, 0)
    if (!items.length) items.push('- (説明できる文が見つかりませんでした。コメントや空行だけかもしれません)')
    out.push(items.slice(0, 60).join('\n'))
    return { ok: true, markdown: out.join('\n\n') }
  }

  // ---- 概要 ----
  const lines = src.split('\n').length
  const services = [...new Set([...src.matchAll(/GetService\(\s*["'](\w+)["']\s*\)/g)].map(m => m[1]))]
  const funcs = []
  const events = []
  const visit = (stats, depth) => {
    for (const st of stats) {
      if (st.t === 'LocalFunction' || st.t === 'Function') funcs.push(st.t === 'LocalFunction' ? st.name.name : st.name)
      if (st.t === 'CallStat' && st.call.t === 'Method' && /^(Connect|Once)$/.test(st.call.name)) {
        const sig = st.call.obj.t === 'Index' && st.call.obj.key ? st.call.obj.key.v : null
        if (sig) events.push(SIGNALS[sig] || sig)
      }
      if (depth < 3) for (const k of ['body']) if (Array.isArray(st[k])) visit(st[k], depth + 1)
      if (st.func && depth < 3) visit(st.func.body, depth + 1)
      if (st.t === 'CallStat' && st.call.t === 'Method' && st.call.args[0] && st.call.args[0].t === 'Func' && depth < 3) visit(st.call.args[0].body, depth + 1)
      if (st.t === 'If' && depth < 3) { for (const c of st.clauses) visit(c.body, depth + 1); if (st.orelse) visit(st.orelse, depth + 1) }
    }
  }
  visit(ast.body, 0)
  const creates = [...new Set([...src.matchAll(/Instance\.new\(\s*["'](\w+)["']/g)].map(m => m[1]))]
  const summary = []
  summary.push(`- 種類: ${scriptKind(path, mode, src)}・${lines} 行`)
  if (services.length) summary.push(`- 使っているサービス: ${services.join('、')}`)
  if (funcs.length) summary.push(`- 関数: ${funcs.slice(0, 12).map(md).join('、')}${funcs.length > 12 ? ` ほか ${funcs.length - 12} 個` : ''}`)
  if (events.length) summary.push(`- 反応するできごと: ${[...new Set(events)].slice(0, 8).join('、')}`)
  if (creates.length) summary.push(`- 作るもの: ${creates.slice(0, 10).join('、')}`)
  if (/FireServer|OnServerEvent|FireClient|OnClientEvent/.test(src)) summary.push('- RemoteEvent でサーバーとクライアントがやり取りします')
  if (/DataStoreService/.test(src)) summary.push('- DataStore でデータを保存・読み込みします')
  if (/Drawing\.new/.test(src)) summary.push('- Drawing で画面に直接描きます')
  out.push('### 概要\n' + summary.join('\n'))

  // ---- 流れ (上から順に) ----
  const flow = []
  let i = 0
  const body = ast.body
  while (i < body.length && flow.length < 40) {
    const st = body[i]
    // GetService の連続はまとめる
    if (st.t === 'Local' && st.values[0] && st.values[0].t === 'Method' && st.values[0].name === 'GetService') {
      let j = i
      const names = []
      while (j < body.length && body[j].t === 'Local' && body[j].values[0] && body[j].values[0].t === 'Method' && body[j].values[0].name === 'GetService') { names.push(strOf(body[j].values[0].args[0]) || '?'); j++ }
      if (j - i >= 2) { flow.push(`- **${st.line}〜${body[j - 1].line} 行目**: サービスを取得 (${names.join('、')})`); i = j; continue }
    }
    const d = D.describeStat(st)
    if (d) flow.push(`- **${st.line} 行目**: ${d}`)
    i++
  }
  if (body.length > i) flow.push(`- …ほか ${body.length - i} 個の文`)
  out.push('### 上から順に\n' + flow.join('\n'))

  // ---- 気をつける点 ----
  const notes = []
  for (const p of lintProblems.filter(p => p.severity === 'error' || p.severity === 'warning').slice(0, 4)) notes.push(`- ${p.line} 行目: ${p.message}`)
  for (const f of reviewCode(src, { executor: mode === 'executor' }).filter(f => f.severity !== 'info' || f.kind === 'perf').slice(0, 5)) notes.push(`- ${f.line} 行目: ${f.message}`)
  if (notes.length) out.push('### 気をつける点\n' + notes.join('\n'))
  return { ok: true, markdown: out.join('\n\n') }
}

// ============================================================
// コメントの自動追加
// ============================================================
export function addComments(src, { from = 0, to = Infinity } = {}) {
  let ast
  try { ast = parse(src) } catch { return { text: src, count: 0, ok: false } }
  const D = makeDescriber(src)
  const lines = src.split('\n')
  const lineStart = []
  { let p = 0; for (const l of lines) { lineStart.push(p); p += l.length + 1 } }
  const a = from ? src.slice(0, from).split('\n').length : 1
  const b = to === Infinity ? lines.length : src.slice(0, to).split('\n').length
  const inserts = new Map() // 行番号 → コメント
  const want = (st, text) => {
    const ln = st.line
    if (ln < a || ln > b || inserts.has(ln)) return
    const prev = (lines[ln - 2] || '').trim()
    if (prev.startsWith('--')) return
    if (/--/.test(lines[ln - 1])) return
    inserts.set(ln, text)
  }
  const walk = (stats, depth) => {
    let k = 0
    while (k < stats.length) {
      const st = stats[k]
      if (st.t === 'Local' && st.values[0] && st.values[0].t === 'Method' && st.values[0].name === 'GetService') {
        let j = k
        while (j < stats.length && stats[j].t === 'Local' && stats[j].values[0] && stats[j].values[0].t === 'Method' && stats[j].values[0].name === 'GetService') j++
        want(st, j - k > 1 ? '使うサービスを取得' : `${strOf(st.values[0].args[0])} サービスを取得`)
        k = j
        continue
      }
      let c = null
      if (st.t === 'LocalFunction' || st.t === 'Function') { const hint = D.nameHint(st.t === 'LocalFunction' ? st.name.name : st.name); c = (hint ? hint + ': ' : '') + D.funcSummary(st.func) }
      else if (st.t === 'Local' && st.values[0] && st.values[0].t === 'Func') c = D.funcSummary(st.values[0])
      else if (st.t === 'CallStat' && st.call.t === 'Method' && /^(Connect|Once)$/.test(st.call.name)) c = D.callPhrase(st.call)
      else if (st.t === 'While' || st.t === 'NumFor' || st.t === 'GenFor' || st.t === 'Repeat' || st.t === 'If') c = D.describeStat(st).replace(/: .*$/, '').replace(/、.*$/, '')
      else if (depth === 0 && (st.t === 'Local' || st.t === 'CallStat' || st.t === 'Assign')) {
        const d = D.describeStat(st)
        if (d && (st.t !== 'Local' || /新しい|データストア|モジュール|自分|キャラクター/.test(d))) c = d
      }
      if (c) want(st, c.replace(/`/g, '').replace(/\s+—\s+/, ': ').slice(0, 90))
      // 中身
      const inner = st.func ? st.func.body : st.t === 'Local' && st.values[0] && st.values[0].t === 'Func' ? st.values[0].body : st.t === 'CallStat' && st.call.t === 'Method' && st.call.args[0] && st.call.args[0].t === 'Func' ? st.call.args[0].body : Array.isArray(st.body) ? st.body : null
      if (inner && depth < 2) walk(inner, depth + 1)
      k++
    }
  }
  walk(ast.body, 0)
  if (!inserts.size) return { text: src, count: 0, ok: true }
  const out = []
  lines.forEach((l, i) => {
    const c = inserts.get(i + 1)
    if (c) out.push((/^[ \t]*/.exec(l)[0]) + '-- ' + c)
    out.push(l)
  })
  return { text: out.join('\n'), count: inserts.size, ok: true }
}

// ============================================================
// 型注釈
// ============================================================
const HANDLER_TYPES = {
  Touched: ['BasePart'], TouchEnded: ['BasePart'], PlayerAdded: ['Player'], PlayerRemoving: ['Player'], CharacterAdded: ['Model'], CharacterRemoving: ['Model'], MouseClick: ['Player'], Triggered: ['Player'],
  InputBegan: ['InputObject', 'boolean'], InputEnded: ['InputObject', 'boolean'], InputChanged: ['InputObject', 'boolean'], Heartbeat: ['number'], RenderStepped: ['number'], Stepped: ['number', 'number'],
  OnServerEvent: ['Player'], Chatted: ['string'], HealthChanged: ['number'], ChildAdded: ['Instance'], ChildRemoved: ['Instance'], DescendantAdded: ['Instance'], FocusLost: ['boolean'],
}
function inferParamType(name, body) {
  const n = name.replace(/[$^]/g, '')
  const re = s => new RegExp(s.replace(/NAME/g, n)).test(body)
  if (re('\\bNAME\\s*:\\s*(FindFirstChild|WaitForChild|GetChildren|IsA|Destroy|Clone)') || re('\\bNAME\\.Parent\\b')) {
    if (re('\\bNAME\\.(Character|UserId|DisplayName|leaderstats|Backpack|PlayerGui)\\b') || re('\\bNAME:Kick')) return 'Player'
    if (re('\\bNAME\\.(Position|CFrame|Size|Anchored|CanCollide|Color|Material|Transparency)\\b')) return 'BasePart'
    return 'Instance'
  }
  if (re('\\bNAME\\.(Character|UserId|DisplayName|leaderstats|Backpack|PlayerGui)\\b') || re('\\bNAME:Kick')) return 'Player'
  if (re('\\bNAME:TakeDamage') || re('\\bNAME\\.(Health|WalkSpeed|JumpPower|MaxHealth)\\b')) return 'Humanoid'
  if (re('\\bNAME\\.(Position|CFrame|Size|Anchored|CanCollide|Material|Transparency)\\b')) return 'BasePart'
  if (re('\\bNAME\\.(X|Y|Z|Magnitude|Unit)\\b')) return 'Vector3'
  if (re('\\bNAME\\s*(\\.\\.|:sub|:format|:upper|:lower|:split|:find|:match|:gsub)') || re('\\.\\.\\s*NAME\\b') || re('#NAME\\b') && re('NAME:sub')) return 'string'
  if (re('\\bNAME\\s*[-+*/%^]\\s*[\\w(]') || re('[-+]\\s*NAME\\b') || re('[-*/%^]\\s*NAME\\b') || re('\\bNAME\\s*[<>]=?\\s*\\d') || re('math\\.\\w+\\([^)]*\\bNAME\\b') || re('\\bNAME\\s*\\+\\s*\\d') || re('for\\s+\\w+\\s*=\\s*\\d+\\s*,\\s*NAME\\b')) return 'number'
  if (re('\\bif\\s+(not\\s+)?NAME\\s+then') && !re('\\bNAME[.:\\[]')) return 'boolean'
  if (re('\\bNAME\\[') || re('in\\s+(i?pairs\\()?NAME\\)?\\s+do') || re('#NAME\\b') || re('table\\.\\w+\\(\\s*NAME\\b')) return '{ any }'
  return null
}
function literalType(e) {
  if (!e) return null
  if (e.t === 'Number') return 'number'
  if (e.t === 'String' || e.t === 'Interp') return 'string'
  if (e.t === 'True' || e.t === 'False') return 'boolean'
  if (e.t === 'Bin' && ['==', '~=', '<', '<=', '>', '>='].includes(e.op)) return 'boolean'
  if (e.t === 'Un' && e.op === 'not') return 'boolean'
  if (e.t === 'Un' && e.op === '#') return 'number'
  if (e.t === 'Bin' && ['+', '-', '*', '/', '//', '%', '^'].includes(e.op)) return 'number'
  if (e.t === 'Bin' && e.op === '..') return 'string'
  return null
}

export function addTypes(src, { from = 0, to = Infinity } = {}) {
  let ast
  try { ast = parse(src) } catch { return { text: src, count: 0, ok: false } }
  const lines = src.split('\n')
  const a = from ? src.slice(0, from).split('\n').length : 1
  const b = to === Infinity ? lines.length : src.slice(0, to).split('\n').length
  const edits = []
  const doFunc = (f, sigTypes) => {
    if (f.line < a || f.line > b) return
    const body = lines.slice(f.line - 1, f.endLine || f.line).join('\n')
    f.params.forEach((p, i) => {
      if (p.type || p.name === 'self' || p.s === undefined) return
      const ty = (sigTypes && sigTypes[i]) || inferParamType(p.name, body.slice(body.indexOf('\n') + 1))
      if (ty) edits.push({ at: p.e, insert: `: ${ty}` })
    })
    // 戻り値 (すべての return が同じ種類のとき)
    if (!f.returnType && f.bodyStart !== undefined) {
      const rets = []
      const walk = stats => { for (const st of stats) { if (st.t === 'Return') rets.push(st); for (const k of ['body', 'orelse']) if (Array.isArray(st[k])) walk(st[k]); if (st.t === 'If') st.clauses.forEach(c => walk(c.body)) } }
      walk(f.body)
      if (rets.length && rets.every(r => r.values.length === 1)) {
        const tys = [...new Set(rets.map(r => literalType(r.values[0])))]
        if (tys.length === 1 && tys[0]) {
          // ')' の直後に入れる
          const close = src.lastIndexOf(')', f.bodyStart)
          if (close > 0) edits.push({ at: close + 1, insert: `: ${tys[0]}` })
        }
      }
    }
  }
  // part.Touched:Connect(onTouched) のように名前で渡された関数は、イベントの引数の型を使う
  const named = new Map()
  for (const m of src.matchAll(/\.(\w+):(?:Connect|Once)\(\s*([A-Za-z_]\w*)\s*\)/g)) if (HANDLER_TYPES[m[1]]) named.set(m[2], HANDLER_TYPES[m[1]])
  const walkS = stats => {
    for (const st of stats) {
      if (st.t === 'LocalFunction' || st.t === 'Function') { doFunc(st.func, named.get(st.t === 'LocalFunction' ? st.name.name : st.name)); walkS(st.func.body) }
      else if (st.t === 'CallStat' && st.call.t === 'Method' && /^(Connect|Once)$/.test(st.call.name) && st.call.args[0] && st.call.args[0].t === 'Func') {
        const sig = st.call.obj.t === 'Index' && st.call.obj.key ? st.call.obj.key.v : null
        doFunc(st.call.args[0], HANDLER_TYPES[sig])
        walkS(st.call.args[0].body)
      } else {
        if (st.t === 'Local') st.values.forEach(v => { if (v && v.t === 'Func') { doFunc(v); walkS(v.body) } })
        if (st.t === 'Assign') st.values.forEach(v => { if (v && v.t === 'Func') { doFunc(v); walkS(v.body) } })
        if (Array.isArray(st.body)) walkS(st.body)
        if (st.t === 'If') { st.clauses.forEach(c => walkS(c.body)); if (st.orelse) walkS(st.orelse) }
      }
    }
  }
  walkS(ast.body)
  edits.sort((x, y) => y.at - x.at)
  let text = src
  for (const e of edits) text = text.slice(0, e.at) + e.insert + text.slice(e.at)
  try { parse(text) } catch { return { text: src, count: 0, ok: false } }
  return { text, count: edits.length, ok: true }
}

// エグゼキューター API の補完・ホバー・エラーチェック用データ
// UNC / sUNC の標準関数に加えて、広く使われている別名や拡張 (syn.*, fluxus.*, bit ライブラリなど) を収録しています。
// 書式は luau-api.js と同じ: "名前(引数): 戻り値 — 説明"
import { parseEntries } from './luau-api.js'

const E = (group, list, extra = {}) => parseEntries(list, { cat: 'executor', group, ...extra })

const BASE = {
  ...E('環境', [
    'getgenv(): table — エグゼキューターのグローバル環境。ここに入れた値は、別々に実行したスクリプトの間でも共有されます',
    'getrenv(): table — Roblox (ゲーム) 側のグローバル環境',
    'getsenv(script: LocalScript | ModuleScript): table — 実行中のスクリプトの環境 (ローカルでないグローバル変数・関数)',
    'getreg(): table — Lua レジストリ',
    'getgc(includeTables: boolean?): {any} — ガベージコレクタが管理している関数の一覧 (true でテーブルも含む)',
    'filtergc(type: "function" | "table", options: table, returnOne: boolean?): any — 条件に合う関数・テーブルを GC から探します (Name, Constants, Upvalues, Keys など)',
    'getinstances(): {Instance} — すべての Instance',
    'getnilinstances(): {Instance} — 親が nil の Instance',
    'getscripts(): {LuaSourceContainer} — ゲーム内のすべての LocalScript / ModuleScript',
    'getrunningscripts(): {LuaSourceContainer} — 現在実行中のスクリプト',
    'getloadedmodules(): {ModuleScript} — require 済みの ModuleScript',
    'getcallingscript(): LuaSourceContainer? — いまの関数を呼び出したスクリプト',
    'getscriptclosure(script: LuaSourceContainer): function — スクリプトのメイン関数 (新しく作られたもの)',
    'getscripthash(script: LuaSourceContainer): string — バイトコードの SHA384 ハッシュ (スクリプトの変更検知に)',
    'getscriptbytecode(script: LuaSourceContainer): string — コンパイル済みバイトコード',
    'decompile(script: LuaSourceContainer | function): string — バイトコードを Luau のソースへ戻します (対応エグゼキューターのみ)',
    'getfunctionhash(f: function): string — 関数のバイトコードのハッシュ',
    'identifyexecutor(): (string, string) — エグゼキューターの名前とバージョン',
    'getthreadidentity(): number — 現在のスレッドの権限レベル (通常 8)',
    'setthreadidentity(identity: number) — スレッドの権限レベルを変更',
    'checkcaller(): boolean — いまの呼び出しがエグゼキューターのスレッドからか (フックの中で自分の呼び出しを除外するのに使います)',
    'isrbxactive(): boolean — Roblox のウィンドウが前面にあるか',
    'setfpscap(fps: number) — FPS の上限 (0 で無制限)',
    'getfpscap(): number — 現在の FPS 上限',
    'queue_on_teleport(code: string) — テレポート後 (別のサーバー・プレースへ移動した後) に実行するコードを登録',
    'clear_teleport_queue() — queue_on_teleport の登録を取り消し',
    'messagebox(text: string, caption: string, flags: number): number — OS のメッセージボックスを表示 (押されたボタンの番号を返す)',
    'setclipboard(text: string) — クリップボードへコピー',
    'getclipboard(): string — クリップボードの内容 (対応エグゼキューターのみ)',
    'gethwid(): string — 端末固有の ID',
    'isluau(): boolean — Luau で動いているか (常に true)',
    'getcallstack(): {table} — 現在の呼び出し履歴',
    'saveinstance(options: table?) — ゲーム (プレース) を .rbxl ファイルとして workspace フォルダに保存',
    'getobjects(assetId: string | number): {Instance} — アセットを読み込みます (game:GetObjects と同じ)',
  ]),
  ...E('クロージャ', [
    'hookfunction(target: function, hook: function): function — target の中身を hook に差し替え、元の関数 (のコピー) を返します',
    'restorefunction(f: function) — hookfunction で差し替えた関数を元に戻します',
    'isfunctionhooked(f: function): boolean — フックされているか',
    'newcclosure(f: function, debugName: string?): function — Lua 関数を C 関数として包みます (フックの検出回避に)',
    'newlclosure(f: function): function — Lua 関数として包み直します',
    'clonefunction(f: function): function — 関数を複製 (フックの影響を受けないコピー)',
    'iscclosure(f: function): boolean — C 関数か',
    'islclosure(f: function): boolean — Lua 関数か',
    'isexecutorclosure(f: function): boolean — エグゼキューターが作った関数か',
    'loadstring(source: string, chunkname: string?): (function?, string?) — コードの文字列を関数にします。失敗時は nil とエラーメッセージ',
    'getcallbackvalue(object: Instance, property: string): function? — OnInvoke / OnClientInvoke などに設定されたコールバック',
  ]),
  ...E('メタテーブル', [
    'getrawmetatable(object: any): table — __metatable の保護を無視してメタテーブルを取得',
    'setrawmetatable(object: any, metatable: table): any — 保護を無視してメタテーブルを設定',
    'hookmetamethod(object: any, method: string, hook: function): function — メタメソッド ("__namecall" / "__index" / "__newindex") をフック。元の関数を返します',
    'getnamecallmethod(): string — __namecall フックの中で、呼ばれたメソッド名 ("FireServer" など)',
    'setnamecallmethod(method: string) — __namecall のメソッド名を書き換え',
    'setreadonly(t: table, readonly: boolean) — テーブルの読み取り専用フラグを切り替え',
    'isreadonly(t: table): boolean — 読み取り専用か',
    'makereadonly(t: table) — 読み取り専用にする',
    'makewriteable(t: table) — 書き込み可能にする',
  ]),
  ...E('Instance', [
    'gethui(): Instance — 検出されにくい GUI の置き場所。ScreenGui の Parent に使います',
    'cloneref(object: Instance): Instance — 同じ Instance を指す別の参照 (弱参照テーブルによる検出を回避)',
    'compareinstances(a: Instance, b: Instance): boolean — cloneref した参照同士でも同じ Instance なら true',
    'gethiddenproperty(object: Instance, property: string): (any, boolean) — スクリプトから読めないプロパティを読み取り (2 つ目は隠しプロパティだったか)',
    'sethiddenproperty(object: Instance, property: string, value: any): boolean — 隠しプロパティを設定',
    'gethiddenproperties(object: Instance): table — 隠しプロパティの一覧',
    'getproperties(object: Instance): table — すべてのプロパティと値',
    'isscriptable(object: Instance, property: string): boolean — スクリプトから使えるプロパティか',
    'setscriptable(object: Instance, property: string, scriptable: boolean): boolean — スクリプトから使えるかを切り替え (以前の値を返す)',
    'getspecialinfo(object: Instance): table — MeshPart / UnionOperation / Terrain の特殊な情報',
    'fireclickdetector(detector: ClickDetector, distance: number?, event: string?) — ClickDetector をクリックしたことにします',
    'fireproximityprompt(prompt: ProximityPrompt, amount: number?, skip: boolean?) — ProximityPrompt を発動 (長押し時間を無視)',
    'firetouchinterest(part: BasePart, touched: BasePart, toggle: number) — 2 つのパーツが触れたことにします (0 = 触れ始め, 1 = 離れた)',
    'getcustomasset(path: string, noCache: boolean?): string — workspace フォルダの画像・音声ファイルを rbxasset:// の ID に変換',
    'isnetworkowner(part: BasePart): boolean — そのパーツの物理演算を自分が担当しているか',
    'getsimulationradius(): number — 物理シミュレーションの半径',
    'setsimulationradius(radius: number, maxRadius: number?) — 物理シミュレーションの半径を設定',
  ]),
  ...E('シグナル', [
    'getconnections(signal: RBXScriptSignal): {Connection} — シグナルに接続されている関数の一覧。各要素は Function / Enabled / Fire() / Disable() / Enable() / Disconnect() を持ちます',
    'firesignal(signal: RBXScriptSignal, ...: any) — シグナルに接続された関数をすべて呼び出します',
    'replicatesignal(signal: RBXScriptSignal, ...: any) — シグナルをサーバーへ複製して発火',
    'hooksignal(signal: RBXScriptSignal, callback: function) — シグナルの発火を横取り (callback が true を返すと元の接続も呼ばれます)',
    'restoresignal(signal: RBXScriptSignal) — hooksignal を解除',
    'issignalhooked(signal: RBXScriptSignal): boolean — フックされているか',
  ]),
  ...E('ファイル', [
    'readfile(path: string): string — workspace フォルダのファイルを読み込み',
    'writefile(path: string, content: string) — ファイルに書き込み (上書き)',
    'appendfile(path: string, content: string) — ファイルの末尾に追記',
    'isfile(path: string): boolean — ファイルが存在するか',
    'isfolder(path: string): boolean — フォルダが存在するか',
    'makefolder(path: string) — フォルダを作成',
    'delfile(path: string) — ファイルを削除',
    'delfolder(path: string) — フォルダを中身ごと削除',
    'listfiles(path: string): {string} — フォルダ内のファイル・フォルダのパス一覧',
    'loadfile(path: string, chunkname: string?): (function?, string?) — ファイルを読み込んで関数にします',
    'dofile(path: string): ...any — ファイルを読み込んで実行',
  ]),
  ...E('入力', [
    'mouse1click() — 左クリック', 'mouse1press() — 左ボタンを押したままにする', 'mouse1release() — 左ボタンを離す',
    'mouse2click() — 右クリック', 'mouse2press() — 右ボタンを押したままにする', 'mouse2release() — 右ボタンを離す',
    'mousemoveabs(x: number, y: number) — マウスを画面上の座標へ移動', 'mousemoverel(x: number, y: number) — マウスを現在位置から相対移動',
    'mousescroll(pixels: number) — マウスホイールを回す',
    'keypress(keycode: number) — キーを押したままにする (仮想キーコード。例: 0x57 = W)', 'keyrelease(keycode: number) — キーを離す', 'keyclick(keycode: number) — キーを 1 回押す',
    'iskeydown(keycode: number): boolean — キーが押されているか',
  ]),
  ...E('HTTP', [
    'request(options: {Url: string, Method: string?, Headers: table?, Body: string?, Cookies: table?}): {Success: boolean, StatusCode: number, StatusMessage: string, Headers: table, Body: string} — HTTP リクエストを送信 (応答が返るまで待機)',
  ]),
  ...E('コンソール', [
    'rconsolecreate() — 外部コンソールのウィンドウを開く', 'rconsoledestroy() — コンソールを閉じる', 'rconsoleclear() — コンソールをクリア',
    'rconsoleprint(text: string) — コンソールに出力 (改行なし)', 'rconsoleinput(): string — コンソールから 1 行入力を受け取る (待機)',
    'rconsolesettitle(title: string) — コンソールのタイトルを設定',
    'rconsolewarn(text: string) — 警告として出力', 'rconsoleerr(text: string) — エラーとして出力', 'rconsoleinfo(text: string) — 情報として出力',
  ]),
  ...E('描画', [
    'cleardrawcache() — すべての Drawing オブジェクトを削除', 'isrenderobj(object: any): boolean — Drawing オブジェクトか',
    'getrenderproperty(drawing: Drawing, property: string): any — Drawing のプロパティを取得', 'setrenderproperty(drawing: Drawing, property: string, value: any) — Drawing のプロパティを設定',
  ]),
  ...E('圧縮・変換', [
    'lz4compress(data: string): string — LZ4 で圧縮', 'lz4decompress(data: string, size: number): string — LZ4 を展開 (size は展開後のバイト数)',
    'base64encode(data: string): string — Base64 に変換', 'base64decode(data: string): string — Base64 から戻す',
  ]),
  ...E('並列 (Actor)', [
    'getactors(): {Actor} — ゲーム内の Actor の一覧',
    'run_on_actor(actor: Actor, code: string, ...: any) — Actor の環境でコードを実行',
    'getactorthreads(): {thread} — Actor のスレッド一覧',
    'run_on_thread(thread: thread, code: string, ...: any) — 指定スレッドでコードを実行',
    'create_comm_channel(): (number, BindableEvent) — Actor と通信するチャンネルを作成 (ID とイベント)',
    'get_comm_channel(id: number): BindableEvent — チャンネルを取得',
    'isparallel(): boolean — 並列実行中か',
  ]),
}

// 別名 (どちらの名前でも同じ関数)。補完では「〜 の別名」と表示します
const ALIASES = {
  getexecutorname: 'identifyexecutor', whatexecutor: 'identifyexecutor',
  getidentity: 'getthreadidentity', getthreadcontext: 'getthreadidentity', setidentity: 'setthreadidentity', setthreadcontext: 'setthreadidentity',
  isgameactive: 'isrbxactive', iswindowactive: 'isrbxactive',
  queueonteleport: 'queue_on_teleport', clearteleportqueue: 'clear_teleport_queue',
  toclipboard: 'setclipboard', setrbxclipboard: 'setclipboard',
  replaceclosure: 'hookfunction', hookfunc: 'hookfunction', detour_function: 'hookfunction',
  checkclosure: 'isexecutorclosure', isourclosure: 'isexecutorclosure', is_synapse_function: 'isexecutorclosure',
  getscriptfunction: 'getscriptclosure', dumpstring: 'getscriptbytecode',
  make_writeable: 'makewriteable', make_readonly: 'makereadonly',
  get_hidden_gui: 'gethui', gethiddengui: 'gethui',
  getsynasset: 'getcustomasset', http_request: 'request',
  consolecreate: 'rconsolecreate', consoledestroy: 'rconsoledestroy', consoleclear: 'rconsoleclear', consoleprint: 'rconsoleprint',
  consoleinput: 'rconsoleinput', consolesettitle: 'rconsolesettitle', rconsolename: 'rconsolesettitle',
  base64_encode: 'base64encode', base64_decode: 'base64decode',
  firetouchtransmitter: 'firetouchinterest', gethiddenprop: 'gethiddenproperty', sethiddenprop: 'sethiddenproperty',
  getconstants: 'debug.getconstants', getconstant: 'debug.getconstant', setconstant: 'debug.setconstant',
  getupvalues: 'debug.getupvalues', getupvalue: 'debug.getupvalue', setupvalue: 'debug.setupvalue',
  getprotos: 'debug.getprotos', getproto: 'debug.getproto', getstack: 'debug.getstack', setstack: 'debug.setstack', getinfo: 'debug.getinfo',
}

const LIB_VALUES = {
  crypt: { kind: 'value', type: 'crypt', doc: '暗号化・ハッシュ・Base64 のライブラリ', cat: 'executor', group: 'ライブラリ' },
  Drawing: { kind: 'value', type: 'Drawing', doc: '画面に線・図形・文字を直接描くライブラリ (ESP などの表示に)', cat: 'executor', group: 'ライブラリ' },
  WebSocket: { kind: 'value', type: 'WebSocket', doc: 'WebSocket 通信', cat: 'executor', group: 'ライブラリ' },
  cache: { kind: 'value', type: 'cache', doc: 'Instance キャッシュの操作', cat: 'executor', group: 'ライブラリ' },
  bit: { kind: 'value', type: 'bit', doc: 'ビット演算 (bit32 とほぼ同じ)', cat: 'executor', group: 'ライブラリ' },
  base64: { kind: 'value', type: 'base64', doc: 'base64.encode / base64.decode', cat: 'executor', group: 'ライブラリ' },
  syn: { kind: 'value', type: 'syn', doc: 'Synapse 互換ライブラリ (syn.request, syn.protect_gui など)', cat: 'executor', group: 'ライブラリ' },
  fluxus: { kind: 'value', type: 'fluxus', doc: 'Fluxus 互換ライブラリ', cat: 'executor', group: 'ライブラリ' },
  http: { kind: 'value', type: 'http', doc: 'http.request', cat: 'executor', group: 'ライブラリ' },
}

export const EXECUTOR_LIBS = {
  crypt: E('crypt', [
    'base64encode(data: string): string — Base64 に変換', 'base64decode(data: string): string — Base64 から戻す',
    'encrypt(data: string, key: string, iv: string?, mode: string?): (string, string) — AES で暗号化 (暗号文と IV を返す。mode: CBC, ECB, CTR, CFB, OFB, GCM)',
    'decrypt(data: string, key: string, iv: string, mode: string): string — AES を復号',
    'generatebytes(size: number): string — ランダムなバイト列 (Base64)', 'generatekey(): string — 32 バイトの鍵 (Base64)',
    'hash(data: string, algorithm: string): string — ハッシュ値 (sha1, sha256, sha384, sha512, md5, sha3-256 など)',
  ]),
  Drawing: E('Drawing', [
    'new(type: "Line" | "Text" | "Image" | "Circle" | "Square" | "Quad" | "Triangle"): Drawing — 描画オブジェクトを作成 (Visible = true にすると表示されます)',
    'Fonts: {UI: number, System: number, Plex: number, Monospace: number} — Text の Font に使う定数',
  ]),
  WebSocket: E('WebSocket', ['connect(url: string): WebSocket — WebSocket に接続 (Send / Close / OnMessage / OnClose)']),
  cache: E('cache', [
    'invalidate(object: Instance) — キャッシュから外す (次に参照すると新しい参照になります)', 'iscached(object: Instance): boolean — キャッシュされているか',
    'replace(object: Instance, newObject: Instance) — キャッシュ上の参照を置き換え',
  ]),
  debug: E('debug', [
    'getconstants(f: function | number): {any} — 関数が使っている定数 (文字列・数値) の一覧', 'getconstant(f: function | number, index: number): any — index 番目の定数',
    'setconstant(f: function | number, index: number, value: any) — 定数を書き換え',
    'getupvalues(f: function | number): {any} — 関数が外側から参照している変数 (上位値) の一覧', 'getupvalue(f: function | number, index: number): any — index 番目の上位値',
    'setupvalue(f: function | number, index: number, value: any) — 上位値を書き換え',
    'getprotos(f: function | number): {function} — 関数の中で定義されている関数の一覧', 'getproto(f: function | number, index: number, activated: boolean?): function | {function} — index 番目の内部関数',
    'getstack(level: number, index: number?): any — 呼び出しスタックの値', 'setstack(level: number, index: number, value: any) — 呼び出しスタックの値を書き換え',
    'getinfo(f: function | number, options: string?): table — 関数の情報 (source, short_src, currentline, name, nups, numparams, is_vararg, func)',
    'getregistry(): table — Lua レジストリ', 'getmetatable(object: any): table — 保護を無視してメタテーブルを取得', 'setmetatable(object: any, mt: table): any — 保護を無視してメタテーブルを設定',
  ]),
  bit: E('bit', [
    'band(...: number): number — ビット AND', 'bor(...: number): number — ビット OR', 'bxor(...: number): number — ビット XOR', 'bnot(n: number): number — ビット反転',
    'lshift(n: number, bits: number): number — 左シフト', 'rshift(n: number, bits: number): number — 右シフト', 'arshift(n: number, bits: number): number — 算術右シフト',
    'rol(n: number, bits: number): number — 左ローテート', 'ror(n: number, bits: number): number — 右ローテート', 'bswap(n: number): number — バイト順を反転',
    'tohex(n: number, digits: number?): string — 16 進文字列に', 'tobit(n: number): number — 32 ビット整数に正規化',
  ]),
  base64: E('base64', ['encode(data: string): string — Base64 に変換', 'decode(data: string): string — Base64 から戻す']),
  syn: E('syn', [
    'request(options: table): table — HTTP リクエスト (request と同じ)', 'protect_gui(gui: ScreenGui) — GUI をゲーム側から見えなくする', 'unprotect_gui(gui: ScreenGui) — 保護を解除',
    'queue_on_teleport(code: string) — テレポート後に実行するコードを登録', 'set_thread_identity(identity: number) — 権限レベルを設定', 'get_thread_identity(): number — 権限レベルを取得',
    'is_cached(object: Instance): boolean — キャッシュされているか', 'cache_invalidate(object: Instance) — キャッシュから外す', 'cache_replace(object: Instance, newObject: Instance) — キャッシュを置き換え',
    'secure_call(f: function, script: LuaSourceContainer, ...: any): ...any — 指定スクリプトから呼ばれたように見せて関数を呼ぶ', 'is_beta(): boolean — ベータ版か',
    'write_clipboard(text: string) — クリップボードへコピー', 'crypt: table — syn.crypt (crypt と同じ)', 'websocket: table — syn.websocket.connect(url)',
  ]),
  fluxus: E('fluxus', ['request(options: table): table — HTTP リクエスト', 'queue_on_teleport(code: string) — テレポート後に実行するコードを登録', 'set_thread_identity(identity: number) — 権限レベルを設定']),
  http: E('http', ['request(options: table): table — HTTP リクエスト (request と同じ)']),
}

function withAliases() {
  const out = { ...BASE, ...LIB_VALUES }
  for (const [alias, target] of Object.entries(ALIASES)) {
    let src
    if (target.includes('.')) { const [lib, fn] = target.split('.'); src = EXECUTOR_LIBS[lib][fn] } else src = BASE[target]
    if (src && !out[alias]) out[alias] = { ...src, doc: `${target} の別名。${src.doc}`, alias: target }
  }
  return out
}
export const EXECUTOR_GLOBALS = withAliases()

// 補完の並び順で優先するよく使う関数
export const EXECUTOR_POPULAR = new Set(['getgenv', 'loadstring', 'request', 'writefile', 'readfile', 'isfile', 'isfolder', 'makefolder', 'hookmetamethod', 'hookfunction', 'getnamecallmethod', 'checkcaller', 'newcclosure', 'gethui', 'setclipboard', 'identifyexecutor', 'getconnections', 'firesignal', 'fireclickdetector', 'fireproximityprompt', 'firetouchinterest', 'queue_on_teleport', 'getrawmetatable', 'setreadonly', 'cloneref', 'Drawing', 'listfiles', 'getgc', 'getsenv'])

// Drawing オブジェクトのプロパティ (種類ごと)
export const DRAWING_PROPS = {
  common: ['Visible: boolean — 表示するか (既定は false)', 'ZIndex: number — 重なり順', 'Transparency: number — 不透明度 (1 = 不透明, 0 = 透明)', 'Color: Color3 — 色', 'Remove() — 削除', 'Destroy() — 削除 (Remove と同じ)'],
  Line: ['From: Vector2 — 始点', 'To: Vector2 — 終点', 'Thickness: number — 太さ'],
  Text: ['Text: string — 表示する文字', 'Size: number — 文字サイズ', 'Center: boolean — 中央揃え', 'Outline: boolean — 縁取り', 'OutlineColor: Color3 — 縁取りの色', 'Position: Vector2 — 位置', 'Font: number — フォント (Drawing.Fonts)', 'TextBounds: Vector2 — 文字の大きさ (読み取り専用)'],
  Image: ['Data: string — 画像データ (readfile で読んだ内容)', 'Size: Vector2 — 大きさ', 'Position: Vector2 — 位置', 'Rounding: number — 角の丸み'],
  Circle: ['NumSides: number — 辺の数 (多いほど滑らか)', 'Radius: number — 半径', 'Position: Vector2 — 中心', 'Thickness: number — 線の太さ', 'Filled: boolean — 塗りつぶし'],
  Square: ['Size: Vector2 — 大きさ', 'Position: Vector2 — 左上の位置', 'Thickness: number — 線の太さ', 'Filled: boolean — 塗りつぶし'],
  Quad: ['PointA: Vector2', 'PointB: Vector2', 'PointC: Vector2', 'PointD: Vector2', 'Thickness: number — 線の太さ', 'Filled: boolean — 塗りつぶし'],
  Triangle: ['PointA: Vector2', 'PointB: Vector2', 'PointC: Vector2', 'Thickness: number — 線の太さ', 'Filled: boolean — 塗りつぶし'],
}
export const DRAWING_KINDS = ['Line', 'Text', 'Image', 'Circle', 'Square', 'Quad', 'Triangle']

// オブジェクト型のメンバー (補完用)
export const EXECUTOR_OBJECTS = {
  Connection: E('Connection', [
    'Function: function — 接続されている関数', 'Enabled: boolean — 有効か', 'ForeignState: boolean — 別の Lua 環境 (CoreScript など) の接続か', 'LuaConnection: boolean — Lua の関数が接続されているか',
    'Thread: thread — 接続を作ったスレッド', 'State: number — 接続の状態',
    'Fire(...: any) — この接続の関数だけを呼び出す', 'Defer(...: any) — 次のフレームで呼び出す', 'Disable() — 一時的に無効化', 'Enable() — 有効化', 'Disconnect() — 切断',
  ]),
  WebSocket: E('WebSocket', [
    'Send(message: string) — メッセージを送信', 'Close() — 接続を閉じる',
    'OnMessage: RBXScriptSignal — メッセージを受け取ったとき (message: string)', 'OnClose: RBXScriptSignal — 接続が閉じたとき',
  ]),
  Metatable: E('Metatable', [
    '__index: any — 存在しないキーを読んだとき (関数またはテーブル)', '__newindex: function — 存在しないキーに書き込んだとき', '__namecall: function — obj:Method() の呼び出し (getnamecallmethod でメソッド名)',
    '__call: function — 関数のように呼んだとき', '__tostring: function — tostring したとき', '__len: function — # 演算子', '__eq: function — ==', '__lt: function — <', '__le: function — <=',
    '__concat: function — ..', '__unm: function — 単項 -', '__add: function — +', '__sub: function — -', '__mul: function — *', '__div: function — /', '__mod: function — %', '__pow: function — ^',
    '__iter: function — for ... in obj の反復', '__metatable: any — getmetatable の結果を固定 (保護)', '__mode: string — 弱参照 ("k" / "v" / "kv")',
  ]),
  Response: E('Response', [
    'Success: boolean — 成功したか (ステータスコードが 200 番台)', 'StatusCode: number — HTTP ステータスコード', 'StatusMessage: string — ステータスの説明',
    'Headers: table — 応答ヘッダー', 'Body: string — 応答の本文',
  ]),
}

// request({ ... }) のキー
export const REQUEST_OPTIONS = parseEntries([
  'Url: string — リクエスト先の URL (必須)', 'Method: string — "GET" / "POST" / "PUT" / "PATCH" / "DELETE" (既定は GET)',
  'Headers: table — 送信ヘッダー。例: { ["Content-Type"] = "application/json" }', 'Body: string — 送信する本文 (JSON は HttpService:JSONEncode で文字列に)',
  'Cookies: table — 送信する Cookie',
])

// hookmetamethod の第 2 引数など
export const METAMETHODS = ['__namecall', '__index', '__newindex', '__call', '__tostring', '__eq', '__len', '__concat', '__unm', '__add', '__sub', '__mul', '__div', '__mod', '__pow', '__lt', '__le', '__iter', '__metatable', '__mode', '__gc']
export const HASH_ALGORITHMS = ['sha1', 'sha256', 'sha384', 'sha512', 'md5', 'sha3-224', 'sha3-256', 'sha3-512']

// DataModel (game) に追加されるメソッド
export const EXECUTOR_GAME_METHODS = parseEntries([
  'HttpGet(url: string, nocache: boolean?): string — URL の内容を取得します。loadstring(game:HttpGet(url))() の形でよく使われます',
  'HttpGetAsync(url: string, nocache: boolean?): string — HttpGet と同じ',
  'HttpPost(url: string, data: string, contentType: string?): string — POST リクエストを送り、応答の本文を返します',
  'HttpPostAsync(url: string, data: string, contentType: string?): string — HttpPost と同じ',
  'GetObjects(assetId: string): {Instance} — アセット (rbxassetid://...) を読み込みます',
], { cat: 'executor' })

// エグゼキューター専用の関数かどうか (Studio モードで使ったときの警告用)
export const isExecutorOnly = name => Object.prototype.hasOwnProperty.call(EXECUTOR_GLOBALS, name) && name !== 'loadstring'

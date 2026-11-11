// 実行時エラーの解説 (よくあるエラーを日本語で説明し、直し方を提案します)
// 返り値: { why: string, fixes: string[] } | null
const RULES = [
  [/attempt to index nil with '([^']+)'/, (m, c) => ({
    why: `「.${m[1]}」の左側の値が nil (何もない状態) です。変数にまだ何も入っていないか、探したオブジェクトが見つかっていません。`,
    fixes: [
      c.kind === 'server' && /Character|PlayerGui|Backpack|UserId|Name/.test(m[1]) ? 'サーバースクリプトでは Players.LocalPlayer は nil です。PlayerAdded の引数でプレイヤーを受け取ってください' : null,
      'FindFirstChild は見つからないと nil を返します。読み込みを待つなら WaitForChild("名前") を使います',
      '使う前に if 変数 then ... end で nil でないことを確認します',
      '変数名のスペルミス (大文字・小文字) がないか確認します',
    ],
  })],
  [/attempt to index nil with (number|key)/, () => ({ why: 'nil の値に対して [添字] でアクセスしました。テーブルが入っているはずの変数が nil です。', fixes: ['テーブルを作る前に使っていないか確認します', '関数が値を return しているか確認します'] })],
  [/attempt to call a nil value(?: \(([^)]*)\))?/, m => ({
    why: `存在しない関数を呼び出しました${m[1] ? ` (${m[1]})` : ''}。関数名が間違っているか、まだ定義されていません。`,
    fixes: ['関数名のスペル (大文字・小文字) を確認します', 'local function は、呼び出す場所より上に書く必要があります', 'メソッドは obj:Method() のように ":" で呼びます'],
  })],
  [/attempt to call missing method '([^']+)' of (\w+)/, m => ({ why: `${m[2]} に「${m[1]}」というメソッドはありません。`, fixes: ['メソッド名のスペルを確認します', '別の型の値が入っていないか print(typeof(値)) で確認します'] })],
  [/attempt to call a (\w+) value/, m => ({ why: `${m[1]} 型の値を関数のように呼び出しました。`, fixes: ['変数に関数ではない値 (数値や文字列など) を上書きしていないか確認します', '余分な () が付いていないか確認します'] })],
  [/attempt to perform arithmetic \((\w+)\) on (\w+)(?: and (\w+))?/, m => ({
    why: `計算 (${m[1]}) に ${m[2] === 'nil' || m[3] === 'nil' ? 'nil が混ざっています。変数に数値が入っていません' : `${m[2]}${m[3] ? ' と ' + m[3] : ''} は使えません`}。`,
    fixes: ['変数に初期値を入れます (例: local count = 0)', '文字列を数値にするには tonumber(値) を使います', 'テーブルのキー名が合っているか確認します'],
  })],
  [/attempt to concatenate (\w+) with (\w+)/, m => ({ why: `".." でつなげられるのは文字列と数値だけです (${m[1]} と ${m[2]} をつなげようとしました)。`, fixes: ['tostring(値) で文字列に変換します', '`こんにちは {name}` のような補間文字列を使うと安全です', 'nil の場合は 値 or "なし" と書くと既定値を使えます'] })],
  [/attempt to compare (\w+) [<>=~]+ (\w+)/, m => ({ why: `${m[1]} と ${m[2]} は大小を比べられません。`, fixes: ['両方が数値か確認します (文字列なら tonumber で変換)', '変数が nil になっていないか確認します'] })],
  [/attempt to get length of a (\w+) value/, m => ({ why: `# (長さ) はテーブルか文字列にしか使えません (${m[1]} に使いました)。`, fixes: ['変数にテーブルが入っているか確認します'] })],
  [/attempt to iterate over a (\w+) value/, m => ({ why: `for ... in でくり返せるのはテーブルだけです (${m[1]} を渡しました)。`, fixes: ['GetChildren() や GetPlayers() の () を忘れていないか確認します', '変数が nil になっていないか確認します'] })],
  [/attempt to modify a readonly table/, (m, c) => ({ why: '書き換えできないテーブル (ライブラリや保護されたテーブル) を変更しようとしました。', fixes: [c.mode === 'executor' ? 'setreadonly(テーブル, false) で書き込み可能にしてから変更します' : 'string や math などのライブラリは変更できません。別のテーブルを作ります'] })],
  [/(\S+) is not a valid member of (\w+) "([^"]*)"/, m => ({
    why: `${m[2]} 「${m[3]}」の中に「${m[1]}」という名前の子オブジェクトもプロパティもありません。`,
    fixes: ['名前のスペル (大文字・小文字・空白) を確認します', 'まだ読み込まれていない可能性があるなら :WaitForChild("' + m[1] + '") を使います', 'あるか分からないなら :FindFirstChild("' + m[1] + '") で確認します'],
  })],
  [/(\S+) is not a valid member of (\w[\w.]*)/, m => ({ why: `${m[2]} に「${m[1]}」という項目はありません。`, fixes: ['名前のスペルを確認します'] })],
  [/Unable to assign property (\w+)\. (.+) expected, got (.+)/, m => ({ why: `プロパティ ${m[1]} には ${m[2]} 型の値が必要ですが、${m[3]} を入れようとしました。`, fixes: [m[2] === 'Vector3' ? 'Vector3.new(x, y, z) で作ります' : m[2] === 'Color3' ? 'Color3.fromRGB(r, g, b) で作ります' : m[2] === 'UDim2' ? 'UDim2.new(...) / UDim2.fromScale(...) で作ります' : `${m[2]} 型の値を渡します`] })],
  [/Unable to assign property (\w+)\. Property is read only/, m => ({ why: `プロパティ ${m[1]} は読み取り専用で、値を入れられません。`, fixes: ['別のプロパティやメソッドで変更します (例: Position ではなく CFrame / PivotTo)'] })],
  [/Unable to create an Instance of type "([^"]*)"/, m => ({ why: `「${m[1]}」という種類の Instance は作れません。クラス名が間違っているか、作成できないクラスです。`, fixes: ['クラス名のスペルを確認します (例: "Part", "TextLabel")', 'サービスは game:GetService("名前") で取得します'] })],
  [/invalid argument #(\d+) to '([^']+)' \((.+) expected, got (.+)\)/, m => ({ why: `${m[2]} の ${m[1]} 番目の引数には ${m[3]} が必要ですが、${m[4]} が渡されました。`, fixes: ['引数の順番と型を確認します', m[4] === 'nil' ? '渡している変数が nil になっています' : null] })],
  [/missing argument #(\d+)(?: to '([^']+)')?/, m => ({ why: `${m[2] ? m[2] + ' の ' : ''}${m[1]} 番目の引数が足りません。`, fixes: ['必要な引数をすべて渡しているか確認します'] })],
  [/Infinite yield possible on '(.+)'/, m => ({ why: `${m[1]} がずっと待ち続けています。その名前のオブジェクトが作られていません。`, fixes: ['名前のスペルを確認します', 'そのオブジェクトを作るコードが実行されているか確認します', 'WaitForChild("名前", 5) のように待ち時間を指定できます'] })],
  [/stack overflow/, () => ({ why: '関数が自分自身を呼び続けて止まらなくなりました (無限再帰)。', fixes: ['再帰を終わらせる条件 (if ... then return end) があるか確認します'] })],
  [/時間切れ|timeout|exceeded|連続実行/i, () => ({ why: '処理が長時間止まらなかったため、強制的に停止しました (無限ループの可能性があります)。', fixes: ['while true do の中に task.wait() を入れます', 'ループの終了条件が正しいか確認します'] })],
  [/Module code did not return exactly one value/, () => ({ why: 'ModuleScript は最後に値を 1 つだけ return する必要があります。', fixes: ['ファイルの最後に return モジュール名 を書きます'] })],
  [/Requested module was required recursively/, () => ({ why: '2 つのモジュールがお互いを require し合っています (循環参照)。', fixes: ['共通の部分を 3 つ目のモジュールに分けます'] })],
  [/モジュール "([^"]*)" が見つかりません/, m => ({ why: `require で指定した「${m[1]}」がプロジェクトにありません。`, fixes: ['ファイル名とフォルダを確認します (左のファイル一覧)', 'require(script.Parent.モジュール名) の形で指定します'] })],
  [/attempt to yield across metamethod/, () => ({ why: 'メタメソッド (__index など) や並べ替えの比較関数の中では、task.wait() などの待機はできません。', fixes: ['待機する処理を外に出すか、task.spawn(function() ... end) の中で行います'] })],
  [/cannot resume dead coroutine/, () => ({ why: '終了したコルーチンをもう一度動かそうとしました。', fixes: ['coroutine.status(co) で状態を確認してから resume します'] })],
  [/readfile: ファイル "([^"]*)" がありません/, m => ({ why: `workspace フォルダに「${m[1]}」がありません。`, fixes: [`if isfile("${m[1]}") then ... end で、あるかどうかを先に確認します`, '左のファイル一覧の workspace フォルダにファイルを作ると、readfile で読めます'] })],
  [/base64decode: 不正/, () => ({ why: 'Base64 として正しくない文字列を渡しました。', fixes: ['文字列が途中で切れていないか確認します'] })],
  [/HTTP|fetch|CORS|ネットワーク|Failed to fetch|NetworkError/i, () => ({ why: 'インターネット上の URL を取得できませんでした。ブラウザの制限 (CORS) で、アクセスを許可していないサイトからは取得できません。', fixes: ['raw.githubusercontent.com や pastebin.com/raw などは取得できます', '実際のエグゼキューターでは動く場合があります (この画面だけの制限です)'] })],
  [/attempt to yield from outside a coroutine/, () => ({ why: '待機 (task.wait など) ができない場所で待機しようとしました。', fixes: ['task.spawn(function() ... end) の中で実行します'] })],
  [/string expected, got (\w+)|number expected, got (\w+)|table expected, got (\w+)/, m => ({ why: `渡した値の型が違います (${m[1] || m[2] || m[3]} が渡されました)。`, fixes: ['引数の順番と、変数の中身を確認します'] })],
]

export function explainError(message, ctx = {}) {
  if (!message) return null
  for (const [re, fn] of RULES) {
    const m = re.exec(message)
    if (m) {
      const r = fn(m, ctx)
      return { why: r.why, fixes: (r.fixes || []).filter(Boolean) }
    }
  }
  return null
}

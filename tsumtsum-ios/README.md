# TsumMod (iOS / 非脱獄 / eSign・KSign 用)

ツムツム用の注入 dylib と、それを入れた IPA を組み立てるツール一式。

> **状態**: フレームワークは完成しているが、**ゲーム固有の値（アドレス・構造体・タッチ処理）はまだ 1 つも入っていない**。
> そのままビルドして入れても、メニューは出るが全機能が「未設定」で無効になる。値は `tweak/src/GameConfig.hpp` に、
> 自分の復号済みバイナリから取ったものだけを入れる。

## 構成

| パス | 内容 |
|---|---|
| `tweak/src/GameConfig.hpp` | ビルド依存の値はすべてここ。全部 UNSET |
| `tweak/src/ChainSolver.*` | 盤面から最長チェーンを探す（純粋ロジック、テスト済み） |
| `tweak/src/AutoPlay.*` | チェーン → ドラッグ用タッチ列（Began/Moved/Ended）、停止時は必ず Ended |
| `tweak/src/ValueRules.hpp` | コイン/経験値の倍率（二重掛けしない）、半径の拡大と復元 |
| `tweak/src/Runtime.mm` | イメージ検索、UUID/バージョン照合、`vm_read_overwrite`/`vm_write` による安全な読み書き |
| `tweak/src/Features.mm` | 毎フレームの処理と機能ごとの有効/無効判定 |
| `tweak/src/Menu.mm` | ドラッグできる「TM」ボタンと設定パネル（ゲームへのタッチは素通し） |
| `tweak/build.sh` | macOS + Xcode で dylib をビルド |
| `tools/ipa_recon.py` | IPA の復号状態・UUID・エンジンを調べる |
| `tools/build_ipa.py` | 復号済み IPA に dylib を注入し（必要なら検証付きバイトパッチも当てて）新しい IPA を出力 |
| `.github/workflows/tsumtsum-ios.yml` | テスト + macOS ランナーで dylib をビルドし、Artifact として出す |

## 非脱獄で使える手段と使えない手段

- 使える: データ領域（ヒープ、`__DATA`）の読み書き、ゲーム内関数の**呼び出し**、ObjC のメソッド差し替え、
  IPA を作る前のバイナリ静的パッチ（eSign が署名し直すので通る）。
- 使えない: 実行時のコード書き換え（インラインフック）。署名済みページは書き換えられない。
  コードの挙動を変えたい場合は `tools/patches.json` の静的パッチで対応する。

## 手順

1. **復号済み IPA を用意する**（App Store 版は FairPlay で暗号化されている）。
   `python3 -I tools/ipa_recon.py Game.ipa` を実行し、解析・パッチ対象のバイナリがすべて `decrypted (cryptid 0)` になっていることを確認する。
2. 同じ出力からエンジンの手がかりと、bundle id・バージョン・コードの入ったイメージ名・UUID を確認し、`GameConfig.hpp` の `kBuild` に入れる。
3. 下の「値の探し方」に沿って各機能の値を埋める。埋まった機能だけがメニューで有効になる。
4. dylib をビルドする。GitHub に push すると Actions の `tsumtsum-ios` が `TsumMod-dylib` を出力する（Mac があれば `sh tweak/build.sh` でもよい）。
5. IPA を作る:
   ```
   python3 -I tools/build_ipa.py --ipa Game-decrypted.ipa --dylib TsumMod.dylib --out TsumTsum-Mod.ipa [--patches tools/patches.json]
   ```
   eSign/KSign 側の「dylib 注入」機能を使う場合は、手順 5 を飛ばして `TsumMod.dylib` を直接注入してもよい。
6. eSign / KSign で署名してインストールする。ログはアプリの Documents にある `TsumMod.log`。

## 値の探し方

まずエンジンを確定させる（手順 1 の結果次第で進め方が変わる）。

**Unity IL2CPP の場合**（`UnityFramework` と `global-metadata.dat` がある）
- `UnityFramework` と `global-metadata.dat` を Il2CppDumper / Cpp2IL にかける。メタデータが暗号化されていたら先にそれを解く。
- `dump.cs` で、プレイ結果・スコア・コインを持つクラスと、盤面のツム一覧を持つクラスを探す。
- static フィールドから辿るときは `XXX_TypeInfo` の RVA を `baseRva` にし、`Il2CppClass` の `static_fields` のオフセット、
  次にフィールドのオフセットを `offsets` に入れる。`static_fields` のオフセットは IL2CPP のバージョンで変わるので、
  そのダンプの `il2cpp.h` から読む。

**Cocos2d-x や独自エンジンの場合**
- プレイ結果を送る通信の文字列（コイン数・経験値を表すパラメータ名や API パス）から xref を辿って、送信データを組み立てる関数を見つける。
  そこで読んでいるオブジェクトとオフセットが per-play の値になる。そこから、そのオブジェクトを持つグローバルやシングルトンまで遡る。
- 盤面は、チェーン消去の処理（同じ種類のツムかどうかと距離を比べる部分）から、ツム配列と種類・座標のフィールドを特定する。
  距離比較の定数か変数が、チェーン補正で使うリンク半径の候補になる。

**確認**: 値を埋めたら、まずは倍率 x1 のまま入れて `TsumMod.log` で `identity ok` と各機能の availability を確認する。
その後で 1 機能ずつ有効にする。

**オートプレイのタッチ**: `kTouchBackend = GameFunction` は `void handler(int phase, float x, float y)` という形を前提にしている。
これはこのツール側の都合で決めた形で、ゲームの関数がこの形だという意味ではない。実際の関数の引数が違えば
`Features.mm` の `GameFunctionSink` をそれに合わせて書き換える。座標系（盤面座標かスクリーン座標か）は
`kBoardToScreen` で合わせる。

## 既知の制約

- コインと経験値は、プレイ結果としてサーバーに送られた値をサーバーが検証している可能性が高い。
  クライアントの値を書き換えても反映されるかどうかは、解析と実機確認をするまで分からない。
- 値が難読化されている（XOR などで隠されている）場合、`ValueType` の単純な整数としては扱えない。そのときは復号処理を特定してから対応する。

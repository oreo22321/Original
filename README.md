# LuaForge v3.0.1 — ビルド修正版・簡単公開セット

このセットはRenderで発生したビルドエラーを修正したものです。GitHubに置く3ファイル方式はこれまでと同じです。

## 既存のGitHubリポジトリを使っている場合

1. ZIPを展開します。
2. GitHubの `oreo22321/Original` リポジトリを開きます（別のリポジトリで運用している場合はそちら）。
3. リポジトリ直下にある古い `LuaForge_Source.zip` を、新しいZIP内の `LuaForge_Source.zip` で置き換えてコミットします。
4. RenderはGitHubの変更を同期し、自動で再デプロイします。自動デプロイされない場合はRenderのBlueprintで **Manual Sync** または **Deploy latest commit** を実行します。

## 新規に公開する場合

1. このZIPを展開します。
2. GitHubの空のリポジトリ直下に `README.md`、`render.yaml`、`LuaForge_Source.zip` の3ファイルをアップロードします。
3. Renderで **New + → Blueprint** を選び、GitHubリポジトリを接続して **Apply** を押します。

## 今回の修正内容

- HTMLの記号ショートカットで `data-insert` 属性に含まれていた不正な引用符を `&quot;` に変更。
- CodeMirrorの `Compartment` のimport元を `@codemirror/language` から `@codemirror/state` に修正。
- `indentUnit` と `indentRange` は `@codemirror/language` から読み込む構成を維持。

通常のLua / Luau編集にはAI APIキーは不要です。

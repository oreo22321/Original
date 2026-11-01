# LuaForge — スマホからRenderへ簡単公開するセット

このフォルダには3ファイルだけが入っています。
- `render.yaml`：Render Blueprint用設定
- `LuaForge_Source.zip`：LuaForge本体
- `README.md`：この手順書

## iPhone / Androidから公開する手順

1. このZIPを端末に保存し、「ファイル」アプリ等で展開します。
2. GitHubで新しい空のリポジトリを1つ作ります（README追加などは不要です）。
3. リポジトリの「Add file」→「Upload files」を開き、展開したフォルダ内の**3ファイル**をアップロードしてコミットします。3ファイルはリポジトリの一番上（ルート）に置いてください。
4. Renderにログインし、「New +」→「Blueprint」を選び、そのGitHubリポジトリを接続します。
5. `render.yaml` が表示されたら「Apply」を押します。
6. デプロイ完了後、Renderが表示する `https://...onrender.com` をSafari / Chromeで開きます。

これだけで通常のLua / Luau編集、AI不要の補完、Luau LSP、Roblox公式公開APIデータの準備が自動で行われます。通常利用にAI APIキーは不要です。

## Renderが自動で行うこと

Renderのビルド時にソースZIPを `app` フォルダへ展開し、Node依存関係、Linux用Luau Language Server、Roblox型定義・APIドキュメント、最新Studio API Dumpを準備してWebアプリをビルドします。サーバーは `app` フォルダから起動します。

## 注意

- 初回デプロイは外部配布元から依存関係と型定義を取得します。ネットワーク状況によっては失敗・再試行が必要です。
- AI補完は任意設定です。AIなしでもローカル補完とLSP補完は利用できます。ただし、AI生成の自由な複数行予測と完全に同等の推測性能ではありません。
- Roblox APIデータベースは公式の公開APIを対象にします。Executor固有の注入・回避・不正実行APIは含みません。
- Studioの実際のDataModel階層を解決するには、Rojo sourcemapやStudio Companion等の追加連携が必要です。
- Render Freeにはスリープ等の制約があります。

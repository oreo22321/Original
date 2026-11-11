#!/bin/bash
# Mac: ダブルクリックで起動 (動かないときは右クリック →「開く」)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[!] Node.js がインストールされていません。"
  echo "    開いたページから「LTS」版をインストールして、もう一度ダブルクリックしてください。"
  open "https://nodejs.org/ja"
  read -r -p "Enter で閉じます"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "初回の準備をしています... 1〜2分ほどお待ちください"
  npm install --omit=dev --no-fund --no-audit
fi

node src/index.js
echo ""
read -r -p "Bot が停止しました。Enter で閉じます"

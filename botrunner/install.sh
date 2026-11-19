#!/usr/bin/env bash
# BotRunner をインストールして、マシンが起動したら自動で動くようにします
#   Linux (Ubuntu / Debian / Raspberry Pi OS)・Oracle Cloud などの VPS・macOS・Android (Termux)
# 使い方:  bash install.sh            (ポートを変えるなら  PORT=9000 bash install.sh)
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"
PORT="${PORT:-8765}"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }

# ---- Python を用意
if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ]; then
  KIND=termux
  say "Termux に必要なものを入れます"
  pkg install -y python
elif [ "$(uname)" = "Darwin" ]; then
  KIND=mac
  command -v python3 >/dev/null || { echo "python3 がありません。https://www.python.org からインストールしてください"; exit 1; }
else
  KIND=linux
  if ! python3 -c 'import venv, ensurepip' >/dev/null 2>&1; then
    say "Python の venv を入れます (パスワードを聞かれたら、このマシンのログインパスワード)"
    sudo apt-get update -y && sudo apt-get install -y python3 python3-venv python3-pip
  fi
fi

PY=python3
[ "$KIND" = termux ] && PY=python
"$PY" - <<'EOF' || { echo "Python 3.9 以上が必要です"; exit 1; }
import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)
EOF

# ---- 専用の環境を作ってライブラリを入れる
say "ライブラリ (discord.py など) を入れます"
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/python -m pip install --upgrade pip >/dev/null
.venv/bin/python -m pip install -r requirements.txt

# ---- 自動起動の設定
CMD="$DIR/.venv/bin/python $DIR/server.py --port $PORT"
if [ "$KIND" = linux ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  say "マシンの起動時に自動で動くように設定します (systemd)"
  sudo tee /etc/systemd/system/botrunner.service >/dev/null <<EOF
[Unit]
Description=BotRunner (Discord bot manager)
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$DIR
ExecStart=$CMD
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now botrunner
  sudo systemctl restart botrunner
  sleep 3
  say "動いています。状態は  sudo systemctl status botrunner 、ログは  journalctl -u botrunner -f"
elif [ "$KIND" = termux ]; then
  mkdir -p ~/.termux/boot
  cat > ~/.termux/boot/botrunner.sh <<EOF
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd "$DIR" && nohup $CMD >> "$DIR/data/server.log" 2>&1 &
EOF
  chmod +x ~/.termux/boot/botrunner.sh
  mkdir -p data
  say "スマホの起動時に自動で動かすには、F-Droid から「Termux:Boot」アプリを入れて一度開いてください"
  say "今すぐ起動します (止めずにこのまま置いておく場合は、通知の Termux で「Acquire wakelock」を押してください)"
  termux-wake-lock 2>/dev/null || true
  exec $CMD
elif [ "$KIND" = mac ]; then
  PLIST=~/Library/LaunchAgents/com.botrunner.plist
  mkdir -p ~/Library/LaunchAgents data
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.botrunner</string>
  <key>ProgramArguments</key><array>
    <string>$DIR/.venv/bin/python</string><string>$DIR/server.py</string><string>--port</string><string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/data/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/server.log</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  sleep 3
  say "ログインしたら自動で動くように設定しました。Mac をスリープさせない設定 (システム設定 → バッテリー/省エネルギー) もしてください"
else
  say "自動起動は設定できませんでした。次のコマンドで起動してください:"
  echo "  $CMD"
  exit 0
fi

# ---- 開き方を表示
CODE_FILE="$DIR/data/setup-code.txt"
for _ in 1 2 3 4 5; do [ -f "$CODE_FILE" ] && break; sleep 1; done
echo
echo "────────────────────────────────────────"
echo " BotRunner の準備ができました"
echo "   このマシンで:  http://localhost:$PORT"
if command -v tailscale >/dev/null 2>&1 && tailscale ip -4 >/dev/null 2>&1; then
  echo "   Tailscale で:  http://$(tailscale ip -4 | head -1):$PORT"
fi
[ -f "$CODE_FILE" ] && echo "   初回の設定コード:  $(cat "$CODE_FILE")"
echo "────────────────────────────────────────"

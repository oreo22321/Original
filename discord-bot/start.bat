@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Discord Shop Bot

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js がインストールされていません。
  echo     開いたページから「LTS」版をダウンロードしてインストールし、
  echo     もう一度 start.bat をダブルクリックしてください。
  start https://nodejs.org/ja
  pause
  exit /b
)

if not exist node_modules (
  echo 初回の準備をしています... 1〜2分ほどお待ちください
  call npm install --omit=dev --no-fund --no-audit
)

node src\index.js
echo.
echo Bot が停止しました。
pause

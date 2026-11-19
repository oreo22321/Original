@echo off
rem BotRunner を Windows で起動します (ダブルクリックで OK)
rem PC の起動時に自動で動かすには: Win+R で shell:startup を開き、このファイルのショートカットを入れてください
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python がありません。https://www.python.org/downloads/ からインストールしてください
  echo インストール画面で「Add python.exe to PATH」にチェックを入れてください
  pause
  exit /b 1
)

if not exist .venv (
  echo 初回の準備をしています...
  py -3 -m venv .venv
  .venv\Scripts\python -m pip install --upgrade pip
  .venv\Scripts\python -m pip install -r requirements.txt
)

:loop
.venv\Scripts\python server.py
echo サーバーが止まりました。5 秒後にもう一度起動します (やめるときはこの窓を閉じてください)
timeout /t 5 >nul
goto loop

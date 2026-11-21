@echo off
rem Windows のバッチファイル (.bat) で起動する例です。
rem BotHost は .bat をそのまま動かせます (echo・set・if・for・goto・call・timeout など)。
rem python / py / pip / node / java / .exe も、このサーバーで動くものに置き換えて実行します。
chcp 65001 > nul
cd /d %~dp0
title My Bot
echo bot を起動します…

rem ライブラリは requirements.txt に書いておけば、起動の前に BotHost が入れます
py -3 main.py

echo 終了しました (コード %errorlevel%)
pause

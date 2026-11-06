@echo off
rem Run by Task Scheduler every 30 min: pull today's post and publish it to Naver (no-op if already published).
set "LOGDIR=%USERPROFILE%\.maniac-naver-work"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
cd /d "%~dp0"
echo ==== %date% %time% >> "%LOGDIR%\run.log"
git pull --ff-only origin claude/blog-daily >> "%LOGDIR%\run.log" 2>&1
node local_publish.js >> "%LOGDIR%\run.log" 2>&1

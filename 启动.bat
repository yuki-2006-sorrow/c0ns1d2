@echo off
cd /d "%~dp0"
echo Starting c0ns1d2 website...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0admin\start-site.ps1"
if errorlevel 1 (
  echo Start failed. Please check the message above.
  pause
  exit /b 1
)

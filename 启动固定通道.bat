@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "admin\start-fixed-remote.ps1"
if errorlevel 1 pause

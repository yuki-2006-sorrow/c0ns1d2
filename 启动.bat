@echo off
cd /d "%~dp0"
echo ============================================
echo   c0ns1d2  -  one-click start
echo   site:  http://localhost:4322/
echo   admin: http://localhost:4322/admin
echo ============================================
echo Building site (first time may be slow)...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed. Please check the message above.
  pause
  exit /b 1
)
echo Opening browser...
start "" cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:4322/admin"
echo Server running. Press Ctrl+C to stop.
node admin\server.mjs

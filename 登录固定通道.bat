@echo off
cd /d "%~dp0"
if exist ".local-collaboration\cloudflare-origin-cert.pem" (
  echo Authorization is already saved in the private project directory.
  echo Use the fixed tunnel startup batch file to connect your archive.
  pause
  exit /b 0
)
echo Select c0ns1d2.com in the Cloudflare authorization page.
"data-tools\bin\cloudflared.exe" tunnel login
echo.
if errorlevel 1 (
  echo The tool did not save authorization. Return the error message to this chat.
) else (
  echo After authorization, return to this chat. Do not send the certificate or password.
)
pause

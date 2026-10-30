@echo off
cd /d "%~dp0"
echo Select c0ns1d2.com in the Cloudflare authorization page.
"data-tools\bin\cloudflared.exe" tunnel login
echo.
echo After authorization, return to this chat. Do not send the certificate or password.
pause

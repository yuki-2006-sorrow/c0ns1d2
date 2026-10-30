$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (Test-Path -LiteralPath (Join-Path $projectDirectory '.local-collaboration/cloudflare-origin-cert.pem')) {
  Write-Output 'Authorization is already saved. Use the website launcher.'
  exit 0
}
& (Join-Path $projectDirectory 'data-tools/bin/cloudflared.exe') tunnel login
if ($LASTEXITCODE -ne 0) { throw 'Authorization could not be saved. Keep the error message; do not share the certificate.' }

param([switch]$NoBrowser, [switch]$LocalOnly)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-collaboration.ps1') -NoBrowser
  if ($LASTEXITCODE -ne 0) { throw 'The archive could not start.' }
  $fixed = Test-Path -LiteralPath (Join-Path $projectDirectory '.local-collaboration/fixed-remote.json')
  $url = 'http://127.0.0.1:4324/'
  if ($fixed -and !$LocalOnly) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-fixed-remote.ps1') -NoBrowser
    if ($LASTEXITCODE -ne 0) { throw 'The archive is available locally at http://127.0.0.1:4324/shared, but its public connection could not start.' }
    $url = 'https://c0ns1d2.com/'
  }
  $setupFile = Join-Path $projectDirectory '.local-collaboration/setup-token'
  if (Test-Path -LiteralPath $setupFile) { $url = 'http://127.0.0.1:4324/shared#setup=' + (Get-Content -LiteralPath $setupFile -Raw).Trim() }
  Write-Output 'Website ready. Use the same account and archive for browsing and editing.'
  if (!$NoBrowser) { Start-Process $url }
} catch { Write-Output $_.Exception.Message; exit 1 }

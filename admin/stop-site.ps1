param([switch]$KeepLocal)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'stop-remote.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'The public connection could not be stopped safely.' }
  if (!$KeepLocal) {
    $health = try { Invoke-RestMethod -Uri 'http://127.0.0.1:4324/api/health' -TimeoutSec 3 } catch { $null }
    if ($health) {
      if ($health.app -ne 'c0ns1d2-collaboration' -or $health.root -ne $projectDirectory) { throw 'Local archive identity mismatch; no local service was stopped.' }
      $archivePid = [int](Get-Content -LiteralPath (Join-Path $projectDirectory '.local-collaboration/server.lock') -Raw).Trim()
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$archivePid"
      if (!$process -or $process.Name -ne 'node.exe' -or !$process.CommandLine.Contains((Join-Path $projectDirectory 'admin/collaboration-server.mjs'))) { throw 'Process identity mismatch; no local service was stopped.' }
      Stop-Process -Id $archivePid
    }
  }
  Write-Output 'Website stopped. Your archive, photos and fixed address are preserved.'
} catch { Write-Output $_.Exception.Message; exit 1 }

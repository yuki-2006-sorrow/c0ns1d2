$ErrorActionPreference = 'Stop'
$archiveDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$remoteFile = Join-Path $archiveDirectory '.local-collaboration/remote-access.json'
try {
  if (!(Test-Path -LiteralPath $remoteFile)) { Write-Output 'No temporary tunnel is configured.'; exit 0 }
  $remote = Get-Content -LiteralPath $remoteFile -Raw | ConvertFrom-Json
  $tunnelProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$remote.tunnelPid)"
  if (!$tunnelProcess) { Write-Output 'Temporary tunnel is already stopped.'; exit 0 }
  $expectedExecutable = Join-Path $archiveDirectory 'data-tools/bin/cloudflared.exe'
  if ($tunnelProcess.ExecutablePath -ne $expectedExecutable -or $tunnelProcess.CommandLine -notlike '*http://127.0.0.1:4324*') { throw 'Process identity mismatch; no process was stopped.' }
  Stop-Process -Id $tunnelProcess.ProcessId
  Write-Output 'Temporary remote access stopped. Your local archive and saved content remain available.'
} catch { Write-Output $_.Exception.Message; exit 1 }

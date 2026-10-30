$ErrorActionPreference = 'Stop'
$archiveDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$remoteFile = Join-Path $archiveDirectory '.local-collaboration/remote-access.json'
try {
  if (!(Test-Path -LiteralPath $remoteFile)) { Write-Output 'No public connection is configured.'; exit 0 }
  $remote = Get-Content -LiteralPath $remoteFile -Raw | ConvertFrom-Json
  # A cold connection can finish after an earlier readiness check timed out.
  # Its process ID is already recorded here, even before remote-access updates.
  $fixedFile = Join-Path $archiveDirectory '.local-collaboration/fixed-remote.json'
  if ($remote.mode -eq 'fixed' -and (Test-Path -LiteralPath $fixedFile)) {
    $fixed = Get-Content -LiteralPath $fixedFile -Raw | ConvertFrom-Json
    if ($fixed.mode -ne 'fixed' -or $fixed.origin -ne $remote.origin -or $fixed.tunnelId -ne $remote.tunnelId) { throw 'Fixed connection identity mismatch; no process was stopped.' }
    $remote = $fixed
  }
  $tunnelProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$remote.tunnelPid)"
  if (!$tunnelProcess) { Write-Output 'The public connection is already stopped.'; exit 0 }
  $expectedExecutable = Join-Path $archiveDirectory 'data-tools/bin/cloudflared.exe'
  $expectedCommand = if ($remote.mode -eq 'fixed') {
    $remote.tunnelId -match '^[a-fA-F0-9-]{36}$' -and $tunnelProcess.CommandLine.Contains((Join-Path $archiveDirectory '.local-collaboration/fixed-tunnel.yml')) -and $tunnelProcess.CommandLine.Contains($remote.tunnelId)
  } else { $tunnelProcess.CommandLine -like '*http://127.0.0.1:4324*' }
  if ($tunnelProcess.ExecutablePath -ne $expectedExecutable -or !$expectedCommand) { throw 'Process identity mismatch; no process was stopped.' }
  Stop-Process -Id $tunnelProcess.ProcessId
  Write-Output 'Remote access stopped. Your local archive and saved content remain available.'
} catch { Write-Output $_.Exception.Message; exit 1 }

param([switch]$NoBrowser, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$address = 'http://127.0.0.1:4324'
Set-Location -LiteralPath $projectDirectory
function Get-Collaboration {
  try { return Invoke-RestMethod -Uri "$address/api/health" -TimeoutSec 2 }
  catch { return $null }
}
try {
  $frontendPrepared = $false
  $currentServer = Get-Collaboration
  if ($currentServer -and ($currentServer.app -ne 'c0ns1d2-collaboration' -or $currentServer.root -ne $projectDirectory)) {
    throw 'Port 4324 belongs to another service.'
  }
  if ($currentServer -and $currentServer.storageVersion -ne 2) {
    if (!$SkipBuild) {
      Write-Output 'Preparing the updated frontend while the existing archive stays online...'
      & npm.cmd run build
      if ($LASTEXITCODE -ne 0) { throw 'The frontend could not be prepared. The existing service remains running.' }
      $frontendPrepared = $true
    }
    $archivePid = [int](Get-Content -LiteralPath (Join-Path $projectDirectory '.local-collaboration/server.lock') -Raw).Trim()
    $oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$archivePid"
    if (!$oldProcess -or $oldProcess.Name -ne 'node.exe' -or !$oldProcess.CommandLine.Contains((Join-Path $PSScriptRoot 'collaboration-server.mjs'))) { throw 'Process identity mismatch; no service was stopped.' }
    Stop-Process -Id $archivePid
    Start-Sleep -Milliseconds 400
    $currentServer = $null
  }
  if (!$currentServer) {
    if (!$SkipBuild -and !$frontendPrepared) {
      Write-Output 'Preparing the archive frontend...'
      & npm.cmd run build
      if ($LASTEXITCODE -ne 0) { throw 'The frontend could not be prepared. Your saved archive has not been changed.' }
    }
    if (!(Test-Path -LiteralPath (Join-Path $projectDirectory 'dist/collaboration-shell/home/index.html'))) { throw 'Frontend templates are missing. Run the launcher without -SkipBuild.' }
    $nodeExecutable = (Get-Command node.exe).Source
    $logDirectory = Join-Path $projectDirectory 'data-tools'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $env:COLLAB_PORT = '4324'
    $env:COLLAB_ROOT = $projectDirectory
    $serverScript = Join-Path $PSScriptRoot 'collaboration-server.mjs'
    $runningProcess = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'collaboration-server.log') -RedirectStandardError (Join-Path $logDirectory 'collaboration-server-error.log') -PassThru
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      $currentServer = Get-Collaboration
      if ($currentServer -and $currentServer.app -eq 'c0ns1d2-collaboration' -and $currentServer.root -eq $projectDirectory) { break }
      if ($runningProcess.HasExited) { throw 'The collaboration service could not start. See data-tools/collaboration-server-error.log.' }
      Start-Sleep -Milliseconds 200
    }
    if (!$currentServer -or $currentServer.root -ne $projectDirectory) { throw 'The collaboration service did not become ready.' }
  }
  $url = "$address/shared"
  $setupFile = Join-Path $projectDirectory '.local-collaboration/setup-token'
  if (Test-Path -LiteralPath $setupFile) { $url += '#setup=' + (Get-Content -LiteralPath $setupFile -Raw).Trim() }
  Write-Output "Collaboration is ready: $address/shared"
  if (!$NoBrowser) { Start-Process $url }
} catch {
  Write-Output ('Could not start collaboration: ' + $_.Exception.Message)
  exit 1
}

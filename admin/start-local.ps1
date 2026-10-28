param([switch]$NoBrowser, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$adminAddress = 'http://127.0.0.1:4323'
Set-Location -LiteralPath $projectDirectory

function Get-LocalAdmin {
  try { return Invoke-RestMethod -Uri "$adminAddress/api/health" -TimeoutSec 2 }
  catch { return $null }
}

try {
  $existingAdmin = Get-LocalAdmin
  if ($existingAdmin -and ($existingAdmin.app -ne 'c0ns1d2-admin' -or $existingAdmin.root -ne $projectDirectory)) {
    throw 'Port 4323 belongs to a different project. Close that service before starting this project.'
  }
  if (!$SkipBuild) {
    Write-Output 'Building website...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Website build failed. Existing files have been kept.' }
  }
  if (!$existingAdmin) {
    $nodeExecutable = (Get-Command node.exe).Source
    $logDirectory = Join-Path $projectDirectory 'data-tools'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $env:PORT = '4323'
    $serverScript = Join-Path $PSScriptRoot 'server.mjs'
    $adminProcess = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'local-admin.log') -RedirectStandardError (Join-Path $logDirectory 'local-admin-error.log') -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      $readyAdmin = Get-LocalAdmin
      if ($readyAdmin -and $readyAdmin.app -eq 'c0ns1d2-admin' -and $readyAdmin.root -eq $projectDirectory) { break }
      if ($adminProcess.HasExited) { throw 'The local server could not start. See data-tools/local-admin-error.log.' }
      Start-Sleep -Milliseconds 200
    }
    if (!$readyAdmin -or $readyAdmin.app -ne 'c0ns1d2-admin' -or $readyAdmin.root -ne $projectDirectory) { throw 'The local server did not become ready. See data-tools/local-admin-error.log.' }
  }
  Write-Output "Local editor is ready: $adminAddress/admin"
  if (!$NoBrowser) { Start-Process "$adminAddress/admin" }
} catch {
  Write-Output ("Could not start local editor: " + $_.Exception.Message)
  exit 1
}

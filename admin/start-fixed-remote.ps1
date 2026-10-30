param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$archiveDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $archiveDirectory
$localAddress = 'http://127.0.0.1:4324'
$fixedOrigin = 'https://backend.c0ns1d2.com'
$tunnelName = 'c0ns1d2-home'
$tunnelExecutable = Join-Path $archiveDirectory 'data-tools/bin/cloudflared.exe'
$privateDirectory = Join-Path $archiveDirectory '.local-collaboration'
$certFile = Join-Path $env:USERPROFILE '.cloudflared/cert.pem'
$credentialsFile = Join-Path $privateDirectory 'fixed-tunnel-credentials.json'
$tunnelConfig = Join-Path $privateDirectory 'fixed-tunnel.yml'
$fixedStateFile = Join-Path $privateDirectory 'fixed-remote.json'
$remoteFile = Join-Path $privateDirectory 'remote-access.json'
$entryFile = Join-Path $archiveDirectory 'deployment/remote-origin.json'
$utf8 = New-Object Text.UTF8Encoding($false)
function Invoke-Cloudflare([string[]]$CommandArguments) {
  $outFile = Join-Path $archiveDirectory 'data-tools/fixed-command.log'
  $errorFile = Join-Path $archiveDirectory 'data-tools/fixed-command-error.log'
  $quotedArguments = ($CommandArguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $command = Start-Process -FilePath $tunnelExecutable -ArgumentList $quotedArguments -WorkingDirectory $archiveDirectory -WindowStyle Hidden -RedirectStandardOutput $outFile -RedirectStandardError $errorFile -Wait -PassThru
  if ($command.ExitCode -ne 0) { throw 'Cloudflare command failed. See data-tools/fixed-command-error.log. Existing DNS records are never overwritten automatically.' }
  return Get-Content -LiteralPath $outFile -Raw
}
function Get-ArchiveHealth {
  try { return Invoke-RestMethod -Uri ($localAddress + '/api/health') -TimeoutSec 3 } catch { return $null }
}
function Restart-Archive {
  $identity = Get-ArchiveHealth
  if ($identity -and ($identity.app -ne 'c0ns1d2-collaboration' -or $identity.root -ne $archiveDirectory)) { throw 'Local archive identity mismatch.' }
  if ($identity) {
    $archiveProcessId = [int](Get-Content -LiteralPath (Join-Path $privateDirectory 'server.lock') -Raw).Trim()
    $archiveProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$archiveProcessId"
    $expectedScript = Join-Path $archiveDirectory 'admin/collaboration-server.mjs'
    if (!$archiveProcess -or $archiveProcess.Name -ne 'node.exe' -or !$archiveProcess.CommandLine.Contains($expectedScript)) { throw 'Archive process identity mismatch; nothing was stopped.' }
    Stop-Process -Id $archiveProcessId
    Start-Sleep -Milliseconds 400
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-collaboration.ps1') -NoBrowser -SkipBuild
  if ($LASTEXITCODE -ne 0) { throw 'Archive could not start.' }
}
function Test-FixedArchive {
  for ($probe=0; $probe -lt 5; $probe++) {
    try {
      $health = Invoke-RestMethod -Uri ($fixedOrigin + '/api/health') -TimeoutSec 8
      if ($health.app -eq 'c0ns1d2-collaboration') { return $true }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  return $false
}
try {
  if (!(Test-Path -LiteralPath $tunnelExecutable)) { throw 'Cloudflare executable is missing.' }
  if (!(Test-Path -LiteralPath $certFile)) { throw 'Cloudflare authorization is missing. Run the login batch file in the project folder and select c0ns1d2.com.' }
  if (!(Test-Path -LiteralPath (Join-Path $privateDirectory 'archive.json'))) { throw 'Set up your owner account locally before remote access.' }
  if (!(Test-Path -LiteralPath (Join-Path $archiveDirectory 'dist/collaboration-shell/home/index.html'))) { throw 'Build the archive frontend first: npm run build.' }
  New-Item -ItemType Directory -Path (Join-Path $archiveDirectory 'data-tools') -Force | Out-Null
  $health = Get-ArchiveHealth
  if ($health -and ($health.app -ne 'c0ns1d2-collaboration' -or $health.root -ne $archiveDirectory)) { throw 'Port 4324 belongs to a different archive.' }
  $tunnels = @(Invoke-Cloudflare -CommandArguments @('tunnel','--origincert',$certFile,'list','--output','json') | ConvertFrom-Json | Where-Object { $_.name -eq $tunnelName })
  if ($tunnels.Count -gt 1) { throw 'Multiple matching tunnels found; choose the intended tunnel before continuing.' }
  if ($tunnels.Count -eq 0) {
    if (Test-Path -LiteralPath $credentialsFile) { throw 'A local credentials file already exists. It has not been overwritten.' }
    $null = Invoke-Cloudflare -CommandArguments @('tunnel','--origincert',$certFile,'create','--credentials-file',$credentialsFile,$tunnelName)
  }
  if (!(Test-Path -LiteralPath $credentialsFile)) { throw 'The named tunnel exists but this computer has no matching credentials. Existing tunnels were kept.' }
  $credentials = Get-Content -LiteralPath $credentialsFile -Raw | ConvertFrom-Json
  $tunnelId = [string]$credentials.TunnelID
  if ($tunnelId -notmatch '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$') { throw 'Invalid local tunnel ID.' }
  if ($tunnels.Count -eq 1 -and $tunnels[0].id -ne $tunnelId) { throw 'Tunnel credentials do not match the named tunnel.' }
  $yaml = "tunnel: $tunnelId`ncredentials-file: '" + $credentialsFile.Replace('\','/').Replace("'","''") + "'`nprotocol: http2`ningress:`n  - hostname: backend.c0ns1d2.com`n    service: http://127.0.0.1:4324`n  - service: http_status:404`n"
  [IO.File]::WriteAllText($tunnelConfig,$yaml,$utf8)
  $null = Invoke-Cloudflare -CommandArguments @('tunnel','--config',$tunnelConfig,'ingress','validate')
  $null = Invoke-Cloudflare -CommandArguments @('tunnel','--origincert',$certFile,'route','dns',$tunnelId,'backend.c0ns1d2.com')
  $tunnelProcess = $null
  if (Test-Path -LiteralPath $fixedStateFile) {
    $savedState = Get-Content -LiteralPath $fixedStateFile -Raw | ConvertFrom-Json
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$savedState.tunnelPid)"
    if ($existing) {
      if ($existing.ExecutablePath -ne $tunnelExecutable -or !$existing.CommandLine.Contains($tunnelConfig) -or !$existing.CommandLine.Contains($tunnelId)) { throw 'Stored process ID belongs to another process; nothing was stopped.' }
      $tunnelProcess = $existing
    }
  }
  if (!$tunnelProcess) {
    $arguments = 'tunnel --config "' + $tunnelConfig + '" --no-autoupdate run ' + $tunnelId
    $tunnelProcess = Start-Process -FilePath $tunnelExecutable -ArgumentList $arguments -WorkingDirectory $archiveDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $archiveDirectory 'data-tools/fixed-tunnel.log') -RedirectStandardError (Join-Path $archiveDirectory 'data-tools/fixed-tunnel-error.log') -PassThru
  }
  $tunnelPid = if ($tunnelProcess.ProcessId) { $tunnelProcess.ProcessId } else { $tunnelProcess.Id }
  $state = @{mode='fixed';origin=$fixedOrigin;tunnelId=$tunnelId;tunnelPid=$tunnelPid;startedAt=[DateTime]::UtcNow.ToString('o')}
  [IO.File]::WriteAllText($fixedStateFile,($state | ConvertTo-Json),$utf8)
  $previousRemote = if (Test-Path -LiteralPath $remoteFile) { [IO.File]::ReadAllBytes($remoteFile) } else { $null }
  $archiveHash = (Get-FileHash -LiteralPath (Join-Path $privateDirectory 'archive.json') -Algorithm SHA256).Hash
  $changedBackend = !$health -or $health.publicOrigin -ne $fixedOrigin
  if ($changedBackend) {
    [IO.File]::WriteAllText($remoteFile,($state | ConvertTo-Json),$utf8)
    try {
      Restart-Archive
      $ready = Get-ArchiveHealth
      if ($ready.publicOrigin -ne $fixedOrigin -or !(Test-FixedArchive)) { throw 'Fixed address is not ready. Existing website deployment settings have been kept.' }
    } catch {
      $failure = $_
      if ($null -ne $previousRemote) { [IO.File]::WriteAllBytes($remoteFile,$previousRemote) } else { Remove-Item -LiteralPath $remoteFile -Force }
      Restart-Archive
      throw $failure
    }
  } elseif (!(Test-FixedArchive)) { throw 'Fixed tunnel is not responding. Existing website deployment settings have been kept.' }
  if (!(Invoke-RestMethod -Uri ($localAddress + '/api/status') -TimeoutSec 3).setup) { throw 'Create your owner account locally before publishing.' }
  if ((Get-FileHash -LiteralPath (Join-Path $privateDirectory 'archive.json') -Algorithm SHA256).Hash -ne $archiveHash) { throw 'Archive data changed during setup; verify saved content before publishing.' }
  [IO.File]::WriteAllText($remoteFile,($state | ConvertTo-Json),$utf8)
  $entry = Get-Content -LiteralPath $entryFile -Raw | ConvertFrom-Json
  $entry.upstream = $fixedOrigin
  [IO.File]::WriteAllText($entryFile,($entry | ConvertTo-Json -Depth 4),$utf8)
  Write-Output 'Fixed archive ready: https://backend.c0ns1d2.com'
  Write-Output 'Publish the updated deployment/remote-origin.json once to connect Pages. Restarting this named tunnel keeps its address.'
  if (!$NoBrowser) { Start-Process 'https://c0ns1d2.com/' }
} catch {
  Write-Output ('Fixed tunnel setup could not complete: ' + $_.Exception.Message)
  exit 1
}

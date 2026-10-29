param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$archiveDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $archiveDirectory
$localAddress = 'http://127.0.0.1:4324'
$remoteFile = Join-Path $archiveDirectory '.local-collaboration/remote-access.json'
$tunnelExecutable = Join-Path $archiveDirectory 'data-tools/bin/cloudflared.exe'
try {
  if (!(Test-Path -LiteralPath $tunnelExecutable)) { throw 'Cloudflare tool missing: data-tools/bin/cloudflared.exe. See docs/公网试用.md.' }
  $health = Invoke-RestMethod -Uri "$localAddress/api/health" -TimeoutSec 3
  if ($health.app -ne 'c0ns1d2-collaboration' -or $health.root -ne $archiveDirectory) { throw 'Local archive identity mismatch.' }
  if (!(Invoke-RestMethod -Uri "$localAddress/api/status").setup) { throw 'Create your owner account locally before starting remote access.' }
  if (Test-Path -LiteralPath $remoteFile) {
    $previous = Get-Content -LiteralPath $remoteFile -Raw | ConvertFrom-Json
    $previousProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$previous.tunnelPid)"
    if ($previousProcess -and $previousProcess.ExecutablePath -eq $tunnelExecutable -and $health.publicOrigin -eq $previous.origin) {
      Write-Output "Remote archive: $($previous.origin)"
      if (!$NoBrowser) { Start-Process $previous.origin }
      exit 0
    }
    if ($previousProcess) { throw 'An existing tunnel needs attention. Its process has been kept.' }
  }
  $tunnelOutput = Join-Path $archiveDirectory 'data-tools/quick-tunnel.log'
  $tunnelError = Join-Path $archiveDirectory 'data-tools/quick-tunnel-error.log'
  $tunnelProcess = Start-Process -FilePath $tunnelExecutable -ArgumentList @('tunnel','--no-autoupdate','--protocol','http2','--url',$localAddress) -WorkingDirectory $archiveDirectory -WindowStyle Hidden -RedirectStandardOutput $tunnelOutput -RedirectStandardError $tunnelError -PassThru
  $remoteOrigin = $null
  for ($attempt=0; $attempt -lt 100; $attempt++) {
    $log = (Get-Content -LiteralPath $tunnelError -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $tunnelOutput -Raw -ErrorAction SilentlyContinue)
    if ($log -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $remoteOrigin=$Matches[0]; break }
    if ($tunnelProcess.HasExited) { throw 'The temporary tunnel could not start. See data-tools/quick-tunnel-error.log.' }
    Start-Sleep -Milliseconds 300
  }
  if (!$remoteOrigin) { Stop-Process -Id $tunnelProcess.Id; throw 'Cloudflare did not return an address in time.' }
  @{origin=$remoteOrigin;tunnelPid=$tunnelProcess.Id;startedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $remoteFile -Encoding utf8
  $entryConfiguration = @{upstream=$remoteOrigin;publicOrigin='https://c0ns1d2.pages.dev'} | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $archiveDirectory 'deployment/remote-origin.json'),$entryConfiguration,(New-Object Text.UTF8Encoding($false)))
  $archiveHash = (Get-FileHash -LiteralPath .local-collaboration/archive.json -Algorithm SHA256).Hash
  $archiveProcessId = [int](Get-Content -LiteralPath .local-collaboration/server.lock -Raw).Trim()
  $archiveProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$archiveProcessId"
  if (!$archiveProcess -or $archiveProcess.Name -ne 'node.exe' -or $archiveProcess.CommandLine -notlike '*collaboration-server.mjs*') { throw 'Archive process identity mismatch.' }
  Stop-Process -Id $archiveProcessId
  Start-Sleep -Milliseconds 400
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-collaboration.ps1') -NoBrowser -SkipBuild
  if ($LASTEXITCODE -ne 0) { throw 'Archive restart failed.' }
  $ready = Invoke-RestMethod -Uri "$localAddress/api/health"
  if ($ready.publicOrigin -ne $remoteOrigin) { throw 'Remote address was not loaded.' }
  if ((Get-FileHash -LiteralPath .local-collaboration/archive.json -Algorithm SHA256).Hash -ne $archiveHash) { throw 'Archive data changed during restart; verify your saved content.' }
  Write-Output "Remote archive: $remoteOrigin"
  Write-Output 'Keep this computer and tunnel running. Restarting the tunnel changes its address.'
  Write-Output 'A new address also needs the updated deployment/remote-origin.json published to the main website.'
  if (!$NoBrowser) { Start-Process $remoteOrigin }
} catch {
  Write-Output ('Remote access could not start: ' + $_.Exception.Message)
  exit 1
}

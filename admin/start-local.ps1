param([switch]$NoBrowser, [switch]$SkipBuild)
# Old shortcuts enter the same archive, with no public tunnel.
if ($NoBrowser) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-site.ps1') -LocalOnly -NoBrowser
} else {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-site.ps1') -LocalOnly
}
exit $LASTEXITCODE

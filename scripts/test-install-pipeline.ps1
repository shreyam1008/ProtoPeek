[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$Checksums,
    [Parameter(Mandatory=$true)][string]$FixtureRoot,
    [string]$ScriptUrl = ''
)
$ErrorActionPreference = 'Stop'
$Installer = [IO.Path]::GetFullPath($Installer)
$env:PROTOPEEK_DOWNLOAD_URL = [IO.Path]::GetFullPath($Archive)
$env:PROTOPEEK_CHECKSUM_URL = [IO.Path]::GetFullPath($Checksums)
$env:PROTOPEEK_INSTALL_DIR = Join-Path ([IO.Path]::GetFullPath($FixtureRoot)) 'pipeline install with spaces'
$env:PROTOPEEK_VERSION = 'v0.6.0'
$env:PROTOPEEK_NO_PATH_UPDATE = '1'
$env:PROTOPEEK_NO_SHORTCUTS = '1'
Set-Location (Join-Path $env:WINDIR 'System32')
if ($ScriptUrl) { Invoke-RestMethod -Uri $ScriptUrl | Invoke-Expression }
else { Get-Content -LiteralPath $Installer -Raw | Invoke-Expression }
$canonical = Join-Path $env:PROTOPEEK_INSTALL_DIR 'protopeek.exe'
$alias = Join-Path $env:PROTOPEEK_INSTALL_DIR 'pp.exe'
if (-not (Test-Path -LiteralPath $canonical) -or -not (Test-Path -LiteralPath $alias)) { throw 'Pipeline install did not produce both commands.' }
Assert-Executable $canonical
# An interrupted/empty marker must not crash an otherwise valid update.
[IO.File]::WriteAllText((Join-Path $env:PROTOPEEK_INSTALL_DIR '.protopeek-install'), '')
if ($ScriptUrl) { Invoke-RestMethod -Uri $ScriptUrl | Invoke-Expression }
else { Get-Content -LiteralPath $Installer -Raw | Invoke-Expression }
Assert-Executable $alias
Write-Host "Pipeline install and empty-marker update passed on PowerShell $($PSVersionTable.PSVersion)."

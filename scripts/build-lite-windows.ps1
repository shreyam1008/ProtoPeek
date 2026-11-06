[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $destination) {
    throw 'Output directory already exists. Choose a new directory; existing files will not be replaced.'
}
if ([Environment]::Is64BitOperatingSystem -eq $false -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'This local preview builder requires native Windows amd64.'
}
$goTargetOS = & go env GOOS
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Go target OS.' }
$goTargetArch = & go env GOARCH
if ($LASTEXITCODE -ne 0 -or $goTargetOS -ne 'windows' -or $goTargetArch -ne 'amd64') {
    throw 'The Go target must be windows/amd64. Clear any cross-compilation override and retry.'
}

# Read the same pins used by the Go loader. A changed or ambiguous declaration
# fails closed rather than silently staging a different engine.
$constants = Get-Content -LiteralPath (Join-Path $root 'internal/bundledaria2/companion.go') -Raw
function Read-Pin([string]$Pattern) {
    $matchesFound = [regex]::Matches($constants, $Pattern, [Text.RegularExpressions.RegexOptions]::Multiline)
    if ($matchesFound.Count -ne 1) { throw 'Companion metadata could not be read unambiguously.' }
    return $matchesFound[0].Groups[1].Value
}
$name = Read-Pin '^\s*CompanionFilename\s*=\s*"([a-zA-Z0-9._-]+)"'
$digest = Read-Pin '^\s*windowsArchiveSHA\s*=\s*"([a-f0-9]{64})"'
$size = [long](Read-Pin '^\s*windowsArchiveSize\s*=\s*([0-9]+)')
if (-not $name.StartsWith('protopeek-', [StringComparison]::Ordinal)) { throw 'Unexpected companion name.' }
$asset = Join-Path $root ('internal/bundledaria2/assets/' + $name.Substring('protopeek-'.Length))
$file = Get-Item -LiteralPath $asset
if (-not $file.PSIsContainer -and $file.Length -eq $size -and (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash -ieq $digest) {
    New-Item -ItemType Directory -Path $destination | Out-Null
} else {
    throw 'Companion archive does not match the source pins.'
}

Push-Location $root
try {
    foreach ($command in @('protopeek', 'pp')) {
        & go build -trimpath -ldflags '-s -w' -tags protopeek_lite -o (Join-Path $destination "$command.exe") "./cmd/$command"
        if ($LASTEXITCODE -ne 0) { throw "Building $command failed; inspect the preserved output directory." }
    }
    Copy-Item -LiteralPath $asset -Destination (Join-Path $destination $name)
    Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination $destination
    Copy-Item -LiteralPath (Join-Path $root 'THIRD_PARTY_NOTICES.md') -Destination $destination
    Copy-Item -LiteralPath (Join-Path $root 'internal/bundledaria2/README.md') -Destination (Join-Path $destination 'aria2-provenance.md')
    Copy-Item -LiteralPath (Join-Path $root 'internal/bundledaria2/notices') -Destination (Join-Path $destination 'aria2-notices') -Recurse
    Write-Host "Local lightweight preview created in $destination"
    Write-Host 'Keep the companion ZIP beside both executables. This preview is not a published release or updater package.'
} finally {
    Pop-Location
}

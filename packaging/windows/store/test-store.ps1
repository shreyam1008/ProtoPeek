param(
    [Parameter(Mandatory)][string]$WorkDirectory,
    [Parameter(Mandatory)][string]$LegacyDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$out = (New-Item -ItemType Directory -Path $WorkDirectory).FullName
$buildStore = Join-Path $PSScriptRoot 'build-store.ps1'

function Assert-PackagedEngine([string]$PackageDir, [string]$ExpectedSidecar) {
    $receipt = Get-Content -Raw -LiteralPath (Join-Path $PackageDir 'build-receipt.json') | ConvertFrom-Json
    $msix = [IO.Compression.ZipFile]::OpenRead($receipt.package)
    try {
        foreach ($aliasName in 'protopeek.exe','pp.exe') {
            if (!$msix.GetEntry($aliasName)) { throw "MSIX missing $aliasName." }
        }
        $entries = @($msix.Entries | Where-Object Name -Like 'protopeek-aria2-*.zip')
        if ($ExpectedSidecar) {
            $name = [IO.Path]::GetFileName($ExpectedSidecar)
            if ($entries.Count -ne 1 -or $entries[0].FullName -cne $name -or $receipt.companionName -cne $name) { throw 'MSIX lacks its adjacent offline sidecar.' }
            $stream = $entries[0].Open()
            try { $hash = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash } finally { $stream.Dispose() }
            if ($hash -ine $receipt.companionSha256 -or $hash -ine (Get-FileHash -LiteralPath $ExpectedSidecar).Hash) { throw 'MSIX sidecar checksum mismatch.' }
        } elseif ($entries.Count -ne 0 -or $receipt.companionSha256) {
            throw 'Unexpected separate sidecar in the historical embedded-engine package.'
        }
    } finally { $msix.Dispose() }
}
$legacyOut = Join-Path $out 'legacy-package'
& $buildStore -Tag v0.7.0 -ReleaseArchive (Join-Path $LegacyDirectory 'protopeek_0.7.0_windows_x86_64.zip') -Checksums (Join-Path $LegacyDirectory 'checksums.txt') -OutputDirectory $legacyOut
Assert-PackagedEngine $legacyOut ''
Write-Output 'PASS historical release packaged with its embedded engine.'

# Build a local SemVer fixture for MakeAppx. No release, signing or Store account is used.
$bin = (New-Item -ItemType Directory -Path (Join-Path $out 'core')).FullName
Push-Location $root
try {
    foreach ($aliasName in 'pp','protopeek') {
        go build -trimpath -tags protopeek_lite -ldflags '-s -w -X main.version=v0.0.0' -o (Join-Path $bin "$aliasName.exe") "./cmd/$aliasName"
        if ($LASTEXITCODE -ne 0) { throw "Could not build $aliasName." }
    }
    Copy-Item -LiteralPath LICENSE, THIRD_PARTY_NOTICES.md -Destination $bin
    Copy-Item -LiteralPath internal/bundledaria2/notices -Recurse -Destination (Join-Path $bin 'aria2-notices')
} finally { Pop-Location }
$archive = Join-Path $out 'protopeek_0.0.0_windows_x86_64.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($bin,$archive)
$assets = @(Get-ChildItem -File -LiteralPath (Join-Path $root 'internal/bundledaria2/assets') -Filter '*-win-64bit-build*.zip')
if ($assets.Count -ne 1) { throw 'Expected one Windows aria2 reference ZIP.' }
$sidecar = Join-Path $out ('protopeek-' + $assets[0].Name)
Copy-Item -LiteralPath $assets[0].FullName -Destination $sidecar
$checksums = Join-Path $out 'checksums.txt'
function Write-InputChecksums {
    @($archive, $sidecar) | ForEach-Object { (Get-FileHash -LiteralPath $_).Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($_) } | Set-Content -LiteralPath $checksums -Encoding ascii
}
Write-InputChecksums
$inputs = @{ Tag='v0.0.0'; ReleaseArchive=$archive; Checksums=$checksums; CompanionArchive=$sidecar }
$currentOut = Join-Path $out 'current-package'
& $buildStore @inputs -OutputDirectory $currentOut
Assert-PackagedEngine $currentOut $sidecar
Write-Output 'PASS packaged lightweight core and correctly pinned offline sidecar.'

# An internally consistent release checksum alone cannot authorize a changed payload.
$bytes = [IO.File]::ReadAllBytes($sidecar)
$bytes[0] = $bytes[0] -bxor 1
[IO.File]::WriteAllBytes($sidecar, $bytes)
Write-InputChecksums
try { & $buildStore @inputs -OutputDirectory (Join-Path $out 'changed-package') }
catch {
    if ($_.Exception.Message -notlike 'The release executable rejected the local sidecar*') { throw }
    Write-Output 'PASS current executable rejected changed sidecar even with its matching release checksum.'
    return
}
throw 'A changed sidecar was accepted.'

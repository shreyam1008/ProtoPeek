param(
    [Parameter(Mandatory)][ValidatePattern('^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')][string]$Tag,
    [Parameter(Mandatory)][string]$ReleaseArchive,
    [Parameter(Mandatory)][string]$Checksums,
    [string]$CompanionArchive,
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$version = $Tag.Substring(1)
foreach ($part in $version.Split('.')) {
    if ([long]$part -gt 65535) { throw 'MSIX version components must be at most 65535.' }
}
$archive = (Resolve-Path -LiteralPath $ReleaseArchive).Path
$expectedName = "protopeek_${version}_windows_x86_64.zip"
if ([IO.Path]::GetFileName($archive) -cne $expectedName) { throw "Expected $expectedName" }
$checksumLines = @(Get-Content -LiteralPath $Checksums)
function Get-VerifiedReleaseHash([string]$Path) {
    $name = [IO.Path]::GetFileName($Path)
    $entries = @($checksumLines | Where-Object { $_ -cmatch ('^[0-9a-fA-F]{64}\s+\*?' + [regex]::Escape($name) + '$') })
    if ($entries.Count -ne 1) { throw "Expected one exact release checksum for $name." }
    $expected = ($entries[0] -split '\s+')[0].ToLowerInvariant()
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $expected) { throw "Release checksum mismatch for $name." }
    $expected
}
$expectedHash = Get-VerifiedReleaseHash $archive
$companionPattern = 'protopeek-aria2-[0-9A-Za-z._-]+-win-64bit-build[0-9]+\.zip'
$listedCompanions = @($checksumLines | Where-Object { $_ -cmatch ("\s+\*?$companionPattern" + '$') })
$companionHash = $null
$companionName = $null
if ($CompanionArchive) {
    $CompanionArchive = (Resolve-Path -LiteralPath $CompanionArchive).Path
    $companionName = [IO.Path]::GetFileName($CompanionArchive)
    if ($companionName -cnotmatch ('^' + $companionPattern + '$') -or $listedCompanions.Count -ne 1) { throw 'Expected exactly one named Windows aria2 sidecar in the release.' }
    $companionHash = Get-VerifiedReleaseHash $CompanionArchive
} elseif ($listedCompanions.Count -gt 0) {
    throw 'The release checksum manifest requires its separate Windows aria2 sidecar.'
}
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "dist/store/$Tag" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$out = (Resolve-Path -LiteralPath $OutputDirectory).Path
$package = Join-Path $out "ProtoPeek_${version}.0_x64.msix"
if (Test-Path -LiteralPath $package) { throw 'Package already exists. Use a fresh output directory; never replace published assets.' }
$stage = Join-Path $out ('stage-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $archive -DestinationPath $stage
foreach ($required in @('protopeek.exe','pp.exe','LICENSE','THIRD_PARTY_NOTICES.md','aria2-notices')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $required))) { throw "Missing release content: $required" }
}
if (@(Get-ChildItem -LiteralPath $stage -Filter 'protopeek-aria2-*.zip').Count -gt 0) { throw 'Unexpected sidecar inside the release archive.' }
foreach ($aliasName in 'protopeek', 'pp') {
    $exe = Join-Path $stage "$aliasName.exe"
    $build = & go version -m -json $exe | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $build.Path -cne "github.com/shreyam1008/ProtoPeek/cmd/$aliasName") { throw "Invalid build identity for $aliasName." }
    $tags = @($build.Settings | Where-Object Key -eq '-tags' | ForEach-Object { $_.Value -split '[,\s]+' })
    if (($tags -ccontains 'protopeek_lite') -ne [bool]$CompanionArchive) { throw "A lightweight $aliasName must ship with its separately verified Store sidecar." }
}
if ($CompanionArchive) {
    Copy-Item -LiteralPath $CompanionArchive -Destination (Join-Path $stage $companionName)
    # The released executable owns the size, name, and SHA-256 pins. A fresh
    # cache ensures only its adjacent, verified ZIP can satisfy this check.
    $check = [Diagnostics.ProcessStartInfo]::new((Join-Path $stage 'pp.exe'), 'extensions status aria2')
    $check.UseShellExecute = $false
    $check.RedirectStandardOutput = $true
    $check.EnvironmentVariables['LOCALAPPDATA'] = Join-Path $out ('verify-' + [guid]::NewGuid().ToString('N'))
    $child = [Diagnostics.Process]::Start($check)
    try {
        $status = $child.StandardOutput.ReadToEnd() | ConvertFrom-Json
        $child.WaitForExit()
        if ($child.ExitCode -ne 0 -or $status.id -cne 'aria2' -or $status.status -cne 'available' -or !$status.canInstall -or $status.installBytes -ne 0 -or $status.PSObject.Properties['sourceUrl']) {
            throw 'The release executable rejected the local sidecar or would require an online installation.'
        }
    } finally { $child.Dispose() }
}
$reportedVersion = & (Join-Path $stage 'protopeek.exe') -version 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $reportedVersion -notmatch ('(?<![\w.])' + [regex]::Escape($Tag) + '(?![\w.-])')) { throw "Executable does not report $Tag" }
[xml]$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'AppxManifest.xml') -Raw
$manifest.Package.Identity.Version = "$version.0"
$manifest.Save((Join-Path $stage 'AppxManifest.xml'))
New-Item -ItemType Directory -Path (Join-Path $stage 'Assets') | Out-Null
# Resize the established logo; retain its proportions and original source unchanged.
Add-Type -AssemblyName System.Drawing
$logoPath = Join-Path $repoRoot 'web/site/public/icon-512.png'
$logoHash = (Get-FileHash -LiteralPath $logoPath).Hash
$logo = [System.Drawing.Image]::FromFile($logoPath)
try {
    foreach ($asset in @(@('StoreLogo',50), @('Square44x44Logo',44), @('Square150x150Logo',150), @('ListingLogo',300))) {
        $size = [int]$asset[1]
        $bitmap = [System.Drawing.Bitmap]::new($size,$size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $scale = [Math]::Min($size / $logo.Width, $size / $logo.Height)
            $width = [int]($logo.Width * $scale); $height = [int]($logo.Height * $scale)
            $graphics.DrawImage($logo, [int](($size-$width)/2), [int](($size-$height)/2), $width, $height)
            $bitmap.Save((Join-Path $stage ('Assets/' + $asset[0] + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $logo.Dispose() }
if ((Get-FileHash -LiteralPath $logoPath).Hash -ne $logoHash) { throw 'Original logo changed.' }
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$sdk = Get-ChildItem -LiteralPath $sdkRoot -Directory | Where-Object { $_.Name -match '^10\.0\.\d+\.0$' } | Sort-Object { [version]$_.Name } -Descending | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'x64/makeappx.exe') } | Select-Object -First 1
if (-not $sdk) { throw 'Install the Windows SDK with x64 MakeAppx.' }
& (Join-Path $sdk.FullName 'x64/makeappx.exe') pack /d $stage /p $package
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx validation/pack failed.' }
$receipt = [ordered]@{ tag=$Tag; packageVersion="$version.0"; architecture='x64'; archiveSha256=$expectedHash; companionName=$companionName; companionSha256=$companionHash; packageSha256=(Get-FileHash -LiteralPath $package).Hash.ToLowerInvariant(); logoSha256=$logoHash.ToLowerInvariant(); stage=$stage; package=$package; runtimeAcceptance='pending' }
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'build-receipt.json') -Encoding utf8
Write-Output "Store package: $package"
Write-Output "Stage for acceptance: $stage"

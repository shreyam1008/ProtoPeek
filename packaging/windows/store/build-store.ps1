param(
    [Parameter(Mandatory)][ValidatePattern('^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')][string]$Tag,
    [Parameter(Mandatory)][string]$ReleaseArchive,
    [Parameter(Mandatory)][string]$Checksums,
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
$matchesForArchive = @(Get-Content -LiteralPath $Checksums | Where-Object { $_ -match ('^[0-9a-fA-F]{64}\s+\*?' + [regex]::Escape($expectedName) + '$') })
if ($matchesForArchive.Count -ne 1) { throw 'Expected one exact archive entry in release checksums.' }
$expectedHash = ($matchesForArchive[0] -split '\s+')[0].ToLowerInvariant()
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Release archive checksum mismatch.' }
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
$receipt = [ordered]@{ tag=$Tag; packageVersion="$version.0"; architecture='x64'; archiveSha256=$expectedHash; packageSha256=(Get-FileHash -LiteralPath $package).Hash.ToLowerInvariant(); logoSha256=$logoHash.ToLowerInvariant(); stage=$stage; package=$package; runtimeAcceptance='pending' }
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'build-receipt.json') -Encoding utf8
Write-Output "Store package: $package"
Write-Output "Stage for acceptance: $stage"

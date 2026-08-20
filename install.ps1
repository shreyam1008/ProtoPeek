[CmdletBinding()]
param(
    [string]$Channel = "",
    [string]$Version = "",
    [string]$InstallDir = "",
    [string]$DownloadUrl = "",
    [string]$ChecksumUrl = "",
    [switch]$NoPathUpdate
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = if ($env:PROTOPEEK_REPO) { $env:PROTOPEEK_REPO } else { "shreyam1008/ProtoPeek" }
$ApiRoot = if ($env:PROTOPEEK_API_ROOT) { $env:PROTOPEEK_API_ROOT } else { "https://api.github.com/repos/$Repo" }
$DownloadBaseUrl = if ($env:PROTOPEEK_DOWNLOAD_BASE_URL) { $env:PROTOPEEK_DOWNLOAD_BASE_URL } else { "https://github.com/$Repo/releases/download" }
$EdgeTag = "v0.0.0-edge"

if (-not $Channel) { $Channel = if ($env:PROTOPEEK_CHANNEL) { $env:PROTOPEEK_CHANNEL } else { "stable" } }
if (-not $Version) { $Version = $env:PROTOPEEK_VERSION }
if (-not $InstallDir) {
    $InstallDir = if ($env:PROTOPEEK_INSTALL_DIR) { $env:PROTOPEEK_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\ProtoPeek\bin" }
}
if (-not $DownloadUrl) { $DownloadUrl = $env:PROTOPEEK_DOWNLOAD_URL }
if (-not $ChecksumUrl) { $ChecksumUrl = $env:PROTOPEEK_CHECKSUM_URL }
$SkipPathUpdate = $NoPathUpdate -or $env:PROTOPEEK_NO_PATH_UPDATE -eq "1"

function Assert-Tag([string]$Tag) {
    if ($Tag -notmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$') {
        throw "PROTOPEEK_VERSION must be a tag such as v0.2.0."
    }
}

function Resolve-Tag {
    if ($Version) {
        Assert-Tag $Version
        return $Version
    }
    if ($Channel -eq "edge") { return $EdgeTag }
    if ($Channel -ne "stable") { throw "PROTOPEEK_CHANNEL must be 'stable' or 'edge'." }
    try {
        $Release = Invoke-RestMethod -Uri "$ApiRoot/releases/latest" -Headers @{ Accept = "application/vnd.github+json" }
    } catch {
        throw "Could not resolve the latest stable release: $($_.Exception.Message)"
    }
    $Tag = [string]$Release.tag_name
    if (-not $Tag) { throw "The release API did not return a stable tag." }
    Assert-Tag $Tag
    return $Tag
}

function Get-ArchiveName([string]$Source) {
    $Uri = $null
    if ([Uri]::TryCreate($Source, [UriKind]::Absolute, [ref]$Uri) -and $Uri.Scheme -ne "file") {
        return [IO.Path]::GetFileName($Uri.LocalPath)
    }
    if ($Uri -and $Uri.IsFile) { return [IO.Path]::GetFileName($Uri.LocalPath) }
    return [IO.Path]::GetFileName($Source)
}

function Get-SiblingSource([string]$Source, [string]$Name) {
    $Uri = $null
    if ([Uri]::TryCreate($Source, [UriKind]::Absolute, [ref]$Uri)) {
        return [Uri]::new($Uri, $Name).AbsoluteUri
    }
    return Join-Path (Split-Path -Parent $Source) $Name
}

function Copy-Source([string]$Source, [string]$Destination) {
    if (Test-Path -LiteralPath $Source) {
        Copy-Item -LiteralPath $Source -Destination $Destination
        return
    }
    $Uri = $null
    if ([Uri]::TryCreate($Source, [UriKind]::Absolute, [ref]$Uri) -and $Uri.IsFile) {
        Copy-Item -LiteralPath $Uri.LocalPath -Destination $Destination
        return
    }
    Invoke-WebRequest -Uri $Source -OutFile $Destination -UseBasicParsing
}

function Test-ReplaceableAlias([string]$AliasPath, [string]$CanonicalPath, [string]$MarkerPath) {
    if (-not (Test-Path -LiteralPath $AliasPath)) { return $true }
    if (Test-Path -LiteralPath $MarkerPath) {
        $Marker = (Get-Content -LiteralPath $MarkerPath -Raw).Trim()
        if ($Marker -match '^ProtoPeek ([0-9A-Fa-f]{64})$') {
            $AliasHash = (Get-FileHash -LiteralPath $AliasPath -Algorithm SHA256).Hash
            if ($AliasHash -ieq $Matches[1]) { return $true }
        }
    }
    if (-not (Test-Path -LiteralPath $CanonicalPath)) { return $false }
    return (Get-FileHash -LiteralPath $AliasPath -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $CanonicalPath -Algorithm SHA256).Hash
}

Write-Host "ProtoPeek installer"
Write-Host "Local gRPC and HTTP workbench by Shreyam Adhikari"

$Architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
$ReleaseArch = switch ($Architecture) {
    "X64" { "x86_64" }
    "X86" { "x86_32" }
    "Arm64" { "arm64" }
    default { throw "Unsupported Windows architecture: $Architecture" }
}

if ($DownloadUrl) {
    $ArchiveUrl = $DownloadUrl
    $ArchiveName = Get-ArchiveName $ArchiveUrl
    $ResolvedTag = if ($Version) { $Version } else { "manual" }
} else {
    $ResolvedTag = Resolve-Tag
    $VersionName = $ResolvedTag.TrimStart('v')
    $ArchiveName = "protopeek_${VersionName}_windows_${ReleaseArch}.zip"
    $ArchiveUrl = "$DownloadBaseUrl/$ResolvedTag/$ArchiveName"
}
if (-not $ArchiveName) { throw "Could not determine the archive filename." }
if (-not $ChecksumUrl) { $ChecksumUrl = Get-SiblingSource $ArchiveUrl "checksums.txt" }

$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("protopeek-install-" + [Guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempRoot $ArchiveName
$ChecksumsPath = Join-Path $TempRoot "checksums.txt"
$UnpackPath = Join-Path $TempRoot "unpack"
$ProtoPeekTemp = Join-Path $InstallDir ".protopeek.$PID.new.exe"
$PpTemp = Join-Path $InstallDir ".pp.$PID.new.exe"

try {
    New-Item -ItemType Directory -Path $TempRoot, $UnpackPath -Force | Out-Null
    Write-Host "==> Downloading $ArchiveUrl"
    Copy-Source $ArchiveUrl $ArchivePath
    Write-Host "==> Verifying SHA-256 checksum"
    Copy-Source $ChecksumUrl $ChecksumsPath

    $ExpectedHashes = @()
    foreach ($Line in Get-Content -LiteralPath $ChecksumsPath) {
        if ($Line -match '^([0-9A-Fa-f]{64})\s+\*?(.+)$' -and $Matches[2] -eq $ArchiveName) {
            $ExpectedHashes += $Matches[1].ToLowerInvariant()
        }
    }
    if ($ExpectedHashes.Count -ne 1) { throw "checksums.txt must contain exactly one SHA-256 entry for $ArchiveName." }
    $ActualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualHash -ne $ExpectedHashes[0]) { throw "Checksum verification failed for $ArchiveName." }

    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $UnpackPath -Force
    $ProtoPeekSource = Join-Path $UnpackPath "protopeek.exe"
    $PpSource = Join-Path $UnpackPath "pp.exe"
    if (-not (Test-Path -LiteralPath $ProtoPeekSource)) { throw "The archive did not contain protopeek.exe." }
    if (-not (Test-Path -LiteralPath $PpSource)) {
        Write-Host "Legacy archive detected; deriving pp.exe from the verified protopeek.exe binary."
        Copy-Item -LiteralPath $ProtoPeekSource -Destination $PpSource
    }
    & $ProtoPeekSource -version *> $null
    if ($LASTEXITCODE -ne 0) { throw "The protopeek.exe binary check failed." }
    & $PpSource -version *> $null
    if ($LASTEXITCODE -ne 0) { throw "The pp.exe binary check failed." }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $ProtoPeekTarget = Join-Path $InstallDir "protopeek.exe"
    $PpTarget = Join-Path $InstallDir "pp.exe"
    $MarkerPath = Join-Path $InstallDir ".protopeek-install"
    $InstallPp = Test-ReplaceableAlias $PpTarget $ProtoPeekTarget $MarkerPath
    if (-not $InstallPp) {
        Write-Warning "$PpTarget is not a recognized ProtoPeek alias; leaving it unchanged."
    }

    Copy-Item -LiteralPath $ProtoPeekSource -Destination $ProtoPeekTemp
    if ($InstallPp) { Copy-Item -LiteralPath $PpSource -Destination $PpTemp }
    Move-Item -LiteralPath $ProtoPeekTemp -Destination $ProtoPeekTarget -Force
    if ($InstallPp) {
        Move-Item -LiteralPath $PpTemp -Destination $PpTarget -Force
        $InstalledPpHash = (Get-FileHash -LiteralPath $PpTarget -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath $MarkerPath -Value "ProtoPeek $InstalledPpHash" -NoNewline
    }

    if (-not $SkipPathUpdate) {
        $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $Entries = @($UserPath -split ';' | Where-Object { $_ })
        if (-not ($Entries | Where-Object { $_.TrimEnd('\') -ieq $InstallDir.TrimEnd('\') })) {
            $NewUserPath = (@($Entries) + $InstallDir) -join ';'
            [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
            Write-Host "Added $InstallDir to the user PATH. Open a new terminal to use it."
        }
    }

    Write-Host "Installed protopeek.exe to $ProtoPeekTarget"
    if ($InstallPp) { Write-Host "Installed pp.exe to $PpTarget" }
    Write-Host "Resolved release: $ResolvedTag"
} finally {
    Remove-Item -LiteralPath $ProtoPeekTemp, $PpTemp -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

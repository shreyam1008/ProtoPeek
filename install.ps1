[CmdletBinding()]
param(
    [string]$Channel = "",
    [string]$Version = "",
    [string]$InstallDir = "",
    [string]$DownloadUrl = "",
    [string]$ChecksumUrl = "",
    [switch]$NoPathUpdate,
    [switch]$NoShortcuts,
    [string]$ShortcutDir = "",
    [ValidateRange(1024, 65535)][int]$UIPort = 8844
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
$SkipShortcuts = $NoShortcuts -or $env:PROTOPEEK_NO_SHORTCUTS -eq "1"
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
if (-not $ShortcutDir) { $ShortcutDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'ProtoPeek' }
$ShortcutDir = [IO.Path]::GetFullPath($ShortcutDir)

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

function Assert-Executable([string]$Executable) {
    # Windows PowerShell 5.1 turns native stderr into terminating errors when
    # ErrorActionPreference is Stop. Go's version flag legitimately uses stderr.
    $Check = New-Object System.Diagnostics.Process
    $Check.StartInfo.FileName = $Executable
    $Check.StartInfo.Arguments = '-version'
    $Check.StartInfo.UseShellExecute = $false
    $Check.StartInfo.CreateNoWindow = $true
    $Check.StartInfo.RedirectStandardOutput = $true
    $Check.StartInfo.RedirectStandardError = $true
    try {
        if (-not $Check.Start()) { throw "Could not start the binary check: $Executable" }
        $Output = $Check.StandardOutput.ReadToEndAsync()
        $Errors = $Check.StandardError.ReadToEndAsync()
        if (-not $Check.WaitForExit(15000)) {
            $Check.Kill()
            $Check.WaitForExit()
            throw "The binary check timed out: $Executable"
        }
        $Output.Wait()
        $Errors.Wait()
        if ($Check.ExitCode -ne 0) { throw "The binary check failed: $Executable (exit $($Check.ExitCode))." }
    } finally { $Check.Dispose() }
}

function Test-ReplaceableAlias([string]$AliasPath, [string]$CanonicalPath, [string]$MarkerPath) {
    if (-not (Test-Path -LiteralPath $AliasPath)) { return $true }
    if (Test-Path -LiteralPath $MarkerPath) {
        $Marker = [IO.File]::ReadAllText($MarkerPath).Trim()
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

# PROCESSOR_ARCHITEW6432 identifies the native OS when PowerShell runs under
# WOW64. RuntimeInformation.OSArchitecture is unavailable on some Windows
# PowerShell/.NET Framework installations, including the irm | iex fast path.
$Architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$ReleaseArch = switch ($Architecture) {
    "AMD64" { "x86_64" }
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
    Assert-Executable $ProtoPeekSource
    Assert-Executable $PpSource

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

    if (-not $SkipShortcuts) {
        try {
            New-Item -ItemType Directory -Path $ShortcutDir -Force | Out-Null
            $ShortcutPath = Join-Path $ShortcutDir 'ProtoPeek.lnk'
            $ShortcutShell = New-Object -ComObject WScript.Shell
            $Shortcut = $ShortcutShell.CreateShortcut($ShortcutPath)
            # Do not overwrite a shortcut belonging to another program.
            if ($Shortcut.TargetPath -and $Shortcut.TargetPath -ine $ProtoPeekTarget) {
                Write-Warning "The existing ProtoPeek shortcut points to another installation; leaving it unchanged."
            } else {
                $Shortcut.TargetPath = $ProtoPeekTarget
                $Shortcut.Arguments = "-open-browser=true -port $UIPort"
                $Shortcut.WorkingDirectory = $InstallDir
                $Shortcut.Description = 'ProtoPeek local service workbench'
                $Shortcut.WindowStyle = 7
                $Shortcut.Save()
                Write-Host "Start menu: ProtoPeek (local UI port $UIPort; preserves browser preferences between launches)."
            }
        } catch {
            Write-Warning "ProtoPeek installed, but the Start menu shortcut could not be created: $($_.Exception.Message)"
        }
    }
    Write-Host "Open now: & `"$ProtoPeekTarget`" -open-browser=true -port $UIPort"
    Write-Host 'Keep the ProtoPeek process running while downloads are active; closing the browser is fine.'
    if ($ReleaseArch -eq 'x86_64' -and $ResolvedTag -match '^v(\d+)\.(\d+)\.(\d+)$' -and
        ([version]$ResolvedTag.TrimStart('v')) -ge [version]'0.6.0') {
        Write-Host 'Downloader includes aria2; start it from Files. No separate engine install is needed.'
    } elseif (-not (Get-Command aria2c -ErrorAction SilentlyContinue)) {
        Write-Host 'Downloader needs aria2. With Scoop: scoop install aria2. Configure its path in Settings if needed.'
    }
} finally {
    Remove-Item -LiteralPath $ProtoPeekTemp, $PpTemp -Force -ErrorAction SilentlyContinue
    $ResolvedTempRoot = [IO.Path]::GetFullPath($TempRoot)
    $ExpectedTempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($ResolvedTempRoot.StartsWith($ExpectedTempParent, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($ResolvedTempRoot) -match '^protopeek-install-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $ResolvedTempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

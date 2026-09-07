# Install, upgrade, uninstall, and rollback

> v0.6.0 is the current stable release. The default resolver installs it from immutable GitHub release
> assets and never falls back to edge.

## Install through an owned package channel

Homebrew on macOS or Linux installs both `protopeek` and `pp`, plus both manpages:

```sh
brew install shreyam1008/tap/protopeek
```

Scoop on Windows installs both executable shims from the owned bucket:

```powershell
scoop bucket add shreyam https://github.com/shreyam1008/scoop-bucket
scoop install shreyam/protopeek
```

The formula and manifest pin release archives by SHA-256 and declare aria2 as a package
dependency. Check the manifest for its packaged version; the direct resolver selects latest stable.
Update with `brew upgrade protopeek` or `scoop update protopeek`; uninstall with
`brew uninstall protopeek` or `scoop uninstall protopeek`.

## Install through the release resolver

```sh
curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh
```

The installer verifies the selected archive against the matching
`checksums.txt` before extraction. It provides `protopeek` and the short `pp`
command unless an unrelated `pp` already occupies the install directory; that
file is never overwritten. Older verified archives that contain only
`protopeek` are supported by deriving the alias from that verified binary.

v0.6.0 Windows x64 archives bundle pinned aria2 1.37.0 inside the executable. It is extracted
only when Downloader starts and no configured or PATH engine exists. Linux, macOS, Windows ARM64
and Windows 32-bit need installed aria2. Other workspaces do not start the transfer engine.

Windows PowerShell installs per user and updates the user PATH without requiring
administrator access:

```powershell
irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex
```

To inspect the script first:

```powershell
irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 -OutFile install.ps1
Get-Content .\install.ps1
.\install.ps1
```

## Install a pinned release

The Windows PowerShell 5.1 and PowerShell 7 compatible per-user installer
adds a **ProtoPeek** Start-menu shortcut. It opens the browser and minimizes the console. The
shortcut uses loopback port `8844`, keeping the browser origin stable so drafts and appearance
survive a restart. Use `-UIPort` to choose another port if it is occupied, or `-NoShortcuts` for a
CLI-only installation. `-ShortcutDir` supports a custom Start-menu destination. A shortcut pointing
at a different installation is preserved. The console process remains the server: closing the
browser leaves downloads running; stopping the server requires queue recovery on next start.
Reopen the existing browser address while the server is running instead of starting a second copy.

The bundled engine adds about 2.36 MiB compressed to Windows x64 builds. Its upstream Windows
TLS implementation does not support TLS 1.3-only servers; configure another aria2 build if needed.
Source and notices are documented in `internal/bundledaria2/README.md` and accompany the release.

The installers accept a pinned immutable tag:

```sh
PROTOPEEK_VERSION=v0.6.0 sh -c "$(curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh)"
```

```powershell
$env:PROTOPEEK_VERSION = 'v0.6.0'
irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex
```

Use `PROTOPEEK_CHANNEL=edge` only when intentionally testing the rolling edge
prerelease. A stable-resolution failure never falls back to edge.

## Upgrade and rollback

Upgrade a package-manager installation with `brew upgrade protopeek` or
`scoop update protopeek`. To switch to a pinned rollback, first uninstall that
package through the same manager so command paths do not conflict.

For a release-resolver installation, repeat the verified install for the target
version. To roll back, set `PROTOPEEK_VERSION` to the previous tag and rerun the
matching installer after stopping ProtoPeek. Launch on loopback and reconnect a
non-production target before normal use.

Saved launcher targets live in the local browser profile. Back up browser site
data before a major launcher migration.

## Uninstall

For package-manager installs, use `brew uninstall protopeek` or
`scoop uninstall protopeek`. For a Unix release-resolver install, remove
`protopeek`, the ProtoPeek-owned `pp`, `.protopeek-install`, and the
`protopeek.1` and `pp.1` files from the configured install/man directories. For
a PowerShell release-resolver install, remove
`%LOCALAPPDATA%\Programs\ProtoPeek` and remove that directory from the user
PATH. Never remove an unrelated `pp` command. Browser-saved targets remain
until cleared through browser site-data controls.

For the Windows installer, also remove the owned
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\ProtoPeek\ProtoPeek.lnk` shortcut (or the
custom shortcut location). The PATH entry is the `bin` directory inside the installation.

## Docker

No public container image is claimed. Build the local development image, then
keep its published host port on loopback:

```sh
make docker
docker run --rm -p 127.0.0.1:8080:8080 protopeek:dev
```

The image's `-allow-non-loopback-bind` flag permits its container-interface
listener but keeps browser requests limited to loopback Hosts and matching
Origins. It is distinct from `-unsafe-allow-remote`, which disables that guard
and requires an authenticated, TLS-terminated, rate-limited boundary.

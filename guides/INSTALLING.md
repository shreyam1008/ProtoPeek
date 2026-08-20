# Install, upgrade, uninstall, and rollback

> v0.2.0 is currently a draft candidate, not a public stable release. The
> stable resolver continues to install v0.1.6 until the draft is tested and
> manually published.

## Install through the release resolver

```sh
curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh
```

The installer verifies the selected archive against the matching
`checksums.txt` before extraction. It provides `protopeek` and the short `pp`
command unless an unrelated `pp` already occupies the install directory; that
file is never overwritten. Older verified archives that contain only
`protopeek` are supported by deriving the alias from that verified binary.

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

The installers accept a pinned immutable tag:

```sh
PROTOPEEK_VERSION=v0.1.6 sh -c "$(curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh)"
```

```powershell
$env:PROTOPEEK_VERSION = 'v0.1.6'
irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex
```

Use `PROTOPEEK_CHANNEL=edge` only when intentionally testing the rolling edge
prerelease. A stable-resolution failure never falls back to edge.

## Upgrade and rollback

Repeat the verified install for the target version. To roll back, set
`PROTOPEEK_VERSION` to the previous tag and rerun the matching installer after
stopping ProtoPeek. Launch on loopback and reconnect a non-production target
before normal use.

Saved launcher targets live in the local browser profile. Back up browser site
data before a major launcher migration.

## Uninstall

On Unix, remove `protopeek`, the ProtoPeek-owned `pp`, `.protopeek-install`, and
the `protopeek.1` and `pp.1` files from the configured install/man directories.
On Windows, remove `%LOCALAPPDATA%\Programs\ProtoPeek` and remove that directory
from the user PATH. Never remove an unrelated `pp` command. Browser-saved
targets remain until cleared through browser site-data controls.

## Docker

Keep the published host port on loopback:

No public container image is claimed. Build the local development image, then
keep its published host port on loopback:

```sh
make docker
docker run --rm -p 127.0.0.1:8080:8080 protopeek:dev
```

# Install, upgrade, uninstall, and rollback

## Install the latest stable release

```sh
curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh
```

The installer provides both `protopeek` and the short `pp` command. Review the
script before piping it to a shell when required by your environment.

## Install a pinned release

Download the archive and `checksums.txt` from the matching immutable GitHub
release, verify the SHA-256 entry, then install both command names from that
verified binary. Do not install an artifact when checksum evidence is missing.

## Upgrade and rollback

Repeat the verified install for the target version. To roll back, download the
previous release and checksum file, verify the archive, stop running ProtoPeek
processes, and replace both command names with the verified previous binary.
Launch on loopback and reconnect a non-production target before normal use.

Saved launcher targets live in the local browser profile. Back up browser site
data before a major launcher migration.

## Uninstall

Remove the `protopeek` and `pp` binaries from the install directory used by the
installer. Browser-saved targets remain until cleared through browser site-data
controls.

## Docker

Keep the published host port on loopback:

```sh
docker run --rm -p 127.0.0.1:8080:8080 shreyam1008/protopeek:dev
```

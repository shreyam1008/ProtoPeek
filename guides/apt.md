# Install ProtoPeek with APT

The signed v0.7.0 repository was verified over anonymous HTTPS on 23 October 2026.
All three packages match the signed indexes and public release checksums; both
InRelease and Release.gpg signatures verify with the committed key.
The [native lifecycle check](https://github.com/shreyam1008/ProtoPeek/actions/workflows/verify-apt.yml)
tests fresh install, a real v0.6.1 upgrade, both aliases, HTTP startup, embedded
assets, request guards and removal on Ubuntu amd64. The original
[September install/remove receipt](https://github.com/shreyam1008/ProtoPeek/actions/runs/34683703441)
remains historical evidence.

The signed repository supports amd64, arm64 and i386. Add it once on Debian or
Ubuntu, then use normal APT updates. The package is named `protopeek` and includes
both `protopeek` and `pp` commands.

```sh
curl -fsSLo /tmp/protopeek-key.asc https://protopeek.shreyam1008.com.np/apt/key.asc
gpg --show-keys --with-fingerprint /tmp/protopeek-key.asc
# Verify: 56AA070BA15E98B3F3A827C2B99906E44F4BCF7F
sudo install -m 644 /tmp/protopeek-key.asc /usr/share/keyrings/protopeek.asc
echo 'deb [signed-by=/usr/share/keyrings/protopeek.asc] https://protopeek.shreyam1008.com.np/apt stable main' | sudo tee /etc/apt/sources.list.d/protopeek.list
sudo apt update
sudo apt install protopeek
```

Start with `protopeek` or `pp`. Update with `sudo apt update && sudo apt upgrade`.
Remove the package with `sudo apt remove protopeek`.

## Maintenance

`.github/workflows/apt.yml` runs on published stable releases or manually for an
existing stable tag. It verifies release SHA-256 checksums and Debian metadata,
signs indexes with a persistent key, tests installation/removal on Ubuntu amd64,
and checks the public HTTPS installation after publication. arm64 and i386
package metadata is checked; their runtime checks remain separate.

Public indexes and keys live in `web/site/public/apt` and generated `docs/apt` so
site rebuilds preserve them. Signed package bytes remain in the source pool and
immutable GitHub release. Exact package URLs redirect there for GET and HEAD;
APT still verifies their signed-index hashes. Generated Pages output omits Debian
copies to respect its per-file size limit. Only public keys and signed packages enter Git.
The private key is in the `APT_SIGNING_PRIVATE_KEY` Actions secret; its full
fingerprint is in `APT_SIGNING_KEY_ID`. The owner recovery key and revocation
certificate are outside Git in `%LOCALAPPDATA%/ProtoPeek/apt-signing`, restricted
to the owner and SYSTEM. Back them up securely. Rotate before 11 September 2028.

Snap packages remain GitHub candidates; a Snap Store listing is separate.

The verify-only workflow never re-signs or publishes a repository and refuses
installation outside an ephemeral GitHub-hosted Linux runner. Native arm64/i386
installation and Linux desktop browser-launch acceptance remain separate checks.

# Linux publication gates

Updated: 2026-10-23.

- [x] Prepare GoReleaser Debian packaging for the next stable release, including
  `protopeek`, `pp`, license notices and man pages.
- [x] Configuration validated in `Check Linux package configuration`, run 34028750448.
- [x] Build checksummed v0.7.0 `.deb` packages for amd64, arm64 and i386.
- [x] Test actual Ubuntu amd64 installation, both CLI aliases, HTTP/embedded assets,
  real v0.6.1 upgrade and removal. The hosted verification recipe records lifecycle
  and cleanup separately; full [39949019856](https://github.com/shreyam1008/ProtoPeek/actions/runs/39949019856)
  passed, including receipt upload.
- [ ] Verify Linux desktop default-browser launch and native arm64/i386 installation.
- [x] Publish checksummed packages with v0.7.0 and GitHub provenance. Existing
  stable assets and tags were not rewritten.
- [x] Establish a persistent APT signing key and signed repository, preserving
  it across website deployments; test anonymous HTTPS installation.
- [ ] Only then advertise APT in the portfolio control plane.
- [x] Add a tag-driven classic Snap candidate build and attach its checksum to
  stable GitHub releases.
- [ ] Test the Snap candidate on a supported Linux desktop and publish it to
  the Snap Store candidate channel with maintainer credentials.

GitHub Releases, signed APT, Homebrew and Scoop provide stable v0.7.0.
The v0.7.0 Snap also passed hosted Linux install/runtime/removal checks, but a
desktop check and Store publication remain separate. The Snap manifest is a classic-confinement candidate because ProtoPeek
invokes local network tools and host files; Store publication remains gated on a
real desktop smoke test and review. Flathub is not a lane for the terminal-first
product; do not submit a thin browser launcher as a desktop app.
The existing Microsoft Store listing is public. Its validated v0.7.0.0 update
was submitted on 23 October, passed certification later that day and entered
Publishing. An official WinGet Store installation then delivered signed 0.7.0.0;
fresh installation, packaged runtime, bundled aria2 transfer and removal passed on
the current Windows host. Prior Store-version upgrade and Start-menu/default-browser
opening remain unverified. Snap publication
credentials are not configured in this repository as of this checkpoint.

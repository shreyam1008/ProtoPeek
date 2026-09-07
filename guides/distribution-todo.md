# Linux publication gates

Updated: 2026-09-07.

- [x] Prepare GoReleaser Debian packaging for the next stable release, including
  `protopeek`, `pp`, license notices and man pages.
- [x] Configuration validated in `Check Linux package configuration`, run 34028750448.
- [x] Build checksummed v0.6.1 `.deb` packages for amd64, arm64 and i386.
- [ ] Test native `.deb` package lifecycle: install, CLI/browser startup,
  upgrade, and removal on Debian/Ubuntu. A configuration check is not a package
  or runtime test.
- [x] Publish checksummed packages with v0.6.1 and GitHub provenance. Existing
  stable assets and tags were not rewritten.
- [ ] Establish a persistent APT signing key and signed repository, preserving
  it across website deployments; test anonymous HTTPS installation.
- [ ] Only then advertise APT in the portfolio control plane.

GitHub Releases, Homebrew and Scoop remain the current stable distribution
paths. Snap requires a separate confinement test. Flathub is not a lane for the
terminal-first product; do not submit a thin browser launcher as a desktop app.
Microsoft Store remains conditional on a maintained Windows package and a
useful Store installation experience.

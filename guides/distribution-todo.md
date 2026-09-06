# Linux publication gates

Updated: 2026-09-06.

- [x] Prepare GoReleaser Debian packaging for the next stable release, including
  `protopeek`, `pp`, license notices and man pages.
- [ ] Validate configuration in `Check Linux package configuration`.
- [ ] Build and test next stable `.deb` packages: install, CLI/browser startup,
  upgrade, and removal on Debian/Ubuntu. A configuration check is not a package
  or runtime test.
- [ ] Publish those checksummed packages with the next stable release. Do not
  relabel current unreleased work as v0.5.0 or silently replace stable assets.
- [ ] Establish a persistent APT signing key and signed repository, preserving
  it across website deployments; test anonymous HTTPS installation.
- [ ] Only then advertise APT in the portfolio control plane.

GitHub Releases, Homebrew and Scoop remain the current stable distribution
paths. Snap requires a separate confinement test. Flathub is not a lane for the
terminal-first product; do not submit a thin browser launcher as a desktop app.
Microsoft Store remains conditional on a maintained Windows package and a
useful Store installation experience.

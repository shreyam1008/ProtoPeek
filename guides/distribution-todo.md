# Linux publication gates

Updated: 2026-09-12.

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
- [x] Add a tag-driven classic Snap candidate build and attach its checksum to
  stable GitHub releases.
- [ ] Test the Snap candidate on a supported Linux desktop and publish it to
  the Snap Store candidate channel with maintainer credentials.

GitHub Releases, Homebrew and Scoop remain the current stable distribution
paths. The Snap manifest is a classic-confinement candidate because ProtoPeek
invokes local network tools and host files; Store publication remains gated on a
real desktop smoke test and review. Flathub is not a lane for the terminal-first
product; do not submit a thin browser launcher as a desktop app.
Microsoft Store remains conditional on a maintained Windows package and a
useful Store installation experience.

# ProtoPeek v0.2.0 release notes

Released 20 August 2026.

## Highlights

- Local gRPC and bounded HTTP request workbenches in one browser shell.
- Bounded discovery with explicit private-network and public-target policies.
- Secret-redacted local history and workspace exports.

## Distribution changes

- Release archives include both `protopeek` and `pp` command names.
- Unix and Windows installers verify the release SHA-256 checksum before
  extracting.
- Archives publish checksums, SBOMs, and GitHub build-provenance attestations.

## Compatibility

- Native CI passes on GitHub-hosted `ubuntu-latest`, `macos-latest`, and
  `windows-latest` runners, including both command builds and the platform's
  verified installer fixture.
- The release contract builds and inspects Linux 386/amd64/arm64, macOS
  amd64/arm64, and Windows 386/amd64/arm64 archives.
- The browser UI passed desktop, 320 px, keyboard, discovery, recents, and HTTP
  history/send regression checks in Chromium. Native CI covers command startup
  and installers; physical macOS and Windows browser auto-open remain useful
  follow-up smoke checks rather than unreported release claims.

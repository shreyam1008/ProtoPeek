# ProtoPeek v0.2.0 draft notes

This file is a candidate template, not evidence that v0.2.0 is public.

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
- The browser UI and `pp` auto-open path still require a final draft-asset smoke
  check before the GitHub release is published.

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

List the exact tested operating systems and architectures from the draft-release
acceptance run before publishing.

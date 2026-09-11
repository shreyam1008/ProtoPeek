# ProtoPeek release process

GitHub Actions is the only publishing path. Local commands validate snapshots;
they do not publish releases.

Microsoft Store packaging follows published stable releases, not rolling builds. See
[Store preparation and automation](../guides/microsoft-store.md) and the
`Microsoft Store package` workflow. Store upload/API setup remains separate.

## Stable release

1. Land a clean, reviewed commit on `master` with generated website and embedded
   app assets committed.
2. Move the changelog entries from `Unreleased` to a dated version heading.
3. Run `make release-snapshot` and inspect every archive for `protopeek`, `pp`,
   documentation, checksums, and SBOMs.
4. Create and push an exact stable SemVer tag such as `v0.2.0`.
5. The release workflow creates a **draft** GitHub release and provenance
   attestations. Inspect and test the draft assets on Linux, macOS, and Windows.
6. Publish the draft manually only after the website, installers, changelog, and
   artifacts all describe the same version.

Never replace assets on a published version. Correct a bad release with a new
patch version.

## Edge release

The edge workflow first completes a local snapshot build, then refreshes the
rolling `v0.0.0-edge` prerelease. Edge is never a stable-install fallback.

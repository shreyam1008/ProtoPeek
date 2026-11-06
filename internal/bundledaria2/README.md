# aria2 companion provenance

Standard Windows amd64 builds carry the unmodified official
[aria2 1.37.0 win-64bit-build1 archive](https://github.com/aria2/aria2/releases/tag/release-1.37.0).
Its 2,475,379 compressed bytes add about 2.36 MiB to the Go executable. Other targets use a configured
or PATH-installed engine. Stable ProtoPeek v0.5.0 contains no bundled engine.

The configured executable takes priority, then PATH, then this companion. Extraction happens only
after Downloader starts, into the OS user cache. Both archive and executable are SHA-256 checked;
notices are extracted alongside it. ProtoPeek communicates with the separate process through a
secret-authenticated loopback JSON-RPC connection. The standard build uses its embedded fallback without a network request.

- Archive SHA-256: `67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288`
- Executable SHA-256: `be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2`
- Upstream tag: `release-1.37.0`; build recipe: included `Dockerfile.mingw`, with
  `HOST=x86_64-w64-mingw32`, `ARIA2_VERSION=release-1.37.0`, `ARIA2_REF=tags/release-1.37.0`.

Upstream `README.mingw` records the statically linked versions: GMP 6.3.0, Expat 2.5.0,
SQLite 3.43.1, zlib 1.3, c-ares 1.19.1, libssh2 1.11.0. It also records that TLS 1.3 and
daemon mode do not work in this Windows build. A separately configured newer engine can replace it.
The upstream recipe is preserved for reference; byte-for-byte reproducibility has not been established.

## Source distribution

aria2 is GPL-2.0-or-later; the full COPYING and upstream notices are in `notices/` and in the
embedded archive. Do not describe the companion as MIT. Linked components carry their own notices
in their corresponding source archives.

Run `bun scripts/package-aria2-sources.ts .local/aria2-sources` before packaging. It obtains the
exact source versions listed above from their publishers and verifies the committed SHA-256
manifest. It includes the source build scripts, licenses, and pinned provenance. The release workflow
packages that directory as `aria2-1.37.0-companion-sources.tar.gz` and attaches it to the same draft
release as the executables. Keep source download access alongside binary access when publishing or
mirroring those artifacts. This is a build/release step, never an installer download.

The archive itself can be refreshed from
`https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip`.
Verify both committed digests before changing the payload. For a version update, update sources,
notices, digests, platform tests, and upstream limitations together.

## Optional Windows x64 lightweight local preview

The stable and nightly release recipes in current source build both Windows x64 CLI names
with the engine on demand. Published v0.7.0 and an untagged developer build embed the engine.
To build an offline-capable local package with a verified ZIP beside the executables:

```powershell
./scripts/build-lite-windows.ps1 -OutputDirectory .local/protopeek-lite-preview
```

Add `-CoreOnly` to omit the offline ZIP and install the verified engine from Extensions later.

Choose a new output directory: the script refuses to replace an existing one. The `protopeek_lite`
build tag applies to Windows amd64. The script stages both commands and third-party notices. By default it also stages a pinned companion ZIP beside the executable for offline setup. With CoreOnly, users can select Install in Extensions to fetch that same archive into their private cache. Both paths check the compressed size, archive hash and extracted executable hash. Configured and PATH engines take priority. Opening a tool never starts an installation.

GoReleaser attaches the optional offline ZIP as a separate download and records its digest in checksums.txt. Copy it beside the commands for offline setup. On upgrade, a v0.7.0 cache with the pinned executable and notices also works offline. The Store follows its own submission process. Re-distributions that include
aria2 must carry the corresponding source and notices described above.

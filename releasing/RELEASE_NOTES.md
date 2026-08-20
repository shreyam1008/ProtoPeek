# ProtoPeek v0.3.0 release notes

Released 20 August 2026.

## Highlights

- A new light-first Protocol Peek dashboard opens when `pp` starts without a target. The compact
  app shell keeps gRPC, HTTP, bounded scan, read-only next-hop evidence, offline Nmap XML import,
  and the in-app roadmap one action away; dark-mode preference stays in browser storage.
- Canonical `grpc.health.v1` Check and one bounded live Watch preserve serving transitions,
  headers, trailers, cancellation, and final gRPC status without polling or retry.
- Reflection-disabled services can load a user-selected browser proto folder through a bounded,
  memory-only snapshot. Relative imports work, while file handles, bytes, browser paths, and server
  paths are never persisted.
- Unary Repeat runs 2–50 calls strictly in sequence with cancellation, a 60-second wall cap,
  partial evidence, separate gRPC and relay/transport failures, and honest handler-vs-console
  timing. It is a diagnostic, not a load generator.
- Discovery now reports independent TCP, verified gRPC/reflection, and safe non-following HTTP
  `HEAD` evidence with fixed candidates, deadlines, concurrency, retained-byte limits, and visible
  truncation.
- Native Linux, macOS, and Windows route queries show the process-selected next hop without probe
  packets. Offline Nmap XML import stays optional and never installs or executes Nmap/Npcap.

## Safety and compatibility notes

- Automatic discovery remains loopback-only. Private/link-local targets require explicit opt-in;
  one explicitly entered public target is never expanded into a range or port sweep.
- Browser-folder schema bytes are uploaded only to the current ProtoPeek process or container,
  cleared before target dial/session publication, and never sent to the gRPC target. Saved profiles
  require the folder to be selected again after reload.
- Health Watch is limited to four live streams per console, 1–600 seconds, and 512 observations;
  the browser retains the latest 200 and reports dropped observations.
- HTTP and gRPC history, replay, workspace import/export, and browser-storage recovery now fail
  closed around redacted credentials, stale target scope, malformed data, and bounded sizes.
- The browser Simulation panel is replaced by Unary Repeat. Direct `/grpc`, `/http`, `/routes`, and
  `/roadmap` links redirect to their canonical hash-routed workbench locations.

## Distribution changes

- Release archives include both `protopeek` and `pp` command names.
- Unix and Windows installers verify the release SHA-256 checksum before
  extracting.
- Archives publish checksums, SBOMs, and GitHub build-provenance attestations.
- The embedded console is regenerated from the same v0.3.0 source and the public site ships a real
  dashboard capture plus aligned Open Graph, Twitter, manifest, sitemap, and structured metadata.

## Compatibility

- Native CI passes on GitHub-hosted `ubuntu-latest`, `macos-latest`, and
  `windows-latest` runners, including both command builds and the platform's
  verified installer fixture.
- The release contract builds and inspects Linux 386/amd64/arm64, macOS
  amd64/arm64, and Windows 386/amd64/arm64 archives.
- The browser UI passed typecheck, Biome, 185 component/contract tests, real 1600×1000 and 390×844
  Chromium renders, theme-persistence inspection, deep-link smokes, and production bundle checks.
  Native CI covers command startup and installers; physical macOS and Windows browser auto-open
  remain useful follow-up smoke checks rather than unreported release claims.

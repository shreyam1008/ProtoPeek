# Changelog

All notable ProtoPeek changes are recorded here. Releases use Git tags as the
version source of truth.

## Unreleased

## v0.3.2 — 2026-08-21

- Kept the Health Watch duration limit inside the ProtoPeek relay instead of propagating it as a
  downstream gRPC deadline. Timer ownership is fixed before terminal evidence is classified, so a
  server-owned `DeadlineExceeded` or `Canceled` result cannot be relabeled as a local duration stop.
- Promoted the owned Homebrew tap and Scoop bucket to the public v0.3.1 archives after their
  independent default-branch install, update, uninstall, checksum, and multi-architecture checks
  passed.

## v0.3.1 — 2026-08-20

- Added explicit Copy as cURL export for the live HTTP draft. POSIX quoting preserves duplicate
  query parameters, Unicode, method, non-sensitive headers, timeout, and active body content after
  the same preparation used by Send; auth and credential-like headers are omitted and sensitive URL
  values are left blank. Export rejects redirect-enabled drafts, non-HTTP(S) URLs, more than 64
  effective headers, and commands over 512 KiB, reports omissions and clipboard failures
  accessibly, and warns that bodies are copied verbatim and shell transport context can differ.
  cURL import remains future work.
- Bounded ordinary direct and workspace gRPC invokes to 512 retained responses, 8 MiB of serialized
  response-message JSON, and a 60-second local wall when a deadline is absent or excessive. Local
  stops cancel the RPC, preserve bounded partial evidence, and never masquerade as a server gRPC
  status in the console, assertions, history, or Unary Repeat.
- Separated container-interface binding from unsafe remote access. The scratch image now keeps the
  loopback request Host and Origin policy on its documented loopback-published path, preventing a
  browser DNS-rebinding Host from reaching scan, relay, or invocation APIs. Explicit remote mode
  remains available only through `-unsafe-allow-remote` and still requires an external trusted
  boundary.
- Added an executable console bundle budget to the canonical build. It guards the shared entry,
  lazy gRPC, HTTP, and scan boundaries, shared CSS, and aggregate JavaScript in both raw and gzip
  bytes without adding a runtime dependency.
- Added handler-wide admission limits for ordinary gRPC invokes, HTTP relays, and native route
  requests, plus pre-publication workspace schema limits for path/file bytes, services, methods,
  descriptors, messages, fields, enums, enum values, nesting depth, and catalog size. Reflection
  resolves incrementally; structural counts run before recursive catalog materialization.
- Fixed the website's source-install fallback so one `go install` command installs both the primary
  `protopeek` binary and the documented `pp` alias.
- Published owned Homebrew and Scoop definitions pinned to the v0.3.0 release checksums. Homebrew
  CI covers style, strict audit, cross-platform readall, install, test, linkage, both command names,
  and manpages on macOS and Linux. Scoop CI covers schema validation, checksum-backed install, both
  command shims, update, uninstall, and three-architecture autoupdate on Windows. WinGet remains
  gated on initial user feedback.

## v0.3.0 — 2026-08-20

- Added explicit canonical `grpc.health.v1` Check and Watch diagnostics. Check preserves serving
  status, headers, trailers, final gRPC status, and handler-observed duration; Watch flushes one
  bounded NDJSON epoch with status transitions, cancellation, trailers, and terminal evidence.
  Blank-service, unknown-service, and `UNIMPLEMENTED` semantics remain canonical. Watch never polls
  or retries, is capped at four concurrent streams per console, 1–600 seconds, and 512 observations,
  while the browser retains the latest 200 with a dropped count. Request metadata is used live but
  never echoed, persisted, or exported.
- Direct `/grpc`, `/http`, `/routes`, and `/roadmap` links now canonicalize to the hash-routed
  workbench, including when ProtoPeek is mounted below a base path. Refreshing or sharing a protocol
  surface no longer falls through to a server 404 or silently renders Home.
- Bounded the discovery relay against target-controlled evidence: two scan requests may run at once;
  reflection receive/header data, retained service names, HTTP protocol/status/server values,
  diagnostic details, and errors have explicit byte ceilings. Additive truncation flags keep a
  genuine oversized reflection response distinguishable from absent or fabricated evidence.
- Added real browser proto-folder snapshots for reflection-disabled services. File System Access
  uses an explicit user gesture where supported with directory-input fallback; only lowercase
  `.proto` files are included, nested import paths are preserved, and profiles persist no handle,
  bytes, root name, browser path, or staging path. The server independently enforces a 20 MiB
  multipart envelope, 512 files, 4 MiB per file, 16 MiB aggregate, and a portable path grammar. A
  manifest-only resolver prevents imports from escaping the snapshot, while built-in Google
  well-known protos remain available. Bounded upload buffers are cleared before target dial/session
  publication, no schema file is written on the server, and browser-folder targets require a fresh
  selection after reload.
- Replaced the browser Simulation surface with bounded Unary Repeat: 2–50 strictly sequential calls,
  0–5000 ms between-call delay, an explicit 0.1–30 s per-call deadline, one cancellable run, and a
  60 s wall cap with partial results. Results keep OK, gRPC status, relay/transport, and cancellation
  separate. Export includes method, target, run ID/start timestamp, frozen configuration, counts,
  per-attempt offsets/timings, classifications, and error/status text, but never request bodies or
  metadata; target/internal addresses and service/relay text must be reviewed before sharing.
  Latency summaries prefer ProtoPeek handler invoke duration when present, visibly fall back to
  console round trip, and withhold p95 until 20 measured samples. The handler duration includes
  JSON/protobuf conversion and callbacks, but excludes the browser and HTTP relay. Assertions and
  overlapping Invoke are blocked while Repeat owns the request; leaving Checks cancels the run and
  preserves partial evidence. Completed results show their start time and frozen configuration,
  mark changed controls as a previous run, and warn that every attempt is a potentially mutating RPC.
- Labeled gRPC timing as callback-observed lifecycle boundaries: headers, first message, final status,
  and invoke return. Unary callbacks may cluster after transport completion; these values are not
  packet-arrival, server-processing, or TTFB measurements.
- Added safe, target-scoped gRPC replay: persisted redaction markers are never invoked, legacy
  records bind safely on first replay, unavailable/cross-target records fail in place, and browser
  storage failures are visible for saves and imports.
- Versioned workspace JSON as `protopeek-workspace` v1, removed automatic RPC history from default
  exports, and bounded imports to 4 MiB with structural, type, count, and string validation. Imported
  target paths stay inactive and are explicitly identified as ProtoPeek-host file-read authority.
- Added fail-safe browser-storage recovery: valid bounded records are salvaged without overwriting
  the exact readable original, every normal workspace write is schema-checked, full lists refuse new
  entries instead of evicting old ones, and normal import/export pauses until recovery is resolved.
- Made HTTP history credential-redacting and deterministic with a strict retained-header allowlist,
  no request body, URL user-info removal, credential-like query redaction, and a full reset of body,
  auth, timeout, redirect choice, prior errors, and response evidence before replay or a discovered
  origin handoff. Prior requests are cancelled and generation-guarded against stale completion.
- Added a lazy next-hop workbench backed by one read-only kernel route selection: direct Linux
  `RTM_GETROUTE`, Darwin routing sockets, and Windows `GetBestRoute2`, with bounded DNS, deadlines,
  concurrency, per-address failures, source/interface/gateway evidence, and no packets or privilege.
- Added streaming, non-persistent `nmap -oX` import with strict XML and collection bounds. Imported
  service labels remain untrusted hints and must pass the existing explicit bounded scanner before
  gRPC or HTTP can open; ProtoPeek never locates or runs Nmap/Npcap.
- Added a lazy in-app roadmap with Available in this build, Next, Exploring, and Gated states, and updated dashboard,
  help, README, site source, and detailed guides to distinguish next-hop lookup from traceroute and
  Nmap XML import from active Nmap execution.
- Unified the console, website, favicon, and install icons around the ProtoPeek waveform mark; added
  real light, persisted-dark, and 390 px dashboard captures; and aligned v0.3.0 canonical, social,
  manifest, sitemap, and structured metadata. Internal launch/runbook pages remain in the repository
  but are no longer indexed as end-user product documentation.
- Made the repository CI gate ignore tool caches, pin its analyzers into a local tools directory,
  and pass gofmt, vet, staticcheck, ineffassign, predeclared, Go tests, frontend tests, and a
  deterministic production build after release tooling has populated `.tmp`.

### Milestone 1 foundation

- Added a light-first Protocol Peek dashboard at `/`, moved the gRPC console to `/grpc`, retained
  `/http`, and kept exact `host:port` CLI startup opening directly into gRPC.
- Added a compact global command entry, protocol activity rail, shared keyboard-contained scan
  dialog, local recent discoveries, and guarded versioned light/dark preference storage.
- Extended bounded discovery to report independent gRPC, safe non-following HTTP `HEAD`, and open
  TCP evidence with fixed candidate/deadline limits and request cancellation.
- Kept traceroute/hop probes and Cap'n Proto gated and labeled Nmap and packet evidence as optional rather
  than presenting unimplemented diagnostics.

## v0.2.0 — 2026-08-20

- Rebuilt the local launcher and gRPC call workspace around explicit request,
  response, metadata, headers, trailers, deadline, and status inspection.
- Added loopback-only defaults, Host/Origin checks, explicit session teardown,
  and an opt-in unsafe remote-bind flag.
- Added responsive desktop and mobile workspaces while preserving reflection,
  proto, protoset, unary, and streaming behavior.
- Added a protocol rail with separate gRPC and HTTP request surfaces. The HTTP
  adapter uses the Go standard library and supports bounded HTTP(S) methods,
  headers, request/response bodies, timeouts, cancellation, redirect choice,
  protocol/status evidence, TLS/peer context, and phase timings.
- Made discovery results distinguish reflection, gRPC without reflection, and
  non-gRPC endpoints. Ambient probes remain fixed to loopback; private literals
  require opt-in, and explicit hosts use a small visible candidate policy.
- Made `pp <bare-host>` and `pp <HTTP(S)-authority>` open that same bounded,
  visible launcher probe while preserving exact `host:port` direct mode.
- Opened detected plaintext gRPC services in one action and stopped writing
  failed connection attempts to Recents.
- Redacted credentials, cookies, binary metadata, and API-key/token-like values
  from automatic history and default workspace export.
- Bounded JSON invoke/connect request envelopes, accepted parameterized JSON
  content types, fixed IPv6 browser URLs, added signal-aware local shutdown, and
  served an embedded favicon.
- Added accessible request/response tabs, an embedded-safe hash router, native
  Help drawer, focus containment/restoration, platform-correct shortcuts, and a
  narrow one-pane layout without placeholder protocol tabs.
- Added dual-command release archives, checksum-enforcing Unix and Windows
  installers, three-OS CI, archive SBOMs, and GitHub build provenance.
- Added a prerendered homepage, current social metadata, and cross-platform man
  pages.

## v0.1.6

- Historical tagged release before the local-console rebuild. See its immutable
  release notes and artifacts on GitHub.

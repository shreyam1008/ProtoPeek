# Changelog

All notable ProtoPeek changes are recorded here. Releases use Git tags as the
version source of truth.

## Unreleased — v0.3 milestone 2

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

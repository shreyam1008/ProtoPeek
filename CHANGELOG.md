# Changelog

All notable ProtoPeek changes are recorded here. Releases use Git tags as the
version source of truth.

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
  pages while keeping v0.2.0 in draft-candidate state until acceptance passes.

## v0.1.6

- Historical tagged release before the local-console rebuild. See its immutable
  release notes and artifacts on GitHub.

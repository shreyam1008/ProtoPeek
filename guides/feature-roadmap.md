# ProtoPeek roadmap


**8 September 2026 · edge update workflow:** `pp update` and `protopeek update` share a
bounded, verified updater across Windows/macOS/Linux. Settings → Updates adds manual
checks, stable/edge previews, availability warnings, confirmation, cancellation and restart
guidance. Package-managed installations retain their manager. Existing v0.6.1 installations
need an initial installer upgrade to obtain the command.

Updated for v0.6.1 on 7 September 2026. The [changelog](../CHANGELOG.md) records previous releases;
the [acceptance record](workbench-overhaul-2026-09.md) records tests, observations and remaining gaps.

## Current source after v0.6.1

**Published on the explicit [edge channel](https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.0.0-edge), after v0.6.1:** [local AI agents](/ai-agents/) adds MCP over stdio,
a JSON CLI and visible activity in the running workbench. Eleven bounded tools cover HTTP,
listeners, ports, routes, Tailscale inspection and downloads. Agent adapters for gRPC,
WebSocket/SSE, Cap’n Proto and capture remain future work. This is not part of v0.6.1.

The [workspace overhaul](ui-overhaul-2026-09.md) is also on edge: persistent grouped navigation,
last-tool resume, shared headers and recoverable route states, redesigned connection/queue/evidence
layouts, mobile command search and a searchable roadmap. The verified implementation at `1970338`
passed 776 UI tests, cross-platform CI and production archive checks. Browser PCAP and compiled
Cap’n Proto uploads now have real acceptance evidence; privileged live capture remains unverified.

## Available in v0.6.1

Six permanent destinations keep related tools together. Existing deep links remain compatible.

| Destination | Available work |
| --- | --- |
| Home | Resume workspaces, discover a target, fuzzy commands and saved HTTP requests |
| Inspect | gRPC, HTTP, WebSocket/SSE, Cap’n Proto, website and certificate evidence |
| Network | This Device, routes and hops, ports, private discovery, topology/history, Nmap, packets and Tailscale |
| Publish | Cloudflare Tunnel host/config inspection, explicit version checks and guarded service controls |
| Files | Local aria2 downloads, queue, destination browser, resume and completed history |
| Settings | Appearance, browser preferences, host download policy and reversible GoBarryGo migration |

### Protocol workbench

- gRPC reflection, host proto/protoset and browser-folder schemas; exact ProtoJSON templates;
  unary and all streaming shapes; metadata, headers, trailers, deadlines, cancellation and copy/export.
- HTTP methods, body/auth/headers, OpenAPI/Swagger JSON import, response timing/formatting,
  recoverable secret-safe drafts and up to 50 named browser-local recipes. Fuzzy commands load unsent recipes.
- WebSocket text/binary messages and SSE event inspection with explicit connection, bounded retained
  events, cancellation and typed transport failures.
- Cap’n Proto concrete bootstrap RPC with compiled schemas or optional source compiler, verified
  TLS, exact 64-bit values, JSON input/output and cancellation. See the [Cap’n Proto guide](capnp-workbench.md).

### Network and this device

- Single-host TCP port scans use bounded workers and distinguish open ports from likely service hints.
  Discovery hands targets into HTTP/gRPC without automatically sending requests.
- Native Windows IPv4/IPv6 ICMP and Linux UDP path evidence preserves timeouts and responder RTT.
  Optional public-IP country/ASN attribution identifies its external source; it cannot prove a
  datacenter, inter-router link latency or the return path.
- Authorized private discovery and optional Nmap connect scans produce bounded host/service evidence.
  Offline Nmap XML, snapshots, JSON/GraphML and the logical map retain provenance.
- PCAP/PCAPNG parsing shows bounded Ethernet/IP/TCP/UDP/ICMP and selected DNS/HTTP/TLS metadata.
  Optional dumpcap captures an explicitly selected interface and IP/port for a bounded period.
  This is not full Wireshark decoding, TCP stream reassembly or encrypted-payload decryption.
- This Device reads identity/interfaces and explicitly inspects Linux/Windows sockets, process
  ownership and aggregate traffic. Public-IP and provider speed checks are separate actions.
  Counter rates are interface totals, not per-process packet accounting.

### Installed tools and downloads

- Tailscale shows installed-client state, peers and netcheck/ping evidence. Account, connection,
  exit-node, advertisement and Taildrop actions use reviewed, bounded CLI operations with stale-state checks.
- Cloudflare Tunnel inspects canonical OS service/config authority, redacts credentials, compares
  versions on request and verifies reviewed start/stop/restart. Route drafts remain browser-only.
- Windows x64 embeds pinned aria2 1.37.0, adding about 2.36 MiB compressed. It is extracted only
  when starting downloads without a configured/PATH engine. Releases include notices and a source companion.
  Other platforms use installed aria2. The upstream bundled Windows TLS stack cannot reach TLS 1.3-only servers.
- Queue/history and settings survive restart in host files. The browser can close during downloads
  while ProtoPeek keeps running. On server restart, recoverable jobs can be explicitly resumed.
  Up to 16 connections is a configurable concurrency limit, not a guaranteed speed multiplier.

### Website evidence and local UX

- Explicit website DNS/TLS/header observation, five fixed HEAD path checks and separate historical
  certificate-name lookup. Redirects, certificate failures and fallback pages remain visible;
  no security score or complete subdomain-discovery claim is made.
- Side navigation, vertical protocol/settings tabs and independent scrolling preserve desktop height.
  Long operations expose progress, cancellation and actionable failures. Saved-state failures are visible.
- Protocol information explains each tool’s transport and evidence boundary. Lazy routes and bounded
  buffers keep unused tools out of the initial workbench cost.

## Next refinement priorities

| Priority | Work | Completion evidence |
| --- | --- | --- |
| 1 | Broaden native OS and installed-tool acceptance | Linux/macOS runtime runs, real capture backend, Cloudflare service fixtures and more Tailscale action scenarios |
| 1 | Improve desktop launch/recovery | Stable single-instance launch, clear occupied-port recovery and optional native service lifecycle |
| 2 | Extend saved request workflows | Import/export round trips, environment profiles and clear secret/persistence behavior |
| 2 | Deepen packet and path evidence | Bounded stream reconstruction, more decoders and platform-native probes without invented link/return measurements |
| 2 | Broaden bundled aria2 platforms | Reproducible small builds, notices/source supply and native install/download acceptance per architecture |
| 3 | Extend Cap’n Proto | Generic bindings and returned-capability calls with bounded capability lifetimes |
| 3 | Extend private access | Headscale custom control planes, then NetBird’s own ICE/relay/DNS model; integrated sign-in/elevation only with an explicit design |
| 3 | Extend publishing | Reviewed config writes, Quick Tunnel and Tailscale Serve/Funnel with clear audience, lifecycle and rollback |

No date is promised for these items. Headscale and NetBird are not interchangeable Tailscale adapters.
GoBarryGo and TailScout public retirement/redirects remain separate decisions.

## Verification and performance gates

For each change: exercise success and failure, variation in inputs, cancellation, reload/restart,
missing dependencies and responsive browser layout. Keep synthetic fixture evidence explicitly labeled.
Browser file selection was exercised through actual PCAP and compiled Cap’n Proto uploads. Real live
capture still needs an installed capture backend and native acceptance; parser tests alone do not prove it.

Run the frontend type/lint/tests, all Go packages, generated-site checks, bundle budgets and applicable
installer/package tests. Release CI repeats Windows/Linux/macOS tests, cross-platform generated builds,
container smoke and checksum/SBOM archive checks. The Windows installer is exercised from System32 in
both Windows PowerShell 5.1 and PowerShell 7.

Keep the runtime local-first, route-lazy and quiet when idle. Measure binary and initial/aggregate web
size, avoid unnecessary polling and bound every operation’s time, concurrency and retained evidence.
The detailed architectural contracts remain linked from the [documentation index](../README.md).

# ProtoPeek roadmap


**8 September 2026 · Nightly update workflow:** `pp update` and `protopeek update` share a
bounded, verified updater across Windows/macOS/Linux. Settings → Updates adds manual
checks, stable/nightly/legacy-edge previews, availability warnings, confirmation, cancellation and restart
guidance. Package-managed installations retain their manager. Existing v0.6.1 installations
need an initial installer upgrade to obtain the command.

Updated for v0.6.1 on 7 September 2026. The [changelog](../CHANGELOG.md) records previous releases;
the [acceptance record](workbench-overhaul-2026-09.md) records tests, observations and remaining gaps.

## Current-source checkpoint · 23 October 2026

The following capabilities are implemented in this source tree, separately from the v0.6.1 stable
binaries and earlier edge archives. Check the running build and its live agent catalog. Source,
fixture tests, native acceptance, exact-commit CI and public distribution are separate evidence.

| Journey | Current implementation | Boundary / remaining acceptance |
| --- | --- | --- |
| Diagnose a service | [Network diagnostics](/network-diagnostics/): connection stages, DNS records/resolver comparison, TLS, IPv4/IPv6 comparison, finite samples, TCP/UDP exchange, HTTP CONNECT/SOCKS5, h2c, verified HTTP/3 HEAD and offline subnet planning | Explicit bounded runs; proxy acceptance/TCP connectivity do not prove application health; private CA/credentials stay in memory; raw diagnostics are not MCP tools |
| Reuse a request | HTTP environment templates, session-only secret values, portable library import/merge and a reviewed cURL import subset | Import prepares an unsent editor; no shell execution, host file reads or insecure TLS; persistence/export strip secrets |
| Inspect protocol evidence | Incremental gRPC streams with headers/messages/trailers/local limits; Cap’n Proto generic bindings and typed returned-capability plans up to eight steps | No fabricated final status after local truncation; capability connections close after each bounded plan |
| Compare observations | Immutable A/B snapshot diff, sourced enrichment and reviewed Nmap XML-to-workspace conversion with exact loss counts | Ambiguous identities stay ambiguous; absence is “not observed”, not an outage; imported hints create no fake links |
| Triage packets | PCAPNG section/interface identity, transport-aware conversations, DHCP/QUIC-like metadata and explicit default-off TCP payload evidence | 32 flows/512 segments/64 KiB per flow/256 KiB total; gaps and conflicting overlap remain visible; metadata export omits payload; native dumpcap acceptance remains separate |
| Use native macOS evidence | Unprivileged ICMP backend and aggregate interface counters, with native macOS CI loopback/cancellation/traffic checks | Cross-compilation and portable fixtures are insufficient; actual macOS CI and real intermediate-hop acceptance remain required. Socket/process ownership remains unavailable |
| Reach private services | Reviewed separate Headscale HTTPS login-server account flow and distinct installed NetBird status/actions for management, signal, ICE, relay, DNS and peers | Native authentication/elevation remain user-owned; real supported-version/account acceptance is required; no Headscale administration or provider-model substitution |
| Publish deliberately | cloudflared validation, route match, bounded logs/metrics/diagnostics; reviewed writable user-owned canonical-config changes with validation/rollback; owned private Serve/public Quick Tunnel/Funnel sessions | Explicit audience/prerequisites/argv review; origin and public endpoint are verified separately. Windows owns a child job; Linux admits direct native vendor Go commands only, with an owned Stop process group and direct-child parent-death protection. Scripts, Snap/Flatpak launchers and unknown builds are refused; all macOS modes remain unavailable. Real provider accounts/native cleanup acceptance remain gates |
| Choose optional tools | [Twenty-entry Extensions library](/extensions/): six native workbenches and fourteen lazy command, MCP, endpoint or external companions | Checks are explicit metadata lookups; opening the library installs and executes nothing. Detection does not prove readiness. Observations stay in memory; only pins and the manual setup-platform ID persist. The existing Windows x64 aria2 companion remains the bundled exception |
| Connect an agent | [23 local MCP/CLI tools](/ai-agents/), including `extensions_list` and allowlisted `extension_inspect`, gRPC connect/schema/call/disconnect, compiled Cap’n Proto, finite receive-only events and caller-shared packet metadata | Strict schemas, 128 KiB input envelope, 512 KiB captured handler output and 64 KiB retained receipts. Native RPC deadlines ≤30 seconds inside a 35-second agent wall; other protocol/packet tools ≤30 seconds and shorter event/capture windows. Side-effecting tools require write actions; no arbitrary endpoints, host paths or reconstruction |
| Transfer to another device | [Local transfer](local-transfer.md): TLS 1.3, receiver approval, bounded concurrency, cancellation and SHA-256 receipts | Both peers enable a temporary session; VPN provisioning, relays, partial resume and real cross-machine discovery/throughput remain separate |
| Resume context | Typed consume-once drafts, original discovery provenance and up to 40 sanitized session receipts in memory | No operation starts from a handoff/history view; HTTP receipt targets omit paths/queries; reload clears receipts; earlier success is context, not current reachability |

The original local agent adapter is published on the explicit
[edge channel](https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.0.0-edge). The expanded
catalog above requires a matching current build; it is not claimed as a new public release.

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

## Remaining acceptance and deliberate limits

| Priority | Work | Completion evidence |
| --- | --- | --- |
| 1 | Exact-commit native acceptance | Windows/Linux/macOS CI, actual macOS loopback/counters and real-router checks; installed dumpcap/Npcap capture and cancellation on each supported OS |
| 1 | Installed accounts and publishing | Exercise actual Headscale/NetBird accounts, canonical cloudflared service/config ownership and private Serve/public Quick Tunnel/Funnel. Verify origin, endpoint and Stop/expiry/shutdown cleanup independently |
| 1 | Release/package acceptance | Validate final archives/installers/checksums and the pushed commit. Source/build success does not publish a release or complete Store/Snap/WinGet owner approval |
| 2 | Broader bundled aria2 | Reproducible small per-architecture builds, notices/source and native installed-engine/download acceptance; current fallback remains Windows amd64 |
| 3 | Optional native service lifecycle | Separate explicit installation, recovery, privileges and removal design; foreground launch/reuse does not install a system service |
| 3 | Persistent capability or advanced QUIC workflows | Current Cap’n Proto plans and HTTP/3 HEAD are bounded slices; durable capabilities and broader QUIC analysis need distinct lifetime/evidence contracts |

No date is promised for these gates. Headscale and NetBird are not interchangeable Tailscale adapters.
Administrator-owned config writes, credentials/account administration, implicit elevation, wider public
range discovery, raw payload export and decryption remain outside the implemented bounded flows.
TailScout remains an active standalone app; Tailscale workflows are also available in the full ProtoPeek package. GoBarryGo public retirement/redirects remain a separate decision.

## Maintainer: prepare WinGet manifests from real release artifacts

Current source includes an offline preparation script; it does not publish a release or submit to
WinGet. Supply authoritative published stable GitHub release JSON, its `checksums.txt`, and the
corresponding local Windows x86_64, x86_32 and arm64 ZIPs. The final output directory must not exist;
its parent must already exist. From the repository root:

```powershell
bun scripts/prepare-winget.ts .local/release/release.json .local/release/checksums.txt .local/release/archives .local/release/winget-prepared
winget validate --manifest .local/release/winget-prepared
```

The script derives the version from the stable tag, checks repository/release/download authority,
requires exactly one ZIP per architecture, and verifies each file's size and SHA-256 against the
checksums and GitHub asset digest when supplied. Only then does it create three schema-1.12.0
manifests for `ShreyamAdhikari.ProtoPeek`, declaring `protopeek.exe` and `pp.exe` portable aliases.
Existing output is never overwritten.

Synthetic fixture tests, or native `winget validate` on their generated manifests, prove preparation
and manifest acceptance only. The script does not inspect ZIP contents or PE architecture. Repeat
validation with real verified release artifacts, check executable identity/architecture, and exercise
native install, upgrade and both aliases before owner review/submission. Store/Snap/WinGet release
approval remains separate from source, build and CI success.

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

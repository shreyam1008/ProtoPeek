# ProtoPeek protocol roadmap

ProtoPeek is **Protocol Peek**: a local workbench for understanding the path from a
request to a server response. It is not trying to become a cloud API-management suite or a clone of
Postman. Its advantage is that difficult protocols remain explainable: the request editor, the
transport events, and the final evidence stay close together.

## Product contract

### What ProtoPeek is

- A single-binary, local-first console with no account, remote sync, or external database.
- A shared shell for targets, request editing, response evidence, local history, cancellation, and
  session lifecycle.
- A family of protocol adapters. Each adapter owns discovery, schemas, invocation, validation,
  cancellation, and protocol-native inspection.
- A tool that makes the request-server boundary legible under time pressure.

### What ProtoPeek is not

- A generic JSON box that hides gRPC trailers, Cap'n Proto capabilities, or HTTP status semantics.
- A cloud workspace, script marketplace, cookie automation layer, mock-server platform, or team
  collaboration product.
- A promise that every protocol belongs in the default binary. Future adapters should be opt-in when
  they add meaningful binary, dependency, or security cost.

## Current workbench: six shipped areas in v0.5.0

ProtoPeek v0.5.0 organizes the local workbench into exactly Overview, Protocols, Network,
Downloader, Security, and Settings. The shell is shared, but each operation keeps its own evidence,
consent, persistence, and dependency boundary.

The gRPC adapter remains the quality bar for protocol-native depth:

1. Discover services through reflection, loopback scan, a temporary browser-folder snapshot, host
   `.proto` paths, or host protoset paths.
2. Keep service and method selection visible in a searchable rail with unary, server-stream,
   client-stream, and bidirectional modes.
3. Generate an editable request payload from the reflected schema.
4. Invoke locally with deadlines, cancellation, plaintext/TLS choices, metadata, and Bearer helpers.
5. Render ordered response messages, headers, trailers, final status, and callback-observed handler
   lifecycle timing together without presenting it as packet arrival, server processing, or TTFB.
6. Run explicit canonical Health Check/Watch against the selected connection without polling,
   retrying, or presenting one backend observation as fleet health.
7. Preserve saved requests, secret-sanitized history/default export, checks, and command shortcuts
   without a server account.
8. Keep the local safety boundary explicit: loopback discovery by default and no arbitrary public
   network probing.

The HTTP adapter is the first additional protocol slice:

1. Send an explicit HTTP(S) method, URL, headers, and body through the local Go server.
2. Keep TLS verification on and redirect following off by default.
3. Bound request envelopes, request and response bodies, header counts, timeouts, and redirects.
4. Support cancellation and show status, HTTP protocol, headers, text/base64 body, byte count,
   truncation, redirect hops, remote address, TLS summary, and DNS/connect/TLS/TTFB/total timing.
5. Keep automatic local history secret-safe; credentials remain editable for the live request but
   are redacted before persistence or default export.
6. Preserve HTTP vocabulary instead of presenting HTTP as a gRPC-shaped or generic JSON call.

The evidence workbench keeps passive, active, discovered, imported, and manual records distinct:

1. Read one kernel-selected next hop per resolved address from the ProtoPeek process without
   packets, polling, route dumps, mutation, or privilege.
2. Import bounded `nmap -oX` XML without installing or executing Nmap and retain only host/port
   evidence.
3. Treat every imported service label as an untrusted hint and require the existing bounded scanner
   before opening gRPC or HTTP.
4. On Linux, run one explicit unprivileged UDP path plan while preserving DNS answers, the pinned
   destination, kernel route, every per-TTL sample, silent hops, and multiple responders. RTT stays
   source-to-responder, statistics stay per responder, and the destination median uses only replies
   from the exact pinned address; none is described as per-link latency. Saved responders are
   observed, while silent/destination placeholders and logical trace edges remain inferred.
5. Probe selected TCP ports inside one authorized RFC 1918 IPv4 `/24`-or-smaller scope, retaining
   positive evidence without inferring offline devices, OS, hardware, ownership, VLANs, or physical
   links. Only exact profile `applicationProbePorts` may receive bounded gRPC reflection plus a
   non-following HTTP `HEAD /`; every other selected port is TCP-connect-only.
6. Save observed, inferred, manual, and unknown evidence in a bounded local topology workspace with
   immutable snapshots and explicit import/export loss notices.
7. Keep next hop versus active path, selected TCP discovery versus general port scanning, and Nmap
   import versus Nmap execution permanently distinct.

## Shared adapter architecture

```text
local CLI / web server
        |
console shell: target -> operation -> request -> response evidence
        |
        +-- gRPC adapter       reflection | browser snapshot | host .proto | protoset
        +-- HTTP adapter       explicit HTTP(S) URL | standard library transport
        +-- route evidence     OS kernel query | one selected next hop
        +-- Network Path       native bounded probes | source RTT per responder
        +-- local network      authorized private /24-or-smaller | selected TCP profiles
        +-- topology notebook  logical evidence | immutable snapshots | local exchange
        +-- Nmap import        offline XML hints | explicit ProtoPeek verification
        +-- Downloader         external aria2c | local queue | retry/checksum evidence
        +-- Security           disclosed provider lookup | one consented public HEAD
        +-- Settings           browser preferences | explicit GoBarryGo bridge
        +-- Cap'n Proto adapter exploring: schema file | capability bootstrap
        +-- future adapters    only after a native UX + safety review
```

The shared boundary stays deliberately small:

| Boundary object | Shared responsibility | Adapter-owned detail |
|---|---|---|
| `Target` | identity, transport kind, local storage | TLS, capability bootstrap, URL/auth configuration |
| `Operation` | selectable operation and display name | RPC method, HTTP route, capability call, schema |
| `Invocation` | deadline, cancellation, request messages | encoding, framing, retries, stream semantics |
| `TransportEvent` | ordered timeline and timestamps | trailers, segments, status/headers, body chunks |
| `Inspector` | shell placement and navigation | native vocabulary, validation, evidence rendering |

Do not erase protocol differences to make the types look uniform. The shell can count messages and
show timing consistently, but the inspector must say “gRPC trailers”, “Cap'n Proto capability”, or
“HTTP response headers” when that is what the user is looking at.

## v0.5.0 workbench release

### Shipped in v0.5.0

- The six-area shell keeps Overview, Protocols, Network, Downloader, Security, and Settings on
  canonical routes with compatibility redirects for earlier links.
- Downloader queues one or up to 32 independent HTTP(S) jobs through an explicitly configured or
  system-installed `aria2c`, with deterministic partial success, per-job and whole-queue controls,
  private retry state, and single-job output/SHA-256 evidence. ProtoPeek does not bundle aria2.
- `pp download` exposes the same bounded transfer core for one terminal-owned job without attaching
  to an already-running browser process.
- Security ships one disclosed historical certificate-name lookup and one separately consented,
  public-only, non-following, bodyless `HEAD` observation with pinned DNS/TLS/HTTP evidence and no
  security score.
- Settings ships the read-first GoBarryGo bridge: observational preview, bounded copy-only import,
  paused imported jobs, private receipts, idempotence, and guarded rollback. GoBarryGo files,
  releases, repository history, and public origin remain independent.
- The owned Homebrew and Scoop channels install checksum-pinned v0.5.0 archives and declare aria2
  as an external package dependency. ProtoPeek itself still does not bundle aria2.

### Still gated after v0.5.0

- Search indexing evidence, the GoBarryGo retirement page and redirect, and any repository archival
  remain separate public-state gates.
- Artifact handoff, multi-step workflows, broader website plans, and additional protocols remain
  planned rather than implied by this release.

### Available in current source after v0.5.0

- A successful one-HEAD website observation now gains a deterministic local evidence report for
  HTTPS/TLS certificate validity, selected response headers, frame-embedding controls, Server
  disclosure, and retained redirect/HTTPS-upgrade evidence. The analyzer makes no additional
  request to the observed target and uses only `observed`, `not observed`, and `attention` labels.
- The copyable versioned JSON contains the retained observation, its fixed one-request boundary,
  derived labels, and the explicit warning that `HEAD` evidence can differ from `GET` and
  application behavior. This source refinement is not claimed as part of stable v0.5.0.

## Network workbench roadmap

### Now — shipped in v0.4.0

- A new gRPC target defaults to `localhost:50051`; a new HTTP draft defaults to `http://localhost:8080/`. Only exact loopback shorthand gains an implicit HTTP scheme, while remote targets must state `http://` or `https://`.
- Secret-safe HTTP history exposes the newest 12 entries with total observed time, and optional JSON formatting never blocks a deliberate raw invalid-JSON request.
- Linux Network Path uses the built-in unprivileged UDP error queue. It resolves once, pins a numeric destination, retains the process-selected route, and preserves bounded per-TTL samples, timeouts, ICMP details, and ECMP responders. Public probes require explicit acknowledgement. Saved responders are observed; silent-hop and unconfirmed-destination placeholders plus logical trace edges are inferred. Bounded safe zones preserve scoped IPv6 identities.
- The default path plan is 24 hops × 3 probes. Fixed maxima are 32 hops, four probes per hop, 96 probes total, 2,000 ms per probe, a 30-second wall, and 20 probes per second. Returned total duration is accepted only through the selected wall plus a 2-second resolver/return allowance.
- Local discovery requires an exact authorized RFC 1918 IPv4 CIDR of `/24` or narrower and one visible selected-TCP profile; capabilities return at most 32 deduplicated interface suggestions whose complete configured prefix lies inside RFC 1918. Exact `applicationProbePorts` are Quick `80, 443, 50051, 8080`; gRPC `443, 6565, 7000, 7443, 9090, 50051`; Web/API `80, 443, 3000, 4000, 5000, 8000, 8080, 8443`; and Expanded `80, 443, 3000, 8000, 8080, 8443, 9090, 50051`. Only those ports may receive bounded gRPC reflection and non-following HTTP `HEAD /`; every other selected port is TCP-connect-only, including Expanded's `22, 53, 445, 631, 1883, 3306, 3389, 5432, 6379, 9100`.
- Local discovery is capped at 18 ports, 4,572 attempts, 32 workers, 15 seconds, and one active scan. A 64 KiB aggregate verbose-detail budget never removes an observed open-port record. `attemptsCompleted` counts probe calls that returned, including cancellation returns; `probeDurationMs` is full probe duration—not network latency.
- The canonical `protopeek-network` JSON v1 model keeps logical nodes, identities, services, provenance, groups, positions, and full immutable snapshots. Later observations preserve saved manual labels, tags, notes, pinned positions, assignments, groups, services, and relationships; dirty edits are guarded until saved or deliberately discarded, and current-map restore is two-step. IndexedDB uses a 20-record cursor-bounded restore, compare-and-swap mutation with no stale-tab overwrite, visible failed-delete retention, the 4 MiB/workspace and 32 MiB total bounds, and explicit session-only fallback.
- GraphML import/export is explicitly lossy; import accepts one flat directed graph and rejects undirected/mixed, nested, hyperedge, port, duplicate, and XML-invalid-control structures. CSV is a flat inventory export. The topology map never presents TTL adjacency or inferred groups as physical links or observed VLAN membership; above 160 nodes, 640 relationships, or 64 groups it switches to a complete 100-record paged inventory.
- No Nmap, Npcap, `traceroute`, or `tracepath` executable is bundled, located, auto-installed, or run. Capability checks themselves send no probes.

### Soon — improve evidence depth

- Add verified unprivileged native active-hop backends for Darwin and Windows. Until then those platforms report active trace as unsupported while their passive kernel next-hop lookup remains available.
- Add editable source-labelled region/provider evidence and privacy-conscious passive enrichment. Codes such as `SIN`, `BOM`, `IAD`, or `us-east-1` remain context hints, never automatic datacenter proof.
- Compare immutable snapshots as added, removed, and changed evidence without calling an unobserved address offline.
- Refine manual subnet and VLAN organization while keeping it visually and semantically separate from scan-derived facts.

### Later — optional integrations after safety and size review

- Map bounded existing Nmap XML into a topology workspace with import provenance and clear loss notices. This remains optional input and does not execute Nmap.
- Consider native TCP or ICMP path methods only after reliable unprivileged implementations preserve the same consent, cancellation, partial-evidence, and resource-limit contract.
- Consider a geographic base-map view only if download size, network requests, privacy, offline behavior, and evidence provenance remain explicit. The dependency-free logical canvas stays the primary view.
- Keep live capture gated until privilege, lifecycle, secret-redaction, and teardown behavior are dependable across supported platforms.

## Delivery plan

### Phase 1 — gRPC hardening (live)

The reference adapter currently preserves:

- reflection, temporary browser-folder snapshots, host proto paths, and protoset schema paths;
- unary, client-streaming, server-streaming, and bidirectional invocation;
- visible request metadata, deadlines, cancellation, response headers, messages, trailers, status,
  and timing;
- bounded loopback discovery plus an explicit-target policy that reports reflection and transport
  outcomes separately;
- credentials and binary metadata kept out of automatic history and default exports.

Channelz links, pre-invoke hooks, and richer flow reports are proposals, not current controls. They
need fixtures and a native evidence model before entering the workbench.

### Phase 2 — bounded HTTP / REST (live)

The first HTTP adapter supports one explicit request path: method, URL, query params, headers,
live auth input, raw body, timeout, redirect choice, cancellation, and a native response inspector.
It uses Go's standard HTTP stack and accepts only `http` and `https` URLs. TLS verification is on
and redirect following is off by default.

Bounded cURL export is available in this build. Send and Copy validate the same prepared draft; one
explicit click then exports its method, duplicate query parameters, non-sensitive headers, timeout,
and active body with POSIX-safe quoting. Credential-like URL values become blank and auth/sensitive
headers are omitted; the UI reports the omission count. Redirect-enabled drafts are refused because
one portable command cannot reproduce ProtoPeek's bounded redirect policy. Export inspects at most
64 effective headers and caps the UTF-8 command at 512 KiB. An active request body is copied verbatim
and must be reviewed before the command is shared or run. The shell's DNS, network namespace,
proxies, trust roots, cURL version, and implicit headers may differ from the ProtoPeek relay.

This slice deliberately excludes OpenAPI discovery, a cookie jar, cloud sync, script runners, mock
servers, OAuth app marketplaces, and team workspaces. Those features are not implied by the HTTP
surface and would require separate product and security review.

The live handler applies one shared low-end-friendly admission budget per operation class: eight
ordinary gRPC invokes across direct and workspace sessions, four HTTP relays, and two native route
requests. Admission happens only after method and CSRF checks and before request-body or network
work. Saturation is an explicit non-cacheable `429`; completion, validation/error, cancellation,
panic unwinding, and workspace deletion free the slot. Existing per-request fan-out and evidence
limits remain in force inside each admitted operation.

Ordinary invokes also have a retention boundary independent of admission: 512 response messages,
8 MiB of serialized response-message JSON, and a 60-second handler wall when the requested deadline
is absent or larger. Equality may complete normally; only message 513, a message that would cross
the byte cap, or the local wall cancels the RPC. The console preserves bounded partial evidence and
labels the server's final status as unobserved rather than converting local cancellation into a
gRPC result.

### Milestone 2 — next-hop and offline Nmap evidence (available in this build)

- Linux uses direct `RTM_GETROUTE`, Darwin uses a routing socket, and Windows uses
  `GetBestRoute2`; other targets report explicit unsupported evidence.
- DNS and route work share strict address, concurrency, and requested deadline limits. Individual route
  failures remain visible beside successful sibling addresses.
- Streaming XML parsing accepts the ordinary bare Nmap DOCTYPE without resolving external data,
  rejects external/entity input, and bounds bytes, XML work, hosts, ports, addresses, hostnames,
  and retained attributes. XML and inventory are never persisted.
- The in-app roadmap names Available in this build, Next, Exploring, and Gated states without fake dates or
  controls.

### Milestone 3 — browser schema snapshots and repeatable unary evidence (available in this build)

- A user-selected folder becomes one bounded, lowercase `.proto` snapshot: at most 512 files,
  4 MiB per file, and 16 MiB total. Relative imports are preserved and must stay inside that selected
  root, apart from parser-provided Google well-known protos.
- File System Access is used only when the browser exposes it; directory input remains the fallback.
  Selection always requires a user gesture and ProtoPeek persists no handle, file byte, root name,
  browser path, or staging path.
- Snapshot bytes go to the machine or container running the current ProtoPeek instance, never to the
  gRPC target. The server validates the complete multipart contract again, compiles through a
  manifest-only in-memory resolver, clears the bounded upload buffers before dialing or publishing a
  session, and writes no schema staging files.
- Host proto/protoset and certificate paths remain process-authority inputs in separate labeled
  modes. A browser-folder profile is pathless and requires the folder to be selected again after a
  reload or import.
- Non-upload workspace schema connects share two manager slots. Host schema configuration is capped
  at 128 proto entry paths, 64 import roots, or 32 protosets, with 4,096-byte paths and a 32 KiB
  aggregate. Explicit entry/protoset files are preflighted at 4 MiB each and 16 MiB total before
  dial/parse; import roots are host authority for referenced imports, not recursively pre-read input.
- Reflection fetches descriptor graphs incrementally and stops at the first limit. All workspace
  sources must fit 512 retained services, 10,000 methods, 1,024 files, 10,000 messages, 50,000
  fields, 4,096 enums, 50,000 enum values, 32 levels of message nesting, 8 MiB of serialized
  descriptors, and a 16 MiB catalog before publication. Structural counts run before catalog
  materialization. Cancellation is observed between fetches and before dial/publication, and schema
  contents or metadata values are not copied into errors.
- Bounded Unary Repeat and callback-observed lifecycle timing close a common evidence gap without
  pretending to be packet timing or a load generator.

### Milestone 4 — explicit gRPC health evidence (available in this build)

- Canonical `grpc.health.v1.Health/Check` keeps the reported serving enum separate from the final
  gRPC status and preserves bounded response headers, trailers, and handler-observed duration.
- `Health/Watch` is one user-started server stream, not polling: it has a 1–600 second wall duration,
  a 512-observation server cap, latest-200 browser retention with a dropped count, cancellation, and
  a final NDJSON evidence frame. Four Watches may run across direct and workspace sessions per
  console; Check does not consume those slots.
- A blank service requests overall server health. Unknown named services remain canonical:
  Check ends `NOT_FOUND`, while Watch reports `SERVICE_UNKNOWN` and stays open until the server or
  local bound ends it. `UNIMPLEMENTED` ends once and is never retried.
- Health uses the live request metadata with the same precedence and binary decoding as Invoke, but
  never echoes, stores, or exports those request values. Observed times belong to the ProtoPeek
  handler/relay and one selected backend connection; they are not packet, server-emission,
  dependency, replica-set, or fleet-health evidence.

### Distribution — owned package channels (available)

- The verified release resolvers and `@v0.5.0` install the published v0.5.0 release archives;
  Downloader still uses a separate system or configured `aria2c`.
- The owned Homebrew tap installs the checked v0.5.0 archives as `protopeek` and `pp` on macOS and
  Linux, with both manpages, and declares aria2 as an external dependency.
- The owned Scoop bucket installs the checked v0.5.0 Windows archives with both command shims, an
  external aria2 dependency, and a checksum-backed autoupdate contract.
- WinGet is next only after these owned paths and the PowerShell installer accumulate initial user
  feedback. Community submission remains an explicit owner action.

### Next — daily workflow gaps

- incremental delivery in the general gRPC response lab with bounded retention;
- saved HTTP requests and profiles;
- bounded cURL import (export is available);
- target DNS, SNI, ALPN, certificate, and TLS-handshake preflight.

### Exploring — evidence and protocol fit

WebSocket/SSE timelines, bounded PCAP import with Wireshark/TShark handoff, Cap'n Proto, and
QUIC/HTTP3 remain research. Each must preserve native evidence and prove its runtime/dependency
cost.

### Gated — operations with a wider safety boundary

- Bundled Nmap execution is not planned for the core binary. Any future opt-in companion needs an explicit executable choice, previewed scope, hard budgets, and an auditable command.
- Darwin and Windows active path probing remains unavailable until each has a verified unprivileged native backend; no shell-parser or elevation fallback is offered.
- Network discovery broader than one authorized RFC 1918 IPv4 `/24`, public-range expansion, and IPv6 range discovery remain outside the current selected-TCP workflow.
- Live capture needs explicit lifecycle, redaction/export policy, privilege handling, and reliable teardown.

### Later experiment — Cap'n Proto

Start with one useful, local path rather than a large protocol surface:

1. Accept a schema file and an explicit capability bootstrap configuration.
2. Discover one unary operation and generate a typed editable request.
3. Show message segments, capability resolution, and call outcome in a Cap'n Proto inspector.
4. Keep the adapter behind an experimental flag or optional companion until dependency and binary
   costs are measured.
5. Add fixture servers and failure cases for missing capabilities, malformed segments, and timeout.

Exit gate: a user can understand what capability was requested, what was sent, and why a call failed
without reading a generic JSON translation.

### Protocol shelf (later)

SMTP, FTP, and other request-server protocols are candidates, not commitments. For each one, write
a short protocol brief before implementation:

- What is the smallest useful local request?
- What is the native evidence (envelope, command transcript, status, stream, capability, or body)?
- What credentials or destructive actions need an explicit boundary?
- Can it ship as an opt-in adapter without bloating the gRPC path?
- What failure states deserve a dedicated inspector rather than a generic error banner?

If those answers are weak, keep the protocol in research instead of adding a superficial tab.

## UX rules for every adapter

1. **Less typing, more signal.** Discover local targets and schemas where safe; never silently probe
   arbitrary public hosts.
2. **One obvious primary action.** The request workspace should make invoke/send easy to find and
   cancellation equally clear.
3. **Evidence beside the action.** Put headers, trailers, status, timing, and native details near
   the response, not behind an unrelated settings screen.
4. **Protocol words matter.** Do not call every result “response JSON” when it is a stream, segment,
   capability, or HTTP body.
5. **Local means local.** Do not introduce an account to make the core workflow work. Redact
   credentials and binary metadata from automatic history and default exports.
6. **Keyboard and narrow screens count.** Preserve command palette, search, shortcuts, and a useful
   mobile request/response flow.

## Verification gates

Before an adapter is called shipped:

- unit and contract tests cover discovery, invocation, cancellation, malformed input, and timeouts;
- a local fixture server exercises successful and failure paths;
- default gRPC startup time and bundle size do not materially regress;
- secrets are not persisted accidentally;
- browser QA proves the primary action, response evidence, error state, and narrow layout;
- README, website, roadmap, product metadata, and screenshots all describe the same current state;
- the adapter has a rollback flag or can be omitted from the default binary.

### v0.3.0 bundle evidence and regression budgets

The final v0.3.0 production console build measures 304.24 kB / 97.56 kB gzip for the shared entry,
107.35 kB / 28.22 kB gzip for the lazy gRPC workspace, and 130.98 kB / 23.84 kB gzip for shared CSS.
The HTTP workbench and its React Query provider stay in a 43.53 kB / 12.92 kB gzip lazy route; scan
tools stay behind an 11.26 kB / 4.06 kB gzip dialog boundary. Next-hop and roadmap remain lazy at
6.05 kB / 1.96 kB gzip and 4.67 kB / 2.18 kB gzip.

Compared with the previously recorded v0.3 milestone build, the shared entry is 4.89 kB smaller
gzip after moving HTTP-only query infrastructure out of startup. The gRPC workspace adds 3.98 kB
gzip for canonical Health Check/Watch and bounded evidence handling, while CSS adds 1.49 kB gzip for
the Health inspector, responsive states, contrast, and motion safeguards. No frontend dependency was
added. Future adapters must preserve these lazy boundaries and the no-heavy-chart-library budget.

The canonical `bun run build` measures every emitted console JavaScript/CSS asset. Current ceilings
are: shared entry 320 KiB / 105 KiB gzip; lazy gRPC workspace 116 KiB / 32 KiB; lazy HTTP workspace
54 KiB / 16 KiB; lazy scan dialog 15 KiB / 5 KiB; shared CSS 140 KiB / 27 KiB; network shell 64 KiB /
20 KiB, aggregate network JavaScript 132 KiB / 40 KiB, and network CSS 34 KiB / 6 KiB; Downloader
24 KiB / 8 KiB JavaScript, 16 KiB / 4 KiB base CSS, and 4 KiB / 2 KiB lazy advanced CSS; Security
36 KiB / 10 KiB JavaScript and 22 KiB / 5 KiB CSS; suite shell pages CSS 12 KiB / 3 KiB; Settings CSS
8 KiB / 2 KiB; all JavaScript 768 KiB / 240 KiB; and all CSS 224 KiB / 42 KiB. Single-chunk rules
fail on a missing or duplicate match, and aggregate rules keep growth visible across lazy boundaries.
These are regression ceilings for the current unified suite, not target payload sizes; individual
route budgets preserve the lighter v0.3 architecture.

## Research trail

- [Network workbench guide](/network-workbench/)
- [Route, path, discovery, and Nmap boundaries](/route-and-nmap-evidence/)
- [ProtoPeek competitive workflow decisions](/competitive-landscape/)
- [gRPC guides](https://grpc.io/docs/guides/)
- [gRPC debugging](https://grpc.io/docs/guides/debugging/)
- [gRPC health checking](https://grpc.io/docs/guides/health-checking/)
- [Canonical gRPC Health protocol](https://github.com/grpc/grpc-proto/blob/master/grpc/health/v1/health.proto)
- [gRPC-Web basics](https://grpc.io/docs/platforms/web/basics/)
- [Envoy gRPC overview](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_protocols/grpc.html)
- [Postman gRPC request interface](https://learning.postman.com/docs/sending-requests/grpc/grpc-request-interface/)
- [File System Access specification](https://wicg.github.io/file-system-access/)
- [FormData entry-list specification](https://xhr.spec.whatwg.org/#interface-formdata)

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

## Current workbench: gRPC + HTTP + bounded evidence

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

v0.3.0 ships two deliberately narrow evidence inputs:

1. Read one kernel-selected next hop per resolved address from the ProtoPeek process without
   packets, polling, route dumps, mutation, or privilege.
2. Import bounded `nmap -oX` XML without installing or executing Nmap and retain only host/port
   evidence.
3. Treat every imported service label as an untrusted hint and require the existing bounded scanner
   before opening gRPC or HTTP.
4. Keep next-hop versus traceroute and Nmap import versus Nmap execution permanently distinct.

## Shared adapter architecture

```text
local CLI / web server
        |
console shell: target -> operation -> request -> response evidence
        |
        +-- gRPC adapter       reflection | browser snapshot | host .proto | protoset
        +-- HTTP adapter       explicit HTTP(S) URL | standard library transport
        +-- route evidence     OS kernel query | one selected next hop
        +-- Nmap import        offline XML hints | explicit ProtoPeek verification
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

This slice deliberately excludes OpenAPI discovery, a cookie jar, cloud sync, script runners, mock
servers, OAuth app marketplaces, and team workspaces. Those features are not implied by the HTTP
surface and would require separate product and security review.

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

- The owned Homebrew tap installs the same checked v0.3.0 archives as `protopeek` and `pp` on macOS
  and Linux, with both manpages.
- The owned Scoop bucket installs the checked Windows archives with both command shims and a
  checksum-backed autoupdate contract.
- WinGet is next only after these owned paths and the PowerShell installer accumulate initial user
  feedback. Community submission remains an explicit owner action.

### Next — daily workflow gaps

- incremental delivery in the general gRPC response lab with bounded retention;
- saved HTTP requests and profiles;
- bounded cURL import/export;
- target DNS, SNI, ALPN, certificate, and TLS-handshake preflight.

### Exploring — evidence and protocol fit

WebSocket/SSE timelines, bounded PCAP import with Wireshark/TShark handoff, Cap'n Proto, and
QUIC/HTTP3 remain research. Each must preserve native evidence and prove its runtime/dependency
cost.

### Gated — operations with a wider safety boundary

- Bundled Nmap execution is not planned for the core binary. Any future opt-in companion needs an
  explicit executable choice, previewed scope, hard budgets, and an auditable command.
- Traceroute/hop probes need consent, strict budgets, truthful partial failures, and reliable
  unprivileged backends.
- LAN range expansion needs previewed private scope, opt-in, hard candidate/time limits, and
  cancellation.
- Live capture needs explicit lifecycle, redaction/export policy, privilege handling, and reliable
  teardown.

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

### v0.3.0 bundle evidence

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

## Research trail

- [gRPC guides](https://grpc.io/docs/guides/)
- [gRPC debugging](https://grpc.io/docs/guides/debugging/)
- [gRPC health checking](https://grpc.io/docs/guides/health-checking/)
- [Canonical gRPC Health protocol](https://github.com/grpc/grpc-proto/blob/master/grpc/health/v1/health.proto)
- [gRPC-Web basics](https://grpc.io/docs/platforms/web/basics/)
- [Envoy gRPC overview](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_protocols/grpc.html)
- [Postman gRPC request interface](https://learning.postman.com/docs/sending-requests/grpc/grpc-request-interface/)
- [File System Access specification](https://wicg.github.io/file-system-access/)
- [FormData entry-list specification](https://xhr.spec.whatwg.org/#interface-formdata)

# Transport boundaries

ProtoPeek is Protocol Peek: a local protocol console, not a general collaboration client. Its
durable product advantage is the short path from a real target to an explainable request, response,
and transport story.

## Product contract

- `pp host:port` and `protopeek host:port` keep their direct gRPC-compatible CLI meaning and open
  the `/grpc` workbench. With no target the browser opens the Protocol Peek dashboard at `/`. A
  bare host or HTTP(S) authority opens the dashboard scan dialog with that one target prefilled and
  visibly probed. The activity rail selects either the gRPC or HTTP adapter explicitly.
- Every session runs locally, without an account, remote sync, or external database.
- Each transport keeps its native concepts visible. The UI must not flatten gRPC trailers,
  Cap'n Proto capabilities, or HTTP status and headers into a misleading common response object.
- Reflection, temporary browser-folder snapshots, host proto paths, and host protoset paths remain
  first-class gRPC schema paths. Their authority boundaries stay visibly separate.
- Automatic discovery is loopback-only. Explicit private or link-local destinations require a
  per-scan opt-in. An explicit public IP or hostname is one user-entered target, never permission
  for port-range expansion. Hostnames are resolved once, all returned addresses are classified,
  and probes dial a validated numeric address to avoid a policy-to-dial DNS change. An
  explicit host without a port has only the visible `50051` plaintext and `443` verified-TLS
  candidates. CIDR expansion and ambient network crawling are outside this boundary.
- Scan evidence is independently labeled as verified gRPC, safe HTTP, or open TCP. HTTP evidence
  uses only `HEAD /`, verified TLS where applicable, fixed per-protocol and whole-request deadlines,
  no body, no authentication, and no redirect following. Closing or cancelling the dialog cancels
  the request context. The handler admits two scan requests at once and rejects excess work before
  reading its body. One request accepts at most 20 inputs expanding to 24 candidates and has a
  four-second wall deadline. Each retained service name is at most 1 KiB, with 64 names and 32 KiB
  aggregate; reflection receive and response-header evidence are each capped at 64 KiB. Diagnostic
  details and the primary error are capped at 2 KiB each, while HTTP protocol, status, and Server
  evidence are capped at 64, 512, and 256 bytes. Truncation is explicit in the result rather than
  silently presented as complete evidence.
- Next-hop evidence is one read-only kernel-selected route per resolved address from the ProtoPeek
  process. It sends no hop probes (hostnames may still resolve through DNS), does not trace hops,
  does not poll or mutate routes, and requires no elevation. Its UI
  permanently states that VPNs, proxies, policy routing, ECMP, and later changes can alter a real
  connection path.
- Nmap is not required to import an existing XML file. To create new XML, users obtain and run Nmap
  separately. ProtoPeek only imports bounded `nmap -oX` XML, retains no command
  arguments/scripts/OS/trace data, persists no inventory, and treats service names as hints until
  the existing bounded scanner verifies a literal-IP endpoint.
- New transports must not add a heavy runtime or materially grow the browser bundle without a
  measured reason. The first HTTP adapter uses the Go standard library.

## Architecture

The console shell owns target selection, the split request/response workspace, local history, and
session lifecycle. A transport adapter owns discovery, schema loading, request validation,
invocation, cancellation, and transport events.

```text
pp CLI / local web server
        |
console session manager
        |
        +-- gRPC adapter       reflection | browser snapshot | host .proto | protoset
        +-- HTTP adapter       explicit HTTP(S) URL | bounded stdlib client
        +-- route evidence     kernel-selected next hop | no probe packets
        +-- Nmap import        offline XML hints -> bounded verification
        +-- Cap'n Proto adapter exploring: schema file | capability bootstrap
        |
ordered transport events -> protocol-specific inspector
```

Bundled Nmap execution is not planned for the core binary; traceroute/hop probes, LAN range
expansion, and live capture remain gated.
Offline Nmap XML import ships in v0.3.0, but Nmap itself is not bundled or invoked. Next-hop
evidence ships in the same release, but it is not traceroute/hop probing.

The shared boundary should stay deliberately small:

1. `Target`: transport kind plus adapter-owned connection configuration.
2. `Operation`: a selectable RPC or HTTP operation with an adapter-owned schema.
3. `Invocation`: deadline, metadata, and one or more request messages.
4. `TransportEvent`: ordered events such as connected, headers, request message, response message,
   trailers, status, capability resolution, or HTTP body chunk.

Adapters return their native detail alongside these events. The shell can render timing and
message counts consistently, while a protocol inspector renders the actual semantics.

## Delivery slices

### 1. Finish the gRPC local-console contract

Keep the current slice as the reference adapter: bounded loopback discovery, deterministic
sessions, reflection headers, browser-folder/host-proto/protoset compatibility, request/response
split view, explicit cancellation, callback-observed response timing, and visible headers, trailers,
deadlines, streaming mode, and status. Headers, first message, final status, and invoke return are handler lifecycle
boundaries, not packet-arrival, server-processing, or TTFB measurements; unary callbacks may cluster
after transport completion.

Health is a separate, explicit gRPC diagnostic rather than a background liveness monitor. Check
accepts a 0.1–30 second deadline (5 seconds by default). Watch accepts a 1–600 second duration
(60 seconds by default), performs no retry or polling, and shares four stream slots across direct
and workspace sessions. The server accepts at most a 64 KiB JSON envelope, 1,024 UTF-8 bytes for a
service name, and 64 request-body metadata entries / 32 KiB aggregate. Configured CLI metadata and
explicitly preserved relay headers still follow the existing Invoke precedence. It emits at most 512 status
observations; each flushed NDJSON line is at most 64 KiB and response headers plus trailers share a
32 KiB retained evidence budget. The browser validates event order and attribution, retains the
latest 200 transitions with a dropped count, and treats missing terminal evidence as truncation.

Blank service means overall server health. Unknown service semantics are not normalized away:
Check has no fabricated serving enum and ends `NOT_FOUND`; Watch reports `SERVICE_UNKNOWN` and stays
open. `UNIMPLEMENTED` ends the one Watch epoch without retry. Live request metadata follows Invoke
precedence and binary decoding but is never returned, persisted, or exported. Every timestamp is a
ProtoPeek handler/relay observation against one selected connection, not packet arrival, server
emission, dependency health, load-balancer coverage, or fleet health.

### 2. Keep the HTTP slice bounded

The live HTTP surface accepts method, URL, headers, body, timeout, and redirect choice. It accepts
only `http` and `https`, keeps TLS verification on, leaves redirects off by default, supports
cancellation, and bounds envelopes, bodies, headers, redirects, and deadlines. Its inspector owns
status, HTTP protocol, response headers, text/base64 body, byte and truncation evidence, redirect
hops, peer/TLS context, and phase timings.

Automatic HTTP history keeps only method, sanitized URL, status, total time, and values from a small
header allowlist (`Accept*`, cache/conditional controls, `Content-Type`, range/preference, trace
context, and request/correlation IDs). Every other header value is replaced with `[redacted]`; URL
user info is removed and credential-like query names are redacted. It never retains the request
body. Replaying an entry resets params, auth, body mode/body, timeout, redirect choice, validation
state, and previous response before restoring those persisted fields, so a stale editor value cannot
silently join the replayed request.

### 3. Bound workspace transfer and replay

The default workspace export is the explicit `protopeek-workspace` version 1 JSON format. It
includes saved requests, environments, assertions, and target profiles, but excludes automatic RPC
history. Metadata is sanitized again at export time. Saved request bodies are intentionally included
and must be reviewed before a file is shared.

Import checks the file's reported size before reading any text and rejects files over 4 MiB. Both
version 1 and the previous unversioned export shape pass through the same validator: at most 100
assertions, 100 saved requests, 50 environments, 50 history entries, 50 targets, 64 metadata entries
per record, and 32 entries in each target path list. Request JSON is capped at 512 KiB; metadata
values at 64 KiB; notes at 16 KiB; and target paths at 4,096 characters. Wrong container types,
unsupported versions/enums, duplicate IDs, non-finite/out-of-range numbers, and oversized strings
are refused without replacing the console with a boot error.

Normal workspace writes pass through the same bounded schema before persistence. Hitting a target,
environment, or saved-request limit refuses the new record; it does not discard an older record. On
startup, one malformed, duplicate, or over-limit stored record does not erase the entire section:
valid bounded records remain usable in the live session while the exact readable source string stays
untouched in its original key. A persistent recovery banner can download the raw, deliberately
non-importable source or explicitly replace it with the recovered records. Imports and normal exports
that touch unresolved recovery are paused. Browser read failures are called out separately because
their original bytes cannot be captured.

Imported target IDs are detached from any live session and no imported target connects
automatically. Host proto/protoset/import-root/CA/client-certificate/client-key values name files on
the machine running ProtoPeek—not paths on the browser machine. An explicit later connection grants
the ProtoPeek process local file-read authority for those paths, and the import result warns about
that boundary. Browser-folder profiles are different: storage and workspace export contain only the
pathless profile configuration. A browser must choose the folder again before connection; handles,
bytes, root names, browser paths, and server filesystem paths never persist. A successful target-profile
replacement invalidates pending connection work and returns any active profile session to the
launcher before an imported profile can be used.

Browser-folder connect is one CSRF-protected multipart transaction on the existing workspace
endpoint. The client mirrors limits for fast feedback, but the server independently enforces the
20 MiB envelope, 512-file, 4 MiB per-file, 16 MiB aggregate, and portable-relative-path bounds. Only
the exact manifest may satisfy imports; absolute, backslash, traversal, duplicate, case-colliding,
reserved, and non-`.proto` paths fail before compilation. Google well-known protos are the only
non-manifest fallback. The server clears bounded in-memory upload buffers before the target is dialed
or the session is published and writes no schema staging files. Snapshot bytes go only to the
current ProtoPeek process or container and never to the gRPC target.

New saved requests and automatic gRPC history carry target-profile ID plus target address. Replay
requires the method to exist and the stored scope to match. Legacy records without scope may be
applied only to a method available on the current target, then bind to that target on first replay.
Persisted `[redacted]` metadata values restore as blank inputs with a re-entry warning. Invocation
filters out blank sensitive values and the sentinel again at the send boundary; Unary Repeat applies
the same filtering. Repeat JSON exports contain the method, target, run ID/start timestamp, frozen
configuration, counts, per-attempt offsets/timings, classifications, and error/status text—never the
request body or metadata. Review target/internal addresses and service/relay text before sharing.
`handlerInvokeMs` includes JSON/protobuf conversion and callbacks but excludes the browser/HTTP
relay; `consoleRoundTripMs` includes that relay and response parsing.

### 4. Keep route and imported evidence read-only

Use OS-native route APIs for one selected next hop and bounded streaming XML for offline Nmap
evidence. Preserve source/interface/gateway and table/probed confidence, but require a fresh
ProtoPeek scan before an imported hint can open a workbench. See
[the route and Nmap evidence guide](https://protopeek.shreyam1008.com.np/route-and-nmap-evidence/)
for exact limits and platform behavior.

### 5. Cap'n Proto experiment (exploring)

Build one local, schema-file-driven unary/capability call path behind an explicit experimental
flag. Show capability resolution and message segments in its own inspector. Measure binary and
bundle cost before deciding whether it belongs in the main binary or an optional companion.

### 6. Traceroute and LAN expansion (gated)

Traceroute requires consent, a bounded probe source, explicit uncertainty, and partial-failure tests.
LAN discovery requires a user-enabled, previewed private scope plus strict candidate/time budgets
and cancellation. Neither is a clickable surface today; public or ambient network crawling remains
out of scope.

## Release gates for any adapter

- Default gRPC startup time and bundle size do not materially regress.
- The adapter works without a database or network service other than the target being inspected.
- Cancellation and session teardown release connections and subprocesses.
- Authorization, cookies, proxy authorization, binary metadata, and API-key/token-like metadata are
  redacted from automatic history and default exports.
- The inspector names the real protocol concepts instead of using generic labels.

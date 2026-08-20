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
- Reflection, proto files, and protosets remain first-class gRPC schema paths.
- Automatic discovery is loopback-only. Explicit private or link-local destinations require a
  per-scan opt-in. An explicit public IP or hostname is one user-entered target, never permission
  for port-range expansion. Hostnames are resolved once, all returned addresses are classified,
  and probes dial a validated numeric address to avoid a policy-to-dial DNS change. An
  explicit host without a port has only the visible `50051` plaintext and `443` verified-TLS
  candidates. CIDR expansion and ambient network crawling are outside this boundary.
- Scan evidence is independently labeled as verified gRPC, safe HTTP, or open TCP. HTTP evidence
  uses only `HEAD /`, verified TLS where applicable, fixed per-protocol and whole-request deadlines,
  no body, no authentication, and no redirect following. Closing or cancelling the dialog cancels
  the request context.
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
        +-- gRPC adapter       reflection | .proto | protoset
        +-- HTTP adapter       explicit HTTP(S) URL | bounded stdlib client
        +-- route evidence     kernel-selected next hop | no probe packets
        +-- Nmap import        offline XML hints -> bounded verification
        +-- Cap'n Proto adapter exploring: schema file | capability bootstrap
        |
ordered transport events -> protocol-specific inspector
```

Bundled Nmap execution is not planned for the core binary; traceroute/hop probes, LAN range
expansion, and live capture remain gated.
Offline Nmap XML import is available in the v0.3 source build, but Nmap itself is not bundled or
invoked. Next-hop evidence is available in that build, but it is not traceroute/hop probing.

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
sessions, reflection headers, proto/protoset compatibility, request/response split view, explicit
cancellation, ordered response timing, and visible headers, trailers, deadlines, streaming mode,
and status.

### 2. Keep the HTTP slice bounded

The live HTTP surface accepts method, URL, headers, body, timeout, and redirect choice. It accepts
only `http` and `https`, keeps TLS verification on, leaves redirects off by default, supports
cancellation, and bounds envelopes, bodies, headers, redirects, and deadlines. Its inspector owns
status, HTTP protocol, response headers, text/base64 body, byte and truncation evidence, redirect
hops, peer/TLS context, and phase timings.

### 3. Keep route and imported evidence read-only

Use OS-native route APIs for one selected next hop and bounded streaming XML for offline Nmap
evidence. Preserve source/interface/gateway and table/probed confidence, but require a fresh
ProtoPeek scan before an imported hint can open a workbench. See
[the route and Nmap evidence guide](https://protopeek.shreyam1008.com.np/route-and-nmap-evidence/)
for exact limits and platform behavior.

### 4. Cap'n Proto experiment (exploring)

Build one local, schema-file-driven unary/capability call path behind an explicit experimental
flag. Show capability resolution and message segments in its own inspector. Measure binary and
bundle cost before deciding whether it belongs in the main binary or an optional companion.

### 5. Traceroute and LAN expansion (gated)

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

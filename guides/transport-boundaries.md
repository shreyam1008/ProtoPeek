# Transport boundaries

ProtoPeek is Protocol Peek: a local protocol console, not a general collaboration client. Its
durable product advantage is the short path from a real target to an explainable request, response,
and transport story.

## Product contract

- `pp host:port` and `protopeek host:port` keep their direct gRPC-compatible CLI meaning. A bare
  host or HTTP(S) authority opens the gRPC launcher with that one target prefilled and visibly
  probed. The browser request rail selects either the gRPC or HTTP adapter explicitly.
- Every session runs locally, without an account, remote sync, or external database.
- Each transport keeps its native concepts visible. The UI must not flatten gRPC trailers,
  Cap'n Proto capabilities, or HTTP status and headers into a misleading common response object.
- Reflection, proto files, and protosets remain first-class gRPC schema paths.
- Automatic discovery is loopback-only. Explicit private IPs require a per-scan opt-in. An explicit
  public IP or hostname is one user-entered target, never permission for port-range expansion. An
  explicit host without a port has only the visible `50051` plaintext and `443` verified-TLS
  candidates. CIDR expansion and ambient network crawling are outside this boundary.
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
        +-- Cap'n Proto adapter planned: schema file | capability bootstrap
        |
ordered transport events -> protocol-specific inspector
```

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

### 3. Cap'n Proto experiment (planned)

Build one local, schema-file-driven unary/capability call path behind an explicit experimental
flag. Show capability resolution and message segments in its own inspector. Measure binary and
bundle cost before deciding whether it belongs in the main binary or an optional companion.

### 4. Route trace and LAN discovery (planned)

Route trace requires a supported evidence source, explicit uncertainty, and partial-failure tests.
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

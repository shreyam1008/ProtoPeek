# Transport boundaries

ProtoPeek stays a local protocol console, not a general collaboration client. Its durable product
advantage is the short path from a real target to an explainable request, response, and transport
story.

## Product contract

- `pp [target]` and `protopeek [target]` continue to mean gRPC unless the user opts into another
  transport.
- Every session runs locally, without an account, remote sync, or external database.
- Each transport keeps its native concepts visible. The UI must not flatten gRPC trailers,
  Cap'n Proto capabilities, or HTTP status and headers into a misleading common response object.
- Reflection, proto files, and protosets remain first-class gRPC schema paths.
- New transports must not pull their runtime into the default gRPC binary or browser bundle when
  the user does not use them.

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
        +-- Cap'n Proto adapter schema file | capability bootstrap
        +-- HTTP adapter       URL | optional OpenAPI document
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

Keep the current slice as the reference adapter: safe loopback defaults, deterministic sessions,
reflection headers, proto/protoset compatibility, request/response split view, and visible headers,
trailers, deadlines, streaming mode, and status.

### 2. Extract an internal adapter boundary

Move the existing gRPC behavior behind the small session interface without changing CLI behavior
or JSON routes. Prove it with contract tests against reflection and protoset targets. Do not ship a
new transport in this slice.

### 3. Cap'n Proto experiment

Build one local, schema-file-driven unary/capability call path behind an explicit experimental
flag. Show capability resolution and message segments in its own inspector. Measure binary and
bundle cost before deciding whether it belongs in the main binary or an optional companion.

### 4. Bounded HTTP support

Support a single local request flow: method, URL, headers, body, response status, headers, timing,
and body. OpenAPI may supply operation schemas, but the first version excludes cloud sync,
workspaces shared through an account, cookie automation, script runners, mock servers, and an auth
plugin marketplace. Those are Postman-product features, not ProtoPeek's job.

## Release gates for any adapter

- Default gRPC startup time and bundle size do not materially regress.
- The adapter works without a database or network service other than the target being inspected.
- Cancellation and session teardown release connections and subprocesses.
- Sensitive metadata is not persisted unless the user explicitly saves it.
- The inspector names the real protocol concepts instead of using generic labels.


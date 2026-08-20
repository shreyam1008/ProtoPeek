# Learn gRPC

This page is the long-form technical companion to the ProtoPeek console. It explains the transport concepts that actually matter when you are debugging a gRPC service under pressure.

## 1. The contract comes first

gRPC starts with a `.proto` schema. Everything else — code generation, reflection, request tooling — flows from it.

```protobuf
syntax = "proto3";

package bookstore.v1;

service BookService {
  rpc GetBook    (GetBookRequest)    returns (Book);
  rpc ListBooks  (ListBooksRequest)  returns (stream Book);
  rpc UploadBooks(stream Book)       returns (UploadSummary);
  rpc ChatBooks  (stream ChatMsg)    returns (stream ChatMsg);
}

message GetBookRequest {
  string id = 1;
}

message Book {
  string   id     = 1;
  string   title  = 2;
  string   author = 3;
  int32    year   = 4;
  repeated string tags = 5;
}

message ListBooksRequest {
  int32  page_size  = 1;
  string page_token = 2;
}

message UploadSummary {
  int32 accepted = 1;
  int32 rejected = 2;
}

message ChatMsg {
  string sender  = 1;
  string content = 2;
}

enum BookStatus {
  BOOK_STATUS_UNSPECIFIED = 0;
  BOOK_STATUS_AVAILABLE   = 1;
  BOOK_STATUS_CHECKED_OUT = 2;
  BOOK_STATUS_RESERVED    = 3;
}
```

That schema matters operationally, not just for code generation. ProtoPeek relies on it to:

- Build the method rail with streaming badges
- Generate starter JSON payloads from reflected message types
- Render nested request schema details
- Decode protobuf `Any` values and response messages
- Power the proto structure explorer and exporter

If the server exposes reflection, ProtoPeek discovers services at runtime. If it does not, the same information can come from proto source files or protoset files.

## 2. Why Protocol Buffers change the ergonomics

Compared with JSON over REST, Protocol Buffers are compact, strongly typed, and schema-driven. Field tags and binary encoding reduce payload size and parsing overhead, but the tradeoff is visible:

- Humans **cannot** inspect the wire format directly the way they inspect JSON.
- Tooling **must** understand descriptors to stay usable.
- Field numbers, not field names, are the stable API surface.

That is one of the core reasons ProtoPeek exists: it translates binary descriptors back into a navigable, human-readable contract surface.

## 3. HTTP/2 is not a side detail

gRPC uses HTTP/2 as the transport foundation. A single gRPC call translates into HTTP/2 frames like this:

```
┌─────────────────────────────────────────────────────┐
│ Client                              Server          │
│                                                     │
│  HEADERS frame ──────────────────►                  │
│    :method POST                                     │
│    :path /bookstore.v1.BookService/GetBook           │
│    content-type application/grpc                    │
│    te trailers                                      │
│    grpc-timeout 15S                                 │
│    authorization Bearer <token>                     │
│                                                     │
│  DATA frame ─────────────────────►                  │
│    [5-byte header][protobuf payload]                │
│                                                     │
│                  ◄────────────────  HEADERS frame    │
│                                     :status 200     │
│                                     content-type    │
│                                     application/grpc│
│                                                     │
│                  ◄────────────────  DATA frame       │
│                                     [protobuf resp] │
│                                                     │
│                  ◄────────────────  HEADERS frame    │
│                                     (trailers)      │
│                                     grpc-status 0   │
│                                     grpc-message OK │
└─────────────────────────────────────────────────────┘
```

HTTP/2 provides:

- **Multiplexed streams** over a single TCP connection
- **Header compression** (HPACK) to reduce repeated metadata overhead
- **Bidirectional streaming** — both client and server can send frames independently
- **Response trailers** — metadata that arrives after the body, carrying the final gRPC status
- **Flow control** — per-stream and per-connection backpressure

This means gRPC clients and tools need to expose more than just a body and a status code. Headers, trailers, deadlines, stream shape, and connection behavior all matter during real debugging.

## 4. The four RPC shapes

Every gRPC method is one of four streaming shapes. Here is what each looks like on the wire:

### Unary (1 request → 1 response)

```
Client ──── Request ────► Server
Client ◄─── Response ──── Server
Client ◄─── Trailers ──── Server
```

The most familiar shape. One request message, one response message, then trailers with the gRPC status. Still backed by HTTP/2 metadata, deadlines, and trailers.

### Server streaming (1 request → N responses)

```
Client ──── Request ────────────► Server
Client ◄─── Response 1 ────────── Server
Client ◄─── Response 2 ────────── Server
Client ◄─── Response 3 ────────── Server
Client ◄─── Trailers ──────────── Server
```

The client sends one message, the server replies with a stream. Great for feeds, event replay, progressive reads, and paginated result sets where the server keeps sending frames until done.

### Client streaming (N requests → 1 response)

```
Client ──── Request 1 ──────────► Server
Client ──── Request 2 ──────────► Server
Client ──── Request 3 ──────────► Server
Client ──── END_STREAM ─────────► Server
Client ◄─── Response ──────────── Server
Client ◄─── Trailers ──────────── Server
```

The client sends a batch or live stream of messages before the server answers once. Common for file uploads, batch ingestion, and aggregation workflows.

### Bidirectional streaming (N requests ↔ N responses)

```
Client ──── Request 1 ──────────► Server
Client ◄─── Response 1 ────────── Server
Client ──── Request 2 ──────────► Server
Client ◄─── Response 2 ────────── Server
Client ──── Request 3 ──────────► Server
Client ◄─── Response 3 ────────── Server
Client ──── END_STREAM ─────────► Server
Client ◄─── Trailers ──────────── Server
```

Both sides speak freely over the same HTTP/2 stream. This is the shape that breaks most "one request, one response" tooling assumptions, and why transport-aware tooling matters.

> [!TIP]
> ProtoPeek shows streaming badges on every method in the sidebar rail, so you always know which shape you are working with before authoring a request.

## 5. Metadata and trailers are first-class

In gRPC, metadata is not an afterthought — it is part of the protocol definition.

### Request metadata (headers)

| Header | Purpose | Example |
|--------|---------|---------|
| `authorization` | Auth token | `Bearer eyJhbGci...` |
| `x-request-id` | Distributed tracing | `req-7f3a-b2c1` |
| `grpc-timeout` | Deadline propagation | `15S` |
| `x-tenant-id` | Multi-tenant routing | `tenant-acme-prod` |
| `x-feature-flag` | Feature gating | `new-scoring-v2` |

### Response headers

Arrive before data frames. Carry early server context like server version, rate limit state, or cache status.

### Response trailers

Arrive **after** all data frames. This is where the final gRPC status lives:

| Trailer | Purpose |
|---------|---------|
| `grpc-status` | Numeric status code (0 = OK, 14 = UNAVAILABLE, etc.) |
| `grpc-message` | Human-readable error description |
| `grpc-status-details-bin` | Binary-encoded error details (rich error model) |

> [!WARNING]
> Many generic API tools flatten or hide trailer metadata. ProtoPeek keeps it visible because real debugging often lives in the trailers, not the response body.

## 6. Reflection is what makes a console feel intelligent

Reflection allows a client to ask the server for its own schema at runtime:

```bash
# Discover all services
grpcurl -plaintext localhost:50051 list

# Result:
# bookstore.v1.BookService
# grpc.reflection.v1.ServerReflection
# grpc.reflection.v1alpha.ServerReflection

# Describe a service
grpcurl -plaintext localhost:50051 describe bookstore.v1.BookService

# Result:
# bookstore.v1.BookService is a service:
# service BookService {
#   rpc GetBook ( .bookstore.v1.GetBookRequest ) returns ( .bookstore.v1.Book );
#   rpc ListBooks ( .bookstore.v1.ListBooksRequest ) returns ( stream .bookstore.v1.Book );
#   ...
# }
```

Without reflection, a UI either needs explicit schema files from the user or it becomes blind. ProtoPeek keeps both paths:

- **Reflection** for the happy path where the server cooperates
- **Browser folder** for a user-selected, temporary `.proto` snapshot. Relative imports must remain
  inside the selected root (apart from built-in Google well-known protos); the bounded snapshot goes
  to the current ProtoPeek process, never to the gRPC target. Its in-memory upload buffers are cleared
  before the target is dialed or the session is published. Folder access and bytes are not saved, so
  reconnecting after reload requires a repick.
- **Host proto paths** for locked-down services when the ProtoPeek process can read the source tree
- **Host protoset paths** for pre-compiled descriptor sets from build pipelines

That browser/host distinction matters in Docker and remote-console setups. A folder chosen in the
browser is uploaded as a one-shot snapshot. A host path is interpreted on the machine or container
running ProtoPeek; it is never secretly remapped to the browser computer.

## 7. gRPC status codes

Every gRPC call ends with a status code. Knowing which code maps to which situation saves time:

| Code | Name | When it appears |
|------|------|-----------------|
| 0 | OK | Success |
| 1 | CANCELLED | Client cancelled the call |
| 2 | UNKNOWN | Server threw an exception without a status |
| 3 | INVALID_ARGUMENT | Client sent a bad request |
| 4 | DEADLINE_EXCEEDED | Timeout before server responded |
| 5 | NOT_FOUND | Requested entity does not exist |
| 6 | ALREADY_EXISTS | Create conflict |
| 7 | PERMISSION_DENIED | Auth succeeded but the caller lacks permission |
| 8 | RESOURCE_EXHAUSTED | Rate limit or quota hit |
| 9 | FAILED_PRECONDITION | System not in valid state for the request |
| 10 | ABORTED | Concurrency conflict (optimistic lock failure) |
| 11 | OUT_OF_RANGE | Operation outside valid range |
| 12 | UNIMPLEMENTED | Method exists in the proto but server has no handler |
| 13 | INTERNAL | Server-side bug |
| 14 | UNAVAILABLE | Server not ready — often transient, retry is appropriate |
| 15 | DATA_LOSS | Unrecoverable data issue |
| 16 | UNAUTHENTICATED | Missing or invalid auth credentials |

> [!NOTE]
> `UNAUTHENTICATED` (16) means "who are you?" — provide credentials. `PERMISSION_DENIED` (7) means "I know who you are, but you cannot do this." Confusing the two is a common source of debugging frustration.

## 8. Why gRPC-Web exists

Native gRPC assumes capabilities that browsers do not expose: raw HTTP/2 framing, response trailers, and bidirectional streaming. Browser environments need a bridge, which is why gRPC-Web exists.

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Browser (gRPC-Web)                                     │
│    │                                                    │
│    │  HTTP/1.1 or HTTP/2 (browser-compatible)           │
│    ▼                                                    │
│  Envoy / gRPC-Web proxy                                 │
│    │                                                    │
│    │  Native gRPC over HTTP/2                           │
│    ▼                                                    │
│  Backend gRPC server                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**What changes across the bridge:**

- Trailers get packed into the response body instead of arriving as HTTP trailers
- Only unary and server-streaming are supported — no client streaming or bidi
- The proxy translates between wire formats, which adds latency and a failure point
- CORS headers must be configured correctly on the proxy, not the backend

**Where a problem might actually live:**

| Symptom | Likely culprit |
|---------|---------------|
| CORS errors | Proxy config, not the gRPC service |
| Trailers missing | Proxy not forwarding, or client library not extracting |
| Client streaming fails | gRPC-Web does not support it — use a native client |
| Latency spike | Proxy translation overhead, not the backend |

ProtoPeek's site keeps this explicit so frontend teams are not left guessing about where in the chain their bug lives.

## 9. Benchmarking responsibly

There is no universal "gRPC is X times faster" number worth trusting outside a specific test setup. Performance depends on too many variables:

- **Payload size** — protobuf encoding is fast for small messages but the advantage narrows for large blobs
- **Compression** — gzip vs zstd vs none changes throughput curves significantly
- **Streaming vs unary** — stream setup cost amortizes differently under batch workloads
- **Proxy layers** — each hop adds latency variance
- **TLS** — handshake cost matters for short-lived connections
- **Retries and deadlines** — retry storms can mask the real throughput ceiling
- **Client and server implementation** — Go, Java, Rust, and C++ gRPC runtimes have different performance profiles

ProtoPeek's Unary Repeat can run 2–50 calls strictly one at a time, with an optional between-call
delay, a separate 0.1–30 second deadline for each call, cancellation, and a 60 second wall cap that
preserves partial results. It separates successful RPCs, non-OK gRPC statuses, local relay/transport
failures, and cancellation instead of collapsing unlike outcomes into one error count.

The console retains both ProtoPeek handler invoke duration and browser console round trip for each
completed attempt. Handler invoke includes JSON/protobuf conversion and callbacks, but excludes the
browser and HTTP relay. Headers, first message, and final status are cumulative lifecycle boundaries
observed by handler callbacks. Unary callbacks may cluster after transport completion; these values
are not packet-arrival, server-processing, or TTFB measurements. Console round trip includes the
browser/HTTP relay and response parsing.

Min, median, and max name their source; p95 appears only with at least 20 samples. When handler timing
is unavailable for a legacy response, the summary visibly says it uses the console round-trip
fallback. Repeat is not a load generator or a defensible service benchmark: browser scheduling, the
local relay, connection reuse, and the selected payload still shape what the console observes. Use
it to spot a local anomaly, then confirm performance with a controlled load tool.

Every Repeat attempt is a real RPC and may mutate service data. Protobuf descriptors do not reliably
guarantee idempotency, so inspect the method and payload before repeating it.

Repeat owns the request while active: assertions are disabled and an ordinary Invoke asks you to
cancel Repeat first. Navigating away from Checks cancels the run and preserves partial evidence, so
RPCs never continue hidden in another view. The result header keeps the run-start timestamp and its
frozen count, think time, and per-call deadline. If current controls differ, ProtoPeek labels the
evidence as a previous run; the payload and metadata were snapshotted at run start but are not
retained in results or exports.

> [!TIP]
> Start with Quick for a local sanity check. Use Tail sample when p95 is useful, and treat every
> result as debugging evidence rather than production capacity evidence.

## 10. Health Check and Watch are protocol calls, not magic

The standard `grpc.health.v1.Health` service has two deliberately different methods:

- `Check` returns one serving status for a service name. An empty name asks for overall server
  health. An unknown non-empty name ends with gRPC `NOT_FOUND`; there is no serving enum to invent.
- `Watch` is a server stream. It reports the current status immediately and then changes. An unknown
  service reports `SERVICE_UNKNOWN` and remains open. A server that does not implement Watch returns
  `UNIMPLEMENTED`.

ProtoPeek exposes both only as user-started diagnostics. Check uses a bounded deadline. Watch opens
one real stream for a bounded duration, does not poll or retry, keeps headers, each observed status,
trailers, cancellation, and the final gRPC status separate, and reports when older retained
transitions were dropped. Request metadata is sent live but never copied into Health evidence or
browser storage.

A healthy response is evidence from one selected backend connection at one moment. It does not prove
that dependencies are healthy, that every replica is reachable, or that a load balancer would choose
the same backend next time. ProtoPeek's offsets mark when its handler/relay observed each event; they
are not packet timestamps or the server's emission clock. gRPC Health is also distinct from HTTP/2
keepalive: keepalive tests whether a connection remains usable, while Health reports application
status chosen by the service.

## 11. Why debugging gets hard fast

The painful gRPC bugs are rarely serialization bugs. They are transport and configuration issues:

### Debugging checklist

| Symptom | What to check | ProtoPeek tool |
|---------|--------------|----------------|
| No RPCs discovered | Server reflection disabled, or proto files not loaded | Proto structure explorer |
| `UNAUTHENTICATED` on every call | Missing or malformed auth header | Metadata editor |
| `UNAVAILABLE` after deployment | TLS cert mismatch, wrong port, DNS resolution | Target registry settings |
| `DEADLINE_EXCEEDED` during repetition | Server too slow, or per-call deadline set too aggressively | Unary Repeat |
| Works locally, fails in staging | Authority override needed, or different TLS config | Target registry per-environment |
| Browser client behaves differently | gRPC-Web proxy issue, not backend | Transport lens |
| Streaming closes unexpectedly | Keepalive timeout, proxy idle timeout | Response lab trailers |
| Readiness differs by backend | One replica, dependency, or load-balancer path is unhealthy | Explicit Health Check/Watch, then backend-aware infrastructure evidence |
| One sequential call is much slower | Backend variance, proxy delay, or connection setup | Unary Repeat timing and attempt evidence |

That is why ProtoPeek combines request authoring, response inspection, metadata visibility, bounded browser repetition, and transport education in one console — each of those surfaces helps diagnose a different class of gRPC issue.

## 12. Further reading

**Official gRPC documentation:**

- [gRPC core concepts](https://grpc.io/docs/what-is-grpc/core-concepts/) — services, messages, deadlines, metadata
- [gRPC health checking](https://grpc.io/docs/guides/health-checking/) — canonical Check/Watch behavior and client configuration
- [Health protocol definition](https://github.com/grpc/grpc-proto/blob/master/grpc/health/v1/health.proto) — the canonical service and serving-status enum
- [gRPC guides](https://grpc.io/docs/guides/) — auth, error handling, performance, benchmarking, keepalive
- [gRPC debugging guide](https://grpc.io/docs/guides/debugging/) — admin services, channelz, `grpcdebug`
- [gRPC status codes](https://grpc.io/docs/guides/status-codes/) — canonical error code semantics

**gRPC-Web and browser integration:**

- [gRPC-Web basics](https://grpc.io/docs/platforms/web/basics/) — browser transport constraints
- [Envoy gRPC bridging](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_protocols/grpc.html) — proxy translation layer

**Protocol Buffers:**

- [Protocol Buffers language guide (proto3)](https://protobuf.dev/programming-guides/proto3/) — syntax, field types, defaults
- [Protocol Buffers encoding](https://protobuf.dev/programming-guides/encoding/) — wire format, varints, field tags

**ProtoPeek:**

- [ProtoPeek website](https://protopeek.shreyam1008.com.np/) — product site and visual tutorial
- [ProtoPeek GitHub repository](https://github.com/shreyam1008/ProtoPeek) — source, issues, releases
- [ProtoPeek feature roadmap](https://protopeek.shreyam1008.com.np/feature-roadmap/) — shipped capabilities and next wave

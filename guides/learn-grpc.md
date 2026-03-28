# Learn gRPC

This page is the long-form technical companion to the public site.

## 1. The contract comes first

gRPC starts with a `.proto` schema. The schema defines:

- Services
- Methods
- Request and response message types
- Enums
- Field numbers and optional/repeated structure

That schema matters operationally, not just for code generation. ProtoPeek relies on it to:

- Build the method rail
- Generate starter payloads
- Render request schema details
- Decode protobuf `Any` values and response messages

If the server exposes reflection, the tool can discover that schema at runtime. If it does not, the same information can come from proto source files or protoset files.

## 2. Why Protocol Buffers change the ergonomics

Compared with JSON over REST, Protocol Buffers are compact, strongly typed, and schema-driven. Field tags and binary encoding reduce payload size and parsing overhead, but the tradeoff is obvious:

- Humans cannot inspect the wire format directly the way they can inspect JSON.
- Tooling must understand descriptors to stay usable.

That is one of the core reasons ProtoPeek exists.

## 3. HTTP/2 is not a side detail

gRPC uses HTTP/2 as the transport foundation. That gives it:

- Multiplexed streams over a single connection
- Header compression
- Bidirectional streaming
- Response trailers
- Better fit for request/response plus stream semantics

This also means gRPC clients and tools need to expose more than just a body and a status code. Headers, trailers, deadlines, stream shape, and connection behavior matter.

## 4. The four RPC shapes

Unary:
- One request, one response.

Server streaming:
- One request, many responses.

Client streaming:
- Many requests, one response.

Bidirectional streaming:
- Many requests, many responses.

ProtoPeek currently treats the request side as JSON-first and handles streaming workflows as message batches. That is a pragmatic first step, but live interactive bidi tooling remains a future expansion area.

## 5. Metadata and trailers are first-class

In gRPC, metadata is not an afterthought.

Request headers:
- Auth
- Tenant routing
- Tracing
- Feature flags

Response headers:
- Early server context

Response trailers:
- Final status
- Additional server-supplied metadata

Many generic tools flatten or hide this. ProtoPeek keeps it visible because real debugging often lives there.

## 6. Reflection is what makes a console feel intelligent

Reflection allows a client to ask the server for:

- Service names
- Methods
- Message descriptors
- Enum descriptors

Without reflection, a UI either needs explicit schema files from the user or it becomes blind. ProtoPeek keeps both paths:

- Reflection for the happy path
- Proto source / protoset loading for locked-down services

## 7. Why gRPC-Web exists

Native gRPC assumes capabilities that browsers do not expose the same way backend runtimes do. Browser environments need a bridge layer, which is why gRPC-Web exists.

Typical browser path:

1. Browser speaks gRPC-Web-compatible semantics.
2. A proxy such as Envoy receives the request.
3. The proxy translates it into backend-native gRPC.
4. Response headers and trailers are adapted back to browser constraints.

That architecture changes debugging and performance conversations. A problem seen in the browser may live:

- In the browser client
- In the gRPC-Web bridge
- In Envoy config
- In the backend gRPC server

ProtoPeek’s site keeps this explicit so frontend teams are not left guessing.

## 8. Benchmarking responsibly

There is no universal “gRPC is X times faster” number worth trusting outside a specific test setup. Performance changes with:

- Payload size
- Compression
- Streaming vs unary traffic
- Proxy layers
- TLS
- Retries
- Deadlines
- Client and server implementation

The official gRPC docs maintain dedicated performance and benchmarking guidance for exactly this reason. ProtoPeek adds value by giving you a fast way to measure your own service locally with the simulation studio instead of importing generic benchmark claims into a production discussion.

## 9. Why debugging gets hard fast

The painful gRPC bugs are often not serialization bugs. They are:

- Missing reflection
- Incorrect metadata
- TLS mismatch
- Deadline exceeded
- Wrong authority / host routing
- Proxy translation issues
- Streaming assumptions
- Service config or xDS surprises

That is why ProtoPeek combines:

- Request authoring
- Response inspection
- Metadata visibility
- Lightweight load probing
- Links to deeper runtime diagnostics

## 10. Further reading

- gRPC guides: https://grpc.io/docs/guides/
- gRPC-Web basics: https://grpc.io/docs/platforms/web/basics/
- Envoy gRPC overview: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_protocols/grpc.html
- Debugging guide: https://grpc.io/docs/guides/debugging/
- ProtoPeek site: https://shreyam1008.github.io/ProtoPeek/

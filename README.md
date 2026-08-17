# ProtoPeek

ProtoPeek (Protocol Peek) is a local-first protocol workbench for seeing the request-to-server path clearly. gRPC is the reference adapter today; Cap'n Proto and REST/HTTP are planned as protocol-native adapters, not flattened generic-client modes.

Built by [Shreyam Adhikari](https://shreyam1008.com.np/) · [Website](https://protopeek.shreyam1008.com.np/) · [Docs](https://protopeek.shreyam1008.com.np/docs/) · [Learn gRPC](https://protopeek.shreyam1008.com.np/learn-grpc/)

![ProtoPeek local gRPC console showing a successful request and response evidence](https://protopeek.shreyam1008.com.np/assets/protopeek-console-response.jpg)

The screenshot is a real local capture against the repository's reflection-enabled KitchenSink test server. The console shows the pieces that usually disappear in a generic API client: method shape, headers, response timeline, status, and latency.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh
```

Or with `wget`:

```sh
wget -qO- https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh
```

Go fallback:

```sh
go install github.com/shreyam1008/ProtoPeek/cmd/protopeek@latest
go install github.com/shreyam1008/ProtoPeek/cmd/pp@latest
```

## Usage

```sh
pp                                # blank launcher — add targets from the browser UI
pp -plaintext localhost:50051     # direct single-target mode
```

In launcher mode each saved target keeps its own plaintext/TLS settings, authority override, schema source (reflection, proto files, or protoset), and cert paths.
ProtoPeek automatically checks a small list of common loopback ports. Private-network IPs are only probed when you explicitly opt in; public hosts and arbitrary hostnames are never accepted by the discovery scan.

## Capabilities

| Surface | What it does |
|---|---|
| **Method rail** | Search and filter reflected services/methods with clear unary and streaming modes |
| **Target registry** | Save and switch gRPC endpoints without restarting |
| **Local discovery** | Find reflection-enabled loopback targets with an explicit private-network boundary |
| **Payload generator** | Scaffold JSON from reflected protobuf schemas |
| **Proto explorer** | Browse files, messages, enums, deps; export `.proto` or catalog JSON |
| **Metadata and auth** | Editable metadata, Bearer helper, deadline, and reusable environment profiles |
| **Saved requests** | Keep request recipes locally, replay them, and import/export workspace JSON |
| **Response timeline** | Ordered messages with arrival timing, filtering, copy/export, headers, trailers, and final status |
| **Fast controls** | Cancel active calls, `Cmd/Ctrl+Enter` to invoke, `/` to search, and `Cmd/Ctrl+K` for commands |
| **Assertions** | Validate status, latency, metadata, and payload text locally |
| **Simulation** | Concurrency sweeps with p50/p95/p99 latency and throughput |
| **Transport lens** | gRPC-Web, Envoy bridging, and transport context alongside the console |

## Protocol direction

ProtoPeek is intentionally broader than a gRPC-only brand, but intentionally narrower than a
generic cloud API platform. The shared shell owns local target selection, request editing, response
evidence, history, and session lifecycle. Each adapter owns discovery, schema, invocation,
cancellation, and its native inspector.

| Adapter | Status | First useful slice |
|---|---|---|
| gRPC | Shipped | Reflection, `.proto`/protoset sources, unary and streaming calls, metadata, headers, trailers, status, timing |
| Cap'n Proto | Planned | Local schema/capability bootstrap, one unary path, segment and capability inspector |
| REST / HTTP | Planned | Method, URL, headers, body, status, timing, optional OpenAPI operation discovery |
| SMTP, FTP, and others | Later | Only after protocol-specific security, evidence, and UX are designed |

See the detailed [protocol roadmap](guides/feature-roadmap.md) and [transport boundaries](guides/transport-boundaries.md).

## Development

Requires [Bun](https://bun.sh/) ≥ 1.3.10 and [Go](https://go.dev/).

```sh
bun install --frozen-lockfile     # install frontend deps
bun run test                      # tsgo typecheck + Biome lint + Vitest
bun run build                     # build console + GitHub Pages site
go test ./...                     # Go test suite
make install                      # install protopeek and pp locally
```

## Docker

```sh
make docker
docker run --rm -p 127.0.0.1:8080:8080 shreyam1008/protopeek:dev
```

Scratch-compatible image: static Go binary, embedded web app, CA certs, non-root user. The
image listens on its container interface, so keep the host-side port mapped to loopback as shown.

## Project origin

ProtoPeek originated from a fork of `fullstorydev/grpcui`. The product, docs, branding, and release flow are now ProtoPeek's own.

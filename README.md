# ProtoPeek

Performance-first gRPC workbench with reflection-driven exploration, proto structure visualization, metadata inspection, and lightweight load simulation.

Built by [Shreyam Adhikari](https://shreyam1008.com.np/) · [Website](https://shreyam1008.github.io/ProtoPeek/) · [Docs](https://shreyam1008.github.io/ProtoPeek/docs/) · [Learn gRPC](https://shreyam1008.github.io/ProtoPeek/learn-grpc/)

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

## Capabilities

| Surface | What it does |
|---|---|
| **Method rail** | Search services and methods with streaming badges |
| **Target registry** | Save and switch gRPC endpoints without restarting |
| **Payload generator** | Scaffold JSON from reflected protobuf schemas |
| **Proto explorer** | Browse files, messages, enums, deps; export `.proto` or catalog JSON |
| **Metadata presets** | Editable auth headers and reusable environment profiles |
| **Collections** | Save request recipes with notes; import/export as JSON |
| **Response lab** | Headers, trailers, payloads, status, and latency in one surface |
| **Assertions** | Validate status, latency, metadata, and payload text locally |
| **Simulation** | Concurrency sweeps with p50/p95/p99 latency and throughput |
| **Transport lens** | gRPC-Web, Envoy bridging, and transport context alongside the console |

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
docker run --rm -p 8080:8080 shreyam1008/protopeek:dev
```

Scratch-compatible image: static Go binary, embedded web app, CA certs, non-root user.

## Project origin

ProtoPeek originated from a fork of `fullstorydev/grpcui`. The product, docs, branding, and release flow are now ProtoPeek's own.

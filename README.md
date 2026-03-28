# ProtoPeek

ProtoPeek is a performance-first gRPC workbench for reflection-driven exploration, JSON request authoring, metadata inspection, proto structure visualization, and lightweight load simulation.

Built by [Shreyam Adhikari](https://shreyam1008.com.np/).

## Why ProtoPeek

Most API tools flatten gRPC into “pick a method, send JSON, read a response”. That misses the parts that usually matter during real debugging:

- reflection and descriptor visibility
- request metadata and response trailers
- unary versus streaming mode
- proto-aware request generation
- browser-facing gRPC-Web constraints
- quick throughput and latency checks against the real service

ProtoPeek keeps those concerns visible without turning into a generic REST client.

## Install

Fast install, no Go required:

```sh
curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh
```

If your system does not have `curl`:

```sh
wget -qO- https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh
```

Go-based install is still available:

```sh
go install github.com/shreyam1008/ProtoPeek/cmd/protopeek@latest
```

Short alias:

```sh
go install github.com/shreyam1008/ProtoPeek/cmd/pp@latest
```

## Run

Launch the blank workspace first:

```sh
protopeek
```

Short alias:

```sh
pp
```

Direct single-target mode:

```sh
protopeek -plaintext localhost:50051
```

Or:

```sh
pp -plaintext localhost:50051
```

When no target is provided, ProtoPeek opens in launcher mode so you can define one or more saved gRPC targets from the browser UI. Each target can keep its own:

- plaintext or TLS settings
- authority override
- reflection mode
- proto file inputs
- protoset inputs

## Shipped capabilities

1. Schema-first command rail for services and methods.
2. Blank-launch workspace mode with a saved multi-target registry.
3. Starter JSON payload generation from reflected request schemas.
4. Proto structure explorer and exporter for files, messages, enums, and raw `.proto` text.
5. Editable metadata plus reusable environment presets.
6. Local collections, history, and workspace import/export.
7. Response lab for headers, trailers, payloads, status, and latency.
8. Local assertion rules for validation without a hosted scripting sandbox.
9. Lightweight simulation studio with concurrency, throughput, and p50/p95/p99 latency.
10. Embedded transport guidance for gRPC, gRPC-Web, Envoy, and debugging context.

## Website and docs

- Site: [https://shreyam1008.github.io/ProtoPeek/](https://shreyam1008.github.io/ProtoPeek/)
- Learn gRPC: [guides/learn-grpc.md](guides/learn-grpc.md)
- Feature roadmap: [guides/feature-roadmap.md](guides/feature-roadmap.md)
- VS Code / Open VSX spec: [guides/vscode-extension-spec.md](guides/vscode-extension-spec.md)
- Launch post draft: [guides/launch-post.md](guides/launch-post.md)
- Contributor rules: [AGENTS.md](AGENTS.md)

## Development

Install frontend tooling:

```sh
bun install --frozen-lockfile
```

Run the frontend gate:

```sh
bun run test
```

Build the embedded console and the public GitHub Pages site:

```sh
bun run build
```

Run the Go test suite:

```sh
go test ./...
```

Install the local binaries:

```sh
make install
```

## Docker

The container build stays minimal and scratch-compatible:

- Bun builds the embedded console and public site.
- Go builds the static `protopeek` binary.
- The runtime image contains only the binary, CA certs, and a non-root user.

Build:

```sh
make docker
```

Run:

```sh
docker run --rm -p 8080:8080 shreyam1008/protopeek:dev
```

## CI and release flow

- `bun run test` runs `tsgo`, Biome, and Vitest.
- `bun run build` produces the embedded app and `docs/` GitHub Pages output.
- `go test ./...` validates the Go runtime and CLI.
- `.husky/pre-commit` runs the combined frontend and Go checks locally.
- GitHub Actions in `.github/workflows/ci.yml` run the same validation on pushes and pull requests.

## Naming and compatibility

- `protopeek` is the primary binary name.
- `pp` is the short alias.
- The legacy `cmd/grpcui` entrypoint remains only for compatibility during transition.
- New docs, branding, releases, and install paths should center `protopeek`.

## Project origin

ProtoPeek was created on GitHub on March 26, 2026 as a fork of `fullstorydev/grpcui`.

That note stays here only as historical context. The product, docs, branding, release flow, and installer now center ProtoPeek itself.

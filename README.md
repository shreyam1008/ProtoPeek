# ProtoPeek

ProtoPeek (Protocol Peek) is a local-first protocol workbench for seeing the request-to-server path clearly. The shipped workbench has protocol-native gRPC and HTTP surfaces: gRPC keeps schemas, stream modes, metadata, headers, trailers, and status visible, while HTTP keeps methods, URLs, redirects, response bodies, and timing visible.

Built by [Shreyam Adhikari](https://shreyam1008.com.np/) · [Website](https://protopeek.shreyam1008.com.np/) · [Docs](https://protopeek.shreyam1008.com.np/docs/) · [Learn gRPC](https://protopeek.shreyam1008.com.np/learn-grpc/)

> **Release status:** v0.2.0 is a draft candidate, not a public release. Until
> that draft is tested and published, the stable installer and `@latest` remain
> on v0.1.6. The current source tree and edge channel contain newer work.

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

Windows PowerShell, per user:

```powershell
irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex
```

The installers verify the selected release archive against its published
SHA-256 entry before extracting. See the [install guide](guides/INSTALLING.md)
for pinned versions, upgrades, rollback, PATH behavior, and uninstall.

Go fallback:

```sh
go install github.com/shreyam1008/ProtoPeek/cmd/protopeek@latest
go install github.com/shreyam1008/ProtoPeek/cmd/pp@latest
```

## Usage

```sh
pp                                # launcher + bounded automatic loopback discovery
pp localhost                      # prefill + probe only localhost:50051 and localhost:443
pp https://api.example.test       # prefill + probe the stated/default verified-TLS port
pp -plaintext localhost:50051     # exact direct single-target mode
```

In launcher mode each saved gRPC target keeps its own plaintext/TLS settings, authority override, schema source (reflection, proto files, or protoset), and cert paths. Open the HTTP surface from the request rail to send an explicit `http://` or `https://` request through the same local server.

Ambient discovery checks only a fixed list of loopback candidates. A literal private IP requires the per-scan private-network opt-in. A public address or hostname is accepted only as the single explicit target: ProtoPeek does not expand it into an arbitrary port scan. Passing that explicit target to the CLI opens the same visible launcher probe. A host without a port tries only `50051` with plaintext and `443` with verified TLS; an explicit HTTP(S) authority uses its stated or default port.

## Capabilities

| Surface | What it does |
|---|---|
| **Method rail** | Search and filter reflected services/methods with clear unary and streaming modes |
| **Target registry** | Save and switch gRPC endpoints without restarting |
| **Local discovery** | Distinguish reflection, gRPC-without-reflection, and non-gRPC results with bounded loopback and explicit-target policies |
| **Payload generator** | Scaffold JSON from reflected protobuf schemas |
| **Proto explorer** | Browse files, messages, enums, deps; export `.proto` or catalog JSON |
| **Metadata and auth** | Editable live metadata, Bearer helper, and deadlines; automatic history and default exports redact credentials and binary metadata |
| **Saved requests** | Keep secret-sanitized request recipes locally, replay them, and import/export workspace JSON |
| **Response timeline** | Ordered messages with arrival timing, filtering, copy/export, headers, trailers, and final status |
| **Fast controls** | Cancel active calls, `Cmd/Ctrl+Enter` to invoke, `/` to search, and `Cmd/Ctrl+K` for commands |
| **Assertions** | Validate status, latency, metadata, and payload text locally |
| **Transport lens** | gRPC-Web, Envoy bridging, and transport context alongside the console |
| **HTTP workbench** | Send bounded HTTP(S) requests with method, URL, params, headers, auth, body, timeout, cancellation, redirect policy, and native response evidence |

## Protocol direction

ProtoPeek is intentionally broader than a gRPC-only brand, but intentionally narrower than a
generic cloud API platform. The shared shell owns local target selection, request editing, response
evidence, history, and session lifecycle. Each adapter owns discovery, schema, invocation,
cancellation, and its native inspector.

| Adapter | Status | First useful slice |
|---|---|---|
| gRPC | Shipped | Reflection, `.proto`/protoset sources, unary and streaming calls, metadata, headers, trailers, status, timing |
| HTTP / REST | Shipped | Standard-library HTTP(S), method, URL, headers, body, timeout, redirect choice, cancellation, status, protocol, timing, and bounded text/base64 response bodies |
| Cap'n Proto | Planned, gated | Local schema/capability bootstrap, one unary path, segment and capability inspector; requires fixture, dependency-size, and native-inspector gates |
| Route trace | Planned, gated | Evidence tied to a real request path; requires a supported data source and truthful failure model before UI exposure |
| LAN discovery | Planned, gated | Explicit, previewable private ranges only; requires opt-in scope, strict candidate budgets, cancellation, and no ambient or public crawling |
| SMTP, FTP, and others | Later | Only after protocol-specific security, evidence, and UX are designed |

Cap'n Proto, route trace, and LAN discovery are roadmap items only. They do not appear as clickable request surfaces in the current console.

See the detailed [protocol roadmap](guides/feature-roadmap.md), [transport boundaries](guides/transport-boundaries.md), and [go-to-market runbook](guides/go-to-market.md).

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
docker run --rm -p 127.0.0.1:8080:8080 protopeek:dev
```

Scratch-compatible image: static Go binary, embedded web app, CA certs, non-root user. The
image listens on its container interface, so keep the host-side port mapped to loopback as shown.

## Project origin

ProtoPeek originated from a fork of `fullstorydev/grpcui`. The product, docs, branding, and release flow are now ProtoPeek's own.

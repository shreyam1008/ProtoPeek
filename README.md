# ProtoPeek

ProtoPeek (Protocol Peek) is a local-first protocol workbench for seeing the request-to-server path clearly. Its protocol-native gRPC and HTTP surfaces keep transport details visible, and its evidence tools add bounded discovery, read-only kernel-selected next-hop lookup, and offline Nmap XML import without background polling or a database.

Built by [Shreyam Adhikari](https://shreyam1008.com.np/) · [Website](https://protopeek.shreyam1008.com.np/) · [Docs](https://protopeek.shreyam1008.com.np/docs/) · [Learn gRPC](https://protopeek.shreyam1008.com.np/learn-grpc/)

> **Latest stable:** v0.2.0. The verified shell and PowerShell installers, and
> `@latest`, resolve this release. Edge remains a separate opt-in channel.

> **v0.3 source build:** the dashboard, themes, expanded discovery, next-hop evidence, and Nmap
> XML import documented below are available in this checkout and remain release-candidate features
> until the v0.3 tag, archives, installers, and public site are published together.

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
pp                                # Protocol Peek dashboard
pp localhost                      # dashboard + bounded probe of localhost:50051 and :443
pp https://api.example.test       # dashboard + probe of the stated/default verified-TLS port
pp -plaintext localhost:50051     # exact direct mode at the gRPC workbench
```

With no target, the dashboard opens at `/`. The protocol rail keeps gRPC (`/grpc`), HTTP (`/http`), next-hop evidence (`/routes`), and the in-app roadmap (`/roadmap`) one command away. Each saved gRPC target keeps its own plaintext/TLS settings, authority override, schema source (reflection, proto files, or protoset), and cert paths. Light is the first-run theme; dark mode and recent protocol discoveries are stored only in the local browser profile.

Ambient discovery checks only a fixed list of loopback candidates. A private or link-local IP requires the per-scan private-network opt-in. A public address or hostname is accepted only as the single explicit target: ProtoPeek does not expand it into an arbitrary port scan. Hostnames are resolved once, every returned address is classified against that opt-in, and probes dial a validated numeric address so DNS cannot silently change the destination between policy and connection. Passing that explicit target to the CLI opens the same visible scan dialog. A host without a port tries only `50051` with plaintext and `443` with verified TLS; an explicit HTTP(S) authority uses its stated or default port. Each candidate has fixed time limits and can report verified gRPC, a safe non-following HTTP `HEAD` response, or open TCP evidence. Scans are cancellable, never follow redirects, and never send a state-changing request.

Next-hop lookup asks the local kernel for one currently selected route per resolved address from the ProtoPeek process. It resolves at most eight addresses, performs at most four route lookups concurrently, and requests a two-second aggregate deadline. It reports source address, interface, reported gateway or on-link status, prefix, and metric/table when the platform provides them. It is not traceroute: it performs no hop probes, mutates no routes, and requires no elevation. Entering a hostname can still perform normal DNS resolution. VPN, proxy, policy-routing, ECMP, and later route changes remain explicit sources of uncertainty.

The Scan dialog can also import up to 8 MiB of XML previously written by `nmap -oX`. Nmap is not required to import an existing file. To create new XML, users obtain and run Nmap separately; ProtoPeek does not bundle, install, locate, or execute Nmap/Npcap and accepts no Nmap arguments. Imported service names and table/probed confidence are untrusted hints; an open TCP endpoint at a validated literal IP must run through **Verify with ProtoPeek** and the existing bounded scanner before gRPC or HTTP can open. Uploaded XML and imported inventory are not persisted.

## Capabilities

| Surface | What it does |
|---|---|
| **Method rail** | Search and filter reflected services/methods with clear unary and streaming modes |
| **Target registry** | Save and switch gRPC endpoints without restarting |
| **Local discovery** | Distinguish reflection, gRPC-without-reflection, safe HTTP response evidence, and open TCP with bounded loopback and explicit-target policies |
| **Next-hop evidence** | Read one kernel-selected route per resolved address from the ProtoPeek process without hop probes, polling, privilege, or route mutation |
| **Offline Nmap import** | Parse bounded `nmap -oX` host/port hints and require ProtoPeek verification before opening a workbench |
| **Payload generator** | Scaffold JSON from reflected protobuf schemas |
| **Proto explorer** | Browse files, messages, enums, deps; export `.proto` or catalog JSON |
| **Metadata and auth** | Editable live metadata, Bearer helper, and deadlines; automatic history and default exports redact credentials and binary metadata |
| **Saved gRPC requests** | Keep secret-sanitized gRPC recipes locally, replay them, and import/export workspace JSON |
| **Response timeline** | Ordered messages with arrival timing, filtering, copy/export, headers, trailers, and final status |
| **Fast controls** | Cancel active calls, `Cmd/Ctrl+Enter` to invoke, `/` to search, and `Cmd/Ctrl+K` for commands |
| **Assertions** | Validate status, latency, metadata, and payload text locally |
| **Transport lens** | gRPC-Web, Envoy bridging, and transport context alongside the console |
| **HTTP workbench** | Send bounded HTTP(S) requests with method, URL, params, headers, auth, body, timeout, cancellation, redirect policy, and native response evidence |

Workspace export writes the explicit `protopeek-workspace` version 1 format. The default export
contains saved requests, environments, assertions, and inactive target profiles, but excludes
automatic RPC history. Saved request bodies are deliberate workspace data, so review them before
sharing a file. Import rejects files larger than 4 MiB before reading them, validates bounded
collections and strings, contains errors inside the running console, and never connects an imported
target. Imported proto, protoset, CA, client-certificate, and key paths are paths on the machine
running ProtoPeek; explicitly connecting that profile authorizes the ProtoPeek process to read those
local paths.

Every deliberate workspace write is validated before it reaches browser storage. Full saved-request,
environment, and target lists refuse the new item instead of evicting an older one. If an existing
section is malformed or over its bound, ProtoPeek keeps the exact readable original untouched,
recovers only valid bounded records for the live session, and offers separate download and explicit
adoption actions. A normal export remains paused until that recovery is resolved.

Saved and historical gRPC requests are scoped to the target/profile that created them. Legacy
unscoped records remain usable when their method exists, then bind to the current target on first
replay. Redacted metadata is restored blank with a re-entry warning, and blank or `[redacted]`
sensitive metadata is never sent. Automatic HTTP history retains the URL, method, a small allowlist
of non-credential header values, and response summary—not request bodies. It strips URL user info,
redacts credential-like query values and every header outside that allowlist, then resets all
non-persisted request/response settings on replay. Opening a newly discovered HTTP origin also
cancels and invalidates prior work before starting from a clean `GET` request.

## Protocol direction

ProtoPeek is intentionally broader than a gRPC-only brand, but intentionally narrower than a
generic cloud API platform. The shared shell owns local target selection, request editing, response
evidence, history, and session lifecycle. Each adapter owns discovery, schema, invocation,
cancellation, and its native inspector.

| Adapter | Status | First useful slice |
|---|---|---|
| gRPC | Stable · v0.2 | Reflection, `.proto`/protoset sources, unary and streaming calls, metadata, headers, trailers, status, timing |
| HTTP / REST | Stable · v0.2 | Standard-library HTTP(S), method, URL, headers, body, timeout, redirect choice, cancellation, status, protocol, timing, and bounded text/base64 response bodies |
| Next-hop route evidence | Available in this v0.3 build | Read-only Linux netlink, Darwin routing socket, or Windows `GetBestRoute2`; one process-perspective route per resolved address, no hop probes |
| Nmap XML evidence | Available in this v0.3 build · optional input | Streaming offline import only; Nmap is not required for import and is never executed by ProtoPeek |
| Cap'n Proto | Exploring | Local schema/capability bootstrap only after fixture, dependency-size, and native-inspector gates |
| Traceroute / hop probes | Gated | Requires explicit consent, strict probe budgets, truthful partial failures, and reliable unprivileged backends |
| Bundled Nmap execution | Not planned for the core binary | Existing XML import stays dependency-free; any future opt-in companion needs explicit executable choice, previewed scope, hard budgets, and an auditable command |
| LAN discovery | Planned, gated | Explicit, previewable private ranges only; requires opt-in scope, strict candidate budgets, cancellation, and no ambient or public crawling |
| SMTP, FTP, and others | Later | Only after protocol-specific security, evidence, and UX are designed |

Bundled Nmap execution is not planned for the core binary. Traceroute/hop probes, LAN range expansion, and live capture remain gated. The current route surface is kernel evidence only; the current Nmap surface is offline XML import only.

See the detailed [route and Nmap evidence boundary](guides/route-and-nmap-evidence.md), [protocol roadmap](guides/feature-roadmap.md), [transport boundaries](guides/transport-boundaries.md), and [go-to-market runbook](guides/go-to-market.md).

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

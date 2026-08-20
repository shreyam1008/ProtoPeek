# ProtoPeek

ProtoPeek (Protocol Peek) is a local-first protocol workbench for seeing the request-to-server path clearly. Its protocol-native gRPC and HTTP surfaces keep transport details visible, and its evidence tools add bounded discovery, read-only kernel-selected next-hop lookup, and offline Nmap XML import without background polling or a database.

Built by [Shreyam Adhikari](https://shreyam1008.com.np/) · [Website](https://protopeek.shreyam1008.com.np/) · [Docs](https://protopeek.shreyam1008.com.np/docs/) · [Learn gRPC](https://protopeek.shreyam1008.com.np/learn-grpc/)

> **Latest stable:** v0.3.1. The verified shell and PowerShell installers, and
> `@latest`, resolve this release. Edge remains a separate opt-in channel.

![ProtoPeek v0.3 Protocol Peek dashboard with gRPC, HTTP, scan, next-hop, and roadmap surfaces](https://protopeek.shreyam1008.com.np/assets/protopeek-dashboard.png)

The screenshot is a real local Chrome capture of the embedded v0.3 dashboard. It is the default when
`pp` starts without a target and keeps every shipped protocol surface one action away.

## Install

Homebrew on macOS or Linux:

```sh
brew install shreyam1008/tap/protopeek
```

Scoop on Windows:

```powershell
scoop bucket add shreyam https://github.com/shreyam1008/scoop-bucket
scoop install shreyam/protopeek
```

Or use the verified release resolver on Unix:

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

The verified release installers and owned Homebrew and Scoop channels resolve
v0.3.1 from immutable archives pinned to their published SHA-256 entries. Each
package update passed its independent default-branch install checks. See the
[install guide](guides/INSTALLING.md) for package updates, pinned versions,
rollback, PATH behavior, and uninstall.

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

With no target, the dashboard opens at `/`. The protocol rail keeps gRPC (`/grpc`), HTTP (`/http`), next-hop evidence (`/routes`), and the in-app roadmap (`/roadmap`) one command away. Each saved gRPC target keeps its own plaintext/TLS settings, authority override, schema source (reflection, a browser-folder snapshot, host proto paths, or host protoset paths), and cert paths. Light is the first-run theme; dark mode and recent protocol discoveries are stored only in the local browser profile.

For a server without reflection, choose **Browser folder** and then **Choose folder**. ProtoPeek
preserves relative imports and uploads only lowercase `.proto` files when Connect is pressed. The
snapshot is bounded to 512 files, 4 MiB per file, and 16 MiB total. It goes to the machine or
container running this ProtoPeek instance, never to the gRPC target. ProtoPeek compiles the bounded
bytes in memory and clears the upload buffers before dialing or publishing the session. Every import
must resolve inside the selected root (apart from built-in Google well-known protos). Folder handles,
file bytes, root names, and temporary paths are never saved; a saved browser-folder target therefore
requires a fresh selection after reload.

**Host proto paths** and **Host protoset paths** remain separate advanced modes. Those values are
read by the ProtoPeek process, so a path in a remotely opened or containerized console is not a
path on the browser machine. A JSON schema connection accepts at most 128 proto entry paths, 64
import roots, or 32 protoset paths; each path is at most 4,096 UTF-8 bytes and all configured paths
share a 32 KiB budget. Explicit proto entry and protoset files must be regular files and are
preflighted before dialing or parsing at 4 MiB each and 16 MiB total. An import root grants the host
process authority to resolve referenced imports under that root; ProtoPeek does not pre-read every
file in the directory. Parsed imports are instead covered by the retained descriptor limits below.

At most two non-upload workspace schema connections run per manager. Reflection resolves exposed
services incrementally and stops requesting descriptors when a limit is reached instead of issuing
an unbounded all-files fetch. Before any reflection, host-path, protoset, or browser-folder session
is published, ProtoPeek retains at most 512 services, 10,000 methods, 1,024 descriptor files, 10,000
messages, 50,000 fields, 4,096 enums, 50,000 enum values, and 32 levels of message nesting, plus 8
MiB of serialized descriptors and a 16 MiB generated schema catalog. Structural limits run before
catalog summaries and proto text are materialized. Cancellation and manager shutdown stop work
before dialing or publication wherever the parser/transport permits. Limit and parse errors identify
the source and corrective action without echoing schema contents or metadata values.

Ambient discovery checks only a fixed list of loopback candidates. A private or link-local IP requires the per-scan private-network opt-in. A public address or hostname is accepted only as the single explicit target: ProtoPeek does not expand it into an arbitrary port scan. Hostnames are resolved once, every returned address is classified against that opt-in, and probes dial a validated numeric address so DNS cannot silently change the destination between policy and connection. Passing that explicit target to the CLI opens the same visible scan dialog. A host without a port tries only `50051` with plaintext and `443` with verified TLS; an explicit HTTP(S) authority uses its stated or default port. Each candidate has fixed time limits and can report verified gRPC, a safe non-following HTTP `HEAD` response, or open TCP evidence. At most two scan requests run at once; retained service names, reflection responses, HTTP fields, errors, and details have explicit byte limits, and the result says when evidence was truncated. Scans are cancellable, never follow redirects, and never send a state-changing request.

Next-hop lookup asks the local kernel for one currently selected route per resolved address from the ProtoPeek process. It resolves at most eight addresses, performs at most four route lookups concurrently, and requests a two-second aggregate deadline. It reports source address, interface, reported gateway or on-link status, prefix, and metric/table when the platform provides them. It is not traceroute: it performs no hop probes, mutates no routes, and requires no elevation. Entering a hostname can still perform normal DNS resolution. VPN, proxy, policy-routing, ECMP, and later route changes remain explicit sources of uncertainty.

The Scan dialog can also import up to 8 MiB of XML previously written by `nmap -oX`. Nmap is not required to import an existing file. To create new XML, users obtain and run Nmap separately; ProtoPeek does not bundle, install, locate, or execute Nmap/Npcap and accepts no Nmap arguments. Imported service names and table/probed confidence are untrusted hints; an open TCP endpoint at a validated literal IP must run through **Verify with ProtoPeek** and the existing bounded scanner before gRPC or HTTP can open. Uploaded XML and imported inventory are not persisted.

One running ProtoPeek handler also shares small admission budgets across browser sessions: eight
ordinary gRPC invokes total across the direct and workspace paths, four HTTP relays, and two native
route requests. Method and CSRF policy run before admission; a full budget returns `429 Too Many
Requests` with `no-store` and `nosniff` before reading the rejected body or starting network work.
Success, validation failure, cancellation, panic unwinding, and workspace-session deletion release
their slots. These process budgets are separate from—and do not replace—the existing per-request
candidate, message, redirect, address, and route-worker caps.

Each admitted ordinary gRPC invoke retains at most 512 response messages and 8 MiB of serialized
response-message JSON. Message 513 or the first message that would cross the byte boundary cancels
the RPC and returns the retained headers/messages as explicitly partial local-limit evidence;
ProtoPeek does not invent a server status or trailers. Exactly 512 messages or exactly 8 MiB may
still finish normally. An omitted or greater-than-60-second deadline receives a 60-second local
handler wall, while a positive user deadline at or below 60 seconds remains unchanged.

## Capabilities

| Surface | What it does |
|---|---|
| **Method rail** | Search and filter reflected services/methods with clear unary and streaming modes |
| **Target registry** | Save and switch gRPC endpoints without restarting |
| **Local discovery** | Distinguish reflection, gRPC-without-reflection, safe HTTP response evidence, and open TCP with bounded loopback and explicit-target policies |
| **Next-hop evidence** | Read one kernel-selected route per resolved address from the ProtoPeek process without hop probes, polling, privilege, or route mutation |
| **Offline Nmap import** | Parse bounded `nmap -oX` host/port hints and require ProtoPeek verification before opening a workbench |
| **Payload generator** | Scaffold JSON from reflected protobuf schemas |
| **Browser proto folder** | Upload one bounded, temporary `.proto` snapshot with nested imports while keeping browser handles and server paths out of saved profiles |
| **Proto explorer** | Browse files, messages, enums, deps; export `.proto` or catalog JSON |
| **Metadata and auth** | Editable live metadata, Bearer helper, and deadlines; automatic history and default exports redact credentials and binary metadata |
| **Saved gRPC requests** | Keep secret-sanitized gRPC recipes locally, replay them, and import/export workspace JSON |
| **Unary Repeat** | Run 2–50 sequential unary checks with cancellation, explicit deadlines, a 60 s cap, separate gRPC status and relay/transport failures, and honest handler-vs-console timing |
| **gRPC Health** | Run canonical `grpc.health.v1` Check or one bounded live Watch with headers, transitions, trailers, cancellation, and final gRPC status kept distinct |
| **Response timeline** | Ordered messages with callback-observed timing, filtering, copy/export, headers, trailers, and final status |
| **Fast controls** | Cancel active calls, `Cmd/Ctrl+Enter` to invoke, `/` to search, and `Cmd/Ctrl+K` for commands |
| **Assertions** | Validate status, latency, metadata, and payload text locally |
| **Transport lens** | gRPC-Web, Envoy bridging, and transport context alongside the console |
| **HTTP workbench** | Send bounded HTTP(S) requests with method, URL, params, headers, auth, body, timeout, cancellation, redirect policy, and native response evidence; copy the current draft as bounded, credential-redacted cURL |

gRPC timing is cumulative from invoke start and marks lifecycle boundaries observed by ProtoPeek's
grpcurl handler callbacks and invoke return. Unary callbacks may cluster after transport completion;
the values are not packet-arrival, server-processing, or TTFB measurements. Handler invoke duration
includes JSON/protobuf conversion and callbacks but excludes the browser/HTTP relay; console round
trip includes that relay and response parsing. Every Unary Repeat attempt is a real RPC that may
mutate service data; protobuf descriptors do not reliably guarantee idempotency.

While Repeat owns the request, assertions are disabled and ordinary Invoke is refused. Leaving
Checks cancels the run and preserves partial evidence instead of continuing hidden. Completed
results retain their run-start timestamp and frozen count, think time, and deadline; changed controls
are marked as a previous run.

Unary Repeat export includes the method, target, run ID/start timestamp, frozen configuration,
counts, per-attempt offsets/timings, classifications, and error/status text. It excludes request
bodies and metadata; review internal addresses and service/relay text before sharing.

Health is an explicit diagnostic, never background polling. A blank service asks for overall server
health; an unknown named service is canonical `NOT_FOUND` for Check and `SERVICE_UNKNOWN` for Watch.
Watch observes one selected backend connection for 1–600 seconds, retains the latest 200 of at most
512 status observations, and never retries. Its timestamps are ProtoPeek handler/relay observations,
not server emission time or fleet-wide proof. Health results and request metadata are neither saved
nor exported.

Workspace export writes the explicit `protopeek-workspace` version 1 format. The default export
contains saved requests, environments, assertions, and inactive target profiles, but excludes
automatic RPC history. Saved request bodies are deliberate workspace data, so review them before
sharing a file. Import rejects files larger than 4 MiB before reading them, validates bounded
collections and strings, contains errors inside the running console, and never connects an imported
target. Imported host proto, protoset, CA, client-certificate, and key paths are paths on the machine
running ProtoPeek; explicitly connecting that profile authorizes the ProtoPeek process to read those
local paths. Browser-folder profiles contain no folder handle, file bytes, root name, or path and
remain inactive until the user chooses a fresh folder and explicitly connects.

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

Copy as cURL is an explicit export-only action. Send and Copy first apply the same URL, user-info,
header, body, and timeout validation; the command preserves the prepared method, duplicate query
parameters, non-sensitive headers, timeout, and active body while omitting auth and credential-like
headers and leaving credential-like URL values blank. Redirect-enabled drafts are refused because
one portable cURL command cannot reproduce ProtoPeek's bounded redirect, method/header, and HTTPS
downgrade policy. Export inspects at most 64 effective headers and refuses commands over 512 KiB.
Request bodies are deliberate user-authored content and are copied verbatim, so review the command
before sharing or running it. The command runs in your shell rather than ProtoPeek's relay, so DNS,
network namespace, proxies, trust roots, and implicit cURL headers can differ. cURL import is not
included yet.

## Protocol direction

ProtoPeek is intentionally broader than a gRPC-only brand, but intentionally narrower than a
generic cloud API platform. The shared shell owns local target selection, request editing, response
evidence, history, and session lifecycle. Each adapter owns discovery, schema, invocation,
cancellation, and its native inspector.

| Adapter | Status | First useful slice |
|---|---|---|
| gRPC | Stable · v0.3.0 | Reflection, temporary browser-folder snapshots, host `.proto`/protoset sources, unary and streaming calls, canonical Health Check/Watch, metadata, headers, trailers, status, callback-observed handler lifecycle timing, and bounded Unary Repeat |
| HTTP / REST | Stable · v0.3.0 | Standard-library HTTP(S), method, URL, headers, body, timeout, redirect choice, cancellation, status, protocol, timing, and bounded text/base64 response bodies |
| Next-hop route evidence | Shipped · v0.3.0 | Read-only Linux netlink, Darwin routing socket, or Windows `GetBestRoute2`; one process-perspective route per resolved address, no hop probes |
| Nmap XML evidence | Shipped · v0.3.0 · optional input | Streaming offline import only; Nmap is not required for import and is never executed by ProtoPeek |
| Cap'n Proto | Exploring | Local schema/capability bootstrap only after fixture, dependency-size, and native-inspector gates |
| Traceroute / hop probes | Gated | Requires explicit consent, strict probe budgets, truthful partial failures, and reliable unprivileged backends |
| Bundled Nmap execution | Not planned for the core binary | Existing XML import stays dependency-free; any future opt-in companion needs explicit executable choice, previewed scope, hard budgets, and an auditable command |
| LAN discovery | Planned, gated | Explicit, previewable private ranges only; requires opt-in scope, strict candidate budgets, cancellation, and no ambient or public crawling |
| SMTP, FTP, and others | Later | Only after protocol-specific security, evidence, and UX are designed |

Bundled Nmap execution is not planned for the core binary. Traceroute/hop probes, LAN range expansion, and live capture remain gated. The current route surface is kernel evidence only; the current Nmap surface is offline XML import only.

See the detailed [route and Nmap evidence boundary](guides/route-and-nmap-evidence.md), [protocol roadmap](guides/feature-roadmap.md), [competitive workflow decisions](guides/competitive-landscape.md), [transport boundaries](guides/transport-boundaries.md), and [go-to-market runbook](guides/go-to-market.md).

Found an installer/runtime defect? Open a [GitHub issue](https://github.com/shreyam1008/ProtoPeek/issues).
Questions and workflow feedback belong in [GitHub Discussions](https://github.com/shreyam1008/ProtoPeek/discussions).

## Development

Requires [Bun](https://bun.sh/) ≥ 1.3.10 and [Go](https://go.dev/).

```sh
bun install --frozen-lockfile     # install frontend deps
bun run test                      # tsgo typecheck + Biome lint + Vitest
bun run build                     # build console/site and enforce bundle budgets
go test ./...                     # Go test suite
make install                      # install protopeek and pp locally
make docker-smoke                 # build/probe the guarded scratch image
```

## Docker

```sh
make docker
docker run --rm -p 127.0.0.1:8080:8080 protopeek:dev
```

Scratch-compatible image: static Go binary, embedded web app, CA certs, and a non-root user. The
image uses `-allow-non-loopback-bind` to listen on its container interface while still rejecting
non-loopback browser Hosts and Origins. Keep the host-side port mapped to loopback as shown; the
separate `-unsafe-allow-remote` mode disables that request-host guard and is only for an
authenticated, TLS-terminated, rate-limited boundary. A browser-folder snapshot is uploaded to this
container and compiled through bounded in-memory buffers; it is never written to a schema staging
directory.

## Project origin

ProtoPeek originated from a fork of `fullstorydev/grpcui`. The product, docs, branding, and release flow are now ProtoPeek's own.

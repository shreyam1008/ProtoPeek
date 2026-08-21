# ProtoPeek

ProtoPeek (Protocol Peek) is a local-first protocol and network workbench for seeing the
request-to-server path clearly. Its protocol-native gRPC and HTTP surfaces keep transport details
visible. Its bounded evidence tools add DNS and kernel-route context, Linux-native active hop
observations, authorized private-network service discovery, a logical topology notebook, and
offline Nmap XML import without background polling or an external database.

Built by [Shreyam Adhikari](https://shreyam1008.com.np/) · [Website](https://protopeek.shreyam1008.com.np/) · [Docs](https://protopeek.shreyam1008.com.np/docs/) · [Learn gRPC](https://protopeek.shreyam1008.com.np/learn-grpc/)

> **Latest stable:** v0.4.0. The verified shell and PowerShell installers, and
> `@latest`, resolve this release. Edge remains a separate opt-in channel.

![ProtoPeek v0.3 Protocol Peek dashboard with gRPC, HTTP, scan, next-hop, and roadmap surfaces](https://protopeek.shreyam1008.com.np/assets/protopeek-dashboard.png)

The screenshot is a real local Chrome capture of the embedded dashboard. It is the default when
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

The verified release installer resolves v0.4.0 from immutable archives pinned to its published
SHA-256 entries. The owned Homebrew and Scoop channels remain on v0.3.2 until their v0.4.0
checksums are promoted and independently tested. See the
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

With no target, the dashboard opens at `/`. The rail keeps gRPC (`/grpc`), HTTP (`/http`), the
network workbench (`/network/path`), compatibility next-hop evidence (`/routes`), and the in-app
roadmap (`/roadmap`) one command away. A new gRPC target defaults to `localhost:50051`; each saved
target keeps its own plaintext/TLS settings, authority override, schema source (reflection, a
browser-folder snapshot, host proto paths, or host protoset paths), and cert paths. A new HTTP draft
defaults to `http://localhost:8080/`. Exact `localhost`, `127.0.0.1`, and `[::1]` shorthand may omit
the scheme and is normalized to HTTP; every non-loopback host must state `http://` or `https://`.
HTTP history shows its 12 newest secret-safe entries with total observed time, and JSON formatting
is optional—invalid JSON remains sendable verbatim. Light is the first-run theme; dark mode and
local histories are stored only in the browser profile.

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

Network Path adds a separate active observation. Linux uses ProtoPeek's built-in unprivileged UDP
error-queue backend; it does not shell out, install a tool, or request root. A trace resolves once,
pins one numeric address, retains bounded DNS answers and the kernel-selected route, then preserves
every per-TTL probe sample—including timeouts and multiple responders. The default plan is 24 hops
× 3 probes; hard bounds are 32 hops, 4 probes per hop, 96 probes total, 100–2,000 ms per probe, a
30-second wall, and 20 probes per second. Returned total duration is accepted only through the
selected wall plus a fixed 2-second resolver/return allowance; that allowance is not extra probe
time or a latency measurement. Every RTT is round-trip time from the ProtoPeek process to one
responder, never claimed as latency between adjacent hops. Minimum, median, and maximum values
are calculated independently per responder instead of blending ECMP replies. The destination
median appears only when reply samples came from the exact pinned destination; ProtoPeek never
substitutes the last responding router. Silent hops do not prove a device is down, and ECMP or other
load balancing can produce several responders at one TTL. Active probes require explicit consent,
with an additional acknowledgement for public targets. Darwin and Windows currently report active
hop probing as unsupported; ProtoPeek offers no automatic package manager or elevation path.

Local network discovery is another explicit operation, not ambient crawling. Its capability check
only reads interface metadata. A scan accepts an authorized RFC 1918 IPv4 CIDR no broader than
`/24` and one visible TCP profile. The capability response returns at most 32 deduplicated interface
suggestions and omits a configured CIDR unless the whole prefix is inside one RFC 1918 block; a
broad accepted interface is suggested as its containing `/24`. Each profile exposes both `ports`
and the exact `applicationProbePorts`: Quick uses `80, 443, 50051, 8080` for both; gRPC common uses
`443, 6565, 7000, 7443, 9090, 50051` for both; Web/API uses `80, 443, 3000, 4000, 5000, 8000,
8080, 8443` for both; Expanded selects `22, 53, 80, 443, 445, 631, 1883, 3000, 3306, 3389, 5432, 6379, 8000,
8080, 8443, 9090, 9100, 50051`, but its application subset is only `80, 443, 3000, 8000, 8080,
8443, 9090, 50051`.

Application-probe ports may receive bounded gRPC reflection plus HTTP `HEAD /`; redirects are off.
Every other selected port—including Expanded's `22, 53, 445, 631, 1883, 3306, 3389, 5432, 6379,
9100`—receives a TCP connect only. Limits are 18 ports, 4,572 attempts, 32 workers, 15 seconds, and
one scan at a time. A 64 KiB aggregate verbose-evidence budget can omit additional protocol detail,
but every observed open-port record remains. `probeDurationMs` is the full elapsed duration of that
TCP-connect or application probe, not network latency. `attemptsCompleted` counts selected endpoint
probe calls that returned, including cancellation returns; it is not an open-port,
successful-connect, or reached-target count. Only positive selected-TCP evidence is retained. An
absent address is not labeled offline, and inferred roles are never presented as OS,
hardware, ownership, VLAN, or physical-link evidence.

Path and discovery evidence can be saved into a versioned `protopeek-network` JSON workspace with
editable labels, tags, notes, groups, positions, and immutable snapshots. Appending a later
observation preserves saved manual labels, tags, notes, pinned positions, group assignments, manual
groups, and manual relationships instead of replacing them with scanner output. Unsaved edits are
guarded before switching workspaces, importing, appending an observation, restoring history,
deleting, unloading, or leaving the network workbench; the user must save or deliberately discard
them. Saved path responders are observed; silent-hop placeholders, an unconfirmed synthetic
destination, and logical trace-adjacency edges are inferred. Scoped IPv6 identities are retained
only with a bounded safe interface zone. The map is logical evidence, not physical topology. Its
interactive canvas is capped at 160 nodes, 640 relationships, and 64 groups; larger workspaces use
a complete 100-record paged inventory instead of dropping evidence.

IndexedDB persistence uses a 20-record bounded cursor restore and refuses overflow instead of
evicting old work: at most 20 workspaces, 4 MiB each, and 32 MiB total. Compare-and-swap writes and
deletes reject a stale cross-tab copy without overwriting it. A failed persistent delete keeps the
workspace visibly present, while denial, quota failure, unavailability, or corrupt/overflow restore
produces a visible session-only fallback. Historical snapshot restore takes two explicit actions and
replaces only the editable current map. Canonical JSON is the lossless import/export path. GraphML is
lossy and accepts only one flat directed graph; undirected or mixed edges, nested graphs, hyperedges,
ports, duplicate structures, and XML 1.0-invalid controls are rejected rather than reinterpreted.
CSV is an export-only flat inventory.

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
| **Network Path** | On Linux, resolve and pin one destination, retain kernel-route context, and run consented unprivileged UDP probes with truthful per-TTL source RTT, silent hops, ECMP responders, and fixed limits |
| **Private-network inventory** | Preview one RFC 1918 IPv4 `/24`-or-smaller plan; only profile-declared application ports receive bounded gRPC/HTTP probes, every other selected port is TCP-connect-only, and full probe duration is not labeled network latency |
| **Topology notebook** | Save tagged immutable snapshots, preserve manual annotations across later observations, guard unsaved edits, and use a bounded logical canvas with a complete paged-list fallback—never a physical-link or VLAN claim |
| **Network exchange** | Use canonical `protopeek-network` JSON for lossless round trips, one-flat-directed-graph disclosed-loss GraphML, and CSV for flat inventory export |
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
| Network Path | Shipped · v0.4.0 · Linux | Built-in unprivileged UDP error-queue tracing with separate DNS, route, per-TTL sample, and source-RTT evidence; active probes require explicit consent |
| Private-network discovery | Shipped · v0.4.0 | Authorized RFC 1918 IPv4 `/24`-or-smaller profiles with exact application-inspection versus TCP-connect-only ports, full-probe duration, cancellation, positive evidence only, and a 64 KiB aggregate verbose-detail budget |
| Network topology | Shipped · v0.4.0 | Inference-labelled logical canvas, complete paged-list fallback, immutable snapshots, manual-field preservation, unsaved-edit/stale-tab guards, bounded browser persistence, canonical JSON, strict disclosed-loss GraphML, and CSV inventory |
| Nmap XML evidence | Shipped · v0.3.0 · optional input | Streaming offline import only; Nmap is not required for import and is never executed by ProtoPeek |
| Cap'n Proto | Exploring | Local schema/capability bootstrap only after fixture, dependency-size, and native-inspector gates |
| Darwin / Windows active hop probes | Soon | Require verified unprivileged native backends; no package-manager, shell-parser, or elevation fallback is offered |
| Bundled Nmap execution | Not planned for the core binary | Existing XML import stays dependency-free; any future opt-in companion needs explicit executable choice, previewed scope, hard budgets, and an auditable command |
| Broader or public range discovery | Not planned for the core flow | Current discovery remains selected TCP ports inside one authorized RFC 1918 IPv4 `/24`-or-smaller scope |
| SMTP, FTP, and others | Later | Only after protocol-specific security, evidence, and UX are designed |

Bundled Nmap execution is not planned for the core binary. Active path and private-network
operations never start on page load and remain distinct from the passive kernel-route lookup and
offline Nmap XML import. Wider range expansion and live capture remain gated.

See the detailed [network workbench guide](guides/network-workbench.md),
[route, path, discovery, and Nmap evidence boundary](guides/route-and-nmap-evidence.md),
[protocol roadmap](guides/feature-roadmap.md),
[competitive workflow decisions](guides/competitive-landscape.md),
[transport boundaries](guides/transport-boundaries.md), and
[go-to-market runbook](guides/go-to-market.md).

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

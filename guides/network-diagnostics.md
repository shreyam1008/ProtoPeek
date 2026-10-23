# Network diagnostics

Current source adds **Network → Diagnostics** at `/network/diagnostics`. Choose a question,
enter one target and run it explicitly. The page makes no network requests on opening or
changing modes. Results and private inputs live in this tab's memory.

The local CLI enables this capability only in safe local mode. Each request requires CSRF
validation and a direct loopback peer; forwarded and remote requests are refused. Embedded
handlers omit probes by default and must explicitly select `standalone.WithNetworkDiagnostics()`.
The unsafe remote CLI mode does not enable them.

| Diagnostic | Evidence |
| --- | --- |
| Connection check | One resolution, pinned addresses, TCP setup and optional verified TLS |
| DNS records | A, AAAA, CNAME, MX, TXT, NS, SOA, SRV or PTR; TTL/rcode only from an explicit resolver |
| Compare resolvers | System and explicit DNS answer sets, with incomplete observations marked inconclusive |
| TLS certificates | Server identity, negotiated TLS/ALPN, received certificates and verified chain separately |
| IPv4 / IPv6 reachability | A TCP result for every admitted resolved address; partial family failures remain visible |
| Connection samples | A finite sample with successful-connection min/median/p95, refusal and timeout counts |
| TCP exchange | Up to 4 KiB sent and a bounded text/hex reply |
| UDP exchange | One optional datagram and one reply; silence never proves a closed port |
| HTTP proxy | A CONNECT handshake to a locally resolved, pinned numeric destination |
| SOCKS5 proxy | Native greeting/auth/connect evidence, with no application payload sent through the tunnel |
| Cleartext HTTP/2 | h2c prior-knowledge SETTINGS and matching PING; no request stream |
| HTTP/3 over QUIC | One verified QUIC connection and HEAD `/`; no redirect, TCP fallback or 0-RTT |
| Subnet planner | Exact IPv4/IPv6 range/count arithmetic without enumerating or contacting addresses |

Search commands with Ctrl/Cmd+K or link to a mode using, for example,
`#/network/diagnostics?mode=dns-compare&target=example.com`. Opening a link only prepares a draft.

## Bounds and interpretation

An operation lasts at most 15 seconds; each probe uses 0.1–3 seconds. Connection sampling
accepts 1–20 attempts with a 0–1 second interval. Two diagnostics can run at once. Resolution
admits at most four addresses per family; larger answers require an explicit IP rather than
silently dropping destinations. Unspecified, multicast, reserved and known local directed
broadcast addresses are rejected. Explicit IPv6 zone identifiers are retained.

Default DNS uses ProtoPeek's OS/Go resolver path. It does not promise the browser's resolver,
NSS behavior, cache state or split-DNS selection. The system API does not expose raw TTLs,
response codes or SOA. An explicit DNS server must be a unicast IP, with optional port;
replies must match the ID and question. Truncated UDP replies use bounded TCP fallback.

TCP connectivity is not HTTP or RPC health. Proxy acceptance is the proxy's claim that a
tunnel was established, not an application response. Proxy DNS is not tested: ProtoPeek
resolves the destination locally. HTTP/3 shows the actual status independently from transport
success. It sends HEAD `/` even when the input URL contains a path.

IPv4 `/31` uses point-to-point semantics and `/32` contains one address. IPv6 counts all
addresses without claiming they are allocated hosts. Only an RFC1918 IPv4 `/24` or smaller
can prepare a nearby-device scan. That handoff opens the existing plan; **Scan network** is
still a separate explicit action.

## Private inputs and exported evidence

Private CA PEM augments trust only for that run. It is never installed, persisted or exported.
Certificate verification remains enabled. Received chains and verified chains are separate,
so a missing intermediate or unknown root remains visible.

Proxy usernames/passwords remain in memory. These proxy handshakes use plaintext to the
proxy; the page warns before use. Server responses cannot reflect arbitrary proxy text or
headers into errors or reports. API request/response bodies are excluded from verbose CLI dumps.

Raw sent payloads are excluded from results. Replies remain visible only on this screen and
are omitted from **Export evidence**, since a service can echo a private request. Exported
diagnostic metadata can still identify private hosts and certificates; review it before sharing.
Session activity stores only a closed outcome, elapsed time and counts, not diagnostic payloads,
credentials, CA input or free-form errors. The new raw diagnostics are not agent/MCP tools.

## Verification

The package uses real loopback TCP, UDP, DNS, proxy, TLS, HTTP/2 and HTTP/3 fixtures, including
untrusted/private CA, refusal, cancellation and bounded input tests. Browser acceptance uses
the native Windows server and local protocol peers. Native Linux/macOS and release packaging
remain distinct CI gates; a successful web build alone is not native runtime evidence.

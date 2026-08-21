# Route, path, discovery, and Nmap evidence boundary

ProtoPeek keeps four network-evidence paths separate because they have different authority and
trust models. Next-hop lookup reads the local kernel without probes. Network Path sends a bounded,
consented active probe plan. Local discovery opens selected TCP connections inside one authorized
private IPv4 scope. The Nmap path imports a file produced elsewhere. None is a general-purpose or
ambient network scanner.

## Next-hop route lookup

`POST /api/route/lookup` accepts JSON with `destination` and an optional `family` of `auto`, `ipv4`,
or `ipv6`. The same-origin CSRF token is required. The request body is capped at 16 KiB and the
destination at 253 bytes. Resolution plus all route lookups request a two-second deadline. ProtoPeek
keeps at most eight unique resolved addresses and runs at most four kernel lookups concurrently.
Windows IP Helper calls are synchronous, so cancellation prevents new work but cannot interrupt an
already-running operating-system call.

The result is one kernel-selected route per address from the ProtoPeek process perspective. It can
include source IP, interface index/name, exact next hop or on-link state, local-route state, prefix,
route metric/table when known, backend, notes, and a per-address error. One address failing does not
erase successful siblings.

This is not traceroute. Route lookup:

- sends no route probes; a hostname may still cause normal DNS queries;
- makes one read-only kernel query per resolved address;
- never dumps, polls, adds, changes, or deletes routes;
- requires no elevation;
- cannot prove the path taken later through a VPN, proxy, policy rule, ECMP choice, container/host
  boundary, or changed route table.

### Platform boundary

- Linux sends one `RTM_GETROUTE` netlink request with `NLM_F_REQUEST` only. It validates message
  lengths, attributes, sequence, the kernel socket sender, and the response port ID assigned to its
  socket. Its prefix is the resolved `RTM_GETROUTE` destination prefix; ProtoPeek does not dump the
  underlying routing table to reconstruct a broader FIB prefix. It adds no netlink library. ECMP,
  cross-family `RTA_VIA`, and next-hop-object replies fail explicitly until the result model can
  represent them without inventing an on-link route.
- Darwin sends one `RTM_GET` through a non-blocking routing socket and matches process ID and
  sequence. Darwin does not provide a portable table ID or route metric through this response, so
  those fields remain unknown.
- Windows calls `GetBestRoute2`. Its route metric excludes the separately maintained interface
  metric; table identifiers are not exposed by this API.
- Other build targets compile an explicit `unsupported` backend result. No fallback shells out to
  `route`, `ip`, PowerShell, or another executable.

Unspecified, multicast, IPv4 limited-broadcast, and unzoned IPv6 link-local destinations are
rejected. Zoned link-local destinations use the named or numeric interface scope.

## Active Network Path

`GET /api/path/capabilities` reports the current operating system, native method availability, and
fixed limits without sending path probes. `POST /api/path/trace` accepts a bounded JSON plan and
requires the same-origin CSRF token. The request body is capped at 32 KiB.

Every trace requires `consent.activeProbe: true`. A destination that resolves to a public address
also requires `consent.publicTarget: true`. ProtoPeek validates the target, resolves it once, keeps
at most eight unique answers from at most 32 resolver candidates, and pins one numeric address for
the route lookup and active trace. DNS therefore cannot silently move the destination after policy
and route evidence are recorded.

The fixed trace contract is:

- destination text at most 253 bytes;
- 24 hops and three probes per hop by default;
- at most 32 hops, four probes per hop, and 96 probes total;
- 750 ms per probe by default, with a 100–2,000 ms range;
- a 20-second wall by default and a 30-second maximum;
- returned total `durationMs` accepted only through the echoed wall plus a 2,000 ms
  resolver/return allowance, which is not extra probe time;
- at most 20 probes per second; and
- two admitted path traces across one running handler.

### Linux native UDP evidence

Linux uses an in-process UDP socket with `IP_RECVERR` or `IPV6_RECVERR` and reads matching
asynchronous ICMP errors from the kernel error queue. It uses one stable UDP five-tuple where
possible and defaults to destination port `33434`. It does not shell out, parse localized command
output, install a package, or require elevation. Native ICMP and TCP trace methods are not
implemented in this slice.

Darwin and Windows compile explicit unsupported capability evidence for active hop probing. The UI
does not offer to install Nmap, `traceroute`, `tracepath`, or another fallback, and it does not ask
for administrator access. Their read-only next-hop backends remain available independently.

### Interpretation boundary

Each sample records the TTL, sequence, reply/timeout/unreachable/error state, responder when known,
round-trip duration when observed, ICMP type/code when available, and bounded detail. A hop retains
all samples and all distinct responders. This matters for silent routers, rate limiting, and ECMP:

- a timeout means no matching reply arrived before the bound; it does not prove the router or destination is offline;
- several responders at one TTL are preserved rather than collapsed into a fabricated single route; and
- the path is the result of this specific bounded probe set, not a guarantee that later traffic takes one stable route.

Every hop RTT is source-to-responder round-trip time from the ProtoPeek process. It is not link
latency between adjacent hops, and subtracting one hop's RTT from the next is not a dependable link
measurement. Minimum, median, and maximum values are calculated independently for each responder;
several ECMP responders are never blended into one statistic. The destination median uses only
reply samples whose responder is the exact pinned numeric destination, and remains unavailable
rather than substituting the last responding router. DNS answers, kernel-route evidence, and
active-hop evidence remain separate even when one of those stages fails.

Saving a trace marks actual responding addresses as `observed`. Silent TTL placeholders, an exact
pinned destination that did not answer, and every logical trace-adjacency edge are `inferred`.
Those synthetic records preserve the shape and endpoint of the bounded observation; they do not
assert a responding device or physical link. Scoped IPv6 source and responder identities are
accepted only with a bounded 1–64-character portable interface zone; malformed addresses, repeated
`%`, whitespace/unsafe zone characters, and XML 1.0-invalid controls are rejected.

ProtoPeek does not bundle a GeoIP database. Metro or airport aliases such as `SIN`, `BOM`, or `IAD`,
and provider-region identifiers such as `us-east-1`, are not automatic datacenter proof. Region and
provider annotations must remain manual or explicitly sourced evidence.

## Authorized local-network discovery

`GET /api/network/capabilities` reads local interface metadata, returns exact built-in profiles and
limits, and sends no probes. Only up, non-loopback private IPv4 interfaces become suggestions. A
response retains at most 32 deduplicated suggestions. A configured interface prefix must be wholly
inside one RFC 1918 block or it is omitted rather than rewritten; a valid broader interface is
narrowed to its containing `/24` suggestion.

`POST /api/network/discover` accepts JSON with `cidr`, `profile`, and `consent`. It requires the
same-origin CSRF token and explicit consent. The scope must be a literal RFC 1918 IPv4 CIDR of `/24`
or narrower. Loopback, public, IPv6, a bare address, and broader prefixes are rejected. For `/30`
and broader host subnets ProtoPeek skips the traditional network and broadcast addresses; it keeps
both addresses in `/31` and the sole address in `/32`.

Profiles expose exact `ports` and ordered-subset `applicationProbePorts` plans:

| Profile | All selected TCP ports | `applicationProbePorts` | TCP connect only |
|---|---|---|---|
| Quick services | `80, 443, 50051, 8080` | `80, 443, 50051, 8080` | None |
| gRPC common | `443, 6565, 7000, 7443, 9090, 50051` | `443, 6565, 7000, 7443, 9090, 50051` | None |
| Web and API | `80, 443, 3000, 4000, 5000, 8000, 8080, 8443` | `80, 443, 3000, 4000, 5000, 8000, 8080, 8443` | None |
| Expanded services | `22, 53, 80, 443, 445, 631, 1883, 3000, 3306, 3389, 5432, 6379, 8000, 8080, 8443, 9090, 9100, 50051` | `80, 443, 3000, 8000, 8080, 8443, 9090, 50051` | `22, 53, 445, 631, 1883, 3306, 3389, 5432, 6379, 9100` |

Application-probe ports may receive bounded gRPC reflection and an HTTP `HEAD /` request with
redirects disabled. Every other selected port receives only a TCP connect and close. Selecting a
raw or legacy service port in Expanded is not permission to send it gRPC or HTTP application data.

The hard limits are 18 ports, 4,572 TCP attempts, 32 workers, a 15-second wall, and one running
local discovery per handler. Results report planned and completed attempts, completion, and a
stopping reason. `attemptsCompleted` counts selected endpoint probe calls that returned, including a
call returning due to cancellation; it does not mean open ports, successful connects, or reached
targets. Calls not dispatched after cancellation are not completed. Cancellation and deadline keep
partial positive evidence.

Only ports with positive TCP evidence are retained. On application-probe ports, the existing
bounded scanner can add gRPC, reflection, safe non-following HTTP, and bounded service details. A
64 KiB aggregate verbose-evidence budget covers those strings and evidence notes; if exhausted,
every observed open TCP port record remains while only additional protocol detail is omitted.

The response names timing `probeDurationMs`. It is the complete elapsed TCP-connect-only attempt or
the complete application probe, not network latency, link RTT, one-way delay, or server-processing
time. An address absent from the result was not observed on the selected ports; it is never
classified as offline. Role labels are low-confidence inferences from ports and protocols, not OS
or hardware identification. Discovery does not infer ownership, VLAN membership, or physical
links.

## Saved network evidence

The canonical workspace format is `protopeek-network` JSON version 1. It retains logical nodes,
identities, observed ports and services, provenance, groups, positions, and full immutable
snapshots. One imported or serialized workspace is capped at 4 MiB and is validated as a complete
versioned document before use.

Appending a later observation preserves saved manual labels, tags, notes, device types, pinned
positions, group assignments, manual groups, manually sourced services, and manual relationships.
Fresh scanner evidence updates the current view without mutating older snapshots. Dirty map edits
are guarded before switching/importing, appending observations, restoring history, deletion,
unload, or leaving the network workbench; save and deliberate discard remain separate actions.

IndexedDB holds at most 20 workspaces, at most 4 MiB each, and at most 32 MiB total. Capacity is
refused without silent eviction. Restore uses a cursor bounded at 20 records and detects additional
records as overflow rather than bulk-loading them. Corrupt/overflow, unavailable, denied, or
over-quota storage preserves usable in-memory records for the current session and visibly instructs
the user to export before leaving. IndexedDB writes and deletes compare the exact previously loaded
record in one transaction; a stale tab reports a conflict and overwrites nothing. A persistent
delete failure leaves the workspace visibly retained instead of letting it silently reappear later.
Restoring an immutable snapshot to the editable current map requires two explicit actions and does
not remove the snapshot history.

GraphML is a portable but lossy graph exchange. Export omits identities, ports, services, original
provenance, and immutable snapshots; custom tag, note, and grouping keys can be discarded by other
tools. Import cannot reconstruct ProtoPeek protocol evidence or snapshots and marks its evidence as
`graphml-import`. It accepts only one flat `edgedefault="directed"` graph and rejects undirected or
mixed edges, nested graphs, hyperedges, ports/edge-port references, duplicate identifiers or data
keys, unsupported topology structures, and XML 1.0-invalid controls rather than reinterpreting
them. CSV is an export-only flat inventory, not a round-trip workspace format. The topology canvas
represents logical observed/manual/inferred/unknown evidence, never asserted physical cabling. It
is interactive through 160 nodes, 640 relationships, and 64 groups; above any bound, a complete
100-record paged node/group/relationship inventory replaces the map without dropping records.

## Offline Nmap XML import

`POST /api/nmap/import` accepts raw `application/xml` previously produced by `nmap -oX`. It never
accepts command arguments and never bundles, installs, locates, or executes Nmap or Npcap. Uploaded
XML and parsed inventory live only for the request and current UI state; neither is written to a
file or database.

The importer uses streaming `encoding/xml`, requires an unnamespaced `nmaprun` root with
`scanner="nmap"`, accepts only the ordinary bare `DOCTYPE nmaprun` declaration, ignores stylesheet
processing instructions without fetching them, and rejects external/public/internal DTD and entity
input. It retains only:

- host state/reason, up to eight addresses, and up to sixteen hostnames per host;
- port number, protocol, state, and reason;
- service name, product, version, extra info, tunnel, method, and confidence.

It discards the original Nmap arguments, NSE scripts, OS fingerprints, and trace hops. Bounds are 8
MiB, XML depth 32, 250,000 tokens, 100,000 start elements, 512 attributes per element, 1,024 hosts,
16,384 ports total, and 512 bytes for every returned attribute. Collection fields always encode as
arrays, and a missing or failed Nmap completion record is labeled as partial evidence.

Service metadata is an untrusted hint even when Nmap labels its method `probed`. A usable open TCP
endpoint at a validated literal IPv4 or IPv6 address offers **Verify with ProtoPeek**, which calls
the existing explicit bounded scanner. Imported hostnames remain display-only. Only that fresh
TCP/gRPC/TLS/HTTP evidence enables a protocol workbench. UDP, IP protocol entries, port zero, and
non-open states are shown as imported evidence but cannot be verified by the current TCP scanner.

## Remaining wider boundaries

- **Bundled Nmap execution:** not planned for the core binary because executable discovery, argument construction, platform packaging, and scan scope widen the operational boundary. Any future companion would require an explicit executable choice, previewed scope, hard budgets, and an auditable command; offline XML import does not imply that design exists.
- **Darwin and Windows active hop probes:** need verified unprivileged native backends. ProtoPeek will not hide an executable install or privilege escalation behind a trace action.
- **Broader, public, or IPv6 range discovery:** excluded from the current local workflow. The implemented path stays inside one authorized RFC 1918 IPv4 `/24`-or-smaller scope and one exact selected-TCP profile.
- **Nmap-to-topology integration:** may later map existing bounded XML into a workspace with explicit import provenance and loss reporting. It does not imply command execution.
- **Live capture:** gated because it can require privilege and expose secrets. Release requires an explicit lifecycle, redaction/export policy, and dependable cross-platform teardown.

For the user workflow, storage behavior, and Now/Soon/Later plan, see the
[network workbench guide](/network-workbench/).

# ProtoPeek network workbench

## Current-source packet inspection

**Network → Packets** reads `.pcap`, `.pcapng` and `.cap` files without installing Wireshark.
Select a file and click **Inspect file**. The file is sent to the local ProtoPeek server for
analysis; captured endpoints are never contacted. The table shows endpoints, ports, packet sizes,
DNS questions, HTTP method/status, TCP flags or TLS record signatures where decoding is possible.
Filter by protocol, IP, port or decoded text; select a packet for its recorded UTC timestamp and
details. **Save metadata** exports this report; **Clear results** leaves the original file intact.

The reader accepts 16 MiB, parses at most 20,000 packet records and retains the first 2,000 rows.
Counters describe parsed records, and a limit notice identifies a stopped prefix. Tables paginate
50 rows at a time. PCAP supports little/big endian and micro/nanosecond timestamps. PCAPNG supports
multiple sections, interface timestamp resolution/offsets, enhanced, simple and legacy packet
blocks. Unknown block types are skipped with a notice. Link decoding covers Ethernet with up to
two VLAN tags, raw IPv4/IPv6, loopback, Linux cooked v1/v2, ARP, TCP, UDP and ICMP.

This is a header/signature reader: no TCP reassembly, checksum validation, decryption, process
attribution or raw payload export. Non-initial IP fragments are labeled without invented ports.
HTTP request targets and headers are omitted; DNS question names remain visible. TLS record
signatures do not establish the protocol inside encryption. Use the original capture in Wireshark
when deeper analysis is needed. Files, decoded rows and capture settings are session-only.

### Explicit capture through installed dumpcap

**Capture this host** uses Wireshark's separately installed `dumpcap`. Refresh interfaces, select
one local interface, enter one IP and/or port, choose 1–30 seconds, confirm permission and click
**Start capture**. Both filters combine with AND. The adapter requests non-promiscuous mode,
at most 2,000 packets, 512 bytes per packet and a 1 MiB capture buffer. Output travels through a
bounded pipe into the reader; ProtoPeek creates no capture file. Results appear after the run ends.
Cancel or navigation kills this invocation and discards the interrupted run while retaining any
earlier displayed result. Permission and driver failures remain errors; ProtoPeek does not elevate
or install a driver. See [Wireshark's capture guide](https://www.wireshark.org/docs/wsug_html_chunked/ChapterCapture.html)
and the [dumpcap manual](https://www.wireshark.org/docs/man-pages/dumpcap.html).

Parser, typed arguments, cancellation and output limits have automated coverage. Browser testing
on the current Windows host confirmed the real missing-tool state and a clearly labeled generated
packet fixture; native live capture with installed OS capture support remains a platform acceptance
gap. It is not a claim that this machine's real traffic has been captured successfully.

## Current-source host port scanner

Network → Port scanner checks one hostname or IP on explicitly chosen TCP ports. Common-service
and development presets are editable, and ranges such as `8000-8010` are supported. Each run allows
1024 unique ports, 32 concurrent connections, and 30 seconds. DNS resolves once; Auto prefers IPv4,
and results identify the pinned address. IPv6 can be selected explicitly. Cancel or leaving the page
aborts remaining attempts. Two scans can run per server.

Open means TCP connected. Closed means a refusal. No response means a timeout, not proof of a closed
port; routing and other errors remain unreachable. Interrupted ports are marked not scanned.
Service names are port-number hints. **Inspect service** opens a separate protocol probe before
handing confirmed HTTP/gRPC into Inspect. No application payload is sent during the port scan.
This is current-source functionality after v0.5.0. Scan only authorized hosts.

The scanner keeps settings and the last result in bounded browser storage. Restored results retain
their observation time and are not automatically refreshed. Clear results removes the retained scan.

## Windows path probes in current source

Windows now uses the built-in IP Helper ICMP echo APIs for IPv4 and IPv6 hop tracing. Auto selects ICMP on
Windows and UDP on Linux. No traceroute executable, packet-capture driver, or elevation is requested.
The same per-hop, probe-count, rate, and wall-time limits apply. Cancellation stops after the current
native call returns (within its chosen per-probe timeout, at most two seconds). Scoped link-local
IPv6 destinations and macOS probes remain unavailable. Native IPv4 and IPv6 loopback tests run on Windows.

Windows reply status and millisecond RTT are retained as native evidence. A timeout has no invented
responder or latency. Hop RTT includes the path from this PC to that responder and back; it cannot
identify per-link latency, prove the return path, or locate a datacenter by itself.

### Optional provider and location labels

After tracing, review responding IPs and choose **Look up hop labels**. Only public addresses go
to IPWHOIS (`ipwho.is`); private, loopback, link-local, carrier NAT and reserved addresses are skipped
locally. This uses at most 32 unique IPs, two concurrent requests and 30 seconds total. Successful
labels have a bounded 128-entry, 15-minute in-process cache. Nothing polls in the background.

Labels retain the provider source and observation time. They can include ASN, organization, ISP,
country, region and city. Anycast addresses may be registered far from the responding machine;
these are approximate IP labels, not measured datacenter locations or return-route evidence.
**Save trace** carries labels into the map as separate inferred provenance, while path replies
remain observed evidence. Export/import preserves both. Cancel leaves existing hop measurements intact.

ProtoPeek's network workbench answers four different questions without blending their evidence:

1. What did the system resolver return for this target?
2. Which source, interface, and next hop did this ProtoPeek process's kernel select?
3. Which routers or endpoints answered a bounded set of active path probes?
4. Which selected TCP services answered inside one explicitly authorized private IPv4 scope?

The resulting topology is a local evidence notebook. It is not a claim that ProtoPeek discovered
the physical network, a VLAN design, device ownership, or the only route packets can take.

## Fast path

Start the local console:

```sh
pp
```

The everyday defaults avoid unnecessary typing:

- A new gRPC target starts at `localhost:50051`.
- A new HTTP request starts at `http://localhost:8080/`.
- HTTP accepts scheme-less shorthand only for exact loopback hosts: `localhost`, `127.0.0.1`, and `[::1]`. For example, `localhost:8080/health` becomes `http://localhost:8080/health`. A non-loopback host must include `http://` or `https://` so ProtoPeek never guesses or silently downgrades its transport.
- HTTP history shows the newest 12 entries first, including total observed time. Auth values and request bodies are not retained in automatic history. Loading an entry resets settings that were not deliberately persisted.
- JSON formatting is optional. Invalid JSON is labeled and can still be sent verbatim when that is the intended test.

Open **Network Path** to trace one hostname or IP. Loading the page checks local capabilities but
does not send a path probe. Review the visible plan, confirm authorization, and start the trace.

Open **Local network** to inspect private-interface suggestions. Loading suggestions also sends no
probe. Choose or enter an explicit private IPv4 CIDR, choose a named TCP profile, review the exact
host/port/attempt count, confirm authorization, and start the scan.

## Read the evidence in order

| Evidence | What it means | What it does not mean |
|---|---|---|
| DNS answers | Bounded answers returned by this process's system resolver and the one numeric address pinned for the operation | The recursive resolver or cache that ultimately produced every answer |
| Kernel route | One route selected for the pinned address from the ProtoPeek process perspective | A future packet's guaranteed path, proxy path, VPN path, or every ECMP choice |
| Hop replies | ICMP error evidence caused by bounded active probes at a given TTL | The latency of the link between two adjacent hops |
| Silent hop | No matching reply arrived before that probe's timeout | Proof that a router or the destination is down |
| Multiple responders | More than one address answered probes at the same TTL | Proof of a stable physical branch or a complete load-balancer topology |
| Saved trace placeholder | A silent TTL or unconfirmed pinned destination represented so the logical trace stays readable; its provenance is `inferred` | An observed router, endpoint, physical segment, or proof that forwarding stopped |
| Local service evidence | A selected TCP port answered from the ProtoPeek process; profile-declared application ports may add bounded gRPC reflection and non-following HTTP `HEAD /` evidence | Operating system, hardware model, ownership, VLAN, physical cable, whole-device availability, or application evidence on a TCP-connect-only port |
| Manual annotation | A label, tag, note, group, or position entered by the user | An automatically observed fact |

Keep the provenance badge with the value when sharing evidence. ProtoPeek distinguishes
`observed`, `inferred`, `manual`, and `unknown` records rather than making every label look equally
certain.

## Network Path

### What one trace does

`GET /api/path/capabilities` reports the running platform's native methods and fixed limits. It is a
no-probe endpoint. `POST /api/path/trace` is same-origin and CSRF-protected and performs one active,
bounded observation:

1. Validate the target and explicit consent.
2. Resolve the hostname once through the system resolver, retain at most eight unique answers, and
   pin one numeric address for the rest of the operation.
3. Ask the kernel for its selected route to that pinned address.
4. Run one native path backend with the reviewed hop, probe, timeout, and wall limits.
5. Preserve every bounded sample, including timeouts, ICMP type/code, multiple responders, partial
   termination, and cancellation.

Public targets require both active-probe consent and public-target consent. Path traces share a
small two-operation process admission budget, so saturation returns an explicit error instead of
queuing hidden work.

### Linux backend

Linux uses a built-in unprivileged UDP backend. It opens a UDP socket, enables the kernel's IPv4 or
IPv6 asynchronous error queue, and reads matching ICMP evidence there. It does not shell out to
`traceroute`, `tracepath`, Nmap, or another executable, and it does not request root.

The backend keeps one stable UDP five-tuple where possible so load balancing is less likely to turn
probe-port changes into an artificial route change. The default destination port is `33434`.
ICMP-only and TCP path methods are not implemented in this slice.

Active hop probing is currently unsupported on Darwin because ProtoPeek does not yet
have a verified unprivileged native backend for that platform. The capability panel explains the
boundary; ProtoPeek does not offer a package-manager button or request administrator access. The
read-only kernel next-hop lookup remains a separate cross-platform feature.

### Fixed trace limits

| Limit | Default | Maximum |
|---|---:|---:|
| Destination text | — | 253 UTF-8 bytes |
| Retained DNS answers | — | 8 unique addresses |
| Hops | 24 | 32 |
| Probes per hop | 3 | 4 |
| Total probes | 72 | 96 |
| Timeout per probe | 750 ms | 2,000 ms; minimum 100 ms |
| Whole trace | 20 s | 30 s; minimum 1 s |
| Accepted returned total duration | Selected wall + 2 s | Resolver-sized return allowance; not extra probe time |
| Probe rate | — | 20 probes/s |

The normal default plan is therefore 24 hops × 3 probes, not an open-ended traceroute. The client
accepts returned `durationMs` only up to the echoed `wallTimeoutMs + 2,000 ms`, allowing the bounded
resolver deadline and local response work to unwind. It does not reinterpret those two seconds as
another active-probe budget or as network latency.

### RTT is from this machine

Every displayed hop RTT is the elapsed round trip from the ProtoPeek process to that responder.
It is cumulative source-to-responder timing. Subtracting the RTT of hop 5 from hop 6 does not
produce trustworthy link latency: queues, return paths, control-plane prioritization, rate limits,
and load balancing can differ between samples.

ProtoPeek summarizes source RTT independently for each responder at a TTL with minimum, median, and
maximum values. It does not blend multiple ECMP responders into one hop statistic. The destination
median is shown only when the trace reached the target and reply samples came from the exact numeric
address pinned after resolution; a last responding router is never substituted for the destination.
A timeout stays a timeout. It is never converted into zero latency, an offline label, or an invented
route segment.

When a trace is saved, every actual responder becomes `observed` evidence. A TTL with no responder
becomes an `inferred` silent-hop placeholder. If the exact pinned destination did not answer, the
separate destination placeholder is also `inferred`. Every saved TTL-adjacency edge is inferred
logical sequence, including the final edge to that placeholder; none is observed cabling. A reply
from the exact pinned address remains an observed destination.

### DNS, regions, and datacenters

A literal IP is recorded as literal input. A hostname records bounded system-resolver answers and
the pinned address. The ordinary system resolver API does not reveal which local cache or upstream
recursive resolver supplied each answer, so ProtoPeek says that directly.

Short codes need context. `SIN`, `BOM`, and `IAD` can be useful metro or airport aliases;
`us-east-1` is an AWS provider-region identifier. None of those strings proves a datacenter,
provider, or current physical location by itself. ProtoPeek does not bundle a GeoIP database. Add
region or provider context as manual or explicitly sourced evidence, and retain that provenance.

Scoped IPv6 source and responder identities such as `fe80::1%eth0` can be retained in a saved path.
The interface zone is bounded to 1–64 portable characters, starts with a letter or digit, and may
otherwise contain letters, digits, `_`, `.`, or `-`. Empty zones, repeated `%`, whitespace, path
characters, malformed IPv6, and XML 1.0-invalid controls are rejected instead of entering storage.

## Local network discovery

### Authorization and scope

`GET /api/network/capabilities` reads private interface metadata and returns suggested scopes. It
does not probe the network. At most 32 deduplicated suggestions are returned. Both the configured
interface prefix and its suggestion must be wholly inside one RFC 1918 block; invalid or partly
public prefixes are omitted, not rewritten. A valid broad interface is narrowed to the containing
`/24` suggestion.

`POST /api/network/discover` is same-origin and CSRF-protected. It accepts only:

- an explicit RFC 1918 private IPv4 CIDR;
- a prefix of `/24` or narrower;
- one exact built-in TCP profile; and
- explicit authorization for that plan.

Loopback, public, multicast, IPv6, a bare address without a prefix, and a scope broader than `/24`
are rejected. For `/30` and broader host subnets, the traditional network and broadcast addresses
are skipped; `/31` and `/32` retain every address.

### Exact profiles

Every capability profile exposes its full `ports` list and an ordered-subset
`applicationProbePorts` list. This split is part of the authorization preview.

| Profile | All selected TCP ports | `applicationProbePorts` | TCP connect only |
|---|---|---|---|
| Quick services | `80, 443, 50051, 8080` | `80, 443, 50051, 8080` | None |
| gRPC common | `443, 6565, 7000, 7443, 9090, 50051` | `443, 6565, 7000, 7443, 9090, 50051` | None |
| Web and API | `80, 443, 3000, 4000, 5000, 8000, 8080, 8443` | `80, 443, 3000, 4000, 5000, 8000, 8080, 8443` | None |
| Expanded services | `22, 53, 80, 443, 445, 631, 1883, 3000, 3306, 3389, 5432, 6379, 8000, 8080, 8443, 9090, 9100, 50051` | `80, 443, 3000, 8000, 8080, 8443, 9090, 50051` | `22, 53, 445, 631, 1883, 3306, 3389, 5432, 6379, 9100` |

An application-probe port may receive the existing bounded gRPC reflection attempt plus an HTTP
`HEAD /` attempt with redirects disabled. Every other selected port receives one TCP connect and
close only—no gRPC reflection and no HTTP request. In particular, raw and legacy service ports in
the Expanded profile do not inherit application probing merely because they are selected.

The expanded profile is still not a full port scan. The fixed process limits are 18 ports, 4,572
TCP attempts, 32 workers, a 15-second wall, and one active local-network discovery at a time. A
full `/24` uses 254 host candidates: 1,016 attempts for Quick services and 4,572 for Expanded
services.

`attemptsCompleted` means selected endpoint probe calls returned to the ProtoPeek process, including
a call that returned because its context was cancelled. It does not count open ports, successful
connections, or targets reached. Planned calls that were never dispatched after cancellation do
not become completed attempts.

The result retains only positive selected-TCP evidence. An address absent from the result was not
observed on those ports before the operation ended; it is not declared offline. A 64 KiB aggregate
verbose-evidence budget covers retained protocol names, reflection state, service names, HTTP
fields, and evidence notes. Reaching it can omit additional verbose detail, but every observed open
TCP port still retains its port/state record and the result says evidence was truncated.

Each open port reports `probeDurationMs`. For a TCP-connect-only port this is the full elapsed TCP
connect attempt. For an application port it covers the complete bounded probe, including the TCP,
gRPC, and HTTP work that ran. It is process-observed wall duration—not network latency, one-way
delay, a clean RTT, or server-processing time—and timings from the two probe classes should not be
treated as equivalent latency measurements. Device-role suggestions are low-confidence inferences
from observed ports and protocols and remain editable.

ProtoPeek does not infer operating system, hardware type, ownership, physical links, or VLAN
membership. VLAN and subnet groups can be added manually when the user has authoritative context.

## Save, tag, and map

A discovery or path result can become a named network workspace with editable labels, tags, notes,
groups, and positions. A saved snapshot embeds a complete, deep-copied view of its nodes, edges, and
groups. Later workspace edits do not mutate that historical snapshot.

When a later observation is appended to the same path or private scope, ProtoPeek matches observed
nodes by stable identity and preserves saved manual labels, tags, notes, device type, pinned
positions, group assignments, manual groups, manually sourced services, and manual relationships.
Fresh observed evidence can update the current view without rewriting the earlier snapshot or
silently erasing operator context.

Map edits are session state until explicitly saved. A visible dirty state guards workspace
switching, import, new path or scan saves, snapshot restore, deletion, browser unload, and navigation
out of the network workbench. The user can save or deliberately discard; an asynchronous save also
detects newer concurrent edits and leaves those newer edits marked unsaved.

The topology canvas is an infinite drafting surface for arranging logical evidence. Observed paths
are represented as TTL adjacency, not asserted physical links. A branch at one TTL represents the
responders seen in the sampled probes, not a promise that the route is stable or exhaustive. The
interactive map remains available through 160 nodes, 640 logical relationships, and 64 groups. If
any count is larger, ProtoPeek disables the interactive map to stay responsive and shows the
complete node, group, and relationship inventory in independent 100-record pages; no record is
dropped. The list view also keeps the same evidence useful on narrow screens without relying on the
visual map.

Keep different questions in different groups when that improves legibility—for example, a user
defined `Office`, `Lab`, or `VLAN 20` group. A group name is manual organization unless separate
evidence establishes it.

Restoring history is deliberately two-step: **Use as current map** first arms a confirmation, then
**Confirm restore** replaces the editable current map. The immutable snapshot timeline remains
available. Dirty edits must be saved or deliberately discarded before restore.

## Local storage and exchange formats

The canonical lossless format is `protopeek-network` JSON version 1. Import validates the whole
document before use and caps one serialized workspace or import file at 4 MiB. The model also has
explicit collection and string limits; unsupported fields or versions are rejected rather than
silently reinterpreted.

Browser persistence uses IndexedDB with these fixed application limits:

- at most 20 workspaces;
- at most 4 MiB serialized per workspace; and
- at most 32 MiB serialized across all workspaces.

ProtoPeek refuses a new workspace when a limit is reached; it never silently evicts older evidence.
Restore walks an IndexedDB cursor only through the 20-record application bound and detects an
additional record as overflow; it never performs an unbounded bulk restore. Invalid or overflow
records trigger a visible quarantined/session-only state while usable bounded records remain in the
current session. IndexedDB unavailable, denied, or over-quota states likewise tell the user to
export before leaving the page.

Persistent writes and deletes compare the exact previously loaded workspace inside one IndexedDB
transaction. If another tab changed it first, ProtoPeek reports a conflict and overwrites nothing.
If a persistent delete fails, the workspace stays visibly listed so it cannot appear deleted and
then silently return after reload. A session-only store also refuses to hide a workspace whose
persistent copy cannot be removed.

| Format | Direction | Contract |
|---|---|---|
| `protopeek-network` JSON v1 | Import and export | Canonical, bounded, lossless ProtoPeek workspace including identities, services, provenance, groups, positions, and immutable snapshots |
| GraphML | Import and export | Portable logical graph; lossy by design |
| CSV inventory | Export | Flat node/identity/port/service inventory for spreadsheets; not a round-trip topology format |

GraphML export omits node identities, ports, services, original evidence provenance, and immutable
snapshots. ProtoPeek tags, notes, and grouping metadata use custom GraphML keys that other tools may
discard. GraphML import cannot recover ProtoPeek protocol evidence or snapshots and marks imported
records as `graphml-import`. Import accepts exactly one flat graph with `edgedefault="directed"`.
It rejects undirected or mixed edges, nested graphs, hyperedges, node ports or edge port references,
duplicate node/group/edge/key/data identifiers or data keys, unsupported topology structures,
DOCTYPE/entities, malformed XML, and XML 1.0-invalid control characters rather than guessing at
their meaning. Unsupported third-party data keys can be ignored with a loss notice. The UI must
disclose those losses before a user treats GraphML as a backup.

## Nmap remains optional external evidence

ProtoPeek accepts bounded XML previously produced by `nmap -oX`. Existing XML import works
without Nmap installed and never executes an imported command. The stable v0.5.0 workflow is
offline import. Current source also includes the explicit installed-tool workflow below.

Imported Nmap service and device labels are untrusted hints. A literal open TCP endpoint must be
verified through ProtoPeek's bounded scanner before opening gRPC or HTTP. A future optional path
from Nmap XML into a network workspace can preserve that provenance, but it must not turn file
import into hidden command execution.

### Installed Nmap in current source

Open **Network → Nmap** (or search for Nmap). ProtoPeek checks PATH and, on Windows, the standard
Program Files Nmap directories. It does not install Nmap or Npcap. Missing-engine guidance links to
the official download and the built-in port scanner. The availability check never starts a scan.

Enter a literal IPv4/IPv6 address or an RFC 1918 IPv4 `/24`-or-smaller subnet and selected TCP ports.
The preview shows the canonical subnet, address count and host-port count before authorization.
Nmap's `-Pn` visits every address in the selected CIDR, including network/broadcast endpoints.
Limits are 1,024 distinct ports, 4,096 host-port pairs, 32 parallel connections, 15 seconds per host
and 30 seconds for the command. Broad subnets can return partial evidence; narrow the scope when
that happens. DNS hostnames, arbitrary flags and scripts are not accepted.

**TCP connect** uses `-sT -Pn -n --unprivileged`. **Light service detection** additionally sends
application probes through `-sV --version-light`; it can return unknown or uncertain service labels.
Both modes use ordinary TCP sockets and do not require raw capture privileges. The executed
argument list remains available with the result. Nmap's service database guesses are marked
separately from probed service evidence. An open port alone does not identify its application.

Cancel or navigating away aborts the request and terminates its process. XML is capped at 8 MiB
and stderr at 16 KiB. Only complete host elements can be shown after an interrupted command;
an absent host is not proof it is offline. Search and 50-row pagination keep large results usable.
**Inspect service** prepares the selected endpoint for explicit protocol verification.

Target and port preferences are bounded browser-local drafts. Scans never resume automatically;
results remain in memory until cleared or exported as JSON. No packet capture, firewall changes,
OS fingerprinting, vulnerability scripts or hidden follow-up scans are included in this adapter.

## Now, soon, and later

### Shipped in v0.4.0

- Refined gRPC and HTTP loopback defaults, strict remote URL schemes, optional JSON formatting, and clearer secret-safe HTTP history.
- Linux-native unprivileged UDP path tracing with separate DNS, kernel route, per-TTL sample, per-responder source RTT, inferred silent/destination placeholders, inferred trace edges, scoped-IPv6 validation, and a returned-duration bound of the selected wall plus 2 seconds.
- Explicit public-target consent, fixed trace budgets, cancellation, silent-hop preservation, and multiple responders at one TTL.
- Authorized RFC 1918 IPv4 `/24`-or-smaller selected-TCP discovery with at most 32 wholly-private interface suggestions, exact per-profile `applicationProbePorts` allowed bounded reflection plus non-following `HEAD /`, all other ports connect-only, a 64 KiB verbose-detail budget, returned-call attempt counts, and full-probe duration without latency claims.
- Versioned network workspaces, immutable snapshots, two-step current-map restore, manual-field preservation, unsaved-edit and stale-tab guards, a 160-node/640-relationship/64-group logical map with complete paged fallback, cursor-bounded IndexedDB persistence, canonical JSON, strict disclosed-loss GraphML, and CSV inventory.

### Soon — deepen evidence without pretending certainty

- A verified unprivileged native active-hop backend for Darwin.
- Source-labelled passive enrichment and user-editable region/provider evidence; aliases remain suggestions, not automatic datacenter claims.
- Snapshot comparison that shows added, removed, and changed observed evidence without calling an unobserved host offline.
- Better topology grouping and manual subnet/VLAN documentation without scan-derived VLAN claims.

### Later — optional integrations after safety and size review

- Optional Nmap XML-to-workspace mapping with explicit import provenance and loss reporting; no bundled Nmap execution in the core binary.
- Additional path methods such as native TCP or ICMP only when they have reliable unprivileged implementations and the same consent/cancellation contract.
- Geographic base maps only if their download, privacy, offline behavior, and binary/bundle cost remain explicit; the logical canvas stays the dependable local view.
- Passive capture only after privilege, secret-redaction, lifecycle, and teardown boundaries are designed and tested.

See [Route, path, discovery, and Nmap evidence boundaries](/route-and-nmap-evidence/) for the lower
level API and trust contracts, and [the feature roadmap](/feature-roadmap/) for the wider protocol
direction.

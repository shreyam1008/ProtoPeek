# Route and Nmap evidence boundary

ProtoPeek v0.3.0 ships two evidence inputs with deliberately different trust models. The
route workbench reads the local kernel. The Nmap path imports a file produced elsewhere. Neither is
a general network scanner.

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

## Permanently gated distinctions

- **Bundled Nmap execution:** not planned for the core binary because executable discovery,
  argument construction, platform packaging, and scan scope widen the operational boundary. Any
  future companion would require an explicit executable choice, previewed scope, hard budgets, and
  an auditable command; offline XML import does not imply that design exists.
- **Traceroute/hop probes:** gated because they send packets and can require platform privilege.
  Release requires consent, strict budgets, reliable unprivileged backends, cancellation, and
  truthful partial failures.
- **LAN range expansion:** gated because one target must not become ambient crawling. Release
  requires previewed private scope, opt-in, hard candidate/time limits, and cancellation.
- **Live capture:** gated because it can require privilege and expose secrets. Release requires an
  explicit lifecycle, redaction/export policy, and dependable cross-platform teardown.

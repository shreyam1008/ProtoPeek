# This Device evidence and connection-quality boundary

Status: **available under Network in current source after v0.5.0; not part of the published v0.5.0 release**.

**This Device** is ProtoPeek's device-centred Network workspace. Its canonical `/this-pc` route and
`/api/this-pc/*` endpoints retain their technical names for compatibility. The broader **Network**
workspace starts with a target and asks how this ProtoPeek process can reach it. This Device starts
with the machine running ProtoPeek and answers four narrower questions:

1. What local system and interface evidence can this process observe without sending a packet?
2. Which local listeners and current connections can the operating system expose to it?
3. Which public IPv4 or IPv6 address and BGP-origin network do named providers observe?
4. What bounded browser-to-Cloudflare connection quality is measured during one explicit run?

The page is an evidence workspace, not a health score. Mounting it reads only local identity,
capability, and interface data. It does not inspect processes, contact an external provider, start a
benchmark, poll in the background, elevate privileges, or persist the returned evidence.

## Read the evidence spine

The page keeps four perspectives visibly separate:

| Stage | Evidence | What it does not prove |
|---|---|---|
| Device | Hostname, operating system, architecture, and logical CPUs visible to this ProtoPeek process | Physical-machine identity, ownership, serial number, username, or host evidence outside a container |
| Interfaces | Local addresses, prefix, flags, MTU, and available operating-system counters | A unique physical link, Wi-Fi identity, Internet reachability, or exact traffic after VPN/bridge/container double counting |
| Exposure | Local socket tables and best-effort same-user process attribution | Firewall permission, router/NAT state, public reachability, application safety, or who initiated an established connection |
| Internet | Public address, provider-reported BGP origin, and bounded Cloudflare measurements | A verified retail ISP, geography, line-rate maximum, packet loss, or performance to every destination |

Local snapshot, activity, traffic-sample, and public-identity results are timestamped and labelled
`process-network-namespace`. The benchmark remains a separately labelled browser-path result. A
containerized run describes the container's network namespace where the operating system presents
one; it does not silently claim to describe the physical host.

## Local overview

`GET /api/this-pc/capabilities` reports platform support and fixed limits. It performs no process
enumeration and no external request.

`GET /api/this-pc/snapshot` returns the bounded local snapshot used on first render:

- hostname, operating system, architecture, and logical CPU count;
- interface index, name, MTU, flags, and normalized IPv4/IPv6 addresses;
- address scope such as loopback, link-local, private, public, or unspecified;
- interface counters only where the platform backend has a reviewed implementation.

MAC addresses, usernames, home paths, serial numbers, Wi-Fi SSIDs, DNS search domains, command
lines, executable paths, working directories, and environments are not part of the v1 schema.
Unsigned 64-bit counters are encoded as decimal strings so JavaScript cannot silently round them.

## Local listeners and current connections

The user must choose **Inspect local activity** and acknowledge the local inspection before
`POST /api/this-pc/activity` runs. It sends no network packet. The result separates listeners from
current connections and labels each bind as:

- `loopback-only`;
- `interface-bound`;
- `all-interfaces`; or
- `unknown`.

`0.0.0.0` and `::` mean that a socket accepts connections on applicable local interfaces. They do
not mean that a firewall, router, carrier-grade NAT, or public route allows an Internet connection.
ProtoPeek therefore says **local listener**, never **Internet-open port**.
A local listener is not proof that the port is reachable from the Internet.

The Linux v1 backend reads the running process namespace's TCP/UDP socket tables and performs
best-effort same-effective-user attribution through socket inode references. It reads only PID and
the bounded process `comm` name. Access restrictions remain visible as partial evidence rather than
becoming an empty success.

One operation is limited to 4,096 sockets, 512 processes, 16,384 file descriptors, and a two-second
wall. It never requests root. macOS and Windows report listeners, connections, and process
attribution as unavailable until reviewed native backends exist; ProtoPeek does not fall back to
`lsof`, `netstat`, PowerShell, or another executable.

## One-shot interface load

`POST /api/this-pc/traffic/sample` compares two local interface-counter snapshots over exactly
500, 1,000, or 2,000 milliseconds. It does not keep a monitor running. Counter rollback, interface
removal, and unavailable counters remain warnings; they never become negative or invented rates.

The displayed receive/transmit rate is aggregate interface activity during that interval. It is not
per-process bandwidth, and adding traffic from physical, VPN, bridge, container, and loopback
interfaces can count one packet more than once. Accurate per-process bytes remain a later
privileged-helper problem: eBPF on Linux, ETW on Windows, and an entitled Network Extension on
macOS.

## Public identity

Public IP cannot be derived reliably behind NAT without an external observer. The user must choose
**Check public identity** and acknowledge the provider disclosure before
`POST /api/this-pc/public` runs.

The v1 adapter contacts only fixed provider endpoints:

- `api.ipify.org` for an IPv4 observation;
- `api6.ipify.org` for an IPv6 observation; and
- Team Cymru's fixed IP-to-ASN DNS service for best-effort BGP-origin enrichment after an address
  has been observed.

IPv4 and IPv6 are independent. An unavailable IPv6 request means only that the public IPv6 path to
that provider was unavailable for this observation; it does not prove that IPv6 is disabled. The
IP response is size-bounded, parsed as one address of the requested family, and never follows a
redirect, uses a proxy, sends cookies or credentials, or accepts a caller-supplied provider URL.

Team Cymru data is labelled **provider-reported BGP origin network**, not **verified ISP** and not
GeoIP. A prefix may be multi-origin or belong to a transit, hosting, enterprise, VPN, or carrier
network rather than the retail provider on a bill. The configured DNS resolver can observe that
lookup. Origin lookup failure preserves the public-IP result and adds a warning.

ProtoPeek does not persist the hostname, public addresses, process/PID evidence, socket table,
remote endpoints, origin result, or benchmark result in browser storage.

## Bounded Cloudflare connection-quality run

The benchmark is a browser-only, route-lazy use of the official MIT-licensed
`@cloudflare/speedtest` engine. Constructing the page does not load or start it. The user sees the
provider, exact selected measurement plan, maximum synthetic payload, upload choice, and privacy
copy before starting.

This is the one part of the page observed from the browser rather than the Go process. A container,
browser proxy, VPN, or deliberately remote browser can make the browser's network path differ from
the ProtoPeek process's interfaces and public address. The UI labels that perspective instead of
silently combining the two.

Both plans are deliberately smaller than the package default. Quick is selected first; Standard is
an explicit higher-data choice for faster connections.

| Profile | Unloaded latency | Download plan | Optional upload plan | Maximum payload | UI wall |
|---|---:|---|---|---:|---:|
| Quick | 5 requests | 100 KB × 2, 1 MB × 2, 5 MB × 1 | 100 KB × 1, 1 MB × 1 | 7.2 MB download-only; 8.3 MB with upload | 20 s |
| Standard | 10 requests | 1 MB × 2, 10 MB × 2, 25 MB × 1 | 1 MB × 2, 5 MB × 2 | 47 MB download-only; 59 MB with upload | 45 s |

One run is allowed at a time, every plan stays below a hard 64 MB configured-body cap, and neither
plan contains a packet-loss measurement. The displayed body budget excludes HTTP/TLS overhead and
zero-byte unloaded/loaded-latency probes. Upload remains separately disabled by default. When even
the largest selected download is too brief for a stable sample, ProtoPeek reports low confidence
instead of inflating the estimate.

The library exposes pause rather than a hard abort. ProtoPeek's stop action therefore prevents
later measurements after the current bounded item; it does not claim that an already in-flight
request vanished. Closing the result does not create a hidden scheduled test.

Cloudflare receives the public address and synthetic traffic and can retain ordinary service logs
under its own policy. The upstream engine normally uses a dedicated final-results endpoint and its
official documentation says completed results are collected for aggregate connection-quality
insights. ProtoPeek explicitly sets both engine logging endpoints to `null`, so it does not request
that separate per-measurement or final-results submission. ProtoPeek does not add the collected
hostname, interface addresses, listener/process evidence, files, or request history to the
measurement payload. The browser can still send ordinary HTTP metadata such as `Origin` or
`Referer` under its own policy; that metadata can identify the local ProtoPeek web origin.

Results are labelled **single-flow HTTPS connection quality to Cloudflare edge**. Throughput is not
the ISP plan maximum. Jitter is the engine's observed variation between latency samples. Packet
loss, a universal quality score, and destination-independent performance are not reported.

## Platform capability matrix

| Capability | Linux v1 | macOS v1 | Windows v1 |
|---|---|---|---|
| Identity and interface addresses | Available | Available | Available |
| Public IPv4/IPv6 and BGP-origin lookup | Explicit external action | Explicit external action | Explicit external action |
| Bounded Cloudflare quality run | Explicit browser action | Explicit browser action | Explicit browser action |
| Interface counters and one-shot load | `/proc/net/dev` | Unavailable | Unavailable |
| Local listeners and connections | `/proc/net/{tcp,tcp6,udp,udp6}` | Unavailable | Unavailable |
| Same-user PID/process attribution | Best effort | Unavailable | Unavailable |
| Elevation or shell fallback | Never | Never | Never |

Phase 2 can add Windows IP Helper tables and native interface counters, plus Darwin interface
counters, only after the same capability, permission, truncation, and cross-build tests pass.
macOS process ownership remains outside the stable contract until a durable public native API is
verified.

## Deliberate next slices

1. **Native platform parity:** add reviewed Windows IP Helper and Darwin interface/socket adapters
   without shelling out, then prove each on its operating system before changing capability copy.
2. **Short-window load view:** add an explicitly started, visibly timed interface sampler with Stop
   and a fixed memory/point budget. It can graph aggregate deltas but must still avoid a
   per-process-byte claim.
3. **Route hand-off:** link one selected local/public address into the existing Network route and
   path tools rather than duplicating gateway, DNS, or hop logic inside This Device.
4. **Optional ownership helper:** consider eBPF, ETW, or a macOS Network Extension only as a
   separately installed, permissioned component with preview, teardown, and redaction contracts.
   The core binary remains useful without it.
5. **Evidence export:** add a versioned, user-triggered JSON report with explicit redaction choices;
   never auto-export hostnames, private/public addresses, PIDs, process names, or remote endpoints.

An external reachability check, router/firewall verdict, or automatic port scan is not a later mode
of the local-listener table. If added elsewhere, it needs its own observer, target authorization,
request budget, and result label.

## Permanent non-goals for this slice

- no public port scanner or external reachability claim;
- no firewall/router security verdict;
- no packet capture, payload inspection, browser history, or DNS history;
- no command-line, environment, credential, Wi-Fi-secret, or file collection;
- no per-process byte estimate from socket counts;
- no automatic reverse DNS;
- no city/geolocation;
- no scheduled/background benchmark or hidden polling;
- no Ookla bundling or automatic licence acceptance;
- no single green/red network-health score.

## Verification contract

Backend tests must prove that construction, capabilities, and the initial snapshot perform no
external request; local enumeration and provider responses remain bounded; malformed socket and
counter evidence degrades safely; permissions produce partial attribution; public observations
require acknowledgement and fixed providers; one address-family failure retains the other; and
remote-browser mode never exposes machine/process APIs. Linux, Darwin, and Windows builds must keep
their explicit capability truth.

Frontend tests must prove that first render calls only local GET endpoints; every activity,
identity, and benchmark operation requires a visible action and disclosure; upload is off by
default; the maximum data amount is visible; no sensitive result reaches localStorage or
IndexedDB; unsupported/restricted states remain useful; and the route remains keyboard-accessible,
dark/light compatible, responsive, and within its independent bundle budgets.

## Primary references

- [Go network interfaces](https://pkg.go.dev/net#Interfaces) and
  [hostname](https://pkg.go.dev/os#Hostname) for the portable local baseline.
- [Linux interface statistics](https://www.kernel.org/doc/html/latest/networking/statistics.html)
  for native counter semantics.
- [Linux `/proc/net/tcp` documentation](https://www.kernel.org/doc/html/v5.17/networking/proc_net_tcp.html)
  for the procfs evidence boundary and the kernel's recommendation to prefer socket diagnostics
  for future native depth.
- [ipify API documentation](https://www.ipify.org/) for independent IPv4 and IPv6 reflectors.
- [Team Cymru IP-to-ASN mapping](https://www.team-cymru.com/ip-asn-mapping) for the BGP-origin
  evidence and its non-GeoIP boundary.
- [Cloudflare's official speed-test engine](https://github.com/cloudflare/speedtest) for endpoint,
  measurement, logging, loaded-latency, pause, and packet-loss contracts.
- [Windows `GetExtendedTcpTable`](https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable),
  [`GetExtendedUdpTable`](https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedudptable),
  and [`GetIfTable2`](https://learn.microsoft.com/en-us/windows-hardware/drivers/network/getiftable2)
  for the planned native Windows backend.

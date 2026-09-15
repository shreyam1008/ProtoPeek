# Local transfer (current source)

Open **Files → Local transfer** on both devices. Give each device a recognizable
name, choose its receive folder, and select **Enable local transfer**. The session
lasts one hour; **Stop sharing** ends it immediately and cancels unfinished jobs.
The workbench controls require a direct loopback browser connection.

1. Select the receiving device under **Choose a device**.
2. Compare its full fingerprint with the receiver's **Connection details**. Names
   and discovery announcements are self-reported, not authenticated identities.
3. Choose up to 32 files, then send. The receiver accepts or declines each file.
4. Watch progress and average speed. Completed sends include a SHA-256 match
   against the receiver's streamed digest. Incoming files show their saved path.

Files stream directly over TLS 1.3 without staging the whole file in memory or
using the Downloader/aria2 engine. There is no bandwidth throttle. The network,
VPN route, encryption, and storage determine throughput; unlimited speed is not
possible. Four transfers may be active, and the session retains 64 recent jobs.

## LAN discovery and private networks

Nearby discovery uses IPv4 multicast `224.0.0.168:53318`; transfers use TCP 53318.
Allow those ports for ProtoPeek on the intended network if the firewall blocks
them. Guest Wi-Fi isolation and multicast filtering can prevent discovery.
ProtoPeek discovers participating transfer devices, not people or every LAN host.

For a VPN or discovery failure, open the receiver's **Connection details** and
copy a reachable `IP:port#fingerprint` connection. Paste it into **Connect by
address / VPN** on the sender. IPv6 uses `[address]:53318#fingerprint`.
Installed Tailscale devices are available under **Network → Tailscale**.

Both devices need this ProtoPeek implementation. Existing Tailscale or WireGuard
routes can carry it, subject to their firewall and access policy. Multicast usually
does not cross those routes. ProtoPeek does not set up a VPN, punch through NAT,
or provide a relay. This is independent of Tailscale Taildrop and is not a
LocalSend-compatible client. LocalSend's [protocol](https://github.com/localsend/protocol)
informed the discovery → offer → streaming flow; the implementation is native Go.

## Storage, cancellation, and identity

The receiver accepts metadata before any file is saved. A single-use random token
authorizes that file's upload; unsolicited uploads are refused. Offers expire in
two minutes. TLS certificates are temporary and change when sharing restarts;
sender connections pin the selected fingerprint and reject changed certificates.

Files are written to private temporary files inside the chosen folder, flushed,
and published without overwriting an existing file. Collisions receive a suffix.
On filesystems without hard-link support, the file goes into a newly reserved
`ProtoPeek-…` subfolder. Paths are confined to the receive directory. Incomplete
and cancelled files are removed; already completed files remain. Interrupted
transfers restart from the beginning; resuming partial files is not implemented.
Closing the sending view cancels its sends. A receiving session remains enabled
until stopped or expired; keep its view open to answer incoming offers.

This is current-source functionality, not a claim about an existing public release.
Real two-device LAN discovery and VPN throughput still depend on the actual
interfaces, firewalls, and route and should be tested on each deployment.

## Development verification

The transport tests use real TLS listeners and real files on the test OS. They
cover accepted and empty files, collisions, rejection, cancellation and cleanup,
certificate pinning, invalid tokens, path validation, and restart. CI runs these
on Windows, Linux, and macOS, plus the Go race detector on Linux.

A single 64 MiB loopback benchmark on the development Windows machine measured
261.85 MB/s with approximately 1.03 MB allocated during the operation (the source
buffer was allocated before timing). This is local test evidence, not a LAN/VPN
speed promise. Run `go test ./internal/localshare -run '^$' -bench
BenchmarkStreamingTransfer -benchtime=1x` to measure your machine.

The frontend adds a route-lazy 11.6 KB JS / 4.5 KB CSS slice, without new package
dependencies or increased startup bundle ceilings. Dedicated feature caps and a
small aggregate allowance keep future growth visible.

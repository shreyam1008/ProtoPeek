# Optional tools and services with Extensions

**Current source:** Extensions groups setup for five supported tools in one place. It replaces
the Publish destination in the six-part layout: Home, Inspect, Network, Extensions, Files and
Settings. Stable v0.6.1 retains its earlier layout; this guide describes source changes, not a new
stable release or package publication.

## Start with what you need

Open **Extensions** at `/extensions`. Each card explains what the tool adds, shows local detection
evidence, and offers setup details and **Open workbench**. **Refresh** checks the local executable
locations again. Detection does not start a process, scan, capture, sign-in flow, or service.

Setup applies to the **machine running ProtoPeek**, which may differ from the machine displaying
your browser. A remote server or container needs its own accessible tools. Guidance uses the host
operating system and points to official installation instructions.

| Group | Tool | What it enables | Existing workbench |
| --- | --- | --- | --- |
| Optional services | Tailscale | Installed-client peers, accounts, connection diagnostics, reviewed local controls and Taildrop | `/network/tailnet` |
| Optional services | Cloudflare Tunnel | Local `cloudflared` service, configuration and route evidence, with guarded service controls | `/tunnels` |
| Network tools | Wireshark capture | A bounded live capture through the installed `dumpcap` executable | `/network/packets?mode=live` |
| Network tools | Nmap | Bounded TCP connect or light service detection with explicit scope | `/network/nmap` |
| Transfers | aria2 | The local engine used by resumable HTTP(S) downloads | `/downloader` |

All existing workbench links remain valid. Choosing a card does not install a package or begin
the tool's active work. Installation is performed separately through the vendor's installer or
the host's package manager. Return to Extensions and refresh after setup.

## Read the status accurately

| Status | Meaning |
| --- | --- |
| Detected | An executable was found in a supported location. It has not been run by this check. |
| Included | This build supplies the tool as a fallback; another installation may take priority. |
| Not found | No executable was found in the checked locations. Review the host's setup instructions. |
| Unavailable | Detection could not be completed on this host. Read the reported reason. |

**Detected does not mean ready.** Tailscale can still need sign-in, a service can be stopped, and
dumpcap can lack capture permission. Open the relevant workbench for its actual capabilities and
observations. Installation detection and operational evidence remain separate.

## Tailscale and Cloudflare Tunnel

Install Tailscale using its [official download page](https://tailscale.com/download) and the
[Windows](https://tailscale.com/docs/install/windows), [macOS](https://tailscale.com/docs/install/mac),
or [Linux](https://tailscale.com/docs/install/linux) instructions. Complete sign-in through the
installed Tailscale client, then open its ProtoPeek workbench and choose **Inspect Tailscale**.
ProtoPeek uses the installed client; it does not provide the private-network service itself.

Use Cloudflare's [cloudflared downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
for the tunnel connector. Its ProtoPeek workbench inspects the local host and canonical service;
it does not create an account, sign in, install the connector, or apply a tunnel configuration.
See the [Cloudflare Tunnel guide](cloudflare-tunnels.md) for supported controls and configuration
authority. Wrangler and Docker availability are diagnostic details, not additional working adapters.

## Capture setup

Install [Wireshark](https://www.wireshark.org/download.html), which supplies the
[dumpcap capture utility](https://www.wireshark.org/docs/man-pages/dumpcap.html). ProtoPeek uses
dumpcap for bounded local captures; Wireshark remains useful for deeper analysis of original files.

- **Windows:** live capture needs [Npcap](https://npcap.com/#download). The
  [Wireshark installer includes Npcap setup](https://www.wireshark.org/docs/wsug_html_chunked/ChBuildInstallWinInstall.html).
  Capture access can still depend on the driver's permission settings.
- **macOS:** follow Wireshark's [ChmodBPF installation instructions](https://www.wireshark.org/docs/wsug_html_chunked/ChBuildInstallOSXInstall.html)
  for capture access, and make dumpcap accessible to the ProtoPeek host.
- **Linux:** use the distribution's Wireshark packages and the official
  [capture permission guidance](https://wiki.wireshark.org/CaptureSetup/CapturePrivileges).

ProtoPeek does not install drivers or change capture permissions. After setup, open the capture
workbench to inspect available interfaces. An explicit **Start capture** action begins a bounded
run. It observes traffic visible to the selected interface, not every packet on the network.
Live capture acceptance still depends on the host's driver and permission setup.

## Nmap and aria2

Use the [official Nmap download and installation guide](https://nmap.org/download.html), then open
its workbench and review the target and ports. ProtoPeek supports bounded TCP connect and light
service detection. These modes use ordinary TCP sockets; executable detection does not run a scan.
See [Nmap scope and evidence limits](network-workbench.md#installed-nmap-in-current-source).

The Downloader uses [aria2](https://aria2.github.io/). Official downloads are linked from the
[aria2 release page](https://github.com/aria2/aria2/releases/latest). The engine can be configured,
found on PATH, or supplied as a fallback by the build. Check the card and Downloader's engine
details before installing another copy. Detection does not start the engine or queue a transfer.

## What stays in the core

HTTP and gRPC inspection, this-device evidence, Nearby devices, built-in TCP port checks,
supported native hop tracing, saved network maps and bounded capture-file reading work without
these optional tools. Opening a PCAP/PCAPNG file stays under **Network → Packets** and does not
require Wireshark, dumpcap or Npcap.

Headscale administration, NetBird, Tailscale Serve/Funnel, integrated sign-in and automatic tool
installation remain outside this catalog. Existing [AI agent setup](ai-agents.md) remains under
Settings; it does not require a new extension download.

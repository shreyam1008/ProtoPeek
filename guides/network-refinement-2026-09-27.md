# Network workflow refinement — September 27, 2026

## Source state at the September 27 review

This is a working-tree refinement based on `3a89fd3eeda61d8045fdd19d83742859ab7ac6b6`.
This records the review before publication. Existing Slack/agent integration work was preserved.
At that point no commit, push, CI run, installer publication, or store submission had been performed.

## What changed

- **Network opens on Nearby devices.** An available private interface is selected automatically.
  The operating system's neighbor cache and this device appear immediately in a map or list.
  Changing interfaces is a selector; custom CIDR and exact probe settings are advanced controls.
- **Evidence has a source.** Cached neighbors, bounded mDNS service advertisements, and observed
  TCP services stay distinct. Advertisements can suggest a printer or media receiver; they do
  not prove a device's model or an open port. Cache entries can outlive a connected device.
- **Device actions continue the task.** Nearby and saved-map devices link to prepared port scans
  and traffic filters. A detected TCP port can continue to packet inspection. Nothing starts
  merely because a device or link is selected.
- **Packet reports are easier to read.** Protocol filters, conversation summaries, directional
  counts, relative timing, and packet details work on bounded capture files. Local live capture
  discovers available interfaces and reports actual setup requirements and visibility limits.
- **One website target carries through the tools.** Bare domains default to HTTPS. Response/TLS,
  standard paths, historical names, port scans, and hop tracing reuse the target. Returning from
  a trace preserves a matching website's explicit scheme and port.
- **Maps show measured evidence.** Logical hop order, source-to-responder RTT, missing replies,
  multiple responders, and optional approximate IP locations remain separate. Saved maps retain
  dated attribution and its provenance through JSON export/import.
- **Recovery is explicit.** Capability failures can be retried; cancellation discards late
  responses; changing targets does not silently reuse unrelated results. Malformed imported
  IPv6 identities cannot become inspection links.

The workflow takes inspiration from Shoal's [interface selection][shoal-interface],
[observation model][shoal-model], and [service classification][shoal-services]. It keeps
ProtoPeek's bounded, request-driven operation rather than introducing background probe renewal.

## Browser observations on Windows

These are time-specific observations from the standalone host in the Codex browser, not fixtures
presented as live data:

| Journey | Observed result |
| --- | --- |
| Open Nearby devices | Ethernet selected automatically; this device and one cached neighbor appeared without entering a CIDR. |
| Explicit local scan | Returned a bounded partial scan and no advertised mDNS services on this host; it did not invent device types. |
| Device → ports | Target was prepared without a scan. A requested loopback scan found the review server port open and an unused port closed. |
| Port → packets | Host and port carried to the capture filter. Missing dumpcap disabled Start and showed setup guidance. |
| Packet file | The repository's generated fixture produced 75 packets: 25 DNS, 25 HTTP, 25 TLS. DNS filtering and individual packet details worked. This was generated data, not captured LAN traffic. |
| Website response | `shreyam1008.com.np` normalized to HTTPS and returned HTTP/2 200, TLS 1.3, real DNS addresses, timings, and the advertised Cloudflare server header. |
| Historical names | Provider returned 20 retained historical names. Candidate hosts were not probed automatically. |
| Standard paths | Five HEAD responses returned; the missing-path control also returned 200, correctly triggering the fallback-page explanation. |
| Trace → maps | Native Windows IPv6 ICMP reached the target in two hop slots through Cloudflare WARP, then saved a three-node evidence map. |
| Optional locations | Provider labelled one responder Delhi and another San Francisco. The 11–12 ms RTTs were kept separate; copy explains CDN/VPN/anycast registration-location limits. |
| Other destinations | Home, Inspect, Publish, Files, and Settings loaded without starting publishing or transfer operations. |

## Performance and organization

Inventory, logical maps, geographic outlines, packet reports, selected-device actions, and socket
tables have their own lazy modules. No frontend dependency or background poller was added.
Geography uses simplified offline Natural Earth outlines, with attribution retained in source.

The existing startup and base-view bundle ceilings remain unchanged. Installed-suite ceilings
now account for the added evidence features: 1,176 KiB raw / 394 KiB gzip JavaScript and 358 KiB
raw / 72 KiB gzip CSS. This is an explicit feature allocation, not a claim that installed bytes
are unchanged. New individual limits and complete-network, packet, and device aggregates prevent
moving code between lazy chunks from hiding growth. Gzip checks use the pinned Bun 1.3.10 runtime.

## Verification boundaries

Final local results:

| Check | Result |
| --- | --- |
| Bun 1.3.10 frozen dependency install | Passed; dependencies unchanged. |
| Full frontend suite | 853 tests across 97 files passed. |
| Typecheck, lint, formatting | Passed; lint reports 64 warnings and zero errors. |
| Production console, site, prerender, bundle budgets | Passed with pinned Bun 1.3.10. |
| Windows Go suite | All 22 tested packages passed, including a final run with rebuilt embedded assets. |
| Go vet, staticcheck, ineffassign, predeclared | Passed with repository-pinned tools; changed Go files are gofmt-clean. |
| Browser widths | 1280 and 480 CSS pixels inspected. At narrow widths inventory opens as a list; map remains available. No page-wide horizontal overflow observed. |
| Saved map continuation | A saved IPv6 destination opened the correctly populated port draft without starting a scan. |

Final installed assets measure 1,196,400 raw / 399,022 gzip JavaScript bytes and 363,834 raw /
72,655 gzip CSS bytes. Initial JavaScript is 326,938 raw / 109,453 gzip bytes. The final Windows
review binary SHA-256 is `4098BEDE842606E15B84BF16BC398A619D283EAC6AE5674BC2A21BDB28620BBC`.

The full frontend suite, types, lint, formatting, Go suite, vet, staticcheck, ineffassign, and
predeclared are part of this pass. Windows native integration exercised interfaces/counters,
loopback TCP/UDP listeners and process ownership, and IPv4/IPv6 ICMP loopback tracing. Production
console/site assets and an embedded standalone Windows binary are built from the refined source.
Detailed command output is retained in the repository's ignored `.tmp` directory.

Linux/amd64 and macOS/arm64 full builds and ten relevant package test binaries compile. Native
execution on those platforms remains unverified: WSL and Docker are absent and the configured
remote Linux host did not connect. Run the same suite and platform integration checks on actual
Linux/macOS hosts before claiming those native behaviors verified.

Live capture still needs a working dumpcap/Npcap installation and appropriate permissions; that
setup is absent here. The actual mDNS query path ran, but no responder advertised a service in
this environment. Real responder interoperability still needs a host with an mDNS service.
The desktop native webview was not automated; browser results are not proof of native UI parity.

No tool can guarantee a complete LAN census, every subdomain, visible traffic from every device,
or the physical towers/cables and return path taken by packets. The UI now makes those limits
part of the relevant evidence, while allowing the available checks to proceed directly.

[shoal-interface]: https://github.com/BT10011/shoal/blob/b79b4e2c90b044e62f57a1475de6f66fefabe08b/internal/netif/netif.go
[shoal-model]: https://github.com/BT10011/shoal/blob/b79b4e2c90b044e62f57a1475de6f66fefabe08b/internal/model/model.go
[shoal-services]: https://github.com/BT10011/shoal/blob/b79b4e2c90b044e62f57a1475de6f66fefabe08b/internal/probe/av/av.go

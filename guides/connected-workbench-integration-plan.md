# Connected Workbench integration plan

**Status:** authoritative v0.7 implementation contract

**Date:** 2026-09-03

This document defines the next implementation boundary after the v0.6 product reset. It is a
delivery contract, not a release announcement. `AGENTS.md`, current source, and the repository's
release metadata remain authoritative when they expose a narrower capability than this plan.

## Status language

- **Stable release** means behavior present in the published v0.5.0 line. Never move a
  current-source statement into historical release copy without release evidence.
- **Current source** means real behavior in this repository after v0.5.0. It is not automatically a
  shipped claim.
- **Next** means work admitted to v0.7 only.
- **Planned** means sequenced after v0.7 but not implemented.
- **Gated** means no implementation or marketing claim until its named safety, maintenance, and
  demand questions are resolved.

The six permanent destinations remain Home, Inspect, Network, Publish, Files, and Settings.
Existing routes and deep links remain compatibility paths.

Current-source checkpoint on 2026-09-03: the versioned broker and the listener-to-draft vertical
slice described in phases 1 and 2 are implemented as unreleased candidates. Windows native socket
activity and interface counters are also implemented in current source. v0.7 is not complete or
shipped: phases 3 and 4, real-host cross-platform QA, and the combined exit gates remain open.

## Layer map

| Layer | Current source truth | v0.7 next | Planned or gated |
| --- | --- | --- | --- |
| **Path** | Network and next-hop are stable feature families. Passive kernel-selected next-hop evidence works on Windows, Linux, and macOS. Bounded native active-hop tracing is Linux-only and uses unprivileged UDP. A trace can be saved explicitly as a logical topology workspace and immutable history. Current source can consume a typed next-hop draft without resolving or probing it. | Move remaining eligible producers onto the broker and record an operation receipt only after an explicit lookup or trace. | Native unprivileged Windows and macOS active-hop backends are planned capability work, not v0.7 shell work. A trace observes outbound TTL responders and source-to-responder RTT; it cannot discover the return route. A geographic base map remains gated on size, privacy, offline behavior, network requests, and provenance. |
| **This Device + local discovery** | The safe host/interface snapshot works across supported operating systems. Linux and Windows provide explicit, bounded socket activity and interface-counter samples. Windows reads native TCP4, TCP6, UDP4, and UDP6 owner-PID tables and native interface counters; process basenames are best-effort and permission-sensitive. Current source can turn an eligible fresh, unscoped TCP listener into unsent HTTP, gRPC, next-hop, and Publish-origin drafts. Local discovery scans one authorized RFC 1918 IPv4 `/24`-or-smaller plan with fixed profiles and positive evidence only. Existing Nmap support is strict offline XML import followed by explicit bounded verification. | Finish phase-wide regression, bundle, and real-host QA for the listener slice. Complete producer-specific provenance coverage for eligible verified-discovery paths while preserving namespace, bind, exposure, freshness, and source caveats. | macOS socket ownership and counter sampling remain a visible capability gap; unavailable remains a valid result. Firewall observation is absent. Bounded PCAP import is exploratory and live capture is gated. ProtoPeek does not locate, install, or execute Nmap. |
| **Files** | Downloader is a stable feature backed by an explicitly started external aria2c process. It supports bounded HTTP(S) jobs, batching, pause/resume/retry/cancel, continuation, segmented transfer, optional SHA-256 evidence, and private queue recovery. Browser state refresh is manual or follows a mutation. | Keep the existing transfer engine and limits. Add bounded, redacted operation receipts and finish workflow polish inside the shared shell; do not add a second queue abstraction. | Torrent and magnet inputs are not supported. They require a separate admission, privacy, metadata, lifecycle, cleanup, and threat-model decision; do not enable them merely because aria2c can. Taildrop is a separate later decision. |
| **Publish** | A real current-source Cloudflare UI exists at `/tunnels`. It observes local cloudflared/service/config/ingress evidence, performs explicit release checks, guards canonical service start/stop/restart with re-observation and verification, and creates browser-only route drafts. The unreleased v0.7 slice can consume `LocalServiceRef` to prefill only the origin of a non-executing route draft. It is not a Cloudflare account console and is not a v0.5.0 shipped claim. | Finish regression and cross-platform QA of the typed local-origin draft. Keep hostname and audience selection explicit, and preserve observed-ingress-to-Inspect handoffs through the broker. | YAML/config mutation, account APIs, credentials, Quick Tunnel, logs/metrics, automatic install/update, and the shared audience-first publishing flow remain gated or planned. Generic reverse-proxy administration is not admitted by v0.7. |
| **Private Access** | No Tailscale, Headscale-backed client, NetBird, or TailScout runtime code, route, parser, fixture, or command adapter exists. Documentation and site tests correctly describe them as planned. | Add no provider. Reuse only the typed target/service/handoff boundary needed by current features so a later peer is a producer, not a new shell architecture. | v0.8 starts with one concrete installed-CLI `internal/tailscale` adapter and manual read-only evidence. Headscale is a control-server choice for that client. NetBird waits until real duplication proves a small common interface. Hosted admin/control-plane APIs remain out of scope. |
| **Inspect** | gRPC and HTTP are stable feature families; Security is current-source. The unreleased v0.7 slice replaces the two ad hoc pending keys with a versioned typed broker and one-time legacy reads. HTTP and gRPC consume a draft, visibly show its source, and wait for the user to send or connect. The HTTP relay preserves protocol-native response evidence. | Complete producer-specific provenance coverage for public-site and verified-discovery paths, then add bounded sanitized recents without flattening protocol evidence. | A generic forward-proxy manager is not part of v0.7. Proxy-native debugging requires a separate evidence and safety contract. |

## Truth boundaries that UI and copy must preserve

1. A hop RTT includes travel to a responder and a reply, but the displayed hop sequence is not a
   measured return path. ProtoPeek must never promise "there and back" routing.
2. The current map is a browser-local logical evidence canvas. TTL adjacency is inferred, local
   groups are organizational, and neither is physical cabling, observed VLAN membership, or a
   geographic router location.
3. Linux and Windows expose listener, connection-owner, and sampled interface-counter evidence only
   after an explicit local action. Windows process labels use limited query rights and can be absent
   or access-restricted; UDP rows show bound endpoints, not proof that an application receives
   datagrams. macOS still reports the socket and counter capabilities as unsupported. The shared UI
   does not substitute sample data or an OS-specific page.
4. A scoped IPv6 address such as `fe80::1234%12` preserves a process-visible zone identity, not a
   reachability guarantee. The current v1 contract can retain it in unsent gRPC-target and next-hop
   drafts, but only next-hop parsing is proven end to end; a gRPC consumer must still validate
   transport support. Browser HTTP URL and Publish-origin drafts exclude it because those consumers
   cannot represent the scoped host truthfully. Link-local IPv6 listener evidence without a zone is
   ineligible for every handoff; Linux procfs does not identify the required interface and ProtoPeek
   never guesses one.
5. A bound or wildcard listener does not prove firewall allowance, NAT, routing, LAN reachability,
   or Internet reachability. No firewall reader or controller exists.
6. Nmap XML is untrusted offline evidence. Only a subsequent ProtoPeek verification may produce a
   protocol handoff; importing XML never runs Nmap and does not currently add a topology snapshot.
7. Downloader accepts absolute HTTP(S) URLs without URL user information. Torrent and magnet are
   rejected, not hidden capabilities.
8. Cloudflare's current UI is real local-host observation, guarded canonical-service control, and
   non-executing route drafting. It does not mutate YAML or connect to a Cloudflare account.
9. ProtoPeek has no product-level proxy configuration today. The ordinary HTTP relay clones Go's
   default transport and can therefore inherit host environment-proxy behavior; protected public
   observation paths deliberately disable proxies and pin approved addresses. Route/path evidence
   must not be presented as the path of a proxied request. Before any proxy UX is admitted, the
   chosen direct/proxy path and its authority must become explicit evidence.

## Typed integration contract

Only common endpoint identity and provenance cross domain boundaries. HTTP request details, gRPC
schema/TLS options, path samples, Cloudflare ingress fields, and future provider-native facts stay
inside their owning domains.

```ts
type HandoffProvenance = {
  source: string;
  quality: 'observed' | 'inferred' | 'manual';
  observedAt: string;
  path?: string;
  evidenceIds?: string[];
};

type TargetRef =
  | { kind: 'http-url'; url: string }
  | { kind: 'grpc-target'; address: string; plaintext: boolean }
  | { kind: 'next-hop-target'; target: string };

type LocalServiceRef = {
  kind: 'local-service';
  perspective: 'process-network-namespace';
  network: 'tcp';
  bind: { address: string; wildcard: boolean };
  exposure: 'loopback-only' | 'interface-bound' | 'all-interfaces' | 'unknown';
  protocol: 'http' | 'https' | 'h2c' | 'grpc' | 'grpcs' | 'tcp';
  host: string;
  port: number;
};

type HandoffEnvelopeV1 = {
  version: 1;
  id: string;
  createdAt: string;
  expiresAt: string;
  provenance: HandoffProvenance;
  draft:
    | { kind: 'http-url-draft'; target: Extract<TargetRef, { kind: 'http-url' }> }
    | { kind: 'grpc-target-draft'; target: Extract<TargetRef, { kind: 'grpc-target' }> }
    | {
        kind: 'next-hop-target-draft';
        target: Extract<TargetRef, { kind: 'next-hop-target' }>;
      }
    | { kind: 'publish-origin-draft'; origin: LocalServiceRef };
};
```

### Validation and derivation

- Validate at both production and consumption. An envelope is at most 8 KiB encoded, carries one
  bounded provenance record and at most eight evidence IDs, uses a host of at most 253 characters,
  and uses ports in `1..65535`. Reject unknown versions, draft kinds, fields, malformed targets,
  non-finite numbers, overlong values, expired envelopes, and trailing data.
- Enforce evidence freshness centrally for every v1 draft: `observedAt` may be no more than five
  minutes before `createdAt` and no more than 30 seconds after it. This is separate from the
  envelope's own expiry and applies even when a producer forgets a domain-local stale check.
- Never include headers, cookies, authorization material, URL user information, request bodies,
  cloud credentials, or local credential paths. Automatic HTTP producers strip query and fragment
  unless a domain-specific reviewed contract later requires them.
- Raw Nmap hints cannot directly become an Inspect handoff. Preserve `nmap-import` provenance, but
  require a successful bounded scan observation in the chain.
- Only TCP listeners are eligible for listener handoffs. Eligible unscoped listeners may produce
  HTTP, gRPC, route, and `LocalServiceRef`/Publish drafts. UDP listeners do not produce protocol or
  publishing drafts merely from a port number.
- Preserve a scoped IPv6 host in unsent gRPC-target and next-hop drafts. Reject it for HTTP URL and
  `LocalServiceRef`/Publish-origin drafts; do not erase the zone, substitute `localhost`, claim gRPC
  transport compatibility before it is tested, or turn rejection into a reachability claim.
- Reject link-local IPv6 listener evidence that lacks a zone for every draft kind. The observation
  does not contain an actionable endpoint identity, so never infer an interface scope.
- Preserve wildcard state. A wildcard bind may derive `localhost:<port>` only as an explicitly
  labelled inferred local-origin draft. It does not produce a wildcard route lookup or a LAN/public
  reachability claim.
- `TargetRef` is endpoint identity, not proof that a service is alive. Consumers retain their own
  validation, consent, and capability checks.

## Broker lifecycle and safety

- The protocol shell owns one typed broker for the lifetime of the tab. Keep exactly one pending
  envelope total; a newer accepted envelope supersedes the older one.
- A handoff expires five minutes after creation by default and may never live longer than 15
  minutes. Consumers discard expired or malformed data and never apply stale data.
- The central evidence-freshness check above is independent of envelope lifetime; extending a
  lifetime never makes old evidence fresh.
- `take(destination)` is consume-once: claim and remove the matching envelope before applying it.
  Clear it from memory and storage on success, rejection, expiry, or explicit cancellation.
- Use in-memory state as the live authority and `sessionStorage` only as a same-tab navigation/reload
  mirror. Do not use cross-session localStorage for new pending handoffs. Read each legacy
  `pendingGRPCTarget` or `pendingHTTPURL` value at most once for compatibility, validate it, then
  remove it.
- If `sessionStorage` is unavailable or full, keep the handoff in memory and disclose that it will
  not survive reload. Never send a handoff to a server or another tab as fallback. If neither the
  live broker nor destination can accept it, remain on the source view and report the failure.
- Broker events are notifications, not a second source of truth. Navigation may occur only after
  the live broker accepts the envelope.
- Consuming a handoff may populate and focus a draft. It must not resolve DNS, inspect sockets,
  probe, trace, connect gRPC, send HTTP, invoke an RPC, start a download, write a file, mutate tunnel
  configuration, control a service, contact a provider, copy to the clipboard, or start polling.
- The final action remains explicit in the destination and repeats any required private/public,
  active-probe, service-interruption, or exposure confirmation. Changing audience from private to
  public always requires a new confirmation.
- Pending handoffs and bounded sanitized recents are separate stores. A consumed envelope is not an
  operation receipt. Create a receipt only from a completed explicit operation, including truthful
  cancelled, partial, failed, and stale outcomes.

## Phased v0.7 delivery

Complete and verify each phase before beginning the next.

### Phase 1 - typed broker, behavior preserved (current-source candidate)

- Expand `web/src/console/app/handoff-types.ts` and add a small validated handoff store beside it.
- Replace dual-key/event authority in `ProtocolFrame.tsx` and `ProtocolShellContext.ts` while
  retaining one-time legacy reads from `shared/runtime.ts`.
- Migrate `HTTPWorkbench.tsx` and
  `features/grpc/workspace/useGrpcWorkbench.ts` without changing send/connect behavior.
- Update `app/release-capabilities.ts` so accepted and produced handoffs are mechanically checked.

Gate: existing discovery and observed Cloudflare ingress still open equivalent unsent drafts;
invalid, expired, superseded, storage-failed, and navigation cases have tests.

### Phase 2 - listener-to-draft vertical slice (current-source candidate)

- Add contextual actions to `features/network/this-device/SocketsPanel.tsx` through
  `ThisDeviceRoute.tsx`; do not put navigation or storage policy in the table row component.
- Consume route drafts in `RoutesWorkbench.tsx` without starting lookup.
- Let `features/publish/cloudflare/CloudflareRoute.tsx` pass a typed local origin into
  `console/tunnels/RoutePlanner.tsx`; leave hostname empty and preserve preview-only behavior.
- Cover exact, interface-bound, wildcard, TCP, UDP, unsupported-platform, and stale observations.

Gate: an eligible unscoped observed TCP listener can reach HTTP, gRPC, next-hop, and a non-executing
Publish draft without retyping its port, and none of those handoffs performs I/O.

### Phase 3 - connected current evidence and recents (next)

- Complete producer-specific provenance coverage for `DiscoveryScanner.tsx`, `NmapImportPanel.tsx`,
  current Cloudflare ingress, and public website evidence. Existing shell discovery and observed
  ingress already traverse the broker; preserve the Nmap re-verification gate and add no second
  bridge.
- Add bounded sanitized recent target/session state to the shell. A target becomes successful only
  after its owning domain reports success; failed attempts do not become trusted targets.
- Keep route-specific evidence and cancellation state in the owning feature rather than a global
  state library.

Gate: source, observation time, and inferred/manual status remain visible after navigation; failure,
cancellation, and stale state are truthful and recoverable.

### Phase 4 - bounded activity and workflow polish (next)

- Add one local receipt surface for explicit requests, scans, downloads, and canonical service
  actions. Bound count and encoded size, redact secrets before storage, and provide explicit clear.
- Polish Downloader and Cloudflare within the existing token/shell system. Add no component suite,
  state library, polling framework, or provider.
- Run desktop and narrow keyboard/focus/reduced-motion QA on Windows, Linux, and macOS capability
  states. Measure bundles and reclaim duplication; do not raise JavaScript or CSS budgets to pass.

Gate: all v0.7 exit criteria below pass together.

## v0.7 exit gates

- Existing routes, deep links, HTTP/gRPC behavior, network limits, transfer behavior, Cloudflare
  safety checks, and truthful unavailable states remain intact.
- Every cross-domain transition uses a validated v1 envelope and opens an unsent/non-executing
  draft. No pending handoff survives consumption or expiry.
- Listener-to-Inspect/route/Publish works without retyping and never upgrades wildcard evidence into
  a reachability claim.
- Cancellation, failure, partial evidence, storage failure, and stale state survive SPA navigation
  coherently and do not create trusted recents.
- No default background polling or ambient active network operation is introduced.
- The same navigation, wording, hierarchy, and confirmation flow is used on Windows, Linux, and
  macOS; only factual capability evidence differs.
- Unit and integration tests cover the broker, producers, consumers, no-automatic-action rule, and
  legacy migration. Full Go and web suites, formatting, type checks, and existing bundle budgets
  pass.
- Private Access remains visibly planned. No Tailscale, Headscale, NetBird, proxy-manager,
  firewall, capture, Nmap-execution, torrent, or public-exposure claim is added by v0.7.

## v0.8 handoff boundary

v0.8 may add a `tailscale-status` provenance source and make a real observed peer produce
`TargetRefV1`. It must not redesign the broker or put DERP, route, exit-node, profile, health, or
control-server facts into `TargetRef`.

The first provider implementation is a concrete `internal/tailscale` adapter around the installed
CLI on all three operating systems, with closed commands, bounded output/time/concurrency, fake
execution, and manual read-only refresh first. Do not begin with LocalAPI, a generic provider SDK,
hosted admin credentials, background polling, or controls. Peer HTTP/gRPC/route handoffs remain
draft-only and require the same explicit destination actions as local evidence.

TailScout migration pages, canonical Tailscale SEO, redirects, and retirement remain blocked until
the v0.8 cross-platform release and migration gates in
`protopeek-suite-strategy.md` and `private-network-integration-plan.md` pass.

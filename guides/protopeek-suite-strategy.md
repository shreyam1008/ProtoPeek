# ProtoPeek suite strategy

Status: product decision, selected redesign contract, and staged delivery plan. Current source
implements the v0.6 six-destination shell; the published v0.5.0 release retains its historical
six-area workbench. This document does not claim that the TailScout migration or any private-network
provider integration is shipped.

Last reviewed: 2026-09-03.

## Decision in one page

ProtoPeek should absorb TailScout's useful workflows and remain the one active local systems
product. It should **not** absorb every project.

The product promise is:

> **ProtoPeek is the lightweight local workbench for finding, reaching, inspecting, and safely
> exposing services.**

That promise is narrower and more useful than "all-in-one developer tools." It gives the current
HTTP, gRPC, local/network evidence, Cloudflare host operations, and bounded file transfer one shared
reason to exist. Planned Tailscale, Headscale-backed client, and NetBird workflows must earn their
place in the same journey before they ship. The promise also supplies a clear reason to reject
unrelated features.

The core journey is one connected loop:

```text
find a service -> understand how it is reached -> inspect its protocol
               -> share it with a chosen audience -> verify the result
```

The current product is already functionally broad, and current source now establishes the v0.6
product and code reset before another provider page. The remaining reset work should be completed
and verified before the next domain begins.

## Portfolio boundary

Keep a small portfolio with explicit ownership instead of one repository or brand containing
everything.

| Product | Decision | Owns | Does not move into ProtoPeek |
| --- | --- | --- | --- |
| **ProtoPeek** | Primary systems product | Service targets, HTTP/gRPC, network evidence, private access, service publishing, bounded artifact transfer | Database administration, document editing, general browser utilities, personal content |
| **TailScout** | Maintenance mode, then preserved predecessor | Existing releases and migration history until ProtoPeek reaches parity | GTK, WinUI, SwiftUI shells; a second long-term roadmap |
| **GoBarryGo** | Preserved predecessor | v0.0.9 releases, history, checksums, and migration evidence | New downloader development |
| **dbterm** | Separate flagship product | Database connections, queries, backups, retention, restore, database credentials | Generic host/network tooling |
| **Markpad** | Separate flagship product | Notes, documents, drafts, history, file editing and recovery | Network evidence or service operations |
| **Buggy** | Separate browser/PWA product and portfolio surface | Browser utilities and any public portfolio/catalog role | ProtoPeek runtime or source ownership |
| **Personal / Radhey work** | Completely separate | Its own identity, content, and audience | Any technical suite coupling |

Useful integrations can still exist without a merger:

- ProtoPeek can export a Markdown evidence report and offer **Open in Markpad**.
- dbterm can copy a database endpoint into ProtoPeek for route, TLS, or listener evidence.
- Buggy can showcase product stories and link to the canonical product sites.
- None of those handoffs require a shared runtime, repository, release, account, or design shell.

### Feature admission test

A proposed ProtoPeek feature belongs only when all five conditions hold:

1. It operates on a service, endpoint, network path, exposure, or directly related artifact.
2. It strengthens an existing journey or typed handoff.
3. It remains useful local-first without a required account or external database.
4. It can stay route-lazy, bounded, and quiet when the user does not ask it to work.
5. One maintainer can support a truthful Windows, Linux, and macOS story.

If a feature fails a check, the default is an integration link, a separate product, or rejection.
Provider popularity alone is not an admission reason.

## Why the reset comes before Tailscale

The pre-reset repository audit exposed several kinds of drift:

- Contributor, README, product-metadata, website, and roadmap language previously described the
  product at different scopes; the v0.6 reset keeps those contracts aligned without rewriting
  historical release claims.
- The pre-reset shell presented eight primary areas plus persistent Roadmap and Help destinations.
- Routes, navigation, dashboard tasks, command-palette actions, public feature pages, and roadmap
  status are separate hand-maintained catalogs.
- Several route components were too large for a one-person product: `App.tsx` was about 4,300 lines,
  `Tunnels.tsx` about 2,100, `ThisPC.tsx` about 1,750, and `NetworkWorkbench.tsx` about 1,000.
- The shared stylesheet is about 6,150 lines and contains several generations of route overrides;
  the current built shared CSS is about 144 kB before compression.
- At a 1280 x 720 viewport, the eight-item rail scrolled and could hide later destinations.
- The pre-reset visual language was coherent at the token level, but the experience alternated
  between a calm overview, dense card inventories, duplicated shell chrome, and IDE-like
  workbenches.

"Lightweight" must describe cognitive and maintenance weight as well as binary size. Adding a
Tailscale page to the present catalog would increase all three forms of drift.

## Product architecture

### One primary object: the target

The v0.6 suite should revolve around a selected **target**, not a collection of tools.

A target may originate as:

- a URL;
- a `host:port` pair;
- a local listener;
- a private-network peer or peer service;
- a published endpoint; or
- an imported piece of evidence that still requires explicit verification.

Selecting a target reveals only valid next actions. For example, a local TCP listener can open an
HTTP or gRPC draft, route evidence, or the Publish flow. In the planned private-access slice, a
Tailscale peer can open a provider-native ping, route evidence, HTTP, or gRPC. No handoff sends
traffic or changes state automatically.

### v0.6 current source: six permanent destinations

The released v0.5.0 shell still uses Overview, Protocols, Network, Downloader, Security, and
Settings. Current source after v0.5.0 implements the six-destination grouping below while retaining
the existing canonical and compatibility paths.

| Destination | Current-source responsibility | Retained current paths | Existing compatibility redirects | Planned later, not current source |
| --- | --- | --- | --- | --- |
| **Home** | Resume the current local task and enter bounded discovery from Overview | `/` | None | Cross-domain recent sessions and receipts are v0.7 work |
| **Inspect** | Preserve protocol-native gRPC, HTTP, public-web, and TLS evidence; Security is grouped here | `/protocols`, `/protocols/grpc`, `/protocols/http`, `/security` | `/grpc` -> `/protocols/grpc`; `/http` -> `/protocols/http` | Additional protocol adapters remain gated by native evidence and size review |
| **Network** | Explain how a service is reached; This Device, next hop, path, authorized discovery, map, and history are grouped here | `/network`, `/network/path`, `/network/local`, `/network/map`, `/network/history`, `/network/route`, `/this-pc` | `/routes` -> `/network/route` | Private Access, Tailscale, Headscale-backed clients, and NetBird |
| **Publish** | Keep the current `/tunnels` Cloudflare host observation, explicit release check, guarded canonical-service actions, and browser-only route drafts domain-native | `/tunnels` | None | The audience-first shared publishing flow, config/account mutation, Cloudflare Quick Tunnel, Tailscale Serve/Funnel, and NetBird Expose |
| **Files** | Acquire and verify related artifacts through Downloader | `/downloader` | `/downloads` -> `/downloader` | Taildrop remains a separate demand and security decision |
| **Settings** | Own appearance, local dependencies, host policy, About, and documentation; Roadmap remains command-accessible at its retained route | `/settings`, `/roadmap` | None | No provider setup surface is implied |

Roadmap and Help remain available from the command menu and an About/documentation surface. They
do not consume persistent navigation space.

These paths are exact for the current route tree. New destination labels do not authorize deleting,
repurposing, or silently changing an existing deep link. Help has no standalone current route; it
remains a command/About surface.

### Home is a command center, not a feature catalog

The first screen should answer three questions:

1. **What do I want to inspect?** One target field accepts a URL, `host:port`, listener, or peer.
2. **What is happening now?** Active scans, requests, downloads, and temporary publishing sessions
   appear in one bounded activity area.
3. **Where was I?** Recent targets and verified receipts resume the exact workspace.

The four visible starting outcomes are:

- **Inspect a service**
- **Reach a device**
- **Publish a local service**
- **Transfer an artifact**

These are entry points into one system, not independent marketing cards. Provider logos and
implementation names appear only after the user's goal is clear.

### Shared operation lifecycle

Mutations across the suite use one visible lifecycle:

```text
Observe -> Plan -> Confirm -> Re-observe -> Execute -> Verify -> Receipt
```

- **Observe** records the current host/provider state and its revision.
- **Plan** shows the intended audience, target, provider, and expected effect.
- **Confirm** is required when scope, public reachability, service state, or files change.
- **Re-observe** refuses stale actions rather than acting on old evidence.
- **Execute** uses a closed, typed operation; no raw shell or arbitrary argument list crosses from
  the browser.
- **Verify** checks the new provider state and the origin/endpoint independently.
- **Receipt** records bounded, redacted facts and a Stop or rollback path where one exists.

Reads stay explicit and on demand. The app does not add background polling merely to look alive.

## Code architecture reset

Keep one Go binary, one shared React interface, and route-lazy domains. Do not create microservices,
a monorepo, a generic plugin SDK, or separate OS user interfaces.

### One feature registry

Create one small static registry that owns:

- stable feature ID and display label;
- route and lazy component;
- top-level destination and order;
- command-menu keywords and actions;
- capability/availability source;
- documentation slug;
- release status; and
- optional handoffs accepted and produced.

The shell, Home shortcuts, command menu, capability view, and public feature index should derive
from that registry. Runtime behaviour and public claims must still be gated by the actual release
manifest; a planned feature never becomes a generated shipped claim.

### Domain boundaries

```text
app shell
  |- targets and recent activity
  |- capability registry
  |- operation receipts
  `- navigation / command menu

inspect
  |- grpc
  |- http
  `- public web / TLS evidence

network
  |- this device
  |- route and path
  |- authorized discovery and maps
  `- private access (planned after v0.7)

publish
  |- cloudflared local observation and guarded service control (current source)
  |- shared audience-first flow (planned)
  `- tailscale serve / funnel (planned)

files
  `- aria2 downloader
```

Share only concepts with proven cross-domain meaning:

- `TargetRef`
- `LocalServiceRef`
- `Capability`
- `Handoff`
- `OperationReceipt`

Do not force provider-native facts through a universal model. Tailscale DERP and NetBird ICE/relay
evidence are not interchangeable. Implement `internal/tailscale` concretely first. Extract a small
private-network interface only when NetBird produces real duplicated code.

### Refactor rules

- Split orchestration, data loading, derived state, and leaf views before changing behaviour.
- Prefer a focused hook plus small view components over one route component containing an entire
  domain.
- Treat 300-500 lines as a review signal, not an automatic rule; cohesion matters more than gaming
  a line count.
- Move duplicated formatters, state badges, confirmation shells, bounded tables, and empty states
  into shared components only after two real uses agree.
- Give each domain its own stylesheet or CSS layer while keeping palette, spacing, typography,
  focus, status, and density tokens shared.
- Keep tests beside the contract they protect; preserve the large existing regression suites while
  decomposing them by behaviour.
- Make every refactor checkpoint behaviour-preserving and independently releasable.

### Cross-platform contract

Windows, Linux, and macOS use the same navigation, information hierarchy, wording, states, and
confirmation flows. Differences are factual capabilities only:

- executable and service-manager discovery;
- file paths and permission/elevation guidance;
- browser-login behaviour;
- vendor commands exposed by the installed version; and
- platform-specific evidence that is genuinely unavailable elsewhere.

The backend reports `available`, `unavailable`, `permission required`, `unsupported`, `unknown`, or
`failed` with evidence. The frontend does not branch into OS-specific page designs. A missing tool
is a useful empty state with an official installation path, never sample data.

## Visual system brief

Preserve ProtoPeek's strongest existing assets:

- near-black/navy technical surfaces;
- teal signal accent (`#4fd1c5` in the current dark tokens);
- restrained yellow for warnings and coral/red for destructive state;
- clear monospace treatment for addresses, commands, payloads, and evidence; and
- route-lazy, task-specific workbenches that can become dense only after a target is active.

Change the hierarchy:

- use a labelled, compact six-item navigation rather than an icon rail full of product nouns;
- make the current target and active operation persistent but quiet;
- replace nested card grids with lists, split panes, and a consistent right-side evidence inspector;
- reserve high density for the active HTTP/gRPC/network workspace;
- keep Home and empty states calm, spacious, and action-led;
- use one radius scale, one border hierarchy, and fewer decorative glows; and
- keep status legible without relying on colour alone.

Every core control needs a visible focus state, keyboard path, descriptive label, minimum practical
touch target, reduced-motion behaviour, and narrow-layout equivalent. Platform consistency means
the same experience, not pretending every operating system offers the same capability.

## Connected workflows

These are connected journey contracts, not one capability claim. The existing HTTP, gRPC, network,
Downloader, This Device, Security, and Cloudflare host-operation steps keep their documented release
status. Any step involving a private peer, Tailscale, a Headscale-backed client, NetBird, shared
audience selection, or temporary exposure remains planned.

The exact v0.7 broker, evidence-freshness, endpoint-eligibility, and phased delivery contract is in
the [Connected Workbench integration plan](connected-workbench-integration-plan.md).

### Inspect a discovered service

```text
Home target field
  -> bounded discovery
  -> choose observed HTTP / gRPC / TCP evidence
  -> open an unsent protocol draft
  -> invoke explicitly
  -> save a local receipt
```

### Reach a private peer (planned)

```text
Network / Private Access
  -> inspect installed Tailscale client
  -> choose a peer and provider-native evidence
  -> optional bounded ping or route observation
  -> open an unsent HTTP / gRPC target
```

Headscale is an advanced custom-control-server choice for the installed Tailscale client, not a
second peer product. NetBird is a later, separate adapter and retains its own terminology.

### Publish a local service (planned shared flow)

```text
This Device listener or explicit loopback target
  -> choose audience: private / public temporary / public managed
  -> show compatible installed providers
  -> preview exact effect and lifecycle
  -> confirm
  -> start
  -> verify origin and exposed endpoint separately
  -> keep Stop visible
```

Planned audience mapping after the required providers and process lifecycle ship:

| Audience | First backend | Later backends |
| --- | --- | --- |
| Private network | Tailscale Serve | Equivalent provider-private options only after semantic review |
| Public internet, temporary | Cloudflare Quick Tunnel | Tailscale Funnel, NetBird Expose |
| Public internet, managed | Existing Cloudflare named-tunnel plan | Other providers only after credential, audit, and rollback review |

Changing from private to public always requires a new confirmation. Provider selection must never
silently weaken audience scope.

## Release roadmap

These are gated milestones, not date promises. Finish and verify one before opening the next.

### v0.6 — Product reset

Goal: make the current product coherent enough to receive another domain.

Scope:

1. Lock the product promise and six-destination information architecture.
2. Select and document one visual direction for desktop and narrow layouts.
3. Inventory loading, empty, ready, running, warning, failed, stale, unsupported, and permission
   states across every current route.
4. Introduce the feature registry and remove duplicate navigation/dashboard/command catalogs.
5. Split `App.tsx`, `Tunnels.tsx`, `ThisPC.tsx`, and `NetworkWorkbench.tsx` without changing their
   contracts.
6. Unify tokens, focus, status, empty states, operation banners, tables, drawers, and inspectors.
7. Place This Device under Network, Security under Inspect, and Tunnels under Publish while preserving
   old routes.
8. Align `AGENTS.md`, README, `product.json`, website language, screenshots, and release metadata.

Exit gate:

- all current routes and tests pass;
- the same shell and hierarchy render on Windows, Linux, and macOS;
- no new mandatory dependency, background request, or release claim is introduced;
- bundle/startup/idle-memory baselines are recorded; and
- a maintainer can add one registered feature without editing several catalogs.

### v0.7 — Connected workbench

Goal: make existing features feel like one product before adding a provider.

Current-source status: the versioned typed broker and listener-to-draft vertical slice are
implemented as unreleased candidates. Recent target/session state, receipts, remaining producer
migrations, and the combined v0.7 verification gates are not complete.

Scope:

1. Add `TargetRef`, `LocalServiceRef`, typed handoffs, and recent target/session state.
2. Connect This Device listeners to HTTP, gRPC, route evidence, and a non-executing Publish draft.
3. Connect discovery results and public website evidence to the appropriate Inspect workbench.
4. Add one bounded activity/receipt surface for requests, scans, downloads, and service actions.
5. Polish Downloader and Cloudflare workflows inside the selected design system.
6. Add no new network provider in this milestone.

Exit gate:

- a listener-to-protocol journey works without retyping a target;
- every handoff opens a draft and performs no automatic mutation;
- cancellation, failure, and stale state survive navigation; and
- desktop and narrow interaction QA is complete.

### v0.8 — TailScout absorbed

Goal: make installed Tailscale clients useful inside the connected workbench.

Scope:

1. Move TailScout status/profile fixtures and command-safety assertions into ProtoPeek Go tests.
2. Add a closed `internal/tailscale` process adapter with bounded output and fake execution.
3. Ship manual, read-only inspection first: device, identity, version, health, peers, direct/relay
   state, routes, exit-node capability, profiles, and observation time.
4. Add peer handoffs to HTTP, gRPC, route evidence, and bounded provider-native ping.
5. Add connect/disconnect, login/logout, profile switching, exit-node selection, netcheck, version,
   and redacted bug-report flows only through observe/confirm/re-observe/verify.
6. Add custom control-server login for Headscale-backed clients without promising unsupported
   Serve/Funnel behaviour.
7. Verify absent, disconnected, connected, malformed, partial, permission, timeout, and unknown
   states on all three operating systems.

Exit gate:

- one stable release provides the required local inspection and controls on Windows, Linux, and
  macOS;
- the UI does not fork by OS;
- no arbitrary command, vendor daemon, automatic installer, or cloud-admin credential is added;
  and
- TailScout remains available until the later retirement gate.

### v0.9 — Publish a service

Goal: turn listeners and private peers into verified, audience-aware service journeys.

Scope:

1. Ship the shared audience-first Publish flow.
2. Start with Tailscale Serve because its scope stays inside the tailnet.
3. Verify the local origin and private endpoint independently.
4. Add an owned foreground-session supervisor with bounded logs, shutdown cleanup, and a permanent
   visible Stop action.
5. Add Cloudflare Quick Tunnel as explicitly public and temporary after that supervisor is proven.
6. Add Tailscale Funnel only when installed-version, MagicDNS, HTTPS, policy, supported-port, and
   macOS-variant limitations can be explained before execution.
7. Continue named Cloudflare Tunnel work through its existing guarded plan.

Exit gate:

- a user can select a real listener, understand exactly who gains access, publish it, verify both
  ends, and stop everything ProtoPeek started;
- no orphan process remains after navigation or shutdown; and
- public scope is never an implicit side effect.

### v1.0 — Stabilize, migrate, and reduce

Goal: make the suite supportable as the primary product.

Scope:

1. Run real-host release, installer, upgrade, rollback, permission, and packaging QA on all three
   operating systems.
2. Complete onboarding, empty-state guidance, documentation, screenshots, and support boundaries.
3. Decide Taildrop explicitly: build a bounded secret-safe flow with reliable cleanup only if real
   demand justifies it; otherwise preserve a documented TailScout/CLI path.
4. Publish the Tailscale canonical page and TailScout migration mapping.
5. Observe the support window and indexing gates before permanent redirects or archival.
6. Remove obsolete duplicate code, plans, labels, and compatibility shims only after evidence says
   they are no longer needed.

Exit gate:

- two stable ProtoPeek releases or the documented support window have passed;
- Tailscale workflows meet the migration matrix on all three operating systems;
- old releases, tags, screenshots, checksums, and Git history remain accessible; and
- TailScout can become read-only without stranding a supported workflow.

### Post-1.0 — Earned expansion only

NetBird is the second private-network adapter only when demand exists and Tailscale has exposed the
real common boundary. Add read-only NetBird evidence before controls, preserve Management/Signal/
Relay/ICE/DNS terminology, and reuse the shared publishing supervisor before considering
`netbird expose`.

Keep Headscale server administration, hosted Tailscale admin APIs, NetBird management mutations,
PCAP/live capture, generic remote administration, protocol experiments, and a plugin SDK outside
the visible roadmap until their safety, maintenance, and user-demand gates are independently met.

## TailScout migration contract

This is a product consolidation, not a source or Git-history merge.

Move:

- tolerant status and profile fixtures;
- fixed CLI argument and injection tests;
- useful ordering and display fallbacks;
- verified connect/profile/exit-node/diagnostic workflows; and
- user-facing migration knowledge.

Do not move:

- GTK, WinUI, or SwiftUI page code;
- platform-specific navigation systems;
- a separate packaging pipeline after retirement;
- broad automatic refresh; or
- TailScout claims that no longer match the Tailscale ecosystem.

TailScout remains maintained until ProtoPeek has released parity, not merely a mockup or one
read-only page. Repository archival is optional and last; it never deletes history, tags, releases,
assets, issues, or attribution.

## SEO and public migration

### One active product identity

ProtoPeek should be the only active systems-workbench `SoftwareApplication` identity. TailScout and
GoBarryGo become predecessor names used in migration/history, not permanent competing product
brands. dbterm, Markpad, Buggy, and personal work keep their own sites and search intent.

Do not make "all-in-one" the primary phrase. It is vague and does not match a clear search task.
The homepage promise should be: **see how a local service is reached, exposed, and behaving.**

### Public URL ownership

Keep every established ProtoPeek URL stable:

- `/grpc-workbench/`
- `/http-workbench/`
- `/network-workbench/`
- `/this-pc/`
- `/cloudflare-tunnels/`
- `/downloader/`
- `/security/`

Add only when the corresponding content is real:

| URL | Publish gate | Search intent |
| --- | --- | --- |
| `/tailscale/` | Stable v0.8 capability on three OSes | Tailscale GUI and network diagnostics |
| `/migrate/tailscout/` | Migration mapping is complete | TailScout navigation and migration |
| `/migrate/gobarrygo/` | Current migration guide is rendered and verified | GoBarryGo migration |
| `/private-access/` | A second provider such as NetBird is shipped | Provider-neutral private access |
| `/headscale/` | Independently substantial shipped experience | Headscale-specific intent |
| `/netbird/` | NetBird integration is shipped | NetBird-specific intent |

Until NetBird ships, Headscale belongs as a section of `/tailscale/` and a provider-neutral
`/private-access/` page would duplicate intent.

Recommended `/tailscale/` metadata after release:

- Title: `Tailscale GUI & Network Diagnostics | ProtoPeek`
- H1: `Manage and verify Tailscale connections in ProtoPeek`
- Description: `Inspect Tailscale status, peers, routes, exit nodes and diagnostics, then open a
  peer in ProtoPeek's HTTP or gRPC workbench. Local-first on Linux, macOS and Windows.`

State clearly that ProtoPeek orchestrates an installed Tailscale client and is independent from
Tailscale. Do not claim that ProtoPeek replaces the client or control plane.

### Redirect map after the gates pass

```text
https://tailscout.shreyam1008.com.np/
  -> 301/308 https://protopeek.shreyam1008.com.np/tailscale/

https://tailscout.shreyam1008.com.np/index.html
  -> 301/308 https://protopeek.shreyam1008.com.np/tailscale/

https://gobarrygo.shreyam1008.com.np/
  -> 301/308 https://protopeek.shreyam1008.com.np/downloader/
```

Map useful old paths and historical assets one to one. Do not redirect many unrelated URLs to the
ProtoPeek homepage; irrelevant bulk redirects can behave like soft 404s.

### Migration sequence

1. Correct outdated TailScout copy and repository metadata, then export Search Console baselines
   for ProtoPeek, TailScout, and GoBarryGo.
2. Resolve the old GitHub Pages versus custom-domain canonical result for ProtoPeek before moving
   another indexed property.
3. Ship the ProtoPeek product/shell reset without changing established public URLs.
4. Release the Tailscale capability and complete the Taildrop decision.
5. Publish `/tailscale/` and `/migrate/tailscout/` as prerendered, self-canonical pages; update
   sitemap, internal links, product metadata, README, package copy, and real social imagery.
6. Confirm the new page is indexed and chosen as canonical. Verify installs, upgrades, rollback,
   and real-host behaviour.
7. Serve a human-readable, self-canonical TailScout compatibility page during the support window.
8. After two stable ProtoPeek releases or the documented support window, enable exact server/edge
   `301` or `308` redirects, submit the site move, and monitor indexing, soft 404s, and query traffic.
9. Keep redirects for at least one year and preferably indefinitely. Update important internal,
   profile, package, and external links to their final destinations.
10. Archive TailScout only after support routing, repository copy, releases, and issues are final.
11. Complete GoBarryGo's already-gated move with the same discipline.

Each destination is self-canonical, included once in the ProtoPeek sitemap, internally linked with
descriptive text, and prerendered. Redirects, canonical tags, and sitemap membership should agree.
Feature pages describe the one ProtoPeek application; they are `WebPage` or `TechArticle` records,
not separate software applications. Never advertise an unreleased capability in structured data.

Google's current site-move guidance recommends accurate URL mapping, permanent HTTP redirects,
self-canonical destinations, updated internal links, sitemap/Search Console monitoring, and
long-lived redirects:

- <https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes>
- <https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls>

TailScout must no longer market itself as filling the absence of any official Linux GUI. Tailscale
now documents a beta Linux system-tray client and a device web interface. ProtoPeek's defensible
value is the connected reachability, protocol inspection, publishing, and verification workflow:

- <https://tailscale.com/docs/features/client/linux-systray>
- <https://tailscale.com/docs/features/client/device-web-interface>

## One-maintainer operating rules

- Keep one active feature slice at a time.
- Finish the shell reset before Tailscale; finish Tailscale before NetBird.
- No bundled provider daemons or silent installers.
- No cloud-admin credentials until OS-backed secret storage, authority labels, audit, and rollback
  have their own design review.
- No default background polling.
- One capability/release source drives product claims and documentation.
- Record bundle, lazy-chunk, startup, idle-memory, and operation-concurrency budgets per release.
- Keep one cross-platform UI; test capability truth, not OS-themed visual forks.
- Delete a compatibility layer only after the migration gate, never merely because new code exists.
- Prefer one excellent end-to-end service journey over another logo or top-level route.

## Success measures

Product success:

- A new user can describe ProtoPeek after one screen: find, reach, inspect, and publish a service.
- A user reaches the right workspace from a listener, peer, or URL without retyping the target.
- A public action makes its audience and Stop path unmistakable.
- Missing dependencies and unsupported platform facts are understandable without fake data.

Maintenance success:

- Adding a feature no longer requires editing several independent catalogs.
- Oversized route components become small orchestration shells around testable domain pieces.
- Every mutation uses the shared lifecycle and produces bounded evidence.
- The initial bundle does not grow with route-lazy providers.
- Cross-platform differences live behind capabilities rather than separate React trees.

Migration success:

- ProtoPeek v0.8 or later covers the agreed TailScout workflows on all three operating systems.
- TailScout and GoBarryGo users have exact migration and rollback information.
- Search traffic moves to intent-matched ProtoPeek pages without premature duplicate pages.
- Source history, releases, checksums, screenshots, and attribution remain preserved.

## Non-goals

- A universal VPN client or replacement network data plane.
- A clone of Tailscale, Headscale, NetBird, or Cloudflare admin dashboards.
- An IDE, terminal, database client, Markdown editor, system cleaner, or generic remote-admin suite.
- One flattened provider model that discards native evidence.
- Automatic public exposure based on a detected listener.
- Automatic provider installation or silent privilege elevation.
- A plugin marketplace before multiple concrete adapters prove a stable extension boundary.

## Immediate checkpoint

The v0.6 reset is implemented in current source. The next checkpoint is intentionally narrow: finish
the remaining v0.7 producer migrations and bounded recents, then complete receipts, real-host
cross-platform QA, and the combined verification gates. Do not begin Tailscale code before that
checkpoint passes. The exact sequence is in the
[Connected Workbench integration plan](connected-workbench-integration-plan.md).

The detailed provider mechanics and retirement gates remain in
[Private networking inside ProtoPeek](private-network-integration-plan.md). The Cloudflare-specific
authority and lifecycle plan remains in
[Cloudflare Tunnel integration plan](cloudflare-tunnel-integration-plan.md). Downloader migration
history remains in [GoBarryGo consolidation](gobarrygo-consolidation.md).

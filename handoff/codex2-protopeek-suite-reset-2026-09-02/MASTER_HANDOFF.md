# ProtoPeek master handoff

This document is the complete context packet for continuing ProtoPeek in a fresh Codex CLI session.
It records what the user asked for, what was inspected, what was decided, what remains undecided,
what is already shipped, and what order protects the project from becoming an unmaintainable
all-in-one application.

## 1. The user's intent

The user is one developer and wants fewer active products to carry mentally. The recurring requests
were:

- clean the code before adding another major feature;
- keep Linux functionality working while improving Windows and macOS structure;
- put truly shared behavior in common code and keep factual OS differences behind small adapters;
- keep one visually consistent UI across operating systems;
- make the product feel like a polished desktop application, not a website or SaaS dashboard;
- learn from Markpad's compact chrome, themes, split panes, and calm density;
- use TanStack and other lightweight libraries intentionally;
- minimize duplication and unnecessary lines without turning line count into the objective;
- fold related service/network utilities into ProtoPeek so fewer applications need separate
  roadmaps, releases, sites, and support;
- preserve dbterm and Markpad as focused products rather than forcing everything into ProtoPeek;
- absorb TailScout's useful Tailscale workflows only after the core is clean;
- connect existing downloader/GoBarryGo, This PC, network, protocol, and Cloudflare work into one
  understandable journey;
- create a large, staged roadmap and finish each slice properly before moving on.

The concise product promise selected from those requirements is:

> **ProtoPeek is the lightweight local workbench for finding, reaching, inspecting, and safely
> exposing services.**

The core loop is:

```text
find a service
  -> understand how it is reached
  -> inspect its protocol
  -> share it with a chosen audience
  -> verify the result
```

This is narrower than “all-in-one developer tools.” That boundary is important.

## 2. Conversation and decision history

### TailScout cleanup

The work began with TailScout. Its Linux behavior was considered good, but the user wanted the
Linux, Windows, and macOS implementations cleaned up around one shared architecture and one
consistent interface. Platform-specific code should describe platform capabilities, not create
three different product experiences.

TailScout cleanup checkpoint `a7a6af2` is named in the private-network plan as the preserved source
baseline. Its useful assets are behavior contracts and fixtures, not its separate GTK, WinUI, and
SwiftUI shells.

### Consolidation question

The user then asked whether to join Tailscale, Headscale, NetBird, Cloudflare Tunnel, and related
tools, or expand TailScout. The decision was:

- ProtoPeek becomes the one active local systems workbench.
- TailScout enters maintenance mode until ProtoPeek reaches verified parity, then can become a
  preserved predecessor.
- This is a product consolidation, not a Git-history or UI-source merge.
- Tailscale comes first; a Headscale-backed client is a Tailscale control-plane variation, not a
  duplicate local adapter.
- NetBird comes later, after the Tailscale implementation reveals the real shared boundary.
- Cloudflare Tunnel remains a service-exposure backend, not a private-mesh provider.

### Portfolio boundary

Do not merge every project:

| Product | Decision | Owns |
| --- | --- | --- |
| ProtoPeek | Primary systems product | Targets, HTTP/gRPC, network evidence, private access, publishing, bounded artifact transfer |
| TailScout | Maintenance, then predecessor | Historical releases and migration path until parity |
| GoBarryGo | Preserved predecessor | v0.0.9 history and migration evidence; new downloader work is in ProtoPeek |
| dbterm | Separate flagship | Database connections, queries, backups, restore, retention, database credentials |
| Markpad | Separate flagship | Notes, documents, editing, drafts, history, recovery |
| Buggy | Separate browser/PWA product | Browser utilities and portfolio/catalog role |
| Personal/Radhey work | Completely separate | Its own identity, audience, and content |

Cross-product handoffs are welcome without shared runtimes:

- ProtoPeek evidence can export as Markdown and open in Markpad.
- dbterm can send a database endpoint to ProtoPeek for route, TLS, or listener evidence.
- Buggy can showcase canonical product stories.

### First visual round rejected

The first three ProtoPeek redesign concepts were rejected. Their problems were consistent:

- they looked like websites or SaaS dashboards rather than a desktop workbench;
- card grids and large product navigation dominated the active task;
- provider logos and feature catalogs appeared before the user's goal;
- some layouts used permanent three-column console structures;
- dark teal glow became decoration instead of evidence signaling;
- evidence was duplicated in several places;
- window chrome, panels, tabs, and status behavior were not convincing.

Do not revive those concepts.

### Second visual round

A second set of exactly three directions was generated after inspecting Markpad and desktop tools.
They are copied into this folder and remain **unselected**. Implementation must wait for the user to
choose.

## 3. Current product truth

Stable release `v0.5.0` has six primary areas:

1. Overview
2. Protocols
3. Network
4. Downloader
5. Security
6. Settings

Current source after `v0.5.0` additionally has:

- a route-lazy **This PC** workspace for local identity, interfaces, listeners, connections,
  optional public-address/BGP evidence, and bounded connection-quality actions;
- a route-lazy **Cloudflare Tunnel** workspace for explicit real-host inspection and guarded
  canonical-service start/stop/restart;
- browser-only Cloudflare route drafts;
- no shipped Tailscale, Headscale, or NetBird integration.

Do not describe current-source work as stable-release functionality.

The existing product already includes substantial safety boundaries:

- local-first operation without an external database;
- no automatic background polling;
- explicit private-network/public-target consent;
- bounded DNS, route, path, discovery, upload, invoke, and transfer work;
- no automatic Nmap, Npcap, aria2, cloudflared, or provider installation;
- no raw browser-supplied shell command;
- no silent privilege escalation;
- stale-state guards for mutations;
- separate origin and endpoint evidence;
- redaction and output limits;
- route-lazy large domains.

Preserve those contracts during UI and code refactoring.

## 4. Product architecture

### One primary object: target

The suite should revolve around a selected target rather than a loose catalog of tools. A target
can be:

- a URL;
- `host:port`;
- a local listener;
- a private-network peer or peer service;
- a published endpoint;
- imported evidence awaiting explicit verification.

A handoff populates a draft and never sends traffic or changes state automatically.

### Six stable destinations

| Destination | Purpose | Existing surfaces that move beneath it |
| --- | --- | --- |
| Home | Resume a target/session/operation and start common journeys | Overview and discovery entry |
| Inspect | See what a service returned while preserving protocol-native evidence | gRPC, HTTP, public web/TLS evidence, current Security |
| Network | See how a service is reached | This PC, route/path, discovery/maps, future Private Access |
| Publish | Select an audience and safely expose one local service | Cloudflare Tunnel, future Serve/Funnel/Expose |
| Files | Acquire and verify a related artifact | Downloader |
| Settings | Appearance, dependencies, host policy, About/docs | Settings plus secondary Help/Roadmap |

Existing URLs remain compatibility routes. Roadmap and Help move to command/About surfaces rather
than permanent primary navigation.

### Shared operation lifecycle

All state-changing work follows:

```text
Observe -> Plan -> Confirm -> Re-observe -> Execute -> Verify -> Receipt
```

The user must be able to answer:

- what was observed;
- what will change;
- who gains access;
- which local/provider process owns the action;
- how it is stopped or rolled back;
- whether origin and exposed endpoint were verified independently.

### Code boundaries

Keep:

- one Go binary;
- one shared React UI;
- route-lazy domains;
- direct executable invocation through typed operations;
- the current standalone/CLI paths;
- protocol-specific evidence.

Do not create:

- microservices;
- a monorepo migration;
- a generic plugin SDK;
- separate React trees per operating system;
- a universal VPN-provider model;
- cloud-admin credential storage during the reset;
- another top-level provider page.

Only share concepts already proven across domains:

- `TargetRef`
- `LocalServiceRef`
- `Capability`
- `Handoff`
- `OperationReceipt`

Implement `internal/tailscale` concretely before extracting a provider interface. Tailscale DERP and
NetBird ICE/Signal/Relay are not interchangeable facts.

## 5. Codebase evidence

The current architecture is functional but carries one-maintainer weight:

| File | Approximate lines at handoff |
| --- | ---: |
| `web/src/console/App.tsx` | 4,293 |
| `web/src/console/Tunnels.tsx` | 2,081 |
| `web/src/console/ThisPC.tsx` | 1,748 |
| `web/src/console/NetworkWorkbench.tsx` | 1,036 |
| `web/src/shared/protopeek.css` | 6,150 |
| `web/src/console/unified-shell.css` | 515 |

The problem is not the number alone. These files mix orchestration, data fetching, derived state,
domain views, and local component libraries. Treat roughly 300–500 lines as a review signal, not a
quota. Split along behavior boundaries and keep every refactor releasable.

The current router manually defines route objects and compatibility redirects in
`web/src/console/router.tsx`. Other catalogs exist independently in shell navigation, dashboard
tasks, command-palette actions, public pages, and roadmap status. The reset should introduce one
small typed feature registry and derive those catalogs from it without turning runtime registry data
into false public release claims.

Refactor rules:

1. Characterize behavior before moving it.
2. Split orchestration, data loading, derived state, and leaf views.
3. Prefer focused hooks plus small components.
4. Extract a shared component only after two real uses agree.
5. Keep provider-native evidence native.
6. Keep tests beside the contract they protect.
7. Do not mix a structural refactor with a behavior redesign in the same checkpoint.
8. Do not delete compatibility paths before migration gates.

## 6. Cross-platform contract

Windows, Linux, and macOS must have the same:

- information architecture;
- navigation labels and order;
- layout model;
- loading/empty/ready/running/warning/failed/stale/unsupported/permission states;
- confirmation and receipt flows;
- keyboard model;
- theme names and semantic meanings.

Only factual capability differences vary:

- executable discovery;
- service manager;
- filesystem paths;
- browser-login behavior;
- permission/elevation guidance;
- vendor commands actually exposed by the installed build;
- genuinely unsupported native evidence.

The Go backend reports capability states such as `available`, `unavailable`,
`permission-required`, `unsupported`, `unknown`, and `failed`. The UI renders the same state
component everywhere. Missing software is a truthful empty state with an official installation
path, never demo data.

The Windows handoff machine had none of `tailscale`, `headscale`, `netbird`, or `cloudflared` in
`PATH` when the private-network plan was written. This all-absent state is a required acceptance
case.

Testing on Windows does not prove macOS/Linux runtime behavior. Use build-tag/unit fixtures and CI
for broad coverage, then real hosts before release claims.

## 7. Markpad design lessons

Inspected source:

- `C:\Users\shreyam\Desktop\PM\markpad\DESIGN.md`
- `C:\Users\shreyam\Desktop\PM\markpad\BUNDLE_BUDGET.md`
- `C:\Users\shreyam\Desktop\PM\markpad\docs\dependencies.md`
- `C:\Users\shreyam\Desktop\PM\markpad\frontend\src\design\tokens.css`
- `C:\Users\shreyam\Desktop\PM\markpad\photo\markpad-split.png`
- `C:\Users\shreyam\Desktop\PM\markpad\photo\markpad-settings.png`
- `C:\Users\shreyam\Desktop\PM\markpad\photo\markpad-code.png`

Useful Markpad traits:

- the workspace owns the window; a dashboard does not frame every task;
- compact fixed chrome and rails;
- contextual navigation rather than a permanent feature catalog;
- one dominant canvas;
- optional drawers/inspectors rather than permanent duplicate columns;
- restrained 4–8 px radii;
- one-pixel region borders;
- shadows mainly for transient layers;
- no gradients, glass blur, giant hero text, or card-grid default;
- first-class light, dark, system, and high-contrast behavior;
- paired semantic themes rather than recoloring individual components;
- pre-paint theme application and no layout shift;
- reduced-motion support.

Markpad's measured layout contract is a reference, not a ProtoPeek requirement:

- 36 px titlebar;
- 42 px document rail;
- 34 px formatting rail;
- 26 px status rail;
- 244 px open sidebar / 44 px collapsed;
- 304 px history overlay;
- 544 px settings overlay;
- compact 28 px controls.

ProtoPeek should adapt that discipline to service work, not clone a text editor.

## 8. New visual directions awaiting selection

### Option 1 — Session Workbench

File: `design-options/option-1-session-workbench.png`

Light Graphite desktop workbench:

- compact custom app bar;
- session rail for This device, localhost, Tailnet, and Downloads;
- contextual service/method navigator;
- one dominant gRPC JSON editor;
- resizable attached message/evidence panel;
- fixed status rail;
- panels collapse without changing the central task.

This is the strongest general-purpose recommendation because it supports HTTP/gRPC density while
letting Network, Files, and Publish swap contextual navigators.

### Option 2 — Command Deck

File: `design-options/option-2-command-deck.png`

Nord-dark, tabs-first approach:

- no permanent sidebar;
- document/session tabs carry context;
- Private Access peer table owns the canvas;
- filters and local actions live in a compact toolbar;
- an attached bottom inspector opens only when evidence is selected;
- maximizes space and feels close to a modern database/API client.

This is the most minimal option, but discovery may become too command-palette dependent for new
users. It needs excellent empty states and keyboard discoverability.

### Option 3 — Context Studio

File: `design-options/option-3-context-studio.png`

Solarized-inspired light workbench:

- narrow activity rail: Inspect, Connect, Transfer, Secure;
- 224 px contextual navigator;
- one audience-first Publish workflow;
- sections separated by rules instead of cards;
- attached Preflight evidence drawer;
- clear local/private/public scope and Stop path;
- status rail explicitly says manual observation and no background polling.

This is the clearest workflow teaching model. It uses four activity modes rather than the proposed
six product destinations, so the selected IA would need reconciliation before implementation.

### Selection rule

Do not blend all three. Choose one structural model, then borrow only small compatible details.
Theme colors are not the structural decision; every chosen layout must work across multiple paired
schemes.

## 9. Production visual system requirements

Whichever option is selected:

- it must feel like a serious desktop utility even when hosted in the existing local browser;
- do not fake Windows-only window controls in the browser build;
- keep the web shell compatible with a possible future native wrapper without adding one now;
- use a compact app bar, contextual navigation, dominant canvas, optional attached drawers, and a
  status rail;
- dense tables and inspectors appear only after a target/session is active;
- no global card grid;
- no permanent three-column layout;
- no duplicated evidence;
- no giant headings;
- no decorative provider-logo wall;
- no dark-only design;
- do not rely on color alone for status.

Suggested paired color families:

1. ProtoPeek — navy/teal, light and dark;
2. Graphite — neutral/blue, light and dark;
3. Nord — cool blue, light and dark;
4. Solarized — warm/cool, light and dark;
5. High Contrast — explicit accessible pair.

Implement semantic tokens rather than component-specific hex values:

- canvas, surface, raised, sunken;
- stroke, strong stroke, focus;
- text, muted text, faint text, inverse text;
- accent, success, warning, danger, info;
- code surface/text;
- selection, hover, active;
- overlay and transient shadow.

Theme requirements:

- `system`, `light`, and `dark` mode behavior;
- a palette choice that has a deliberate light/dark pair;
- pre-paint application before React mounts;
- storage failure fallback;
- no shell dimension changes between schemes;
- `prefers-reduced-motion`;
- forced-colors/high-contrast verification;
- WCAG-readable text, focus, and status combinations.

## 10. TanStack and dependency policy

The user's intent is “use TanStack properly and prefer lightweight libraries.” This does **not**
mean install every TanStack package.

Current production dependencies:

- `@tanstack/react-router`
- `@tanstack/react-query`
- `@cloudflare/speedtest`
- `lucide-react`
- `react`
- `react-dom`

Decision matrix:

| Package | Decision now | Reason |
| --- | --- | --- |
| TanStack Router | Keep and centralize | Existing route-lazy architecture; registry can own metadata around it |
| TanStack Query | Audit before expanding | Currently wraps one HTTP mutation; either standardize several genuine server-state domains or remove it |
| TanStack Table | Not during initial shell reset | Consider only after 3+ dense evidence grids share sorting/filtering/column behavior and budget is reclaimed |
| TanStack Virtual | Not now | Current records are intentionally bounded/paginated; virtualization could hide safety/product issues |
| TanStack Form | Not now | Protocol forms are specialized and backend validation remains authoritative |
| TanStack Hotkeys | Not now | Add only with a real scoped, discoverable, customizable shortcut system |
| TanStack Store | Not now | React state/context is not proven to be a bottleneck |
| TanStack Pacer | Not now | Do not introduce background/debounced activity without a demonstrated workflow |
| TanStack Devtools | Development-only candidate | Never load in production by default |
| TanStack Start / DB | Reject for this reset | Wrong architecture for the existing Go binary/local workbench |

Prefer platform APIs and small local helpers for `fetch`, `Intl`, URL parsing, CSS layout, bounded
table pagination, and testable focus management.

Do not add a component suite, another state library, Axios, a chart library, date library, or fuzzy
search library without measured need.

Current dependency ranges use carets. Any new dependency decision should use exact versions, update
`bun.lock`, document why it exists, and measure route plus aggregate cost.

## 11. Bundle reality

Verified production baseline on 2026-09-02:

| Measure | Current | Enforced maximum | Remaining |
| --- | ---: | ---: | ---: |
| All console JS, gzip | 288,943 B | 290,816 B | 1,873 B |
| All console CSS, gzip | 55,476 B | 57,344 B | 1,868 B |
| Shared entry JS, gzip | 93,553 B | 107,520 B | 13,967 B |
| HTTP route JS, gzip | 16,762 B | 17,408 B | 646 B |

Route splitting helps startup but does not reduce the enforced aggregate. Before adding a UI engine,
reclaim budget. Recommended post-reset soft targets:

- aggregate console JavaScript: at or below 270 KiB gzip;
- shared entry: at or below 95 KiB gzip;
- aggregate CSS: at or below 52 KiB gzip.

Do not raise a budget simply to make a new library pass. First remove duplication, dead styles, and
unnecessary shared imports. Record the before/after measurement in each dependency commit.

## 12. External product lessons

Official product references used during ideation:

- DevToys — searchable tool access, but avoid turning ProtoPeek into a tile grid:
  <https://devtoys.app/>
- Bruno — resource tree, tabs, request/result workspace:
  <https://www.usebruno.com/>
- Yaak — focused, local-first protocol canvas:
  <https://yaak.app/>
- TablePlus — calm, dense master/detail desktop behavior:
  <https://tableplus.com/>
- GitHub Desktop — explicit current context and outcome-oriented actions:
  <https://docs.github.com/en/desktop>
- Zed — collapsible panels and command discovery, without adopting IDE docking complexity:
  <https://zed.dev/docs>
- Tailscale device web interface — read-first client/device management:
  <https://tailscale.com/docs/features/client/device-web-interface>

The synthesis is a calm technical workbench: compact chrome, contextual navigation, resizable
attached panels, visible scope, and no dashboard theatrics.

Provider research and safety conclusions live in:

- `guides/private-network-integration-plan.md`
- `guides/cloudflare-tunnel-integration-plan.md`
- `guides/protopeek-suite-strategy.md`

Those guides include the provider-specific official-source trail and take precedence over a memory
summary.

## 13. Private access and publishing sequence

### Tailscale first

The first provider slice is read-only and manual:

- locate installed CLI;
- inspect only after explicit user action;
- parse bounded machine-readable output;
- show device, identity, addresses, version, health, peers, routes, direct/relay evidence, profiles,
  exit-node capability, and observation time;
- hand peers to unsent HTTP/gRPC/route/ping drafts.

Later controls use typed fixed operations with fake execution tests:

- connect/disconnect;
- login/logout;
- profile switching;
- exit-node selection;
- netcheck;
- version;
- redacted bug report.

Each mutation uses observe/plan/confirm/re-observe/execute/verify.

### Headscale

Treat Headscale as custom control-server login for the installed Tailscale client first. Do not
assume Serve/Funnel capability. Headscale server administration is a separate later authority and
is not part of the reset.

### NetBird

Add only after Tailscale is shipped and useful. Preserve NetBird's Management, Signal, Relay, ICE,
route, and DNS evidence. Do not clone its management dashboard.

### Publish

The shared Publish flow chooses audience before provider:

| Audience | First backend | Later |
| --- | --- | --- |
| Private network | Tailscale Serve | Semantically equivalent private provider flows |
| Public temporary | Cloudflare Quick Tunnel | Tailscale Funnel, NetBird Expose |
| Public managed | Existing named Cloudflare plan | Others after credential/audit/rollback review |

Changing private to public requires a new confirmation. Every temporary process needs an owned
session, bounded logs, obvious Stop action, and shutdown cleanup.

## 14. SEO and migration

ProtoPeek becomes the one active systems-workbench software identity. TailScout and GoBarryGo are
predecessor names used for migration/history. dbterm, Markpad, Buggy, and personal work keep their
own search intent.

Keep existing ProtoPeek URLs stable. Publish new provider pages only after shipped capability:

- `/tailscale/` after stable v0.8 behavior on all three operating systems;
- `/migrate/tailscout/` after migration mapping;
- `/private-access/` only when a second provider makes the term substantive;
- `/headscale/` only with an independently substantial shipped experience;
- `/netbird/` only after NetBird ships.

Do not advertise planned capability in structured data. Do not redirect TailScout early. Wait for
verified parity and the support/indexing gates in `guides/protopeek-suite-strategy.md`.

## 15. Non-goals

- universal VPN client;
- replacement network data plane;
- cloud control-plane clone;
- IDE or terminal;
- database client;
- Markdown editor;
- generic remote administration;
- automatic public exposure;
- silent installation or elevation;
- plugin marketplace;
- provider model that erases native evidence;
- UI rewrite that changes all functional contracts at once.

## 16. Immediate next decision

The only unresolved product decision that blocks redesign code is:

> Choose option 1, 2, or 3.

After selection, implement the v0.6 product reset in `EXECUTION_PLAN.md`. Do not add Tailscale in
the same milestone.

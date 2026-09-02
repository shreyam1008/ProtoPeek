# ProtoPeek step-by-step execution plan

This plan is deliberately staged for one maintainer. It favors small verified checkpoints over a
single heroic rewrite. The first Codex CLI run should finish **v0.6 Product Reset** only.

## Governing rules

1. Read `AGENTS.md` and all handoff files before editing.
2. Never discard an existing dirty change.
3. Do not add Tailscale, Headscale, NetBird, or new Cloudflare behavior during v0.6.
4. Separate behavior-preserving refactors from visual/behavior changes.
5. Keep old routes working.
6. Keep the same React interface across operating systems.
7. Keep network work manual, bounded, local-first, and explicit.
8. Measure before adding a dependency.
9. Do not raise bundle limits as the first response to growth.
10. Commit only coherent checkpoints that pass their stated gates.

## Phase 0 — Resume safely and select the direction

### 0.1 Inspect the repository

Run:

```powershell
git status --short
git branch --show-current
git log -5 --oneline --decorate
Get-Content -Raw .\AGENTS.md
Get-Content -Raw .\handoff\codex2-protopeek-suite-reset-2026-09-02\MASTER_HANDOFF.md
Get-Content -Raw .\handoff\codex2-protopeek-suite-reset-2026-09-02\SESSION_EVIDENCE.md
```

Expected starting point is documented in `SESSION_EVIDENCE.md`. If it differs, preserve the newer
state and explain the delta before editing.

### 0.2 Inspect all three concepts

Use the image viewer on:

- `design-options/option-1-session-workbench.png`
- `design-options/option-2-command-deck.png`
- `design-options/option-3-context-studio.png`

If the user did not include `SELECTED_OPTION`, ask only for 1, 2, or 3. Do not implement a blended
fourth direction.

### 0.3 Write the selected shell contract

After selection, add `guides/desktop-workbench-design.md` containing:

- selected structure and why;
- exact permanent regions;
- collapse/open behavior;
- desktop dimensions and minimum sizes;
- narrow layout behavior;
- keyboard/focus traversal;
- loading, empty, ready, running, warning, failed, stale, unsupported, and permission states;
- light/dark/system/high-contrast behavior;
- all semantic tokens;
- examples for gRPC, HTTP, Network, Publish, and Files;
- explicit differences between browser-hosted chrome and a possible future native wrapper.

Do not implement until this contract is internally coherent.

### 0.4 Capture baseline

Run:

```powershell
go test ./...
bun run test
bun run build
git diff --check
```

Record test counts, per-route and aggregate gzip, warnings, and current representative screenshots
at desktop and narrow widths. The build rewrites generated assets. Commit those only when a source
change requires them.

### Phase 0 gate

- one option selected;
- design contract written;
- baseline recorded;
- no production behavior changed.

Suggested commit:

```text
docs(design): lock ProtoPeek desktop workbench direction
```

## Phase 1 — Align the product contract

The current `AGENTS.md` still describes ProtoPeek primarily as a gRPC console. Update product
language without claiming unreleased features.

Files to reconcile:

- `AGENTS.md`
- `README.md`
- `product.json`
- `guides/feature-roadmap.md`
- `guides/protopeek-suite-strategy.md`
- public site copy and metadata only where current behavior is true

Define the six destinations and compatibility routes. State that private access is planned.

Add a feature-admission test to the docs:

1. operates on a service/endpoint/path/exposure/related artifact;
2. strengthens an existing journey or typed handoff;
3. remains useful local-first;
4. stays route-lazy, bounded, and quiet;
5. one maintainer can support a truthful three-OS story.

### Phase 1 gate

- internal rules and public claims agree;
- stable-release and current-source claims are distinct;
- no planned provider appears as shipped.

Suggested commit:

```text
docs(product): align ProtoPeek around the service journey
```

## Phase 2 — State inventory and characterization

Before shell work, add `guides/current-route-and-state-inventory.md`.

For every current route, record:

- route and compatibility route;
- source component and style entry;
- data sources/endpoints;
- automatic work on mount, if any;
- user-triggered work;
- local persistence and cancellation;
- empty/loading/ready/running/success/partial/failure/stale/unsupported/permission states;
- primary handoffs in and out;
- current desktop and narrow behavior;
- duplicated shell/state UI.

Inventory `/`, `/protocols`, `/protocols/grpc`, `/protocols/http`, `/network` and children,
`/this-pc`, `/tunnels`, `/downloader`, `/security`, `/settings`, `/roadmap`, plus `/grpc`, `/http`,
`/routes`, and `/downloads` compatibility routes.

Add or strengthen characterization tests before extracting logic. Assert behavior and accessibility
roles rather than implementation filenames.

### Phase 2 gate

- every current state is named;
- mount-time network behavior is known;
- compatibility routes have tests;
- no behavior change.

Suggested commit:

```text
test(console): characterize current route and operation states
```

## Phase 3 — Semantic tokens and themes

Create a focused design layer without rewriting every component at once.

Suggested structure:

```text
web/src/design/
  tokens.css
  themes.css
  density.css
  theme.ts
  theme.test.ts
```

Keep migration aliases so existing `--pp-*` variables continue to resolve while components move.
Do not rename thousands of selectors in one commit.

### 3.1 Token categories

- shell dimensions;
- spacing;
- radius;
- typography;
- surfaces and strokes;
- text;
- accent/status;
- code;
- focus and selection;
- transient overlays/shadows;
- motion.

### 3.2 Theme model

Separate:

- mode: `system | light | dark`;
- palette: `protopeek | graphite | nord | solarized | high-contrast`.

Each palette must define intentional light and dark values. Apply before React paint. Gracefully
handle denied or malformed storage. The shell must not shift when mode changes.

### 3.3 CSS cleanup

Use cascade layers and domain ownership:

```css
@layer reset, tokens, base, shell, components, domains, utilities, overrides;
```

Work from the highest-value duplication. Delete a rule only after verifying all selectors/usages.
Resolve existing Biome descending-specificity warnings as touched, without a risky whole-file
reorder.

### Phase 3 gate

- selected palette renders in light and dark;
- system mode pre-paints correctly;
- high contrast and reduced motion have explicit behavior;
- old routes still render;
- aggregate CSS is lower than baseline, not higher;
- all tests/build pass.

Suggested commits:

```text
refactor(ui): establish semantic ProtoPeek design tokens
feat(ui): add paired desktop workbench themes
```

## Phase 4 — One typed feature registry

Create a small registry, not a plugin framework.

Suggested structure:

```text
web/src/console/app/
  feature-registry.ts
  feature-registry.test.ts
  release-capabilities.ts
  handoff-types.ts
```

Possible static shape:

```ts
type FeatureDefinition = {
  id: FeatureId;
  destination: DestinationId;
  label: string;
  route: string;
  compatibilityRoutes?: string[];
  order: number;
  commandKeywords: string[];
  docsSlug?: string;
  releaseStatus: 'stable' | 'source' | 'planned';
  accepts?: HandoffKind[];
  produces?: HandoffKind[];
};
```

Do not put runtime network state in this registry. Do not generate shipped public claims from a
`planned` entry.

Derive, where appropriate:

- primary navigation;
- command menu destinations;
- Home entry actions;
- capability/About index;
- route labels;
- docs links.

TanStack Router remains the routing engine. Registry metadata may wrap explicit route construction;
do not invent dynamic route loading that weakens type safety.

Tests:

- IDs and route paths are unique;
- compatibility targets exist;
- order is deterministic;
- docs slugs are valid;
- planned entries are excluded from shipped claims;
- navigation and command surfaces consume the same source.

### Phase 4 gate

- one feature can be registered without editing several catalogs;
- existing route URLs and lazy chunks remain;
- bundle does not grow materially.

Suggested commit:

```text
refactor(console): centralize feature and navigation metadata
```

## Phase 5 — Build the selected shell around existing routes

Suggested boundary:

```text
web/src/console/shell/
  DesktopShell.tsx
  AppBar.tsx
  ActivityRail.tsx
  SessionTabs.tsx
  ContextNavigator.tsx
  MainCanvas.tsx
  AttachedPanel.tsx
  StatusRail.tsx
  CommandMenu.tsx
  shell-state.ts
  shell-state.test.ts
  shell.css
```

Only include regions in the selected option.

Shell responsibilities:

- navigation and current location;
- current target/session summary;
- panel open/collapse state;
- route outlet;
- command discovery;
- status facts;
- theme controls;
- focus return when drawers close.

Domain responsibilities remain in domain routes: requests, provider facts, downloads, tunnel
operations, evidence tables, and domain-specific states.

The browser version gets an application bar, not fake OS window buttons. A future native wrapper
may supply real drag/window regions through an adapter.

Narrow layout:

- contextual navigation becomes a drawer;
- central task remains primary;
- bottom evidence panel becomes a full-width sheet;
- no horizontal page scroll;
- tables use bounded scrolling or responsive field lists;
- primary action and Stop remain visible.

### Phase 5 gate

- all current routes run inside one shell;
- desktop and narrow screenshots match the selected contract;
- keyboard navigation and focus restoration work;
- no duplicate permanent chrome;
- no route begins new background work;
- tests/build pass.

Suggested commits:

```text
feat(shell): add the ProtoPeek desktop workbench frame
feat(shell): add narrow workbench navigation and panels
```

## Phase 6 — Shared primitives, only after evidence

Extract primitives from two agreeing uses:

- `CapabilityState`;
- `EmptyState`;
- `OperationBanner`;
- `ConfirmOperationDialog`;
- `AttachedPanel`;
- `EvidenceTable`;
- `StatusFact`;
- `TargetField`;
- `CopyableValue`;
- `ObservedAt`;
- `BoundedLog`;
- `UnsupportedState`;
- `PermissionState`.

Avoid a broad `components/common` dumping ground. Each primitive needs an explicit API, accessible
label/role, keyboard behavior, theme and narrow coverage, a unit test, and at least two real
consumers.

### Phase 6 gate

- duplicate markup/styles measurably decrease;
- shared primitives do not erase domain vocabulary;
- CSS and bundle totals move toward soft targets.

Suggested commit:

```text
refactor(ui): consolidate repeated evidence and operation primitives
```

## Phase 7 — Decompose oversized domains without changing behavior

Perform one domain per checkpoint. Never move all four together.

### 7.1 gRPC: `App.tsx`

Suggested boundaries:

```text
web/src/features/grpc/
  GrpcRoute.tsx
  useGrpcWorkspace.ts
  target/
  service-browser/
  request/
  response/
  schema/
  history/
```

Preserve reflection, browser-folder snapshots, host paths, protosets, metadata, deadlines,
streaming, cancellation, timing, headers, trailers, and bounded histories.

### 7.2 Tunnels: `Tunnels.tsx`

Suggested boundaries:

```text
web/src/features/publish/cloudflare/
  CloudflareRoute.tsx
  useCloudflareObservation.ts
  HostSummary.tsx
  ServiceActions.tsx
  ConfigEvidence.tsx
  IngressEvidence.tsx
  VersionCheck.tsx
  RouteDraft.tsx
```

Preserve manual inspect, no fake samples, canonical service only, revision guards, redaction,
latest-version on request, and browser-only drafts.

### 7.3 This PC

Suggested boundaries:

```text
web/src/features/network/this-device/
  ThisDeviceRoute.tsx
  useDeviceCapabilities.ts
  DeviceSummary.tsx
  InterfacesPanel.tsx
  SocketsPanel.tsx
  PublicAddressPanel.tsx
  InterfaceLoadPanel.tsx
  QualityPlanPanel.tsx
```

Preserve one-shot actions, Linux capability truth, no public-port verdict, and no line-speed claim.

### 7.4 Network

Suggested boundaries:

```text
web/src/features/network/
  NetworkRoute.tsx
  route/
  path/
  discovery/
  topology/
  history/
```

Preserve scan/path/workspace bounds, consent, import trust labels, persistence limits, and unsaved
change guards.

For each domain:

1. list contracts;
2. add missing characterization tests;
3. extract pure normalization/derived-state functions;
4. extract data hook/controller;
5. extract leaf views;
6. keep route component as composition;
7. run focused tests;
8. run full Go/UI/build checks;
9. compare screenshots and behavior;
10. commit independently.

### Phase 7 gate

- route files are composition shells;
- behavior, API contracts, and lazy boundaries remain;
- no cross-domain abstraction is speculative;
- all budgets and tests pass.

Suggested commits:

```text
refactor(grpc): decompose workspace without behavior changes
refactor(publish): decompose Cloudflare workspace
refactor(network): decompose This Device workspace
refactor(network): decompose evidence workspace
```

## Phase 8 — Move current surfaces under six destinations

Perform IA changes only after the shell and registry are stable.

- Security moves under Inspect;
- This PC moves under Network as This Device;
- Tunnels becomes Publish;
- Downloader becomes Files;
- Roadmap/Help become command/About destinations;
- old routes redirect or adapt without breaking deep links.

Update route tests, docs, and command menu together. Do not delete source names until compatibility
and migration evidence permit it.

### Phase 8 gate

- exactly six permanent destinations;
- all old URLs resolve correctly;
- no scroll-hidden navigation at 1280×720;
- current target and active temporary operation remain visible;
- desktop/narrow parity complete.

Suggested commit:

```text
feat(console): unify current tools under six service destinations
```

## Phase 9 — v0.6 hardening and stop point

Run:

```powershell
go test ./...
bun run typecheck
bun run lint
bun run test:ui
bun run build
git diff --check
```

Add:

- desktop and narrow visual checks on Windows;
- keyboard-only smoke;
- theme matrix smoke;
- forced-colors/reduced-motion check;
- route compatibility check;
- absent capability check;
- idle network check;
- bundle comparison report.

For Linux/macOS, run build-tag and cross-compile coverage where meaningful and use CI for supported
runners. Do not claim real-host UI/permission success without real-host evidence.

Update screenshots and public docs only when they represent real current behavior.

### v0.6 exit gate

- one coherent shell and theme system;
- six-destination IA;
- one feature registry;
- oversized domains decomposed;
- compatibility routes preserved;
- same UI model across OSes;
- no new provider;
- no mandatory new dependency;
- no background polling;
- aggregate JS/CSS at or below current hard limits and moving toward soft targets;
- full tests green.

Stop here and report. Do not roll directly into Tailscale.

## Later roadmap

### v0.7 — Connected workbench

- introduce `TargetRef`, `LocalServiceRef`, typed handoffs, and recent sessions;
- connect listeners to unsent HTTP/gRPC/route/Publish drafts;
- connect discovery and public web evidence to Inspect;
- add a bounded activity/receipt surface;
- polish Downloader and Cloudflare inside the selected shell;
- no new provider.

### v0.8 — Absorb TailScout

- move fixtures/contracts, not UI source;
- implement concrete `internal/tailscale`;
- read-only manual inspection first;
- add peer handoffs, then guarded controls;
- add custom Headscale control-server login;
- verify absent/disconnected/connected/malformed/partial/permission/timeout/unknown on all three OSes.

### v0.9 — Publish a service

- audience-first flow;
- Tailscale Serve first;
- verify origin and private endpoint separately;
- owned process supervisor;
- Cloudflare Quick Tunnel;
- Funnel only after capability/policy/port/macOS constraints are explainable;
- keep Stop visible for every temporary process.

### v1.0 — Stabilize and migrate

- release/install/upgrade/rollback/permission QA on all three OSes;
- finish onboarding/docs/screenshots;
- explicit Taildrop decision;
- canonical `/tailscale/` and migration page;
- two stable releases/support window;
- exact redirects and indexing monitoring;
- TailScout read-only only after parity.

### Post-1.0

- NetBird read-only evidence first if demand exists;
- extract only proven provider overlap;
- reuse publishing supervisor before `netbird expose`;
- keep cloud-admin, PCAP, generic remote admin, and plugin SDK gated.

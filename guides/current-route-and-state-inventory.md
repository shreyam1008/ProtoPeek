# Current route and state inventory

Status: v0.6 Phase 2 characterization of the pre-reset console.

Captured from current source on 2026-09-02 before shell extraction. This is a source-evidence record,
not the target information architecture. The selected target contract is in
[`desktop-workbench-design.md`](desktop-workbench-design.md).

## Reading this inventory

- **Mount work** means work caused by rendering a route, without another user gesture.
- **Local host read** means a request to the running ProtoPeek process. It is distinct from probing a
  target or contacting a public provider, but it is still automatic work that must remain bounded.
- **Explicit work** begins only after a button, submit, consent, import, or CLI-supplied action.
- **Browser persistence** means `localStorage`, `sessionStorage`, or IndexedDB. Host configuration and
  server-owned queues are called out separately.
- **Partial** means useful bounded evidence exists even though the requested scope did not complete.
- **Unknown** means source authority has not established a fact; it is never treated as success.

No route performs recurring background refresh. Downloader's pre-reset ready-state interval was
removed in Phase 9; its snapshot now refreshes on the initial local read, after mutations, or when
the user explicitly requests it.

## Shared pre-reset shell

`ProtocolFrame.tsx`, `ProtocolShellContext.ts`, and `unified-shell.css` wrap every route. The frame
renders the old global header, eight-item primary rail, secondary Roadmap/Help controls, mobile
drawer, command palette, scan dialog, theme control, and route outlet.

- Data: no network request of its own. It receives route navigation and scan callbacks, and lazily
  loads the scan/help/command surfaces.
- Persistence: `protopeek.theme.v1`, `protopeek.interface.v1`, up to 12 recent discoveries, and
  one-shot pending gRPC/HTTP handoffs in `localStorage`.
- Cancellation: scan-dialog operations own their abort path; closing shell chrome does not stop
  server-owned jobs or services.
- States: navigation ready/current, discovery empty/ready, scan idle/running/cancelled/success/no
  result/failure, transient surface open/closed, and storage valid/malformed/denied fallback.
- Handoffs: scan results can open unsent gRPC or HTTP drafts through bounded storage plus a custom
  event. No handoff sends traffic automatically.
- Layout: a desktop left rail becomes a focus-managed drawer at `<= 760px`.
- Duplication: route-local headers, rails, mobile navigation, command actions, status bars, dialogs,
  and focus loops overlap the global shell. Both this frame and the gRPC route currently listen for
  `Ctrl/Command+K`; the frame's capture listener wins.

All routes also receive the global `web/src/shared/protopeek.css` entry. Route-specific style entries
below are additional owners.

## Route inventory

### `/` — Overview

- Source/styles: `Dashboard.tsx`; global `protopeek.css` and shell CSS.
- Data and mount work: one local `GET api/bootstrap`. A CLI-provided `initialScanTarget` may
  intentionally start one bounded `POST api/scan`; ordinary browser entry does not scan.
- Explicit work: bounded discovery through the shared scan dialog.
- Persistence/cancellation: recent discoveries use the shell's bounded browser storage. The scan is
  abortable; bootstrap failure degrades without invented values.
- States: bootstrap loading/ready/failure fallback; discoveries empty/ready; scan idle/running/
  cancelled/success/no-result/failure.
- Handoffs: Protocols, Network Path, This PC, Downloader, Security, and Cloudflare Tunnel; scan
  results to unsent gRPC/HTTP drafts.
- Layout/duplication: desktop task-card grid becomes one column narrow. It duplicates the shell's
  route/action catalog and presents a website-like feature dashboard rather than one work canvas.

### `/protocols` — protocol chooser

- Source/styles: `Protocols.tsx`, `suite-pages.css`.
- Data and mount work: none.
- Explicit work: opens bounded discovery or navigates to gRPC/HTTP.
- Persistence/cancellation: none in the route.
- States: gRPC and HTTP ready; future protocols explicitly gated rather than disabled fantasy
  controls.
- Handoffs: `/protocols/grpc`, `/protocols/http`, and shared discovery.
- Layout/duplication: route cards stack narrow and repeat destination catalog/roadmap language.

### `/protocols/grpc` — gRPC workbench

- Source/styles: `App.tsx`, `CallWorkspace.tsx`, supporting domain modules, global
  `protopeek.css`.
- Data and mount work: always `GET api/bootstrap`. A direct or restored connection additionally uses
  `POST api/workspace/connect`, `GET api/workspace/metadata`, and `GET api/workspace/protos`; direct
  bootstrap uses `GET api/protos`. Session teardown uses `DELETE api/workspace/session`.
- Explicit work: target scan, connect/disconnect, schema selection, invocation through
  `api/workspace/invoke/:method`, canonical Health Check/Watch through `api/health/*` or
  `api/workspace/health/*`, sequential Unary Repeat, import/export, replay, and save actions.
- Persistence/cancellation: bounded targets, active target, method/filter, assertions, collections,
  environments, and secret-sanitized history use validated browser storage. Browser-folder bytes and
  handles remain memory-only. Connect, invoke, repeat, Health, and discovery have distinct abort/
  cancellation ownership; unmount disconnects the browser-owned workspace session.
- States: booting/boot-failed; launcher empty/connecting/failure; schema loading/ready/failure;
  connected compose/history/tests/transport/structure/workspace; invoke idle/running/cancelled/
  success/gRPC-failure/relay-failure/local-limit; repeat running/partial/cancelled/success/failure;
  Health idle/running/unknown/serving/not-serving/unimplemented/cancelled/failure; storage valid/
  migrated/quarantined/denied; browser schema selection missing/stale/reselection-required.
- Handoffs: receives exact targets from discovery and local/network evidence; exports bounded local
  evidence and can return to related Network views. A handoff opens an unsent draft.
- Layout/duplication: internal service rail and header become off-canvas below `900px`. The route has
  its own palette, status/chrome, target controls, and focus handling inside the outer frame.

### `/protocols/http` — HTTP workbench

- Source/styles: `HTTPRoute.tsx`, `HTTPWorkbench.tsx`, `openapi-workbench.css`, and global CSS.
- Data and mount work: no network request. It consumes one bounded pending URL and loads bounded,
  credential-redacted browser history. `HTTPRoute` currently provides TanStack Query for one
  mutation.
- Explicit work: `POST api/http/request`; cancellation; bounded OpenAPI/Swagger JSON import from a
  file or an explicit URL (a documentation page may require one additional linked-definition GET);
  cURL export and copy.
- Persistence/cancellation: at most 12 safe history entries in browser storage. Live auth remains in
  memory and is redacted before history/export. Request and URL import are abortable.
- States: draft empty/ready/invalid; request running/cancelled/success/relay-failure; response body
  empty/text/base64/truncated; redirect none/present; TLS absent/verified/failure; OpenAPI idle/
  loading/ready/partial/unsupported/oversize/failure; clipboard idle/success/failure.
- Handoffs: receives unsent URLs from discovery, Tunnels, and local/network evidence; preserves the
  exact URL and does not send until requested.
- Layout/duplication: request/response split becomes labelled narrow tabs. The route has another
  workbench header and response status layer inside the global frame.

### `/network` — Network index

- Source/styles: router index child and `NetworkWorkbench.tsx`, `network.css`.
- Data and mount work: its `beforeLoad` redirects to `/network/path`; it has no independent canvas or
  state. The destination route then performs the parent/child work described below.
- States: redirect only; failure would be router-level, for which no explicit global error surface
  currently exists.
- Handoff/layout/duplication: it establishes the Network sub-route boundary but currently has no
  user-visible destination landing page.

### `/network/path` — active path

- Source/styles: `NetworkWorkbench.tsx`, `NetworkPathPanel.tsx`, `network.css`.
- Data and mount work: parent initializes the local IndexedDB workspace store and loads metadata/
  first workspace. Child performs one local `GET api/path/capabilities`; it does not trace on mount.
- Explicit work: consented bounded `POST api/path/trace`, stop/cancel, and save evidence snapshot.
- Persistence/cancellation: observations save only on request to bounded IndexedDB workspaces.
  Capability and trace requests are abortable; dirty-workspace navigation is guarded.
- States: store loading/ready/session-only/failure; capability checking/supported/unsupported/
  failure; plan empty/invalid/over-limit/ready; trace idle/running/cancelled/failure/reached/
  destination-unconfirmed/partial with silent or mixed hops; save success/failure/stale revision.
- Handoffs: exact destination/route evidence in; immutable observation to Map/History; unsent service
  targets out when evidence supports them.
- Layout/duplication: Network subnavigation sits inside the global shell; evidence tables and forms
  stack at narrow widths.

### `/network/local` — authorized local discovery

- Source/styles: `NetworkWorkbench.tsx`, `LocalNetworkPanel.tsx`, `local-network.ts`, `network.css`.
- Data and mount work: parent IndexedDB initialization plus one local
  `GET api/network/capabilities` for interface suggestions. It sends no probe on mount.
- Explicit work: authorized, bounded `POST api/network/discover`, cancel, annotate, and save.
- Persistence/cancellation: results are memory-only until explicitly saved to IndexedDB. Capability
  and discovery requests are abortable; newer actions own their result.
- States: suggestions loading/ready/empty/failure; authorization/plan empty/invalid/unsupported/
  ready; scan idle/running/cancelled/failure/complete/partial/zero-positive-results; save success/
  failure/stale.
- Handoffs: interface suggestion or explicit private CIDR in; verified TCP/HTTP/gRPC evidence to
  unsent Inspect drafts and saved Network snapshots.
- Layout/duplication: bounded result cards/tables stack narrow; consent, warnings, and state banners
  duplicate patterns in other evidence routes.

### `/network/map` — logical topology

- Source/styles: `NetworkWorkbench.tsx`, lazy `TopologyCanvas.tsx`, `network.css`.
- Data and mount work: IndexedDB initialization/list/load only; no network request.
- Explicit work: edit manual groups, select evidence, save/discard, import, export, and navigate to
  related observations.
- Persistence/cancellation: bounded versioned IndexedDB with a session-only fallback; revision and
  generation guards prevent delayed reads/writes replacing newer edits. `beforeunload` and router
  blocking protect dirty work.
- States: store loading/ready/failure/session-only; workspace empty/ready/dirty/saved/stale;
  validation failure; topology lazy-loading/ready; node selected/unselected/unknown; import success/
  partial/loss-warning/oversize/invalid/failure; export ready/failure.
- Handoffs: saved Path/Local evidence in; selected targets to Inspect/Network actions; lossless JSON
  and declared-loss GraphML workspace exchange out.
- Layout/duplication: canvas and inspector stack below `980px`; workspace chrome, dialogs, notices,
  and status repeat shell responsibilities.

### `/network/history` — workspace history

- Source/styles: `NetworkWorkbench.tsx`, `network.css`.
- Data and mount work: IndexedDB initialization/list/load only; no network request.
- Explicit work: switch workspace, two-step restore/delete, import/export, save/discard.
- Persistence/cancellation: same bounded store, revision/generation guards, dirty navigation blocker,
  and session-only fallback as Map.
- States: loading/empty/ready; active/inactive; dirty/blocked; restore armed/success/failure/stale;
  delete armed/success/failure; persistence/import/export success/partial/failure.
- Handoffs: Path/Local/Map snapshots in and restored Map workspace out.
- Layout/duplication: workspace picker becomes a horizontal scroller narrow; confirmation and status
  surfaces duplicate other route patterns.

### `/network/route` — passive next-hop evidence

- Source/styles: `RoutesWorkbench.tsx`, global CSS. This is a root sibling, not a child of
  `NetworkWorkbench`, so it does not initialize IndexedDB.
- Data and mount work: none.
- Explicit work: abortable `POST api/route/lookup` for one submitted target.
- Persistence/cancellation: none; a new lookup aborts the owned request.
- States: target empty/invalid/ready; lookup idle/loading/cancelled/top-level-failure/success; each
  resolved address can be ready/error/unsupported/unknown with uncertainty notes.
- Handoffs: target or address in; route/interface/gateway facts to Path or an unsent protocol draft.
- Layout/duplication: kernel path and fact panels stack narrow and repeat route heading/status UI.

### `/this-pc` — process-perspective host evidence

- Source/styles: `ThisPC.tsx`, `this-pc.css`.
- Data and mount work: exactly two local GETs: `/api/this-pc/capabilities` and
  `/api/this-pc/snapshot`. There is no polling and no browser write.
- Explicit work: consented `/api/this-pc/activity` and `/api/this-pc/public`; direct one-click
  `/api/this-pc/traffic/sample`; plus a separately consented, data-bounded Cloudflare quality run
  from the browser.
- Persistence/cancellation: evidence is memory-only. Activity/traffic/public identity share one
  abort owner, so a newer on-demand action cancels the prior one. Benchmark has separate pause/stop
  ownership; unmount aborts all browser work.
- States: capability/snapshot loading/ready/partial/failure; platform supported/unsupported/
  permission-required/unavailable/unknown; sockets consent/idle/running/cancelled/ready/empty/
  restricted/not-found/failure; traffic idle/running/ready/partial/counter-reset/interface-added/
  interface-removed/failure; public identity consent/running/IPv4-only/IPv6-only/partial/ready/
  ambiguous/failure; benchmark idle/running/paused/stopped/partial/success/failure.
- Handoffs: none. Listener and address evidence is display-only in current source; typed handoffs to
  Inspect, Network, or Publish remain future work.
- Layout/duplication: desktop evidence spine and panels become bottom tabs/cardified tables below
  `760px`; route hero, local navigation, consent panels, and footer status duplicate shell patterns.

### `/tunnels` — current Cloudflare local operations

- Source/styles: `Tunnels.tsx`, `tunnels.css`.
- Data and mount work: zero requests and zero persistence. The initial state waits for **Inspect this
  host**.
- Explicit work: `GET api/tunnels/capabilities` plus `POST api/tunnels/snapshot`; separate
  `POST api/tunnels/release`; confirmed `POST api/tunnels/service-action` followed by re-observation.
  Route planning is browser-only and has no Apply action.
- Persistence/cancellation: drafts and history are in-memory. Inspection, release, and service calls
  are abortable; service actions stale-guard the prior observation. OS elevation remains outside
  ProtoPeek.
- States: uninspected/loading/ready/failure/unavailable; executable/service/config/deployment empty;
  service running/stopped/paused/transitional/unknown; release unchecked/checking/current/update-
  available/failure; action confirmation/running/unchanged/success/stale/permission-required/not-
  installed/failure; routes ready/filtered-empty/invalid/draft-ready; local-managed/remote-managed/
  unknown authority.
- Handoffs: observed ingress or draft service URL to an unsent HTTP/gRPC request. Planned private
  providers and cloud/config mutation are absent.
- Layout/duplication: master/detail becomes a single-pane switch below `640px`; page heading,
  internal tabs, drawer, dialog, and route status bar overlap future shell regions.

### `/downloader` — local transfer queue

- Source/styles: `Downloader.tsx`, `downloader.css`, and lazy `downloader-advanced.css`.
- Data and mount work: one `GET api/transfers/snapshot`. No interval or recurring background work is
  scheduled when the engine is ready.
- Explicit work: start engine; add one job or a batch of at most 32; pause/resume/retry/cancel a job;
  pause/resume the queue; refresh; copy; and reveal advanced request fields. Endpoints are the
  bounded `api/transfers/*` family.
- Persistence/cancellation: browser stores no queue or credentials. The host owns private job state,
  queue durability, files, and config. The initial read is abort-bound; explicit and post-mutation
  refreshes use mounted-state suppression. Mutations use CSRF and direct-loopback policy.
- States: snapshot loading/ready/failure; engine stopped/starting/running/stopping/binary-missing/
  locked/unavailable/failed/unknown; queue empty/filter-empty/ready; job queued/downloading/paused/
  completed/failed/cancelled; verification pending/verifying/verified/mismatch/unavailable;
  mutation running/success/partial/durability-warning/failure; retry available/unavailable.
- Handoffs: explicit HTTP(S) artifact URL in; verified filesystem path/checksum evidence out. Secret
  request values never return in queue results.
- Layout/duplication: queue and inspector stack below `840px`; its header, queue status, and footer
  facts duplicate global chrome.

### `/security` — public website and historical-name evidence

- Source/styles: `Security.tsx`, `security.css`.
- Data and mount work: none.
- Explicit work: separately disclosed and cancellable `POST api/domain/candidates` and
  `POST api/security/web`. Report derivation is local and makes no extra request.
- Persistence/cancellation: no browser persistence; each operation owns cancellation and bounded
  evidence.
- States: consent absent/ready; lookup idle/loading/cancelled/failure/success/cached/fresh/empty/
  truncated; website observation idle/loading/cancelled/failure/success/partial; DNS pinned/
  unresolved/changed; TLS present/verified/failure/unknown; redirect none/present; report ready/
  partial with no score.
- Handoffs: exact public hostname/URL in; unsent HTTP request and retained local evidence out.
- Layout/duplication: evidence grids stack narrow; disclosures, consent panels, and status banners
  repeat cross-route patterns.

### `/settings` — browser and host preferences

- Source/styles: `Settings.tsx`, `suite-pages.css`, `settings.css`.
- Data and mount work: one local `GET api/transfers/snapshot` for current-source Downloader host
  settings. Theme/interface preferences are read by the shared shell.
- Explicit work: change/persist theme, density, and keyboard hints; save/reload guarded Downloader
  config through `api/transfers/config`; explicitly preview/import/roll back GoBarryGo state through
  `api/transfers/migrations/gobarry/*`.
- Persistence/cancellation: appearance uses versioned browser storage. Host settings and migration
  receipts remain private host state. Snapshot/save/migration operations use owned abort controllers
  and revision/engine-stopped guards.
- States: appearance ready/storage-denied; host loading/ready/failure; engine supported/unavailable/
  locked/running; draft clean/dirty/invalid/stale; save running/success/durability-warning/failure;
  migration uninspected/previewing/not-found/already-imported/blocked/ready/failure; import or rollback
  confirmation/running/success/partial/failure.
- Handoffs: settings changes apply to the shell; migration brings only supported paused transfer
  state into Downloader.
- Layout/duplication: settings sections stack narrow; theme controls duplicate the global header
  toggle, while host status and confirmation UI repeat other route state patterns.

### `/roadmap` — source capability ledger

- Source/styles: `Roadmap.tsx`, global CSS.
- Data/mount work/persistence/cancellation: static; none.
- States: available/current-source, next, exploring, and gated. Labels describe claims rather than an
  operation lifecycle.
- Handoffs: documentation only.
- Layout/duplication: two columns become one narrow; it is a permanent old-shell destination even
  though v0.6 moves Roadmap to command/About surfaces.

## Compatibility routes and fallback parity

| Entered route | Frontend result | Backend GET/HEAD fallback |
| --- | --- | --- |
| `/grpc` | redirects to `/protocols/grpc` | recognized, `307` to `./#/grpc` |
| `/http` | redirects to `/protocols/http` | recognized, `307` to `./#/http` |
| `/routes` | redirects to `/network/route` | recognized, `307` to `./#/routes` |
| `/downloads` | redirects to `/downloader` | recognized, `307` to `./#/downloads` |

`standalone/standalone.go` manually allowlists the canonical SPA paths and these four compatibility
paths. GET and HEAD use the hash redirect; unsupported methods and unknown paths return 404. The
frontend and backend lists agree at this baseline. Frontend parameterized tests and the existing Go
SPA-route test lock that agreement. The router has no explicit global pending, error, or not-found
component yet.

All four compatibility entries are redirect-only routes declared in `router.tsx` and use only the
shared shell styles. Their `beforeLoad` redirect is the sole mount behavior and handoff; they perform
no explicit operation, data request, persistence, or cancellation and render no desktop/narrow
layout or duplicate chrome. Their observable states are redirecting and router failure if navigation
cannot complete; every operational state belongs to the canonical destination.

## Automatic-operation ledger

| On route mount | Work |
| --- | --- |
| `/`, ordinary browser entry | one local bootstrap GET |
| `/`, CLI initial target | bootstrap plus one intentional bounded scan |
| `/protocols`, `/protocols/http`, `/network/route`, `/tunnels`, `/security`, `/roadmap` | no network work |
| `/protocols/grpc` | bootstrap; schema/catalog only when direct/restored connection context requires it |
| `/network/path` | IndexedDB initialization plus one local path-capability GET |
| `/network/local` | IndexedDB initialization plus one local network-capability GET |
| `/network/map`, `/network/history` | IndexedDB initialization/load only |
| `/this-pc` | exactly two local GETs: capabilities and snapshot |
| `/downloader` | one local snapshot GET |
| `/settings` | one local transfer snapshot GET |

No other target probe, active trace, private-range scan, tunnel inspection, release lookup, public
identity lookup, quality run, website request, or mutation starts merely because its route rendered.

## Characterization locks and remaining gaps

Phase 2 locks:

- all four frontend compatibility redirects;
- Downloader's single mount read, explicit refresh, and post-mutation refresh;
- existing manual-only Tunnels inspection;
- exactly two This PC mount reads and no storage write;
- existing Network dirty/concurrency guards and route-level state suites; and
- backend SPA fallback parity through the existing Go tests.

Useful gaps remain for the implementation phases, but none blocks this inventory:

- add explicit router pending, lazy-error, and unknown-route surfaces when the shell owns them;
- expand next-hop tests beyond the current happy path to cancellation, mixed address results,
  unsupported evidence, and top-level failure;
- add browser-level `320px` horizontal-overflow evidence because jsdom cannot measure real layout;
- test Dashboard bootstrap failure and CLI automatic-scan entry;
- deepen Network session-only/quarantine/import/history route integration coverage.

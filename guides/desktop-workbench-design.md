# ProtoPeek desktop workbench design

Status: selected v0.6 implementation contract.

Selected direction: **Option 1 - Session Workbench**.

This document turns the selected concept into a desktop and narrow-screen contract. It is a build
specification, not permission to display planned providers, invented observations, or native window
controls in the browser-hosted console.

## Product posture

ProtoPeek is the lightweight local workbench for finding, reaching, inspecting, and safely exposing
services. The active target and its protocol or network evidence own the window. Global navigation
stays compact and predictable; dense controls appear only after a real target, session, operation,
or saved local record exists.

Option 1 supplies the structure:

- a compact application bar;
- a bounded row of open workbench sessions;
- a route-owned context bar;
- one collapsible contextual navigator;
- one dominant canvas;
- one optional attached evidence panel; and
- a fixed status rail.

Compatible details may inform that structure without creating a fourth direction:

- Markpad supplies stable geometry, restrained borders and radii, semantic paired themes, and
  transient inspectors;
- Option 2 supplies canvas-first table density and a selected-record inspector;
- Option 3 supplies audience-first Publish wording and explicit manual/no-polling status facts.

The permanent structure remains Option 1. ProtoPeek does not adopt Option 2's navigation-free shell
or Option 3's four-mode activity rail.

## Six-destination reconciliation

The concept image shows task examples such as This device, localhost, Tailnet, and Downloads. Those
are session examples, not the product information architecture. The permanent destinations are:

| Order | Destination | Owns in v0.6 | Current and compatibility paths retained |
| ---: | --- | --- | --- |
| 1 | Home | resume, recent targets, bounded discovery entry | `/` |
| 2 | Inspect | gRPC, HTTP, public web and TLS evidence | `/protocols`, `/protocols/grpc`, `/protocols/http`, `/security`, `/grpc`, `/http` |
| 3 | Network | This Device, next hop, path, authorized discovery, map, history | `/network/*`, `/this-pc`, `/routes` |
| 4 | Publish | current-source Cloudflare Tunnel observation, guarded service actions, route drafts | `/tunnels` |
| 5 | Files | Downloader and related artifact evidence | `/downloader`, `/downloads` |
| 6 | Settings | appearance, local dependencies, host policy, About and documentation | `/settings`, `/roadmap` (secondary) |

Roadmap and Help remain available through the command menu and About/documentation surfaces. They
do not occupy permanent destination space.

Session tabs represent real in-memory workbench contexts, not product destinations and not network
health. In v0.6, a tab may identify a route, selected local record, or target already owned by that
route. It must never imply a live connection merely because it is open. Session persistence and
cross-domain `TargetRef` handoffs remain v0.7 work unless existing behavior already provides them.

The concept's Tailnet content is not implemented in v0.6. No Tailnet, Tailscale, Headscale, NetBird,
Serve, Funnel, or private-peer UI appears until its corresponding capability ships. Publish uses
only truthful current Cloudflare behavior during this reset.

## Permanent regions

At desktop widths, the shell is a fixed grid in this order:

```text
application bar                 38 px
session strip                   40 px when at least one workbench is open
route context bar               38 px when the route contributes real context
context navigator | main canvas
                  | attached evidence panel (optional, bottom-attached)
status rail                     26 px
```

The application shell fills `100dvh` and never creates document-level horizontal scrolling. Each
region owns its own overflow. Loading, dirty state, or passive selection changes must not move the
region boundaries. Geometry changes only after a direct user command to open, close, or resize a
region; the shell reserves the collapsed attached-panel header when a route exposes that region.

### Application bar

- Height: `38px`.
- Left: ProtoPeek mark and product name, linking to Home.
- Center: Home, Inspect, Network, Publish, Files, and Settings in that order.
- Right: command search, current appearance control, and one overflow menu for About, Help, and
  Roadmap.
- The active destination uses text, `aria-current`, selected fill, selected border, and a 2 px
  accent indicator. Hover is weaker than selection.
- All six short destination labels remain visible at every desktop width. From `761-1119px`, the
  product wordmark condenses to its mark, command search condenses to its labelled icon action, and
  nonessential utility copy disappears before navigation changes. Destination order and
  availability never change with width.
- The browser build shows no minimize, maximize, close, traffic-light, drag-region, or operating
  system decoration.

### Session strip

- Height: `40px`; absent on Home when no workbench context is open.
- Stores at most eight in-memory shell navigation references. Overflow means those eight references
  do not fit the available width and move into one menu; it never means an unbounded ninth item or a
  second row.
- A reference identity is `destination + canonical route + existing route-owned local record or
  target id`. Opening the same identity selects its existing reference. A new ninth identity
  replaces the least-recently-focused inactive reference that is not dirty or running. If all seven
  inactive references are guarded, navigation still proceeds but the shell does not add a ninth
  reference and announces that result.
- A tab shows a domain icon, a concise truthful label, optional unsaved/running text or icon, and a
  close action when closing is safe.
- A dirty or running tab reserves its status slot from first paint; state changes must not resize
  the label.
- Closing a tab with unsaved edits or a running operation uses the owning domain's existing guard.
- Closing the selected reference activates the nearest reference on its left, otherwise the nearest
  on its right, otherwise Home. Closing removes only the shell reference. Route components keep
  normal TanStack Router mount/unmount behavior; v0.6 adds no keep-alive, `TargetRef`, or session
  persistence.
- Closing a shell reference never implicitly stops or cancels work. Normal route unmount cleanup
  still cancels browser-owned in-flight HTTP, gRPC, and path operations. Server-owned Downloader
  jobs and host services retain their existing explicit lifecycle controls.
- The selected tab never claims Connected, Healthy, or Verified unless current domain evidence says
  so.

### Route context bar

- Height: `38px`; omitted when a route has no useful real context.
- Shows route-owned facts such as target, scope, transport, deadline, observation freshness, or
  selected local object.
- Holds at most one primary action and one compact overflow group. Domain-specific Stop or Cancel
  remains visible whenever work is running.
- A context value that can change behavior is an explicit control. An observed value is rendered as
  evidence and never styled like an editable control.

### Context navigator

- Default width: `244px`.
- Minimum resized width: `200px`; maximum: `360px`.
- Collapsed width: `44px`.
- The navigator is contextual: services/methods for gRPC, request history or imported operations for
  HTTP, sections/workspaces for Network, deployments for Publish, and queue items for Files.
- Home and Settings may omit it. Empty routes do not render placeholder trees.
- Collapse is explicit and remembered for the current browser session only. It does not alter the
  persisted `protopeek.interface.v1` preference or discard route selection.
- The resize separator is `1px`, has a larger invisible pointer target, uses `role="separator"`,
  `aria-orientation="vertical"`, and an `8px` minimum pointer hit width. It reports its current value
  and supports arrow-key resizing in `16px` steps.

### Main canvas

- Minimum width: `0`; it receives all space not used by the navigator.
- It is the only dominant work region. Permanent card grids and competing side inspectors are not
  allowed.
- Rules and surface changes separate editors, tables, and evidence. Ordinary content radius is
  `4px`; raised transient surfaces use `8px`.
- Tables remain bounded by existing record limits. They scroll inside the canvas or change to a
  field list on narrow screens; they never widen the application page.

### Attached evidence panel

- Attached to the bottom of the canvas; it never becomes a permanent third column.
- Closed height: `0`; compact header height when collapsed but available: `32px`.
- Default open height: `240px`; minimum: `144px`; maximum: `min(48dvh, 480px)`.
- A `1px` separator with `aria-orientation="horizontal"` and an `8px` minimum pointer hit height
  supports direct resize. Arrow keys resize by `16px`; Home selects minimum and End selects maximum.
- A route that supports the panel reserves its `32px` collapsed-available header. The closed state
  (`0px`, route has no panel) and collapsed-available state (`32px`) are distinct. The body opens
  only after a direct evidence-selection or start-operation command, never because passive data
  arrived. A route may remember its open size for the current browser session only.
- It has one owner for each fact. A message, header, route, log line, or receipt is not duplicated in
  both the canvas and panel.
- Closing it returns focus to the control or record that opened it.

### Status rail

- Height: `26px` and fixed to the bottom of the shell.
- Contains short factual items only: local/remote authority, manual observation, active operation,
  last observed time, bounded-result count, and no-background-polling state where relevant.
- It is not a notification feed. Errors requiring action appear in the owning canvas or attached
  panel.
- Status uses text or icon plus color. A colored dot alone is never sufficient.

### Shell ownership and migration

The Session Workbench replaces the current `ProtocolFrame` global rail and header; it is not nested
inside them. A route may contribute typed context, navigator, evidence, and status content, but it
does not render another permanent shell. Existing `WorkbenchHeader`, HTTP header, Tunnels page
heading/status bar, This Device hero/footer, and Downloader footer either become contributions to
the single shell or become ordinary canvas headings. There is one owner for application navigation,
route context, command search, appearance, and bottom status facts.

The existing browser-local interface preference at `protopeek.interface.v1` remains valid with
`{ version: 1, density: 'comfortable' | 'compact', showKeyboardHints: boolean }`. Comfortable is the
default. Density changes only route-interior row height, control padding, and content spacing; it
never changes permanent-region dimensions, narrow touch-target minimums, or breakpoints. Keyboard
hints remain independently visible or hidden. Invalid or denied storage uses the current defaults
without throwing.

Material or destructive confirmation remains a transient `dialog` or `alertdialog`, not an
attached-panel substitute. It has an accessible title, initially focuses the safest meaningful
action, keeps stable confirm/cancel order in two columns on desktop, stacks those actions on narrow
screens, closes on Escape only when cancellation is safe, and restores focus to its opener. The
attached panel may hold plan, preflight, and receipt evidence but does not perform the modal guard's
job.

## Desktop sizing contract

| Property | Value |
| --- | ---: |
| Desktop layout begins | `>= 761px` |
| Full-label desktop target | `>= 1120px` |
| Tested desktop reference | `1440 x 900` |
| Minimum desktop QA size | `1024 x 640` |
| Application bar | `38px` |
| Session strip | `40px` |
| Route context bar | `38px` |
| Status rail | `26px` |
| Context navigator | `244px` default, `200-360px` resized, `44px` collapsed |
| Attached panel | `240px` default, `144px` minimum, `min(48dvh, 480px)` maximum |
| Standard control | `28px` high |
| Primary route action | `32px` high |
| Icon control | `28px` square |
| Command menu | `min(680px, calc(100vw - 32px))` |
| Short confirmation | `400px` maximum |

Settings is a routed main-canvas destination, not a shell inspector. At `>= 1120px`, a navigator is
expanded by default. From `761-1119px`, it is collapsed by default. A user toggle overrides that
default until the browser tab closes; v0.6 does not persist navigator geometry. The main canvas must
remain usable at `1024 x 640` with the default collapsed navigator and evidence panel closed. At
`1280 x 720`, all six destinations remain reachable without vertical navigation scroll.

## Narrow contract

Narrow mode applies at `<= 760px` and is verified down to `320 x 568`.

- The application bar remains `40px` high. It shows a menu button, ProtoPeek/current destination,
  command button, and appearance button.
- The six destinations move into a left modal drawer. The drawer is
  `min(320px, calc(100vw - 24px))`, fills `100dvh`, traps focus, closes on Escape/outside press, and
  restores focus to its opener.
- The session strip stays one horizontal row with internal scrolling and a stable selected-tab
  position. It does not create page-level horizontal overflow.
- The route context bar becomes a two-row maximum, `72px` maximum height. Secondary facts move to an
  overflow sheet. The primary action and an active Stop/Cancel remain visible.
- The contextual navigator becomes a modal drawer opened from the route context bar. It is absent
  from layout while closed and uses the same `min(320px, calc(100vw - 24px))` width as the global
  destination drawer.
- The main canvas occupies the full width. Split request/response or editor/evidence panes become a
  labelled, keyboard-operable pane switch or a vertical sequence chosen by the domain contract.
- The attached evidence panel becomes a bottom sheet, `min(82dvh, 640px)` maximum height, with a
  fixed header and internally scrolling body. Escape closes it and focus returns to its source.
- The status rail is `40px` high and shows the most important scope and running-state facts.
  Remaining facts are in an accessible overflow list whose trigger meets the same `36px` touch
  target minimum.
- No control, table, code block, long address, or filename may force horizontal page scrolling.
- Touch targets are at least `36px` in narrow mode even though desktop controls remain compact.

## Keyboard and focus contract

- `Ctrl+K` on Windows/Linux and `Command+K` on macOS opens the one global command menu.
- Browser-reserved tab-number shortcuts are not intercepted.
- Permanent destinations are navigation links, not tabs; `Tab` reaches each visible link and Enter
  follows it. Arrow keys and Home/End apply only to actual session and evidence tablists, with one
  documented manual-or-automatic activation model per tablist.
- `Tab` follows visible geometry: application bar, session strip, context bar, navigator, canvas,
  attached panel, then status actions if any.
- Escape closes only the topmost transient surface.
- Opening any modal drawer, dialog, sheet, or command palette traps focus and stores the invoking
  element. Closing restores focus when that element still exists. Non-modal overflow menus use
  standard menu focus movement without trapping focus outside the menu.
- The command palette initially focuses its search input. Up/Down move the active result, Enter
  invokes it, an empty result set is announced, and Escape or outside press closes the palette.
- The shell is the only owner of `Ctrl/Command+K`; route listeners must not compete with it. Existing
  `Ctrl/Command+Enter` Send/Invoke/Cancel behavior and `/` method-filter focus remain available in
  their owning routes.
- Route changes focus the route heading unless they came from an in-canvas handoff whose target
  editor needs immediate focus.
- Focus uses a visible 2 px semantic outline plus offset and is never removed based on pointer use.
- Busy actions retain focus, expose `aria-busy` or live status, and keep Cancel/Stop keyboard
  reachable.
- Resize separators work by pointer and keyboard and announce their size.
- No new hotkey package is required for v0.6. The global catalog remains small and testable with
  platform APIs.

## State language

Every domain maps its native facts to the following presentation states without erasing domain
vocabulary:

| State | Presentation contract |
| --- | --- |
| Loading | Occupies final bounds, names what is loading, and offers no fake values. |
| Empty | Successful absence with the next valid action; never sample data. |
| Ready | Observed or editable state is available; observation time remains visible. |
| Running | Names the active bounded operation and keeps Stop or Cancel visible. |
| Success | Names what completed and links to retained evidence or receipt. |
| Warning | Work can continue, but scope, partial evidence, or risk is explicit. |
| Partial | A bounded operation completed with retained evidence but not the full requested scope. |
| Failed | Names the failed phase, preserves partial evidence, and offers a scoped retry. |
| Stale | Shows which observation changed and requires re-observation before mutation. |
| Unsupported | Names the missing platform/vendor capability; it is not styled as a failure. |
| Permission required | Names the exact authority required and leaves authentication to the OS. |
| Unavailable | The local runtime or policy cannot expose the feature; no disabled fantasy UI. |
| Unknown | No authoritative fact is available yet; it is neither success nor failure. |

State is expressed by a label and, where useful, an icon and border. Color is supplementary.
Unknown is never treated as success. Loading indicators stop under reduced motion.

## Semantic token contract

Components consume only semantic variables. Existing `--pp-*` names may remain as migration aliases
until all consumers move. New route-specific hex colors are not allowed.

### Geometry

- `--pp-app-bar-height: 38px`
- `--pp-session-strip-height: 40px`
- `--pp-context-bar-height: 38px`
- `--pp-status-rail-height: 26px`
- `--pp-narrow-app-bar-height: 40px`
- `--pp-narrow-context-bar-max-height: 72px`
- `--pp-narrow-status-rail-height: 40px`
- `--pp-navigator-width: 244px`
- `--pp-navigator-min-width: 200px`
- `--pp-navigator-max-width: 360px`
- `--pp-navigator-collapsed-width: 44px`
- `--pp-attached-panel-height: 240px`
- `--pp-attached-panel-min-height: 144px`
- `--pp-attached-panel-max-height: min(48dvh, 480px)`
- `--pp-control-height: 28px`
- `--pp-primary-control-height: 32px`
- `--pp-narrow-touch-height: 36px`

### Spacing and shape

- `--pp-space-1: 2px`
- `--pp-space-2: 4px`
- `--pp-space-3: 6px`
- `--pp-space-4: 8px`
- `--pp-space-5: 10px`
- `--pp-space-6: 12px`
- `--pp-space-8: 16px`
- `--pp-space-10: 20px`
- `--pp-radius-control: 4px`
- `--pp-radius-panel: 4px`
- `--pp-radius-raised: 8px`
- `--pp-stroke-width: 1px`
- `--pp-focus-width: 2px`
- `--pp-focus-offset: 2px`

### Typography

- `--pp-font-ui`: system UI stack
- `--pp-font-code`: system monospace stack
- `--pp-text-10: 10px`
- `--pp-text-11: 11px`
- `--pp-text-12: 12px`
- `--pp-text-13: 13px`
- `--pp-text-15: 15px`
- `--pp-text-18: 18px`
- `--pp-text-24: 24px`
- `--pp-line-ui: 1.4`
- `--pp-line-copy: 1.6`
- `--pp-line-code: 1.55`

### Surfaces and boundaries

- `--pp-color-canvas`
- `--pp-color-chrome`
- `--pp-color-surface`
- `--pp-color-surface-raised`
- `--pp-color-surface-sunken`
- `--pp-color-code-surface`
- `--pp-color-stroke`
- `--pp-color-stroke-strong`
- `--pp-color-overlay`
- `--pp-shadow-menu`
- `--pp-shadow-dialog`

Permanent regions use borders, not shadows. Only menus, dialogs, drawers, and sheets use transient
shadows.

The reset also removes decorative gradients, radial glows, background grids, backdrop blur/glass,
active-item glow, giant hero headings, and provider-logo walls. Permanent regions use flat semantic
surfaces and boundaries; planned providers are never used as decoration.

### Text and interaction

- `--pp-color-text`
- `--pp-color-text-muted`
- `--pp-color-text-faint`
- `--pp-color-text-inverse`
- `--pp-color-accent`
- `--pp-color-accent-strong`
- `--pp-color-accent-soft`
- `--pp-color-focus`
- `--pp-color-focus-soft`
- `--pp-color-hover`
- `--pp-color-active`
- `--pp-color-selection`
- `--pp-color-selection-strong`
- `--pp-color-selection-border`
- `--pp-color-selection-text`

### Status and evidence

- `--pp-color-success`
- `--pp-color-success-soft`
- `--pp-color-success-border`
- `--pp-color-warning`
- `--pp-color-warning-soft`
- `--pp-color-warning-border`
- `--pp-color-danger`
- `--pp-color-danger-strong`
- `--pp-color-danger-soft`
- `--pp-color-danger-border`
- `--pp-color-info`
- `--pp-color-info-soft`
- `--pp-color-info-border`
- `--pp-color-code-text`
- `--pp-color-code-accent`

### Motion

- `--pp-motion-fast: 80ms`
- `--pp-motion-standard: 120ms`
- `--pp-motion-slow: 160ms`
- `--pp-ease-out: cubic-bezier(0.2, 0, 0, 1)`

Only color, border-color, opacity, and transform may transition. Pane dimensions, grid tracks,
margin, and padding never animate. `transition: all` is forbidden. Reduced motion makes transient
surfaces immediate and removes looping indicators while retaining textual progress.

## Appearance model

Mode and palette are independent:

- mode: `system | light | dark`;
- palette: `protopeek | graphite | nord | solarized | high-contrast`.

Graphite is the selected Option 1 default. Each palette defines every surface, boundary,
interaction, status, selection, focus, and code token in both light and dark. A palette is not an
accent swatch.

| Palette | Light intent | Dark intent |
| --- | --- | --- |
| Graphite | neutral cool gray, crisp blue selection | near-black neutral gray, clear frost blue |
| ProtoPeek | pale blue-gray, teal signal | navy-black, current ProtoPeek teal signal |
| Nord | cool frost surfaces, muted blue | blue-charcoal surfaces, frost accents |
| Solarized | warm paper with teal/blue evidence | deep blue-green with restrained cyan |
| High Contrast | white/near-black with strong blue focus | near-black/white with strong light-blue focus |

`system` follows `prefers-color-scheme` live while preserving the selected palette. The canonical
preference key is `protopeek.appearance.v2` with shape
`{ version: 2, mode: 'system' | 'light' | 'dark', palette: 'protopeek' | 'graphite' | 'nord' |
'solarized' | 'high-contrast' }`. A blocking, allowlisted bootstrap applies `data-theme` with the
resolved light/dark mode plus `data-theme-mode` and `data-palette` before stylesheet/React paint.
React and the bootstrap accept exactly that key, version, and set of values.

If no valid v2 preference exists, the current `protopeek.theme.v1` shape
`{ version: 1, theme: 'light' | 'dark' }` migrates to the same explicit mode plus `graphite`; React
persists v2 after a successful read while leaving v1 intact for rollback. A missing or malformed
preference, or storage access denied while reading, falls back to live `system + graphite` without
throwing or flashing the wrong resolved mode. If a write fails after a user selection, that selected
mode and palette remain active for the browser session and only persistence is skipped. The
bootstrap and React validation paths are covered by the same conformance cases so their accepted
and rejected inputs cannot drift.

Theme changes do not alter any shell dimension. Every ordinary text/surface pairing targets WCAG
AA `4.5:1`; controls, focus, boundaries, and large text target at least `3:1`. High Contrast has a
deliberate light and dark pair and also respects `forced-colors: active`: system colors, visible
borders, and native focus remain usable without decorative backgrounds.

## Domain examples

### gRPC

- Session label: the real target, for example `localhost:50051`; connection state is separate.
- Context bar: target, local/public scope, plaintext/TLS, reflection/schema source, deadline, and
  Invoke/Cancel.
- Navigator: searchable package, service, and method tree with stream mode visible.
- Canvas: request JSON and metadata using the existing specialized editor.
- Attached panel: Messages, Headers, Trailers, Status, timing, and bounded repeat/health evidence.
  These remain separate protocol-native facts.

### HTTP

- Session label: method plus hostname when available.
- Context bar: method, exact URL, relay scope, TLS/redirect policy, and Send/Cancel.
- Navigator: saved requests, imported OpenAPI operations, and history only when those records exist.
- Canvas: Params, Headers, Auth, and Body editor.
- Attached panel: Body, Headers, Timing, Redirects, TLS, and Status. Narrow mode uses a labelled
  Request/Response switch rather than horizontal page overflow.

### Network

- Session label: selected target, CIDR, or saved workspace name.
- Context bar: process/network namespace, target/scope, observed time, and the explicit bounded
  action.
- Navigator: This Device, Next hop, Path, Local discovery, Map, and History.
- Canvas: the selected plan, path, bounded table, or logical topology.
- Attached panel: selected hop/node/service evidence or immutable snapshot details. Observed and
  inferred facts remain visibly distinct.

### Publish

- v0.6 shows only truthful current Cloudflare host/deployment evidence.
- Context bar: local-only authority, selected deployment, observed service state, Refresh, and any
  valid Start/Stop/Restart action.
- Navigator: real observed deployments and browser-only drafts; an absent host shows a useful empty
  state instead of placeholder deployments.
- Canvas: authority, routes, runtime, setup, and diagnostics.
- Attached panel: selected ingress evidence, preflight facts, action confirmation, or receipt.
- A later audience-first flow may use Private, Public temporary, and Public managed only when the
  matching providers and lifecycle contracts ship.

### Files

- Session label: real filename or bounded queue identity.
- Context bar: download directory authority, active count, aggregate bound, and Pause/Resume/Cancel.
- Navigator: queued jobs and filters.
- Canvas: selected job, source, progress, retry, and filesystem result.
- Attached panel: bounded log, response evidence, checksum, and receipt. It never exposes hidden
  credentials from the live request.

## Browser and future native wrapper

The v0.6 console is browser-hosted. Its application bar is ordinary accessible web content:

- no drag regions;
- no fake operating-system buttons;
- no browser-password or elevation prompts;
- no assumption that closing a tab closes the ProtoPeek process; and
- no platform-specific shell layout.

A future native wrapper may replace only the outer chrome through an adapter that provides real
window controls, draggable regions, safe-close events, and platform menu integration. It must keep
the same destination order, session strip, context model, canvas, attached panel, status rail,
themes, and state language. OS differences remain factual capabilities, paths, services,
permissions, and vendor behavior.

## Acceptance gate

The selected shell is ready only when:

1. all current lazy routes run inside the Session Workbench without new mount-time network work;
2. the six destinations are the only permanent product navigation;
3. every old route and deep link still resolves;
4. desktop `1440 x 900`, minimum desktop `1024 x 640`, and narrow `390 x 844` and `320 x 568`
   screenshots have no page-level horizontal overflow;
5. modal navigator drawers, evidence sheets, dialogs, and the command palette trap and restore
   focus, while non-modal menus follow accessible menu focus behavior;
6. the current target, scope, active operation, and Stop/Cancel path remain visible;
7. Graphite plus every other palette works in light and dark, System updates live, and forced colors
   and reduced motion preserve meaning;
8. no planned provider, fake observation, or Windows-only chrome appears;
9. no component suite, state library, chart library, or production devtool is added; and
10. aggregate JavaScript and CSS remain within the existing hard budgets, with duplication removed
    before any dependency is considered.

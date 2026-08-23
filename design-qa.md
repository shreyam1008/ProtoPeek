# ProtoPeek workbench design QA

## Visual sources

- Desktop concept: `design/protopeek-workbench-desktop-v2.png` (1487 × 1058)
- Mobile concept: `design/protopeek-workbench-mobile-v2.png` (853 × 1844, scroll-state exploration)
- Multi-protocol concept: `design/protopeek-multiprotocol-workbench-v1.png` (generated direction,
  not a runtime capture)
- Before-state audit: `/tmp/protopeek-audit/01-launcher-current.png` and `/tmp/protopeek-audit/02-launcher-mobile-current.png`

The concepts established a compact dark application shell, persistent service/method navigation,
a light request editor, a dark response timeline, and a mobile Request/Response switch. The build
uses those decisions without reproducing concept-only window chrome or fictional services.

The multi-protocol concept added the thin `REQUESTS` rail, a method-and-URL HTTP request paper, and
dark response evidence while keeping gRPC intact. The implementation follows that hierarchy with
only real gRPC and HTTP routes. It deliberately omits concept-only Cap'n Proto, Hops, and LAN tabs;
those appear only as gated plans in Help and the roadmap.

## Connected implementation captures

| Capture | Viewport | State |
|---|---:|---|
| `/tmp/protopeek-qa/launcher-desktop.jpg` | 1440 × 1000, 1× | Loopback discovery found the reflected `test.KitchenSink` service |
| `/tmp/protopeek-qa/workbench-desktop-final.jpg` | 1440 × 1000, 1× | `Fail` server stream returned three timed messages and terminal `CANCELED` status |
| `/tmp/protopeek-qa/workbench-mobile-request.jpg` | 390 × 844, 1× | Request editor with persistent deadline/invoke controls |
| `/tmp/protopeek-qa/workbench-mobile-response.jpg` | 390 × 844, 1× | Response timeline and selected-message evidence |
| `/tmp/protopeek-qa/workbench-mobile-navigation.jpg` | 390 × 844, 1× | Service drawer open over the response workspace |
| `output/multiprotocol-qa/http-desktop.png` | 1440 × 1000, 1× | HTTP request editor and dark evidence pane at the initial route |
| `output/multiprotocol-qa/http-320.png` | 320 × 900, 1× | HTTP one-pane request layout at the minimum supported width |

## v0.3.0 release captures

| Capture | Viewport | State |
|---|---:|---|
| `web/site/public/assets/protopeek-dashboard.png` | 1600 × 1000, 1× | Final light-first dashboard from the embedded v0.3.0 binary |
| `web/site/public/assets/protopeek-dashboard-dark.png` | 1600 × 913, 1× | Same dashboard after the versioned dark preference was stored and the app reloaded |
| `web/site/public/assets/protopeek-dashboard-mobile.png` | 390 × 844, 1× | Compact top activity rail, global command header, scan action, and stacked protocol cards |

## Comparison and iteration

The first connected desktop capture matched the concept's hierarchy and color system, but the
response payload made the shared grid row taller than the viewport. That pushed the desktop Invoke
bar below the fold. The workbench was constrained to the available application height, each pane
now owns its scroll region, and the second capture confirms that the endpoint, request, timeline,
selected response, deadline, and Invoke action are visible together.

The mobile comparison confirmed the intended one-pane-at-a-time model. Request and Response tabs
remain at the top, Invoke stays reachable at the bottom of the request pane, the response timeline
keeps its search and transport tabs, and the service rail becomes a dismissible drawer. No desktop
interaction is hidden without a mobile equivalent.

## Interaction and accessibility checks

- Automatic discovery scanned only the fixed loopback candidates and required an explicit opt-in
  for private IPs.
- Reflection connected to the repo's `test.KitchenSink` fixture and exposed all unary and streaming
  method modes.
- A real server-streaming call displayed three ordered messages with elapsed arrival time and the
  terminal error separately.
- Response filtering, message selection, JSON copy/export affordances, saved requests, history,
  command palette, method search, and the mobile service drawer were exercised in the browser.
- Keyboard entry points are visible (`/`, `Cmd/Ctrl+K`, `Cmd/Ctrl+Enter`), controls have accessible
  names, focus-visible treatment is present, and reduced-motion preferences are honored.
- No blocking runtime error or broken interactive state appeared during the connected desktop and
  mobile passes.
- The final dashboard was rendered from the production embedded assets at 1600 × 1000 and 390 × 844.
  A separate Chrome DevTools pass stored the dark preference, reloaded, and captured the dark shell,
  confirming that theme persistence affects first paint instead of flashing the light theme.
- Contrast guards keep faint/muted text at or above 4.5:1 on supported surfaces; live regions are
  scoped to current/final status so response and Health timelines do not flood assistive technology.

## Multi-protocol slice notes

- HTTP has native Params, Headers, Auth, and Body request tabs plus Body, Headers, Timing,
  Redirects, and Status evidence. It does not pretend to provide OpenAPI discovery, a cookie jar,
  scripts, mock servers, TLS bypass, route trace, or a network map.
- The live request editor can hold credentials, while automatic history and default exports redact
  authorization, cookies, proxy authorization, binary metadata, and key/token-like metadata.
- The browser surface uses a hash route so both adapters remain addressable in an embedded binary;
  request secrets are component state and never route parameters.
- Automated component coverage exercises HTTP send/cancel races, safe history, tab semantics,
  discovery handoff, and the default TLS/redirect copy. The final v0.3.0 gate passed typecheck,
  Biome, 185 frontend tests, every Go package, the Go race detector, vet, deep-link HTTP smokes,
  cross-compilation, and a scratch-container runtime smoke.

Prior connected gRPC capture result: passed. Multi-protocol and v0.3.0 dashboard visual results:
passed. Physical macOS and Windows browser auto-open remain post-release smoke checks rather than
unverified claims.

## Unified-suite Downloader design QA — 2026-08-23

### Selected direction and connected captures

- Selected visual direction: `design/protopeek-downloader-selected.png` (1487 × 1058).
- Final desktop capture: `web/site/public/assets/protopeek-downloader-development.jpg`
  (1487 × 1058, real Chrome, dark theme, SHA-256 `608c4896c8e975e34ab593760aae585ddaa6e51c557f272dc4b539d2e9186aee`).
- Final responsive capture: `web/site/public/assets/protopeek-downloader-development-mobile.jpg`
  (390 × 844, real Chrome, dark theme, SHA-256 `306b5f9efc3863f8ed0581e92629ce969c0eeb9b5820949bc16e319464f1277a`).
- Same-canvas comparison input: `/tmp/protopeek-downloader-comparison.png` places the
  selected direction and final desktop capture side by side at the same dimensions.

The selected direction established the compact dark shell, persistent six-area rail, single URL
composer, queue-plus-inspector split, teal progress evidence, and slim local-status footer. The
implementation retains that hierarchy while expanding the composer into one or up to 32 independent
jobs, keeping advanced routing/integrity controls lazy, and removing concept-only Preview, History,
Reveal, and completion workflows that the current backend cannot truthfully perform. Visible controls
operate against the real local service instead of sample rows.

### Real workflow exercised

The final production-embedded app was opened in the user's real Chrome browser. ProtoPeek started a
system-installed aria2c only after form submission, queued independent fixture jobs, enforced a
supplied expected SHA-256, rendered completed queue rows, and selected one for destination and
integrity inspection. A separate throttled real-aria2 pass reached the paused state through Pause
all and invoked Resume all; that ad-hoc fixture then returned aria2 code 8 because its HTTP server did
not implement Range requests, while backend and UI integration tests cover the resume transition.
The browser showed no console warnings or errors.

The responsive pass used an exact 390 × 844 content viewport. The mobile drawer opened as a modal,
kept all six primary areas plus Roadmap and Help reachable, focused its close control, closed on
Escape, and produced no horizontal overflow (`scrollWidth === clientWidth`). The temporary Chrome
viewport override was reset after QA.

The Security workspace was also exercised in real Chrome. A query-bearing URL was blocked before
network contact with the exact removal guidance. A separately consented `https://example.com/`
operation produced one 200 HTTP/2 HEAD observation with pinned public DNS answers, TLS 1.3 evidence,
selected headers, bounded timing, no redirect follow, and no response body read. No console errors
were recorded.

### Defects found and corrected during comparison

- Successful aria2 jobs returned error code `0`; the inspector incorrectly rendered that as a
  failure. Success code zero is now normalized away and covered by a Go regression test.
- Ordinary queued jobs displayed Resume even though the backend's unpause transition applies only
  to paused jobs. Both row and inspector actions are now paused-only with UI regression coverage.
- Pause, resume, and cancel partial-success persistence warnings were discarded. Every mutation now
  normalizes and surfaces the bounded warning after refreshing real queue state.
- The advanced-header helper originally implied values disappeared after queueing. It now states the
  exact boundary: values are masked and cleared from the form, retained only in private local transfer
  state when exact retry/resume requires them, and never returned by queue or API results.
- A partially accepted batch cleared every submitted URL, making the rejected subset awkward to retry
  without risking duplicate work. The composer now retains only failed source lines while clearing
  header values from the form; queued jobs cannot be accidentally resubmitted from the remaining text.
- A receipt from a preferences-only or session-only GoBarryGo import was valid in the backend but hidden
  in Settings until every available source matched. Guarded rollback now remains visible for the latest
  receipt after either a partial or complete import.
- Batch, destination/header/User-Agent, and whole-queue controls initially lacked public truth copy
  and individual CSS budgets. The README, changelog, landing generator, migration guide, LLMS file,
  and executable bundle policy now describe and bound those shipped-source surfaces.
- Terminal Ctrl-C could reach aria2 before ProtoPeek saved the session, producing a false dirty
  shutdown warning. OS-specific child process-group isolation now makes the parent own graceful
  save/shutdown; a real completed-download PTY pass exits cleanly.
- The current-source site gallery now labels these captures as unreleased development evidence and
  keeps the three stable v0.3.0 captures separately identified.

No P0, P1, or P2 visual, interaction, truthfulness, or responsive defects remain in the inspected
Downloader and Security journeys.

final result: passed

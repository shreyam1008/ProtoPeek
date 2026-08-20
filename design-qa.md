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

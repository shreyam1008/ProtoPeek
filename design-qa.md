# ProtoPeek workbench design QA

## Visual sources

- Desktop concept: `design/protopeek-workbench-desktop-v2.png` (1487 × 1058)
- Mobile concept: `design/protopeek-workbench-mobile-v2.png` (853 × 1844, scroll-state exploration)
- Before-state audit: `/tmp/protopeek-audit/01-launcher-current.png` and `/tmp/protopeek-audit/02-launcher-mobile-current.png`

The concepts established a compact dark application shell, persistent service/method navigation,
a light request editor, a dark response timeline, and a mobile Request/Response switch. The build
uses those decisions without reproducing concept-only window chrome or fictional services.

## Connected implementation captures

| Capture | Viewport | State |
|---|---:|---|
| `/tmp/protopeek-qa/launcher-desktop.jpg` | 1440 × 1000, 1× | Loopback discovery found the reflected `test.KitchenSink` service |
| `/tmp/protopeek-qa/workbench-desktop-final.jpg` | 1440 × 1000, 1× | `Fail` server stream returned three timed messages and terminal `CANCELED` status |
| `/tmp/protopeek-qa/workbench-mobile-request.jpg` | 390 × 844, 1× | Request editor with persistent deadline/invoke controls |
| `/tmp/protopeek-qa/workbench-mobile-response.jpg` | 390 × 844, 1× | Response timeline and selected-message evidence |
| `/tmp/protopeek-qa/workbench-mobile-navigation.jpg` | 390 × 844, 1× | Service drawer open over the response workspace |

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

final result: passed

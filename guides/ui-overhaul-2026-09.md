# Workspace UI overhaul

Current source after the local agent adapter. Scope: the complete embedded workbench UI.

## Design contract

- A permanent destination rail and tool navigator own navigation on every route. A Network
  tool never replaces or removes Network navigation. Direct links and browser history work.
- Destination links resume the last visited tool in that destination, using validated,
  browser-local route references. No live request or secret is persisted by navigation.
- One shared page header, typography, control scale, focus treatment and surface hierarchy.
  Controls remain distinct from observations; tables and editors use the available width.
- Primary navigation and evidence tabs stay vertical on desktop. Small screens use the same
  tool hierarchy in an accessible drawer. No operation is triggered by opening a tool.
- Protocol-specific evidence and existing cancellation, consent, drafts and persistence remain
  part of the workflows. Navigation references are not promises of background execution.
- Route loading and failures have visible, recoverable states in the stable shell.

## Feature placement and review checklist

| Destination | Tools to review |
| --- | --- |
| Home | Start actions, recent targets, empty state |
| Inspect | Overview, gRPC, HTTP, WebSocket/SSE, Cap'n Proto, website security |
| Network | This Device, ports, next hop, path, local discovery, Nmap, packets, Tailscale, map, history |
| Publish | Cloudflare host, configuration, ingress, service actions, route planner |
| Files | Add download, queue, history, destination, engine controls |
| Settings | Appearance, preferences, download policy, migration, AI agents, roadmap |

## Execution

1. Replace route-owned navigation with a shared navigator and test context/history/resume.
2. Migrate page headers and shared visual primitives across all feature families.
3. Normalize workspace spacing, form/response layouts, empty/error/loading states and overflow.
4. Run browser checks on every destination and representative tool workflows in both themes;
   inspect narrow layout, keyboard navigation and preserved evidence controls.
5. Run frontend checks, production builds/budgets and Go checks; record acceptance and publish.

## Browser acceptance — 7 September 2026

Reviewed the embedded Go-served production app in an actual browser at 1280×720,
1024×768 and 390×844. Light and dark modes, destination resume, the small-screen drawer,
fuzzy command search and roadmap filtering were exercised. Opening tools did not start scans.

| Workflow | Observed result |
| --- | --- |
| HTTP | Local 200 response, intentional 500 response, and cancellation of a delayed request; draft restored unsent after navigation |
| gRPC | Reflected a local 36-method fixture, invoked Ping successfully, and reconnected from saved target history |
| WebSocket and SSE | Real echo message, explicit disconnect, and five SSE ticks followed by server completion |
| Cap’n Proto | Uploaded a compiled schema, selected a method and received typed echo data including exact 64-bit values |
| Ports and routes | One open fixture port; native loopback next-hop lookup and one-hop ICMP trace; trace saved into map/history |
| Local discovery | Explicit own-device /32, four-port plan completed; no broad network scan |
| This Device | Real Windows interface and socket-owner observations; bounded socket table |
| Packets | Uploaded a 75-packet PCAP, filtered to 25 DNS packets and opened decoded packet details |
| Downloads | Bundled aria2 1.37.0 started on request; 1 MiB transfer completed into a new destination folder; exact file size verified |
| Website | One HEAD request to the owner's website returned 200, HTTP/2 and verified TLS 1.3 evidence |
| Tailscale | Installed client returned real peers through explicit read-only inspection |
| Cloudflare and Nmap | Missing executables/service reported accurately; unavailable actions remained disabled |
| Settings and agents | Theme persisted through reload; engine stop preserved state; MCP setup and activity surface reviewed |

Nmap execution, privileged live capture, native OS dialogs and disruptive account/service changes
were not exercised in this browser pass. Headscale, NetBird, tunnel config writes and other roadmap
items remain future work. The local AI adapter has a separate [acceptance record](agent-acceptance-2026-09.md).

## Implementation and size

The shared shell owns destination/tool navigation; feature routes own their evidence. PageHeader,
EmptyState and route recovery components provide the common UI contract. Route loading, tool
navigation, corrupt/unavailable session storage and roadmap filters have regression coverage.
No frontend dependency, model runtime, database or background polling was added.

The built app measures 1,125,024 bytes of JavaScript (370,820 gzip) and 342,940 bytes of CSS
(67,296 gzip) across all lazy routes. The shared CSS is 156,669 bytes (28,912 gzip). Explicit
budgets were adjusted for the shared responsive layouts and website evidence styling; startup
JavaScript ceilings remain unchanged. These are asset sizes, not runtime RAM measurements.

The UI suite passes 775 tests in 88 files. Full Go tests, typechecking, formatting/lint,
production app/site generation and bundle limits are required before publishing this change.
Stable v0.6.1 remains separate from the current-source edge build.

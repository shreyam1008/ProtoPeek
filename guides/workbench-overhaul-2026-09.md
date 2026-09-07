# ProtoPeek workbench overhaul

Requested 2026-09-06. This is the active delivery plan, not a release announcement.
It extends the earlier v0.6/v0.7 contracts where the user has requested broader capabilities.
Published v0.5.0 claims remain historical. Each row below needs implementation AND recorded
hands-on evidence before it is complete. Preserve the useful GoBarryGo and TailScout workflows.

## Working method

Work sequentially: inspect the source and the actual UI, reproduce problems, design the smallest
complete workflow, implement, test with local fixtures and authorized real targets, inspect the
browser at desktop and narrow sizes, then record results and remaining platform gaps. Do not mark
a feature finished because a unit test passes or a route renders. Use one active feature at a time.

Every feature needs: clear entry point; practical defaults; loading and empty states; actionable
failures; cancel/stop with actual backend cleanup; stale-result protection; keyboard navigation;
accessible focus; narrow layout; saved preferences; delete/reset behavior; a short protocol info
corner; evidence provenance; bounded memory and work; no surprise background traffic.

## Delivery order and acceptance

| Stage | Work | Required hands-on examples | Status |
| --- | --- | --- | --- |
| 0. Baseline | Audit live site, current app, GoBarryGo, TailScout; record architecture, measurements, and gaps | Build Go server, open real local browser, inspect all destinations | In progress |
| 1. Inspect | Simplify HTTP and gRPC; practical request editing, saved requests/drafts, history, local/remote endpoints, OpenAPI and proto workflows; discovery handoffs; WebSocket/SSE, then schema-native Cap'n Proto adapter | HTTP GET/POST/HEAD, params/auth/body, 404/500, redirect, refusal, timeout, cancel, malformed JSON, OpenAPI import; reflected and file-schema gRPC, unary/stream/error/deadline; restart; WS echo/close/error, SSE events/cancel | In progress; see checkpoint |
| 2. Port discovery | Explicit single-host port/range/profile scans, local or remote IP; progress/cancel; common-port hints distinct from verified service detection; open results to unsent Inspect drafts | Loopback fixtures on common and unusual ports, closed port, IPv4/IPv6, explicit remote test host, cancel, invalid/oversize plan | In progress; see checkpoint |
| 3. Network path | Windows/macOS active tracing alongside Linux; selected-hop details and light SVG path visualization; DNS/ASN/provider and optional approximate country enrichment with attribution | Loopback, public authorized destination, silent/mixed hops, timeouts, cancellation, partial result, history comparison | In progress; see checkpoint |
| 4. LAN / Nmap | Interface/subnet picker, explicit discovery plans, device/port inventory, optional installed Nmap adapter with typed modes and bounded execution; selected-host verification; separate packet analysis workflow | Two local services, small authorized subnet, missing Nmap, imported XML, cancellation, partial results, malformed import | In progress; see checkpoint |
| 5. This Device | Process-owned listeners and connections, useful filters/sort, sent/received interface counters, explicit live sampling with Stop; jump to Inspect/Path/Publish | Native Windows TCP/UDP, wildcard/IPv6 bind, process exits, owner permission denied, sample/stop, no idle polling | In progress; see checkpoint |
| 6. Downloader | Preserve queue/recovery; destination picker, concurrency/connection controls, progress, batch, checksum, pause/resume/retry; managed aria2 distribution; persistence across browser close and restart | Range and non-range fixture, queued jobs, pause/resume, cancel, server restart, invalid path, occupied name, checksum mismatch, network failure | In progress; see checkpoint |
| 7. Private Access | Recover TailScout parity for Tailscale: devices, status, accounts, exit nodes, routes, diagnostics, Taildrop; OS-owned elevation; provider-specific Headscale and NetBird later | Missing/stopped/connected daemon, offline peer, relay/direct distinction, commands cancelled/denied, fixtures before any live network-changing operation | In progress; installed-client foundation |
| 8. Publish | Cloudflare config/service/ingress inspection, practical origin handoff and verification, actionable missing dependency states, typed guarded operations; evaluate open-source tunnel adapters separately | Missing cloudflared, local/remote-managed configs, redacted credentials, origin HTTP/HTTPS, stale service state, denied action | In progress; local missing-client browser check and existing fixture tests |
| 9. Website checks | Understandable DNS, certificate, TLS, headers, redirect and timing report; historical subdomains distinguished from verified ones; bounded paths and explicit test profiles | User-owned site, bad/expired TLS fixture, missing headers, redirect, 404, timeout, cancel, export | In progress; see website checkpoint |
| 10. Whole product | Fuzzy global search across actions and safe saved references; cohesive native-style settings, persistent state, roadmap, onboarding; accurate site and predecessor migration/SEO pages | Navigate away/back, browser/server restart, storage unavailable/corrupt, keyboard-only task loop, light/dark, narrow view, bundle and memory gates | Core implemented; see native settings checkpoint and remaining acceptance |

Stage 10 foundations may be implemented alongside a feature when they remove a shared blocker.
Do not let a global redesign substitute for finishing the domain workflow.

## Architecture and persistence decisions

- Go owns host configuration, long-running transfers, queue recovery, and installed-tool adapters.
  Store versioned config in the OS user-config directory, use atomic writes and restrictive access.
  Closing the browser must not cancel a transfer. Closing the Go process requires restart recovery;
  uninterrupted transfers after process exit require a separate explicit service mode.
- Browser storage owns appearance, safe drafts/history, navigation, and view preferences. Larger
  collections use bounded IndexedDB. Show storage failure and provide export/reset. Host-backed
  saved workspaces can follow the same versioned model so changing the UI port does not lose them.
- Credentials stay in memory by default; any durable credential facility needs explicit user
  control and OS credential storage. Redact known secrets in saved references and exports.
- Retain TanStack Router. Use TanStack Table/Virtual for large inventories and Query where it
  actually simplifies async ownership. Avoid adding a cache library around one fetch solely to
  satisfy a library count; measure route chunks and preserve cancellation.
- Keep one shell, compact toolbars, clear forms and real work canvases. Move implementation
  explanations and roadmap promises out of daily work areas into details/help/roadmap.
- Tool adapters accept structured arguments, never arbitrary shell text. Each owns timeouts,
  output caps, process-tree cancellation, capability detection, and OS-specific behavior.

## Accuracy requirements for requested capabilities

- An open port and its conventional service name are hints; a verified HTTP response or protocol
  handshake is stronger evidence. Nmap service/version probing is separate from a connect scan.
- Traceroute measures source-to-responder RTT. It cannot reveal the return route or measure
  per-link delay by subtracting adjacent RTTs. IP geography/ASN is attribution, not proof of a
  physical datacenter; mark unknowns and provenance. Never invent edges for silent hops.
- Packet capture differs from port scanning. Encryption hides application payloads. Live capture
  needs a separately installed capture backend/permissions; do not suggest Nmap supplies it.
- aria2 is an external native executable, not Go code. Packaging can carry a verified per-platform
  companion and extract it locally, with notices and source obligations. Up to 16 connections
  is a setting, not a guaranteed 16x speed gain. Range support and server limits determine benefit.
- Tailscale and NetBird use WireGuard but have different daemons, control planes, APIs and policies.
  Headscale serves compatible Tailscale clients; these need separate capability-aware adapters.
- Website observations cannot certify that a site is secure or discover every subdomain/path.

## Reference research

Use primary documentation as behavior references, not as permission to copy proprietary designs:

- [Postman protocol clients](https://learning.postman.com/docs/sending-requests/grpc/grpc-client-overview/)
- [Nmap service/version detection](https://nmap.org/book/man-version-detection.html)
- [aria2 options and session recovery](https://aria2.github.io/manual/en/html/aria2c.html)
- [SolarWinds NetPath](https://www.solarwinds.com/network-performance-monitor/use-cases/network-path-analysis)
- Local predecessor source: `../tailScout`, `../gobarrygo`.

## Baseline findings

- Current source builds on Windows. Local audit server: `127.0.0.1:43110`.
- The public site has useful task-oriented copy and preserved historical screenshots.
- The local Home and Inspect screens repeat explanations and future-feature disclaimers.
- Inspect currently offers HTTP, gRPC and Security; WebSocket/SSE and Cap'n Proto are research text.
- HTTP has request history but loses an unsent draft on navigation; this breaks the session-tab
  metaphor and needs practical persistence rather than another cosmetic tab strip.
- Global command search currently uses substring matching, not fuzzy ranking.
- Downloader already has host-owned configuration and recovery. Verify its behavior before
  replacing it. Current packages use external aria2; bundling is new requested work.
- An existing website edit in `web/src/site/App.tsx` predates this overhaul and must be preserved.

## Validation log

Append concrete commands, UI journeys and outcomes here as stages progress. Unrun Linux/macOS
checks remain unverified even when Windows passes.

- 2026-09-06: `go build -o .local/protopeek.exe ./cmd/protopeek` passed. Opened public site and local
  Home/Inspect in Chrome through computer-use tools; inspected rendered layout and controls.
- User steering: prioritize actual functionality before further UI/UX polish. Main navigation and
  workspaces now sit in the left sidebar to preserve vertical room; the remaining design pass is open.
- HTTP: reproduced draft loss on navigation, implemented bounded redacted recovery with opt-in body
  storage, and tested restoration without automatic sends. Browser GET/POST, 404/500, redirect off/on,
  timeout, slow-request cancel, and a local 3-operation OpenAPI import exercised. JSON pretty/raw added.
- gRPC: fixed the misleading TLS checkbox with an explicit transport selector; real loopback reflection
  found 36 fixture methods and unary Ping succeeded. Client streaming succeeded, and a server stream
  retained 3 messages before its intentional INVALID_ARGUMENT result. Found oversized recursive and
  invalid well-known-type templates; fixed ProtoJSON shapes and omitted optional nested messages.
- WebSocket/SSE: implemented local Go relay and route-lazy workbench. Backend tests cover CSRF/session
  ownership, text/binary echo, upstream cleanup, no redirects, SSE framing/BOM/IDs/multiline data,
  malformed inputs and bounds. Browser checks: Unicode and binary echoes; invalid base64 rejected;
  5 named SSE events with IDs and normal completion; wrong SSE content type rejected; refused endpoint
  gives error; session duration ends connection. Browser found Disconnect re-submitting its form;
  fixed stable button identity/preventDefault, then verified it remains disconnected.
- Validation checkpoint: all Go packages pass; 72 frontend files / 670 tests pass, typecheck and lint
  pass (existing CSS warnings). Later template/status changes: targeted 115 tests pass. Rebuild and
  final broad validation remain required after subsequent changes.
- Windows installer: current-source Start Menu shortcut, stable localhost port 8844, optional custom
  shortcut directory/port and no-shortcut mode. Verified isolated archive/checksum/install in paths
  with spaces and inspected shortcut target/arguments/window style; no user PATH or existing install
  changed. A dedicated native launcher/background service remains open work.
- Performance: initial JS budget unchanged. Fuzzy command menu and event workbench are lazy.
  Streams adds ~8.7 KiB raw / 3.4 KiB gzip JS; new dependency coder/websocket has no transitive packages.
  Aggregate JS budget extended explicitly for these requested features; startup limit still enforced.

### Functional checkpoint, September 6

- Port discovery: built a separate bounded TCP connect scanner (1,024 ports, 32 workers, 30 seconds,
  pinned DNS address, IPv4/IPv6) and TanStack paginated results. Windows refused connections now map
  correctly to closed. Browser loopback tests found the HTTP, gRPC and ProtoPeek fixtures, identified
  closed ports, restored saved results without scanning again, and verified the HTTP Inspect handoff.
  Open IPv6, cancellation and multi-page browser checks still need coverage.
- Path: Windows IPv4 ICMP uses IP Helper directly, without subprocesses or elevation. Browser
  loopback trace returned TTL 1, three replies; a public resolver returned 11–12 ms in this VM's
  network. These are responder RTTs, not an inferred physical route. Saved trace → History → Map
  worked. A hostname DNS timeout was displayed. Auto now chooses a supported family from the same
  DNS answer set. Windows IPv6, macOS tracing, enrichment and richer path comparison remain open.
- Downloader: reproduced and fixed a new job reusing an unrelated completed file under aria2's
  continue setting. Fresh jobs now choose an unoccupied portable filename; explicit resume/retry
  retains resumable semantics. Real engine integration verifies both old and new file bytes.
- Downloader browser tests used isolated host config/cache/output directories, a Go HTTP range
  fixture and a non-range fixture. 128 MiB range transfer used 16 connections; pause/resume worked.
  Closing and reopening the actual browser retained progress. A paused 95% job resumed after the
  Go/aria2 process restart and completed. Settings now offers save-and-stop; Files restores the saved
  queue independently of new URLs. The stop button was exercised in the browser.
- Completed download history is versioned, atomic, limited to 512 records / 2 MiB, and strips request
  secrets. A host observer saves completions without a browser and has no idle timer. History survives
  engine stop; browser verified a 1 MiB completion as `download (1).bin` beside the old 128 MiB file.
  Remove-history keeps output files; unit tests cover that guarantee. Source collision, malformed
  history, retained-file, no-browser observer, stop, visibility and late-result tests pass.
- Windows amd64 now carries the unmodified pinned aria2 companion (+2.36 MiB compressed), checks its
  archive and executable digests, extracts notices before execution, and uses a hidden process with
  parent-exit monitoring. Other platforms still need installed aria2. All seven corresponding source
  archives were downloaded and their committed digests checked. The release workflow prepares a
  source companion; no release or publication has run. Exact upstream rebuild reproducibility and
  an actual parent-crash watchdog check remain unverified.
- Downloader uses foreground-only progress polling and TanStack pagination (50 rows). At 1280×720,
  compact toolbar and wider queue remove the horizontal row scrollbar; details scroll independently.
  Directory picker, checksum failure/retry browser examples and multi-page browser tests remain open.
- This Device: real Windows snapshot returned interfaces and 116 listeners, including the Bun HTTP
  fixture and PID. Process restrictions and missing owners were reported truthfully. Source changes
  remove the redundant read-only confirmation, add cancellation, preserve filters during refresh,
  add explicit bounded live interface sampling, collapse verbose details, and put section tabs left.
  Browser retest of these newest changes is in progress. This is interface traffic, not packet capture
  or per-process byte attribution. Native macOS socket/counter support remains open.
- Current validation: all Go packages pass after transfer history changes; 20 focused device tests
  and 20 Downloader tests pass. The broad frontend suite and final platform builds are running.

### Device and Nmap checkpoint

- This Device browser retest: native listeners exposed the Bun fixture PID; the `43111` filter
  survived another inspection. Explicit live RX/TX samples changed and Stop retained the last
  sample. A separate Traffic side tab keeps interface monitoring reachable without scrolling past
  the connection inventory. At 1280×720 the compact listener table begins near y=220.
- Existing LAN discovery on the host's own `10.0.2.15/32` completed its expanded 18-port plan,
  finding 22, 445, 3306 and 3389. Those service names remain convention-based hints.
- Added installed Nmap adapter, exact local plan preview, route-lazy workbench, search/pagination,
  export and unsent Inspect handoff. Real Nmap 7.991 ran from an isolated QA directory; no system
  installation, Npcap driver or PATH change was made. TCP connect found all four fixtures and light
  probing identified gRPC. The custom HTTP fixture remained unknown. Browser Cancel retained the
  previous evidence; the process exited. Scope preview masked `192.168.1.47/28` to `.32/28`, 16
  addresses, two ports, 32 checks, without scanning. Missing-engine, invalid scope, strict CSRF/body,
  output-cap and process-cancellation tests passed. Captures and imported-topology integration remain.
- Fixed an external-tool output cap bypass caused by embedded `bytes.Buffer.ReadFrom`; Cloudflare
  reads now retain their 16 KiB bound and Windows tool processes are hidden.
- Validation before folder work: all Go packages and 701 frontend tests passed; later Nmap/registry/
  roadmap/preview tests: 29 pass. Standalone and Cloudflare tests pass after process changes.
- Added a shared explicit folder browser to Downloader and Settings: local existing directories,
  512 folders / 4,096 entries, no file reads or writes, abort/close, exact-path fallback, loopback
  and CSRF protection. Directory endpoint tests and 41 related frontend tests passed. Browser
  destination and integrity checks are in progress. Current app build and bundle budgets pass.
- Folder browser exercised in both Files and Settings on Windows, including parent navigation,
  filtering, and selection. A deliberately wrong SHA-256 failed; Retry enforced the same checksum;
  a matching-checksum 1 MiB fixture completed. An independent file hash matched. Removing its live
  history record kept that file unchanged. Terminating the isolated Go preview process caused its
  bundled aria2 child to exit within five seconds; a fresh preview reopened successfully.
- Latest checkpoint: all Go packages pass; frontend typecheck/lint and 78 files / 720 tests pass
  (existing CSS warnings). No platform release or publication has run.

### Tailscale checkpoint

- Audited TailScout's real CLI methods and current upstream contracts. Implemented a separate
  installed-client Go adapter and lazy Network → Tailscale route. Includes bounded manual status,
  peers/routes/counters, saved accounts, reviewed connection/account/exit-node operations, peer
  pings, netcheck and Taildrop commands. Secrets and provider extension maps are omitted.
- Corrected TailScout's eligibility assumption: Taildrop Available is enum 1, while other positive
  values can mean unavailable. Active transport evidence is separate from assigned relay regions.
  Missing/zero timestamps become unknown; online peers sort first. Browser-local view/filter
  preferences are bounded; snapshots and command output remain in memory.
- Real Windows client 1.102.3 returned 14 peers and one saved account. Browser inspection showed
  one active DERP connection and three eligible Taildrop recipients. A reviewed netcheck completed
  with UDP/NAT, IPv4/IPv6 and measured relay latency evidence. No account, route or file-send
  mutation was performed on the real tailnet; those typed arguments, stale-state rejection,
  missing client, nullable fields, output caps and process cancellation passed fixture tests.
- Browser at 1280×720: device actions moved into a visible right-side inspector, section controls
  stay left, and the list scrolls independently. Selecting a peer prepared `100.100.8.31:50051`
  in the existing Scan dialog without sending an application request.
- Focused 13 frontend tests and standalone/Tailscale Go tests pass; typecheck and bundle budgets
  pass. The Tailscale route adds about 14 KiB raw / 4.5 KiB gzip; startup budgets stay unchanged.
  Latest source extends file-command duration to five minutes; the running preview still has the
  previous 30-second file limit until rebuilt. Sign-in/elevation, long-transfer progress/recovery,
  Serve/Funnel and platform validation remain open; full TailScout retirement is not claimed.

### Website checkpoint

- Real browser HEAD to `https://shreyam1008.com.np/` returned 200 / HTTP/2, TLS 1.3,
  verified certificate through 2026-11-19, four pinned Cloudflare addresses and selected headers.
  HSTS/CSP were absent in that response; other protective headers were observed. No security score.
- A separate loopback QA harness supplied an expired self-signed certificate. The browser showed
  its unverified subject/issuer/dates and rejected trust; the fixture received no HTTP request.
  Production's public-only policy and TLS verification remain enabled. A public badssl example
  timed out during DNS, so that example did not establish a certificate outcome.
- New standard-path plan has five fixed HEAD requests, two workers, 30-second deadline, strict
  input, shared admission, partial rows, cancel and export. Local HTTP fixtures cover 200/302/405/
  404, no redirect follow, exact request count, cancellation and private-address rejection.
  The real site returned text/plain robots, XML sitemap and HTML for both security.txt paths;
  the missing-path comparison also returned 200. The UI labels that possible fallback behavior.
- Fixed a real historical-name provider contract: explicit `format=json`, 25-second deadline,
  no redirect follow and a distinct rate-limit error. The previous eight-second deadline failed;
  a direct provider response took 16 seconds. Browser retest returned 18 scoped names. Corrected
  provenance to CT plus other provider indexes. Filtering to `protopeek` and Inspect prepared the
  unsent `protopeek.shreyam1008.com.np:443` scan dialog. Wildcards have no Inspect action.
- Website subtools now use vertical side sections, retain in-memory results while switching, and
  cancel active work on leaving its section. Only origin/domain are remembered across restart;
  consent remains unchecked, paths/queries/credentials/results stay out of target storage.
  Added Forget actions and JSON exports. Unused repeated boundary/roadmap CSS was removed.
- Cloudflare browser inspection on this Windows host truthfully found no cloudflared service or
  executable, checked two config candidates and showed official setup guidance. No live provider
  configuration was changed; existing fixture tests cover configuration and reviewed actions.
- Validation checkpoint: all Go packages and 81 frontend files / 731 tests pass, plus later focused
  handoff tests. Site build passes with the user's pre-existing App.tsx edit preserved. Linux amd64,
  macOS arm64 and Windows arm64 cross-builds pass; these are compilation, not native runtime tests.
  Startup bundle caps remain unchanged. Website functionality brings total JS to about 1,056,816
  raw / 329,045 gzip bytes; measured caps are 1040 / 322 KiB. Security CSS stays below its existing
  22 KiB ceiling. Current preview includes the five-minute Tailscale file-command limit.

### Path and queued-output checkpoint

- Native Windows IPv4 and IPv6 loopback tests pass. The real IPv6 test caught the packed
  IPV6_ADDRESS_EX layout (address offset 6; outer status offset 28), fixed before browser QA.
  Browser `::1` trace reached the destination in one hop with three replies, without elevation.
  Scoped link-local trace destinations and Darwin probing remain unavailable.
- Optional IPWHOIS attribution uses explicit disclosure, strict CSRF/body validation, public-only
  egress, 32 IPs/two workers/30 seconds, capped response fields and a bounded 15-minute cache.
  Real browser lookup for 1.1.1.1 returned AS13335, Cloudflare ISP and approximate Brisbane labels.
  A loopback lookup showed local/skipped. Saved map labels survived server restart and browser reload,
  preserving separate observed path and inferred attribution provenance. Distinct IPv6 scopes retain
  separate local identities. Provider location is never labeled a measured datacenter.
- Network sections and scan/Nmap/Tailscale links sit in one compact left navigation. Path controls
  load only in the Path section; optional details start collapsed and actual hop replies appear at
  1280×720. Map editing layout still needs its dedicated design pass.
- Downloader now reserves active/waiting/paused output names from the queue snapshot before adding
  work, under the existing queue mutex. Windows comparisons are case insensitive. Overwrite cannot
  steal another queued job's output. Chosen names are retained for retry. Real aria2 integration
  queued two same-name jobs behind a blocked transfer, verified neither output existed yet, then
  verified both completed with distinct expected contents.
- Browser repeated this with a 128 MiB blocker and 1/2 MiB waiting jobs. Waiting files did not exist
  on disk; their reserved names differed. Cancelling the blocker allowed both to complete at the
  expected sizes, with independently read SHA-256 values. The dedicated This Device Traffic section
  showed changing Ethernet RX/TX and three interfaces, then returned idle after leaving/reopening.
  Folder browsing now also works for Taildrop in embedders without an injected transfer engine.
- All Go packages passed after IPv6 changes. Frontend broad run passed 736/737 tests; the one stale
  navigation expectation was updated, and the focused NetworkWorkbench/attribution run passed 24.
  Full validation will run again after the remaining functional changes.

### Cap’n Proto checkpoint

- Added a schema-driven Go RPC adapter with TCP/verified TLS, concrete bootstrap methods,
  exact 64-bit values, schema defaults, groups, unions, nested structs/lists, bounded wire I/O,
  deadlines and cancellation. Source compiler is optional and separately installed; compiled
  CodeGeneratorRequest upload requires no compiler. Source imports stay inside the supplied set.
- Real browser compiled the 14-node/four-method fixture, echoed Unicode/base64/nested values,
  preserved unquoted 9007199254740993 + 7 as exact response string 9007199254741000, and displayed
  remote failures, unknown fields, refusal, malformed JSON, TLS/plaintext mismatch and timeout.
  The first Cancel test exposed native form resubmission after the button changed. Preventing its
  default action fixed it; repeated browser inspection stayed cancelled and the TCP connection closed.
- Official C++ compiler 1.5.0 independently produced schema and payload fixtures. Real Go TCP/TLS
  peers cover custom CA trust, hostname rejection and cleanup. Fuzz parsing completed 54,236 runs
  without failure. A C++ RPC peer, browser file-picker/TLS success and exported-file verification
  remain acceptance gaps; source paste and compiler-independent API upload are tested separately.
- The route uses a left schema/method list and fills the remaining height with request/response
  editors at 1280×720. Request/schema state is session-only. Templates, generic bindings and
  returned-capability workflows remain open. Compiler-check failure now ends in useful feedback;
  invalid UTF-8 sources are rejected instead of silently rewritten.
- Local unstripped binary grew 2,248,704 bytes for the Go runtime. Cap’n Proto adds about 12.7 KiB
  raw / 4.6 KiB gzip JS. Home was made lazy to keep startup caps unchanged. Full license texts ship
  in archives. All Go packages and 740 frontend tests passed before the final error/help edits;
  final combined checks follow those edits. Current-source guide/site/roadmap now describe the
  implemented subset without changing the historical v0.5.0 release.

### Packet inspection checkpoint

- Built-in bounded PCAP/PCAPNG reader decodes Ethernet/VLAN, raw IP, loopback and Linux cooked
  framing, IPv4/IPv6, TCP/UDP/ICMP, DNS questions, HTTP method/status and TLS record signatures.
  It makes no network requests, does not reassemble streams or validate checksums, and retains
  metadata rather than packet payloads. Limits: 16 MiB, 20,000 parsed records, 2,000 retained rows.
- Optional installed dumpcap adapter has fresh interface validation, one literal IP and/or port,
  consent, 1–30 seconds, 2,000 packets, 512-byte snapshots, bounded pipe output and process teardown.
  It requests no promiscuous mode, elevation or driver installation. Captures remain in memory.
- Real Windows host has no dumpcap. Browser verified the actual missing-tool error, then a separately
  built QA executable, explicitly labeled generated/non-network traffic, emitted 75 synthetic HTTP,
  TLS and DNS packets through the complete capture → parse → UI path. Browser pagination showed
  rows 51–75, DNS filtering 25 rows, packet details and no-match filtering. Cancelling a 30-second
  fixture run preserved the earlier report; the process was gone afterward. Native live capture and
  browser file-picker upload remain acceptance gaps. Save metadata was clicked but its downloaded
  filesystem artifact was not located, so export-file verification is not claimed.
- Initial browser layout pushed Start capture below the fold; setup/limits moved into details and
  compact side controls were tightened. Refreshed 1280×720 browser inspection confirmed all closed
  setup controls and Start capture fit without scrolling; the preview was returned to real host capability detection.
  Packet table and selected details use the remaining width and independent scrolling.
- Parser/encoding variants, malformed lengths, cancellation, output caps, CSRF, strict input and
  frontend pagination/filter/lifecycle tests pass. Parser fuzz ran 1,417,586 inputs in eight seconds.
  All Go packages and 84 frontend files / 747 tests pass. Site build and bundle caps pass; startup
  caps remain unchanged. Local unstripped binary increase is 121,344 bytes; packet route about
  13 KiB raw / 4.5 KiB gzip. Idle preview measured 25.7 MB working set / 58.2 MB private allocation,
  not a general performance guarantee. Linux amd64, Darwin arm64 and Windows arm64 cross-builds
  pass; these are compilation checks, not native runtime capture acceptance.

### Saved HTTP request checkpoint

- Added a route-lazy left library with named Save/Update/Load/Delete/Export/Reset, 50 recipes,
  512 KiB total and 64 KiB body opt-in. Existing draft sanitization removes credential values;
  corrupt/oversize/full/unavailable storage does not replace the last good collection.
  A storage event refreshes other tabs. Recipes remain browser-origin local, not host-global.
- Global fuzzy search lazily reads saved names, methods and sanitized URLs when opened. A one-item
  in-memory ID handoff handles already-mounted and lazy HTTP routes. Loading clears old response
  and auth state and never sends HTTP automatically. Missing/deleted recipes produce feedback.
- Browser saved GET /echo with a QA token, reloaded the page, loaded a token-empty URL and explicitly
  received HTTP 200. Updating to POST with an opted-in 39-byte JSON body survived another reload;
  the real echo endpoint returned the exact saved body. Global search from Home found and loaded
  the saved POST into an unsent editor. The active library name/selection was then connected to
  that global load; the refreshed browser confirmed the name, body opt-in and enabled Update action.
- Store/UI/global-route tests cover bounds, credential/body policy, same-ID update, stale deletion,
  storage failure, reset cancellation and no implicit request. Focused runs pass after adjusting
  lazy mount timing. Library import and environment variables remain future work. Initial panel cost
  measured 6.3 KiB raw / 2.4 KiB gzip, with the existing draft codec shared; current budgets pass.

### Native settings and protocol tabs checkpoint

- Settings now has a compact heading and vertical Appearance/Preferences/Downloads/Migration
  sections, independent content scrolling, persistent Save/Reload actions and styled folder controls.
  Drafts remain mounted across section changes. Browser storage failures remain visible until each
  failed preference category is successfully retried. These are session-only changes when saving fails.
- Browser verified 1280×720 Appearance fits without scrolling, host drafts survive section changes,
  folder browsing works, and host settings save/reload through the real service. Dark appearance
  survived a reload; the original light Solarized/compact preferences were restored. At 390×844,
  Settings retains its left section list and scrolls only the controls.
- HTTP and gRPC request/response lists are now vertical. Browser POST returned 200 with the exact
  39-byte body; Arrow Down opened response headers. At 390×844, the response remains usable with a
  Request/Response pane switch. gRPC full-response and selected-message Copy now report failures
  and retries; stale completion is invalidated when displayed evidence changes.
- Full frontend type/lint/test run passed 86 files / 759 tests before the final selected-message
  copy wiring. The additional copy test and final full validation are recorded below. All Go tests
  passed after the host-schema correction. Initial JS caps remain 340 KiB raw / 108 KiB gzip.
  Settings CSS is route-lazy (~14 KiB); all-route JS baseline 1,106,550 raw / 350,226 gzip before
  the last small copy reuse change. All-route caps 1082 KiB raw / 343 KiB gzip remain explicit.

### gRPC host-schema, TLS and IPv6 acceptance checkpoint

- A separately built test server bound only to `[::1]:43117` with a one-day generated QA certificate.
  Browser first rejected it as unknown authority, then connected with the explicit host CA file and
  certificate verification enabled. Reflection exposed 36 KitchenSink methods; Ping returned OK.
  Copy response reported success. No OS trust-store or certificate-verification settings changed.
- Real browser use found that `test.proto` plus an import root failed preflight because validation
  inspected only the working directory. Preflight now follows the compiler's import-relative and
  absolute filename resolution, checking the first matching import root and its size limits.
  Regression coverage includes multiple roots and an oversized file shadowing a later valid file.
  The exact browser case now connects using Host proto paths and invokes Ping successfully over TLS.
- IPv6 port scan of `::1`, ports 43117–43118, reported 43117 open and 43118 closed. An unconventional
  port remains labeled Unknown rather than inferred as gRPC from this TCP-only check.
- Browser file chooser was attempted with a generated 7,399-byte PCAP. Chrome denied `setFiles`
  because extension file-URL permission is unavailable. User was given the documented extension
  setting. This is an automation permission gap, not a successful upload or a native-capture test.

### Remaining acceptance work

Browser file uploads and exported-file artifacts remain unverified under the current Chrome
extension permissions. Real dumpcap capture needs an installed capture backend; none is present.
Native macOS/Linux runtime acceptance cannot be claimed from Windows cross-builds. LAN/Nmap XML
browser import, Cloudflare installed-client/service fixtures and more Tailscale mutation scenarios
remain acceptance gaps. Headscale/NetBird, integrated elevation/sign-in, deeper packet decoding,
HTTP library import/environment profiles and a native service launcher remain roadmap work.
These gaps do not erase the implemented and exercised workflows recorded above.

### Review build validation

- Final frontend: typecheck, Biome checks (existing warnings), 86 test files / 760 tests passed.
  All Go packages passed after the host-schema change. App and documentation-site builds,
  all bundle budgets and `git diff --check` passed. Linux amd64 and Darwin arm64 cross-builds passed;
  earlier Windows arm64 compilation also passed before the final schema-resolution change.
- Optimized Windows review binary: `.local/protopeek-review.exe`, 38,803,968 bytes, built with
  `-trimpath -ldflags '-s -w'`. Review server remains at `http://127.0.0.1:43110`, using the isolated
  QA transfer configuration. A final real HTTP POST returned 200 with the expected body.
  At that point the process used 25,780,224 bytes working set / 58,380,288 bytes private memory;
  this is one observation, not a performance guarantee.
- Removed 45 superseded task-owned build artifacts, reclaiming 2,323,037,453 bytes. Stopped the
  extra gRPC/TLS, Cap'n Proto and transfer fixtures. The HTTP echo fixture remains on 43111 for
  the visible review example. Temporary browser viewport override was reset.
- Pre-existing `web/src/site/App.tsx` edit remains 5 insertions / 1 deletion. No release was
  published, capture driver installed, real Tailscale account changed, or OS trust store modified.

### v0.6.0 release-candidate checks — 7 September

- Fixed PowerShell architecture detection, empty ownership markers and Windows PowerShell 5.1
  treating successful native stderr as a terminating error. Actual HTTP `irm | iex` from System32
  passed initial installation and empty-marker reinstall on Windows PowerShell 5.1.26100.9168 and
  PowerShell 7.6.5, using paths with spaces and the optimized v0.6.0 package. CI repeats both shells.
- Windows x64 embeds the 2,475,379-byte pinned aria2 ZIP. Verified all seven source-companion
  archives and prepared the 11,480,396-byte companion. Stable, edge and snapshot packaging include
  notices and source preparation; archive contract checks verify license/manual paths.
- Promoted current release metadata, README, manuals, crawlable guides, website install copy and
  roadmap to v0.6.0. Historical screenshots retain their original versions. Package-manager versions
  remain independently recorded until their own updates are verified. No analytics script was found.
- Repeated real-browser Cloudflare host inspection: absent client/service correctly produces setup
  guidance and disabled controls. Repeated PCAP file selection is still blocked by Chrome extension
  file-URL permission. This remains an acceptance gap, not a successful native upload/capture claim.
- All 86 frontend files / 760 tests, all Go packages, vet, ineffassign, predeclared and Staticcheck
  pass locally. The actual local Go toolchain is 1.27.0; CI uses the module's Go 1.26 line. Updated
  Staticcheck and isolated predeclared's newer type importer in a development-only tools module.
- Bun 1.3.10 production app/site build and budget checks pass. Its gzip implementation measures
  identical bytes differently from local Bun 1.4/Node: release baseline 363,160 JS / 61,743 CSS gzip
  bytes. Raw and initial startup caps are unchanged; aggregate gzip limits now reflect pinned CI.
- Optimized candidate before the final error-wording cleanup measured 38,804,480 bytes. Browser
  review confirms left workspace navigation, vertical HTTP/settings tabs and independently scrolling
  content. Website Windows install selection shows the pipeline command, bundled engine and shortcut.
- Native capture, browser file uploads and native macOS/Linux interactive acceptance remain the
  limitations recorded above. User authorized commit and publication; CI/release results follow in
  GitHub rather than being inferred from local checks.

### Publication hardening — 7 September

- Cross-platform checks caught a Cap'n Proto socket deadline racing context cancellation and macOS
  fixture paths using the system `/var` symlink. Both were corrected; all three OS Go jobs passed.
- Source packaging now preserves archive bytes when servers advertise gzip content encoding and
  uses the official GNU GMP mirror after repeated primary-host timeouts. Every pinned hash remains
  unchanged. Reading the full source listing fixes a `tar | grep -q` broken-pipe failure in CI.
- Artifact inspection caught the edge publisher selecting an annotated stable tag on the same
  commit. Both publishers now explicitly set `GORELEASER_CURRENT_TAG`. The affected v0.6.0
  candidate was returned to draft; its tag is preserved rather than rewritten.
- Another Windows run hit an access violation matching Go's known 1.26.0/1.26.1 runtime crash
  (golang/go#77975, fixed by #78041 in 1.26.2). The module, development tools and container build
  now require Go 1.26.8. v0.6.1 supersedes the candidate and will receive fresh artifact acceptance.

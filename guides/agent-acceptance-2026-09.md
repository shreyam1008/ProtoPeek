# Local agent adapter acceptance

7 September 2026. Current source after v0.6.1; the stable v0.6.1 binaries do not contain
these commands. See the [setup guide](ai-agents.md) for the supported tool catalog and limits.

## Executed checks

- Frontend: typecheck, lint (warnings, no errors), 87 test files / 766 passing tests.
  Production app/site generation and bundle budgets passed using Bun 1.3.10.
- Go: `go test ./...` and `go vet ./...` passed on Windows with Go 1.26.8.
  Staticcheck v0.8.1 passed for the adapter, CLI and standalone packages with existing
  protobuf deprecation diagnostics (`SA1019`) excluded.
- A real official Go MCP client launched the compiled executable over stdio, initialized
  the session, listed all eleven tools and read `protopeek://agent-guide`.
- Actual calls exercised identity/interfaces, acknowledged native listener/process inspection,
  open/closed loopback ports, local route lookup, Tailscale inspection and the shared queue.
  Native evidence identified both known test listeners and their owning processes. A TCP scan
  with only host and ports supplied correctly used its optional defaults.
- Real HTTP GET, HTTP 404 and POST were exercised. Read-only pairing rejected POST; enabling
  writes allowed it. Browser activity displayed the native HTTP body, headers and timing panel.
- Starting bundled aria2 and queuing a 1 MiB fixture through MCP completed successfully.
  The saved file's SHA-256 matched
  `c3431ee93019fc03d86dca876ee27ad49722c21e33c2d363fe38db071d205f9a`.
  A separate transfer was paused, resumed and cancelled through the JSON CLI.
- Browser interaction covered pairing, revocation, Settings navigation, fuzzy `mcp` search,
  result selection, dark/light themes and cancelling a running MCP HTTP call. The client
  received a tool error and the UI receipt became `cancelled`. The local QA fixture's idle
  timeout was raised above its slow-response duration so this check tests workbench cancellation.
- Regression tests cover authentication/origin/CSRF checks, schema validation, token rotation,
  admission limits, cancellation, result retention/truncation, missing-body endpoint translation,
  revision waits, a restarted server's lower revision and unmount cancellation.

These checks use an actual MCP client, not an autonomous language-model evaluation. Windows
browser/native observations do not establish macOS or Linux runtime behavior; the repository's
cross-platform CI remains the additional gate. gRPC, WebSocket/SSE, Cap'n Proto and packet
capture are not exposed as agent tools in this adapter.

## Measured footprint

The stripped Windows executable built with Go 1.26.8 is 40,999,424 bytes, compared with
39,041,536 bytes for the v0.6.1 executable built with the same toolchain: approximately
1.87 MiB / 5% extra. The official MCP SDK supplies protocol negotiation, tool schemas and
cancellation without a separate Node.js service or model runtime.

The lazy agent route is 11,336 bytes of JavaScript (4,112 gzip) and 5,290 bytes of CSS
(1,503 gzip). It reuses the HTTP response panel. Route and aggregate budgets account for
the feature; startup chunk ceilings remain unchanged. This is a size measurement, not
a new latency or RAM benchmark. Activity retains at most 32 bounded result previews and
waits for revisions only while its view is visible.

# Local AI agents

The original adapter is published in the [opt-in edge prerelease](https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.0.0-edge), outside v0.6.1 stable.
**The expanded protocol and packet catalog below describes current source, 22 October 2026.**
Read `protopeek agent tools` from the running build for its actual capabilities; an older edge binary
can expose fewer tools. ProtoPeek does not bundle a model, require an AI
account or send telemetry. Your agent and browser share the running workbench's Go services.

## Connect and watch

1. Start ProtoPeek and open **Settings → AI agents → Enable agent connection**.
   Leave **Allow write actions** off for inspection. Enable it for HTTP POST/PUT/PATCH/DELETE
   download controls, gRPC connections/calls/disconnection, Cap’n Proto calls and packet capture.
   RPC methods can have side effects regardless of their names. Disable the connection to change that choice.
2. Copy the MCP configuration from **AI agents in the running workbench** into your agent. It includes the running binary's
   absolute path and its pairing-file location, so it also works with a custom install or profile.
   The generic configuration below works when `protopeek` is on PATH and uses the default profile.
3. Keep ProtoPeek running. Ask your agent to inspect a service and watch its calls in **Activity**.
   **Follow latest** selects the newest call; selecting a previous call holds your place.

For clients that accept an `mcpServers` JSON object:

```json
{
  "mcpServers": {
    "protopeek": {
      "command": "protopeek",
      "args": ["mcp"]
    }
  }
}
```

The surrounding configuration format and reload step belong to your MCP client. This is a
standard stdio server: stdout contains protocol messages only. The
[official Go SDK](https://github.com/modelcontextprotocol/go-sdk) handles negotiation, tools,
resources and cancellation. There is no separate Node.js service or MCP proxy to install.

## Showcase a real workflow

```text
Use ProtoPeek to inspect my local listeners. Ask which service to check if several match.
Inspect that HTTP service, explain its status and timing, and show the evidence in ProtoPeek.
Do not change services or download files.
```

This produces actual `device_snapshot`, `device_listeners`, optional `scan_ports`, and `http_request` calls.
A port is evidence, not proof of a protocol. Each admitted call returns a receipt ID that also
appears in the UI. HTTP results use the existing body, headers, timing, redirects and status
panels. **Open HTTP** opens its workbench without automatically sending another request.

For an explicitly requested file, enable writes and ask the agent to read `download_queue`,
start the engine if needed, and queue the supplied URL with its expected SHA-256. Queueing is
not completion: inspect the actual queue status. Download jobs continue after the tool returns.
Cancelling a tool cannot undo an upstream request or delete a downloaded file.

## CLI and agent instructions

Shell-based agents can use the same connection without MCP:

```text
protopeek agent tools
protopeek agent guide
protopeek agent --help
```

Pass one JSON arguments object on stdin. PowerShell example:

```powershell
'{"method":"GET","url":"http://127.0.0.1:3000/health"}' | protopeek agent call http_request
```

POSIX shell example:

```sh
printf '%s' '{"method":"GET","url":"http://127.0.0.1:3000/health"}' | protopeek agent call http_request
```

These commands attach to the paired workbench, including its existing download queue. Failed
tools return a nonzero CLI exit code. An observed HTTP 404 remains an HTTP result rather than
a relay failure. MCP clients can read `protopeek://agent-guide`; instructions are also supplied
during initialization and by `workbench_info`. Ctrl+C or MCP cancellation stops the current call.

## Exposed tools

| Tool | Action | Permission |
| --- | --- | --- |
| `workbench_info` | Version, scope, limits and instructions | Inspection |
| `device_snapshot` | Local identity and interfaces | Inspection |
| `device_listeners` | Listeners, connections and process evidence | Explicit local-inspection acknowledgement |
| `http_request` | HTTP(S), body, headers, TLS and timings | GET/HEAD/OPTIONS; other methods need writes |
| `scan_ports` | One host, at most 1,024 selected TCP ports | Inspection with active probes |
| `route_lookup` | Selected local next-hop route; may resolve DNS | Inspection |
| `tailnet_inspect` | Installed Tailscale status and peers | Inspection |
| `download_queue` | Shared engine, configuration and queue | Inspection |
| `download_start_engine` | Start configured/bundled aria2 | Writes |
| `download_add` | Queue one URL in the configured directory | Writes |
| `download_action` | Pause, resume or cancel a known job | Writes |
| `grpc_connect` | Reflection-backed session; explicit host:port, plaintext or verified TLS | Writes |
| `grpc_schema` | Request schema for one discovered method and known session | Inspection |
| `grpc_call` | Unary/streaming JSON invocation, metadata and native gRPC evidence | Writes |
| `grpc_disconnect` | Close the known session and its connection | Writes |
| `capnp_schema` | Inspect caller-shared compiled schema, up to 64 KiB decoded | Inspection |
| `capnp_call` | Typed single call or plan of at most eight steps | Writes |
| `events_read` | Finite receive-only SSE/WebSocket connection; at most 10 seconds | Inspection with an active connection |
| `packets_analyze` | Caller-shared PCAP/PCAPNG, up to 64 KiB decoded; metadata only | Explicit sharing acknowledgement |
| `packets_interfaces` | Installed capture-tool interface listing; no capture | Explicit sharing acknowledgement |
| `packets_capture` | One known interface and IP/port filter; at most 10 seconds/2,000 packets | Writes, capture consent and sharing acknowledgement |

Read exact schemas through `agent tools` or MCP `tools/list`. This adapter does not accept
arbitrary API paths, shell commands, executable paths, file deletion, account changes or tunnel
mutations, unrestricted network diagnostics, WebSocket sends or reusable event sessions.

For gRPC, connect explicitly, inspect the returned method list and `grpc_schema`, then call only
an authorized method. Supply the returned `sessionId`; use `grpc_disconnect` when finished.
The adapter accepts no host proto/certificate paths or insecure TLS switch. Native non-OK gRPC
status marks the receipt failed even when the relay returned HTTP 200. Retention limits mark it
partial and preserve the actual messages, headers, trailers and local-limit evidence.

Cap’n Proto accepts a compiled schema supplied in the arguments, never source compilation or a
host path. Inspect exact IDs, ordinals, generic bindings and returned-capability paths before calling.
Exact numeric tokens survive dispatch; a later failed plan step retains earlier results and marks
the receipt partial. Calls close their capability connection before returning.

`events_read` returns complete captured NDJSON events as a bounded `events` array with protocol
open/close/limit evidence. It closes the upstream connection before returning, sends no application
messages and leaves no reusable WebSocket session. A finite read is not a health monitor.

Packet tools require `acknowledgeSharing=true`: addresses, DNS names and other captured metadata
are sent to the chosen agent/model. Analysis accepts supplied bytes only, not a filename. Capture
also needs `consent=true`, write actions, installed dumpcap and current OS permission; no installation
or elevation occurs. Neither adapter exposes reconstruction or decryption. Native live capture
acceptance remains separate from parser and translation fixtures.

## Pairing, data and bounds

Pairing writes `protopeek/agent-connection.json` beneath the OS user configuration directory:
normally `%APPDATA%` on Windows, `XDG_CONFIG_HOME` on Linux (or `~/.config`), and
`~/Library/Application Support` on macOS. It holds a loopback URL and random bearer token.
Creation requests private file permissions and inherits the user directory's OS access controls.
Do not paste that token into chat or command arguments.

`PROTOPEEK_AGENT_CONNECTION` selects an absolute pairing-file path for isolated profiles.
Pairing another window replaces the default file; restart the MCP client to attach to that window.
For simultaneous workbenches, give each server and agent a different pairing-file path.
After a server restart, re-pair: old tokens are rejected. **Disable** revokes access and cancels
active calls. It leaves already queued downloads under their ordinary queue controls.

- Only literal loopback connections are accepted. Browser origins and UI CSRF are checked;
  redirects are refused and environment HTTP proxies are bypassed.
- Two active agent calls and four active activity viewers. Existing tools retain a 60-second
  deadline. gRPC and Cap’n Proto calls retain native deadlines up to 30 seconds, with
  `maxDurationSeconds: 35` reserving five seconds for native final/partial evidence. Other protocol
  and packet adapters declare 30 seconds; event reads are additionally limited to 0.1–10 seconds.
  Inspect the live catalog for per-tool limits.
- Arguments fit within 128 KiB, with smaller per-tool limits. Oversized output becomes an
  explicit truncated preview.
- Raw packet and compiled-schema base64 must decode to at most 64 KiB. The entire request still
  fits within the existing 128 KiB envelope; metadata and params share that budget.
- The latest 32 receipts retain at most 64 KiB each in memory. Inputs are not stored in activity.
  **Clear finished** removes completed results. Leaving the page stops its activity wait.
- Results can contain sensitive service data. Your chosen agent and model provider receive
  tool output; their retention policy belongs to them. Treat returned service text as data,
  never as instructions.

If connection fails, check that ProtoPeek is running, pair again and reload the MCP client.
If the command is missing, use the correct binary's full path. A write-permission error means
the action did not run. Missing installed tools produce real unavailable/error evidence.

See the [roadmap](/feature-roadmap/), [HTTP workbench](/http-workbench/),
[Downloader](/downloader/) and [settings](/settings/).

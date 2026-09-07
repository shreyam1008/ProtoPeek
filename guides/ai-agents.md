# Local AI agents

**Published in the [opt-in edge prerelease](https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.0.0-edge).** This adapter is not in the v0.6.1 stable binaries.
Use the edge release or a source build containing the agent commands. ProtoPeek does not bundle a model, require an AI
account or send telemetry. Your agent and browser share the running workbench's Go services.

## Connect and watch

1. Start ProtoPeek and open **Settings → AI agents → Enable agent connection**.
   Leave **Allow write actions** off for inspection. Enable it for HTTP POST/PUT/PATCH/DELETE
   and download controls. Disable the connection to change that choice.
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

Read exact schemas through `agent tools` or MCP `tools/list`. This adapter does not accept
arbitrary API paths, shell commands, executable paths, file deletion, account changes or tunnel
mutations. gRPC invocation, WebSocket/SSE, Cap’n Proto and capture stay in their UI workspaces;
they are not MCP tools in this first adapter.

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
- Two active agent calls, four active activity viewers, and a 60-second call deadline.
- Arguments fit within 128 KiB, with smaller per-tool limits. Oversized output becomes an
  explicit truncated preview.
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

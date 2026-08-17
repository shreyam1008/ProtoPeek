# ProtoPeek Feature Roadmap

This file records the current product shape after the ProtoPeek overhaul and the next areas that are still worth building.

## Shipped gRPC core

1. Schema-first command rail
ProtoPeek keeps services and methods visible in a searchable sidebar instead of stacking discovery behind generic dropdowns.

2. Workspace launcher and target registry
`protopeek` and `pp` can now start with no target argument. The launcher stores one or more transport-aware gRPC targets and reconnects to them from the browser UI.

The launcher also checks common loopback ports automatically. Scanning private IPs requires an explicit opt-in, and the scan rejects public addresses and arbitrary hostnames.

3. Starter payload generation
ProtoPeek turns reflected protobuf request schemas into ready-to-edit JSON scaffolds, including nested messages and enums.

4. Proto structure explorer and exporter
The console now exposes file-level proto topology, nested messages, enums, dependencies, raw `.proto` text, and exportable catalog JSON.

5. Metadata presets
Default metadata and session-edited headers stay visible, editable, and portable. A Bearer helper, deadline control, and an explicit persistence note keep authentication work fast without hiding the local-storage boundary.

6. Collections and team handoff
Requests can be saved locally with notes, replayed without rebuilding payloads, and moved between teammates as JSON.

7. Response lab
Headers, trailers, status, and latency are shown together. Streaming responses retain their real arrival order and elapsed time in a searchable message timeline, with focused JSON copy and export.

8. Assertions and validation
ProtoPeek runs local assertion rules against status, latency, metadata, and payload text without adding a heavyweight scripting sandbox.

9. Simulation studio
A lightweight concurrency runner estimates success rate, throughput, and p50/p95/p99 latency for unary request flows.

10. gRPC-Web topology lens
The site and the embedded console explain browser limits, Envoy bridging, debugging pain points, and why gRPC-Web changes the operational story.

11. Keyboard-first call loop
`Cmd/Ctrl+Enter` invokes or cancels, `/` focuses method search, and `Cmd/Ctrl+K` opens a command palette that can jump to workbench tools or reflected methods.

12. Responsive request/response workbench
Desktop keeps request and response evidence side by side. Mobile uses explicit Request and Response tabs, a persistent invoke action, and a drawer for service navigation.

## Why these features matter

- Postman’s gRPC interface sets the baseline for discoverable method selection, metadata handling, and reusable request flows.
- The gRPC docs emphasize reflection, metadata, debugging, and benchmarking as first-class workflow concerns.
- ProtoPeek’s differentiator is staying explicitly gRPC-aware instead of acting like a transport-agnostic API shell.
- The launcher, structure explorer, and simulation surface matter because incident debugging usually starts with contract discovery and endpoint switching, not with an already-perfect request body.

## Next wave

1. Flow-level hooks for streaming RPCs
The current assertion model is intentionally lightweight. Ordered streaming evidence and cancellation are shipped; the next step is opt-in on-message checks and reusable flow validation.

2. Channelz and grpcdebug bridge
ProtoPeek should become the front door from request inspection into runtime inspection when the real problem is transport state rather than payload content.

3. Shareable benchmark reports
The simulation studio already produces useful local data. The next step is exportable reports for incident reviews and performance baselines.

HTTP and Cap'n Proto remain separate future experiments. They should not enter the default binary or UI until the gRPC adapter boundary, security model, and bundle budgets are proven.

## Research trail

- TypeScript native preview: https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/
- Tailwind docs/blog: https://tailwindcss.com/blog
- Postman gRPC interface: https://learning.postman.com/docs/sending-requests/grpc/grpc-request-interface/
- Postman test scripts: https://learning.postman.com/docs/postman/scripts/test_scripts/
- gRPC guides index: https://grpc.io/docs/guides/
- gRPC-Web basics: https://grpc.io/docs/platforms/web/basics/
- Envoy gRPC overview: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_protocols/grpc.html
- gRPC debugging guide: https://grpc.io/docs/guides/debugging/

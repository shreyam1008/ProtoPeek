# ProtoPeek protocol roadmap

ProtoPeek is **Protocol Peek**: a local workbench for understanding the path from a
request to a server response. It is not trying to become a cloud API-management suite or a clone of
Postman. Its advantage is that difficult protocols remain explainable: the request editor, the
transport events, and the final evidence stay close together.

## Product contract

### What ProtoPeek is

- A single-binary, local-first console with no account, remote sync, or external database.
- A shared shell for targets, request editing, response evidence, local history, cancellation, and
  session lifecycle.
- A family of protocol adapters. Each adapter owns discovery, schemas, invocation, validation,
  cancellation, and protocol-native inspection.
- A tool that makes the request-server boundary legible under time pressure.

### What ProtoPeek is not

- A generic JSON box that hides gRPC trailers, Cap'n Proto capabilities, or HTTP status semantics.
- A cloud workspace, script marketplace, cookie automation layer, mock-server platform, or team
  collaboration product.
- A promise that every protocol belongs in the default binary. Future adapters should be opt-in when
  they add meaningful binary, dependency, or security cost.

## Current workbench: gRPC + HTTP

The gRPC adapter remains the quality bar for protocol-native depth:

1. Discover services through reflection, loopback scan, `.proto`, or protoset sources.
2. Keep service and method selection visible in a searchable rail with unary, server-stream,
   client-stream, and bidirectional modes.
3. Generate an editable request payload from the reflected schema.
4. Invoke locally with deadlines, cancellation, plaintext/TLS choices, metadata, and Bearer helpers.
5. Render ordered response messages, headers, trailers, final status, and timing together.
6. Preserve saved requests, secret-sanitized history/default export, checks, and command shortcuts
   without a server account.
7. Keep the local safety boundary explicit: loopback discovery by default and no arbitrary public
   network probing.

The HTTP adapter is the first additional protocol slice:

1. Send an explicit HTTP(S) method, URL, headers, and body through the local Go server.
2. Keep TLS verification on and redirect following off by default.
3. Bound request envelopes, request and response bodies, header counts, timeouts, and redirects.
4. Support cancellation and show status, HTTP protocol, headers, text/base64 body, byte count,
   truncation, redirect hops, remote address, TLS summary, and DNS/connect/TLS/TTFB/total timing.
5. Keep automatic local history secret-safe; credentials remain editable for the live request but
   are redacted before persistence or default export.
6. Preserve HTTP vocabulary instead of presenting HTTP as a gRPC-shaped or generic JSON call.

## Shared adapter architecture

```text
local CLI / web server
        |
console shell: target -> operation -> request -> response evidence
        |
        +-- gRPC adapter       reflection | .proto | protoset
        +-- HTTP adapter       explicit HTTP(S) URL | standard library transport
        +-- Cap'n Proto adapter planned: schema file | capability bootstrap
        +-- future adapters    only after a native UX + safety review
```

The shared boundary stays deliberately small:

| Boundary object | Shared responsibility | Adapter-owned detail |
|---|---|---|
| `Target` | identity, transport kind, local storage | TLS, capability bootstrap, URL/auth configuration |
| `Operation` | selectable operation and display name | RPC method, HTTP route, capability call, schema |
| `Invocation` | deadline, cancellation, request messages | encoding, framing, retries, stream semantics |
| `TransportEvent` | ordered timeline and timestamps | trailers, segments, status/headers, body chunks |
| `Inspector` | shell placement and navigation | native vocabulary, validation, evidence rendering |

Do not erase protocol differences to make the types look uniform. The shell can count messages and
show timing consistently, but the inspector must say “gRPC trailers”, “Cap'n Proto capability”, or
“HTTP response headers” when that is what the user is looking at.

## Delivery plan

### Phase 1 — gRPC hardening (live)

The reference adapter currently preserves:

- reflection, proto, and protoset schema paths;
- unary, client-streaming, server-streaming, and bidirectional invocation;
- visible request metadata, deadlines, cancellation, response headers, messages, trailers, status,
  and timing;
- bounded loopback discovery plus an explicit-target policy that reports reflection and transport
  outcomes separately;
- credentials and binary metadata kept out of automatic history and default exports.

Channelz links, pre-invoke hooks, and richer flow reports are proposals, not current controls. They
need fixtures and a native evidence model before entering the workbench.

### Phase 2 — bounded HTTP / REST (live)

The first HTTP adapter supports one explicit request path: method, URL, query params, headers,
live auth input, raw body, timeout, redirect choice, cancellation, and a native response inspector.
It uses Go's standard HTTP stack and accepts only `http` and `https` URLs. TLS verification is on
and redirect following is off by default.

This slice deliberately excludes OpenAPI discovery, a cookie jar, cloud sync, script runners, mock
servers, OAuth app marketplaces, and team workspaces. Those features are not implied by the HTTP
surface and would require separate product and security review.

### Phase 3 — Cap'n Proto experiment (planned and gated)

Start with one useful, local path rather than a large protocol surface:

1. Accept a schema file and an explicit capability bootstrap configuration.
2. Discover one unary operation and generate a typed editable request.
3. Show message segments, capability resolution, and call outcome in a Cap'n Proto inspector.
4. Keep the adapter behind an experimental flag or optional companion until dependency and binary
   costs are measured.
5. Add fixture servers and failure cases for missing capabilities, malformed segments, and timeout.

Exit gate: a user can understand what capability was requested, what was sent, and why a call failed
without reading a generic JSON translation.

### Phase 4 — route trace and LAN discovery (planned and gated)

- Route trace must be attached to a supported request path, expose its data source and uncertainty,
  and have fixtures for partial or unavailable evidence before a control is added.
- LAN discovery must be explicitly enabled for a previewed private range, enforce strict candidate
  and time budgets, support cancellation, and never become ambient or public scanning.
- Neither item appears as a request-surface tab until its gate is met.

### Phase 5 — protocol shelf (later)

SMTP, FTP, and other request-server protocols are candidates, not commitments. For each one, write
a short protocol brief before implementation:

- What is the smallest useful local request?
- What is the native evidence (envelope, command transcript, status, stream, capability, or body)?
- What credentials or destructive actions need an explicit boundary?
- Can it ship as an opt-in adapter without bloating the gRPC path?
- What failure states deserve a dedicated inspector rather than a generic error banner?

If those answers are weak, keep the protocol in research instead of adding a superficial tab.

## UX rules for every adapter

1. **Less typing, more signal.** Discover local targets and schemas where safe; never silently probe
   arbitrary public hosts.
2. **One obvious primary action.** The request workspace should make invoke/send easy to find and
   cancellation equally clear.
3. **Evidence beside the action.** Put headers, trailers, status, timing, and native details near
   the response, not behind an unrelated settings screen.
4. **Protocol words matter.** Do not call every result “response JSON” when it is a stream, segment,
   capability, or HTTP body.
5. **Local means local.** Do not introduce an account to make the core workflow work. Redact
   credentials and binary metadata from automatic history and default exports.
6. **Keyboard and narrow screens count.** Preserve command palette, search, shortcuts, and a useful
   mobile request/response flow.

## Verification gates

Before an adapter is called shipped:

- unit and contract tests cover discovery, invocation, cancellation, malformed input, and timeouts;
- a local fixture server exercises successful and failure paths;
- default gRPC startup time and bundle size do not materially regress;
- secrets are not persisted accidentally;
- browser QA proves the primary action, response evidence, error state, and narrow layout;
- README, website, roadmap, product metadata, and screenshots all describe the same current state;
- the adapter has a rollback flag or can be omitted from the default binary.

## Research trail

- [gRPC guides](https://grpc.io/docs/guides/)
- [gRPC debugging](https://grpc.io/docs/guides/debugging/)
- [gRPC-Web basics](https://grpc.io/docs/platforms/web/basics/)
- [Envoy gRPC overview](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_protocols/grpc.html)
- [Postman gRPC request interface](https://learning.postman.com/docs/sending-requests/grpc/grpc-request-interface/)

# Competitive landscape and product decisions

**Last reviewed:** 20 August 2026

**Evidence policy:** current first-party product documentation and official project repositories only.

This is a workflow comparison, not a feature-count scorecard. ProtoPeek is a lightweight, local
protocol workbench: it should learn from mature clients without becoming a cloud API platform, a
general automation runtime, or a packet-capture engine. A candidate below is research input, not a
roadmap commitment. Revalidate the linked source before using a row in a product decision because
other products can change independently of this repository.

## Decision matrix

| Product | Useful documented workflow | ProtoPeek v0.3 overlap | Deliberate ProtoPeek boundary | Candidate next step |
| --- | --- | --- | --- | --- |
| [Postman gRPC](https://learning.postman.com/latest-v-12/docs/use/send-requests/protocols/grpc/grpc-request-interface) | Reflection or imported Protobuf definitions, all four RPC modes, a sent/received stream timeline, metadata/TLS controls, saved examples, and JavaScript hooks before invoke, per message, and after response. | Reflection, host `.proto`/protoset sources, temporary browser-folder snapshots, all RPC modes, metadata, deadlines, headers, trailers, status, local saved requests/assertions, Health Watch, and bounded Unary Repeat. | Do not require an account or hosted workspace, and do not add a general JavaScript/package sandbox to the core binary. Protocol evidence remains more important than collection-platform breadth. | Finish bounded incremental delivery for arbitrary streams. Evaluate reusable local examples and a few deterministic gRPC assertions before any general scripting surface. |
| [Kreya](https://kreya.app/docs/operations/grpc/) | File-backed operations with multi-message client/bidirectional control; reflection, descriptor-set, or local-proto importers; project/directory defaults, environments, templating, certificates, and centralized authentication. | Target profiles, schema-source selection, saved local gRPC recipes, environments, metadata/Bearer input, TLS files, and workspace import/export. | Do not reproduce a broad multi-protocol project runner or automatic login/authentication framework. Secret handling must remain explicit, bounded, and local. | Explore folder-scoped defaults and a small, typed variable surface whose export behavior is obvious and secret-safe. |
| [Insomnia](https://developer.konghq.com/insomnia/grpc-requests/) | Single-file or directory Protobuf input, server reflection or Buf Schema Registry reflection, all four RPC modes, and TLS. Its current gRPC page also documents no unit testing, chaining, deadlines, or request/response history for gRPC. | Reflection and bounded browser-folder input cover the common local schema paths; ProtoPeek already exposes deadlines, local assertions, and secret-safe history/workspace recovery. | Do not make a remote schema registry or hosted project a prerequisite. Do not flatten gRPC into the same evidence model as HTTP. | Borrow the clearest manual client-stream/bidirectional controls. Consider a remote descriptor source only as an explicit optional adapter with a measured credential and network boundary. |
| [Bruno](https://docs.usebruno.com/send-requests/grpc/grpc-request) | A local-first, Git-friendly collection stored on disk; gRPC reflection or proto files; unary, server-streaming, client-streaming, and bidirectional calls. Bruno also has a CLI workflow for collections. | Local-first browser storage, versioned workspace JSON, reflection/proto sources, all RPC modes, keyboard invocation, and no hosted service requirement. | Do not add Electron/Node to the Go distribution or invent a second request DSL merely to claim Git friendliness. An exported workspace must remain bounded and reviewed before sharing. | Make exported workspace JSON deterministic and diff-friendly, then evaluate a headless validation mode before a general collection runner. |
| [grpcurl](https://github.com/fullstorydev/grpcurl) | Scriptable JSON/text command-line invocation, reflection/proto/protoset discovery, all RPC modes including interactive bidirectional streams, metadata, TLS/mTLS, and shell pipelines. | ProtoPeek already builds on the `grpcurl` Go library for descriptor loading, dialing, and invocation, while adding a browser inspector, saved targets, health diagnostics, and transport evidence. | Do not shell out to an unknown executable or hide quoting, metadata, and credential risks behind automatic command execution. The browser remains the primary interactive surface. | Add reviewed, redacted **Copy as grpcurl** output; consider paste/import only with a real parser, strict option allowlist, and no shell evaluation. |
| [Wireshark](https://wiki.wireshark.org/grpc) | Packet capture and filtering, HTTP/2 stream inspection, gRPC/Protobuf dissection with schema information, gRPC-Web handling, and TLS decryption when appropriate secrets are supplied. | ProtoPeek provides request-level gRPC/HTTP evidence, read-only kernel-selected next-hop evidence, and bounded offline Nmap XML hints. It does not observe packets. | Do not bundle privileged live capture, packet-driver lifecycle, broad dissector maintenance, or TLS-key ownership into the lightweight core. Never present callback timing as packet timing. | Research a bounded offline PCAP inventory plus an explicit Wireshark/TShark handoff. Require limits, redaction/export rules, and fixture evidence before adding UI. |
| [BloomRPC (archived)](https://github.com/bloomrpc/bloomrpc) | Historically offered a focused GUI for exploring and querying gRPC services. The owner archived it in January 2023 and explicitly says its use is no longer recommended. | ProtoPeek keeps the useful single-purpose path—a local binary opening a focused browser UI—while maintaining current Go/React release and fixture coverage. | Do not treat an archived product as a current parity target or inherit its unmaintained Electron stack. Simplicity without compatibility and release discipline is not enough. | Treat sustained reflection, import, streaming, and cross-platform fixture coverage as product work; do not add a feature solely because the historical UI had it. |

## Decisions that follow from the comparison

1. **Preserve native gRPC evidence.** Every stream improvement must keep message order, headers,
   trailers, final status, cancellation, and the distinction between callback-observed and wire
   timing visible.
2. **Prefer portable local artifacts over accounts.** Deterministic workspace export, reviewed
   examples, and redacted command output fit ProtoPeek. Hosted sync and opaque cloud state do not.
3. **Add automation narrowly.** Assertions, bounded repeat, health diagnostics, and a future
   headless validator are easier to reason about than an embedded general-purpose script runtime.
4. **Interoperate instead of absorbing tools.** Generate or parse a constrained `grpcurl` contract;
   hand packet evidence to Wireshark. Do not execute arbitrary shells or recreate a dissector suite.
5. **Measure every adapter.** A candidate needs a fixture, dependency/binary-size evidence,
   cancellation and malformed-input tests, secret/export rules, and a native inspector before it can
   move into the product roadmap.

## Official sources reviewed

All sources were checked on 20 August 2026.

- Postman: [gRPC client interface](https://learning.postman.com/latest-v-12/docs/use/send-requests/protocols/grpc/grpc-request-interface),
  [service definitions](https://learning.postman.com/latest-v-12/docs/use/send-requests/protocols/grpc/using-service-definition),
  [gRPC scripting](https://learning.postman.com/docs/use/send-requests/protocols/grpc/scripting-in-grpc-request),
  and [saved examples](https://learning.postman.com/latest-v-12/docs/use/send-requests/protocols/grpc/using-grpc-examples).
- Kreya: [gRPC operations](https://kreya.app/docs/operations/grpc/),
  [gRPC importers](https://kreya.app/docs/importers/grpc/),
  [environments](https://kreya.app/docs/environments/), and
  [authentication](https://kreya.app/docs/authentication/).
- Insomnia: [gRPC requests](https://developer.konghq.com/insomnia/grpc-requests/) and
  [request collections](https://developer.konghq.com/insomnia/collections/).
- Bruno: [gRPC requests](https://docs.usebruno.com/send-requests/grpc/grpc-request),
  [gRPC proto files](https://docs.usebruno.com/send-requests/grpc/grpc-proto), and
  [local/Git/CLI quick start](https://docs.usebruno.com/introduction/quick-start).
- grpcurl: [official repository and usage guide](https://github.com/fullstorydev/grpcurl).
- Wireshark: [gRPC dissector documentation](https://wiki.wireshark.org/grpc),
  [Protobuf dissector documentation](https://wiki.wireshark.org/Protobuf), and
  [TLS documentation](https://wiki.wireshark.org/tls).
- BloomRPC: [official archived repository and retirement notice](https://github.com/bloomrpc/bloomrpc).

## Maintenance rule

Review this file before a protocol-roadmap change and at least once per stable release. Update the
date, remove claims that an official source no longer supports, and record a candidate in the
roadmap only after ProtoPeek's own product and verification gates accept it.

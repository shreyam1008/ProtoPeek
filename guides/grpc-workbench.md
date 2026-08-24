# gRPC workbench

ProtoPeek keeps a gRPC request, its schema, and the evidence returned by the selected service in one local workspace. The workbench ships in stable v0.5.0.

## Connect one target

Enter a host and port, then choose plaintext or verified TLS deliberately. Successful targets can stay in this browser so moving between local services does not require restarting ProtoPeek.

The bounded target check distinguishes four useful outcomes: reflected gRPC, gRPC without reflection, an HTTP response, or open TCP. It does not silently probe arbitrary public networks.

## Choose the schema source

ProtoPeek can learn a service through:

- server reflection;
- one temporary browser-selected `.proto` folder;
- host `.proto` files and import roots available to the ProtoPeek process; or
- a compiled protoset produced by a build pipeline.

A browser folder is a bounded in-memory snapshot. ProtoPeek saves no browser handle, file bytes, folder name, or host path, so the folder must be selected again after reload.

## Send the native RPC shape

Search the service and method rail, then edit the schema-generated JSON request. Unary, server-streaming, client-streaming, and bidirectional methods stay visibly different.

The request keeps metadata, Bearer auth, deadlines, TLS choices, and cancellation beside the payload. Binary metadata and credential-like values are excluded from automatic history and default exports.

## Read the response in order

ProtoPeek separates:

1. response headers;
2. ordered response messages;
3. response trailers;
4. the final gRPC status; and
5. lifecycle timing observed by the local ProtoPeek handler and browser relay.

Those timings are not packet arrival, server processing time, or universal TTFB. If a local response limit ends the call, retained messages remain visible and the unobserved server status is not invented.

## Reuse a request carefully

Saved requests, environments, assertions, recent calls, and workspace import/export stay in local browser storage. Default exports redact sensitive metadata, but saved request bodies are deliberate workspace data and must be reviewed before sharing.

Unary Repeat runs 2–50 sequential real RPCs with cancellation, explicit deadlines, partial evidence, and separate transport versus gRPC-status outcomes. It is a diagnostic aid, not a load generator; every call may change server data.

## Ask Health directly

When the selected service exposes canonical `grpc.health.v1.Health`, ProtoPeek can run one Check or a bounded Watch. Watch is one user-started server stream, never background polling or fleet-wide health proof.

## Go deeper

- [Learn the protocol concepts behind the workbench](/learn-grpc/).
- [See the shared transport and safety boundary](/transport-boundaries/).
- [Install stable ProtoPeek v0.5.0](/install/).


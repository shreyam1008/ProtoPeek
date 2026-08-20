# Launch Post Draft

Title: ProtoPeek: a local gRPC and HTTP workbench for debugging the real protocol

ProtoPeek is an independent local workbench focused on the parts teams need when debugging gRPC and HTTP services:

- A responsive, search-first method rail
- Reflected schema visibility
- One-shot browser proto-folder snapshots for reflection-disabled services, with nested imports and
  no persisted folder authority
- JSON starter payload generation
- Local collections and history
- A response lab that keeps headers, trailers, payloads, and status together
- Bounded sequential Unary Repeat with cancellation, separate gRPC status and relay/transport failures, and explicit handler-vs-console timing—never presented as a load benchmark
- Explicit canonical gRPC Health Check/Watch with bounded live transitions, cancellation, and no background polling or retry
- A separate HTTP(S) editor with redirects off and TLS verification on by default
- HTTP status, protocol, headers, text/base64 body, redirects, peer/TLS context, and phase timings
- A public learn page that explains gRPC, gRPC-Web, Envoy, and why debugging gets hard

Why rebuild it?

Because gRPC is not just “REST with different syntax,” and HTTP is not gRPC without descriptors. The workbench keeps the transport model and evidence for each surface visible instead of flattening both into one JSON client.

ProtoPeek tries to stay small and practical:

- Single Go binary
- Scratch-friendly Docker image
- Local-first workspace model
- Modern TypeScript frontend with a measured embedded asset budget

Browser folder means a bounded snapshot uploaded to the running ProtoPeek process, not background
filesystem access and not an upload to the gRPC service. Host proto/protoset paths remain a separate
process-authority mode.

Project links:

- Repo: https://github.com/shreyam1008/ProtoPeek
- Site: https://protopeek.shreyam1008.com.np/

Historical note:

- The GitHub repository was created on March 26, 2026 from a fork of `fullstorydev/grpcui`, but the current project direction, branding, and release flow are now ProtoPeek’s own.

Notes:

- Do not post this draft until v0.3.0 is publicly released and its Unix and
  Windows installers pass clean-machine acceptance.
- After release, adapt the technical detail and limitations to each community;
  do not broadcast identical promotional copy or solicit votes.

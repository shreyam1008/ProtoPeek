# Launch Post Draft

Title: ProtoPeek: a modern gRPC console rebuilt from grpcui for today’s workflows

ProtoPeek started as a fork of grpcui, then turned into a full overhaul focused on the parts modern teams actually need when debugging gRPC services:

- A responsive, search-first method rail
- Reflected schema visibility
- JSON starter payload generation
- Local collections and history
- A response lab that keeps headers, trailers, payloads, and status together
- A lightweight simulation studio for quick throughput and latency checks
- A public learn page that explains gRPC, gRPC-Web, Envoy, and why debugging gets hard

Why rebuild it?

Because gRPC is not just “REST with different syntax”. The transport model is different, the debugging surface is different, and browser teams hit a totally different set of constraints once gRPC-Web enters the picture.

ProtoPeek tries to stay small and practical:

- Single Go binary
- Scratch-friendly Docker image
- Local-first workspace model
- Modern TypeScript frontend with lightweight assets

Project links:

- Repo: https://github.com/shreyam1008/ProtoPeek
- Site: https://shreyam1008.github.io/ProtoPeek/

Notes:

- This draft is ready to post to forums such as r/golang, r/grpc, Lobsters, Hacker News “Show HN”, or relevant CNCF/community spaces.
- I cannot post it directly from this environment, but the copy is ready.

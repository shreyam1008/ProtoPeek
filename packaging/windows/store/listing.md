# ProtoPeek Microsoft Store listing copy

Prepared 11 September 2026 for stable v0.6.1 only. Do not describe Nightly features as shipped.

## Short description

Inspect APIs, local services and network paths in a lightweight browser workbench.

## Description

ProtoPeek is a local workbench for finding, reaching and inspecting services. It runs on your Windows computer and opens its interface in your default browser. No ProtoPeek account or external database is required.

Explore gRPC services using reflection or your own proto files, send HTTP requests, inspect WebSocket and server-sent events, and work with Cap'n Proto schemas. Keep protocol details such as metadata, trailers, status, timing and streaming behavior visible while you debug.

Use the Network workspace to inspect local device and network evidence, and work with an installed Tailscale client. Inspect installed Cloudflare Tunnel tools from Publish. Queue resumable HTTP(S) downloads from Files; the Windows x64 release includes the aria2 download engine.

ProtoPeek is a desktop console application with a browser interface. Keep its console running while using the workbench or downloading files. Closing a browser tab does not stop the local process; close the console or press Ctrl+C to stop it. You can also start it from a terminal with protopeek or pp.

Tailscale and Cloudflare integrations require their respective tools to be installed separately. Some network operations depend on Windows permissions and platform capabilities. Use inspection tools only on systems you own or are authorized to test. TailScout is a separate native Tailscale application; ProtoPeek includes related Tailscale workflows, not the TailScout native window.

Free and open source. Website and documentation: https://protopeek.shreyam1008.com.np/

## Features

- Local browser interface and command-line entry points
- gRPC reflection, proto/protoset loading, unary and streaming calls
- HTTP requests with authentication, headers, bodies and response evidence
- WebSocket, server-sent events and Cap'n Proto inspection
- Local network and installed Tailscale/Cloudflare tool workflows
- Resumable HTTP(S) downloads with bundled aria2 on Windows x64

## Keywords

gRPC; HTTP; API; network; developer tools; protocol; downloads

## Screenshot captions

1. ProtoPeek v0.6.1 Home on Windows: choose a local service inspection task.
2. ProtoPeek v0.6.1 HTTP workbench on Windows: a real local request with status and response evidence.

## Release notes

Initial Microsoft Store package of stable ProtoPeek v0.6.1 for Windows x64. Includes the Home, Inspect, Network, Publish, Files and Settings workspaces and the protopeek/pp command aliases.

## Certification notes / runFullTrust explanation

ProtoPeek is an existing Go Win32 desktop application. It requires runFullTrust to run its local loopback HTTP server, open the user's browser, inspect operating-system network information, access user-selected local schemas and download destinations, and invoke user-installed Tailscale or Cloudflare command-line tools. The Windows x64 release embeds aria2, extracts it to a user-writable location, and starts it for explicitly requested downloads. The app does not install a privileged background service or require a ProtoPeek account.

Launch ProtoPeek from Start, or run protopeek from a terminal. Keep the console open; the browser interface is served locally. No login is needed for the core workbench. Open Inspect > HTTP, enter http://127.0.0.1:<port>/ using the address printed in the console, and Send to verify a local 200 response. Tailscale/Cloudflare integrations are optional and show missing-tool states without those products installed. Stop with Ctrl+C. Closing the browser alone intentionally leaves the process and active downloads running.

Package version: 0.6.1.0. This package contains the unchanged stable release executables, not the Nightly UI or self-updater. Retain bundled license notices and the linked aria2 source companion in the release.

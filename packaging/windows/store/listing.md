# ProtoPeek Microsoft Store listing copy

Submitted 23 October 2026 for v0.7.0.0 x64, Submission 2. In certification; public Store distribution and Store-signed installation acceptance remain pending.

## Current description

ProtoPeek is a local workbench for finding, reaching and inspecting services. It runs on your Windows computer and opens its interface in your default browser. No ProtoPeek account or external database is required.

Start with an address and open an unsent HTTP request or an explicit TLS/plaintext gRPC target. Inspect gRPC reflection or your own schemas, HTTP requests, WebSocket and server-sent events, and Cap'n Proto calls. Metadata, headers, trailers, status, timing and streaming evidence retain their protocol meaning.

Follow network evidence through bounded DNS, TCP, TLS, proxy and protocol checks, TCP port scans, routes and local device observations. Read saved PCAP/PCAPNG packet files without installing Wireshark or contacting captured endpoints. Optional TCP payload evidence is bounded and off by default; gaps and conflicting overlaps stay visible. Live capture and installed Nmap scans require their separate tools and permissions.

Files keeps ordinary aria2 downloads, native media/page downloads and approved direct encrypted transfers between ProtoPeek devices in related workflows. The Windows x64 package includes aria2. Native Go can save direct files, media links found in HTML and original HTML snapshots; optional site engines need explicit installation. Linked webpage assets remain external unless a separately configured archive tool captures them. Local transfer requires a reachable peer and receiver approval; it does not provide a VPN, relay or unlimited throughput.

Extensions contains 20 optional entries with clear integration levels: six native workbenches and fourteen setup guides or links. Opening the library does not install tools, download models, sign in or inspect every tool. Choose a single entry and request its host check deliberately. Installed Tailscale, NetBird and Cloudflare tools retain their own account and permission requirements.

Local agent integrations are optional and start off. Pair a supported local client explicitly; side-effecting tools require a separate write-action choice. ProtoPeek does not host an AI model, provide a cloud account or connect ChatGPT web directly to local stdio.

ProtoPeek is a desktop console application with a browser interface. Keep its console running while using the workbench or downloading files. Closing a browser tab does not stop the local process. Close the console or press Ctrl+C to stop it, or start it from a terminal with protopeek or pp.

Some operations depend on Windows permissions, installed tools, provider accounts and network policy. Use inspection tools only on systems you own or are authorized to test. Free and open source. Documentation: https://protopeek.shreyam1008.com.np/

## Current features

- Local browser workbench with direct unsent HTTP and gRPC entry
- Native gRPC, HTTP, WebSocket/SSE and Cap'n Proto evidence
- Thirteen bounded network diagnostic modes and TCP port batches
- Core PCAP/PCAPNG packet-file inspection; optional installed live capture
- Snapshot comparison and reviewed Nmap XML-to-map import
- Resumable aria2 file queues and native media/page downloads
- Receiver-approved direct TLS file transfers over reachable LAN/VPN routes
- Twenty optional tool entries; six native workbenches and fourteen guides or links
- Optional paired local agent tools with explicit write controls

## Current release notes

Updated to ProtoPeek v0.7.0 for Windows x64. Home opens unsent HTTP or TLS/plaintext gRPC drafts directly. HTTP adds environments, saved-request library import and reviewed cURL import; gRPC keeps incremental streaming evidence; Cap'n Proto adds bounded capability plans. Network adds 13 bounded diagnostic modes, packet conversations and optional TCP payload evidence, snapshot comparison and reviewed Nmap-to-map import. Files adds native media/page downloads and approved encrypted transfers between ProtoPeek devices. Extensions groups 20 optional native workbenches, setup guides and links; nothing installs automatically. Optional agent access remains paired and explicit. Existing protopeek/pp aliases and bundled aria2 are retained. Installed tools, provider accounts, capture permissions and real LAN/VPN reachability remain prerequisites.

## Historical v0.6.1 submission copy


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

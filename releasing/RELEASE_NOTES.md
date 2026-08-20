# ProtoPeek v0.3.1 release notes

Released 20 August 2026.

## Highlights

- HTTP request drafts can now be exported with Copy as cURL after the same preparation used by
  Send. The POSIX-quoted command preserves duplicate query parameters, Unicode, the method,
  non-sensitive headers, timeout, and the active body.
- Ordinary direct and workspace gRPC invokes now retain at most 512 responses and 8 MiB of
  serialized response-message JSON. A 60-second local wall applies when the request has no deadline
  or an excessive one, while bounded partial evidence remains available.
- Process-wide admission limits now cover ordinary gRPC invokes, HTTP relays, and native route
  requests. Existing per-request fan-out limits remain in place.
- Workspace schema loading now has explicit path, file-byte, service, method, descriptor, message,
  field, enum, enum-value, nesting-depth, and catalog-size limits. Reflection resolves
  incrementally, and structural counts run before recursive catalog materialization.
- The scratch container now separates container-interface binding from unsafe remote access while
  preserving loopback Host and Origin checks on the documented loopback-published path.
- The canonical console build now enforces raw and gzip bundle budgets for shared, gRPC, HTTP, and
  scan JavaScript boundaries plus shared CSS.
- The website's source-install fallback now installs both the primary `protopeek` command and its
  documented `pp` alias.

## Safety and compatibility notes

- Copy as cURL omits authentication and credential-like headers and leaves sensitive URL values
  blank. It rejects redirect-enabled drafts, non-HTTP(S) URLs, more than 64 effective headers, and
  commands over 512 KiB; request bodies are copied verbatim, and cURL import remains future work.
- A ProtoPeek-owned gRPC duration stop cancels the RPC and is reported as a local limit, never as a
  server gRPC status in the console, assertions, history, or Unary Repeat.
- Browser DNS-rebinding Host values cannot reach scan, relay, or invocation APIs through the
  documented loopback-published container path. `-unsafe-allow-remote` still requires an external
  trusted boundary.

## Distribution changes

- Owned Homebrew and Scoop definitions are published and checksum-pinned to the v0.3.0 release.
  Their CI covers installation, both command names, and platform-specific package contracts;
  Homebrew additionally checks style, audit, linkage, and manpages, while Scoop checks update,
  uninstall, and three-architecture autoupdate.
- The package definitions can move to v0.3.1 only after its immutable public assets and checksums
  exist. WinGet remains gated on initial user feedback.

## Compatibility

- Existing targets, history, collections, environments, browser-folder profiles, and workspace
  exports keep their current storage formats; this release adds no account or database requirement.
- The response-limit evidence is additive. Natural gRPC status and trailers remain unchanged when
  a call finishes within the local bounds.
- `protopeek` and `pp` remain the primary commands. The temporary `grpcui` compatibility command
  now applies the same local duration attribution instead of presenting a local stop as a server
  `DeadlineExceeded` status.

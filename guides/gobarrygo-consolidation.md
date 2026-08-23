# GoBarryGo consolidation

Status: transfer slice implemented in current source; consolidation and public migration remain
planned and approval-gated.

ProtoPeek's current development source now contains a local transfer service, the canonical
`/downloader` UI, and one explicit `download` CLI command. GoBarryGo remains an independent product
and repository. No retirement, live state migration, public redirect, package change, or repository
archive has happened. This document separates that current build from possible later consolidation.

## Product boundary

ProtoPeek is one local systems workbench with six primary areas:

1. **Overview** — runtime state and explicit entry points; no work starts on load.
2. **Protocols** — protocol-native gRPC and HTTP workbenches, with later adapters remaining
   protocol-specific.
3. **Network** — route, path, authorized local discovery, topology, and saved evidence.
4. **Downloader** — current transfer and verification; artifact handoff and workflows are planned.
5. **Security** — observational DNS, TLS, and HTTP evidence plus separately authorized probes.
6. **Settings** — current browser-local appearance/preferences; host controls are not exposed here.

The first planned cross-area workflow is deliberately narrow:

```text
download -> verify checksum -> inspect artifact -> test target -> export evidence
```

It is not a file manager, system cleaner, task killer, arbitrary shell runner, remote admin tool,
cloud-sync service, or plugin marketplace.

## Architecture decision

The core remains a loopback Go HTTP server with an embedded browser UI. The CLI and browser call
the same services and use the same host-owned configuration. An optional native WebView can wrap
that server later; Wails is not part of the core.

Transfer semantics stay separate from protocol semantics. Current transfer jobs own queue state,
bytes, speed, retry, cancellation, engine evidence, output, and checksum. Protocol adapters own
targets, operations, schemas, requests, responses, headers, trailers, streams, status, and timing.
A typed Artifact handoff between those areas is planned; it is not implemented.

The initial storage contract is versioned JSON with explicit migrations and import/export. A
database is not justified until measured history/search volume requires one.

### Current host config and browser preferences

The implemented host configuration file owns values that affect the process or filesystem:

- configured `aria2c` path;
- download and staging directories;
- active-job, connection, bandwidth, queue, and disk-reserve limits;
- TLS and overwrite safety policy;
- configuration schema version.

The current Settings route owns browser-local theme, density, and keyboard-hint presentation only.
It does not edit the host config or claim to enforce CPU, memory, network, or filesystem controls.
Credentials, signed URLs, authorization headers, private request bodies, and filesystem authority
never belong in browser persistence.

## Transfer engine and licensing

GoBarryGo's separable plain-Go aria2 RPC client, mapper, lifecycle, recovery, and snapshot behavior
may be adapted with source provenance. The Wails shell, generated bindings, Astro site, packaging,
platform title bars, and bundled executables do not move.

`aria2c` is GPL-2.0-or-later while ProtoPeek is MIT. The first implementation therefore uses only
an explicitly configured or system-installed `aria2c` subprocess. ProtoPeek must not bundle aria2
in its binary, archives, Homebrew/Scoop packages, container, or future native wrapper until the
distribution obligations receive a separate review.

A read-only capability or snapshot request never starts the subprocess. Start and Add are explicit
mutations. Removing a job does not delete its output file. Two ProtoPeek processes must not own the
same transfer session concurrently.

## Current CLI contract

Existing `pp [flags] [target]` and `protopeek [flags] [target]` behavior remains compatible. The
current development source parses exactly one new subcommand before the legacy target form:

```text
pp download [--output NAME] [--sha256 64_HEX] URL
```

It accepts exactly one absolute HTTP(S) URL without user information, one optional safe filename,
and one optional exact SHA-256 digest. It owns a local engine session, writes progress to stderr,
prints the completed path to stdout, returns 130 on interruption, and preserves partial data plus
the aria2 session. It does not attach to an already-running ProtoPeek process.

`download --ui`, `downloads list`, job-action subcommands, and JSON CLI output are ideas only. They
are not implemented and are not current contracts. The canonical browser route is `/downloader`;
`/downloads` exists only as a compatibility redirect inside the local app.

Resource controls must be truthful. Concurrency, connection, queue, bandwidth, response, evidence,
and disk-reserve bounds can be enforced immediately. A cross-platform CPU/RAM percentage is not an
enforced limit until an OS-specific backend (for example Linux cgroups or Windows Job Objects)
actually proves it.

## Planned GoBarryGo state migration

No importer exists today. If approved later, migration would read GoBarryGo preferences and aria2
session only after an explicit preview and user action. It must be idempotent, preserve the original
files, report ignored/unsupported values, and never uninstall GoBarryGo. Existing releases continue
to work independently.

If a later consolidation is approved, its preservation gate must cover:

- the complete repository and Git history;
- all tags and release assets;
- the v0.0.9 checksums;
- the genuine screenshot evidence work;
- the source revisions used for every adapted component;
- the old package identifiers and migration notes.

Any prepared but unpublished WinGet, Snap, or Flathub manifests must remain unsubmitted unless they
receive their own approval. ProtoPeek would extend its own package channels rather than reuse
GoBarryGo identifiers.

## Proposed reversible public migration

Nothing in this section is live or approved. A public migration could happen only after Downloader
parity and a released ProtoPeek build exist:

1. Publish a real ProtoPeek Downloader page using captures from the implemented app. The local app
   route is `/downloader`; no public `/downloads/` product page exists today.
2. Publish install, state-import, compatibility, and rollback documentation.
3. Replace the GoBarryGo site with a clear “GoBarryGo has merged into ProtoPeek” page that still
   links to standalone v0.0.9, checksums, source, and migration help.
4. Only after approval, choose and verify a permanent public destination; do not assume the local
   SPA route is a deployed marketing URL.
5. Keep the legacy GitHub Pages URL as a human-readable compatibility page.
6. Verify HTTPS, certificate, status, canonical, redirect loops, assets, robots, sitemap, major old
   paths, and Search Console evidence.

DNS change, release publication, package publication, and repository archival are separate
approval gates. Archival is the final optional action after at least two stable ProtoPeek releases
or a documented support window. Releases, tags, binaries, and user data are never deleted.

## Delivery and proof

Current development source:

1. Transfer service, host config, exclusive ownership, recovery, and tests.
2. Loopback API with explicit start/add/job mutations, plus CSRF/admission/cancellation boundaries.
3. Canonical `/downloader` UI and one-shot `download` CLI with man-page documentation.

Still planned and separately gated:

1. Cross-area Artifact handoff and bounded workflows.
2. Explicit GoBarryGo state importer and parity fixtures.
3. Public documentation backed by a real capture of the implemented Downloader.
4. Any retirement page, redirect, package migration, release, or repository archive.

Completion requires source tests, process failure/recovery tests, config migration tests, browser
interaction evidence, cross-platform compile checks, package/install verification, and an exact
local-versus-live status report. A plan, mock, green frontend build, or deployed redirect alone is
not completion.

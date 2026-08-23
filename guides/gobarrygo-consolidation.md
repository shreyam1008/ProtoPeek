# GoBarryGo consolidation

Status: the transfer, migration, and crawlable documentation slices ship in ProtoPeek v0.5.0;
Homebrew/Scoop promotion, public deployment/indexing, the GoBarryGo redirect, and repository
retirement remain separately gated.

ProtoPeek v0.5.0 contains a local transfer service, the canonical
`/downloader` UI, explicit `download` and `migrate-gobarry` CLI subcommands, and a read-first
GoBarryGo state bridge with guarded rollback. The release source also contains a crawlable
`/downloader/` landing page, but deployment and indexing require separate live verification.
GoBarryGo remains an independent live product and repository. No public redirect, package
promotion, or repository archive has happened. This document separates the shipped v0.5.0
capability from the still-gated public cutover.

## Product boundary

ProtoPeek is one local systems workbench with six primary areas:

1. **Overview** — runtime state and explicit entry points; no work starts on load.
2. **Protocols** — protocol-native gRPC and HTTP workbenches, with later adapters remaining
   protocol-specific.
3. **Network** — route, path, authorized local discovery, topology, and saved evidence.
4. **Downloader** — one or up to 32 independent HTTP(S) jobs per request, with deterministic 207
   partial-success results, per-job destination, bounded request headers and User-Agent, job and
   whole-queue pause/resume, retry/cancel, checksum evidence, and queue state; artifact handoff and
   workflows remain planned.
5. **Security** — observational DNS, TLS, and HTTP evidence plus separately authorized probes.
6. **Settings** — browser-local appearance/preferences plus an explicit GoBarryGo migration
   preview, import, receipt, and guarded rollback; arbitrary host paths are never accepted.

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

The current Settings route owns browser-local theme, density, keyboard-hint presentation, and the
explicit GoBarryGo migration flow. The migration flow can copy a bounded allowlist of compatible
values into host configuration, but it does not expose an arbitrary path picker or claim to enforce
CPU/RAM percentages. Credentials, signed URLs, authorization headers, private request bodies, and
filesystem authority never belong in browser persistence.

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

## v0.5.0 CLI contract

Existing `pp [flags] [target]` and `protopeek [flags] [target]` behavior remains compatible. The
v0.5.0 release recognizes two explicit subcommands before the legacy target form:
`download` and `migrate-gobarry`. The bounded one-shot download contract is:

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

## Implemented GoBarryGo state bridge

ProtoPeek v0.5.0 implements an explicit, local-only bridge:

```text
pp migrate-gobarry                              # observational preview; no writes
pp migrate-gobarry --apply                      # copy compatible preferences and session
pp migrate-gobarry --preferences=false --apply  # session only
pp migrate-gobarry --session=false --apply      # preferences only
pp migrate-gobarry --rollback RECEIPT_ID        # guarded restore
```

The Settings route exposes the same preview/import/rollback service. It performs no scan on mount;
the user must ask it to inspect the one known GoBarryGo profile. The bridge accepts only bounded,
regular, non-symlink source files with strict preferences JSON and an allowlisted aria2 session. It
never accepts an arbitrary host path, starts aria2, deletes a download, or changes GoBarryGo files.
Preferences are capped at 1 MiB. A session is capped at 16 MiB, 4,096 entries, and 64 KiB per line;
every session option must be on the explicit allowlist before any target file is written.

Compatible settings include the validated aria2 executable, download directory, concurrency and
connection bounds, split/minimum-split values, continue/always-resume behavior, file allocation,
auto-rename behavior, and a non-GoBarry-branded user agent. Notification preferences are reported
as preserved-but-unsupported because the browser-core product does not claim native desktop
notifications. Imported session jobs are paused before they enter ProtoPeek, duplicate source
blocks are not re-added, and sensitive URL/header values are never echoed in migration results.

The live Downloader has a separate truth boundary: exact retry/resume can require a signed source
URL or request header. The form clears those values after queueing and snapshots/API results never
return them, but the local transfer engine and mode-0600 retry/session state retain what is required
to resume exactly. This is host-local persistence, not browser persistence or a hosted service.

Imports are idempotent. Each successful mutation creates private mode-0600 state, a source-hash
ledger, and a receipt containing the exact before/after target hashes and private backups. Rollback
is allowed only while current ProtoPeek transfer state still matches the receipt; otherwise it
refuses rather than overwriting newer work. Stop both GoBarryGo and the ProtoPeek Downloader before
previewing a final source snapshot or applying/rolling back a receipt. Existing GoBarryGo releases
continue to work independently.

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

Nothing in this section changes public routing or repository state by itself. ProtoPeek v0.5.0
satisfies the released-build prerequisite, but the public migration can happen only after the
remaining deployment, package, and indexing gates pass:

1. Deploy the generated `/downloader/` page with the two manifest-backed v0.5.0 captures, then
   verify its direct HTML, canonical, structured data, assets,
   sitemap entry, and mobile rendering on the public origin.
2. Verify the v0.5.0 archives and release-resolver installs, then promote Homebrew and Scoop only
   after their dependency-aware manifests pass independent install and update checks. The package
   channels remain at v0.4.0 until then.
3. Replace the GoBarryGo site with a clear “GoBarryGo has merged into ProtoPeek” page that still
   links to standalone v0.0.9, checksums, source, and migration help.
4. Only after the released packages and public page pass installation and Search Console checks,
   enable the approved permanent `301` from the old GoBarryGo origin to the verified ProtoPeek
   `/downloader/` page. Preserve query strings and reject redirect loops.
5. Keep the legacy GitHub Pages URL as a human-readable compatibility page.
6. Verify HTTPS, certificate, status, canonical, redirect loops, assets, robots, sitemap, major old
   paths, and Search Console evidence.

DNS change, release publication, package publication, and repository archival are separate
approval gates. Archival is the final optional action after at least two stable ProtoPeek releases
or a documented support window. Releases, tags, binaries, and user data are never deleted.

## Delivery and proof

Shipped in v0.5.0:

1. Transfer service, host config, exclusive ownership, recovery, and tests.
2. Loopback API with explicit start/add/batch/job/global-queue mutations, plus
   CSRF/admission/cancellation boundaries.
3. Canonical `/downloader` UI and one-shot `download` CLI with man-page documentation.
4. Read-first, copy-only GoBarryGo preference/session import with idempotence, receipts, and guarded
   rollback in both CLI and Settings.
5. Generated crawlable `/downloader/` page backed by real desktop/mobile captures and sitemap links.

Still planned and separately gated:

1. Cross-area Artifact handoff and bounded workflows.
2. Homebrew/Scoop promotion with a proved external `aria2c` dependency.
3. Public deployment and indexing of `/downloader/`, followed by an approved GoBarryGo retirement
   page and permanent redirect after the support gate.
4. Native desktop notifications and open/reveal integration, if a later native-shell decision can
   justify them without weakening the browser-core boundary.
5. Any repository archive, only after at least two stable ProtoPeek releases or the documented
   support window. Tags, releases, binaries, screenshots, checksums, and history remain preserved.

Completion requires source tests, process failure/recovery tests, config migration tests, browser
interaction evidence, cross-platform compile checks, package/install verification, and an exact
local-versus-live status report. A plan, mock, green frontend build, or deployed redirect alone is
not completion.

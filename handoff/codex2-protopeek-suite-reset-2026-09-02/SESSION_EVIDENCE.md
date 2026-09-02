# Session evidence and baseline

Captured on Windows on 2026-09-02.

## Repository state before adding this handoff

```text
branch: master
HEAD: 8902b02 fix(build): sync Linux generated assets

 M README.md
 M guides/feature-roadmap.md
?? guides/private-network-integration-plan.md
?? guides/protopeek-suite-strategy.md
```

Those four planning changes existed before this handoff folder was created and belong to the active
ProtoPeek consolidation work. Preserve them.

The production build generated hashed assets and site output during verification. Those generated
verification-only changes were restored/removed afterward so they would not pollute this handoff.

## Go tests

Command:

```powershell
go test ./...
```

Result: exit code 0. All tested packages passed, including the root handlers, CLI, Cloudflare,
route/path, target guard, This PC, transfer, tunnels, web observation, standalone server, and
embedded asset tests.

## Frontend tests

Command:

```powershell
bun run test
```

Result:

```text
Test Files  57 passed (57)
Tests       477 passed (477)
Duration    41.26s
```

Type checking passed. Biome completed with 27 non-failing
`lint/style/noDescendingSpecificity` warnings, predominantly in
`web/src/console/this-pc.css`. Treat them as cleanup inventory, not a reason for an unreviewed
whole-file reorder.

## Production build

Command:

```powershell
bun run build
```

Result: exit code 0.

- console build passed;
- website build/prerender passed;
- bundle budget passed.

Build warning:

```text
vite:react-swc specifies deprecated `esbuild` option; Vite recommends `oxc`.
```

This is not a release failure but should be tracked during dependency/tooling cleanup.

## Measured console bundle

```text
All JavaScript:
  files:       55
  raw bytes:   939,206
  gzip bytes:  288,943

All CSS:
  files:       10
  raw bytes:   311,252
  gzip bytes:  55,476
```

Important route/shared values:

```text
shared entry JS gzip: 93,553 B
HTTP route JS gzip:   16,762 B
gRPC route JS gzip:   27,981 B
Network shell gzip:   18,786 B
This PC route gzip:   14,850 B
Tunnels route gzip:   14,555 B
```

Headroom:

```text
aggregate JS:  1,873 B gzip
aggregate CSS: 1,868 B gzip
HTTP route:      646 B gzip
```

## Existing source hotspots

```text
web/src/console/App.tsx                4,293 lines
web/src/console/Tunnels.tsx            2,081 lines
web/src/console/ThisPC.tsx             1,748 lines
web/src/console/NetworkWorkbench.tsx   1,036 lines
web/src/shared/protopeek.css           6,150 lines
web/src/console/unified-shell.css        515 lines
```

## Current TanStack use

- TanStack Router defines the route tree and lazy routes.
- TanStack Query is used only around the HTTP workbench mutation.
- No Table, Virtual, Form, Hotkeys, Store, Pacer, Start, or DB package is installed.

## Verification limitations

- This baseline verifies the Windows checkout.
- It does not prove Linux or macOS real-host service-manager, permission, packaging, or UI behavior.
- The user's statement that Linux functionality is good should be preserved, but every refactor
  still needs contract tests and later real-host smoke.
- Image concepts are design evidence, not production QA.

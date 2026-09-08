# CLI and UI updates — 8 September 2026

Scope: `pp update`, `protopeek update`, and Settings → Updates. This is an edge
addition; v0.6.1 stable binaries do not contain the command and need one installer
upgrade first. Both aliases dispatch to the same Go engine.

## Observed acceptance

- 781 UI tests pass. Coverage includes no automatic release request on page load,
  explicit preview/confirmation, stale channel selection, manager instructions,
  cancellation recovery, and failed-checksum retry without false success.
- `go test ./...` passes on the Windows development host. Updater tests exercise
  Windows ZIP and macOS/Linux tar archives, bad/duplicate checksums, edge revisions,
  stable-channel prerelease rejection, changed installations, bad plan IDs,
  cancellation during download, cross-process locking, rollback after the first
  replacement, unrelated alias preservation and a real running-executable replacement.
  The existing Windows/macOS/Linux CI matrix runs the same native tests.
- HTTP handler tests reject nonlocal clients, foreign origins, missing CSRF,
  mutation through GET, unknown input, missing confirmation and missing previews.
- Real browser testing used an isolated Go-served installation on loopback. The
  fixture intentionally reported v0.6.0 to exercise the available-update path;
  it was a development build containing the new updater, not a released v0.6.0 binary.
  Check cancellation recovered; the next check found public v0.6.1. Confirmation
  installed the real checksum-verified GitHub archive while the server stayed open.
  Both on-disk commands then reported v0.6.1. The UI displayed restart-required
  and identified Windows backups retained while the old process was running.
- A separate isolated fixture exercised `pp update --check` followed by `pp update`.
  Both real installed commands reported v0.6.1 afterward.
- Browser checks covered stable/edge selection, revision preview, invalidating the
  install control after a channel change, and 390×844 mobile plus desktop dark/light
  layouts. The mobile page had no horizontal overflow.

## Cost and operational limits

No dependency was added. A stripped Windows x64 binary measured 41,869,312 bytes
against 41,092,608 bytes for the preceding published edge binary: +776,704 bytes.
The update route adds about 3.1 KiB JavaScript and 1.1 KiB CSS compressed, loaded only
when opened. Initial JavaScript budgets are unchanged; aggregate budgets explicitly
include the new lazy route. Downloads stream to disk with bounded archive/executable
sizes. Only an active update polls its local progress endpoint; GitHub checks are manual.

Package managers retain ownership; privilege escalation and automatic server restart
are not implemented. Existing servers continue until the user restarts them. Direct
updates replace executables, not arbitrary system manpage directories. Windows can
retain previous executable backups until all old processes exit. A crash during the
multi-file rename requires installer repair; a normal failure rolls back, retaining
recovery files if rollback itself is blocked. Local profile/transfer data is untouched.

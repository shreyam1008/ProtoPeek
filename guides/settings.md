# Settings

ProtoPeek separates browser-only preferences from private host configuration. Stable v0.5.0 includes appearance, local interface preferences, and the reversible GoBarryGo bridge; Downloader host controls are current source after v0.5.0.

## Shape this browser

Theme, density, and keyboard-hint preferences stay in this browser profile. Changing them does not write a server account, external database, or ProtoPeek cloud workspace.

If browser storage is unavailable or malformed, the console keeps a usable session and reports the boundary instead of silently treating a failed write as saved state.

## Preview the GoBarryGo bridge

The stable bridge is read-first:

1. preview the one known local GoBarryGo profile;
2. review bounded preferences and session state;
3. import only after an explicit action; and
4. keep a private receipt for guarded rollback.

Import copies allowlisted state into ProtoPeek, leaves GoBarryGo files unchanged, and pauses imported jobs. Rollback is allowed only while current ProtoPeek transfer state still matches the receipt. GoBarryGo releases, repository history, and public origin remain independent.

## Configure Downloader on the host

This section is available in current source after v0.5.0, not in the published stable packages.

Supported controls cover the aria2 executable, download directory, active jobs, per-host connections, bandwidth cap, disk reserve, resume behavior, file allocation, overwrite policy, and TLS verification.

Host settings live in the private transfer configuration, not browser localStorage. A strict revisioned patch preserves hidden fields and refuses writes unless the engine is stopped and the cooperative process lock is held.

## Know where each value lives

| Setting | Storage boundary | Release state |
|---|---|---|
| Theme, density, keyboard hints | This browser profile | Stable v0.5.0 |
| GoBarryGo preview, import, rollback receipt | Local process and private state | Stable v0.5.0 |
| Downloader engine and resource controls | Private host configuration | Current source after v0.5.0 |

## Go deeper

- [Use Downloader and inspect its external aria2 boundary](/downloader/).
- [Read the GoBarryGo consolidation record](https://github.com/shreyam1008/ProtoPeek/blob/master/guides/gobarrygo-consolidation.md).
- [Install stable ProtoPeek v0.5.0](/install/).


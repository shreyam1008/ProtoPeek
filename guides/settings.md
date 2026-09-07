# Settings

ProtoPeek separates browser-only preferences from private host configuration. Stable v0.5.0 includes appearance, local interface preferences, and the reversible GoBarryGo bridge; Downloader host controls are current source after v0.5.0.

## Shape this browser

Current source uses compact vertical sections: Appearance, Preferences, Downloads, and Migration.
Switching sections preserves an unsaved host-settings draft. The selected section scrolls
independently; download Save/Reload actions stay visible. Arrow Up/Down, Home and End navigate
the section list.

Theme, density, and keyboard-hint preferences stay in this browser profile. Changing them does not write a server account, external database, or ProtoPeek cloud workspace.

Current-source HTTP saved requests also belong to this browser origin. Manage them in
**Inspect → HTTP → Saved requests**: 50 recipes / 512 KiB total, with body storage explicitly
enabled per saved request. Auth values are excluded. Delete and Reset affect the library;
Export creates a portable JSON record. Global Ctrl+K can load a recipe without sending it.

Missing or malformed interface preferences fall back to defaults. If a preference write fails,
the live choice still applies and Settings shows that it is session-only. Retrying the affected
choice can save it after storage becomes available; saving a different preference does not hide
the earlier failure.

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

The folder picker lists local directories only, on request, and is shared by Downloader and
Taildrop. Queued and paused downloads reserve their output names before creating files. The
auto-rename policy chooses a free name; overwrite cannot assign another active job's destination.
Explicit retry retains the chosen output name and partial-download behavior.

## Know where each value lives

| Setting | Storage boundary | Release state |
|---|---|---|
| Theme, density, keyboard hints | This browser profile | Stable v0.5.0 |
| GoBarryGo preview, import, rollback receipt | Local process and private state | Stable v0.5.0 |
| Downloader engine and resource controls | Private host configuration | Current source after v0.5.0 |

## Go deeper

Current source after v0.6.1 also includes **AI agents**, a secondary workspace for pairing a
local MCP/CLI agent and watching its actual calls. Access starts off; write actions are a separate
choice. The private pairing file belongs to the host and activity results stay in memory.
See the [local AI agent guide](/ai-agents/). This is not included in v0.6.1 stable binaries.

- [Use Downloader and inspect its external aria2 boundary](/downloader/).
- [Read the GoBarryGo consolidation record](https://github.com/shreyam1008/ProtoPeek/blob/master/guides/gobarrygo-consolidation.md).
- [Install stable ProtoPeek v0.6.1](/install/).

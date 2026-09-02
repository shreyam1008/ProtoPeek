# ProtoPeek Codex CLI handoff

Prepared: 2026-09-02

Repository: `C:\Users\shreyam\Desktop\PM\ProtoPeek`

Branch at handoff: `master`
Starting commit: `8902b02` (`fix(build): sync Linux generated assets`)

This folder is the durable replacement for the design/planning context in the chat. It is intended
to be readable by a fresh Codex CLI session with no conversation history.

## Start here

1. Read [MASTER_HANDOFF.md](MASTER_HANDOFF.md) completely.
2. Inspect the three images in [design-options](design-options/).
3. Choose visual direction 1, 2, or 3. No production redesign should start before that choice.
4. Read [EXECUTION_PLAN.md](EXECUTION_PLAN.md) and implement **v0.6 only**, one verified checkpoint
   at a time.
5. Start the new CLI session with the exact text in
   [CODEX2_CONTINUATION_PROMPT.md](CODEX2_CONTINUATION_PROMPT.md).

## Files

| File | Purpose |
| --- | --- |
| [MASTER_HANDOFF.md](MASTER_HANDOFF.md) | Complete product history, decisions, architecture, design brief, repository state, research, and constraints |
| [EXECUTION_PLAN.md](EXECUTION_PLAN.md) | Ordered implementation plan, file-level slices, tests, acceptance gates, and later roadmap |
| [CODEX2_CONTINUATION_PROMPT.md](CODEX2_CONTINUATION_PROMPT.md) | A long prompt that can be pasted into a fresh Codex CLI session |
| [SESSION_EVIDENCE.md](SESSION_EVIDENCE.md) | Exact Windows verification baseline, bundle numbers, dirty-tree inventory, and known warnings |
| [design-options](design-options/) | The three fresh desktop-workbench concepts generated after the earlier concepts were rejected |

## Launch from PowerShell

Interactive route:

```powershell
Set-Location -LiteralPath 'C:\Users\shreyam\Desktop\PM\ProtoPeek'
codex
```

Then paste the fenced prompt from `CODEX2_CONTINUATION_PROMPT.md`.

Non-interactive kickoff, if desired:

```powershell
Set-Location -LiteralPath 'C:\Users\shreyam\Desktop\PM\ProtoPeek'
$protoPeekPrompt = Get-Content -Raw -LiteralPath '.\handoff\codex2-protopeek-suite-reset-2026-09-02\CODEX2_CONTINUATION_PROMPT.md'
codex exec $protoPeekPrompt
```

Authentication is deliberately not changed by this handoff. If a different account is required,
perform the normal interactive `codex logout` and `codex login` yourself so credentials and browser
approval remain under your control.

## Important first-turn rule

The three new directions are not the three rejected directions. They deliberately move away from
website/SaaS-dashboard composition toward a real desktop workbench. The next session must inspect
all three full-size images and get a selection before writing redesign code.

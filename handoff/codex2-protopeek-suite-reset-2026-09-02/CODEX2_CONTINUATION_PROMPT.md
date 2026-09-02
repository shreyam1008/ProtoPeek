# Paste this into a fresh Codex CLI session

Replace `SELECTED_OPTION=UNSELECTED` with `1`, `2`, or `3` if a decision has already been made.
Otherwise leave it unchanged and the new session must ask for the choice before implementation.

```text
You are continuing the ProtoPeek project in:

C:\Users\shreyam\Desktop\PM\ProtoPeek

SELECTED_OPTION=UNSELECTED

This is an existing, functional, dirty working tree. Do not reset, clean, discard, overwrite, or
silently reformat existing changes. Work as the primary implementation agent for one maintainer.

Before taking any implementation action, read these files completely in this order:

1. AGENTS.md
2. handoff/codex2-protopeek-suite-reset-2026-09-02/README.md
3. handoff/codex2-protopeek-suite-reset-2026-09-02/MASTER_HANDOFF.md
4. handoff/codex2-protopeek-suite-reset-2026-09-02/EXECUTION_PLAN.md
5. handoff/codex2-protopeek-suite-reset-2026-09-02/SESSION_EVIDENCE.md
6. guides/protopeek-suite-strategy.md
7. guides/private-network-integration-plan.md
8. guides/cloudflare-tunnel-integration-plan.md
9. guides/feature-roadmap.md
10. package.json
11. scripts/bundle-budget.ts

Also inspect the Markpad design references named in MASTER_HANDOFF.md and inspect all three images:

- handoff/codex2-protopeek-suite-reset-2026-09-02/design-options/option-1-session-workbench.png
- handoff/codex2-protopeek-suite-reset-2026-09-02/design-options/option-2-command-deck.png
- handoff/codex2-protopeek-suite-reset-2026-09-02/design-options/option-3-context-studio.png

Then inspect the live repository, current git status, route tree, shell, theme code, tests, and the
four oversized route components. Treat the handoff as a map, not a substitute for source evidence.

Product objective:

ProtoPeek is the lightweight local workbench for finding, reaching, inspecting, and safely exposing
services. It should absorb TailScout's useful Tailscale workflows later, while Markpad, dbterm,
Buggy, and personal/Radhey work remain separate products. The current task is to make ProtoPeek
coherent, maintainable, compact, desktop-like, theme-rich, and cross-platform before adding another
provider.

Non-negotiable user requirements:

- one consistent UI and interaction model on Windows, Linux, and macOS;
- OS differences only for real capabilities, paths, services, permissions, and vendor behavior;
- polished desktop-application feel inspired by Markpad, not a website or SaaS dashboard;
- multiple deliberate light/dark color schemes plus system and high-contrast behavior;
- common code for truly common behavior;
- small cohesive domain components and hooks instead of thousand-line mixed route components;
- minimum practical code and dependencies, without clever compression or line-count games;
- use TanStack deliberately and prefer lightweight tools;
- preserve all working functionality and safety limits;
- manual, bounded, local-first network operations with no default background polling;
- complete one milestone properly before starting the next.

Important technical interpretation:

“Use all TanStack” means TanStack-first when a package solves a repeated real problem and fits the
measured budget. Do not install the TanStack catalog. Keep Router. Audit Query, which currently
serves only one mutation. Do not add Table, Virtual, Form, Hotkeys, Store, Pacer, Start, DB, or
production Devtools during the initial reset unless repository evidence changes and you first
present exact bundle cost plus at least two or three real consumers. Do not add a component suite,
state library, Axios, chart library, date library, or fuzzy-search package casually.

The aggregate JavaScript and CSS budgets each have only about 1.8 KiB gzip headroom. Reclaim
duplication before adding weight. Do not raise budgets merely to pass.

Design gate:

If SELECTED_OPTION is UNSELECTED, inspect all three full-size images and ask me exactly which option
to build: 1, 2, or 3. Stop before editing production redesign code. Do not invent or blend a fourth
direction.

If SELECTED_OPTION is 1, 2, or 3, first write
guides/desktop-workbench-design.md as the precise desktop/narrow shell and token contract for that
option. Reconcile any conflict between the image and the six-destination product architecture
explicitly. The image is a direction, not permission to show fake capability or Windows-only chrome
inside the browser build.

Execution scope for this CLI run:

Implement v0.6 Product Reset only, following EXECUTION_PLAN.md phase by phase:

0. safely resume, select/lock the design, and capture baseline;
1. align product contract and current-source versus shipped claims;
2. inventory and characterize every current route/state;
3. establish semantic design tokens and paired themes;
4. introduce one small typed feature registry;
5. build the selected desktop workbench shell around existing lazy routes;
6. extract shared UI primitives only from proven duplicate uses;
7. decompose App.tsx, Tunnels.tsx, ThisPC.tsx, and NetworkWorkbench.tsx one domain and commit at a
   time without changing behavior;
8. move current surfaces under Home, Inspect, Network, Publish, Files, and Settings while preserving
   compatibility routes;
9. harden, verify, measure, document, and stop.

Do not implement Tailscale, Headscale, NetBird, new Cloudflare exposure behavior, a desktop wrapper,
or SEO redirects in v0.6. Those are later milestones.

Architecture rules:

- keep one Go binary and one shared React interface;
- keep large domains route-lazy;
- retain TanStack Router;
- add one feature registry, not a plugin SDK;
- treat TargetRef as the future primary object;
- handoffs populate drafts and never execute automatically;
- preserve protocol-native gRPC and HTTP evidence;
- preserve every security, consent, size, concurrency, cancellation, redaction, stale-state, and
  compatibility contract;
- do not flatten provider-native evidence;
- do not build separate OS layouts;
- extract a shared component only after two actual uses agree;
- treat 300–500 lines as a review signal, not a quota;
- do not mix structural refactoring and behavior redesign in one checkpoint;
- do not delete migration history, routes, generated release assets, or predecessor evidence.

Visual rules:

- compact app bar and desktop workbench hierarchy;
- contextual navigation rather than a feature catalog;
- one dominant canvas;
- optional attached/resizable evidence panels;
- fixed quiet status rail;
- 4–8 px radii and one-pixel region dividers;
- shadows mainly for transient layers;
- no global card grid;
- no permanent three-column dashboard;
- no glass, gradient glow, giant hero headings, decorative metrics, or logo gallery;
- dense content only after a target/session is active;
- same layout dimensions across themes;
- no status conveyed by color alone;
- keyboard, focus return, reduced motion, forced colors, and narrow layout are release requirements.

Working method:

1. Use a written plan and keep only one implementation step active.
2. Inspect before editing.
3. Preserve the dirty tree.
4. Add characterization tests before moving behavior.
5. Use apply_patch for hand edits.
6. Run focused tests after each slice.
7. Run the full Windows baseline and bundle build before each coherent commit.
8. Compare screenshots at the same viewport when changing visual code.
9. Record exact bundle differences.
10. Make small conventional commits only after their gate passes.
11. Never claim Linux/macOS real-host success from Windows-only evidence; use fixtures/CI and clearly
    record what still needs a real host.
12. Stop at the v0.6 exit gate and give a concise report of commits, tests, bundle changes, visual
    evidence, and remaining platform verification.

Expected baseline at handoff:

- branch master;
- starting HEAD 8902b02;
- four planning/doc changes already present before the handoff;
- go test ./... passes;
- 57 UI test files and 477 UI tests pass;
- production build and bundle budget pass;
- 27 non-failing Biome descending-specificity warnings exist, mainly in this-pc.css;
- aggregate console JS 288,943 gzip bytes;
- aggregate console CSS 55,476 gzip bytes;
- App.tsx 4,293 lines;
- Tunnels.tsx 2,081 lines;
- ThisPC.tsx 1,748 lines;
- NetworkWorkbench.tsx 1,036 lines;
- protopeek.css 6,150 lines.

If the live checkout differs, trust the live repository, preserve newer work, and report the delta.

Begin by summarizing the current git state and confirming whether SELECTED_OPTION is set. If it is
UNSELECTED, show that you inspected the three images and ask for only the 1/2/3 decision. If it is
selected, create the v0.6 plan and start Phase 0.
```

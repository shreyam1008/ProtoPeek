# ProtoPeek Agent Rules

ProtoPeek is a performance-first gRPC console. Treat every change as if it ships to users debugging a production service under time pressure.

## Product priorities

1. Keep the runtime lightweight.
2. Prefer clarity over feature count if a tradeoff is required.
3. Preserve transport-specific visibility: headers, trailers, stream mode, reflection, deadlines.
4. Avoid “generic API client” drift. ProtoPeek should feel explicitly gRPC-aware.

## Frontend rules

- Default to the console being fast on low-end hardware.
- Prefer custom SVG/CSS charts over large charting libraries.
- Avoid adding state libraries unless React state becomes an actual bottleneck.
- Keep the embedded console responsive under narrow widths; the sidebar must degrade cleanly on smaller screens.
- Any new feature should explain its gRPC relevance, not just mirror a REST tool habit.

## Backend rules

- Keep the CLI and standalone handler operational without an external database.
- Reflection and descriptor loading paths must stay reliable; do not regress proto/protoset workflows.
- Prefer adding JSON API endpoints around the existing invocation core instead of rewriting the RPC execution layer gratuitously.
- Preserve scratch-compatible container builds whenever possible.

## Performance rules

- Measure before adding heavy dependencies.
- Avoid long-running background polling in the browser.
- If a feature increases the binary or bundle size materially, document the reason in the PR or commit message.

## Docs rules

- The README is the fast path.
- The website is the narrative path.
- `guides/` is the detailed path.
- Keep all three aligned whenever product behavior changes.

## Release rules

- `protopeek` is the primary binary name.
- `pp` is the short alias.
- `grpcui` compatibility can exist temporarily, but all new docs and release flows should center `protopeek`.

# ProtoPeek Agent Rules

ProtoPeek is a performance-first, local-first service workbench. Its product direction is to help
users find, reach, inspect, and safely expose services. Treat every change as if it ships to users
debugging a production service under time pressure, and keep current-source, stable-release, and
planned claims explicitly separate.

## Product priorities

1. Keep the runtime lightweight.
2. Prefer clarity over feature count if a tradeoff is required.
3. Preserve transport-specific visibility: headers, trailers, stream mode, reflection, deadlines.
4. Keep each domain native to its evidence. gRPC remains the quality bar; do not flatten protocols,
   network observations, host facts, transfers, or publishing operations into a generic API client.

## Product architecture

- The v0.6 target has six permanent destinations: Home, Inspect, Network, Publish, Files, and
  Settings. Do not describe that grouping as the shipped v0.5.0 or pre-reset current shell.
- In that target, Security belongs under Inspect, This Device under Network, Cloudflare Tunnel under
  Publish, and Downloader under Files. Roadmap and Help remain secondary command/About destinations.
- Preserve existing routes and deep links as compatibility paths while the information architecture
  changes.
- Private Access and Tailscale, Headscale, or NetBird integrations remain planned. Do not present a
  planned provider, shared publishing workflow, or future control as implemented or shipped.

## Feature admission

A proposed feature belongs in ProtoPeek only when all five conditions hold:

1. It operates on a service, endpoint, network path, exposure, or directly related artifact.
2. It strengthens an existing journey or typed handoff.
3. It remains useful local-first without a required account or external database.
4. It can stay route-lazy, bounded, and quiet when the user does not ask it to work.
5. One maintainer can support a truthful Windows, Linux, and macOS story.

If a feature fails a condition, prefer an integration link, a separate product, or rejection.
Provider popularity alone is not an admission reason.

## Cross-platform rules

- Use the same navigation, information hierarchy, wording, states, and confirmation flows on
  Windows, Linux, and macOS.
- Vary only real capabilities, paths, services, permissions, elevation guidance, and vendor
  behavior. Do not create OS-specific page designs.
- Treat unavailable, unsupported, permission-required, unknown, and failed capabilities as truthful
  evidence. Never replace a missing local tool or observation with sample data.

## Frontend rules

- Default to the workbench being fast on low-end hardware.
- Prefer custom SVG/CSS charts over large charting libraries.
- Avoid adding state libraries unless React state becomes an actual bottleneck.
- Keep the embedded console responsive under narrow widths; the sidebar must degrade cleanly on smaller screens.
- Any new feature must pass the feature-admission test and preserve its domain-native evidence.

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

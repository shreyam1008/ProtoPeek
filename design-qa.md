# Cloudflare Tunnel workspace design QA

## Scope

This pass reviewed the complete local Cloudflare Tunnel journey in the existing ProtoPeek design
system: first run, an empty real-host result, official install guidance, release freshness, a
service-backed deployment, an unbound config-only deployment, Overview, Routes, Runtime,
Diagnostics, service confirmation, elevation fallback, route planning, draft completion, and the
public guide. Desktop and exact 320 px layouts were exercised.

Production uses the host-backed API. The populated Linux dataset used for visual and interaction
coverage is isolated under ignored `.tmp` QA code and is not bundled into the application.

## Baseline and comparison evidence

Fresh baseline and final screenshots were captured with the in-app browser at matching viewports
and reviewed together. The temporary evidence set is intentionally outside the repository.

| Journey | Baseline | Final |
| --- | --- | --- |
| Desktop first run | `01-real-entry.png` | `20-final-real-entry.png` |
| Empty real-host result | `02-real-inspected-empty.png` | `21-final-real-inspected.png` |
| Config-only deployment | `14-qa-stopped-config.png` | `23-final-config-only.png` |
| Draft completion | `12-qa-route-draft-result.png` | `25-final-route-draft.png` |
| 320 px first run | `15-real-mobile-entry.png` | `27-final-mobile-entry-320.png` |
| 320 px populated workspace | `17-qa-mobile-populated.png` | `29-final-mobile-populated-320.png` |

Additional final captures cover Routes, route review, service confirmation, Overview, Runtime,
Diagnostics, the mobile route planner, and the public guide.

## Findings resolved

- The empty deployment pane no longer consumes the left third of the product. First run is now one
  focused, full-width inspection journey with an explicit checklist.
- A missing installation now leads with the highest-priority next action, official download and
  release links, platform-specific copyable commands, and a clear OS-owned elevation boundary.
- Service controls appear only for a deployment proven to be bound to the canonical host service.
  An unbound config now reports `Runtime not applicable`, has no PID, and cannot inherit action
  feedback or credential metadata.
- Deployment counts separate hostname routes from the final catch-all consistently.
- `Draft ingress route` now reflects its browser-only behavior. Cloudflare paths are described and
  validated as regular expressions, a kept draft opens Routes automatically, and the draft is
  visibly marked as not observed.
- Remote-managed authority stays with the Cloudflare account and does not acquire an unrelated
  local YAML destination.
- The former Logs & metrics dead end is now Diagnostics with explicit not-run evidence and a
  copyable doctor checklist.
- The mobile deployment/detail switcher is functional. The first-run, setup, populated, and planner
  states have no horizontal overflow at 320 px.
- The public guide now has short, readable evidence-path labels and wrapped Markdown bullets remain
  inside their list items.

## Release evidence

- Real Windows host inspection found no installed `cloudflared`, canonical service, Wrangler, or
  Docker CLI and rendered that absence without demo data.
- The explicit Internet check resolved the official latest cloudflared release as `2026.8.3` on
  2026-09-02.
- The current host has no installed cloudflared service, so a destructive real-service transition
  was not available to smoke-test. Platform adapters, stale-state guards, elevation fallbacks, and
  post-action observation are covered by tests and Linux/macOS cross-compilation.
- The generated guide has one H1, unique search-sized metadata, canonical URL, indexable robots
  policy, Open Graph and Twitter metadata, TechArticle JSON-LD, sitemap entry with `lastmod`, and an
  llms.txt entry. Its prerendered body remains useful without JavaScript.
- Browser console diagnostics were empty during final local verification.

## Automated verification

- `bun run test`: 57 files, 477 tests passed.
- `bun run build`: application, public site, prerendering, documentation generation, and bundle
  budgets passed.
- `go test ./...`, `go vet ./...`, and builds for both Go commands passed.
- The cloudflared, tunnels, and standalone packages cross-compiled for Linux amd64 and Darwin amd64.

final result: passed

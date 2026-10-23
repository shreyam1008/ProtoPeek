# Website hosting

Cloudflare Pages project `protopeek` publishes the checked-in `docs` directory from `master`, the same release-aligned content previously served by GitHub Pages. No application build or dependency installation runs at deploy time (`SKIP_DEPENDENCY_INSTALL=true`). The canonical URL remains https://protopeek.shreyam1008.com.np/ .

The existing site build regenerates `docs`; its public 404 source is `web/site/public/404.html`. This avoids Cloudflare's implicit SPA fallback for nonexistent URLs. Actual product routes remain prerendered in their directories. GitHub Pages hosting was disabled on 9 September 2026; native releases and runtime services are unchanged. Deployment watches `docs/*` only.

Migration progress, original DNS targets and verification are tracked in `shreyam1008/buggy`, `docs/projects/`.

The generated `docs/_worker.js` runs in Cloudflare Pages advanced mode. It
forwards ordinary requests to the static asset binding and serves the existing
`llms.txt` as `text/markdown` when an agent requests the root with
`Accept: text/markdown`; `Vary: Accept` keeps the HTML and Markdown responses
separate in caches.

APT indexes and public keys remain static assets. The worker redirects exact stable
`/apt/pool/main/d/protopeek/protopeek_<version>_<architecture>.deb` paths to their
matching immutable GitHub release assets for GET and HEAD. This keeps signed index
paths and SHA-256 values intact while avoiding Pages' 25 MiB per-file limit.
`scripts/prepare-pages-assets.mjs` omits only generated Debian package copies and
rejects linked or oversized output; authoritative packages remain under
`web/site/public/apt`. Both the site build and APT publication run this check.

Rollback now requires re-enabling and successfully deploying GitHub Pages before
restoring its DNS target; changing DNS alone is not sufficient. Retiring GitHub
Pages also retires the old github.io-hosted URLs and redirects.

# Native browser acceptance

This development-only harness runs the current native launcher in an isolated profile and drives real Chromium on desktop and mobile/touch viewports. It imports the application's feature and tour definitions directly, walks each registered route and guide, checks targets and conditional fallbacks, and reports page errors. It also exercises an owned loopback HTTP fixture, its TCP port, offline subnet planning and managed-tool inventory. No installation or public target is requested. Unexpected browser requests and mutations are blocked and fail the run.

Requirements: Node.js 24.19.0, npm 11, Go as specified in `go.mod`, and Bun 1.3.10. Playwright 1.65.0 is pinned in this directory's separate lockfile and is not shipped with ProtoPeek. From the repository root:

```sh
bun install --frozen-lockfile
bun run build:app
npm ci --prefix scripts/browser-acceptance --ignore-scripts --no-audit --no-fund
node scripts/browser-acceptance/node_modules/playwright/cli.js install chromium
node scripts/browser-acceptance/acceptance.mjs
```

On a fresh Linux system, use `install --with-deps chromium` to install Chromium and its system dependencies. `PLAYWRIGHT_BROWSERS_PATH` is respected if set. CI runs on Windows and Linux with the browser downloaded under `RUNNER_TEMP`.

The launcher, configuration, pairing path and temporary files are created in a unique directory under `RUNNER_TEMP` or the OS temporary directory. The harness closes only its own processes and removes that directory after checking its location. On failure, it saves a uniquely named screenshot in the temporary root and prints its path. The `/network` route redirects to nearby devices, so its journey checks that compatibility route. Some tour targets depend on results or external setup; the test requires an explanatory fallback for those and does not claim to exercise every external integration or real device condition.

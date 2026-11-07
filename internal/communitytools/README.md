# Contributing an optional companion

The community catalog describes optional standalone executables. A user installs a
companion explicitly, and ProtoPeek downloads it into its own local cache. Core
protocol clients, network tools and the built-in downloader do not depend on this
catalog.

To propose a companion, open a PR editing `catalog.json`. Its format is validated
by the JSON Schema 2020-12 document in `catalog.schema.json` and by the Go catalog
validator. JSON Schema supplies widely supported editor and validation tooling.
The catalog describes packages, not an executable plugin ABI.

Copy an existing entry with a similar distribution format and provide:

- A unique lowercase `id`, a user-facing name and description, and an existing
  library `group`. The six IDs managed by the core are reserved.
- A license identifier and HTTPS source repository. Check upstream binary and
  third-party notices, redistribution requirements, and source availability.
- For each genuinely supported OS and architecture, a fixed HTTPS release URL,
  version, exact download size and SHA-256. Download bytes from the official
  publisher and compare the digest against the publisher's release evidence.
- The `binary`, `zip` or `tar.gz` format. For an archive, provide the exact
  regular-file `member`, its independent `binarySize` and `binarySha256`. An
  archive that needs adjacent shared libraries or other files is not supported
  by this single-executable installer.

Do not add a platform entry based only on its filename. Run the extracted
executable on that platform and document required runtimes, daemons, accounts,
privileges, and any other prerequisites. Unsupported platforms remain explicitly
unavailable. Provide the upstream release links and the verified hashes and
sizes in the PR so reviewers can reproduce the checks.

Run `bun scripts/generate-community-catalog.mjs` after changing the catalog and
include the resulting `web/src/console/community-catalog.json` in the PR. Then
run `go test ./internal/communitytools` and the repository's normal checks.
The tests validate the catalog and schema and cover installation, hash failures,
archive safety, locking and removal. For each proposed platform, additionally
test install, the actual executable, and removal in an isolated profile. Include
the results and any platform limitations in the PR.

The installer accepts a catalog ID, rather than a caller-provided URL or
executable path. It checks download size and SHA-256, verifies the selected
archive member, installs with a non-replacing atomic rename and removes only a
verified owned executable. `Acquire` verifies the executable and holds a shared
use lock until the caller releases it. Downloads never modify PATH or install a
system service.

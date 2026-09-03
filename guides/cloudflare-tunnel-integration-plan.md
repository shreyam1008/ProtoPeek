# Cloudflare Tunnel inside ProtoPeek

Status: current-source implementation plus forward plan; it is not part of stable v0.5.0.

Last documentation and CLI check: 2026-09-02.

## Decision

Cloudflare Tunnel management belongs inside ProtoPeek, not in another repository, binary, website,
or product identity.

That decision optimizes for the actual constraint: one maintainer should not have to keep another
release pipeline, dependency graph, issue tracker, documentation site, and design system healthy.
It also creates a stronger workflow than a standalone tunnel dashboard:

> inspect a local service, expose it through a tunnel, verify the route, and debug the result in the
> same local workbench.

The implementation must still be modular. Integration means one product and release, not one large
package with unrestricted access to the host.

## Current-source boundary

The `/tunnels` product path now uses the real adapter for the machine running ProtoPeek. It never
injects a demo tunnel, mock service, or sample route into a production response; deterministic
fakes exist only inside automated tests. A machine with no `cloudflared`, canonical service, YAML,
Wrangler, or Docker therefore produces a truthful empty state and installation guidance.

Current source provides:

- explicit **Inspect this host** discovery with no page-load scan or background polling;
- resolved `cloudflared` path and bounded local version output;
- canonical service/config evidence, redacted credential-source metadata, bounded YAML/route
  inspection, and optional Wrangler/Docker executable detection;
- a separate, explicit **Check latest version** request against the official
  `cloudflare/cloudflared` latest-release endpoint, never on page load;
- official download/release links and copyable platform guidance, with no automatic download,
  install, update, or service installation;
- confirmation, expected-state protection, and verified post-action observation for start, stop, and restart
  of the single canonical OS service; and
- **Draft ingress route** browser proposals plus HTTP/gRPC handoff without config or
  Cloudflare-side mutation.

The service adapters are deliberately closed:

| Host | Canonical target and evidence | Mutation/elevation boundary |
| --- | --- | --- |
| Windows | SCM service `Cloudflared`; query state, PID, and safely parsed `ImagePath` with query-only access | Confirmed action targets that service only. If the process lacks permission, return Administrator/UAC guidance; Windows owns any credential prompt. |
| Linux | systemd unit `cloudflared.service`; bounded `systemctl show` state, PID, unit, and conservative `ExecStart` parsing | Confirmed action targets that unit only. If policy denies it, return exact `sudo systemctl` guidance; sudo owns password input. |
| macOS | launchd label `com.cloudflare.cloudflared`; system LaunchDaemon first, then the current user’s LaunchAgent | Confirmed action targets the detected definition only. A protected daemon returns administrator-command guidance; macOS owns password input. |

The browser sends the state it observed. Immediately before an action, the backend re-observes the
canonical service and returns a stale-state result if reality changed; after an accepted action it
observes again and reports success only when the expected post-action state matches. The API accepts
no service name, executable, raw arguments, or shell string.

ProtoPeek never presents an operating-system password field and never receives, proxies, stores,
logs, or retries a sudo, Administrator, UAC, or Keychain secret. Route/config writes, tunnel-token
input, account sessions, DNS changes, and every Cloudflare API mutation remain gated.

## Product promise

ProtoPeek should answer five questions clearly:

1. Which Cloudflare tunnel deployment is present on this machine?
2. Which authority controls it: Cloudflare, a local YAML file, an OS service, or a container?
3. Which exact file, unit, executable, token source, and ingress rule are effective?
4. What will change before ProtoPeek writes a file or restarts a service?
5. Did the change work, and how can the user roll it back?

The feature is a local operations surface, not a replacement for the Cloudflare dashboard and not a
general remote administration console.

### Recommended product language

- Keep the product name **ProtoPeek**.
- Use **Tunnels** as the primary navigation label.
- Use **Tunnel operations** as the in-product page heading and **Cloudflare Tunnel** in factual
  explanatory, documentation, and search copy.
- Describe the feature as an unofficial integration and state that ProtoPeek is not affiliated with
  or endorsed by Cloudflare, Inc.
- Do not promise an unlimited or permanently free service tier. Cloudflare plans and limits are
  outside ProtoPeek's contract and can change.

This wording keeps the workbench identity stronger than the vendor integration and follows
[Cloudflare's trademark guidelines](https://www.cloudflare.com/trademark/).

## Why this fits ProtoPeek

ProtoPeek already has the right shape:

- a loopback Go service;
- an embedded, route-lazy React UI;
- bounded local operations;
- explicit refresh rather than ambient polling;
- an existing external-process lifecycle in the Downloader;
- private, revision-checked, atomic host configuration writes;
- HTTP and gRPC workbenches that can verify a route after it is exposed;
- one cross-platform release and documentation site.

The integration requires a deliberate expansion of the product contract. ProtoPeek becomes a
**local systems workbench with protocol, network, transfer, host-evidence, and tunnel-operation
adapters**. It must not drift into a generic control panel or arbitrary shell.

## The three-authority model

A tunnel installation can have three independent sources of truth. The UI must never collapse them
into a single misleading green or red state.

| Authority | Owns | Typical primitive | ProtoPeek behavior |
| --- | --- | --- | --- |
| Cloud account | Named tunnel, remote ingress configuration, connectors, DNS routes | Cloudflare API/dashboard | Gated in current source. A remote-managed draft has no local YAML destination; later connect explicitly, read first, and write only with a least-privilege API token |
| Local host | cloudflared executable, YAML, credential/token file, process, OS service | cloudflared plus systemd, launchd, or Windows SCM | Current: discover/read and control only the canonical service; later validate, plan, apply, verify, and roll back file changes within strict allowlists |
| Container project | Image, command, environment, volume mounts, restart policy | Docker or Compose | Current: report Docker CLI presence only, without daemon access; later discover only explicitly adopted profiles and never require the Docker socket |

The screen should show these as three adjacent authority cards. A healthy local process can coexist
with an unreachable Cloudflare API. A valid remote configuration can coexist with a stopped local
service. Those are different facts and different fixes.

## Cloudflare primitives to build on

ProtoPeek should orchestrate official primitives instead of recreating the connector protocol.

### Remotely managed named tunnels

Cloudflare recommends remotely managed tunnels for most use cases. Their ingress configuration is
stored by Cloudflare and connectors run with a tunnel token. ProtoPeek should make this the preferred
new-user path while supporting existing local deployments.

Sources:

- [Remote and local tunnel management](https://developers.cloudflare.com/tunnel/advanced/local-management/)
- [Cloudflare Tunnel API resources](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/)
- [Remote tunnel token rotation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/)

### Locally managed named tunnels

Locally managed deployments use a YAML configuration, an account certificate for management
operations, and a tunnel-specific credentials JSON file for running the connector. The account
certificate has much broader authority than the credentials JSON file and must never be rendered or
copied into ProtoPeek configuration.

Default configuration discovery is:

1. Windows: <code>%USERPROFILE%\.cloudflared</code>.
2. macOS and Unix: <code>~/.cloudflared</code>, then <code>/etc/cloudflared</code>, then
   <code>/usr/local/etc/cloudflared</code>.
3. Any explicit <code>--config</code> path from the running command or service definition takes
   precedence over defaults.

The effective path must always be shown with the evidence that selected it. Never silently edit the
first <code>config.yml</code> found.

Current bounded discovery encodes these candidates explicitly:

| Platform | Config candidates | Canonical service evidence |
| --- | --- | --- |
| Linux | <code>~/.cloudflared</code>, <code>/etc/cloudflared</code>, <code>/usr/local/etc/cloudflared</code> | <code>cloudflared.service</code>, normally defined under <code>/etc/systemd/system</code>; parse ExecStart and any explicit config/token-file arguments |
| Windows | <code>%USERPROFILE%\.cloudflared</code>; for a system service, also consider the service account's system-profile directory only when service evidence points there | <code>HKLM\SYSTEM\CurrentControlSet\Services\Cloudflared</code>, especially ImagePath; query state through SCM |
| macOS | <code>~/.cloudflared</code>, <code>/etc/cloudflared</code>, <code>/usr/local/etc/cloudflared</code> | <code>com.cloudflare.cloudflared</code> LaunchAgent or LaunchDaemon; distinguish login-time user ownership from boot-time system ownership |

These are candidates, not hard-coded truth. An exact <code>--config</code> or
<code>--token-file</code> in a live service definition wins, and ProtoPeek should show a
service-account home separately from the interactive user's home.

Sources:

- [Locally managed tunnel terms and default directories](https://developers.cloudflare.com/tunnel/advanced/local-management/local-tunnel-terms/)
- [Local configuration and ingress validation](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/)
- [Tunnel credential permissions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-permissions/)

### Quick tunnels

Quick tunnels are useful for an explicit, temporary development action. They receive a random
trycloudflare.com hostname and do not need an account. They have no SLA and documented limitations,
including a 200 concurrent request limit and no Server-Sent Events.

ProtoPeek may add a clearly time-bounded **Start quick tunnel** action after the local observation
and canonical-service-control foundation ships. It must display the generated URL, owning process,
start time, limitations, and a prominent Stop action. It must not autostart or be presented as a
production deployment.

Source: [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

### cloudflared

The installed <code>cloudflared</code> executable remains the authority for:

- syntax and ingress validation;
- rule matching;
- connector execution;
- version reporting;
- diagnostic and runtime behavior;
- remote log tailing when explicitly requested.

ProtoPeek may parse enough structure to create a safe UI, but its own parser is not the final
validator. Before applying local configuration it must run:

- <code>cloudflared tunnel ingress validate</code>; and
- targeted <code>cloudflared tunnel ingress rule URL</code> checks for user-supplied test URLs.

Cloudflare supports cloudflared releases within one year of the latest release. Current source
reads the installed version locally during inspection and keeps the networked comparison behind a
separate **Check latest version** action. That action returns bounded metadata from the official
latest GitHub release, its own observed time, and an honest current/update-available/outside-support
or unknown result. It does not run on page load and never updates the executable. As checked on
2026-09-02, the official latest release was
[2026.8.3](https://github.com/cloudflare/cloudflared/releases/tag/2026.8.3).

When `cloudflared` is missing, ProtoPeek exposes links to Cloudflare’s
[Downloads](https://developers.cloudflare.com/tunnel/downloads/) and the official
[release assets and checksums](https://github.com/cloudflare/cloudflared/releases/latest), plus
bounded copyable guidance appropriate to the detected host. It does not download, execute an
installer, add a package repository, call a package manager, install a service, or update a running
connector. Package-managed installations must be upgraded with the same package manager;
Cloudflare documents binary, package, Homebrew, Windows, and container paths in
[Update cloudflared](https://developers.cloudflare.com/tunnel/downloads/update-cloudflared/).
Because a package channel or community manifest can lag upstream, run the explicit release
comparison after installation.

Sources:

- [cloudflared downloads and support policy](https://developers.cloudflare.com/tunnel/downloads/)
- [Cloudflare Tunnel changelog](https://developers.cloudflare.com/changelog/product/tunnel/)

### Wrangler

Wrangler does come into play, but it should not be ProtoPeek's foundation.

As checked on 2026-09-02, Wrangler 4.128.0 exposes experimental tunnel commands for create, delete,
info, list, run, and quick-start. It can download cloudflared into its own cache, and its named
tunnels are remotely managed. The interface is explicitly experimental and introduces a Node/Bun
toolchain that the Go binary otherwise does not need.

ProtoPeek should therefore:

- detect and report Wrangler's version and tunnel capability in Diagnostics;
- never scrape or reuse Wrangler's stored authentication;
- avoid Wrangler mutation commands in the first releases;
- use an installed cloudflared executable, native OS service APIs, and the Cloudflare REST API
  directly;
- consider an opt-in Wrangler project adapter later for developer preview workflows.

Source: [Wrangler tunnel commands](https://developers.cloudflare.com/workers/wrangler/commands/tunnel/)

## User experience

### Route and navigation

- Primary navigation: **Tunnels**
- Route: <code>/tunnels</code>
- Page title: **Tunnel operations**
- Route loading: lazy, with its own JavaScript and CSS budgets
- Availability: local loopback mode only

Using Tunnels in navigation leaves room for future adapters without renaming the product, while the
page remains explicit about the currently supported provider.

### First-run capability screen

The route starts idle, not with a sign-in wall or background request. **Inspect this host** invokes
the real host adapter—never a fixture or sample-data fallback—and:

1. Find candidate cloudflared executables without recursively scanning the disk.
2. Inspect the canonical OS service definition.
3. Inspect running cloudflared processes where the platform exposes safe structured data.
4. Resolve explicit configuration and token-file paths.
5. Check default configuration directories.
6. Detect Wrangler and Docker only as optional capabilities.
7. Return a bounded snapshot with provenance and warnings.

If cloudflared is absent, show official install instructions for the platform. Do not download or
install it automatically. The all-absent result is a valid successful inspection, not an error.

**Check latest version** remains a second explicit action because it contacts the Internet. A local
inspection must remain useful if the release request times out, is rate limited, or is unavailable.

### Optional Cloudflare account connection

Local discovery and service control must work without a Cloudflare account connection. Connect is a
secondary action needed only for remotely managed configuration, connector inventory, or later DNS
publication.

The connection sheet should:

1. Explain the difference between a Cloudflare API token and a tunnel-run token.
2. Ask for an exact account ID instead of requesting broad account-list permission merely to
   discover it.
3. Accept the API token in a password field or use an already configured credential provider.
4. Verify the token and probe only the required tunnel endpoint.
5. Report effective capabilities as Read tunnels, Manage tunnel configuration, and Publish DNS
   hostnames rather than merely saying Connected.
6. Keep the token in memory unless the user explicitly chooses an OS credential provider.
7. Offer Disconnect, which clears memory and invalidates the local session immediately.

Provide separate least-privilege setup recipes:

- observe: tunnel read permission;
- manage remote configuration: tunnel read/edit permission;
- publish a hostname: add DNS edit only for the intended zone.

ProtoPeek should never accept a Global API Key or request DNS authority for users who only need
tunnel status.

### Page anatomy

The page should contain:

1. **Header**
   - Cloudflare Tunnel
   - Local-only badge
   - manual Refresh
   - detected cloudflared version
   - explicit Check latest version action
   - Install cloudflared guidance and official download link when missing
   - Open Cloudflare dashboard link

2. **Authority strip**
   - Cloud account
   - Local host
   - Container
   - each with independent connection, ownership, and freshness states

3. **Deployments rail**
   - one row per discovered or adopted deployment
   - source badge: Remote managed, Local YAML, Quick, Container, or Unmanaged
   - tunnel name or UUID when known
   - service/process state
   - config authority
   - connector health

4. **Selected deployment workspace**
   - Overview
   - Routes
   - Runtime
   - Logs & metrics
   - Access & settings

5. **Action drawer**
   - plan summary
   - exact files and service affected
   - structured diff
   - validation results
   - privilege requirement
   - rollback point
   - typed confirmation only for materially destructive actions

### Overview

Show facts with their source:

- deployment driver and management mode;
- tunnel name and UUID, partially redacted where appropriate;
- executable path and version;
- service manager and exact unit/service label;
- status, PID, uptime, exit status, and restart policy;
- effective config path and why it won discovery;
- credential source type without secret content;
- configured metrics address;
- connector count and edge locations when available;
- last manually refreshed time.

A conflict callout should appear when, for example, the service points to one config but a different
default config also exists.

### Routes

Use a structured editor for the safe common subset:

- hostname;
- path as a regular expression, not a glob—use an accurate example such as `^/api/.*`;
- service URL;
- final catch-all;
- selected origin request settings with clear defaults.

Current source labels this action **Draft ingress route**. It performs only basic browser-side
structural checks and produces no file or account request. It must not call the proposal validated
until `cloudflared tunnel ingress validate` has run in a later authoritative adapter. For a
remote-managed deployment, Cloudflare account authority remains visible and the draft has no local
YAML destination.

Also provide a raw YAML view for advanced configurations. The form and raw views must share one
revision and make normalization visible. If ProtoPeek encounters keys it cannot round-trip safely,
the form becomes read-only and the raw view explains why.

Every proposed local change follows:

> Observe → Plan → Validate → Apply → Verify → Roll back if verification fails

The plan must expose:

- current content hash;
- proposed content hash;
- semantic route diff;
- raw diff;
- cloudflared validation output, redacted and bounded;
- service action, if any;
- rollback file and retention policy.

The last ingress rule must be a catch-all. The UI should teach and enforce this rule before invoking
cloudflared's authoritative validation.

The parsed-route count for a configuration source includes that final catch-all. A separate
hostname-route count may exclude it only when the UI labels the catch-all status beside the number.

### Runtime

Current source provides three separate, confirmed actions with explicit effects:

- Start
- Stop
- Restart

The API hard-codes the canonical service target for the operating system. The confirmation carries
the state last observed by the UI; the backend re-reads that state immediately before touching the
service and returns `stale` if it changed. Accepted actions end with another bounded observation,
and completion requires the action’s expected post-state. Already-running Start and already-stopped
Stop are reported as unchanged. Permission failures return an elevation-required result and exact
OS guidance, not a browser credential prompt.

Unknown and transitional states are refused. Start is compatible only with stopped; Stop with
running or paused; and Restart with running, stopped, or paused. This keeps a syntactically matching
`unknown` state from masquerading as a useful freshness guard.

Later runtime actions may include:

- Reload only if the detected deployment and cloudflared version support it safely
- Re-run diagnostics
- Adopt an unmanaged deployment
- Forget a ProtoPeek profile without deleting the underlying tunnel

Do not put Delete tunnel, force cleanup, credential deletion, or token rotation beside Start and
Stop. Those are later, separately gated workflows.

### Logs and metrics

cloudflared exposes Prometheus metrics, normally on the first free loopback port from 20241 through
20245 and on a random port if those are occupied. Container behavior can differ. ProtoPeek must
discover the effective address from process/service evidence where possible rather than assuming a
port.

Version one should provide:

- a capped one-shot metrics snapshot;
- a capped local log snapshot from the known service manager or configured log file;
- redaction before bytes cross the API boundary;
- an explicit 30- or 60-second live view only while the panel is visible;
- a visible Stop control and automatic teardown on navigation.

Remote <code>cloudflared tail</code> can be a later explicit action. Cloudflare limits a tail
session to one hour, high-volume tunnels may drop events, and debug logs can expose URLs and headers.
Those constraints belong in the UI.

Sources:

- [Tunnel metrics](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/metrics/)
- [Tunnel logs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/logs/)

### Handoff to existing ProtoPeek tools

Each ingress rule should offer:

- **Open in HTTP** for HTTP/HTTPS origins;
- **Open in gRPC** for gRPC origins;
- **Inspect local listener** in This Device;
- **Inspect route** in Network.

The handoff populates the existing workbench but never sends a request automatically. This is the
integration's strongest product advantage over a standalone dashboard.

## Backend architecture

### Package boundaries

Add three deliberately small layers:

| Package | Responsibility | Forbidden responsibility |
| --- | --- | --- |
| <code>internal/tunnels</code> | Domain types, discovery merge, capability model, plans, verification, redaction policy | Shell strings, HTTP handlers, UI models tied to React |
| <code>internal/cloudflared</code> | Binary discovery, bounded command execution, config parsing, ingress validation, metrics/log adapters, OS service drivers | Cloudflare account auth, arbitrary command execution |
| <code>internal/cloudflareapi</code> | Minimal standard-library REST client for the tunnel endpoints ProtoPeek actually uses | General Cloudflare SDK, secret persistence, DNS mutations without explicit scope |

The HTTP layer belongs in <code>standalone/tunnel_handlers.go</code>. The CLI composition belongs in
<code>internal/cli/tunnel_command.go</code>. Keep account API types separate from local host types so
the UI cannot mistake a remote configuration for an applied local configuration.

### Dependency injection

Follow the existing Downloader and This Device pattern:

- add <code>WithTunnelService</code> to handler options;
- construct the service at CLI startup;
- mount the route only when the local access policy permits it;
- use fake services in handler tests;
- keep platform-specific service code behind build-tagged files.

### Discovery algorithm

Discovery order is evidence-driven:

1. A user-created ProtoPeek profile with an allowlisted exact path.
2. The canonical OS service definition, including executable and command arguments.
3. A running cloudflared process with a safely parsed command line.
4. An explicitly adopted Compose file and its declared mount/command metadata.
5. Cloudflare's documented default configuration locations.
6. PATH candidates for cloudflared and Wrangler.

Higher-confidence evidence does not erase lower-confidence candidates. Return all bounded candidates,
mark one effective for each deployment, and explain precedence.

Never:

- recursively search the home directory;
- inspect unrelated environment variables;
- read arbitrary process environments;
- follow symlinks for mutation;
- infer a token from a JWT-looking argument and return it;
- treat a file existing in a default directory as proof that the active service uses it.

### Deployment drivers

Use a small interface for deployment-specific operations:

- <code>system-service</code>: the canonical cloudflared unit/service/daemon;
- <code>owned-child</code>: an explicit ProtoPeek-started quick or foreground process;
- <code>compose-profile</code>: a user-adopted Compose service;
- <code>unmanaged-process</code>: discovery and diagnostics only until adopted.

Version one manages one canonical system service per machine. One tunnel can already expose multiple
origins. Advanced users who intentionally run several system units can adopt them later by exact
service name. ProtoPeek must not invent or glob service names.

### Configuration storage

Reuse the safety properties of <code>internal/transfer</code>:

- private parent directory;
- regular-file and no-symlink checks;
- strict maximum size;
- current SHA-256 revision required for mutation;
- write a private temporary file;
- flush, fsync, and atomic replace;
- re-read and verify bytes;
- bounded timestamped backups;
- no secret material in the general host configuration.

Use <code>gopkg.in/yaml.v3</code> only when the editing phase begins, and operate on
<code>yaml.Node</code> so comments and ordering can be retained where possible. Exact formatting
cannot always survive a structured edit, so show the raw diff. Unknown or lossy structures force raw
mode rather than being discarded.

The authoritative local apply transaction is:

1. Re-read and compare the expected hash.
2. Parse and enforce ProtoPeek's safe structural rules.
3. Write a candidate file in a private staging directory.
4. Run cloudflared validation against the candidate.
5. Capture the current service state and create a rollback copy.
6. Atomically replace the destination.
7. Restart only if the approved plan includes it.
8. Verify service state, connector health, and optional route probes.
9. Restore the prior bytes and prior running/stopped state if verification fails.
10. Return an audit receipt with secret-free evidence.

### Remote configuration

The Cloudflare REST client should initially cover only:

- list and get tunnels;
- get tunnel details and connections;
- get tunnel configuration;
- update tunnel configuration;
- retrieve a tunnel token only inside an explicit provisioning flow;
- DNS hostname publication only in a later, separately authorized flow.

Remote writes need the same plan/apply discipline:

1. Fetch current state and version/etag-equivalent evidence.
2. Produce a semantic JSON diff.
3. Refuse if the state changed before apply.
4. PUT the intended configuration.
5. Read it back and compare.
6. Never automatically synchronize remote and local modes.

If the API cannot provide a strong revision token, use a canonical hash of the relevant fetched
document and perform a last-moment comparison. Report that this is optimistic concurrency, not a
Cloudflare transaction.

### Bounded HTTP API

Local endpoints are versioned and split between implemented operations and gated plans:

| Method and route | State | Purpose |
| --- | --- | --- |
| <code>GET /api/tunnels/capabilities</code> | Current | Platform, service-manager, install guidance, and mutation capability boundary |
| <code>POST /api/tunnels/snapshot</code> | Current | Explicit bounded real-host refresh and deployment discovery |
| <code>POST /api/tunnels/release</code> | Current | One explicit bounded request to the fixed official latest-release endpoint; no credentials |
| <code>POST /api/tunnels/service-action</code> | Current | Confirmed start/stop/restart enum plus expected state for the canonical service; no caller-supplied target or password |
| <code>GET /api/tunnels/deployments/{id}</code> | Planned | Cached result from the explicit snapshot, without secrets |
| <code>POST /api/tunnels/config/validate</code> | Planned | Validate candidate local YAML without applying |
| <code>POST /api/tunnels/ingress/match</code> | Planned | Test one URL against a candidate config |
| <code>POST /api/tunnels/plans</code> | Planned | Create a short-lived immutable mutation plan |
| <code>POST /api/tunnels/plans/{id}/apply</code> | Planned | Apply one matching, unexpired plan |
| <code>POST /api/tunnels/logs/snapshot</code> | Planned | Return a bounded redacted log sample |
| <code>POST /api/tunnels/metrics/snapshot</code> | Planned | Return a bounded parsed metrics sample |
| <code>POST /api/tunnels/access/session</code> | Planned | Establish an in-memory Cloudflare API session |
| <code>DELETE /api/tunnels/access/session</code> | Planned | Clear the in-memory API credential immediately |

Current POST endpoints require the existing CSRF token and return `Cache-Control: no-store`.
`/release` accepts an empty body only. `/service-action` accepts one strict `application/json`
object of at most 1 KiB with only `action`, `expectedState`, and `confirmed`; logical outcomes such
as `stale`, `elevation-required`, `not-installed`, `unchanged`, or `failed` remain structured HTTP
200 responses rather than being collapsed into transport errors.

Do not expose a generic command endpoint, arbitrary path endpoint, environment viewer, registry
editor, service manager, or file browser.

Mutating responses should include:

- plan ID and plan hash;
- before and after revisions;
- each attempted phase and duration;
- validation and verification evidence;
- rollback status;
- a stable error code and human explanation;
- no raw command line, environment, credential, or unredacted log.

### CLI surface

The web UI is primary. The following CLI remains planned for headless setup and recovery; none of
these commands should be documented as current until it calls the same reviewed domain service:

- <code>pp tunnel doctor</code>
- <code>pp tunnel list</code>
- <code>pp tunnel show NAME</code>
- <code>pp tunnel validate --config PATH</code>
- <code>pp tunnel ingress-match URL --config PATH</code>
- <code>pp tunnel service status</code>
- <code>pp tunnel token set --stdin</code>
- <code>pp tunnel rollback RECEIPT</code>

The CLI must call the same domain service as the HTTP handlers. It is not an alternate
implementation and should not grow a generic shell escape.

## Privilege architecture

ProtoPeek itself must continue to run as the normal user. Running the entire web server as root or
Administrator would turn every UI and HTTP bug into a host compromise.

Current canonical-service actions use only the permissions already held by the ProtoPeek process.
When those permissions are insufficient, the operation returns `elevation-required` plus a bounded,
copyable action for the user to run through the operating system’s normal administrator path.
ProtoPeek does not spawn `sudo`, manufacture a UAC dialog, or accept a password/PIN through the
browser or local API. The terminal, sudo, Windows, or macOS owns authentication, input masking,
retry, lockout, and auditing.

Future config-file, token-file, or combined apply-and-restart operations require a one-shot helper
mode in the same released ProtoPeek binary. Those wider mutations must remain gated until the
corresponding artifacts and helper flow are reviewed and, where appropriate, platform-signed:

1. The normal process creates a short-lived operation manifest.
2. The manifest names an exact allowlisted action, destination path, service identifier, expected
   revision, candidate-file hash, and expiration.
3. The user sees the complete plan before elevation.
4. The OS launches the same binary in helper mode.
5. The helper validates ownership, permissions, path roots, service allowlist, revision, hash,
   expiration, and a one-use nonce.
6. It performs only that operation, writes a secret-free receipt, and exits.

Platform approach:

| Platform | Current observe/control phase | Future file/config mutation phase |
| --- | --- | --- |
| Linux | Query `cloudflared.service`; run only a confirmed, fresh-state start/stop/restart when already permitted, otherwise return exact `sudo systemctl` guidance | Reviewed one-shot helper or guided administrator command with path/revision/hash validation |
| Windows | Query SCM with manager-connect and service-query rights; run only a confirmed, fresh-state control when already permitted, otherwise return Administrator/UAC guidance | Signed one-shot `runas` helper with manifest/nonce validation |
| macOS | Inspect the canonical LaunchDaemon/LaunchAgent and run only a confirmed, fresh-state launchd action when already permitted, otherwise return administrator guidance | Signed helper design or guided administrator command after a dedicated security review |

Neither the current service adapters nor the future helper accept a raw command string. Current API
requests contain only the closed action enum, confirmation, and expected state; service identifiers
and manual command templates are backend-owned. Native APIs are preferred where practical.

Cloudflare's platform service behavior must be represented accurately:

- Linux normally uses <code>cloudflared.service</code>; sudo can change HOME, so an explicit config
  path is important.
- Windows stores the service command in the Cloudflared service's ImagePath.
- macOS login agents normally use the user's config directory, while boot daemons normally use
  <code>/etc/cloudflared</code>.

Sources:

- [Run as a Linux service](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/linux/)
- [Run as a Windows service](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/windows/)
- [Run as a macOS service](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/macos/)
- [Remotely managed run parameters](https://developers.cloudflare.com/tunnel/advanced/run-parameters/)

## Credential and security model

### Credential types are not interchangeable

| Credential | Scope | ProtoPeek rule |
| --- | --- | --- |
| Tunnel token | Runs one remotely managed tunnel; anyone holding it can run a connector | Accept once, never echo; prefer a private token file and <code>--token-file</code> |
| Cloudflare API token | Calls account APIs according to granted permissions | Least privilege, session/env/keyring provider; never save in general config |
| Local tunnel credentials JSON | Runs one locally managed tunnel | Show path and metadata only; never return contents |
| <code>cert.pem</code> | Broad local-management authority for the account | Show a high-risk presence warning and metadata only; never import, display, copy, or transmit |

Cloudflared supports token files in releases from 2025.4.0. When compatible, ProtoPeek should migrate
a service away from a literal token argument so the token is not visible in process listings or
service definitions.

Cloudflare API tokens should be custom, least-privilege tokens. Tunnel read/edit permissions are
separate from DNS edit permission, which should be requested only when the user explicitly enables
hostname publication.

Sources:

- [Tunnel credential permissions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-permissions/)
- [Create Cloudflare API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

### Credential providers

Ship providers in this order:

1. one-time in-memory API session;
2. process environment for headless deployments;
3. explicit private token file for the connector;
4. OS credential store integration after platform review:
   - Windows Credential Manager/DPAPI;
   - macOS Keychain;
   - Linux Secret Service where available;
5. explicit private API token file as an opt-in headless fallback, with a strong warning.

The browser may contain a token only in a one-time password input long enough to submit it to the
loopback service. Clear component state immediately after the request. Never use localStorage,
sessionStorage, URL parameters, query history, analytics, crash reports, clipboard automation, or
the ordinary ProtoPeek host config for secrets.

### Local web boundary

The entire Tunnels API and route must be unavailable when ProtoPeek starts with unsafe remote access.
It should also be unavailable in the default scratch/non-root container image.

Every route requires:

- a loopback peer;
- an accepted loopback Host;
- no forwarded-host/proto/client headers;
- same-origin validation;
- the existing CSRF protection for state changes;
- SameSite=Strict cookies;
- short-lived mutation plan IDs and nonces;
- <code>Cache-Control: no-store</code>;
- a restrictive Content Security Policy;
- <code>frame-ancestors 'none'</code>;
- strict request body and timeout limits;
- redaction before serialization.

Never encourage exposing ProtoPeek's administrative UI through the same tunnel it controls. For a
headless server, document an SSH local port forward to the loopback listener.

### Redaction

Redact before storage, logs, tests, API responses, and UI rendering:

- <code>--token</code> values and token environment variables;
- Authorization and Cookie headers;
- Cloudflare API tokens, including current token prefixes;
- JWT-shaped tunnel tokens;
- credentials JSON content;
- account and zone identifiers where they do not aid diagnosis;
- URL userinfo and sensitive query keys;
- origin headers shown by debug logs.

Use exact structured redactors for known fields and a conservative heuristic as a final guard.
Golden tests should prove both that secrets disappear and that useful error context survives.

## Docker and Compose

Do not mount the Docker socket into ProtoPeek. Access to that socket is effectively host-root and
would violate the local safety model.

The default container remains scratch-compatible and non-root. It should report tunnel management
as unavailable rather than adding cloudflared, a shell, systemd, Docker, or credentials.

A later Compose adapter can work without the socket:

1. User explicitly selects or passes an exact Compose file.
2. ProtoPeek parses the selected service's image, command, environment-key names, volumes, and
   restart policy.
3. It redacts all values from secret-like keys.
4. It shows a proposed file diff.
5. The user applies outside ProtoPeek or explicitly authorizes a bounded <code>docker compose</code>
   invocation against that one file and service.

The adapter should prefer Compose secrets or an explicit token file over an inline token. It must not
search every project on disk or manage unrelated services.

Source: [Cloudflared installation and container update guidance](https://developers.cloudflare.com/tunnel/downloads/update-cloudflared/)

## Diagnostics

The read-only Doctor should work before any Cloudflare account connection and return a compact
checklist:

- cloudflared found, exact path, version, and supported-age status;
- service manager and canonical service present;
- service arguments parsed or safely unavailable;
- effective configuration path and competing candidates;
- config readable, regular, non-symlink, bounded, and valid;
- final catch-all present;
- credential source present without reading content;
- metrics endpoint discovered and reachable;
- local origin targets reachable on the expected scheme;
- connector process and HA connections observed;
- optional Cloudflare API connection;
- optional Wrangler and Docker capability;
- startup connectivity prechecks when supported by the installed cloudflared release.

Each result needs: state, severity, source, observed time, a short explanation, and one scoped next
action. Unknown is not failure.

## Exact repository plan

### Go

Current foundation:

- <code>internal/tunnels/types.go</code>
- <code>internal/tunnels/service.go</code>
- <code>internal/cloudflared/inspect.go</code>
- <code>internal/cloudflared/invocation.go</code>
- <code>internal/cloudflared/release.go</code>
- <code>internal/cloudflared/action.go</code>
- <code>internal/cloudflared/service_linux.go</code>
- <code>internal/cloudflared/service_windows.go</code>
- <code>internal/cloudflared/service_darwin.go</code>
- <code>internal/cloudflared/service_unsupported.go</code>
- <code>standalone/tunnel_handlers.go</code>
- local-only composition through <code>standalone/opts.go</code>,
  <code>standalone/standalone.go</code>, and <code>internal/cli</code>.

Add only as their gated phases become real:

- <code>internal/tunnels/discovery.go</code>
- <code>internal/tunnels/plan.go</code>
- <code>internal/tunnels/redact.go</code>
- <code>internal/tunnels/receipt.go</code>
- <code>internal/cloudflared/validate.go</code>
- <code>internal/cloudflared/metrics.go</code>
- <code>internal/cloudflared/logs.go</code>
- <code>internal/cloudflareapi/client.go</code>
- <code>internal/cloudflareapi/tunnels.go</code>
- <code>internal/cli/tunnel_command.go</code>

Modify platform build/release files only as each platform gains verified capability.

Test files should sit next to every package. Add fake executable fixtures, service-definition
fixtures, config fixtures, API fixtures, and redaction golden files under scoped testdata
directories. All token-shaped values in fixtures must be synthetic and clearly invalid.

### Web

Current foundation:

- <code>web/src/console/Tunnels.tsx</code>
- <code>web/src/console/tunnels-api.ts</code>
- <code>web/src/console/tunnels.css</code>
- focused component, API, state, accessibility, and route tests.

Current integration modifies:

- <code>web/src/console/ProtocolFrame.tsx</code> for the Tunnels navigation item;
- <code>web/src/console/router.tsx</code> for a route-lazy boundary;
- command palette/search metadata so Tunnels actions are discoverable;
- bundle-budget configuration with a dedicated route ceiling.

Do not add a charting library. Metrics need compact numbers, sparklines implemented with existing
primitives if necessary, and tables for edge evidence.

### Documentation and site

Current source includes the README fast path, detailed guides, public-page registry source,
generated page artifact, sitemap, and LLM-readable index. They must continue to say **current source
after v0.5.0**, not stable-package availability. As phases ship:

- keep <code>guides/cloudflare-tunnels.md</code> as the user guide;
- keep the canonical public page in <code>public-pages.json</code> and the existing site generator;
- add scrubbed real screenshots to the screenshot manifest;
- update README, roadmap, product metadata, sitemap, and llms output in the same release PR;
- add a capability matrix by OS and deployment mode;
- link directly to official Cloudflare documentation for vendor-specific behavior.

## GitHub execution plan

### One epic, four milestones

Create one tracking issue: **Cloudflare Tunnel workspace inside ProtoPeek**.

Use milestones:

1. <code>tunnels-local-operations</code> — current-source observation, release check, and closed
   canonical-service control
2. <code>tunnels-config-safety</code> — authoritative validation, plans, atomic writes, and rollback
3. <code>tunnels-cloud-api</code> — explicit least-privilege account authority
4. <code>tunnels-platform-ga</code> — real installed-service and privilege smoke evidence on every OS

Suggested labels:

- <code>area:tunnels</code>
- <code>security</code>
- <code>platform:linux</code>
- <code>platform:windows</code>
- <code>platform:macos</code>
- <code>kind:docs</code>
- <code>kind:test</code>

### Issue slices

Keep PRs reviewable and ordered:

1. Product ADR, threat model, capability matrix, and route-unavailable contract.
2. Domain types and deterministic discovery merge.
3. Binary/version and default-path discovery.
4. Linux systemd read-only adapter.
5. Windows SCM read-only adapter.
6. macOS launchd read-only adapter.
7. cloudflared validation and ingress-match adapter.
8. Redaction library and secret regression fixtures.
9. Local HTTP API with read endpoints and the closed canonical-service action contract.
10. Lazy Tunnels shell and capability onboarding.
11. Deployment overview and conflict UX.
12. Browser-only route draft; later config editor, raw diff, and mutation-plan creation.
13. Elevated helper protocol for bounded config/token files.
14. Config apply, verify, automatic rollback, and receipts.
15. Metrics/log snapshots.
16. HTTP/gRPC/Network/This Device handoffs.
17. API credential session and remote read.
18. Remote config plan/apply.
19. Windows file/config mutation parity.
20. macOS file/config mutation parity.
21. Explicit quick-tunnel lifecycle.
22. Adopted Compose profile experiment.
23. User guide, site page, screenshots, and launch assets.

Every mutation PR needs a security reviewer mindset even if there is only one maintainer: write down
the assets, trust boundary, abuse case, and rollback before merging.

### Branch and release policy

- One feature branch per issue slice, not a long-lived mega-branch.
- Merge observation and closed canonical-service actions before any file, credential, or cloud
  mutation code.
- Put incomplete wider mutations behind an internal capability flag, not a misleading disabled button.
- Release observation and canonical-service control as beta before file/config writes.
- Do not advertise an OS as supported until CI fixtures and one real-host smoke test pass.
- Keep one repository, one version, one changelog, one artifact set, and one site.

### CI

CI must not need root, a real Cloudflare account, the public Internet, or a real token.

Add:

- fake cloudflared executables with deterministic stdout, stderr, exit codes, hangs, and oversized
  output;
- golden tests for supported CLI output families rather than one exact version string;
- temp YAML fixtures for valid, invalid, catch-all, comments, unknown keys, symlinks, and conflicts;
- systemd unit, launchd plist, and Windows service-command fixtures;
- fake Cloudflare API server tests for auth, pagination, concurrency conflict, rate limit, and
  redaction;
- helper manifest tests for path escape, stale hash, nonce reuse, expiration, service-name escape,
  and candidate replacement;
- cancellation and teardown tests for every spawned process;
- frontend tests for unavailable, unknown, partial, conflict, plan, failure, rollback, and
  narrow-screen states;
- accessibility checks for tabs, dialogs, focus return, live updates, and reduced motion;
- route-lazy and aggregate bundle ceilings;
- scratch/non-root container smoke tests proving the privileged route is unavailable;
- a secret canary test that fails if API responses, snapshots, logs, or built assets contain
  token-shaped fixture values.

Keep GitHub push protection and secret scanning enabled. Because tunnel tokens can look like generic
JWTs, do not rely on provider detection alone; add repository-specific tests and redaction patterns.

Source: [GitHub push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)

## Delivery phases

### Phase 0 — contract and threat model

Deliver:

- this plan;
- a short ADR accepting the product expansion;
- a threat model for loopback UI, local files, elevation, process inspection, and Cloudflare API;
- updated contributor boundaries in AGENTS.md when implementation begins.

Exit gate: reviewers can state what the feature will never do.

### Phase 1 — observe and control the canonical service

Suggested release: v0.6 beta.

Implemented in current source:

- lazy Tunnels route;
- idle capability screen and manual real-host discovery with no fixture fallback;
- executable/version, OS service, process, path, config, and credential-source metadata;
- bounded local YAML parsing and route evidence;
- explicit latest-release comparison plus official download/install guidance;
- confirmed, expected-state-guarded start/stop/restart for the canonical Windows SCM, systemd, or
  launchd service, with verified post-action observation and OS-owned elevation guidance;
- no automatic install/update, config write, token input, account API, Docker-daemon call,
  background polling, or browser/API password collection.

Exit gate: a user can identify the effective service/configuration, tell whether `cloudflared` is
missing or stale, and control only the canonical service after confirmation. A stale view cannot
win a race, and no OS credential crosses the ProtoPeek boundary.

### Phase 2 — earn local configuration mutation

Suggested release: v0.7 beta.

Deliver:

- local YAML plan/diff/apply;
- authoritative `cloudflared` validate/match before apply;
- one-shot elevated helper for bounded file/token changes;
- token-file provisioning and literal-token migration;
- verification, automatic rollback, and receipts;
- bounded local logs/metrics and a Doctor report.

Exit gate: every failed apply restores both file bytes and prior running state in integration tests
and real-host smoke tests.

### Phase 3 — remotely managed tunnels

Suggested release: v0.8 beta.

Deliver:

- in-memory/env credential providers;
- tunnel and connector listing;
- remote configuration read;
- least-privilege permission guidance;
- remote configuration plan/apply/read-back verification;
- optional hostname publication only after a separate DNS permission flow.

Exit gate: ProtoPeek clearly separates account state from connector state and never persists a token
without an explicit credential-provider choice.

### Phase 4 — platform mutation hardening and parity

Deliver:

- signed Windows UAC helper for file/config plans;
- reviewed macOS helper/guided file action;
- platform-specific token-file and file-permission verification;
- real-host privileged and unprivileged smoke coverage on all three operating systems;
- a truthful capability matrix.

Exit gate: each supported platform passes real-host install, discover, apply, restart, fail, rollback,
uninstall, and upgrade scenarios.

### Phase 5 — developer and container workflows

Deliver only if evidence justifies them:

- explicit quick-tunnel lifecycle;
- adopted Compose profile;
- optional Wrangler project awareness;
- multiple explicitly named service units.

Exit gate: each adapter is bounded and does not add Docker-socket, arbitrary-shell, or credential
scraping capability.

### General availability gate

Do not call the feature stable or 1.0-ready until:

- local-only routing and elevation threat model are reviewed;
- Linux, Windows, and macOS claims match tested reality;
- no known secret can cross an API response or log boundary;
- config rollback has survived kill, timeout, malformed config, and failed restart cases;
- route bundle and startup budgets remain within project ceilings;
- cloudflared version skew tests cover supported releases;
- user guide and screenshots match the released UI;
- at least one beta cycle has produced real installation feedback.

## Explicit non-goals

For the initial releases:

- no second repository or separately released daemon;
- no bundled cloudflared or Wrangler;
- no automatic cloudflared installation or update;
- no Cloudflare Global API Key support;
- no broad DNS editor;
- no arbitrary process, service, registry, plist, systemd, file, or command manager;
- no Docker socket;
- no remote administration;
- no ambient polling when the route is closed;
- no automatic token rotation, tunnel deletion, credential deletion, or force cleanup;
- no promise about Cloudflare pricing, quotas, uptime, or permanent plan availability;
- no import or reuse of Wrangler's authentication store;
- no silent conversion between local and remote management.

## Marketing and launch

### Positioning

Primary sentence:

> ProtoPeek is the local workbench that shows which tunnel configuration is actually in control,
> lets you preview a safe change, and helps verify the exposed service.

Do not position it as a prettier Cloudflare dashboard. The differentiated story is the local
service-to-public-route loop:

1. discover the running origin;
2. identify the effective tunnel authority;
3. validate and preview a route change;
4. apply and verify the connector;
5. open the endpoint in ProtoPeek's HTTP or gRPC workbench.

### Audience

- self-hosters and homelab operators;
- developers exposing local HTTP or gRPC services;
- small teams managing one or a few servers;
- operators debugging config-file versus service-definition drift.

### Mature-feature demo

A 60–90 second demo should show:

1. Tunnels opens without an account sign-in.
2. ProtoPeek detects cloudflared, systemd, and the exact effective config.
3. It warns about a competing unused default file.
4. The user adds one hostname route.
5. ProtoPeek shows the YAML diff and cloudflared validation.
6. The service restarts and verification succeeds.
7. The public URL opens prefilled in the HTTP or gRPC workbench.

Use only scrubbed demo credentials, account IDs, domains, hostnames, IPs, file paths, and logs.
Until config mutation ships, stop after the browser-only route draft and show the current canonical
service controls separately; do not edit YAML or imply that the draft was applied.

### Launch sequence

1. Publish the current real-host observation, release-check, setup-guidance, and canonical-service
   control foundation as an edge/prerelease build.
2. Invite existing ProtoPeek users to test detection with a redaction-safe feedback template.
3. Run installed/absent and privileged/unprivileged real-service smoke tests on Windows, Linux, and
   macOS; fix platform gaps before promoting the capability.
4. Publish the config-mutation beta only with validation and rollback evidence.
5. Publish the remote-management beta.
6. Release stable documentation, screenshots, and capability matrix only when implementation ships.
7. Share the real workflow in GitHub Discussions and relevant self-hosted, homelab, Go, and
   Cloudflare communities without cross-post spam or affiliation claims.

### Feedback without telemetry

Keep telemetry off by default. Measure:

- release downloads and installer adoption;
- documentation search impressions and click-through;
- issue-template counts for detect, validate, apply, and rollback stages;
- voluntarily exported, redacted Doctor reports;
- beta completion survey: detected correctly, understood authority, applied safely, verified route.

The UI may maintain session-local funnel state for usability, but must not send it anywhere unless a
future opt-in telemetry decision is separately approved.

## SEO and public documentation

### One product, one canonical feature page

Use one canonical page under the ProtoPeek site, not a microsite or second domain:

- <code>/cloudflare-tunnels/</code>

The page uses **Manage Cloudflare Tunnel locally** as its H1. Its title and description lead with the
user task, use Cloudflare’s mark only referentially, and do not imply official status.

Current document title:

> Manage Cloudflare Tunnel Locally | ProtoPeek

Current description:

> Inspect cloudflared on the real host, compare versions, use guarded canonical-service controls,
> and trace config authority with ProtoPeek.

The registry also supplies focused structured-data keywords for cloudflared service, version,
config, and the three native service managers. Search-facing copy must keep **current source after
v0.5.0** visible and must not describe route drafts as applied configuration.

### Search-intent documentation

Publish practical pages or sections only when the matching capability exists:

- find the active cloudflared config file;
- understand remote-managed versus locally-managed tunnels;
- inspect and restart the canonical cloudflared systemd service safely;
- move a tunnel token from a process argument to a token file;
- validate Cloudflare Tunnel ingress rules;
- debug a tunnel that is connected but cannot reach its local service;
- understand ProtoPeek, cloudflared, Wrangler, and Docker responsibilities;
- understand the canonical Windows SCM and macOS launchd operations while the real-service smoke
  matrix is still incomplete.

Each page should solve the task first, link to official Cloudflare docs for vendor behavior, and link
back to the canonical ProtoPeek feature page. Avoid thin keyword variants and unsupported claims.

### Technical SEO

- Generate the canonical URL, per-page modification date, and XML-sitemap entry from
  <code>public-pages.json</code>.
- Keep one indexable URL per guide and redirect aliases.
- Keep the feature page as a <code>TechArticle</code> about the existing ProtoPeek
  <code>SoftwareApplication</code>, with its guide URL as <code>isBasedOn</code>; do not present a
  second application.
- Include operating systems, version, download URL, and feature list only when accurate.
- Validate structured data with Google's Rich Results Test.
- Ensure screenshots have descriptive alt text and no secret-bearing pixels or metadata.
- Keep page copy usable without JavaScript where the existing site generator allows it.
- Update <code>llms.txt</code> or equivalent generated discovery output from the same source data.
- Do not buy ads against Cloudflare marks or insert marks into hidden metadata contrary to the
  trademark policy.

### GitHub Pages release path

As inspected on 2026-09-02, GitHub Pages uses the legacy branch source `master` + `/docs`; the
repository has no custom Pages-deploy workflow. CI, stable-release, and edge-release workflows run
the build and reject stale generated `docs/` or embedded-app assets, but they do not publish the
website themselves.

Before a public push, run `bun install --frozen-lockfile`, `bun run test`, `bun run build`,
`go test ./...`, and `git diff --check`; review and commit the generated `docs/` and
`internal/resources/app/dist/` artifacts with their sources. Pushing that commit to `master`
triggers the platform-managed Pages build. The same push also triggers the edge-release workflow,
which replaces the public `v0.0.0-edge` tag and binaries after validation, so a website publication
is not isolated from current-source edge distribution. Wait until the latest Pages build reports
`built` for the exact pushed commit, then verify both the custom and legacy URLs. The custom
`/cloudflare-tunnels/` URL must return 200 with its canonical, title, description, Open Graph,
Twitter, structured-data source, and prerendered guide body. The legacy URL must redirect to the
same custom-domain path; sitemap and `llms.txt` must include the feature. Search Console sitemap
submission remains a separate owner action.

Sources:

- [Google SoftwareApplication structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Cloudflare trademark guidelines](https://www.cloudflare.com/trademark/)

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| ProtoPeek becomes a generic ops panel | Keep provider and action allowlists; no arbitrary shell/file/service API |
| A loopback web bug gains root | Normal process remains unprivileged; one-shot constrained helper |
| Token leaks through process args or UI | Token-file migration, one-time input, early redaction, secret canary tests |
| Wrong config is edited | Evidence-ranked discovery, effective-path explanation, explicit adoption, expected revision |
| Parser destroys advanced YAML | yaml.Node, raw diff, loss detection, raw-only fallback, cloudflared validation |
| Future config apply/restart breaks a working tunnel | Capture prior state, atomic backup, bounded verify, automatic rollback before enabling that workflow |
| Cloudflare CLI output changes | Capability probing, structured adapters, version families, golden fixtures |
| Wrangler experimental behavior changes | Detect only; no foundation dependency |
| Cross-platform promise outruns reality | Build-tagged closed drivers, explicit capability matrix, absent-host truth, and per-OS real-service smoke gates |
| Container support weakens host security | No Docker socket; explicit Compose file/profile only |
| UI adds background overhead | Route-lazy bundle, manual refresh, visible bounded live sessions |
| Vendor identity overwhelms ProtoPeek | Tunnels navigation, ProtoPeek-first page copy, referential trademark use |
| One maintainer accumulates too much surface | One repo/release, phased milestones, small packages, explicit non-goals |

## Acceptance scenarios

The current-source local-operations claim is ready only when these stories pass:

1. A production `/tunnels` inspection invokes the real host adapter; fixtures are reachable only
   from test binaries and test injection.
2. A machine with no `cloudflared`, canonical service, YAML, Wrangler, or Docker shows a successful,
   truthful empty state with official install/download guidance.
3. No Internet request occurs on page load or during local inspection. **Check latest version** is
   explicit, timestamped, bounded, and its failure does not erase local evidence.
4. An installed executable reports its resolved path and local version; current, update-available,
   outside-support, and unknown comparisons remain distinct.
5. Windows uses only `Cloudflared`, Linux only `cloudflared.service`, and macOS only the detected
   `com.cloudflare.cloudflared` LaunchDaemon/LaunchAgent; the API cannot supply another target.
6. Start, stop, and restart require confirmation, refuse an observed state that changed before the
   action, reject unknown/transitional states, treat already-achieved state as unchanged, and
   report completion only when a new canonical observation matches the expected post-state.
7. Insufficient permission returns elevation-required guidance. ProtoPeek never contains an OS
   password/PIN field and API bodies, logs, browser storage, and receipts never contain one.
8. Download and install affordances use official Cloudflare or `cloudflare/cloudflared` URLs and
   copyable commands only; ProtoPeek never downloads, installs, upgrades, or restarts as a side
   effect of inspection or release comparison.
9. **Draft ingress route** treats path input as a regex (for example, `^/api/.*`), remains
    browser-only, leaves config bytes unchanged, and keeps account/cloud mutation endpoints
    unavailable. Remote-managed drafts retain Cloudflare account authority and have no local YAML
    destination; parsed route counts include the final catch-all.
10. The Tunnels API remains unavailable in unsafe remote-listen and default scratch-container
    modes, and every secret-shaped observation is redacted before serialization.
11. Windows, Linux, and macOS test builds plus absent/present, privileged/unprivileged, transitional,
    timeout, stale, and post-action verification cases pass before a platform is advertised.

The wider configuration and Cloudflare-account roadmap is ready only when these later stories pass:

1. A default local YAML deployment is identified and validated without an account token.
2. A systemd service using a non-default <code>--config</code> path beats a stale default file, and
   the UI explains why.
3. A remotely managed token service is identified without showing the token.
4. A literal service token can be migrated to a private token file and the original token disappears
   from process/service evidence.
5. A stale browser tab cannot overwrite a config changed on disk.
6. Invalid YAML, a missing catch-all, a symlink destination, or an oversized file is rejected before
   privilege escalation.
7. A valid config whose restart fails is rolled back to the exact prior bytes and running state.
8. Logs containing Authorization, cookies, API tokens, or JWT-shaped values arrive redacted.
9. Unsafe remote mode and the default container return an unavailable capability and do not mount
    mutation endpoints.
10. A remote API rate limit or auth failure leaves local service controls functional.
11. A route can be handed to HTTP or gRPC without automatically issuing a request.
12. Closing a live panel cancels its subprocess, reader, timer, and network connection.
13. No README, website, screenshot, metadata, or release note claims more than the shipped
    capability matrix.

## Local validation performed for this plan

The implementation and design were checked without using a Cloudflare account, API token, tunnel
token, DNS record, or public Quick Tunnel. On the real Windows development host used on 2026-09-02:

- `cloudflared` was not on `PATH`;
- the canonical `Cloudflared` SCM service was not registered;
- Wrangler and Docker were not on `PATH`; and
- that all-absent state was treated as valid host evidence, not replaced by mock deployments.

Separate command-shape checks used temporary, isolated inputs:

- official cloudflared Windows amd64 release 2026.8.3 reported its version successfully;
- a temporary valid YAML with a final catch-all passed
  <code>cloudflared tunnel ingress validate</code>;
- a temporary YAML without a final catch-all failed validation;
- <code>cloudflared tunnel ingress rule</code> selected the expected rule;
- Wrangler 4.128.0 exposed its tunnel commands as experimental;
- all downloaded binaries and test configurations were removed afterward.

The canonical Windows service was absent, so this host did not exercise a real start, stop,
restart, permission-denied, UAC, or post-action state transition. These checks also do not replace
Linux/macOS real-service tests, an installed Windows-service test, account API tests, a live
connector, or future config-write/rollback integration tests. Until that matrix is run, those paths
remain beta capability claims rather than GA proof.

## Immediate next implementation step

Run the all-OS service-control smoke matrix with absent and installed canonical services, normal and
elevated users, stale/transitional states, timeouts, and verified post-action results. Preserve the
current closed action/service contract while doing so. In parallel, add authoritative
`cloudflared` validate/match and Doctor evidence. Do not begin config/token writes or account-token
storage until the plan/validation/rollback and credential-provider gates are separately reviewed.

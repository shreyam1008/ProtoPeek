# Inspect Cloudflare Tunnel locally with ProtoPeek

ProtoPeek’s **Cloudflare Tunnel** workspace gives a local machine one clear operations view without
creating another repository, daemon, or dashboard. It reads the real Cloudflare primitives already
on that host—`cloudflared`, the canonical operating-system service, and documented YAML
locations—and keeps the evidence beside ProtoPeek’s existing HTTP, gRPC, network, and machine
tools: the [HTTP workbench](/http-workbench/), [gRPC workbench](/grpc-workbench/),
[network workbench](/network-workbench/), and [This Device](/this-pc/).

This page describes the current-source foundation after v0.5.0. It is not included in the published
v0.5.0 packages, is not affiliated with or endorsed by Cloudflare, Inc., and does not make claims
about Cloudflare pricing or plan limits.

## What works now

Open **Publish** and enter the domain-native **Cloudflare Tunnel** workspace, or choose its task on
Home, then select **Inspect this host**. No host inspection, Internet release check, service action,
or background poll begins on page load. The product path always uses the running host adapter; it
does not substitute demo deployments or fixture data. Test-only fakes remain isolated to automated
tests.

One explicit inspection can show:

- whether `cloudflared` is available and its bounded `--version` result;
- the canonical `cloudflared` service known to systemd, launchd, or Windows Service Control Manager;
- the service state, PID, executable path, and any explicit `--config` or credential-source flag;
- documented user and system configuration candidates, without a recursive disk search;
- which YAML candidate is selected as authoritative, why it won, and whether it is readable and
  valid, while keeping competing candidates visible;
- named tunnel identity, management mode, config revision, ingress routes, protocols, and catch-all
  coverage;
- whether Wrangler or Docker is installed, without borrowing Wrangler authentication or contacting
  the Docker daemon; and
- a safe **Draft ingress route** drawer that checks the basic hostname, path, and local-service
  fields and previews YAML in the browser only.

An empty result is useful real evidence. If `cloudflared`, the canonical service, Wrangler, or
Docker is absent, ProtoPeek says so and offers the next relevant official link instead of inventing
a deployment.

The shortest user journey is:

1. Choose **Inspect this host** to gather local evidence.
2. If `cloudflared` is missing, review an official download link or copy the matching OS install
   command; ProtoPeek does not run it.
3. Choose **Check latest version** only when you want to contact the official GitHub release API.
4. If the canonical service exists, choose Start, Stop, or Restart, review the effect, and confirm.
   Refresh first if the service is transitional or its state is unknown.
5. Choose **Draft ingress route** to keep a browser-only proposal. There is no Apply action.

The deployment list, filter, detail tabs, config evidence, tool diagnostics, and responsive mobile
pane are all part of this local split-console workflow. Route rows for HTTP and gRPC services can
hand off to ProtoPeek’s existing [HTTP workbench](/http-workbench/) and
[gRPC workbench](/grpc-workbench/).

## Config authority and default locations

ProtoPeek does not pretend every YAML file it finds is active. An explicit `--config` argument in
the canonical service definition identifies the authoritative candidate; existence, readability,
regular-file status, and YAML validity remain separate evidence. Without an explicit path, a
locally managed canonical service selects only its fixed service-manager default source. With no
canonical service, the first readable documented candidate can be shown as effective without being
claimed as service-bound.

The bounded candidates are:

- the current user’s `.cloudflared/config.yml` and `.cloudflared/config.yaml` on every supported
  platform;
- `%SystemRoot%\System32\config\systemprofile\.cloudflared\config.yml` or `config.yaml` on Windows
  only when the canonical system service exists without an explicit `--config`;
- `/etc/cloudflared/config.yml` and `/etc/cloudflared/config.yaml` on Linux and macOS; and
- `/usr/local/etc/cloudflared/config.yml` and `/usr/local/etc/cloudflared/config.yaml` on Linux and
  macOS.

On Windows, service arguments are read through the native Service Control Manager path. ProtoPeek
does not crawl user profiles or guess an unrelated service account directory.

Each candidate is capped at 256 KiB and 256 ingress rules. Symlinks are reported but not followed.
Unreadable, oversized, non-regular, or invalid YAML remains visible as evidence rather than being
silently skipped.

A service started with a remotely managed tunnel token is different: **Cloudflare account** remains
the configuration authority, and ProtoPeek does not select a local YAML destination for it. Any
route draft opened for that deployment is only a browser proposal; current source cannot read or
write its remote ingress configuration.

Cloudflare `path` values are regular expressions, not shell-style globs. For example, use a shape
such as `^/api/.*`, not `/api/*`. Current source performs only structural browser checks on a draft;
authoritative `cloudflared tunnel ingress validate` and route matching remain planned. A config
source’s **parsed routes** count includes the required final catch-all. Any separate hostname-route
summary excludes that catch-all and reports its presence beside the count.

## Operating-system service behavior

ProtoPeek manages only Cloudflare’s canonical service identity. It does not accept a service name,
executable, argument list, or shell command from the browser.

| Host | Canonical evidence | Start, stop, and restart | If elevation is required |
| --- | --- | --- | --- |
| Windows | Windows Service Control Manager service `Cloudflared`; state, PID, and the safely parsed `ImagePath` are read with query-only access | A confirmed action targets that SCM service only | Open PowerShell as Administrator and use the exact copyable `Start-Service`, `Stop-Service`, or `Restart-Service` guidance; any PIN or password goes only to Windows |
| Linux | systemd unit `cloudflared.service`; `LoadState`, active/sub-state, PID, unit path, and a conservatively parsed `ExecStart` | A confirmed action targets that unit only | Use the exact copyable `sudo systemctl … cloudflared.service` guidance; `sudo` reads the password in the terminal |
| macOS | launchd label `com.cloudflare.cloudflared`; system LaunchDaemon first, then the current user’s LaunchAgent | A confirmed action targets the detected launchd definition only | A protected LaunchDaemon uses the exact copyable administrator command; macOS reads the password in the terminal |

When direct control is denied, the UI builds a command for the exact detected target. These are the
canonical command shapes it exposes:

| Host | Start | Stop | Restart |
| --- | --- | --- | --- |
| Windows Administrator PowerShell | `Start-Service -Name Cloudflared` | `Stop-Service -Name Cloudflared` | `Restart-Service -Name Cloudflared` |
| Linux terminal | `sudo systemctl start cloudflared.service` | `sudo systemctl stop cloudflared.service` | `sudo systemctl restart cloudflared.service` |
| macOS system LaunchDaemon | `sudo /bin/launchctl bootstrap system '/Library/LaunchDaemons/com.cloudflare.cloudflared.plist'` | `sudo /bin/launchctl bootout system/com.cloudflare.cloudflared` | `sudo /bin/launchctl kickstart -k system/com.cloudflare.cloudflared` |

For a macOS user LaunchAgent, the same `bootstrap`, `bootout`, and `kickstart -k` operations use the
detected `gui/<UID>` domain, the user plist path, and normally no `sudo`. Copy the concrete command
shown by ProtoPeek instead of substituting a guessed UID or path.

The Start, Stop, and Restart controls remain unavailable until an explicit inspection proves that
the canonical service exists. A missing service leads to setup documentation, not a mutation
attempt.

Every action shows its effect and requires confirmation. The request carries the state observed by
the browser; ProtoPeek re-reads the canonical service immediately before acting and refuses a
stale request when the state changed. It then observes the service again and reports success only
when the expected post-action state matches. Start on an already running service and stop on an
already stopped service are harmless, explicitly reported no-ops.

Unknown, starting, and stopping states are not actionable. Start is accepted only from stopped;
Stop from running or paused; and Restart from running, stopped, or paused. Refresh after a
transition or incomplete observation instead of forcing an ambiguous operation.

ProtoPeek never renders a sudo, administrator, UAC, Keychain, or system-password field. It never
receives, proxies, logs, or stores an operating-system password. When the current process lacks the
required service permission, the UI reports **Elevation required** and shows bounded guidance for
the operating system; it does not retry with captured credentials or run an arbitrary shell.

## Installed version, latest release, and downloads

**Inspect this host** reads the installed executable path and bounded `cloudflared --version`
output locally. It does not imply that an executable is installed merely because a service or YAML
file exists.

**Check latest version** is a separate, explicit Internet action. It reads Cloudflare’s official
latest GitHub release metadata, compares it with the detected local version, and reports the check
time, release time, and whether the local version is current, has an update available, is outside
Cloudflare’s one-year support window, or cannot be compared safely. ProtoPeek does not perform this
request on page load or in the background. As verified on 2026-09-02, the latest release was
[`2026.8.3`](https://github.com/cloudflare/cloudflared/releases/tag/2026.8.3); use the explicit check
for the answer at the time you run ProtoPeek.

Installation and update remain user-owned. ProtoPeek links to the official download and release
pages and can copy suitable commands, but it never downloads, installs, upgrades, or restarts
`cloudflared` automatically.

| Host | Installation/download guidance | Useful verification/service command |
| --- | --- | --- |
| Windows | Copy `winget install --id Cloudflare.cloudflared`, or use the 32/64-bit executable or MSI on [Cloudflare Downloads](https://developers.cloudflare.com/tunnel/downloads/); [GitHub Releases](https://github.com/cloudflare/cloudflared/releases/latest) lists assets and checksums | Run `cloudflared.exe --version`; install a prepared tunnel service from an Administrator Command Prompt with Cloudflare’s documented `cloudflared.exe service install` flow |
| Linux | After adding the [Cloudflare Package Repository](https://pkg.cloudflare.com/index.html), copy `sudo apt-get update && sudo apt-get install cloudflared` or `sudo dnf install cloudflared`; Homebrew users can copy `brew install cloudflared`; direct binaries, `.deb`, and `.rpm` files are on [Cloudflare Downloads](https://developers.cloudflare.com/tunnel/downloads/) | Verify with `cloudflared --version`, then follow Cloudflare’s documented `sudo cloudflared service install` flow |
| macOS | Install with `brew install cloudflared`, or select the Darwin architecture from [Cloudflare Downloads](https://developers.cloudflare.com/tunnel/downloads/) | Run `cloudflared --version`; `cloudflared service install` creates a login agent, while `sudo cloudflared service install` creates a boot daemon |

Package-manager channels, especially community-maintained manifests, can lag the upstream release.
Run **Inspect this host** and then **Check latest version** after installation instead of assuming the
package channel installed Cloudflare’s newest build.

On Linux, `sudo` can change `$HOME`. If the local config is under a normal user’s home directory,
use Cloudflare’s documented explicit form rather than assuming root will find it:

```sh
sudo cloudflared --config /home/<USER>/.cloudflared/config.yml service install
```

Review and replace every placeholder yourself; ProtoPeek does not execute or silently interpolate
this command.

Updating can interrupt traffic and must use the same installation mechanism: package-manager
installs are updated with that package manager, while eligible binary installs can use
`cloudflared update`. See [Update cloudflared](https://developers.cloudflare.com/tunnel/downloads/update-cloudflared/)
before changing a production connector.

## Secret and local-control boundary

Credential contents never enter the API response or browser. A literal `--token` value is consumed
only to identify that a token flag exists and is reported as redacted. Credential-file paths may be
shown because they explain configuration authority, but the files are never opened. Userinfo and
sensitive token, secret, key, or auth query values in ingress service URLs are redacted.

The current boundary permits only narrowly scoped canonical-service control:

- **Start**, **Stop**, and **Restart** require confirmation, a fresh-state check, an allowlisted
  canonical service target, and post-action observation;
- **Draft ingress route** produces a reviewable browser-only proposal but does not write local or
  remote configuration;
- there is no Cloudflare account sign-in or API-token storage;
- there is no password collector, arbitrary command runner, Docker daemon call, automatic install
  or update, ambient release check, or ambient log/metrics stream; and
- the local API stays unavailable when ProtoPeek is started in unsafe remote-listen mode.

This boundary allows the UI and evidence model to become useful before wider privileged file and
cloud mutations are earned.

## Does Wrangler come into play?

Wrangler is an optional diagnostic signal, not the foundation. ProtoPeek reports whether the CLI is
present and its version, but does not inspect Wrangler’s login state or reuse its stored
credentials. The stable primitives remain `cloudflared`, native service APIs, explicit local files,
and—only in a later opt-in phase—the Cloudflare REST API.

That split avoids coupling tunnel operations to an experimental developer-project workflow while
leaving room for a future Wrangler adapter.

## Planned next steps

The implementation plan separates further capability growth by risk:

1. Finish read-only evidence with authoritative `cloudflared` validation and route matching,
   bounded logs and metrics, and a local Doctor report.
2. Add atomic config writes only after plan, authoritative validation, revision checks, rollback,
   and receipts are complete on each operating system.
3. Add optional least-privilege Cloudflare account sessions for remotely managed tunnels.
4. Add container and optional Wrangler project awareness only after the local-host path is proven.

## QA acceptance checklist

Platform adapter tests exercise Windows, Linux, and macOS command/state behavior. The real Windows
host checked on 2026-09-02 proved the all-absent path and an isolated `cloudflared` 2026.8.3 binary
proved version and config-command shapes. That host had no canonical service, so real
start/stop/restart and UAC behavior were not exercised; installed-service permission and transition
smokes on Windows, Linux, and macOS remain release criteria rather than completed GA evidence.

- With no `cloudflared`, service, YAML, Wrangler, or Docker on the machine, inspection renders a
  truthful empty state and official install guidance—never a sample deployment.
- A real installed executable reports the exact resolved path and bounded local version output.
- Windows, Linux, and macOS distinguish “service absent,” “present but unreadable,” “stopped,”
  “running,” transitional, and unknown states without guessing.
- Start, stop, and restart require confirmation, reject a changed/stale observed state, target only
  the canonical service, refuse unknown/transitional states, and report completion only when the
  re-observed post-state matches.
- An unprivileged attempt reports elevation guidance; no browser/API/log/storage value ever
  contains an OS password, UAC credential, tunnel token, or credential-file content.
- No release-network request occurs until **Check latest version** is selected; failures leave the
  local inspection intact and show an unknown freshness result.
- Every install/download action leads to an official Cloudflare or `cloudflare/cloudflared` page or
  copies a reviewable command. No action installs or updates software automatically.
- **Draft ingress route** treats the path as a regex, uses an accurate example such as `^/api/.*`,
  and remains browser-only; config bytes do not change. A remote-managed draft has Cloudflare
  account authority and no local YAML destination.
- Parsed route counts include the final catch-all; any non-catch-all hostname count is labelled
  separately. Cloudflare account/cloud mutation stays unavailable, and unsafe remote-listen mode
  exposes no Tunnels API.

The full architecture, threat model, endpoint plan, GitHub milestones, test matrix, launch plan, and
search strategy are in the
[Cloudflare Tunnel integration plan](https://github.com/shreyam1008/ProtoPeek/blob/master/guides/cloudflare-tunnel-integration-plan.md).

## Primary Cloudflare references

- [Cloudflare Tunnel configuration file](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/)
- [Cloudflare Tunnel ingress rules](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/ingress/)
- [Run cloudflared as a service](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/)
- [Linux service instructions](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/linux/)
- [Windows service instructions](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/windows/)
- [macOS service instructions](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/macos/)
- [Cloudflare Tunnel downloads and updates](https://developers.cloudflare.com/tunnel/downloads/)
- [Update cloudflared](https://developers.cloudflare.com/tunnel/downloads/update-cloudflared/)
- [Official cloudflared releases](https://github.com/cloudflare/cloudflared/releases/latest)
- [Wrangler tunnel commands](https://developers.cloudflare.com/workers/wrangler/commands/tunnel/)
- [Cloudflare trademark guidelines](https://www.cloudflare.com/trademark/)

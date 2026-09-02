# Private networking inside ProtoPeek

Status: product decision and delivery plan; no private-network client integration is shipped yet.

Last ecosystem documentation check: 2026-09-02.

The portfolio boundary, six-destination information architecture, code reset, and public migration
sequence are defined in [ProtoPeek suite strategy](protopeek-suite-strategy.md). This document owns
the provider-specific mechanics and safety gates.

## Decision

Fold TailScout's useful local Tailscale workflows into ProtoPeek instead of growing TailScout into
a separate multi-provider application.

This is a product consolidation, not a source-code merge:

- ProtoPeek keeps one Go backend, one route-lazy React interface, one release pipeline, and one
  cross-platform design system.
- TailScout's command contract, tolerant fixtures, product lessons, and verified workflows move
  across; its GTK, WinUI, and SwiftUI implementations do not.
- TailScout receives maintenance fixes while ProtoPeek reaches the retirement gate below. New
  private-network product work happens in ProtoPeek.
- Tailscale with either its hosted control plane or Headscale comes first. NetBird comes only after
  the first provider is useful and the real common boundary is visible.
- Cloudflare Tunnel remains in ProtoPeek's existing Tunnels workspace. It is an exposure backend,
  not another peer-to-peer mesh provider.

This gives one maintainer a smaller system and users the same interface on Linux, Windows, and
macOS. Host-specific service discovery and permissions stay behind the local Go API.

## Product model

The ecosystem becomes understandable when it is split into layers instead of presented as a list
of competing logos.

| Layer | Products | Question ProtoPeek answers |
| --- | --- | --- |
| Private connectivity | Tailscale client, a Headscale-backed Tailscale client, later NetBird | Is this machine connected, which peers and routes are reachable, and how is traffic getting there? |
| Control-plane authority | Tailscale's hosted service, a self-hosted Headscale server, NetBird Management | Who owns identity, policy, peer registration, DNS, and route approval? |
| Service exposure | Tailscale Serve/Funnel, NetBird Expose, Cloudflare Tunnel | Who can reach this local service: only this machine, the private network, selected identities, or the public internet? |
| Protocol verification | ProtoPeek HTTP, gRPC, route, path, and listener evidence | Did the selected service actually become reachable, and what did the request/transport show? |

The primary workflow is:

```text
This PC listener
      |
      v
choose an audience: private network or public internet
      |
      v
preview the provider-specific action and start it explicitly
      |
      v
verify locally and then open the target in HTTP or gRPC
```

ProtoPeek must never compress those layers into one misleading "network healthy" indicator. A
local daemon can be running while its control plane is unreachable; a peer can be online while a
policy blocks the target port; a tunnel can be connected while its origin is failing.

## What the projects are

### Tailscale

Tailscale is a WireGuard-based private network. Its core `tailscaled` daemon, `tailscale` CLI, and
DERP relay are open source; Tailscale's hosted coordination server is proprietary. ProtoPeek should
orchestrate the installed, version-matched client rather than implement the protocol or bundle a
fork.

The first useful local surface is status, peers, direct/relayed evidence, profiles, routes, exit
nodes, connect/disconnect, targeted ping, and diagnostics. Tailscale Serve shares a local service
inside the tailnet; Funnel makes a selected service public.

### Headscale

Headscale is an independent, self-hosted implementation of the Tailscale control server for a
single tailnet, aimed primarily at self-hosters and small organisations. It uses the official
Tailscale clients. Therefore Headscale is a **control-server choice for the Tailscale adapter**, not
a second local mesh adapter.

The first Headscale feature is custom-control-server login through
`tailscale login --login-server=<URL>`, followed by the same local status and peer workflows.
Headscale currently documents broad base-network compatibility but does not list Serve or Funnel
as supported. ProtoPeek must derive exposure actions from observed capabilities, not assume them
from the client brand.

Headscale server administration is a separate, later authority. Headscale has no built-in admin
web interface, and its official documentation points to community projects. That is a real UX gap,
but filling it immediately would bring remote credentials, policy mutation, user management,
pre-auth keys, route approval, database/version compatibility, and a much larger safety boundary.

### NetBird

NetBird is a separate WireGuard-based mesh with its own agent, Management, Signal, and Relay
services. It already ships a desktop client, a management dashboard, a public management API, and
a detailed CLI. Its local status can expose useful peer, direct/relayed, ICE, route, DNS, and relay
evidence. Its `netbird expose` command can also create a temporary public service.

ProtoPeek should not clone the NetBird dashboard. Its value is to connect NetBird's local evidence
to ProtoPeek's listener, route, HTTP, and gRPC workflows. NetBird is the second adapter because
implementing it first would force an imagined generic abstraction before the Tailscale workflow is
proven.

### Cloudflare Tunnel

Cloudflare Tunnel creates outbound connections from `cloudflared` to Cloudflare and maps public or
private hostnames to origins without opening inbound ports. It is not a peer mesh. ProtoPeek's
current source already owns local Cloudflare Tunnel inspection and canonical service actions, with
config mutation and cloud-account authority still gated.

Quick Tunnels are a useful later development action because they expose localhost through a random
`trycloudflare.com` hostname without an account. They remain temporary, explicitly started, and
clearly labelled as public and non-production.

## Information architecture

Do not add a top-level page for every provider.

### Network

Add a route-lazy **Private access** section inside the existing Network area:

1. **This device** — installed client, connection state, identity, virtual addresses, control-plane
   label, version, DNS, routes, and health warnings.
2. **Peers** — searchable peer list with online state, direct/relay evidence, addresses, advertised
   routes, and provider-specific facts.
3. **Reach a service** — choose a peer/address and hand it to HTTP, gRPC, route evidence, or a
   bounded provider-native ping. Handoffs populate a draft and never send automatically.
4. **Controls** — connect/disconnect, profile switch, exit-node choice, and diagnostics only when
   the selected adapter supports them.

Tailscale and NetBird appear as separate provider cards when both are installed. Do not merge their
peers or turn two independent control planes into one combined green/red state.

### Tunnels

Keep exposure in the existing Tunnels area and add one **Publish a service** entry point:

1. choose a listener from This PC or enter one explicit loopback target;
2. choose the audience before the provider;
3. show only compatible installed providers;
4. preview the exact scope, lifecycle, and command effect;
5. start after confirmation;
6. verify the origin and public/private endpoint separately; and
7. keep an obvious Stop action visible for temporary processes.

Use these audience labels consistently:

| Audience | Initial backend | Later backends |
| --- | --- | --- |
| Private network | Tailscale Serve | Provider-managed private resources where the semantics are equally clear |
| Public internet · temporary | Cloudflare Quick Tunnel | Tailscale Funnel, NetBird Expose |
| Public internet · managed | Existing Cloudflare named-tunnel plan | Other providers only after account and rollback review |

Provider selection cannot weaken the audience silently. Moving from Tailscale Serve to Funnel is a
private-to-public change and requires a fresh confirmation.

### Protocols and This PC

The integration becomes more useful than a vendor dashboard through handoffs:

- a peer address can open as an unsent HTTP or gRPC target;
- a route or connectivity failure can open in Network evidence;
- a local listener can open in Publish a service;
- an exposure route can return to This PC for origin evidence; and
- a published endpoint can return to HTTP or gRPC for explicit verification.

## Cross-platform UI contract

ProtoPeek's shared React UI owns wording, ordering, empty states, capability presentation, and
confirmation. Windows, Linux, and macOS must not grow separate layouts.

Platform differences are factual capabilities only:

- executable discovery and service-manager evidence;
- path and permission rules;
- browser-login behaviour;
- whether the installed vendor build exposes a command; and
- clear Administrator, UAC, sudo, or macOS guidance when the operating system must elevate.

The backend never asks for an operating-system password. A missing client is a truthful empty state
with official installation links, not demo data. On 2026-09-02 the Windows development host had no
`tailscale`, `headscale`, `netbird`, or `cloudflared` executable in `PATH`; that all-absent path is
an explicit first acceptance case.

## Architecture boundary

### Start concrete

The first implementation should be `internal/tailscale`, not a broad plugin SDK. It should use the
installed CLI on all three operating systems. Do not port TailScout's Linux-only LocalAPI reader
until measurement proves the manual CLI refresh is inadequate.

Only when NetBird work starts should the real overlap be extracted into a small private-network
boundary. The likely shared shape is intentionally modest:

```go
type Snapshot struct {
    Provider     ProviderID
    ObservedAt   time.Time
    Device       Device
    Peers        []Peer
    Routes       []Route
    Capabilities Capabilities
    Warnings     []Evidence
}
```

Provider-native evidence remains attached rather than flattened away. Tailscale DERP, NetBird ICE,
and control-plane state are not interchangeable strings.

### Closed process execution

Build every endpoint from fixed operations and validated typed values:

- resolve one executable path and execute it directly, never through a shell;
- accept no raw command, executable, service name, or arbitrary argument list from the browser;
- bound stdout, stderr, duration, peer counts, string sizes, and concurrent operations;
- preserve unknown backend states without treating them as success;
- redact auth URLs, keys, tokens, headers, and diagnostic secrets before returning bytes;
- cancel subprocesses when the request or temporary exposure ends; and
- report the exact installed client version beside parsed evidence.

Reads start with the official stable machine-readable surfaces:

- Tailscale: `status --json`, `switch --list --json`, `serve status --json`, and bounded diagnostic
  commands where needed;
- NetBird later: `status --json` and its documented local daemon controls.

TailScout's shared JSON fixtures and command-contract tests should move into ProtoPeek's Go tests.
Malformed, missing, `null`, oversized, unknown-state, and version-drift fixtures are release gates.

### Mutation lifecycle

Reuse the safety model already established by Cloudflare service actions:

> Observe → Plan → Confirm → Re-observe → Execute → Verify

The browser sends the revision/state it saw. The backend refuses a stale action and never reports
success until a fresh observation matches the intended state. Private-network mutations are
disabled when ProtoPeek is exposed through an unsafe remote listen mode.

Long-running exposure commands add an owned lifecycle:

- one visible process/session record;
- bounded retained output;
- explicit Stop;
- automatic teardown on server shutdown;
- no orphan created by browser navigation; and
- audience and endpoint visible for the complete lifetime.

## Delivery roadmap

### Foundation — preserve the useful TailScout contract

- Keep cleanup checkpoint `a7a6af2` as the stable TailScout source baseline.
- Copy the canonical status/profile fixtures and behaviour assertions into ProtoPeek tests.
- Write one typed Tailscale process adapter with injectable fake execution.
- Add executable discovery and an all-absent response without running anything on page load.
- Add backend capability and bounded-output contracts before UI controls.

Exit gate: Go tests reproduce TailScout's tolerant parsing and command safety without importing its
Rust, C#, Swift, or UI code.

### Slice 1 — read-only Tailscale that is useful

- Add **Private access** under Network without another primary navigation item.
- Inspect only after the user chooses **Inspect this device**.
- Show connection state, current device, tailnet/account, virtual addresses, client/daemon version,
  health, peers, direct/relay state, routes, exit-node capability, and last observation time.
- Preserve vendor-native facts and unknown states.
- Add peer handoffs to an unsent HTTP target, unsent gRPC target, route evidence, and one bounded
  `tailscale ping` action.
- Keep manual Refresh; add no background polling.

Exit gate: on Windows, Linux, and macOS the absent, disconnected, connected, partial-JSON, and
command-failure states render the same hierarchy and never show sample peers.

### Slice 2 — safe local controls and Headscale compatibility

- Add connect, disconnect, browser login, logout, and saved-profile switching.
- Add exit-node select/clear and local advertise toggle only when supported.
- Add Network Check, Version, and Bug Report with bounded, copyable, redacted evidence.
- Add **Custom control server** as an advanced login choice using the official Tailscale client.
- Validate an explicit HTTPS URL; allow documented loopback development exceptions only behind a
  separate warning.
- Describe a custom server as Headscale only when the user selected or the client safely reports
  that fact. Otherwise say **Custom control server**.
- Hide or explain unsupported actions through capabilities; do not promise Serve/Funnel on
  Headscale.

Exit gate: every mutation is fixed-command, confirmed where scope changes, stale-guarded, and
verified by a new snapshot. The first useful private-network release is complete here.

### Slice 3 — service reachability and exposure

- Connect This PC listeners to a single Publish a service wizard.
- Ship Tailscale Serve first because its audience stays private.
- Add separate origin and tailnet endpoint verification with HTTP/gRPC handoff.
- Add Cloudflare Quick Tunnel as an explicitly public, temporary development session after the
  existing `cloudflared` lifecycle can own and stop foreground processes safely.
- Add Tailscale Funnel only with its MagicDNS, HTTPS, policy, supported-port, and public-audience
  prerequisites visible before execution.
- Continue named Cloudflare Tunnel work through the existing dedicated integration plan rather than
  duplicating it here.

Exit gate: a user can select a real listener, understand who will gain access, start one supported
exposure, verify both origin and endpoint, and stop it without an orphan process.

### Slice 4 — NetBird as the second real adapter

- Add NetBird executable discovery and read-only `status --json` parsing.
- Preserve management, signal, relay, nameserver, direct/relayed, ICE, route, and peer evidence that
  has no exact Tailscale equivalent.
- Reuse the Private access information hierarchy and protocol handoffs.
- Extract only the now-proven shared adapter/view-model surface.
- Add `up`/`down` after read-only parity and stale-state tests.
- Add temporary `netbird expose` only after the common foreground-session supervisor from Slice 3
  is proven; never accept password/PIN values until secret input and retention have a separate
  design review.

Exit gate: both installed providers can coexist without merged state, hidden vocabulary, or a
provider-specific layout fork.

### Slice 5 — retire TailScout deliberately

Do not delete or archive TailScout merely because ProtoPeek has one Tailscale screen. Retirement
requires:

- one released ProtoPeek version with Tailscale inspection and Slice 2 controls on all three
  supported operating systems;
- verified install/upgrade/rollback paths and real-host smoke tests;
- documentation that maps old TailScout actions to their ProtoPeek locations;
- a release note and repository banner that preserve TailScout history and point to ProtoPeek; and
- a deliberate Taildrop decision.

Taildrop is not the same thing as ProtoPeek Downloader. Do not create a large browser upload/staging
system merely for checkbox parity. Before retirement, either implement a bounded, secret-safe
Taildrop flow with reliable cleanup or keep a clearly documented legacy/CLI path based on actual
user demand.

### Gated — remote control-plane administration

Keep these out of the first private-network releases:

- Headscale users, nodes, pre-auth keys, route approval, policy, server upgrades, and service
  lifecycle;
- Tailscale hosted admin API operations;
- NetBird users, setup keys, groups, policies, networks, DNS, and management mutations; and
- automatic installation, updates, account creation, or credential rotation for any provider.

If this boundary is opened later, start read-only with an explicit remote server, short-lived or
least-privilege credentials, OS-backed secret storage, visible authority, version negotiation, and
an audit trail. Headscale's documented API transition and NetBird's already capable dashboard are
reasons to wait, not reasons to create a generic token box now.

## What moves from TailScout

| TailScout asset | ProtoPeek treatment |
| --- | --- |
| Shared status/profile fixtures | Move into Go parser and API-contract tests |
| CLI argument and injection tests | Recreate around the closed Go process adapter |
| Device ordering and display fallbacks | Preserve in the shared web view model |
| Connect, profile, exit-node, and diagnostics workflows | Rebuild through observe/confirm/verify endpoints |
| Linux LocalAPI fast path | Do not port initially; revisit only after measurement |
| GTK, WinUI, and SwiftUI screens | Do not port; the shared ProtoPeek UI replaces them |
| Taildrop | Separate demand and security decision before retirement |
| Native packaging and website | Keep during transition, then preserve history and redirect deliberately |

## Success criteria

The consolidation is working when:

1. A user with no provider installed immediately understands what is missing and can follow an
   official install path.
2. A Tailscale or Headscale-backed user can see this device, peers, routes, and failure evidence,
   then open one peer service in HTTP or gRPC without retyping its address.
3. Common local controls work through one consistent UI on Windows, Linux, and macOS.
4. A local listener can be shared privately or publicly only after the audience is unmistakable,
   and ProtoPeek can verify and stop what it started.
5. Adding NetBird does not fork the UI or erase its native ICE/relay evidence.
6. The default binary, startup path, and shared bundle stay within documented regression budgets;
   every new workspace remains lazy.
7. No cloud account, external database, background poller, arbitrary shell, or stored provider token
   is required for the core local workflow.

## Explicit non-goals

- A universal VPN client or replacement data plane.
- A visual clone of the Tailscale, Headscale community, NetBird, or Cloudflare admin dashboards.
- One abstract peer model that discards provider-native evidence.
- Automatic provider installation or silent privilege elevation.
- Automatic public exposure based on a detected local listener.
- Simultaneous orchestration of several mesh clients as if they were one network.
- A plugin SDK before two concrete adapters prove the need.

## Primary references

- [Tailscale open-source boundary](https://tailscale.com/opensource)
- [Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli)
- [Custom control servers and Headscale login](https://tailscale.com/docs/how-to/set-up-custom-control-server)
- [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)
- [Headscale project and design goal](https://headscale.net/stable/)
- [Headscale feature compatibility](https://headscale.net/stable/about/features/)
- [Headscale client support](https://headscale.net/stable/about/clients/)
- [Headscale community web interfaces](https://headscale.net/stable/ref/integration/web-ui/)
- [NetBird architecture](https://docs.netbird.io/about-netbird/how-netbird-works)
- [NetBird client CLI](https://docs.netbird.io/get-started/cli)
- [NetBird management API](https://docs.netbird.io/api/introduction)
- [NetBird Expose](https://docs.netbird.io/manage/reverse-proxy/expose-from-cli)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [ProtoPeek Cloudflare Tunnel integration plan](cloudflare-tunnel-integration-plan.md)

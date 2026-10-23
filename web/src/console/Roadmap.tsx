import { Beaker, CheckCircle2, Compass, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/console/shell/EmptyState';

import { PageHeader } from '@/console/shell/PageHeader';

const roadmap = [
  {
    state: 'Available in this build',
    slug: 'available',
    icon: CheckCircle2,
    items: [
      [
        'Workbench + themes',
        'Persistent destination and tool navigation, consistent page headers, paired themes, and recent bounded discoveries.',
      ],
      [
        'Local AI agents',
        '23 opt-in MCP/CLI tools for HTTP, gRPC, events, Cap’n Proto, shared packet metadata, host evidence and explicit extension checks. Native results, write controls, bounded activity and cancellation.',
      ],
      [
        'Optional extension library',
        '20 entries: six native workbenches and fourteen command, MCP, endpoint or external companions. Setup packs load only when selected; host checks are explicit. No automatic installation or vendor execution.',
      ],
      [
        'Host port scanner',
        'Custom TCP ports and ranges for one local or remote host, IPv4/IPv6, presets, cancellation, open/closed/timeout evidence, and protocol inspection handoffs.',
      ],
      [
        'WebSocket + SSE',
        'Text/binary WebSocket messages, SSE event names and IDs, headers, verified TLS, bounded live timelines, explicit connect/disconnect, and cleanup on navigation.',
      ],
      [
        'gRPC workbench',
        'Reflection and proto/protoset schemas, incremental messages in all stream modes, deadlines, metadata, headers, trailers, native status and explicit local limits.',
      ],
      [
        'Cap’n Proto RPC',
        'Source or compiled schemas, exact 64-bit values, generic bindings, typed returned capabilities and plans up to eight steps. Verified TLS, partial evidence and cancellation; optional external source compiler.',
      ],
      [
        'HTTP workbench',
        'Bounded HTTP(S), native timing/TLS/body evidence, a reviewed shell-free cURL import subset, and bounded credential-redacted cURL export.',
      ],
      [
        'Saved HTTP requests',
        'Named browser-local requests, portable library import/merge and environment templates. Secret values stay in memory; persistence/export strip them. Loading prepares an unsent editor.',
      ],
      [
        'Bounded discovery',
        'Explicit TCP, gRPC, TLS, and HTTP evidence with fixed candidate and time limits.',
      ],
      [
        'Next-hop evidence',
        'One read-only kernel route lookup per resolved address from the ProtoPeek process; no hop probes.',
      ],
      [
        'Network Path · native platforms',
        'Linux UDP, Windows ICMP and macOS ICMP backends, pinned destinations, responder RTT and saved sourced labels. Native macOS runtime and real-router acceptance remain distinct gates.',
      ],
      [
        'Authorized private discovery',
        'Explicit RFC 1918 IPv4 /24-or-smaller discovery with a previewed plan: bounded gRPC/HTTP inspection only on named application ports, TCP connect-only evidence elsewhere, hard limits, and cancellation.',
      ],
      [
        'Network map + history',
        'Logical topology and inventory, immutable A/B comparisons with ambiguous identity and not-observed states, manual notes/groups, sourced enrichment and bounded JSON/GraphML/CSV exchange.',
      ],
      [
        'Offline Nmap XML import',
        'Review bounded XML hints and exact conversion losses before creating a saved topology workspace. No invented edges; literal-IP endpoints require fresh protocol verification.',
      ],
      [
        'Installed Nmap scanner',
        'Explicit TCP connect or light service detection on one IP or a bounded private subnet, exact scope preview, cancellation, paginated results, export and protocol inspection handoff. Nmap is installed separately.',
      ],
      [
        'Packet inspection',
        'Section/transport-aware packet and conversation triage, DHCP/QUIC-like metadata, and default-off bounded TCP payload evidence with gaps/conflicts. Metadata export excludes payload; native dumpcap acceptance remains pending.',
      ],
      [
        'Tailscale client workbench',
        'Installed Tailscale status and reviewed actions, plus a separate HTTPS Headscale login-server account flow. Native sign-in stays in the installed client; no implicit account replacement or elevation.',
      ],
      [
        'NetBird client evidence',
        'Separate native JSON status for management, signal, ICE, relay, DNS and peers, with reviewed bounded connect/disconnect. Real account/platform acceptance remains required.',
      ],
      [
        'Network diagnostics',
        'Explicit DNS/resolver, TCP/TLS, IPv4/IPv6, finite sampling, TCP/UDP exchange, proxy, h2c and HTTP/3 evidence. Offline subnet planning prepares an unsent authorized-discovery draft.',
      ],
      [
        'Session activity + typed handoffs',
        'Up to 40 sanitized memory-only receipts, explicit clear and unsent endpoint resume. Original discovery provenance survives reload; success is never refreshed into new evidence.',
      ],
      [
        'Browser proto folders',
        'Review and upload a bounded relative-path .proto manifest to the running ProtoPeek instance; folder access and schema bytes are never saved in profiles.',
      ],
      [
        'gRPC Health Check + Watch',
        'Explicit canonical checks and one bounded live Watch with status transitions, headers, trailers, cancellation, and final gRPC evidence; no polling or retry.',
      ],
      [
        'Downloader',
        'HTTP(S) queues through configured, system or bundled Windows amd64 aria2c, bounded options, live progress, pause/resume, restart recovery, completed history, checksum evidence and one-shot CLI transfer.',
      ],
      [
        'Security evidence',
        'Public website HEAD/TLS evidence and JSON reports, a fixed five-path metadata plan, historical indexed names with filtering/export and unsent Inspect handoffs. No security score or automatic candidate probing.',
      ],
      [
        'GoBarryGo bridge',
        'Read-first preview, bounded copy-only preference/session import, paused imported jobs, private receipts, and guarded rollback without changing GoBarryGo source files.',
      ],
      [
        'Cloudflare canonical operations',
        'Canonical host/config inspection, validation, route matching, bounded logs/metrics/diagnostics and stale-guarded service actions. Reviewed writes require the exact writable user-owned config, validation and rollback.',
      ],
      [
        'Temporary publishing sessions',
        'Audience-first private Serve, public Quick Tunnel or Funnel; reviewed argv and prerequisites, separate origin/endpoint checks, owned foreground lifetime and Stop/expiry cleanup on Windows/Linux. All macOS modes remain unavailable; live provider acceptance stays explicit.',
      ],
      [
        'Owned package channels',
        'Homebrew on macOS/Linux and Scoop on Windows install checksum-pinned v0.6.1 archives, declare aria2 as an external dependency, and provide both protopeek and pp.',
      ],
    ],
  },
  {
    state: 'Next',
    slug: 'next',
    icon: Compass,
    items: [
      [
        'Native installed-tool acceptance',
        'Run actual macOS loopback/counter CI and native capture, account and service scenarios. Fixtures and cross-compilation do not prove installed-client or real-router behavior.',
      ],
      [
        'Broader aria2 packaging',
        'Earn reproducible per-architecture builds, source/notices and native download/install acceptance before broadening the bundled engine beyond Windows amd64.',
      ],
      [
        'WinGet package',
        'Prepare and owner-submit a schema-valid Windows package only after the owned Scoop path and installer have initial user feedback.',
      ],
      [
        'Release and provider acceptance',
        'Verify the exact pushed commit, native packages and actual provider accounts. Publishing a public release or store submission remains a separate owner action.',
      ],
    ],
  },
  {
    state: 'Exploring',
    slug: 'exploring',
    icon: Beaker,
    items: [
      [
        'Persistent capability sessions',
        'Longer-lived Cap’n Proto capabilities need separate lifetime, revocation and recovery design. Current typed plans close their connection after at most eight steps.',
      ],
      [
        'Advanced QUIC inspection',
        'Current diagnostics perform a verified HTTP/3 HEAD and packet metadata recognizes version headers. Broader request and transport analysis needs its own evidence contract.',
      ],
    ],
  },
  {
    state: 'Gated',
    slug: 'gated',
    icon: ShieldAlert,
    items: [
      [
        'Bundled Nmap execution',
        'Not planned for the core binary. Reconsider only as an opt-in companion with explicit executable choice, previewed scope, hard budgets, and an auditable command.',
      ],
      [
        'Broader/public range discovery',
        'Why: one authorized private /24 must not become ambient or Internet-wide crawling. Gate: a distinct workflow, previewed scope, harder budgets, and a defensible user need.',
      ],
      [
        'Automatic datacenter geolocation claims',
        'Why: SIN, BOM, provider-region labels, WHOIS, and IP geolocation are hints rather than measured facilities. Gate: user-supplied sources, attribution, freshness, and confidence.',
      ],
      [
        'Capture elevation and deeper decoding',
        'The installed-tool adapter uses existing permissions. Driver installation, integrated elevation, raw payload export and decryption remain separate workflows; bounded opt-in sequence evidence is available.',
      ],
      [
        'Administrator config + credentials',
        'Current writes cover a writable user-owned canonical cloudflared config. Administrator-owned files, credential rotation and cloud/account changes need explicit least-privilege design and native acceptance.',
      ],
    ],
  },
] as const;

export function Roadmap() {
  const [status, setStatus] = useState('all');

  const [query, setQuery] = useState('');

  const needle = query.trim().toLocaleLowerCase();

  const groups = roadmap.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.join(' ').toLocaleLowerCase().includes(needle)),
  }));

  const visible = groups.filter(
    (group) => (status === 'all' || group.slug === status) && group.items.length
  );

  return (
    <div className="pp-evidence-workbench pp-roadmap-page">
      <PageHeader className="pp-evidence-hero">
        <div>
          <h1>Product roadmap</h1>
          <p>
            Capabilities in this build and their acceptance gates. Earlier releases may have a
            different feature set.
          </p>
        </div>
        <input
          aria-label="Search roadmap"
          placeholder="Find a capability…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </PageHeader>
      <div className="pp-roadmap-layout">
        <nav className="pp-roadmap-filters" aria-label="Roadmap status">
          <button type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
            All capabilities{' '}
            <span>{groups.reduce((total, group) => total + group.items.length, 0)}</span>
          </button>
          {groups.map((group) => (
            <button
              type="button"
              key={group.slug}
              aria-pressed={status === group.slug}
              onClick={() => setStatus(group.slug)}
            >
              {group.state === 'Available in this build' ? 'Available' : group.state}
              <span>{group.items.length}</span>
            </button>
          ))}
        </nav>
        <section
          className="pp-roadmap-grid"
          aria-label="Roadmap capabilities"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: This bounded capability region needs keyboard scrolling (WCAG 2.1.1).
          tabIndex={0}
        >
          {visible.map((group) => (
            <section key={group.slug} className={`pp-roadmap-group is-${group.slug}`}>
              <header>
                <group.icon aria-hidden="true" />
                <h2>{group.state}</h2>
                <span>{group.items.length}</span>
              </header>
              <div>
                {group.items.map(([title, detail]) => (
                  <article key={title}>
                    <h3>{title}</h3>
                    <p>{detail}</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {!visible.length && (
            <EmptyState title="No matching capabilities">
              Try another search or choose a different status.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

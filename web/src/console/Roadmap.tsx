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
        'Six destinations, paired themes, recent tools and step-by-step guides.',
      ],
      [
        'Local AI agents',
        '25 local CLI/MCP tools with offline search, input schemas, read-only pairing, write permissions and cancellation.',
      ],
      [
        'Optional extension library',
        '24 tools, including six managed companions. Review the package before installing. Pin a tool or open its setup from the library.',
      ],
      [
        'Host port scanner',
        'Scan selected TCP ports on one IPv4 or IPv6 host. See open, refused and timed-out connections, or open a protocol draft.',
      ],
      [
        'WebSocket + SSE',
        'Connect with verified TLS, inspect WebSocket text or bytes and named SSE events, then disconnect.',
      ],
      [
        'gRPC workbench',
        'Load reflection or schema files. Inspect messages, deadlines, metadata, headers, trailers and final status across all stream modes.',
      ],
      [
        'Cap’n Proto RPC',
        'Load compiled schemas or use a source compiler. Inspect exact integers and typed capabilities, with verified TLS and plans up to eight steps.',
      ],
      [
        'HTTP workbench',
        'Bounded HTTP(S), native timing/TLS/body evidence, a reviewed shell-free cURL import subset, and bounded credential-redacted cURL export.',
      ],
      [
        'Saved HTTP requests',
        'Save named requests, merge a library or use environment templates. Secret values stay in memory. Opening a request creates a draft.',
      ],
      [
        'Bounded discovery',
        'Probe a selected endpoint with bounded TCP, TLS, gRPC and HTTP checks.',
      ],
      [
        'Next-hop evidence',
        'Read the local kernel route for each resolved address without sending hop probes.',
      ],
      [
        'Network Path · native platforms',
        'Trace a pinned destination with Linux UDP or Windows/macOS ICMP. Inspect responder round trips and save path evidence.',
      ],
      [
        'Authorized private discovery',
        'Preview discovery on an authorized private IPv4 /24 or smaller. Selected ports support HTTP/gRPC checks. Other ports use TCP connect.',
      ],
      [
        'Network map + history',
        'Arrange observed devices, annotate groups, compare saved snapshots and export JSON, GraphML or CSV.',
      ],
      [
        'Offline Nmap XML import',
        'Preview XML conversion losses before saving a map. Verify hinted protocols separately.',
      ],
      [
        'Installed Nmap scanner',
        'Review the target and ports, then use installed Nmap for TCP or light service detection. Export results or inspect one endpoint.',
      ],
      [
        'Packet inspection',
        'Inspect packet files, conversations and optional bounded TCP payloads, including gaps and conflicts. Metadata exports exclude payload.',
      ],
      [
        'Tailscale client workbench',
        'Inspect the installed client and peers. Review changes and use Tailscale or HTTPS Headscale sign-in in the native client.',
      ],
      [
        'NetBird client evidence',
        'Inspect peers, relay, DNS, ICE and management status. Review connection changes before applying.',
      ],
      [
        'Network diagnostics',
        'Check DNS, TCP/TLS, IPv4/IPv6, proxies, h2c, HTTP/3 and raw TCP/UDP. Plan subnets offline.',
      ],
      [
        'Session activity + typed handoffs',
        'Review up to 40 sanitized receipts in memory. Reopen an endpoint as a draft with its original provenance.',
      ],
      [
        'Browser proto folders',
        'Review relative paths before uploading schemas. Folder access and schema bytes stay out of saved profiles.',
      ],
      [
        'gRPC Health Check + Watch',
        'Run a canonical health check or watch status changes with headers, trailers, cancellation and final status.',
      ],
      [
        'Local transfer',
        'Send over an existing LAN or VPN route with TLS 1.3, receiver approval and SHA-256 receipts.',
      ],
      [
        'Downloader',
        'Queue files with aria2, pause and resume downloads, verify checksums, or transfer from the CLI. Save media with optional engines.',
      ],
      [
        'Security evidence',
        'Inspect website HEAD/TLS, five metadata paths and indexed names. Export a report or open a draft for one target.',
      ],
      [
        'GoBarryGo bridge',
        'Preview settings and paused jobs before importing a copy. Review the receipt to roll back.',
      ],
      [
        'Cloudflare canonical operations',
        'Inspect connector provenance, routes, logs and metrics. Config changes require a verified user-owned file and a reviewed plan.',
      ],
      [
        'Temporary publishing sessions',
        'Review audience and origin before starting Serve, Quick Tunnel or Funnel on Windows/Linux. Verify the endpoint and stop the owned session.',
      ],
      [
        'Owned package channels',
        'Homebrew and Scoop install checksum-pinned stable archives, declare aria2 as a dependency and provide both CLI names.',
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
        'Native CI checks macOS loopback and counters. Real routers, capture drivers, signed-in providers and services need separate acceptance.',
      ],
      [
        'Broader aria2 packaging',
        'Verify per-architecture builds, notices, sources and native transfers before embedding more engines.',
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

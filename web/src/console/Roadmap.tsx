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
        'Opt-in local MCP and CLI connection, 11 bounded tools, visible activity and cancellation. No bundled AI model.',
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

        'Reflection, proto/protoset schemas, all stream modes, deadlines, headers, messages, trailers, and status.',
      ],

      [
        'Cap’n Proto RPC',

        'Source or compiled schemas, concrete bootstrap methods, exact 64-bit JSON values, verified TLS, deadlines, cancellation and response export. Source compilation uses an optional installed compiler.',
      ],

      [
        'HTTP workbench',

        'Bounded HTTP(S), verified TLS, explicit redirects, peer, timing, headers, response bodies, and bounded credential-redacted cURL export.',
      ],

      [
        'Saved HTTP requests',

        'Named browser-local requests with explicit body opt-in, update/delete/export, bounded storage, credential removal and global fuzzy search. Loading prepares an unsent editor.',
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
        'Network Path · Linux + Windows',

        'Native Linux UDP and Windows IPv4/IPv6 ICMP probes, pinned destinations, per-responder RTT, saved traces and optional dated ASN/ISP/location labels.',
      ],

      [
        'Authorized private discovery',

        'Explicit RFC 1918 IPv4 /24-or-smaller discovery with a previewed plan: bounded gRPC/HTTP inspection only on named application ports, TCP connect-only evidence elsewhere, hard limits, and cancellation.',
      ],

      [
        'Network map + history',

        'Responsive topology and accessible inventory views, manual subnet/site/VLAN/region groups, immutable snapshots, tags and notes, bounded browser persistence, and JSON/GraphML/CSV exchange.',
      ],

      [
        'Offline Nmap XML import',

        'Bounded hints from an existing nmap -oX file. Nmap is not required for import; literal-IP endpoints are verified before opening a workbench.',
      ],

      [
        'Installed Nmap scanner',

        'Explicit TCP connect or light service detection on one IP or a bounded private subnet, exact scope preview, cancellation, paginated results, export and protocol inspection handoff. Nmap is installed separately.',
      ],

      [
        'Packet inspection',

        'Bounded PCAP/PCAPNG metadata, paginated packet details, filters and JSON export. An installed dumpcap adapter supports explicit timed IP/port capture; native capture platform acceptance is still pending.',
      ],

      [
        'Tailscale client workbench',

        'Installed-client peers, accounts, exit-node controls, bounded diagnostics and Taildrop, with explicit reviewed operations. Integrated sign-in, elevation, Headscale administration and NetBird remain open work.',
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
        'Cloudflare Tunnels · local foundation',

        'Manual, read-only discovery of cloudflared, its canonical OS service, documented config candidates, config authority, ingress routes, and Docker and Wrangler availability, plus safe in-view route drafts.',
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
        'Incremental response-lab streams',

        'Render each general server-stream message immediately with bounded retention while keeping headers, trailers, cancellation, and final status distinct.',
      ],

      [
        'HTTP environment profiles + library import',

        'Environment variables and portable library restoration beyond the current named request save/load/export workflow.',
      ],

      [
        'cURL import',

        'Parse a deliberately bounded cURL subset without silently accepting unsafe shell behavior; export is available now.',
      ],

      [
        'Target DNS + TLS preflight',

        'Explain resolution, SNI, ALPN, certificate verification, and handshake timing before an RPC or HTTP request.',
      ],

      [
        'Darwin path backend',

        'Earn native unprivileged implementations with equivalent cancellation and evidence semantics; no localized subprocess parsing or elevation prompts.',
      ],

      [
        'Snapshot diff + sourced enrichment',

        'Compare immutable observations over time. Current traces already retain optional sourced ASN/ISP/location labels; IP location does not establish a datacenter.',
      ],

      [
        'WinGet package',

        'Prepare and owner-submit a schema-valid Windows package only after the owned Scoop path and installer have initial user feedback.',
      ],

      [
        'Tunnel validation + runtime evidence',

        'Add authoritative cloudflared validation, route matching, bounded logs, metrics, and diagnostics without ambient polling or credential reads.',
      ],
    ],
  },

  {
    state: 'Exploring',

    slug: 'exploring',

    icon: Beaker,

    items: [
      [
        'Nmap XML to topology',

        'Map bounded existing XML hints into a saved workspace with import provenance and explicit loss notices, without executing Nmap.',
      ],

      [
        'Cap’n Proto capability workflows',

        'Follow returned capabilities, generic bindings and pipelined calls beyond the current concrete bootstrap method client.',
      ],

      [
        'QUIC + HTTP/3',

        'Negotiation and transport evidence once a compact, reliable cross-platform path is proven.',
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

        'The installed-tool adapter uses existing permissions. Driver installation, integrated elevation, stream reassembly, raw payload export and decryption need separate workflows.',
      ],

      [
        'Tunnel configuration writes',

        'Guarded canonical-service control is available. Configuration writes and credential changes still need: deliberate elevation, least-privilege helpers, atomic writes, validation, rollback, and auditable receipts.',
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
          <p>What works now, what comes next, and what needs further work.</p>
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
        <div className="pp-roadmap-grid">
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
        </div>
      </div>
    </div>
  );
}

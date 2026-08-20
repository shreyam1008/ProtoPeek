import { Beaker, CheckCircle2, Compass, ShieldAlert } from 'lucide-react';

const roadmap = [
  {
    state: 'Available in this build',
    slug: 'available',
    icon: CheckCircle2,
    items: [
      ['Dashboard + themes', 'Local dashboard, light/dark preference, recent bounded discoveries.'],
      [
        'gRPC workbench',
        'Reflection, proto/protoset schemas, all stream modes, deadlines, headers, messages, trailers, and status.',
      ],
      [
        'HTTP workbench',
        'Bounded HTTP(S), verified TLS, explicit redirects, peer, timing, headers, response bodies, and bounded credential-redacted cURL export.',
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
        'Offline Nmap XML import',
        'Bounded hints from an existing nmap -oX file. Nmap is not required for import; literal-IP endpoints are verified before opening a workbench.',
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
        'Owned package channels',
        'Homebrew on macOS/Linux and Scoop on Windows install the same checksum-pinned v0.3.1 archives with both protopeek and pp.',
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
        'Saved HTTP requests + profiles',
        'Reusable local request recipes and environment values with secret-safe persistence.',
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
        'WinGet package',
        'Prepare and owner-submit a schema-valid Windows package only after the owned Scoop path and installer have initial user feedback.',
      ],
    ],
  },
  {
    state: 'Exploring',
    slug: 'exploring',
    icon: Beaker,
    items: [
      [
        'WebSocket + SSE',
        'Protocol-native event timelines, cancellation, and bounded payload retention.',
      ],
      [
        'Bounded PCAP import',
        'Offline evidence with an explicit Wireshark/TShark handoff; no hidden capture.',
      ],
      [
        "Cap'n Proto",
        'A schema/capability inspector only if native evidence and dependency size earn a surface.',
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
        'Traceroute / hop probes',
        'Why: probe packets are not kernel route evidence and can require platform privileges. Gate: consent, strict budgets, truthful partial failure, and reliable unprivileged backends.',
      ],
      [
        'LAN range expansion',
        'Why: one target must not become ambient network crawling. Gate: previewed private scope, opt-in, hard candidate/time limits, and cancellation.',
      ],
      [
        'Live capture',
        'Why: capture can require privilege and expose payload secrets. Gate: explicit lifecycle, redaction/export policy, and dependable cross-platform teardown.',
      ],
    ],
  },
] as const;

export function Roadmap() {
  return (
    <div className="pp-evidence-workbench pp-roadmap-page">
      <header className="pp-evidence-hero">
        <div>
          <span className="pp-kicker">Capability contract</span>
          <h1>Product roadmap</h1>
          <p>What works now, what closes daily workflow gaps next, and what needs a safety gate.</p>
        </div>
      </header>
      <div className="pp-roadmap-grid">
        {roadmap.map((group) => (
          <section key={group.state} className={`pp-roadmap-group is-${group.slug}`}>
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
      </div>
    </div>
  );
}

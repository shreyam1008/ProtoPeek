import {
  ArrowRight,
  Braces,
  Cable,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  Globe2,
  HeartPulse,
  Layers3,
  Menu,
  Network,
  Radio,
  Route,
  SearchCode,
  Server,
  ShieldCheck,
  SquareArrowOutUpRight,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { useRef, useState } from 'react';

export function App() {
  return (
    <div className="min-h-screen bg-pp-bg">
      <Nav />

      <main className="mx-auto max-w-5xl space-y-16 px-6 pb-20">
        <Hero />
        <ProtocolModel />
        <Features />
        <Roadmap />
        <Install />
        <Footer />
      </main>
    </div>
  );
}

function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement | null>(null);
  const links = [
    { href: '#protocol-model', label: 'Protocol model' },
    { href: '#features', label: 'Features' },
    { href: '#roadmap', label: 'Roadmap' },
    { href: '#install', label: 'Install' },
  ];

  function closeMobileNavigation() {
    setMobileOpen(false);
  }

  return (
    <nav
      className="sticky top-0 z-50 border-b border-pp-border bg-white/95 backdrop-blur-lg"
      aria-label="Primary"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !mobileOpen) return;
        event.preventDefault();
        closeMobileNavigation();
        mobileToggleRef.current?.focus();
      }}
    >
      <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-pp-brand text-[#07151b]">
            <svg viewBox="0 0 32 32" className="size-6" aria-hidden="true">
              <path
                d="M3.5 17h4l2.2-9 4.1 17 4.4-19 3.1 12H28.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="28.5" cy="18" r="1.6" fill="currentColor" />
            </svg>
          </span>
          <span className="truncate text-sm font-bold tracking-tight text-pp-ink">ProtoPeek</span>
        </div>
        <div className="hidden items-center gap-4 sm:flex">
          {links.map((link) => (
            <a
              key={link.href}
              className="text-sm text-pp-muted transition hover:text-pp-ink"
              href={link.href}
            >
              {link.label}
            </a>
          ))}
          <a
            className="pp-button-primary py-1.5 text-xs"
            href="https://github.com/shreyam1008/ProtoPeek"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
            <SquareArrowOutUpRight className="size-3" />
          </a>
        </div>
        <button
          ref={mobileToggleRef}
          type="button"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-pp-border bg-white text-pp-ink shadow-sm transition hover:border-pp-brand sm:hidden"
          aria-label={`${mobileOpen ? 'Close' : 'Open'} site navigation`}
          aria-controls="mobile-site-navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? (
            <X className="size-5" aria-hidden="true" />
          ) : (
            <Menu className="size-5" aria-hidden="true" />
          )}
        </button>
      </div>
      <div
        id="mobile-site-navigation"
        className="absolute inset-x-0 top-full border-b border-pp-border bg-white px-4 py-3 shadow-lg sm:hidden"
        hidden={!mobileOpen}
      >
        <div className="mx-auto grid max-w-5xl gap-1">
          {links.map((link) => (
            <a
              key={link.href}
              className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-pp-muted transition hover:bg-pp-bg-strong hover:text-pp-ink"
              href={link.href}
              onClick={closeMobileNavigation}
            >
              {link.label}
            </a>
          ))}
          <a
            className="mt-1 flex min-h-11 items-center justify-between rounded-lg bg-pp-brand px-3 text-sm font-semibold text-white"
            href="https://github.com/shreyam1008/ProtoPeek"
            target="_blank"
            rel="noreferrer"
            onClick={closeMobileNavigation}
          >
            GitHub
            <SquareArrowOutUpRight className="size-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="pt-16 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-pp-border bg-white px-4 py-1.5 text-xs font-medium text-pp-muted shadow-sm">
        <Zap className="size-3.5 text-pp-brand" />
        v0.4.0 stable &middot; local-first
      </div>

      <h1 className="mt-6 text-4xl font-bold tracking-tight text-pp-ink md:text-5xl lg:text-6xl">
        See the request.
        <br />
        <span className="text-pp-brand">Understand the server.</span>
      </h1>

      <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-pp-muted">
        ProtoPeek is a local, single-binary protocol and network workbench for the request-to-server
        path. gRPC keeps schemas, streaming, metadata, trailers, and status visible; HTTP keeps
        methods, URLs, redirects, bodies, and phase timing visible. Separate DNS, kernel-route,
        consented hop, and selected private-service evidence add context without silent polling,
        ambient scanning, bundled network executables, or invented physical links.
      </p>

      <div className="mt-8 flex items-center justify-center gap-3">
        <a className="pp-button-primary" href="#install">
          <Download className="size-4" />
          Install
        </a>
        <a
          className="pp-button-secondary"
          href="https://github.com/shreyam1008/ProtoPeek"
          target="_blank"
          rel="noreferrer"
        >
          View source
          <ArrowRight className="size-4" />
        </a>
      </div>

      <div className="mx-auto mt-12 max-w-4xl">
        <figure className="overflow-hidden rounded-2xl border border-neutral-800 bg-[#0d1117] shadow-2xl">
          <img
            src="/assets/protopeek-dashboard.png"
            alt="ProtoPeek Protocol Peek dashboard with gRPC, HTTP, scan, next-hop, and roadmap surfaces"
            className="block w-full"
            width="1600"
            height="1000"
          />
          <figcaption className="border-t border-white/10 px-4 py-3 text-left text-xs leading-relaxed text-neutral-400">
            Real local capture: the light-first dashboard opens with no target and keeps gRPC, HTTP,
            bounded scan, kernel next-hop evidence, and the roadmap one action away.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function ProtocolModel() {
  const steps = [
    {
      num: '01',
      title: 'Define the contract',
      text: 'A .proto file declares services, methods, and messages with typed fields and field numbers. This schema is the source of truth for both client and server.',
      icon: FileCode2,
    },
    {
      num: '02',
      title: 'Discover via reflection',
      text: 'If the server has reflection enabled, ProtoPeek auto-discovers every service and method at runtime. No manual config needed.',
      icon: Radio,
    },
    {
      num: '03',
      title: 'Communicate over HTTP/2',
      text: 'gRPC uses HTTP/2 for multiplexed streams, binary framing, and flow control. Headers and trailers carry metadata the body alone cannot express.',
      icon: Cable,
    },
    {
      num: '04',
      title: 'Read status + trailers',
      text: 'The final gRPC status arrives in HTTP/2 trailers, after the payload frames. ProtoPeek keeps headers, trailers, and latency visible together.',
      icon: Server,
    },
  ];

  const shapes = [
    {
      title: 'Unary',
      desc: '1 req → 1 res',
      detail: 'Simple request-response, still with full gRPC metadata.',
    },
    {
      title: 'Server stream',
      desc: '1 req → N res',
      detail: 'Server pushes multiple responses to a single request.',
    },
    {
      title: 'Client stream',
      desc: 'N req → 1 res',
      detail: 'Client sends a stream, server responds once.',
    },
    {
      title: 'Bidi stream',
      desc: 'N ↔ N',
      detail: 'Both sides send and receive over the same connection.',
    },
  ];

  return (
    <section id="protocol-model">
      <SectionHeader
        label="Protocol model"
        title="One shell. Native protocol detail."
        subtitle="ProtoPeek keeps discovery, request editing, response evidence, and local history consistent while each adapter preserves the concepts that make its protocol different."
      />

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          {
            icon: Network,
            label: 'Stable · v0.3.0',
            title: 'gRPC',
            detail:
              'Reflection, browser-folder/.proto/protoset loading, unary and streaming calls, canonical Health Check/Watch, metadata, headers, trailers, status, callback-observed handler timing, and bounded Unary Repeat.',
            tone: 'border-pp-brand/40 bg-pp-brand/5',
          },
          {
            icon: Globe2,
            label: 'Stable · v0.3.0',
            title: 'HTTP / REST',
            detail:
              'Bounded HTTP(S), params, headers, live auth, body, cancellation, redirect choice, status, protocol, TLS context, and phase timing.',
            tone: 'border-pp-brand/40 bg-pp-brand/5',
          },
          {
            icon: Network,
            label: 'Shipped · v0.3.0',
            title: 'Next-hop evidence',
            detail:
              'One kernel route per resolved address from the local ProtoPeek process with source, interface, gateway or on-link state, prefix, and available metric/table evidence. No hop probes.',
            tone: 'border-pp-brand/40 bg-pp-brand/5',
          },
          {
            icon: Route,
            label: 'Shipped · v0.4.0 · Linux',
            title: 'Network Path',
            detail:
              'Built-in unprivileged UDP hop observations with one pinned destination, DNS and kernel-route context, silent hops, and per-responder source RTT. Destination median uses only exact pinned-address replies; none is link latency.',
            tone: 'border-pp-brand/40 bg-pp-brand/5',
          },
          {
            icon: Layers3,
            label: 'Shipped · v0.4.0',
            title: 'Local network + topology',
            detail:
              'Previewed RFC 1918 IPv4 /24-or-smaller profiles declare application-probe ports separately from TCP-connect-only ports. Saved manual context survives later observations; unsaved map edits are guarded.',
            tone: 'border-pp-brand/40 bg-pp-brand/5',
          },
          {
            icon: SearchCode,
            label: 'Shipped · v0.3.0 · offline',
            title: 'Nmap XML import',
            detail:
              'Bounded nmap -oX host and port hints. ProtoPeek never runs Nmap and requires its own bounded verification before a protocol workbench opens.',
            tone: 'border-pp-brand/40 bg-pp-brand/5',
          },
          {
            icon: Braces,
            label: 'Exploring',
            title: "Cap'n Proto",
            detail:
              'Schema-file and capability bootstrap with a native inspector, after fixture, dependency-size, and failure-model gates.',
            tone: 'border-pp-border bg-white',
          },
        ].map((protocol) => (
          <div key={protocol.title} className={`rounded-xl border p-5 shadow-sm ${protocol.tone}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-pp-brand/10 text-pp-brand">
                <protocol.icon className="size-5" />
              </div>
              <span className="pp-badge">{protocol.label}</span>
            </div>
            <h3 className="mt-4 text-base font-semibold text-pp-ink">{protocol.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-pp-muted">{protocol.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-pp-border bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-center gap-2 text-center text-xs font-semibold text-pp-ink md:gap-3">
          <span className="rounded-lg bg-pp-bg-strong px-3 py-2">Target</span>
          <ChevronRight className="size-4 text-pp-muted" />
          <span className="rounded-lg bg-pp-brand/10 px-3 py-2 text-pp-brand">Adapter</span>
          <ChevronRight className="size-4 text-pp-muted" />
          <span className="rounded-lg bg-pp-bg-strong px-3 py-2">Request editor</span>
          <ChevronRight className="size-4 text-pp-muted" />
          <span className="rounded-lg bg-pp-bg-strong px-3 py-2">Native inspector</span>
        </div>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-relaxed text-pp-muted">
          The shared path stays small and local. The adapter owns discovery, validation, invocation,
          cancellation, and transport events; the inspector owns the vocabulary.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {steps.map((s) => (
          <div key={s.num} className="pp-panel flex gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-pp-brand/10 text-pp-brand">
              <s.icon className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-pp-brand">{s.num}</span>
                <h3 className="text-sm font-semibold text-pp-ink">{s.title}</h3>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-pp-muted">{s.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <h3 className="text-center text-sm font-semibold text-pp-ink">
          What the gRPC adapter shows today
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shapes.map((s) => (
            <div
              key={s.title}
              className="rounded-xl border border-pp-border bg-white p-4 text-center shadow-sm"
            >
              <div className="text-base font-semibold text-pp-ink">{s.title}</div>
              <div className="mt-1 font-mono text-xs text-pp-brand">{s.desc}</div>
              <p className="mt-2 text-xs leading-relaxed text-pp-muted">{s.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      icon: SearchCode,
      title: 'Bounded protocol discovery',
      desc: 'Check fixed loopback candidates, opt into a literal private IP, or enter one public target. See verified gRPC, safe HTTP HEAD, or open TCP evidence honestly.',
    },
    {
      icon: Layers3,
      title: 'Browse proto schemas',
      desc: 'Explore files, messages, enums, fields, and dependencies in a clean tree view before sending any request.',
    },
    {
      icon: Terminal,
      title: 'Compose & invoke',
      desc: 'Pick a method, fill in the request JSON with auto-generated templates, add metadata, hit invoke. See the full response with headers and trailers.',
    },
    {
      icon: Zap,
      title: 'Repeat unary checks safely',
      desc: 'Run 2–50 real RPCs strictly in sequence with explicit deadlines, cancellation, a 60-second cap, partial evidence, separate failure classes, and honest handler-vs-console timing. Calls may mutate service data.',
    },
    {
      icon: HeartPulse,
      title: 'Observe canonical gRPC Health',
      desc: 'Run an explicit Check or one bounded Watch stream. Keep serving status, live transitions, headers, trailers, cancellation, and final gRPC status distinct—without background polling or retry.',
    },
    {
      icon: Globe2,
      title: 'Send real HTTP requests',
      desc: 'Choose method, URL, params, headers, auth, body, timeout, and redirects; cancel in flight and inspect status, body, TLS, redirect, and timing evidence.',
    },
    {
      icon: Cable,
      title: 'Protocol-native evidence',
      desc: 'See the raw gRPC story: status codes, HTTP/2 metadata, trailers, stream mode, and timing — not just the payload.',
    },
    {
      icon: Network,
      title: 'Read the selected next hop',
      desc: 'See process-perspective source, interface, gateway or on-link state, prefix, and known metric/table values without traceroute or probe packets.',
    },
    {
      icon: Route,
      title: 'Trace a bounded Linux path',
      desc: 'Resolve once, pin one address, authorize a fixed UDP plan, and keep per-responder source RTT and ECMP evidence. Destination median exists only for exact pinned-address replies—never the last router or per-link latency.',
    },
    {
      icon: Layers3,
      title: 'Inventory an authorized private scope',
      desc: 'Application ports are exact: Quick 80/443/50051/8080; gRPC 443/6565/7000/7443/9090/50051; Web 80/443/3000/4000/5000/8000/8080/8443; Expanded 80/443/3000/8000/8080/8443/9090/50051. They may receive bounded reflection + non-following HEAD /; Expanded 22/53/445/631/1883/3306/3389/5432/6379/9100 are TCP-connect-only. A 64 KiB verbose budget retains every open-port record; shown milliseconds are full probe duration, not latency.',
    },
    {
      icon: Network,
      title: 'Keep a logical evidence map',
      desc: 'Save immutable snapshots while preserving manual labels, tags, notes, pinned positions, groups, services, and relationships across later observations. Dirty edits require an explicit save or discard.',
    },
    {
      icon: SearchCode,
      title: 'Import, then verify Nmap hints',
      desc: 'Parse bounded offline XML, preserve table/probed confidence, and require a fresh ProtoPeek scan before opening gRPC or HTTP.',
    },
    {
      icon: ShieldCheck,
      title: 'Secret-safe local shell',
      desc: 'Keep request work local with target-scoped replay, re-entry for redacted metadata, bounded inactive imports, and explicit recovery that never silently replaces malformed browser data.',
    },
  ];

  return (
    <section id="features">
      <SectionHeader
        label="Protocol + network workbench"
        title="A small console that keeps evidence honest"
        subtitle="The gRPC and HTTP workbenches stay protocol-native. Network Path, selected private discovery, and topology add bounded context while keeping passive, active, inferred, imported, and manual evidence visibly distinct."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="pp-panel">
            <div className="flex size-9 items-center justify-center rounded-lg bg-pp-brand/10 text-pp-brand">
              <f.icon className="size-4.5" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-pp-ink">{f.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-pp-muted">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Roadmap() {
  const phases = [
    {
      phase: '01',
      status: 'Shipped · v0.4.0',
      title: 'Protocol workbenches + bounded evidence',
      detail:
        'Dashboard, themes, stable gRPC and HTTP workbenches, bounded cURL export with credential redaction, browser proto-folder snapshots, canonical Health Check/Watch, bounded sequential Unary Repeat, TCP/gRPC/TLS/HTTP discovery, read-only kernel next-hop evidence, offline Nmap XML import, and owned Homebrew/Scoop channels.',
      icon: ShieldCheck,
    },
    {
      phase: '02',
      status: 'Shipped · v0.4.0',
      title: 'Bounded network evidence',
      detail:
        'Linux-native unprivileged UDP path observations; authorized RFC 1918 IPv4 /24-or-smaller profiles with explicit application versus TCP-connect-only ports; a 64 KiB verbose-detail budget that retains open-port records; full probe duration rather than latency; manual-field-preserving snapshots and unsaved-edit guards.',
      icon: Route,
    },
    {
      phase: '03',
      status: 'Soon',
      title: 'Close daily workflow gaps',
      detail:
        'Incremental general gRPC stream delivery, saved HTTP requests and profiles, bounded cURL import, target DNS/TLS preflight, verified Darwin/Windows path backends, sourced region annotations, snapshot diff, and WinGet only after initial package feedback.',
      icon: Globe2,
    },
    {
      phase: '04',
      status: 'Later',
      title: 'Research native evidence fit',
      detail:
        "Optional Nmap XML-to-topology mapping, WebSocket/SSE, bounded PCAP import with Wireshark/TShark handoff, Cap'n Proto, and QUIC/HTTP3 must prove native UX, provenance, and dependency cost.",
      icon: Braces,
    },
    {
      phase: '05',
      status: 'Boundary',
      title: 'Wider network operations',
      detail:
        'Bundled Nmap execution is not planned for the core binary. Public or broader range expansion and live capture remain outside the current flow; active probes never auto-install tools or request elevation.',
      icon: Layers3,
    },
  ];

  return (
    <section id="roadmap">
      <SectionHeader
        label="Shipped · Now · Soon · Later"
        title="Protocol breadth, without generic-client drift"
        subtitle="Every capability earns native evidence, tests, and a safety boundary. Source RTT never means link latency, logical topology never means physical cabling, and XML import never means Nmap execution."
      />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {phases.map((item) => (
          <div key={item.phase} className="pp-panel flex gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-pp-brand/10 text-pp-brand">
              <item.icon className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-pp-brand">{item.phase}</span>
                <span className="pp-badge">{item.status}</span>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-pp-ink">{item.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-pp-muted">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Install() {
  const [copied, setCopied] = useState<string | null>(null);

  const options = [
    {
      label: 'Homebrew',
      cmd: 'brew install shreyam1008/tap/protopeek',
    },
    {
      label: 'Scoop',
      cmd: 'scoop bucket add shreyam https://github.com/shreyam1008/scoop-bucket; scoop install shreyam/protopeek',
    },
    {
      label: 'curl',
      cmd: 'curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh',
    },
    {
      label: 'wget',
      cmd: 'wget -qO- https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh',
    },
    {
      label: 'PowerShell',
      cmd: 'irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex',
    },
    {
      label: 'go install',
      cmd: 'go install github.com/shreyam1008/ProtoPeek/cmd/protopeek@latest github.com/shreyam1008/ProtoPeek/cmd/pp@latest',
    },
  ];

  const copy = (cmd: string) => {
    void navigator.clipboard.writeText(cmd);
    setCopied(cmd);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section id="install">
      <SectionHeader
        label="Install · stable v0.4.0"
        title="Start the local workbench"
        subtitle="The verified release installer and owned Homebrew/Scoop channels resolve v0.4.0 from independently tested checksum-pinned public archives."
      />

      <div className="mt-8 space-y-3">
        {options.map((o) => (
          <div
            key={o.label}
            className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-[#0d1117] px-4 py-3"
          >
            <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-neutral-400">
              {o.label}
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-emerald-400">
              {o.cmd}
            </code>
            <button
              type="button"
              className="shrink-0 rounded-md p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-white"
              onClick={() => copy(o.cmd)}
              aria-label={`Copy ${o.label} command`}
              title="Copy"
            >
              {copied === o.cmd ? (
                <span className="text-xs text-emerald-400">Copied</span>
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 text-center">
        <p className="text-sm text-pp-muted">
          With stable v0.4.0, run{' '}
          <code className="rounded bg-pp-bg-strong px-1.5 py-0.5 text-xs font-semibold text-pp-ink">
            pp
          </code>{' '}
          or pass an exact{' '}
          <code className="rounded bg-pp-bg-strong px-1.5 py-0.5 text-xs font-semibold text-pp-ink">
            host:port
          </code>{' '}
          for direct gRPC mode. Entering a bare host such as{' '}
          <code className="rounded bg-pp-bg-strong px-1.5 py-0.5 text-xs font-semibold text-pp-ink">
            pp localhost
          </code>{' '}
          opens the visible bounded target scan.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-pp-border pt-8 text-center">
      <div className="text-sm font-semibold text-pp-ink">ProtoPeek</div>
      <p className="mt-2 text-sm text-pp-muted">
        A local-first protocol peek by{' '}
        <a
          href="https://shreyam1008.com.np/"
          className="text-pp-brand hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Shreyam Adhikari
        </a>
      </p>
      <div className="mt-4 flex items-center justify-center gap-4">
        <a
          className="text-sm text-pp-muted transition hover:text-pp-ink"
          href="https://github.com/shreyam1008/ProtoPeek"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
          <SquareArrowOutUpRight className="ml-1 inline size-3" />
        </a>
        <a
          className="text-sm text-pp-muted transition hover:text-pp-ink"
          href="https://protopeek.shreyam1008.com.np/docs/"
        >
          Docs
          <ChevronRight className="ml-0.5 inline size-3" />
        </a>
      </div>
    </footer>
  );
}

function SectionHeader({
  label,
  title,
  subtitle,
}: {
  label: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="text-center">
      <div className="pp-label">{label}</div>
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-pp-ink md:text-3xl">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-pp-muted">{subtitle}</p>
    </div>
  );
}

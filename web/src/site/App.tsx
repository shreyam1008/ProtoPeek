import {
  ArrowRight,
  Cable,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  FlaskConical,
  Layers3,
  Radio,
  SearchCode,
  Server,
  SquareArrowOutUpRight,
  Terminal,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

export function App() {
  return (
    <div className="min-h-screen bg-pp-bg">
      <Nav />

      <main className="mx-auto max-w-5xl space-y-16 px-6 pb-20">
        <Hero />
        <HowGrpcWorks />
        <Features />
        <Install />
        <Footer />
      </main>
    </div>
  );
}

function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-pp-border bg-white/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-5 text-pp-brand" />
          <span className="text-sm font-bold tracking-tight text-pp-ink">ProtoPeek</span>
        </div>
        <div className="flex items-center gap-4">
          <a className="text-sm text-pp-muted transition hover:text-pp-ink" href="#how-grpc-works">
            How gRPC works
          </a>
          <a className="text-sm text-pp-muted transition hover:text-pp-ink" href="#features">
            Features
          </a>
          <a className="text-sm text-pp-muted transition hover:text-pp-ink" href="#install">
            Install
          </a>
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
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="pt-16 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-pp-border bg-white px-4 py-1.5 text-xs font-medium text-pp-muted shadow-sm">
        <Zap className="size-3.5 text-pp-brand" />
        Lightweight gRPC console &mdash; zero external dependencies
      </div>

      <h1 className="mt-6 text-4xl font-bold tracking-tight text-pp-ink md:text-5xl lg:text-6xl">
        See your protos.
        <br />
        <span className="text-pp-brand">Test your services.</span>
      </h1>

      <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-pp-muted">
        ProtoPeek is a fast, single-binary gRPC workbench. Auto-discover services via reflection,
        browse proto schemas, invoke methods, run simulations, and inspect transport details &mdash;
        all from a clean web UI that takes almost no RAM.
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

      <div className="mx-auto mt-12 max-w-3xl">
        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-[#0d1117] shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-red-500/80" />
            <span className="size-2.5 rounded-full bg-yellow-500/80" />
            <span className="size-2.5 rounded-full bg-green-500/80" />
            <span className="ml-3 text-xs text-neutral-500">terminal</span>
          </div>
          <div className="px-5 py-4 font-mono text-sm leading-7 text-emerald-400">
            <div>
              <span className="text-neutral-500">$</span> curl -fsSL
              https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh
            </div>
            <div className="text-neutral-500">Installed protopeek and pp to /usr/local/bin</div>
            <div className="mt-2">
              <span className="text-neutral-500">$</span> pp -plaintext localhost:50051
            </div>
            <div className="text-sky-400">
              ProtoPeek available at http://127.0.0.1:8080/ (target: localhost:50051)
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowGrpcWorks() {
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
    <section id="how-grpc-works">
      <SectionHeader
        label="How gRPC works"
        title="A 60-second protocol primer"
        subtitle="gRPC is not just JSON-over-HTTP with a different content type. Here's what makes it different."
      />

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
        <h3 className="text-center text-sm font-semibold text-pp-ink">The four RPC shapes</h3>
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
      title: 'Auto-discover services',
      desc: 'Scan for gRPC servers on your network. Auto-detect via reflection or load .proto files and protosets manually.',
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
      icon: FlaskConical,
      title: 'Simulate & assert',
      desc: 'Run N concurrent requests, measure p50/p95/p99 latency, and set pass/fail assertions on status, headers, or body.',
    },
    {
      icon: Cable,
      title: 'Transport lens',
      desc: 'See the raw transport story: gRPC status codes, HTTP/2 metadata, trailers, and timing — not just the payload.',
    },
    {
      icon: Server,
      title: 'Workspace targets',
      desc: 'Register multiple gRPC targets with different TLS/auth configs. Switch between them without restarting.',
    },
  ];

  return (
    <section id="features">
      <SectionHeader
        label="Features"
        title="Everything you need, nothing you don't"
        subtitle="ProtoPeek is gRPC-focused. No REST, no GraphQL, no bloat."
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

function Install() {
  const [copied, setCopied] = useState<string | null>(null);

  const options = [
    {
      label: 'curl',
      cmd: 'curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh',
    },
    {
      label: 'wget',
      cmd: 'wget -qO- https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh',
    },
    {
      label: 'go install',
      cmd: 'go install github.com/shreyam1008/ProtoPeek/cmd/protopeek@latest',
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
        label="Install"
        title="One command. No dependencies."
        subtitle="ProtoPeek is a single Go binary. Install it with curl, wget, or go install."
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
          After install, run{' '}
          <code className="rounded bg-pp-bg-strong px-1.5 py-0.5 text-xs font-semibold text-pp-ink">
            pp
          </code>{' '}
          or{' '}
          <code className="rounded bg-pp-bg-strong px-1.5 py-0.5 text-xs font-semibold text-pp-ink">
            protopeek -plaintext host:port
          </code>{' '}
          to start.
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
        A performance-first gRPC workbench by{' '}
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
          href="https://shreyam1008.github.io/ProtoPeek/docs/"
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

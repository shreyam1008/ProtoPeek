import {
  ArrowRight,
  BookOpenText,
  Cable,
  ChartColumnIncreasing,
  CircleDashed,
  Download,
  FileCode2,
  FlaskConical,
  Gauge,
  GraduationCap,
  Layers3,
  SearchCode,
  Server,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  WandSparkles,
} from 'lucide-react';
import type { ComponentType, CSSProperties } from 'react';

import { featureIdeas } from '@/shared/feature-data';

const installOptions = [
  {
    title: 'Curl install',
    command:
      'curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh',
    note: 'The fast path for Linux and macOS when you want `protopeek` and `pp` without installing Go first.',
  },
  {
    title: 'Wget install',
    command:
      'wget -qO- https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh',
    note: 'Same installer path, just using `wget` when `curl` is not available on the system.',
  },
  {
    title: 'Go fallback',
    command: 'go install github.com/shreyam1008/ProtoPeek/cmd/protopeek@latest',
    note: 'Useful when you already have a Go toolchain and want the module-native installation path.',
  },
];

const tutorialSteps = [
  {
    step: '01',
    title: 'Start with the proto contract',
    body: 'A `.proto` file defines services, methods, messages, enums, field numbers, and streaming shape. ProtoPeek keeps that contract visible because gRPC tooling only feels intelligent when descriptors stay in view.',
  },
  {
    step: '02',
    title: 'Use reflection or load descriptors',
    body: 'If the server exposes reflection, ProtoPeek can discover methods at runtime. If it does not, you can load proto files or protosets and get the same schema-first experience.',
  },
  {
    step: '03',
    title: 'Ride on HTTP/2, not generic JSON-over-HTTP',
    body: 'gRPC depends on multiplexed streams, headers, flow control, and trailers. That is why debugging gRPC requires more than a body box and a status badge.',
  },
  {
    step: '04',
    title: 'End with status and trailers',
    body: 'The final gRPC status often arrives after message frames. ProtoPeek keeps headers, trailers, latency, and payloads together so the transport story stays visible.',
  },
];

const rpcShapes = [
  {
    title: 'Unary',
    rhythm: '1 request → 1 response',
    body: 'The most familiar shape, but still backed by gRPC metadata, deadlines, and trailers.',
  },
  {
    title: 'Server streaming',
    rhythm: '1 request → N responses',
    body: 'Great for feeds, event replay, and progressive reads where the server keeps sending frames.',
  },
  {
    title: 'Client streaming',
    rhythm: 'N requests → 1 response',
    body: 'The client sends a batch or live stream of messages before the server answers once.',
  },
  {
    title: 'Bidirectional',
    rhythm: 'N requests ↔ N responses',
    body: 'Both sides speak over the same stream, which is why transport-aware tooling matters.',
  },
];

const debugPlaybook = [
  {
    symptom: 'I cannot discover any RPCs.',
    inspect: 'Reflection or descriptor source',
    note: 'If reflection is off, point ProtoPeek at proto files or a protoset instead of guessing method names manually.',
  },
  {
    symptom: 'The request works locally but fails in staging.',
    inspect: 'Metadata, authority, TLS, and trailers',
    note: 'Auth headers, host routing, cert mismatch, and server-side status details usually explain that gap.',
  },
  {
    symptom: 'The browser client behaves differently.',
    inspect: 'gRPC-Web bridge and proxy hop',
    note: 'A browser issue may actually live in Envoy or another translation layer, not in the backend service.',
  },
  {
    symptom: 'Latency looks fine until load rises.',
    inspect: 'Simulation studio and concurrency curve',
    note: 'ProtoPeek gives you a fast p50/p95/p99 and throughput sanity check before you reach for heavier benchmarking gear.',
  },
];

const citations = [
  {
    label: 'TypeScript Native Previews',
    href: 'https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/',
    note: 'Reference for `@typescript/native-preview`, `tsgo`, and the TypeScript toolchain modernization.',
  },
  {
    label: 'Postman gRPC request interface',
    href: 'https://learning.postman.com/docs/sending-requests/grpc/grpc-request-interface/',
    note: 'Baseline reference for the gRPC workflow users expect from modern request tooling.',
  },
  {
    label: 'gRPC guides',
    href: 'https://grpc.io/docs/guides/',
    note: 'Primary reference for metadata, reflection, performance, debugging, deadlines, and transport behavior.',
  },
  {
    label: 'gRPC-Web basics',
    href: 'https://grpc.io/docs/platforms/web/basics/',
    note: 'Primary reference for browser-facing gRPC constraints and why the bridge layer exists.',
  },
  {
    label: 'Envoy gRPC overview',
    href: 'https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_protocols/grpc.html',
    note: 'Reference for the translation layer many browser-facing gRPC stacks depend on.',
  },
  {
    label: 'gRPC debugging guide',
    href: 'https://grpc.io/docs/guides/debugging/',
    note: 'Reference for deeper runtime inspection beyond payloads and request forms.',
  },
];

export function App() {
  return (
    <div className="pp-shell">
      <div className="pp-orb pointer-events-none absolute left-[-120px] top-12 size-80 rounded-full bg-pp-brand/18 blur-3xl" />
      <div className="pp-orb pointer-events-none absolute right-[-80px] top-52 size-72 rounded-full bg-pp-accent/18 blur-3xl" />

      <div className="mx-auto max-w-7xl space-y-6">
        <header className="pp-panel-strong relative overflow-hidden px-6 py-6 lg:px-10 lg:py-10">
          <div className="pp-hero-mesh pointer-events-none absolute inset-0" />

          <nav className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="pp-label">ProtoPeek</div>
              <div className="mt-2 text-lg font-semibold text-pp-ink">
                Independent gRPC workbench by Shreyam Adhikari
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <AnchorLink href="#install" label="Install" />
              <AnchorLink href="#learn-grpc" label="How gRPC Works" />
              <AnchorLink href="#features" label="Features" />
              <AnchorLink href="#citations" label="Sources" />
            </div>
          </nav>

          <div className="relative mt-10 grid gap-8 xl:grid-cols-[1.02fr_0.98fr]">
            <div className="space-y-5">
              <div className="pp-badge">
                <WandSparkles className="size-4" />
                Launcher-first tooling for transport-first debugging
              </div>
              <h1 className="pp-heading max-w-5xl text-5xl leading-[0.98] tracking-[-0.06em] md:text-7xl">
                Beautiful gRPC tooling for humans who need answers fast.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-pp-muted">
                ProtoPeek opens blank, lets you register one or more gRPC targets, visualizes the
                proto contract, keeps metadata and trailers visible, and explains how the transport
                actually works with animated tutorial sections instead of vague marketing copy.
              </p>

              <div className="flex flex-wrap gap-3">
                <a className="pp-button-primary" href="#install">
                  Install ProtoPeek
                  <Download className="size-4" />
                </a>
                <a className="pp-button-secondary" href="#learn-grpc">
                  Learn gRPC visually
                  <ArrowRight className="size-4" />
                </a>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="Primary workflow" value="Launch first, attach targets later" />
                <StatCard label="Install path" value="curl or wget, no Go required" />
                <StatCard label="Why it stands out" value="Proto explorer plus simulation studio" />
              </div>
            </div>

            <HeroStage />
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]" id="install">
          <article className="pp-panel">
            <div className="pp-label">Install</div>
            <h2 className="pp-heading mt-3 text-4xl">One command, no Go toolchain required.</h2>
            <p className="pp-muted mt-4">
              The installer fetches the latest ProtoPeek release artifact, installs `protopeek`, and
              also gives you the `pp` short alias. Use `go install` only if you already want the
              Go-native path.
            </p>

            <div className="mt-5 space-y-4">
              {installOptions.map((option) => (
                <InstallCard key={option.title} {...option} />
              ))}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <a className="pp-button-secondary" href="https://github.com/shreyam1008/ProtoPeek">
                GitHub repo
                <SquareArrowOutUpRight className="size-4" />
              </a>
              <a
                className="pp-button-secondary"
                href="https://github.com/shreyam1008/ProtoPeek/blob/master/guides/learn-grpc.md"
                rel="noreferrer"
                target="_blank"
              >
                Markdown guide
                <BookOpenText className="size-4" />
              </a>
            </div>
          </article>

          <article className="pp-panel-strong overflow-hidden px-6 py-6">
            <div className="grid gap-5 lg:grid-cols-[0.96fr_1.04fr]">
              <div className="space-y-4">
                <PanelPreamble
                  icon={Sparkles}
                  title="What happens after install"
                  description="ProtoPeek is intentionally compact: a Go binary, embedded web app, local-first workspace state, and no hosted account requirement."
                />

                <LaunchRail />
              </div>

              <div className="rounded-[30px] border border-pp-border bg-[#081719] p-5 text-white shadow-[var(--pp-shadow)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="pp-label text-[#86ddd4]">First launch</div>
                    <div className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                      `pp` starts blank on purpose.
                    </div>
                  </div>
                  <Server className="size-7 text-[#f7c66a]" />
                </div>

                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <div className="font-mono text-sm text-[#d6fbf5]">$ pp</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs text-[#9be8de]">
                      add target
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs text-[#9be8de]">
                      choose reflection
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs text-[#9be8de]">
                      inspect proto
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs text-[#9be8de]">
                      run simulation
                    </span>
                  </div>
                </div>

                <div className="mt-5">
                  <HeroTransportDiagram />
                </div>
              </div>
            </div>
          </article>
        </section>

        <section
          className="pp-panel-strong overflow-hidden px-6 py-6 lg:px-8 lg:py-8"
          id="learn-grpc"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="pp-label">How gRPC Works</div>
              <h2 className="pp-heading mt-3 text-4xl">
                A transport tutorial, not just another feature list.
              </h2>
            </div>
            <div className="pp-badge">
              <GraduationCap className="size-4" />
              Visual protocol walkthrough
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[0.84fr_1.16fr]">
            <div className="space-y-4">
              {tutorialSteps.map((step, index) => (
                <TutorialCard key={step.step} index={index} {...step} />
              ))}
              <a
                className="pp-button-secondary"
                href="https://github.com/shreyam1008/ProtoPeek/blob/master/guides/learn-grpc.md"
                rel="noreferrer"
                target="_blank"
              >
                Read the long-form markdown guide
                <SquareArrowOutUpRight className="size-4" />
              </a>
            </div>

            <div className="space-y-6">
              <FlowDiagram />
              <LatencyPanel />
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
            <BridgeDiagram />
            <div className="pp-panel">
              <PanelPreamble
                icon={CircleDashed}
                title="The four RPC shapes"
                description="These are not cosmetic labels. They change the request editor, the response surface, and the debugging model."
              />

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {rpcShapes.map((shape) => (
                  <ShapeCard key={shape.title} {...shape} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <article className="pp-panel">
            <PanelPreamble
              icon={Gauge}
              title="Debug playbook"
              description="When a gRPC issue appears, the body is usually only a small part of the story."
            />
            <div className="mt-5 space-y-3">
              {debugPlaybook.map((item) => (
                <PlaybookCard key={item.symptom} {...item} />
              ))}
            </div>
          </article>

          <article className="pp-panel">
            <PanelPreamble
              icon={ChartColumnIncreasing}
              title="What ProtoPeek surfaces"
              description="ProtoPeek is opinionated about what should stay visible when you are under time pressure."
            />

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <FeatureTeaser
                icon={SearchCode}
                title="Method rail"
                body="Search services and methods without collapsing the gRPC topology into a stack of dropdowns."
              />
              <FeatureTeaser
                icon={FileCode2}
                title="Proto explorer"
                body="Inspect files, messages, enums, dependencies, and raw `.proto` text before sending the first request."
              />
              <FeatureTeaser
                icon={FlaskConical}
                title="Simulation studio"
                body="Measure p50, p95, p99, and throughput with the current request instead of importing generic benchmark numbers."
              />
              <FeatureTeaser
                icon={Cable}
                title="Transport lens"
                body="Keep metadata, trailers, gRPC-Web constraints, and discovery paths visible while you debug."
              />
            </div>
          </article>
        </section>

        <section className="pp-panel" id="features">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="pp-label">Feature map</div>
              <h2 className="pp-heading mt-3 text-4xl">Shipped capabilities.</h2>
            </div>
            <div className="pp-badge">
              <Layers3 className="size-4" />
              Built for production debugging pressure
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {featureIdeas.map((feature) => (
              <article
                className="rounded-[28px] border border-pp-border bg-white/75 p-5"
                key={feature.name}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-pp-ink">{feature.name}</h3>
                  <span className="pp-badge text-emerald-700">{feature.status}</span>
                </div>
                <p className="pp-muted mt-3">{feature.summary}</p>
                <p className="mt-3 text-sm leading-6 text-pp-ink">{feature.rationale}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pp-panel" id="citations">
          <div className="pp-label">Sources</div>
          <h2 className="pp-heading mt-3 text-4xl">Official references behind the product.</h2>
          <div className="mt-6 grid gap-3">
            {citations.map((citation) => (
              <a
                className="block rounded-[24px] border border-pp-border bg-white/75 p-4 transition hover:border-pp-brand/35 hover:bg-white"
                href={citation.href}
                key={citation.href}
                rel="noreferrer"
                target="_blank"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-pp-ink">{citation.label}</div>
                  <SquareArrowOutUpRight className="size-4 text-pp-brand" />
                </div>
                <div className="pp-muted mt-2">{citation.note}</div>
              </a>
            ))}
          </div>
        </section>

        <footer className="pp-panel">
          <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
            <div>
              <div className="pp-label">Project identity</div>
              <h2 className="pp-heading mt-3 text-4xl">ProtoPeek is its own project now.</h2>
              <p className="pp-muted mt-4 max-w-3xl">
                Product branding, installer flow, release automation, website, and public docs now
                center ProtoPeek directly. The historical origin note stays only for context.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <a
                  className="pp-button-secondary"
                  href="https://github.com/shreyam1008/ProtoPeek"
                  rel="noreferrer"
                  target="_blank"
                >
                  GitHub repository
                  <SquareArrowOutUpRight className="size-4" />
                </a>
                <a
                  className="pp-button-secondary"
                  href="https://shreyam1008.com.np/"
                  rel="noreferrer"
                  target="_blank"
                >
                  shreyam1008.com.np
                  <SquareArrowOutUpRight className="size-4" />
                </a>
              </div>
            </div>

            <div className="rounded-[28px] border border-pp-border bg-[#081719] p-5 text-[#d7fff7]">
              <div className="pp-label text-[#87ddd4]">Historical note</div>
              <div className="mt-3 text-sm leading-7">
                ProtoPeek’s GitHub repository was created on March 26, 2026. It originated from a
                fork of `fullstorydev/grpcui`, but the current project direction, docs, branding,
                and release flow are now ProtoPeek’s own.
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function AnchorLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="pp-button-secondary px-4 py-2" href={href}>
      {label}
    </a>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-pp-border bg-white/75 p-4">
      <div className="pp-label">{label}</div>
      <div className="mt-2 text-base font-semibold text-pp-ink">{value}</div>
    </div>
  );
}

function PanelPreamble({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-pp-brand/10 text-pp-brand">
        <Icon className="size-5" />
      </div>
      <div>
        <h3 className="pp-heading text-2xl">{title}</h3>
        <p className="pp-muted mt-2">{description}</p>
      </div>
    </div>
  );
}

function InstallCard({ title, command, note }: { title: string; command: string; note: string }) {
  return (
    <div className="rounded-[26px] border border-pp-border bg-white/75 p-4">
      <div className="font-semibold text-pp-ink">{title}</div>
      <pre className="pp-code mt-3 whitespace-pre-wrap break-words">{command}</pre>
      <p className="pp-muted mt-3">{note}</p>
    </div>
  );
}

function LaunchRail() {
  const stages = [
    'Run `protopeek` or `pp`',
    'Add one or more targets',
    'Choose reflection, proto files, or protoset',
    'Inspect the proto graph before invoking',
    'Run assertions and simulation',
  ];

  return (
    <div className="space-y-3">
      {stages.map((stage, index) => (
        <div
          className="rounded-[24px] border border-pp-border bg-white/75 p-4 pp-reveal"
          key={stage}
          style={{ animationDelay: `${index * 120}ms` } as CSSProperties}
        >
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-pp-brand text-sm font-semibold text-white">
              {index + 1}
            </span>
            <div className="font-semibold text-pp-ink">{stage}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HeroStage() {
  return (
    <div className="rounded-[34px] border border-pp-border bg-[#081719] p-5 text-white shadow-[var(--pp-shadow)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="pp-label text-[#86ddd4]">Live install flow</div>
          <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
            Shipping the binary is not enough.
          </div>
          <p className="mt-3 max-w-xl text-sm leading-7 text-[#cceee8]">
            ProtoPeek pairs the binary with an install script, GitHub release artifacts, and a
            visual learn surface so the first-run experience feels intentional instead of
            improvised.
          </p>
        </div>
        <ShieldCheck className="size-8 text-[#f5bd58]" />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-[24px] border border-white/10 bg-white/6 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#87ddd4]">
            install
          </div>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-[0.83rem] leading-6 text-[#d7fff7]">
            curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh |
            sh
          </pre>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-white/6 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#87ddd4]">
            launch
          </div>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-[0.83rem] leading-6 text-[#d7fff7]">
            pp
            {'\n'}protopeek -plaintext localhost:50051
          </pre>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <StageMetric label="Workspace mode" value="blank-first launcher" />
        <StageMetric label="Schema view" value="proto explorer + export" />
        <StageMetric label="Validation" value="tests + simulation" />
      </div>

      <div className="mt-6">
        <HeroTransportDiagram />
      </div>
    </div>
  );
}

function StageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/5 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8adfd6]">
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function HeroTransportDiagram() {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
      <svg
        aria-label="ProtoPeek launcher transport diagram"
        className="w-full"
        role="img"
        viewBox="0 0 720 220"
      >
        <title>ProtoPeek launcher transport diagram</title>
        <path
          className="pp-flow-path"
          d="M 110 108 H 610"
          fill="none"
          stroke="#62d4c6"
          strokeWidth="4"
        />
        {[0, 1, 2].map((index) => (
          <circle
            className="pp-pulse-dot"
            cx={180 + index * 150}
            cy="108"
            fill="#f5bd58"
            key={index}
            r="8"
            style={{ animationDelay: `${index * 220}ms` } as CSSProperties}
          />
        ))}
        <Node x={42} y={62} title="pp" subtitle="workspace" />
        <Node x={230} y={30} title="reflection" subtitle="or descriptors" />
        <Node x={432} y={30} title="HTTP/2" subtitle="metadata + frames" />
        <Node x={588} y={62} title="trailers" subtitle="status lands late" />
      </svg>
    </div>
  );
}

function FlowDiagram() {
  return (
    <div className="rounded-[32px] border border-pp-border bg-[#081719] p-5 text-white shadow-[var(--pp-shadow)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="pp-label text-[#87ddd4]">Animated protocol chart</div>
          <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
            Contract → discovery → transport → trailers
          </div>
        </div>
        <Cable className="size-7 text-[#f7c66a]" />
      </div>

      <div className="mt-5 rounded-[28px] border border-white/10 bg-white/5 p-4">
        <svg aria-label="How gRPC works" className="w-full" role="img" viewBox="0 0 920 280">
          <title>How gRPC works</title>
          <path
            className="pp-flow-path"
            d="M 135 140 H 790"
            fill="none"
            stroke="#62d4c6"
            strokeWidth="5"
          />
          {[0, 1, 2, 3].map((index) => (
            <circle
              className="pp-pulse-dot"
              cx={195 + index * 165}
              cy="140"
              fill={index % 2 === 0 ? '#f5bd58' : '#8ef0e0'}
              key={index}
              r="10"
              style={{ animationDelay: `${index * 260}ms` } as CSSProperties}
            />
          ))}
          <Node x={36} y={94} title=".proto" subtitle="schema" />
          <Node x={214} y={40} title="reflection" subtitle="or protoset" />
          <Node x={404} y={40} title="request" subtitle="headers + body" />
          <Node x={588} y={40} title="stream" subtitle="HTTP/2 frames" />
          <Node x={772} y={94} title="trailers" subtitle="status + metadata" />
        </svg>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <DarkFact
          title="Reflection makes the console intelligent"
          body="Without descriptors, a gRPC client is effectively blind. Reflection or explicit schema files are what let ProtoPeek generate the method rail and request scaffolds."
        />
        <DarkFact
          title="HTTP/2 is the difference"
          body="The protocol is not just a different content type. It changes connection reuse, framing, trailers, and how streaming works."
        />
        <DarkFact
          title="Trailers carry the ending"
          body="The final status often arrives after payload frames, so tools must treat trailers as first-class transport data."
        />
      </div>
    </div>
  );
}

function Node({
  x,
  y,
  title,
  subtitle,
}: {
  x: number;
  y: number;
  title: string;
  subtitle: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        fill="rgba(255,255,255,0.08)"
        height="92"
        rx="22"
        stroke="rgba(255,255,255,0.12)"
        width="120"
      />
      <text
        fill="#ffffff"
        fontFamily="Space Grotesk, sans-serif"
        fontSize="22"
        fontWeight="700"
        x="16"
        y="38"
      >
        {title}
      </text>
      <text fill="#98ddd6" fontFamily="JetBrains Mono, monospace" fontSize="15" x="16" y="64">
        {subtitle}
      </text>
    </g>
  );
}

function DarkFact({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/6 p-4">
      <div className="font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm leading-7 text-[#cfeeea]">{body}</p>
    </div>
  );
}

function TutorialCard({
  body,
  index,
  step,
  title,
}: {
  body: string;
  index: number;
  step: string;
  title: string;
}) {
  return (
    <div
      className="rounded-[28px] border border-pp-border bg-white/75 p-5 pp-reveal"
      style={{ animationDelay: `${index * 120}ms` } as CSSProperties}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-pp-brand text-sm font-semibold text-white">
          {step}
        </span>
        <h3 className="text-xl font-semibold text-pp-ink">{title}</h3>
      </div>
      <p className="pp-muted mt-4">{body}</p>
    </div>
  );
}

function BridgeDiagram() {
  return (
    <div className="rounded-[32px] border border-pp-border bg-white/85 p-5 shadow-[var(--pp-shadow)]">
      <PanelPreamble
        icon={Server}
        title="Native gRPC vs browser gRPC-Web"
        description="Browsers change the transport shape. That is why ProtoPeek keeps the bridge layer explicit instead of pretending every client path is identical."
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <LaneCard
          title="Native gRPC lane"
          accent="bg-pp-brand"
          items={[
            'Client speaks protobuf over HTTP/2 directly',
            'Headers and trailers stay native',
            'Unary and streaming semantics map directly',
            'Reflection can be queried from the same connection model',
          ]}
        />
        <LaneCard
          title="Browser-facing lane"
          accent="bg-pp-accent"
          items={[
            'The browser speaks gRPC-Web semantics',
            'Envoy or another bridge translates to backend gRPC',
            'Header and trailer behavior is adapted for browser limits',
            'A visible browser issue may actually be a proxy or gateway issue',
          ]}
        />
      </div>

      <div className="mt-5 rounded-[28px] border border-pp-border bg-[#f8fcfc] p-4">
        <svg aria-label="gRPC-Web bridge" className="w-full" role="img" viewBox="0 0 860 180">
          <title>gRPC-Web bridge</title>
          <path
            className="pp-flow-path"
            d="M 120 70 H 740"
            fill="none"
            stroke="#0d8b84"
            strokeWidth="4"
          />
          <path
            className="pp-flow-path"
            d="M 120 120 H 740"
            fill="none"
            stroke="#f5a524"
            strokeWidth="4"
          />
          <circle className="pp-pulse-dot" cx="280" cy="70" fill="#0d8b84" r="8" />
          <circle
            className="pp-pulse-dot"
            cx="510"
            cy="120"
            fill="#f5a524"
            r="8"
            style={{ animationDelay: '240ms' }}
          />
          <LightNode x={34} y={38} title="browser" subtitle="gRPC-Web" />
          <LightNode x={324} y={20} title="Envoy" subtitle="bridge" />
          <LightNode x={628} y={38} title="server" subtitle="native gRPC" />
        </svg>
      </div>
    </div>
  );
}

function LaneCard({ accent, items, title }: { accent: string; items: string[]; title: string }) {
  return (
    <div className="rounded-[24px] border border-pp-border bg-white/80 p-4">
      <div className="flex items-center gap-3">
        <span className={`size-3 rounded-full ${accent}`} />
        <div className="font-semibold text-pp-ink">{title}</div>
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div className="flex items-start gap-3 text-sm leading-7 text-pp-ink" key={item}>
            <ArrowRight className="mt-1 size-4 shrink-0 text-pp-brand" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LightNode({
  x,
  y,
  title,
  subtitle,
}: {
  x: number;
  y: number;
  title: string;
  subtitle: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        fill="rgba(255,255,255,0.9)"
        height="72"
        rx="18"
        stroke="rgba(13,46,47,0.08)"
        width="164"
      />
      <text
        fill="#0f2f31"
        fontFamily="Space Grotesk, sans-serif"
        fontSize="20"
        fontWeight="700"
        x="18"
        y="32"
      >
        {title}
      </text>
      <text fill="#5f7d7f" fontFamily="JetBrains Mono, monospace" fontSize="14" x="18" y="54">
        {subtitle}
      </text>
    </g>
  );
}

function LatencyPanel() {
  return (
    <div className="rounded-[32px] border border-pp-border bg-white/85 p-5 shadow-[var(--pp-shadow)]">
      <PanelPreamble
        icon={ChartColumnIncreasing}
        title="Latency and transport visibility"
        description="ProtoPeek ships a lightweight simulation surface because benchmarks should come from your service, not from a screenshot on the internet."
      />

      <div className="mt-5 rounded-[28px] border border-pp-border bg-[#081719] p-4">
        <svg aria-label="Latency chart" className="w-full" role="img" viewBox="0 0 760 220">
          <title>Latency chart</title>
          <path d="M 40 184 H 720" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
          <path d="M 40 34 V 184" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
          <path
            d="M 42 164 C 128 154, 178 132, 240 122 S 360 114, 430 98 S 564 68, 640 72 S 704 86, 718 92"
            fill="none"
            stroke="#62d4c6"
            strokeWidth="5"
          />
          <path
            d="M 42 178 C 136 176, 206 170, 276 165 S 420 154, 492 138 S 612 108, 718 112"
            fill="none"
            stroke="#f5bd58"
            strokeWidth="4"
            opacity="0.8"
          />
          <circle className="pp-pulse-dot" cx="640" cy="72" fill="#62d4c6" r="8" />
          <circle
            className="pp-pulse-dot"
            cx="718"
            cy="112"
            fill="#f5bd58"
            r="7"
            style={{ animationDelay: '300ms' }}
          />
          <text fill="#8fded5" fontFamily="JetBrains Mono, monospace" fontSize="14" x="56" y="48">
            p95 curve
          </text>
          <text fill="#f8cb75" fontFamily="JetBrains Mono, monospace" fontSize="14" x="56" y="72">
            throughput ceiling
          </text>
        </svg>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="What you measure" value="p50 p95 p99 throughput" />
        <StatCard label="What you keep visible" value="headers trailers latency" />
        <StatCard label="Why it matters" value="benchmark your own topology" />
      </div>
    </div>
  );
}

function ShapeCard({ body, rhythm, title }: { body: string; rhythm: string; title: string }) {
  return (
    <div className="rounded-[24px] border border-pp-border bg-white/80 p-4">
      <div className="font-semibold text-pp-ink">{title}</div>
      <div className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-pp-brand">
        {rhythm}
      </div>
      <p className="pp-muted mt-3">{body}</p>
    </div>
  );
}

function PlaybookCard({
  inspect,
  note,
  symptom,
}: {
  inspect: string;
  note: string;
  symptom: string;
}) {
  return (
    <div className="rounded-[24px] border border-pp-border bg-white/75 p-4">
      <div className="text-sm font-semibold uppercase tracking-[0.16em] text-pp-brand">
        {inspect}
      </div>
      <div className="mt-2 text-lg font-semibold text-pp-ink">{symptom}</div>
      <p className="pp-muted mt-3">{note}</p>
    </div>
  );
}

function FeatureTeaser({
  icon: Icon,
  title,
  body,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[28px] border border-pp-border bg-white/75 p-5 shadow-[var(--pp-shadow)]">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-pp-brand/10 text-pp-brand">
        <Icon className="size-5" />
      </div>
      <div className="mt-4 text-lg font-semibold text-pp-ink">{title}</div>
      <p className="pp-muted mt-3">{body}</p>
    </div>
  );
}

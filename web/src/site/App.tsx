import {
  ArrowRight,
  BookOpenText,
  Cable,
  ChartColumnIncreasing,
  CircleDashed,
  Gauge,
  GraduationCap,
  Layers3,
  SearchCode,
  ShieldCheck,
  SquareArrowOutUpRight,
  WandSparkles,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { featureIdeas } from '@/shared/feature-data';

const citations = [
  {
    label: 'Go 1.26 release',
    href: 'https://go.dev/blog/go1.26',
    note: 'Used to justify the baseline Go toolchain for the overhaul.',
  },
  {
    label: 'TypeScript Native Previews',
    href: 'https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/',
    note: 'Confirms the `@typescript/native-preview` package, `tsgo`, its speed focus, and current feature gaps.',
  },
  {
    label: 'Tailwind CSS blog',
    href: 'https://tailwindcss.com/blog',
    note: 'Reference point for the modern utility pipeline and current Tailwind v4 era.',
  },
  {
    label: 'Postman gRPC client interface',
    href: 'https://learning.postman.com/docs/sending-requests/grpc/grpc-request-interface/',
    note: 'Reference for method selection, metadata, auth, and request ergonomics expected by users.',
  },
  {
    label: 'Postman gRPC test scripts',
    href: 'https://learning.postman.com/docs/postman/scripts/test_scripts/',
    note: 'Reference for future test hooks before, during, and after requests.',
  },
  {
    label: 'gRPC guides index',
    href: 'https://grpc.io/docs/guides/',
    note: 'Reference for benchmarking, debugging, metadata, reflection, and performance topics.',
  },
  {
    label: 'gRPC-Web basics',
    href: 'https://grpc.io/docs/platforms/web/basics/',
    note: 'Reference for browser-facing transport behavior and why gRPC-Web exists.',
  },
  {
    label: 'Envoy gRPC overview',
    href: 'https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_protocols/grpc.html',
    note: 'Reference for how Envoy bridges gRPC-Web clients to gRPC servers.',
  },
  {
    label: 'gRPC debugging guide',
    href: 'https://grpc.io/docs/guides/debugging/',
    note: 'Reference for grpcdebug, admin services, and deeper runtime inspection.',
  },
];

const stackHighlights = [
  'Go 1.26 baseline for the runtime, CLI, and embedded asset delivery.',
  'React + Vite for the client shell, with `tsgo` from `@typescript/native-preview` for typechecking.',
  'Tailwind v4-era styling with custom CSS variables and animation, without a heavy component framework.',
  'Local-first collections, history, and simulations so the tool stays fast and private by default.',
];

const protocolFacts = [
  {
    title: 'Reflection removes blind spots',
    body: 'gRPC reflection lets tools ask the server for descriptors at runtime. That is why ProtoPeek can generate method rails, starter payloads, and readable schema panels without a hand-built client.',
  },
  {
    title: 'HTTP/2 changes the transport model',
    body: 'gRPC rides on HTTP/2 framing, multiplexing, headers, and trailers. That gives you bidirectional streams and metadata, but it also means generic REST tooling misses important context.',
  },
  {
    title: 'gRPC-Web is a compatibility layer, not the same transport',
    body: 'Browsers cannot speak native gRPC directly the same way backend runtimes can, so frontends usually depend on gRPC-Web plus a bridge such as Envoy or Connect-compatible gateways.',
  },
  {
    title: 'Debugging is often about state, not payloads',
    body: 'By the time a request fails, the real cause can be deadlines, TLS, headers, retries, xDS, or broken service config. That is why ProtoPeek pairs request inspection with simulation and direct links to deeper debug tooling.',
  },
];

export function App() {
  return (
    <div className="pp-shell">
      <div className="pp-orb pointer-events-none absolute left-[-140px] top-10 size-96 rounded-full bg-pp-brand/20 blur-3xl" />
      <div className="pp-orb pointer-events-none absolute right-[-160px] top-[14rem] size-[28rem] rounded-full bg-pp-accent/20 blur-3xl" />

      <div className="mx-auto max-w-7xl space-y-6">
        <header className="pp-panel-strong overflow-hidden px-6 py-6 lg:px-8 lg:py-8">
          <nav className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="pp-label">ProtoPeek</div>
              <div className="mt-2 text-lg font-semibold text-pp-ink">
                Lightweight gRPC console for the HTTP/2 era
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <AnchorLink href="#features" label="Features" />
              <AnchorLink href="#install" label="Install" />
              <AnchorLink href="#learn-grpc" label="Learn gRPC" />
              <AnchorLink href="#citations" label="Sources" />
            </div>
          </nav>

          <div className="mt-10 grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-5">
              <div className="pp-badge">
                <WandSparkles className="size-4" />
                Independent gRPC workbench with thanks to grpcui upstream
              </div>
              <h1 className="pp-heading max-w-4xl text-5xl leading-[1.02] tracking-[-0.05em] md:text-7xl">
                A fast, modern gRPC workbench that actually understands your transport.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-pp-muted">
                ProtoPeek keeps the binary small and the workflow dense: blank-launch target
                registry, reflected schemas, proto structure explorer/export, JSON starter payloads,
                response trailers, and a built-in simulation studio for baseline throughput and
                latency checks.
              </p>

              <div className="flex flex-wrap gap-3">
                <a className="pp-button-primary" href="#install">
                  Install and run
                  <ArrowRight className="size-4" />
                </a>
                <a className="pp-button-secondary" href="#learn-grpc">
                  Learn how gRPC works
                </a>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="Shipping model" value="Single Go binary" />
                <StatCard
                  label="Primary workflow"
                  value="Launch first, connect targets from the UI"
                />
                <StatCard label="Unique edge" value="Proto explorer plus simulation studio" />
              </div>
            </div>

            <div className="relative grid gap-4 self-start md:grid-cols-2">
              <FeatureTeaser
                icon={SearchCode}
                title="Method rail"
                body="Search services and methods without hiding the topology behind dropdowns."
              />
              <FeatureTeaser
                icon={BookOpenText}
                title="Proto explorer"
                body="Inspect files, services, messages, enums, dependencies, and export raw `.proto` text."
              />
              <FeatureTeaser
                icon={ChartColumnIncreasing}
                title="Simulation"
                body="Run lightweight concurrency sweeps before you leave the console."
              />
              <FeatureTeaser
                icon={Gauge}
                title="Workspace launcher"
                body="Open ProtoPeek with no target, save endpoints, and reconnect without restarting the CLI."
              />
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]" id="install">
          <article className="pp-panel">
            <div className="pp-label">Quick start</div>
            <h2 className="pp-heading mt-3 text-3xl">
              Install, launch blank, or point it directly.
            </h2>
            <p className="pp-muted mt-3">
              The old trigger was `grpcui -plaintext localhost:50051`. The new public entrypoint is
              `protopeek`, with `pp` as the short alias. You can now launch the workspace first and
              register targets from the browser UI.
            </p>
            <div className="pp-code mt-5">
              go install github.com/shreyam1008/ProtoPeek/cmd/protopeek@latest
            </div>
            <div className="pp-code mt-4">protopeek</div>
            <div className="pp-code mt-4">pp</div>
            <div className="pp-code mt-4">protopeek -plaintext localhost:50051</div>
            <div className="pp-code mt-4">pp -plaintext localhost:50051</div>
          </article>

          <article className="pp-panel">
            <div className="pp-label">Why this exists</div>
            <h2 className="pp-heading mt-3 text-3xl">
              Debugging gRPC is not just “send JSON and wait”.
            </h2>
            <div className="mt-4 space-y-3">
              <ProblemPoint
                title="The transport carries more than bodies"
                body="Headers, trailers, deadlines, TLS state, and stream modes all matter, and generic API tools usually flatten that away."
              />
              <ProblemPoint
                title="Reflection is underused"
                body="If a service exposes descriptors, the tool can generate far richer guidance than a blank JSON box."
              />
              <ProblemPoint
                title="Frontend teams hit gRPC-Web complexity"
                body="Once browsers enter the picture, Envoy and header semantics become part of the conversation."
              />
            </div>
          </article>
        </section>

        <section className="pp-panel" id="features">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="pp-label">Feature map</div>
              <h2 className="pp-heading mt-3 text-4xl">Ten shipped capabilities in ProtoPeek.</h2>
            </div>
            <div className="pp-badge">
              <Layers3 className="size-4" />
              Launcher-first, gRPC-aware workflow
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
                  <span
                    className={
                      feature.status === 'Shipped'
                        ? 'pp-badge text-emerald-700'
                        : 'pp-badge text-amber-700'
                    }
                  >
                    {feature.status}
                  </span>
                </div>
                <p className="pp-muted mt-3">{feature.summary}</p>
                <p className="mt-3 text-sm leading-6 text-pp-ink">{feature.rationale}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <article className="pp-panel">
            <div className="pp-label">Stack choices</div>
            <h2 className="pp-heading mt-3 text-3xl">Built to stay fast without staying old.</h2>
            <div className="mt-5 space-y-3">
              {stackHighlights.map((item) => (
                <div
                  className="rounded-[24px] border border-pp-border bg-white/75 px-4 py-4"
                  key={item}
                >
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-1 size-5 text-pp-brand" />
                    <p className="text-sm leading-7 text-pp-ink">{item}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="pp-panel">
            <div className="pp-label">Benchmarks and performance</div>
            <h2 className="pp-heading mt-3 text-3xl">
              Measure locally, don&apos;t cargo-cult headline numbers.
            </h2>
            <div className="mt-5 grid gap-3">
              <BenchmarkCard
                title="Official guidance favors measured scenarios"
                body="The gRPC docs provide dedicated benchmarking and performance-best-practice guides because protocol behavior changes with payload size, stream shape, compression, retries, and deployment topology."
              />
              <BenchmarkCard
                title="ProtoPeek ships a baseline simulation studio"
                body="Instead of copying internet charts into your incident review, you can run quick concurrency sweeps against your own service and inspect p50, p95, p99, success rate, and throughput."
              />
              <BenchmarkCard
                title="The browser path is different"
                body="Once you add gRPC-Web and Envoy, the performance profile changes again. That is why the site and the console both keep the bridge story explicit."
              />
            </div>
          </article>
        </section>

        <section className="pp-panel" id="learn-grpc">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="pp-label">Learn gRPC</div>
              <h2 className="pp-heading mt-3 text-4xl">
                From protobuf contracts to browser bridges.
              </h2>
            </div>
            <div className="pp-badge">
              <GraduationCap className="size-4" />
              Transport-first explanation
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <ProtocolCard
                icon={Cable}
                title="1. Define the contract"
                body="A `.proto` file describes services, methods, request/response messages, enums, and field numbers. That contract is the source of truth for generated clients, servers, and reflection metadata."
              />
              <ProtocolCard
                icon={CircleDashed}
                title="2. Serialize efficiently"
                body="Protocol Buffers turn structured messages into compact binary payloads with field tags instead of repeating full JSON keys on the wire."
              />
              <ProtocolCard
                icon={Layers3}
                title="3. Send over HTTP/2"
                body="HTTP/2 gives gRPC multiplexed streams, header compression, and trailers. This transport model is one reason gRPC handles streaming and metadata so naturally."
              />
              <ProtocolCard
                icon={Gauge}
                title="4. Return status in trailers"
                body="gRPC status and trailing metadata often arrive after the response body frames, which is why tools need trailer visibility instead of just final body text."
              />
            </div>

            <div className="rounded-[32px] border border-pp-border bg-white/75 p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <ArchitectureCard
                  title="Native gRPC path"
                  items={[
                    'Client encodes protobuf messages',
                    'HTTP/2 frames carry metadata and payloads',
                    'Server replies with messages plus trailers',
                    'Reflection can expose descriptors for tools',
                  ]}
                />
                <ArchitectureCard
                  title="Browser-facing gRPC-Web path"
                  items={[
                    'Browser client uses gRPC-Web semantics',
                    'Proxy or gateway terminates browser-friendly request',
                    'Envoy or equivalent translates to backend gRPC',
                    'Headers and trailers have to be adapted back to the browser',
                  ]}
                />
              </div>

              <div className="mt-5 rounded-[28px] border border-pp-border bg-[#081719] px-5 py-5 text-[#d8fff2]">
                <div className="pp-label text-[#7dd8cd]">Why ProtoPeek matters</div>
                <div className="mt-3 text-sm leading-7">
                  gRPC is operationally elegant once you internalize the model, but that same model
                  makes debugging harder when your tool only shows a body and a status code.
                  ProtoPeek focuses on the parts that usually get lost: reflection visibility,
                  metadata, trailers, request shape, and baseline performance behavior.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {protocolFacts.map((fact) => (
              <article
                className="rounded-[28px] border border-pp-border bg-white/75 p-5"
                key={fact.title}
              >
                <h3 className="text-lg font-semibold text-pp-ink">{fact.title}</h3>
                <p className="pp-muted mt-3">{fact.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pp-panel" id="citations">
          <div className="pp-label">Research trail</div>
          <h2 className="pp-heading mt-3 text-4xl">Official docs behind the overhaul.</h2>
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

        <section className="pp-panel">
          <div className="pp-label">Project identity</div>
          <h2 className="pp-heading mt-3 text-4xl">
            Built by Shreyam Adhikari, with upstream thanks.
          </h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[28px] border border-pp-border bg-white/75 p-5">
              <div className="font-semibold text-pp-ink">Independent project</div>
              <p className="pp-muted mt-3">
                ProtoPeek is the current project identity, release path, and public brand. The site,
                docs, and GitHub Pages footprint are now built around `protopeek` and `pp`.
              </p>
              <a
                className="pp-button-secondary mt-4 inline-flex"
                href="https://shreyam1008.com.np/"
                rel="noreferrer"
                target="_blank"
              >
                Visit shreyam1008.com.np
                <SquareArrowOutUpRight className="size-4" />
              </a>
            </div>
            <div className="rounded-[28px] border border-pp-border bg-white/75 p-5">
              <div className="font-semibold text-pp-ink">Upstream thanks</div>
              <p className="pp-muted mt-3">
                This repository started from `grpcui`. ProtoPeek keeps a small thank-you to that
                upstream while moving forward as its own transport-first gRPC product.
              </p>
              <a
                className="pp-button-secondary mt-4 inline-flex"
                href="https://github.com/fullstorydev/grpcui"
                rel="noreferrer"
                target="_blank"
              >
                View grpcui upstream
                <SquareArrowOutUpRight className="size-4" />
              </a>
            </div>
          </div>
        </section>
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

function ProblemPoint({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[24px] border border-pp-border bg-white/75 p-4">
      <div className="font-semibold text-pp-ink">{title}</div>
      <p className="pp-muted mt-2">{body}</p>
    </div>
  );
}

function BenchmarkCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[24px] border border-pp-border bg-white/75 p-4">
      <div className="font-semibold text-pp-ink">{title}</div>
      <p className="pp-muted mt-2">{body}</p>
    </div>
  );
}

function ProtocolCard({
  icon: Icon,
  title,
  body,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[28px] border border-pp-border bg-white/75 p-5">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-pp-brand/10 text-pp-brand">
        <Icon className="size-5" />
      </div>
      <div className="mt-4 text-lg font-semibold text-pp-ink">{title}</div>
      <p className="pp-muted mt-3">{body}</p>
    </div>
  );
}

function ArchitectureCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[24px] border border-pp-border bg-[#f6fbfb] p-4">
      <div className="font-semibold text-pp-ink">{title}</div>
      <ul className="mt-3 space-y-3 text-sm leading-7 text-pp-ink">
        {items.map((item) => (
          <li className="flex items-start gap-3" key={item}>
            <ArrowRight className="mt-1 size-4 shrink-0 text-pp-brand" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

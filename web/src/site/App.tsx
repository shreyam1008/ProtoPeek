import {
  ArrowRight,
  Check,
  Copy,
  Download,
  LayoutDashboard,
  Menu,
  Network,
  Server,
  Settings2,
  ShieldCheck,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';

const siteNavigation = [
  { href: '#product', label: 'Product' },
  { href: '/downloader/', label: 'Downloader' },
  { href: '#screenshots', label: 'Screenshots' },
  { href: '#development', label: 'Development build' },
  { href: '#install', label: 'Install' },
] as const;

const suiteAreas = [
  {
    name: 'Overview',
    description: 'Start from one local home with recent evidence and explicit target inspection.',
    icon: LayoutDashboard,
  },
  {
    name: 'Protocols',
    description: 'Keep gRPC and HTTP in native workbenches instead of flattening their evidence.',
    icon: Server,
  },
  {
    name: 'Network',
    description: 'Separate DNS, routes, Linux path probes, private discovery, and logical maps.',
    icon: Network,
  },
  {
    name: 'Downloader',
    description: 'Queue and verify HTTP(S) transfers through configured or system aria2c.',
    icon: Download,
  },
  {
    name: 'Security',
    description: 'Inspect disclosed domain history and one consented public website response.',
    icon: ShieldCheck,
  },
  {
    name: 'Settings',
    description: 'Keep appearance and presentation preferences local to this browser profile.',
    icon: Settings2,
  },
] as const;

const verifiedScreenshots = [
  {
    src: '/assets/protopeek-downloader-development.jpg',
    alt: 'ProtoPeek current development Downloader desktop with two completed local aria2 transfers and selected expected SHA-256 evidence',
    width: 1487,
    height: 1058,
    label: 'Downloader · development desktop',
    caption:
      'Real Chrome capture of the current unreleased source using system aria2: two completed local transfers, with expected SHA-256 enforcement on the selected transfer. Not stable v0.4.0.',
    layout: 'md:col-span-2',
  },
  {
    src: '/assets/protopeek-downloader-development-mobile.jpg',
    alt: 'ProtoPeek current development Downloader queue at a 390 by 844 responsive viewport',
    width: 390,
    height: 844,
    label: 'Downloader · development mobile',
    caption:
      'Real Chrome capture of the current unreleased source at 390 × 844 with the local Downloader running and two completed transfers. Not stable v0.4.0.',
    layout: 'md:col-span-1',
  },
  {
    src: '/assets/protopeek-dashboard-dark.png',
    alt: 'ProtoPeek v0.3 Protocol Peek dashboard in the persisted dark theme',
    width: 1600,
    height: 913,
    label: 'Desktop · dark',
    caption: 'Real local Chrome capture of the v0.3.0 dashboard in its persisted dark theme.',
    layout: 'md:col-span-3',
  },
  {
    src: '/assets/protopeek-dashboard.png',
    alt: 'ProtoPeek v0.3 Protocol Peek dashboard with gRPC, HTTP, scan, next-hop, and roadmap surfaces',
    width: 1600,
    height: 1000,
    label: 'Desktop · light',
    caption: 'Real local headless Chrome capture of the v0.3.0 light-first dashboard.',
    layout: 'md:col-span-2',
  },
  {
    src: '/assets/protopeek-dashboard-mobile.png',
    alt: 'ProtoPeek v0.3 Protocol Peek dashboard at a 390 by 844 mobile viewport',
    width: 390,
    height: 844,
    label: 'Mobile · 390 × 844',
    caption: 'Real local headless Chrome capture of the v0.3.0 dashboard at its mobile viewport.',
    layout: 'md:col-span-1',
  },
] as const;

const stableInstallCommands = [
  {
    label: 'Homebrew',
    command: 'brew install shreyam1008/tap/protopeek',
  },
  {
    label: 'Scoop',
    command:
      'scoop bucket add shreyam https://github.com/shreyam1008/scoop-bucket; scoop install shreyam/protopeek',
  },
  {
    label: 'Unix',
    command:
      'curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh',
  },
  {
    label: 'PowerShell',
    command: 'irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex',
  },
] as const;

export function App() {
  return (
    <div className="min-h-screen bg-pp-bg">
      <Nav />
      <main className="mx-auto max-w-6xl px-5 pb-16 sm:px-6">
        <Hero />
        <SuiteAreas />
        <ScreenshotGallery />
        <DevelopmentBuild />
        <Install />
        <Footer />
      </main>
    </div>
  );
}

function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement | null>(null);

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
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <a className="flex min-w-0 items-center gap-2" href="#top" aria-label="ProtoPeek home">
          <ProtoPeekMark />
          <span>
            <strong className="block text-sm tracking-tight text-pp-ink">ProtoPeek</strong>
            <small className="hidden font-mono text-[0.62rem] text-pp-muted sm:block">
              local systems workbench
            </small>
          </span>
        </a>

        <div className="hidden items-center gap-5 md:flex">
          {siteNavigation.map((link) => (
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
            <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
          </a>
        </div>

        <button
          ref={mobileToggleRef}
          type="button"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-pp-border bg-white text-pp-ink shadow-sm transition hover:border-pp-brand md:hidden"
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
        className="absolute inset-x-0 top-full border-b border-pp-border bg-white px-5 py-3 shadow-lg md:hidden"
        hidden={!mobileOpen}
      >
        <div className="mx-auto grid max-w-6xl gap-1">
          {siteNavigation.map((link) => (
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
    <section
      id="top"
      className="grid gap-8 border-b border-pp-border py-14 lg:grid-cols-[1fr_auto] lg:items-end lg:py-20"
    >
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-pp-brand">
          Stable v0.4.0 · unified suite in development
        </p>
        <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-[-0.045em] text-pp-ink sm:text-5xl lg:text-6xl">
          One local workbench for the path from request to system.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-pp-muted sm:text-lg">
          Stable v0.4.0 handles native gRPC, HTTP, and bounded network evidence. The current source
          adds a six-area shell, Downloader, Security evidence, and local Settings; those additions
          are unreleased until the next tagged version.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 lg:max-w-64 lg:justify-end">
        <a className="pp-button-primary" href="#install">
          <Download className="size-4" aria-hidden="true" />
          Install stable
        </a>
        <a
          className="pp-button-secondary"
          href="https://github.com/shreyam1008/ProtoPeek"
          target="_blank"
          rel="noreferrer"
        >
          Current source
          <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

function SuiteAreas() {
  return (
    <section id="product" className="py-14 sm:py-16" aria-labelledby="suite-title">
      <SectionHeading
        id="suite-title"
        title="Six areas. One explicit local shell."
        description="This information architecture describes the current development source, not the published v0.4.0 interface. Every active operation stays visible and user-triggered."
      />

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-pp-border bg-pp-border sm:grid-cols-2 lg:grid-cols-3">
        {suiteAreas.map((area) => (
          <article key={area.name} className="flex gap-4 bg-white p-5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pp-brand/10 text-pp-brand">
              <area.icon className="size-4.5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-pp-ink">{area.name}</h3>
              <p className="mt-1 text-sm leading-relaxed text-pp-muted">{area.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ScreenshotGallery() {
  return (
    <section
      id="screenshots"
      className="border-t border-pp-border py-14 sm:py-16"
      aria-labelledby="screenshots-title"
    >
      <SectionHeading
        id="screenshots-title"
        title="Verified product captures."
        description="Every capture is recorded in the repository manifest. The Downloader pair shows current unreleased source—not stable v0.4.0—while the remaining three are versioned v0.3.0 dashboard captures."
      />

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {verifiedScreenshots.map((screenshot) => (
          <ScreenshotFigure key={screenshot.src} screenshot={screenshot} />
        ))}
      </div>
    </section>
  );
}

function ScreenshotFigure({ screenshot }: { screenshot: (typeof verifiedScreenshots)[number] }) {
  return (
    <figure
      className={`flex flex-col overflow-hidden rounded-xl border border-neutral-800 bg-[#071017] shadow-xl ${screenshot.layout}`}
    >
      <img
        src={screenshot.src}
        alt={screenshot.alt}
        width={screenshot.width}
        height={screenshot.height}
        loading="lazy"
        decoding="async"
        className="block max-h-[42rem] w-full flex-1 object-contain object-top"
      />
      <figcaption className="border-t border-white/10 px-4 py-3 text-xs leading-relaxed text-neutral-400">
        <strong className="mr-2 font-semibold text-neutral-200">{screenshot.label}</strong>
        {screenshot.caption}
      </figcaption>
    </figure>
  );
}

function DevelopmentBuild() {
  return (
    <section
      id="development"
      className="border-t border-pp-border py-14 sm:py-16"
      aria-labelledby="development-title"
    >
      <SectionHeading
        id="development-title"
        title="What is available in the current source build."
        description="Downloader and Security are implemented development surfaces. They are not part of stable v0.4.0 and should not be advertised as published package features yet."
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <article className="min-w-0 border-l-2 border-pp-brand pl-5">
          <div className="flex items-center gap-3">
            <Download className="size-5 text-pp-brand" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-pp-ink">Downloader</h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-pp-muted">
            ProtoPeek uses an explicitly configured or system-installed <code>aria2c</code>. It does
            not bundle aria2. The local UI starts the engine only when requested and exposes queue,
            progress, pause, resume, retry, cancel, destination, and optional SHA-256 evidence.
          </p>
          <div className="mt-4 rounded-lg border border-neutral-800 bg-[#0d1117] p-4">
            <code className="block overflow-x-auto whitespace-nowrap font-mono text-sm text-emerald-400">
              pp download [--output NAME] [--sha256 64_HEX] URL
            </code>
            <p className="mt-2 text-xs leading-relaxed text-neutral-400">
              One-shot CLI: owns its local engine session, reports progress on stderr, prints the
              completed path on stdout, and preserves partial data plus the aria2 session when
              interrupted. It does not attach to an already-running browser process.
            </p>
          </div>
          <a
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-pp-brand hover:underline"
            href="/downloader/"
          >
            Open the Downloader product page
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </article>

        <article className="min-w-0 border-l-2 border-pp-brand pl-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-pp-brand" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-pp-ink">Security evidence</h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-pp-muted">
            Historical certificate-name lookup runs only after an explicit disclosure that the
            registrable domain is sent to <code>crt.name</code>. Returned names are historical
            candidates; ProtoPeek does not automatically resolve or probe them.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-pp-muted">
            A separate opt-in sends exactly one credential-free, non-following public
            <code> HEAD</code> request. ProtoPeek resolves and pins public addresses, verifies TLS
            for HTTPS, reads no body, and records bounded DNS, TLS, HTTP, and timing evidence. It
            emits no security score and makes no universal vulnerability verdict.
          </p>
        </article>
      </div>
    </section>
  );
}

function Install() {
  return (
    <section
      id="install"
      className="border-t border-pp-border py-14 sm:py-16"
      aria-labelledby="install-title"
    >
      <SectionHeading
        id="install-title"
        title="Install stable v0.4.0."
        description="The verified release resolvers and owned Homebrew and Scoop channels use the published v0.4.0 archives. The unified development additions above require the current source until a later release exists."
      />

      <div className="mt-8 grid gap-3">
        {stableInstallCommands.map((option) => (
          <InstallCommand key={option.label} option={option} />
        ))}
      </div>

      <p className="mt-5 text-center text-sm leading-relaxed text-pp-muted">
        Run <code className="font-semibold text-pp-ink">pp</code> for the local dashboard or pass an
        exact <code className="font-semibold text-pp-ink">host:port</code> for direct gRPC mode.
        Read the{' '}
        <a className="text-pp-brand hover:underline" href="/docs/">
          published docs
        </a>{' '}
        or inspect the{' '}
        <a
          className="text-pp-brand hover:underline"
          href="https://github.com/shreyam1008/ProtoPeek"
          target="_blank"
          rel="noreferrer"
        >
          current source
        </a>{' '}
        for development-build setup.
      </p>
    </section>
  );
}

function InstallCommand({ option }: { option: (typeof stableInstallCommands)[number] }) {
  const commandRef = useRef<HTMLInputElement | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');

  function selectForManualCopy() {
    commandRef.current?.focus();
    commandRef.current?.select();
    setCopyState('manual');
  }

  async function copyCommand() {
    setCopyState('idle');
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      selectForManualCopy();
      return;
    }

    try {
      await clipboard.writeText(option.command);
      setCopyState('copied');
    } catch {
      selectForManualCopy();
    }
  }

  return (
    <div className="min-w-0 rounded-xl border border-neutral-800 bg-[#0d1117] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-neutral-400">
          {option.label}
        </span>
        <input
          ref={commandRef}
          type="text"
          readOnly
          value={option.command}
          aria-label={`${option.label} install command`}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-emerald-400 outline-none selection:bg-emerald-400/30"
        />
        <button
          type="button"
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-neutral-400 transition hover:bg-white/10 hover:text-white"
          onClick={() => void copyCommand()}
          aria-label={
            copyState === 'copied'
              ? `${option.label} command copied`
              : `Copy ${option.label} command`
          }
        >
          {copyState === 'copied' ? (
            <>
              <Check className="size-4" aria-hidden="true" /> Copied
            </>
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {copyState === 'manual' ? (
        <p className="mt-2 text-xs text-amber-300" role="alert">
          Clipboard unavailable. The command is selected; press Ctrl/Cmd+C to copy it.
        </p>
      ) : null}
    </div>
  );
}

function Footer() {
  return (
    <footer className="flex flex-col gap-4 border-t border-pp-border py-8 text-sm text-pp-muted sm:flex-row sm:items-center sm:justify-between">
      <p>
        ProtoPeek by{' '}
        <a
          className="text-pp-brand hover:underline"
          href="https://shreyam1008.com.np/"
          target="_blank"
          rel="noreferrer"
        >
          Shreyam Adhikari
        </a>
      </p>
      <div className="flex flex-wrap gap-4">
        <a className="hover:text-pp-ink" href="/docs/">
          Docs
        </a>
        <a className="hover:text-pp-ink" href="/man/protopeek.1">
          Man page
        </a>
        <a
          className="inline-flex items-center gap-1 hover:text-pp-ink"
          href="https://github.com/shreyam1008/ProtoPeek"
          target="_blank"
          rel="noreferrer"
        >
          Source <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
        </a>
      </div>
    </footer>
  );
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,0.85fr)_minmax(20rem,1fr)] md:items-end md:gap-10">
      <h2 id={id} className="text-2xl font-bold tracking-tight text-pp-ink sm:text-3xl">
        {title}
      </h2>
      <p className="text-sm leading-relaxed text-pp-muted md:text-right">{description}</p>
    </div>
  );
}

function ProtoPeekMark() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pp-brand text-[#07151b]">
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
  );
}

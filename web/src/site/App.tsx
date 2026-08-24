import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  Menu,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';

const siteNavigation = [
  { href: '#product', label: 'Product' },
  { href: '/docs/', label: 'Guides' },
  { href: '#install', label: 'Download' },
] as const;

const productQuestions = [
  {
    question: 'Can I reach this service?',
    answer: 'Call gRPC or HTTP and see exactly what came back.',
    action: 'Open API guides',
    href: '/docs/',
  },
  {
    question: 'Why is this request slow?',
    answer: 'Check DNS, routes, hops, and timing in one path.',
    action: 'Trace the path',
    href: '/network-workbench/',
  },
  {
    question: 'What can I verify about this public website?',
    answer: 'See DNS, TLS, and response-header evidence when you ask.',
    action: 'See safety limits',
    href: '/transport-boundaries/',
  },
  {
    question: 'What is happening on this computer?',
    answer: 'Current-source preview: listeners, connections, IPs, and bounded speed evidence.',
    action: 'Preview This PC',
    href: '/this-pc/',
  },
  {
    question: 'Can I manage this download locally?',
    answer: 'Queue, pause, resume, and verify HTTP(S) transfers.',
    action: 'Meet Downloader',
    href: '/downloader/',
  },
] as const;

const verifiedScreenshots = [
  {
    src: '/assets/protopeek-downloader-development-mobile.jpg',
    alt: 'ProtoPeek v0.5.0 Downloader queue at a 390 by 844 responsive viewport',
    width: 390,
    height: 844,
    label: 'Downloader · v0.5.0 mobile',
  },
  {
    src: '/assets/protopeek-dashboard-dark.png',
    alt: 'Historical ProtoPeek v0.3.0 systems dashboard in its persisted dark theme',
    width: 1600,
    height: 913,
    label: 'Historical overview · v0.3.0 capture',
  },
] as const;

const installOptions = [
  {
    id: 'macos',
    label: 'macOS',
    command: 'brew install shreyam1008/tap/protopeek',
  },
  {
    id: 'linux',
    label: 'Linux',
    command:
      'curl -fsSL https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.sh | sh',
  },
  {
    id: 'windows',
    label: 'Windows',
    command: 'irm https://raw.githubusercontent.com/shreyam1008/ProtoPeek/master/install.ps1 | iex',
  },
] as const;

type InstallOption = (typeof installOptions)[number];

export function App() {
  return (
    <div className="min-h-screen bg-white text-[#0a0a0a]">
      <Nav />
      <main>
        <Hero />
        <ProductQuestions />
        <Evidence />
        <Install />
        <Privacy />
      </main>
      <Footer />
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
      className="sticky top-0 z-50 border-b border-black/10 bg-white/95 backdrop-blur-xl"
      aria-label="Primary"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !mobileOpen) return;
        event.preventDefault();
        closeMobileNavigation();
        mobileToggleRef.current?.focus();
      }}
    >
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
        <a className="flex min-w-0 items-center gap-2.5" href="#top" aria-label="ProtoPeek home">
          <ProtoPeekMark />
          <strong className="text-sm tracking-[-0.02em]">ProtoPeek</strong>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {siteNavigation.map((link) => (
            <a
              key={link.href}
              className="text-sm text-neutral-600 transition-colors hover:text-black motion-reduce:transition-none"
              href={link.href}
            >
              {link.label}
            </a>
          ))}
          <a
            className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 transition-colors hover:text-black motion-reduce:transition-none"
            href="https://github.com/shreyam1008/ProtoPeek"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
            <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>

        <button
          ref={mobileToggleRef}
          type="button"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-black/15 bg-white text-black transition-colors hover:bg-neutral-100 motion-reduce:transition-none md:hidden"
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
        className="absolute inset-x-0 top-full border-b border-black/10 bg-white px-5 py-3 shadow-xl md:hidden"
        hidden={!mobileOpen}
      >
        <div className="mx-auto grid max-w-7xl gap-1">
          {siteNavigation.map((link) => (
            <a
              key={link.href}
              className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
              href={link.href}
              onClick={closeMobileNavigation}
            >
              {link.label}
            </a>
          ))}
          <a
            className="flex min-h-11 items-center justify-between rounded-lg px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
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
      className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(30rem,1.1fr)] lg:items-center lg:px-12 lg:py-28"
      aria-labelledby="hero-title"
    >
      <div>
        <h1
          id="hero-title"
          className="max-w-3xl text-5xl font-semibold leading-[0.96] tracking-[-0.06em] text-balance sm:text-6xl lg:text-7xl"
        >
          See what your system is doing.
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-neutral-600 sm:text-xl">
          Inspect APIs, trace network paths, check a website, and manage downloads — locally.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0b5cff] px-5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none"
            href="#install"
          >
            <Download className="size-4" aria-hidden="true" />
            Get ProtoPeek
          </a>
          <a
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/15 bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-neutral-100 motion-reduce:transition-none"
            href="#product"
          >
            See how it works
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </div>
        <p className="mt-5 flex items-center gap-2 text-sm text-neutral-500">
          <span className="size-1.5 rounded-full bg-[#f4a313]" aria-hidden="true" />
          Local-first. No account.
        </p>
      </div>

      <figure className="min-w-0 overflow-hidden rounded-2xl border border-neutral-800 bg-[#0b1118] p-2 shadow-2xl shadow-blue-950/15 sm:p-3">
        <div className="flex items-center gap-1.5 px-1 pb-2 sm:px-2 sm:pb-3" aria-hidden="true">
          <span className="size-2 rounded-full bg-[#ff6258]" />
          <span className="size-2 rounded-full bg-[#f4a313]" />
          <span className="size-2 rounded-full bg-[#30c775]" />
          <span className="ml-auto font-mono text-[0.62rem] uppercase tracking-[0.14em] text-neutral-500">
            local session
          </span>
        </div>
        <img
          src="/assets/protopeek-downloader-development.jpg"
          alt="ProtoPeek v0.5.0 Downloader with completed local aria2 transfers and SHA-256 evidence"
          width="1487"
          height="1058"
          decoding="async"
          fetchPriority="high"
          className="block w-full rounded-lg border border-white/10"
        />
        <figcaption className="px-2 pb-1 pt-3 text-xs text-neutral-400">
          Stable v0.5.0 capture · Local transfers with visible progress and integrity evidence.
        </figcaption>
      </figure>
    </section>
  );
}

function ProductQuestions() {
  return (
    <section
      id="product"
      className="scroll-mt-20 border-t border-black/10"
      aria-labelledby="product-title"
    >
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24 lg:px-12">
        <div className="max-w-3xl">
          <h2 id="product-title" className="text-3xl font-semibold tracking-[-0.045em] sm:text-5xl">
            Start with a question.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-neutral-600 sm:text-lg">
            Pick the thing you are trying to understand. ProtoPeek keeps the evidence together.
          </p>
        </div>

        <div className="mt-10 border-t border-black/15">
          {productQuestions.map((item, index) => (
            <article
              key={item.question}
              className="group grid gap-4 border-b border-black/15 py-6 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(15rem,0.8fr)_auto] sm:items-center sm:gap-6"
            >
              <span className="font-mono text-xs text-neutral-400" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
                {item.question}
              </h3>
              <p className="text-sm leading-relaxed text-neutral-600 sm:text-base">{item.answer}</p>
              <a
                className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-semibold text-[#0b5cff] sm:justify-self-end"
                href={item.href}
              >
                {item.action}
                <ChevronRight
                  className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Evidence() {
  return (
    <section
      id="screenshots"
      className="scroll-mt-20 bg-[#0b1118] text-white"
      aria-labelledby="evidence-title"
    >
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24 lg:px-12">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.8fr)] lg:items-end">
          <h2
            id="evidence-title"
            className="max-w-3xl text-4xl font-semibold leading-none tracking-[-0.05em] sm:text-6xl"
          >
            One workbench. Real evidence.
          </h2>
          <p className="max-w-xl text-base leading-relaxed text-neutral-400 lg:justify-self-end">
            Requests, routes, listeners, certificates, downloads, and timing stay together.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {verifiedScreenshots.map((screenshot) => (
            <figure key={screenshot.src} className="min-w-0">
              <div className="overflow-hidden rounded-xl border border-white/15 bg-black shadow-2xl shadow-black/30">
                <img
                  src={screenshot.src}
                  alt={screenshot.alt}
                  width={screenshot.width}
                  height={screenshot.height}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[16/10] w-full object-cover object-top"
                />
              </div>
              <figcaption className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-neutral-500">
                {screenshot.label}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function Install() {
  const [activeId, setActiveId] = useState<InstallOption['id']>('macos');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const commandRef = useRef<HTMLInputElement | null>(null);
  const activeOption = installOptions.find((option) => option.id === activeId) ?? installOptions[0];

  function selectOption(option: InstallOption) {
    setActiveId(option.id);
    setCopyState('idle');
  }

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
      await clipboard.writeText(activeOption.command);
      setCopyState('copied');
    } catch {
      selectForManualCopy();
    }
  }

  return (
    <section
      id="install"
      className="scroll-mt-20 border-b border-black/10"
      aria-labelledby="install-title"
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,0.75fr)_minmax(30rem,1.25fr)] lg:items-center lg:gap-20 lg:px-12">
        <div>
          <h2
            id="install-title"
            className="text-4xl font-semibold leading-none tracking-[-0.05em] sm:text-6xl"
          >
            Ready when you are.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-neutral-600">
            One command. One local page.
          </p>
          <a
            className="mt-7 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#0b5cff]"
            href="/docs/"
          >
            Other install options
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </div>

        <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-[#0b1118] text-white shadow-2xl shadow-blue-950/10">
          <fieldset className="flex gap-1 overflow-x-auto border-b border-white/10 px-4 pt-4 sm:px-6">
            <legend className="sr-only">Operating system</legend>
            {installOptions.map((option) => {
              const selected = option.id === activeOption.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors motion-reduce:transition-none ${
                    selected
                      ? 'border-[#7da7ff] text-white'
                      : 'border-transparent text-neutral-500 hover:text-neutral-200'
                  }`}
                  onClick={() => selectOption(option)}
                >
                  {option.label}
                </button>
              );
            })}
          </fieldset>

          <div id="install-command-panel" className="p-4 sm:p-6">
            <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-white/10 bg-black/30 p-3 sm:flex-row sm:items-center">
              <input
                ref={commandRef}
                type="text"
                readOnly
                value={activeOption.command}
                aria-label={`${activeOption.label} install command`}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs leading-relaxed text-[#87e3ae] outline-none selection:bg-emerald-400/30 sm:text-sm"
              />
              <button
                type="button"
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-semibold text-neutral-300 transition-colors hover:bg-white/10 hover:text-white motion-reduce:transition-none"
                onClick={() => void copyCommand()}
                aria-label={
                  copyState === 'copied'
                    ? `${activeOption.label} command copied`
                    : `Copy ${activeOption.label} command`
                }
              >
                {copyState === 'copied' ? (
                  <>
                    <Check className="size-4" aria-hidden="true" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-4" aria-hidden="true" /> Copy command
                  </>
                )}
              </button>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-neutral-500" aria-live="polite">
              {copyState === 'manual'
                ? 'Clipboard unavailable. The command is selected; press Ctrl/Cmd+C to copy it.'
                : 'Installs stable ProtoPeek v0.5.0. Downloader uses your system aria2c.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <section id="privacy" aria-labelledby="privacy-title">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,0.8fr)] lg:items-center lg:gap-20 lg:px-12">
        <div>
          <h2
            id="privacy-title"
            className="max-w-3xl text-4xl font-semibold leading-none tracking-[-0.05em] sm:text-6xl"
          >
            Your machine stays yours.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-neutral-600">
            ProtoPeek opens locally. External checks run only when you ask.
          </p>
        </div>

        <ul className="border-t border-black/15" aria-label="Privacy boundaries">
          {['No account', 'No ProtoPeek cloud sync', 'Clear consent before external checks'].map(
            (boundary) => (
              <li
                key={boundary}
                className="flex items-center gap-3 border-b border-black/15 py-5 text-base font-medium"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-[#0b5cff]/10 text-[#0b5cff]">
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
                {boundary}
              </li>
            )
          )}
        </ul>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-black/10 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 text-sm text-neutral-500 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
        <p>
          ProtoPeek · Built by{' '}
          <a
            className="text-neutral-800 hover:underline"
            href="https://shreyam1008.com.np/"
            target="_blank"
            rel="noreferrer"
          >
            Shreyam Adhikari
          </a>
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <a className="hover:text-black" href="/docs/">
            Guides
          </a>
          <a className="hover:text-black" href="#install">
            Download
          </a>
          <a
            className="hover:text-black"
            href="https://github.com/shreyam1008/ProtoPeek/releases/tag/v0.5.0"
            target="_blank"
            rel="noreferrer"
          >
            Release notes
          </a>
          <a
            className="inline-flex items-center gap-1 hover:text-black"
            href="https://github.com/shreyam1008/ProtoPeek"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
          </a>
        </div>
      </div>
    </footer>
  );
}

function ProtoPeekMark() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0b5cff] text-white">
      <svg viewBox="0 0 32 32" className="size-5" aria-hidden="true">
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

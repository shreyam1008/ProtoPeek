import { Link } from '@tanstack/react-router';
import {
  Activity,
  ArrowRight,
  CircleAlert,
  Clock3,
  Globe2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Network,
  Radar,
  Route,
  Search,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { type FormEvent, lazy, Suspense, useEffect, useId, useRef, useState } from 'react';

import {
  type DomainCandidatesResult,
  fetchDomainCandidates,
  fetchWebsiteObservation,
  normalizeDomainHost,
  normalizeWebsiteURL,
  type WebsiteObservationResult,
} from './security-api';
import './security.css';

type SearchPhase = 'idle' | 'loading' | 'success' | 'error' | 'cancelled';

const WebsiteEvidenceReport = lazy(() => import('./WebsiteEvidenceReport'));

const evidenceTools = [
  {
    title: 'DNS evidence',
    detail: 'See resolution answers and the address pinned for a measured path run.',
    action: 'Open DNS evidence',
    to: '/network/path' as const,
    icon: Globe2,
  },
  {
    title: 'Next-hop route',
    detail: 'Read the kernel-selected source, interface, gateway, prefix, metric, and table.',
    action: 'Open route evidence',
    to: '/network/route' as const,
    icon: Route,
  },
  {
    title: 'Measured path',
    detail: 'Run an explicit bounded hop trace with source-to-responder RTT evidence.',
    action: 'Open network path',
    to: '/network/path' as const,
    icon: Network,
  },
  {
    title: 'Local discovery',
    detail: 'Inspect an authorized private /24-or-smaller plan with selected ports only.',
    action: 'Open local discovery',
    to: '/network/local' as const,
    icon: Radar,
  },
] as const;

const observedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

function observedAtLabel(value: string) {
  return observedAtFormatter.format(new Date(value));
}

function timingLabel(value: number | null) {
  if (value === null) return 'Not observed';
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
}

export function Security() {
  const inputID = useId();
  const disclosureID = useId();
  const [host, setHost] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [phase, setPhase] = useState<SearchPhase>('idle');
  const [result, setResult] = useState<DomainCandidatesResult | null>(null);
  const [message, setMessage] = useState('');
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      const controller = controllerRef.current;
      controllerRef.current = null;
      controller?.abort();
    },
    []
  );

  function changeHost(value: string) {
    setHost(value);
    setAcknowledged(false);
    setResult(null);
    setMessage('');
    setPhase('idle');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === 'loading') return;
    let normalizedHost: string;
    try {
      normalizedHost = normalizeDomainHost(host);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Enter a valid domain or host.');
      setPhase('error');
      return;
    }
    if (!acknowledged) {
      setMessage('Acknowledge the crt.name disclosure before this lookup.');
      setPhase('error');
      return;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setHost(normalizedHost);
    setAcknowledged(false);
    setResult(null);
    setMessage('');
    setPhase('loading');
    try {
      const next = await fetchDomainCandidates(normalizedHost, controller.signal);
      if (controllerRef.current !== controller) return;
      setResult(next);
      setPhase('success');
    } catch (cause) {
      if (controllerRef.current !== controller) return;
      if (cause instanceof Error && cause.name === 'AbortError') {
        setMessage('Lookup cancelled. No returned name was resolved or probed.');
        setPhase('cancelled');
      } else {
        setMessage(
          cause instanceof Error ? cause.message : 'Historical names could not be loaded.'
        );
        setPhase('error');
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function cancel() {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
    setAcknowledged(false);
    setMessage('Lookup cancelled. No returned name was resolved or probed.');
    setPhase('cancelled');
  }

  return (
    <div className="pp-security">
      <header className="pp-security-heading">
        <div>
          <span className="pp-security-kicker">Passive domain intelligence</span>
          <h1>Security</h1>
          <p>Collect bounded evidence first. ProtoPeek does not invent a vulnerability verdict.</p>
        </div>
        <div className="pp-security-local">
          <ShieldCheck aria-hidden="true" />
          <span>
            <strong>Local control</strong>
            <small>Every external operation is explicit</small>
          </span>
        </div>
      </header>

      <section className="pp-security-query" aria-labelledby="domain-query-title">
        <header>
          <div className="pp-security-boundary-item">
            <span>Certificate-name source</span>
            <h2 id="domain-query-title">Find historical names for a domain</h2>
          </div>
          <span className="pp-security-passive-state">Passive · no candidate probing</span>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor={inputID}>Apex or host</label>
          <div className="pp-security-query-row">
            <input
              id={inputID}
              value={host}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={1024}
              disabled={phase === 'loading'}
              placeholder="www.example.com"
              aria-describedby={disclosureID}
              onChange={(event) => changeHost(event.currentTarget.value)}
            />
            {phase === 'loading' ? (
              <button type="button" className="pp-security-cancel" onClick={cancel}>
                <Square aria-hidden="true" /> Cancel lookup
              </button>
            ) : (
              <button type="submit" disabled={!host.trim() || !acknowledged}>
                <Search aria-hidden="true" /> Find historical names
              </button>
            )}
          </div>
          <label className="pp-security-disclosure" htmlFor={`${inputID}-disclosure`}>
            <input
              id={`${inputID}-disclosure`}
              type="checkbox"
              checked={acknowledged}
              disabled={phase === 'loading'}
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
            />
            <span id={disclosureID}>
              <strong>Send this registrable domain to crt.name for this operation.</strong>
              <small>
                Only the apex, such as example.com, leaves ProtoPeek. Returned historical names are
                listed here without DNS resolution, port checks, or requests.
              </small>
            </span>
          </label>
        </form>
      </section>

      <div className="pp-security-workspace" aria-busy={phase === 'loading'}>
        <section className="pp-security-results" aria-labelledby="domain-results-title">
          <header>
            <div>
              <span>Historical certificate evidence</span>
              <h2 id="domain-results-title">Domain candidates</h2>
            </div>
            {result ? (
              <span>
                {result.candidates.length} retained{result.cached ? ' · cached' : ''}
              </span>
            ) : null}
          </header>

          {phase === 'idle' ? (
            <div className="pp-security-empty">
              <ShieldCheck aria-hidden="true" />
              <h3>Nothing runs on page load.</h3>
              <p>Enter a host, review the disclosure, then start one bounded lookup.</p>
            </div>
          ) : null}
          {phase === 'loading' ? (
            <div className="pp-security-empty" role="status" aria-live="polite">
              <LoaderCircle className="is-spinning" aria-hidden="true" />
              <h3>Asking crt.name for historical names…</h3>
              <p>The checkbox is reset. Another lookup will require a fresh acknowledgement.</p>
            </div>
          ) : null}
          {phase === 'error' ? (
            <div className="pp-security-message is-error" role="alert">
              <CircleAlert aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {phase === 'cancelled' ? (
            <div className="pp-security-message" role="status" aria-live="polite">
              <Square aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {phase === 'success' && result ? <CandidateResult result={result} /> : null}
        </section>

        <aside className="pp-security-boundary" aria-labelledby="evidence-boundary-title">
          <header>
            <span>Interpretation boundary</span>
            <h2 id="evidence-boundary-title">What this evidence means</h2>
          </header>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>crt.name historical certificate-name index</dd>
            </div>
            <div>
              <dt>Observed</dt>
              <dd>{result ? observedAtLabel(result.observedAt) : 'After an explicit lookup'}</dd>
            </div>
            <div>
              <dt>Network contact</dt>
              <dd>crt.name only; candidate names stay uncontacted</dd>
            </div>
            <div>
              <dt>Conclusion</dt>
              <dd>Candidate names, not proof of a live host, open port, owner, or vulnerability</dd>
            </div>
          </dl>
          <p>
            Wildcards remain patterns. A missing name does not prove that a subdomain never existed
            or does not exist now.
          </p>
        </aside>
      </div>

      <WebsiteObservationPanel />

      <section className="pp-security-evidence" aria-labelledby="security-evidence-title">
        <header>
          <div className="pp-security-boundary-item">
            <span>Available now</span>
            <h2 id="security-evidence-title">Continue with shipped network evidence</h2>
          </div>
          <p>Each tool keeps its own method, scope, timing, and authorization visible.</p>
        </header>
        <div className="pp-security-evidence-grid">
          {evidenceTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link key={tool.title} to={tool.to} className="pp-security-evidence-card">
                <Icon aria-hidden="true" />
                <span>
                  <strong>{tool.title}</strong>
                  <small>{tool.detail}</small>
                </span>
                <em>{tool.action}</em>
                <ArrowRight aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      </section>

      <section className="pp-security-planned" aria-labelledby="security-planned-title">
        <header>
          <span>Not in this build</span>
          <h2 id="security-planned-title">Planned authorized probing</h2>
        </header>
        <div className="pp-security-planned-grid">
          <article>
            <span>Planned</span>
            <strong>Consent-bound website probe plans</strong>
            <p>
              Multi-request public-site plans with a visible method, count, timeout, and stop
              control are not shipped. The observer above remains exactly one HEAD request.
            </p>
          </article>
          <article>
            <span>Planned</span>
            <strong>Selected-port security handoff</strong>
            <p>
              A public-only, user-selected port handoff is not shipped. No login attempts,
              credential testing, exploit checks, or broad scans run from this screen.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}

function WebsiteObservationPanel() {
  const inputID = useId();
  const disclosureID = useId();
  const [url, setURL] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [phase, setPhase] = useState<SearchPhase>('idle');
  const [result, setResult] = useState<WebsiteObservationResult | null>(null);
  const [message, setMessage] = useState('');
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      const controller = controllerRef.current;
      controllerRef.current = null;
      controller?.abort();
    },
    []
  );

  function changeURL(value: string) {
    setURL(value);
    setAcknowledged(false);
    setResult(null);
    setMessage('');
    setPhase('idle');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === 'loading') return;
    let normalizedURL: string;
    try {
      normalizedURL = normalizeWebsiteURL(url);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Enter a valid public website URL.');
      setPhase('error');
      return;
    }
    if (!acknowledged) {
      setMessage('Acknowledge the public HEAD request before this observation.');
      setPhase('error');
      return;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setURL(normalizedURL);
    setAcknowledged(false);
    setResult(null);
    setMessage('');
    setPhase('loading');
    try {
      const next = await fetchWebsiteObservation(normalizedURL, controller.signal);
      if (controllerRef.current !== controller) return;
      setResult(next);
      setPhase('success');
    } catch (cause) {
      if (controllerRef.current !== controller) return;
      if (cause instanceof Error && cause.name === 'AbortError') {
        setMessage('Observation cancelled. No redirect was followed and no body was read.');
        setPhase('cancelled');
      } else {
        setMessage(
          cause instanceof Error ? cause.message : 'Website evidence could not be loaded.'
        );
        setPhase('error');
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function cancel() {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
    setAcknowledged(false);
    setMessage('Observation cancelled. No redirect was followed and no body was read.');
    setPhase('cancelled');
  }

  return (
    <section className="pp-security-website" aria-labelledby="website-observer-title">
      <header>
        <div>
          <span>Available now · active public request</span>
          <h2 id="website-observer-title">Observe one public website response</h2>
          <p>
            Resolve and pin the target, send one credential-free HEAD request, and retain bounded
            DNS, HTTP, TLS, and timing evidence.
          </p>
        </div>
        <span className="pp-security-website-method">1 × HEAD · no redirects · no body</span>
      </header>

      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor={inputID}>Public website URL</label>
        <div className="pp-security-query-row">
          <input
            id={inputID}
            value={url}
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            maxLength={8 * 1024}
            disabled={phase === 'loading'}
            placeholder="https://example.com/"
            aria-describedby={disclosureID}
            onChange={(event) => changeURL(event.currentTarget.value)}
          />
          {phase === 'loading' ? (
            <button type="button" className="pp-security-cancel" onClick={cancel}>
              <Square aria-hidden="true" /> Cancel observation
            </button>
          ) : (
            <button type="submit" disabled={!url.trim() || !acknowledged}>
              <Activity aria-hidden="true" /> Observe website
            </button>
          )}
        </div>
        <label className="pp-security-disclosure" htmlFor={`${inputID}-disclosure`}>
          <input
            id={`${inputID}-disclosure`}
            type="checkbox"
            checked={acknowledged}
            disabled={phase === 'loading'}
            onChange={(event) => setAcknowledged(event.currentTarget.checked)}
          />
          <span id={disclosureID}>
            <strong>Make one public HEAD request from this ProtoPeek host.</strong>
            <small>
              The URL path and this host’s public source address reach the website. ProtoPeek
              rejects queries and credentials, pins ordinary public addresses only, reads no body,
              and does not follow redirects.
            </small>
          </span>
        </label>
      </form>

      <div className="pp-security-website-workspace" aria-busy={phase === 'loading'}>
        <div className="pp-security-website-result">
          {phase === 'idle' ? (
            <div className="pp-security-empty">
              <LockKeyhole aria-hidden="true" />
              <h3>No website request has run.</h3>
              <p>Enter a public URL, review the exact contact boundary, then opt in once.</p>
            </div>
          ) : null}
          {phase === 'loading' ? (
            <div className="pp-security-empty" role="status" aria-live="polite">
              <LoaderCircle className="is-spinning" aria-hidden="true" />
              <h3>Resolving, pinning, and observing one response…</h3>
              <p>The acknowledgement has reset. Redirects and response bodies remain untouched.</p>
            </div>
          ) : null}
          {phase === 'error' ? (
            <div className="pp-security-message is-error" role="alert">
              <CircleAlert aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {phase === 'cancelled' ? (
            <div className="pp-security-message" role="status" aria-live="polite">
              <Square aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {phase === 'success' && result ? (
            <WebsiteObservationResultView
              key={`${result.observedAt}:${result.url}`}
              result={result}
            />
          ) : null}
        </div>

        <aside className="pp-security-website-boundary" aria-label="Website observation boundary">
          <div className="pp-security-boundary-item">
            <KeyRound aria-hidden="true" />
            <span>
              <strong>Credentials</strong>
              <small>URL queries and credentials rejected</small>
            </span>
          </div>
          <div className="pp-security-boundary-item">
            <ArrowRight aria-hidden="true" />
            <span>
              <strong>Redirects</strong>
              <small>Reported, never followed</small>
            </span>
          </div>
          <div className="pp-security-boundary-item">
            <Square aria-hidden="true" />
            <span>
              <strong>Response body</strong>
              <small>Never read</small>
            </span>
          </div>
          <div className="pp-security-boundary-item">
            <ShieldCheck aria-hidden="true" />
            <span>
              <strong>Address policy</strong>
              <small>Ordinary public addresses only</small>
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function WebsiteObservationResultView({ result }: { result: WebsiteObservationResult }) {
  const headers = Object.entries(result.http.headers).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return (
    <div className="pp-security-website-evidence">
      <div className="pp-security-website-summary" role="status" aria-live="polite">
        <span className="pp-security-status-code">{result.http.statusCode}</span>
        <span>
          <strong>{result.http.status}</strong>
          <code>{result.url}</code>
        </span>
        <span>
          {result.method} · {result.http.protocol || 'Protocol not reported'}
          <small>{observedAtLabel(result.observedAt)}</small>
        </span>
      </div>

      <div className="pp-security-observation-grid">
        <article>
          <span>DNS pin</span>
          <strong>{result.dns.hostname}</strong>
          <div className="pp-security-addresses">
            {result.dns.pinnedAddresses.map((address) => (
              <code key={address}>{address}</code>
            ))}
          </div>
          <small>Resolution {timingLabel(result.dns.resolutionMs)}</small>
        </article>

        <article>
          <span>HTTP evidence</span>
          <strong>{result.http.protocol || 'Protocol not reported'}</strong>
          {result.http.redirectLocation ? (
            <p>
              Redirect reported, not followed: <code>{result.http.redirectLocation}</code>
            </p>
          ) : (
            <p>No redirect location was reported.</p>
          )}
          <small>{headers.length} selected header fields retained</small>
        </article>

        <article>
          <span>TLS evidence</span>
          {result.tls ? (
            <>
              <strong>{result.tls.version}</strong>
              <p>{result.tls.cipherSuite}</p>
              <small>
                {result.tls.verifiedChains} verified chain
                {result.tls.verifiedChains === 1 ? '' : 's'} reported
              </small>
            </>
          ) : (
            <>
              <strong>No TLS session</strong>
              <p>The observed URL did not return TLS connection evidence.</p>
            </>
          )}
        </article>

        <article>
          <span>Measured timing</span>
          <strong>{timingLabel(result.timings.totalMs)} total</strong>
          <dl className="pp-security-timings">
            <div className="pp-security-timing">
              <dt>Connect</dt>
              <dd>{timingLabel(result.timings.connectMs)}</dd>
            </div>
            <div className="pp-security-timing">
              <dt>TLS</dt>
              <dd>{timingLabel(result.timings.tlsHandshakeMs)}</dd>
            </div>
            <div className="pp-security-timing">
              <dt>First byte</dt>
              <dd>{timingLabel(result.timings.firstByteMs)}</dd>
            </div>
          </dl>
        </article>
      </div>

      <Suspense
        fallback={
          <div className="pp-security-report-loading" role="status" aria-live="polite">
            Preparing the local HEAD evidence report…
          </div>
        }
      >
        <WebsiteEvidenceReport result={result} />
      </Suspense>

      {result.tls ? (
        <details className="pp-security-tls-detail">
          <summary>Certificate detail</summary>
          <dl>
            <div>
              <dt>Subject</dt>
              <dd>{result.tls.subject}</dd>
            </div>
            <div>
              <dt>Issuer</dt>
              <dd>{result.tls.issuer}</dd>
            </div>
            <div>
              <dt>Validity</dt>
              <dd>
                {observedAtLabel(result.tls.notBefore)} — {observedAtLabel(result.tls.notAfter)}
              </dd>
            </div>
            <div>
              <dt>Server name</dt>
              <dd>{result.tls.serverName || 'Not reported'}</dd>
            </div>
          </dl>
        </details>
      ) : null}

      <details className="pp-security-header-detail">
        <summary>Selected response headers ({headers.length})</summary>
        {headers.length ? (
          <dl>
            {headers.map(([name, values]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{values.join('\n')}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>No selected response header was returned.</p>
        )}
      </details>
    </div>
  );
}

function CandidateResult({ result }: { result: DomainCandidatesResult }) {
  return (
    <div className="pp-security-result">
      <div className="pp-security-result-summary" role="status" aria-live="polite">
        <span>
          <strong>{result.apex}</strong>
          <small>{observedAtLabel(result.observedAt)}</small>
        </span>
        <span>{result.cached ? 'Cached provider result' : 'Fresh provider result'}</span>
      </div>
      {result.truncated ? (
        <p className="pp-security-result-note">
          The bounded result was truncated. No omitted candidate was contacted.
        </p>
      ) : null}
      {result.discarded ? (
        <p className="pp-security-result-note">
          {result.discarded}{' '}
          {result.discarded === 1
            ? 'invalid or out-of-scope provider entry was omitted.'
            : 'invalid or out-of-scope provider entries were omitted.'}
        </p>
      ) : null}
      {result.candidates.length ? (
        <ol
          className="pp-security-candidate-list"
          aria-label={`Historical certificate names for ${result.apex}`}
        >
          {result.candidates.map((candidate, index) => (
            <li key={candidate.name}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <code>{candidate.name}</code>
              <em>{candidate.wildcard ? 'Wildcard pattern' : 'Historical name'}</em>
            </li>
          ))}
        </ol>
      ) : (
        <div className="pp-security-no-results">
          <Clock3 aria-hidden="true" />
          <span>
            <strong>No in-scope names were returned.</strong>
            <small>This is not proof that no current or historical subdomain exists.</small>
          </span>
        </div>
      )}
    </div>
  );
}

import { AlertTriangle, ArrowRight, LoaderCircle, Network, Route, Square } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { classNames } from '@/shared/runtime';

import { lookupRoute, type RouteLookupResponse, type RouteResult } from './api';

export function RoutesWorkbench() {
  const [destination, setDestination] = useState('');
  const [family, setFamily] = useState<'auto' | 'ipv4' | 'ipv6'>('auto');
  const [response, setResponse] = useState<RouteLookupResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  async function handleLookup(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      abortRef.current?.abort();
      return;
    }
    const target = destination.trim();
    if (!target) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setResponse(null);
    try {
      setResponse(await lookupRoute(target, family, controller.signal));
    } catch (reason) {
      setError(
        controller.signal.aborted
          ? 'Route lookup cancelled.'
          : reason instanceof Error
            ? reason.message.trim()
            : 'Route lookup failed.'
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  return (
    <div className="pp-evidence-workbench pp-routes-workbench">
      <header className="pp-evidence-hero">
        <div>
          <span className="pp-kicker">Read-only kernel evidence</span>
          <h1>Next-hop route</h1>
          <p>
            Ask this process&apos;s kernel for one selected route per resolved destination address.
          </p>
        </div>
        <span className="pp-local-indicator">
          <Route aria-hidden="true" /> No route probes
        </span>
      </header>

      <form className="pp-route-controls" onSubmit={handleLookup}>
        <label>
          <span>Destination</span>
          <input
            className="pp-input"
            value={destination}
            maxLength={253}
            placeholder="api.example.test or 2001:db8::10"
            aria-label="Route destination"
            onChange={(event) => setDestination(event.target.value)}
          />
        </label>
        <label>
          <span>Resolution family</span>
          <select
            value={family}
            aria-label="Resolution family"
            onChange={(event) => setFamily(event.target.value as typeof family)}
          >
            <option value="auto">Auto</option>
            <option value="ipv4">IPv4</option>
            <option value="ipv6">IPv6</option>
          </select>
        </label>
        <button
          className={classNames('pp-button-primary', loading && 'pp-cancel-button')}
          type="submit"
        >
          {loading ? <Square aria-hidden="true" /> : <Network aria-hidden="true" />}
          {loading ? 'Cancel lookup' : 'Look up route'}
        </button>
      </form>

      <aside className="pp-route-uncertainty">
        <AlertTriangle aria-hidden="true" />
        <p>
          This is process-perspective kernel evidence, not traceroute. Kernel lookups send no route
          probes; a hostname can still require normal DNS resolution. VPNs, proxies, policy routing,
          ECMP selection, and later route changes can alter an actual connection path.
        </p>
      </aside>

      {loading ? (
        <div className="pp-evidence-loading" role="status">
          <LoaderCircle aria-hidden="true" /> Resolving and reading kernel route evidence…
        </div>
      ) : null}
      {error ? (
        <p className="pp-evidence-error" role="alert">
          {error}
        </p>
      ) : null}
      {response ? (
        <section className="pp-route-results" aria-labelledby="route-results-heading">
          <header>
            <div>
              <span className="pp-kicker">{response.perspective}</span>
              <h2 id="route-results-heading">Selected route evidence</h2>
            </div>
            <time dateTime={response.observedAt}>
              {new Date(response.observedAt).toLocaleString()}
            </time>
          </header>
          <div>
            {response.results.map((result) => (
              <RouteEvidenceCard key={`${result.family}-${result.destination}`} result={result} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RouteEvidenceCard({ result }: { result: RouteResult }) {
  const interfaceLabel =
    result.interfaceName ||
    (result.interfaceIndex ? `index ${result.interfaceIndex}` : 'Unknown interface');
  const hopLabel = result.local ? 'On-link · local' : result.onLink ? 'On-link' : result.nextHop;
  return (
    <article className={classNames('pp-route-result', result.status !== 'ok' && 'is-error')}>
      <header>
        <div>
          <span className="pp-route-family">{result.family}</span>
          <strong>{result.destination}</strong>
        </div>
        <span className={classNames('pp-route-status', `is-${result.status}`)}>
          {result.status}
        </span>
      </header>
      {result.status === 'ok' ? (
        <>
          <div className="pp-kernel-path">
            <span>
              <small>Source IP</small>
              <strong>{result.sourceIp || 'Not reported'}</strong>
            </span>
            <ArrowRight aria-hidden="true" />
            <span>
              <small>Interface</small>
              <strong>{interfaceLabel}</strong>
            </span>
            <ArrowRight aria-hidden="true" />
            <span>
              <small>Next hop</small>
              <strong>{hopLabel || 'Not reported'}</strong>
            </span>
          </div>
          <dl className="pp-route-facts">
            <div>
              <dt>Destination</dt>
              <dd>{result.destination}</dd>
            </div>
            <div>
              <dt>Family</dt>
              <dd>{result.family}</dd>
            </div>
            <div>
              <dt>Source IP</dt>
              <dd>{result.sourceIp || 'Not reported'}</dd>
            </div>
            <div>
              <dt>Interface</dt>
              <dd>
                {interfaceLabel}
                {result.interfaceIndex ? ` · ${result.interfaceIndex}` : ''}
              </dd>
            </div>
            <div>
              <dt>Next hop</dt>
              <dd>{hopLabel || 'Not reported'}</dd>
            </div>
            {result.prefix !== null ? (
              <div>
                <dt>Prefix</dt>
                <dd>/{result.prefix}</dd>
              </div>
            ) : null}
            {result.routeMetric !== null ? (
              <div>
                <dt>Route metric</dt>
                <dd>{result.routeMetric}</dd>
              </div>
            ) : null}
            {result.table !== null ? (
              <div>
                <dt>Route table</dt>
                <dd>{result.table}</dd>
              </div>
            ) : null}
            <div>
              <dt>Backend</dt>
              <dd>{result.backend}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="pp-evidence-error">{result.error || 'Route evidence is unavailable.'}</p>
      )}
      {result.notes.length ? (
        <ul className="pp-route-notes">
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

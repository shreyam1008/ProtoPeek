import { AlertTriangle, ArrowRight, LoaderCircle, Network, Route, Square } from 'lucide-react';
import { type FormEvent, useEffect, useEffectEvent, useRef, useState } from 'react';

import { classNames } from '@/shared/runtime';

import { lookupRoute, type RouteLookupResponse, type RouteResult } from './api';
import { handoffEvidence } from './app/handoff-display';
import { type ConsumedHandoffFor, consumePendingHandoff } from './app/handoff-store';
import { StatusFact } from './evidence/StatusFact';
import { protocolShellEvents } from './ProtocolShellContext';

export function RoutesWorkbench() {
  const [handoff, setHandoff] = useState<ConsumedHandoffFor<'next-hop-target-draft'> | null>(null);
  const [destination, setDestination] = useState('');
  const [family, setFamily] = useState<'auto' | 'ipv4' | 'ipv6'>('auto');
  const [response, setResponse] = useState<RouteLookupResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const destinationRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);

  function invalidateLookup() {
    requestGenerationRef.current++;
    const active = abortRef.current;
    abortRef.current = null;
    active?.abort();
    setLoading(false);
  }

  const applyPendingHandoff = useEffectEvent(() => {
    const pending = consumePendingHandoff('next-hop-target-draft');
    if (!pending) return;
    invalidateLookup();
    setError('');
    setResponse(null);
    setFamily('auto');
    setDestination(pending.draft.target.target);
    setHandoff(pending);
    destinationRef.current?.focus();
  });

  useEffect(() => {
    applyPendingHandoff();
    window.addEventListener(protocolShellEvents.pendingHandoff, applyPendingHandoff);
    return () => {
      requestGenerationRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      window.removeEventListener(protocolShellEvents.pendingHandoff, applyPendingHandoff);
    };
  }, []);

  async function handleLookup(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      invalidateLookup();
      setError('Route lookup cancelled.');
      return;
    }
    const target = destination.trim();
    if (!target) return;
    const controller = new AbortController();
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    abortRef.current = controller;
    setLoading(true);
    setHandoff(null);
    setError('');
    setResponse(null);
    try {
      const next = await lookupRoute(target, family, controller.signal);
      if (requestGenerationRef.current !== generation || abortRef.current !== controller) return;
      setResponse(next);
    } catch (reason) {
      if (requestGenerationRef.current !== generation || abortRef.current !== controller) return;
      setError(
        controller.signal.aborted
          ? 'Route lookup cancelled.'
          : reason instanceof Error
            ? reason.message.trim()
            : 'Route lookup failed.'
      );
    } finally {
      if (requestGenerationRef.current === generation && abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
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
            ref={destinationRef}
            className="pp-input"
            value={destination}
            maxLength={253}
            placeholder="api.example.test or 2001:db8::10"
            aria-label="Route destination"
            onChange={(event) => {
              invalidateLookup();
              setDestination(event.target.value);
              setHandoff(null);
              setResponse(null);
              setError('');
            }}
          />
        </label>
        <label>
          <span>Resolution family</span>
          <select
            value={family}
            aria-label="Resolution family"
            onChange={(event) => {
              invalidateLookup();
              setFamily(event.target.value as typeof family);
              setHandoff(null);
              setResponse(null);
              setError('');
            }}
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

      {handoff ? (
        <aside className="pp-route-uncertainty" role="status">
          <Route aria-hidden="true" />
          <p>
            {handoffEvidence(handoff.provenance, handoff.storage === 'memory')}. The destination was
            filled in; no DNS resolution or route lookup was started.
          </p>
        </aside>
      ) : null}

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
            <StatusFact label="Destination" value={result.destination} />
            <StatusFact label="Family" value={result.family} />
            <StatusFact label="Source IP" value={result.sourceIp || 'Not reported'} />
            <StatusFact
              label="Interface"
              value={
                <>
                  {interfaceLabel}
                  {result.interfaceIndex ? ` · ${result.interfaceIndex}` : ''}
                </>
              }
            />
            <StatusFact label="Next hop" value={hopLabel || 'Not reported'} />
            {result.prefix !== null ? (
              <StatusFact label="Prefix" value={`/${result.prefix}`} />
            ) : null}
            {result.routeMetric !== null ? (
              <StatusFact label="Route metric" value={result.routeMetric} />
            ) : null}
            {result.table !== null ? <StatusFact label="Route table" value={result.table} /> : null}
            <StatusFact label="Backend" value={result.backend} />
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

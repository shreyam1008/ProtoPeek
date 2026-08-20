import { Cable, Globe2, LoaderCircle, LockKeyhole, Play, Search, Square } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { classNames } from '@/shared/utils';

import { type ScanResult, scanAddresses } from './api';

export const ambientScanAddresses = [
  'localhost:50051',
  'localhost:9090',
  'localhost:6565',
  'localhost:7000',
  'localhost:8080',
  '127.0.0.1:50051',
];

export function DiscoveryPanel({
  initialTarget = '',
  autoStart = false,
  onOpenGRPC,
}: {
  initialTarget?: string;
  autoStart?: boolean;
  onOpenGRPC: (result: ScanResult) => void;
}) {
  return (
    <section className="pp-panel pp-discovery-panel" aria-labelledby="grpc-discovery-title">
      <div className="pp-card-heading">
        <div>
          <span className="pp-kicker">Nearby</span>
          <h3 id="grpc-discovery-title">Discover protocol evidence</h3>
        </div>
        <span className="pp-local-indicator">
          <LockKeyhole aria-hidden="true" /> Loopback by default
        </span>
      </div>
      <DiscoveryScanner
        autoStart={autoStart}
        initialTarget={initialTarget}
        onOpenGRPC={onOpenGRPC}
      />
    </section>
  );
}

export function DiscoveryScanner({
  initialTarget = '',
  autoStart = false,
  inputRef,
  onResults,
  onOpenGRPC,
  onOpenHTTP,
}: {
  initialTarget?: string;
  autoStart?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onResults?: (results: ScanResult[]) => void;
  onOpenGRPC?: (result: ScanResult) => void;
  onOpenHTTP?: (result: ScanResult) => void;
}) {
  const [scanInput, setScanInput] = useState(initialTarget);
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false);
  const [lastScanWasExplicit, setLastScanWasExplicit] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const scanIDRef = useRef(0);

  const runScan = useEffectEvent(async (explicit: boolean) => {
    const address = scanInput.trim();
    const addresses = explicit && address ? [address] : ambientScanAddresses;
    abortRef.current?.abort();
    const controller = new AbortController();
    const scanID = scanIDRef.current + 1;
    scanIDRef.current = scanID;
    abortRef.current = controller;
    setScanning(true);
    setScanMessage('');
    setLastScanWasExplicit(explicit && Boolean(address));
    setResults([]);
    try {
      const nextResults = await scanAddresses(
        addresses,
        allowPrivateNetwork,
        explicit && Boolean(address),
        controller.signal
      );
      if (!mountedRef.current || scanIDRef.current !== scanID) return;
      if (!Array.isArray(nextResults)) throw new Error('Scan returned an invalid result list.');
      setResults(nextResults);
      onResults?.(nextResults);
    } catch (error) {
      if (!mountedRef.current || scanIDRef.current !== scanID) return;
      if (controller.signal.aborted) {
        setScanMessage('Scan cancelled.');
      } else {
        setResults([
          {
            address: addresses[0] ?? '',
            alive: false,
            tcp: false,
            grpc: false,
            http: false,
            protocols: [],
            reflection: 'not-checked',
            transport: '',
            services: [],
            httpTransport: '',
            httpProtocol: '',
            httpStatus: '',
            httpStatusCode: 0,
            httpServer: '',
            failure: 'request',
            error:
              error instanceof Error && error.message.trim()
                ? error.message.trim()
                : 'Scan request failed',
            details: [],
            latencyMs: 0,
          },
        ]);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current && scanIDRef.current === scanID) setScanning(false);
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!autoStart) return;
    void runScan(Boolean(initialTarget.trim()));
  }, [autoStart, initialTarget]);

  const routineFailures = lastScanWasExplicit
    ? []
    : results.filter((result) => !result.alive && result.failure === 'unreachable');
  const visibleResults = lastScanWasExplicit
    ? results
    : results.filter((result) => result.alive || result.failure !== 'unreachable');

  return (
    <div className="pp-discovery-scanner">
      <p className="pp-scan-policy">
        Loopback checks use six fixed endpoints. An explicit host checks only its supplied port, or
        50051 and 443 when no port is given. Probes are HEAD, gRPC reflection, and TCP connect;
        redirects are never followed. Hostnames are resolved once before dialing, and private or
        link-local results require the opt-in below.
      </p>
      <div className="pp-discovery-controls">
        <input
          ref={inputRef}
          className="pp-input font-mono text-xs"
          value={scanInput}
          onChange={(event) => setScanInput(event.target.value)}
          placeholder="Host, URL, or host:port"
          aria-label="Scan target"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void runScan(Boolean(scanInput.trim()));
          }}
        />
        <button
          className={classNames('pp-button-primary shrink-0', scanning && 'pp-cancel-button')}
          type="button"
          onClick={
            scanning
              ? () => abortRef.current?.abort()
              : () => void runScan(Boolean(scanInput.trim()))
          }
        >
          {scanning ? <Square aria-hidden="true" /> : <Search aria-hidden="true" />}
          {scanning ? 'Cancel scan' : scanInput.trim() ? 'Scan target' : 'Scan loopback'}
        </button>
      </div>
      <label className="pp-private-scan-toggle">
        <input
          type="checkbox"
          checked={allowPrivateNetwork}
          onChange={(event) => setAllowPrivateNetwork(event.target.checked)}
        />
        Allow this target to reach private or link-local IPs
      </label>
      {scanMessage ? (
        <p className="pp-scan-message" role="status">
          {scanMessage}
        </p>
      ) : null}
      {visibleResults.length > 0 ? (
        <div className="pp-discovery-results">
          {visibleResults.map((result) => (
            <ScanResultCard
              key={`${result.address}-${result.transport}-${result.httpTransport}`}
              result={result}
              onOpenGRPC={onOpenGRPC}
              onOpenHTTP={onOpenHTTP}
            />
          ))}
        </div>
      ) : scanning ? (
        <div className="pp-scan-progress" role="status">
          <LoaderCircle aria-hidden="true" /> Checking bounded candidates…
        </div>
      ) : null}
      {routineFailures.length > 0 ? (
        <details className="pp-scan-failures">
          <summary>{routineFailures.length} routine loopback probes were not reachable</summary>
          <ul>
            {routineFailures.map((result) => (
              <li key={result.address}>
                <code>{result.address}</code>
                <span>{result.details?.[0] ?? result.error ?? 'Not reachable'}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function ScanResultCard({
  result,
  onOpenGRPC,
  onOpenHTTP,
}: {
  result: ScanResult;
  onOpenGRPC?: (result: ScanResult) => void;
  onOpenHTTP?: (result: ScanResult) => void;
}) {
  return (
    <article
      className={classNames(
        'pp-discovery-result',
        result.grpc && 'is-grpc',
        result.http && 'is-http',
        result.tcp && !result.grpc && !result.http && 'is-open'
      )}
    >
      <header className="pp-discovery-result-head">
        <div>
          <span
            className={classNames(
              'pp-discovery-dot',
              result.grpc || result.http ? 'bg-pp-ok' : result.tcp ? 'bg-pp-accent' : 'bg-pp-muted'
            )}
          />
          <strong>{result.address}</strong>
          <small>{result.latencyMs}ms</small>
        </div>
        <div className="pp-scan-actions">
          {result.grpc && onOpenGRPC ? (
            <button type="button" onClick={() => onOpenGRPC(result)}>
              <Play aria-hidden="true" /> gRPC
            </button>
          ) : null}
          {result.http && onOpenHTTP ? (
            <button type="button" onClick={() => onOpenHTTP(result)}>
              <Globe2 aria-hidden="true" /> HTTP
            </button>
          ) : null}
        </div>
      </header>
      <div className="pp-evidence-chips">
        {result.grpc ? (
          <span>gRPC · {result.transport === 'tls' ? 'TLS' : 'plaintext'}</span>
        ) : null}
        {result.http ? (
          <span>
            {result.httpProtocol || 'HTTP'} · {result.httpStatus || 'responded'}
          </span>
        ) : null}
        {result.tcp && !result.grpc && !result.http ? (
          <span>
            <Cable aria-hidden="true" /> Open TCP
          </span>
        ) : null}
        {!result.alive ? <span>{result.error ?? 'Not reachable'}</span> : null}
      </div>
      {result.grpc ? (
        <p className="pp-muted">
          {result.reflection === 'available'
            ? 'Reflection available'
            : 'gRPC confirmed; reflection unavailable'}
          {result.services?.length ? ` · ${result.services.length} service(s)` : ''}
        </p>
      ) : null}
      {result.details?.length ? (
        <details className="pp-probe-details">
          <summary>Probe evidence</summary>
          <ul>
            {result.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

export function scanResultHTTPURL(result: ScanResult) {
  return `${result.httpTransport === 'tls' ? 'https' : 'http'}://${result.address}/`;
}

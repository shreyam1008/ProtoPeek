import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Download,
  Globe2,
  Monitor,
  Network,
  Puzzle,
  Radar,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { PageHeader } from '@/console/shell/PageHeader';
import { compactDate } from '@/shared/runtime';
import { fetchBootstrap } from './api';
import { homeEntryFeatures } from './app/feature-registry';
import { prepareDiscoveryTarget } from './discovery-target';
import { OperationHistoryControl } from './OperationHistoryControl';
import { useProtocolShell } from './ProtocolShellContext';
import { prepareServiceEntry, type ServiceWorkbench } from './service-entry';
import './dashboard.css';

const quickStarts = [
  {
    route: '/protocols/http',
    label: 'HTTP request',
    icon: Globe2,
  },
  {
    route: '/protocols/grpc',
    label: 'gRPC call',
    icon: Server,
  },
  {
    route: '/network/local',
    label: 'Nearby devices',
    icon: Radar,
  },
  {
    route: '/downloader',
    label: 'Download a file',
    icon: Download,
  },
] as const;
const moreIcons = {
  'network-path': Network,
  'this-pc': Monitor,
  extensions: Puzzle,
  'local-transfer': Download,
  security: ShieldCheck,
} as const;
const moreTools = homeEntryFeatures.filter((feature) => feature.id in moreIcons);

export function Dashboard() {
  const {
    discoveries,
    openScan,
    claimInitialScan,
    openGRPCDiscovery,
    openHTTPDiscovery,
    openHandoff,
  } = useProtocolShell();
  const [scanTarget, setScanTarget] = useState('');
  const [workbench, setWorkbench] = useState<ServiceWorkbench>('http');
  const [targetError, setTargetError] = useState('');
  const [handoffError, setHandoffError] = useState<{ message: string; target: string } | null>(
    null
  );
  const targetRef = useRef<HTMLInputElement | null>(null);
  const openInitialScan = useEffectEvent((target: string) => {
    if (claimInitialScan && !claimInitialScan(target)) return;
    openScan({ initialTarget: target, autoStart: true });
  });
  useEffect(() => {
    let cancelled = false;
    void fetchBootstrap()
      .then((bootstrap) => {
        if (cancelled) return;
        if (bootstrap.initialScanTarget) openInitialScan(bootstrap.initialScanTarget);
      })
      .catch(() => {
        // Starting a tool remains available when build metadata cannot be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function findService() {
    const prepared = prepareDiscoveryTarget(scanTarget);
    if (!prepared.ok) {
      setTargetError(prepared.error);
      targetRef.current?.focus();
      return;
    }
    setTargetError('');
    if (prepared.target) openScan({ initialTarget: prepared.target, autoStart: true });
    else openScan();
  }
  function openService() {
    const prepared = prepareServiceEntry(scanTarget, workbench);
    const result = prepared.ok ? openHandoff(prepared.handoff, { memoryOnly: true }) : prepared;
    if (!result.ok) {
      setTargetError(result.error);
      targetRef.current?.focus();
    } else setTargetError('');
  }
  function openRecent(discovery: (typeof discoveries)[number], kind: 'grpc' | 'http') {
    setHandoffError(null);
    const result = kind === 'grpc' ? openGRPCDiscovery(discovery) : openHTTPDiscovery(discovery);
    if (result && !result.ok) setHandoffError({ message: result.error, target: discovery.address });
  }
  return (
    <div className="pp-home">
      <PageHeader>
        <div>
          <h1>What do you need to check?</h1>
          <p>Start with an address or open a tool.</p>
        </div>
      </PageHeader>
      <OperationHistoryControl />
      <div className="pp-home-content">
        <section className="pp-home-start" aria-labelledby="home-target-title">
          <div>
            <h2 id="home-target-title">Open a service</h2>
          </div>
          <form
            aria-label="Open a service"
            onSubmit={(event) => {
              event.preventDefault();
              openService();
            }}
          >
            <label className="pp-home-workbench">
              <span>Workbench</span>
              <select
                value={workbench}
                onChange={(event) => {
                  setWorkbench(event.target.value as ServiceWorkbench);
                  setTargetError('');
                }}
              >
                <option value="http">HTTP request</option>
                <option value="grpc-tls">gRPC · TLS</option>
                <option value="grpc-plaintext">gRPC · plaintext</option>
              </select>
            </label>
            <label className="pp-home-target">
              <span>Service address</span>
              <input
                ref={targetRef}
                value={scanTarget}
                onChange={(event) => {
                  setScanTarget(event.target.value);
                  setTargetError('');
                }}
                placeholder="localhost:8080 or https://api.example.com"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.nativeEvent.isComposing)
                    event.preventDefault();
                }}
                aria-describedby={
                  targetError ? 'home-target-help home-target-error' : 'home-target-help'
                }
                aria-invalid={Boolean(targetError)}
              />
            </label>
            <button type="submit">Open {workbench === 'http' ? 'HTTP' : 'gRPC'}</button>
          </form>
          {targetError ? (
            <p id="home-target-error" className="pp-home-error" role="alert">
              {targetError}
            </p>
          ) : null}
          <p className="pp-home-hint">
            <span id="home-target-help">Unsent draft.</span>{' '}
            <span id="home-scan-help">Discovery probes TCP, HTTP and gRPC reflection.</span>
          </p>
          <button
            type="button"
            className="pp-home-discover"
            aria-describedby="home-scan-help"
            onClick={findService}
          >
            Find a service instead
          </button>
        </section>
        <div className="pp-home-columns">
          <section className="pp-home-quick" aria-labelledby="home-quick-title">
            <header>
              <h2 id="home-quick-title">Quick starts</h2>
              <Link to="/protocols">All inspection tools</Link>
            </header>
            <div className="pp-home-quick-grid">
              {quickStarts.map(({ route, label, icon: Icon }) => (
                <Link key={route} to={route} className="pp-home-quick-link">
                  <Icon aria-hidden="true" />
                  <strong>{label}</strong>
                </Link>
              ))}
            </div>
          </section>
          <section className="pp-home-recent" aria-labelledby="recent-title">
            <header>
              <h2 id="recent-title">Recent services</h2>
              <span>This browser</span>
            </header>
            {handoffError ? (
              <p className="pp-home-error" role="alert">
                {handoffError.message}{' '}
                <button
                  type="button"
                  onClick={() => openScan({ initialTarget: handoffError.target, autoStart: false })}
                >
                  Scan again
                </button>
              </p>
            ) : null}
            {discoveries.length ? (
              <div className="pp-home-recent-list">
                {discoveries.map((discovery) => (
                  <article key={`${discovery.address}-${discovery.discoveredAt}`}>
                    <div>
                      <strong title={discovery.address}>{discovery.address}</strong>
                      <small>{compactDate(discovery.discoveredAt)}</small>
                    </div>
                    <div className="pp-home-recent-actions">
                      {discovery.grpc ? (
                        <button
                          type="button"
                          aria-label={`Open ${discovery.address} in gRPC`}
                          onClick={() => openRecent(discovery, 'grpc')}
                        >
                          gRPC <ArrowRight aria-hidden="true" />
                        </button>
                      ) : null}
                      {discovery.http ? (
                        <button
                          type="button"
                          aria-label={`Open ${discovery.address} in HTTP`}
                          onClick={() => openRecent(discovery, 'http')}
                        >
                          HTTP <ArrowRight aria-hidden="true" />
                        </button>
                      ) : null}
                      {!discovery.grpc && !discovery.http ? <span>Open TCP</span> : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="pp-home-empty">
                <p>Services you discover appear here.</p>
                <button type="button" onClick={() => targetRef.current?.focus()}>
                  Check an address <ArrowRight aria-hidden="true" />
                </button>
              </div>
            )}
          </section>
        </div>
        <section className="pp-home-more" aria-labelledby="home-more-title">
          <h2 id="home-more-title">More tools</h2>
          <div>
            {moreTools.map((feature) => {
              const Icon = moreIcons[feature.id as keyof typeof moreIcons];
              return (
                <Link
                  key={feature.id}
                  to={feature.route}
                  preload={feature.id === 'extensions' ? false : undefined}
                >
                  <Icon aria-hidden="true" />
                  <span>{feature.homeEntry.label}</span>
                  <ArrowRight aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

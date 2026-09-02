import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Cloud,
  Download,
  Monitor,
  Network,
  Radar,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';

import { compactDate, displayBuildVersion } from '@/shared/runtime';

import { fetchBootstrap } from './api';
import { homeEntryFeatures } from './app/feature-registry';
import { useProtocolShell } from './ProtocolShellContext';

const startTaskIcons = {
  protocols: Server,
  'network-path': Network,
  'this-pc': Monitor,
  tunnels: Cloud,
  downloader: Download,
  security: ShieldCheck,
} as const;

const safetyBoundaries = [
  {
    name: 'Network path',
    state: 'Available',
    detail: 'On Linux, each RTT stays tied to the hop that replied.',
  },
  {
    name: 'Nmap file import',
    state: 'Available',
    detail: 'Reads saved XML for hints. ProtoPeek does not run Nmap.',
  },
  {
    name: 'Local discovery',
    state: 'Ask first',
    detail: 'Limited to an authorized /24-or-smaller range and the ports you choose.',
  },
  {
    name: 'Bundled Nmap',
    state: 'Not included',
    detail: 'ProtoPeek never installs, locates, or runs Nmap.',
  },
];

export function Dashboard() {
  const { discoveries, openScan, openGRPCDiscovery, openHTTPDiscovery } = useProtocolShell();
  const [version, setVersion] = useState('development');
  const openInitialScan = useEffectEvent((target: string) => {
    openScan({ initialTarget: target, autoStart: true });
  });

  useEffect(() => {
    let cancelled = false;
    void fetchBootstrap()
      .then((bootstrap) => {
        if (cancelled) return;
        setVersion(displayBuildVersion(bootstrap.version));
        if (bootstrap.initialScanTarget) openInitialScan(bootstrap.initialScanTarget);
      })
      .catch(() => {
        // The dashboard remains useful when bootstrap metadata cannot be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="pp-dashboard">
      <header className="pp-dashboard-hero">
        <div>
          <span className="pp-kicker">ProtoPeek · {version}</span>
          <h1>What do you need to check?</h1>
          <p>Pick a task. Network checks start only when you ask.</p>
        </div>
        <button type="button" className="pp-dashboard-scan" onClick={() => openScan()}>
          <Radar aria-hidden="true" />
          <span>
            <strong>Find a service</strong>
            <small>Check one address for HTTP, gRPC, or open TCP</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </button>
      </header>

      <div className="pp-dashboard-grid">
        <section className="pp-dashboard-section pp-start-section" aria-labelledby="start-title">
          <header>
            <div>
              <span className="pp-kicker">Start here</span>
              <h2 id="start-title">Choose what you want to do</h2>
            </div>
          </header>
          <div className="pp-start-list">
            {homeEntryFeatures.map((feature) => {
              const Icon = startTaskIcons[feature.id];
              return (
                <Link key={feature.id} to={feature.route} className="pp-start-link">
                  <Icon aria-hidden="true" />
                  <span>
                    <strong>{feature.homeEntry.label}</strong>
                    <p>{feature.homeEntry.detail}</p>
                  </span>
                  <ArrowRight aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>

        <section
          className="pp-dashboard-section pp-recent-discoveries"
          aria-labelledby="recent-title"
        >
          <header>
            <div>
              <span className="pp-kicker">This browser</span>
              <h2 id="recent-title">Recent services</h2>
            </div>
            <span>{discoveries.length}/12</span>
          </header>
          {discoveries.length ? (
            <div className="pp-recent-list">
              {discoveries.map((discovery) => (
                <article key={`${discovery.address}-${discovery.discoveredAt}`}>
                  <div>
                    <strong>{discovery.address}</strong>
                    <small>{compactDate(discovery.discoveredAt)}</small>
                  </div>
                  <p>
                    {discovery.grpc ? 'gRPC' : ''}
                    {discovery.grpc && discovery.http ? ' + ' : ''}
                    {discovery.http ? discovery.httpProtocol || 'HTTP' : ''}
                    {!discovery.grpc && !discovery.http ? 'Open TCP' : ''}
                  </p>
                  <div>
                    {discovery.grpc ? (
                      <button type="button" onClick={() => openGRPCDiscovery(discovery)}>
                        gRPC
                      </button>
                    ) : null}
                    {discovery.http ? (
                      <button type="button" onClick={() => openHTTPDiscovery(discovery)}>
                        HTTP
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <button type="button" className="pp-recent-empty" onClick={() => openScan()}>
              No recent services yet. Start discovery.
            </button>
          )}
        </section>
      </div>

      <details className="pp-dashboard-section pp-dashboard-boundaries">
        <summary>How discovery stays bounded</summary>
        <div>
          {safetyBoundaries.map((boundary) => (
            <article key={boundary.name}>
              <span>{boundary.state}</span>
              <strong>{boundary.name}</strong>
              <p>{boundary.detail}</p>
            </article>
          ))}
        </div>
      </details>
    </div>
  );
}

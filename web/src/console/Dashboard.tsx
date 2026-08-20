import { Link } from '@tanstack/react-router';
import {
  Activity,
  ArrowRight,
  Cable,
  Globe2,
  LockKeyhole,
  Radar,
  Route,
  Server,
} from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';

import { compactDate, displayBuildVersion } from '@/shared/runtime';

import { fetchBootstrap } from './api';
import { useProtocolShell } from './ProtocolShellContext';

const gatedCapabilities = [
  {
    name: 'Next-hop lookup',
    state: 'This build',
    detail: 'One read-only kernel route per resolved address; no hop probes.',
  },
  {
    name: 'Nmap XML import',
    state: 'This build',
    detail: 'Offline hints only; verify with ProtoPeek.',
  },
  {
    name: 'Bundled Nmap',
    state: 'Not planned',
    detail: 'Never installed, located, or run by ProtoPeek.',
  },
  {
    name: 'Traceroute',
    state: 'Gated',
    detail: 'Hop probes are separate from kernel route evidence.',
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
          <span className="pp-kicker">Protocol console · {version}</span>
          <h1>Protocol Peek</h1>
          <p>Inspect the transport first, then open the protocol-native workbench.</p>
        </div>
        <button type="button" className="pp-dashboard-scan" onClick={() => openScan()}>
          <Radar aria-hidden="true" />
          <span>
            <strong>Scan target</strong>
            <small>Bounded, safe evidence checks</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </button>
      </header>

      <section className="pp-signal-path" aria-label="Protocol workflow">
        <span>
          <Cable aria-hidden="true" /> Target
        </span>
        <i aria-hidden="true" />
        <span>
          <Radar aria-hidden="true" /> Discover
        </span>
        <i aria-hidden="true" />
        <span>
          <Activity aria-hidden="true" /> Evidence
        </span>
        <em>Runs only when requested</em>
      </section>

      <div className="pp-dashboard-grid">
        <section className="pp-dashboard-section" aria-labelledby="protocols-title">
          <header>
            <div>
              <span className="pp-kicker">Available now</span>
              <h2 id="protocols-title">Workbench surfaces</h2>
            </div>
            <span className="pp-local-indicator">
              <LockKeyhole aria-hidden="true" /> Session data stays local
            </span>
          </header>
          <div className="pp-protocol-cards">
            <Link to="/grpc" className="pp-protocol-card">
              <Server aria-hidden="true" />
              <span>
                <small>Stable</small>
                <strong>gRPC</strong>
              </span>
              <p>Reflection, proto files, protosets, deadlines, streams, headers, trailers.</p>
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link to="/http" className="pp-protocol-card">
              <Globe2 aria-hidden="true" />
              <span>
                <small>Stable</small>
                <strong>HTTP</strong>
              </span>
              <p>Safe local relay with TLS, redirect, timing, peer, header, and body evidence.</p>
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link to="/routes" className="pp-protocol-card">
              <Route aria-hidden="true" />
              <span>
                <small>In this build</small>
                <strong>Next hop</strong>
              </span>
              <p>
                Read-only process-perspective source, interface, gateway, prefix, metric, and table
                evidence.
              </p>
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section
          className="pp-dashboard-section pp-recent-discoveries"
          aria-labelledby="recent-title"
        >
          <header>
            <div>
              <span className="pp-kicker">Stored in this browser</span>
              <h2 id="recent-title">Recent discoveries</h2>
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
              No protocol evidence recorded. Scan a target to start.
            </button>
          )}
        </section>
      </div>

      <section className="pp-capability-strip" aria-labelledby="capability-title">
        <header>
          <span className="pp-kicker">Honest boundaries</span>
          <h2 id="capability-title">Evidence boundaries</h2>
        </header>
        <div>
          {gatedCapabilities.map((capability) => (
            <article key={capability.name}>
              <span>{capability.state}</span>
              <strong>{capability.name}</strong>
              <p>{capability.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

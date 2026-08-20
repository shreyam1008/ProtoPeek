import { Link } from '@tanstack/react-router';
import { Activity, ArrowRight, Cable, Globe2, LockKeyhole, Radar, Server } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';

import { compactDate, displayBuildVersion } from '@/shared/utils';

import { fetchBootstrap } from './api';
import { useProtocolShell } from './ProtocolShellContext';

const gatedCapabilities = [
  { name: 'Route trace', state: 'Gated', detail: 'Planned for milestone 2; no route probing yet.' },
  { name: 'Packet evidence', state: 'Optional', detail: 'Requires an explicit capture workflow.' },
  { name: 'Nmap integration', state: 'Optional', detail: 'Not installed or invoked by ProtoPeek.' },
  { name: "Cap'n Proto", state: 'Gated', detail: 'Protocol adapter is not shipped.' },
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
              <h2 id="protocols-title">Protocol workbenches</h2>
            </div>
            <span className="pp-local-indicator">
              <LockKeyhole aria-hidden="true" /> Local only
            </span>
          </header>
          <div className="pp-protocol-cards">
            <Link to="/grpc" className="pp-protocol-card">
              <Server aria-hidden="true" />
              <span>
                <small>Shipped</small>
                <strong>gRPC</strong>
              </span>
              <p>Reflection, proto files, protosets, deadlines, streams, headers, trailers.</p>
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link to="/http" className="pp-protocol-card">
              <Globe2 aria-hidden="true" />
              <span>
                <small>Shipped</small>
                <strong>HTTP</strong>
              </span>
              <p>Safe local relay with TLS, redirect, timing, peer, header, and body evidence.</p>
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
          <h2 id="capability-title">Not silently running</h2>
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

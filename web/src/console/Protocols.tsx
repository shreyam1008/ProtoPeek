import { Link } from '@tanstack/react-router';
import { ArrowRight, Globe2, Radar, Radio, Server, ShieldCheck } from 'lucide-react';

import { inspectEntryFeatures } from './app/feature-registry';
import { useProtocolShell } from './ProtocolShellContext';
import './suite-pages.css';

const inspectIcons = {
  grpc: Server,
  http: Globe2,
  events: Radio,
  capnp: Server,
  security: ShieldCheck,
} as const;

export function Protocols() {
  const { openScan } = useProtocolShell();

  return (
    <div className="pp-suite-page pp-protocols-page">
      <header className="pp-suite-page-heading">
        <div>
          <span className="pp-kicker">Inspect</span>
          <h1>Choose an inspection workbench.</h1>
          <p>Send a request, explore a service, or check a website.</p>
        </div>
        <button type="button" className="pp-suite-page-action" onClick={() => openScan()}>
          <Radar aria-hidden="true" />
          <span>
            <strong>Inspect a target</strong>
            <small>Find HTTP, gRPC, and open ports</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </button>
      </header>

      <section className="pp-suite-section" aria-labelledby="available-protocols-title">
        <header>
          <div>
            <h2 id="available-protocols-title">Native inspection tools</h2>
          </div>
          <span>Local session</span>
        </header>
        <div className="pp-protocol-choice-list">
          {inspectEntryFeatures.map((feature) => {
            const Icon = inspectIcons[feature.id];
            return (
              <Link key={feature.id} to={feature.route} className="pp-protocol-choice">
                <Icon aria-hidden="true" />
                <span>
                  <strong>{feature.label}</strong>
                  <p>{feature.inspectEntry.detail}</p>
                </span>
                <ArrowRight aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      </section>

      <footer className="pp-inspect-footer">
        <Link to="/this-pc">
          Find services on this device <ArrowRight aria-hidden="true" />
        </Link>
        <Link to="/roadmap">
          Upcoming protocols <ArrowRight aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}

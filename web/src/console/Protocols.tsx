import { Link } from '@tanstack/react-router';
import { ArrowRight, Braces, Globe2, Radar, RadioTower, Server } from 'lucide-react';

import { useProtocolShell } from './ProtocolShellContext';
import './suite-pages.css';

const availableProtocols = [
  {
    name: 'gRPC',
    state: 'Stable',
    detail:
      'Reflection, proto folders and protosets, unary and streaming calls, metadata, trailers.',
    to: '/protocols/grpc' as const,
    icon: Server,
  },
  {
    name: 'HTTP',
    state: 'Stable',
    detail:
      'Methods, URLs, auth, request bodies, redirects, TLS, timing, headers, and response data.',
    to: '/protocols/http' as const,
    icon: Globe2,
  },
];

const futureProtocols = [
  {
    name: "Cap'n Proto",
    state: 'Exploring',
    detail: 'Requires a native schema and capability-oriented inspector before it can ship.',
    icon: Braces,
  },
  {
    name: 'WebSocket + SSE',
    state: 'Research',
    detail:
      'Event timelines and cancellation must stay visible instead of becoming a generic text stream.',
    icon: RadioTower,
  },
];

export function Protocols() {
  const { openScan } = useProtocolShell();

  return (
    <div className="pp-suite-page pp-protocols-page">
      <header className="pp-suite-page-heading">
        <div>
          <span className="pp-kicker">APIs</span>
          <h1>Choose the API workbench.</h1>
          <p>
            REST and gRPC stay related here, while each keeps its native vocabulary and evidence.
          </p>
        </div>
        <button type="button" className="pp-suite-page-action" onClick={() => openScan()}>
          <Radar aria-hidden="true" />
          <span>
            <strong>Inspect a target</strong>
            <small>Bounded checks, only when requested</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </button>
      </header>

      <section className="pp-suite-section" aria-labelledby="available-protocols-title">
        <header>
          <div>
            <span className="pp-kicker">Available now</span>
            <h2 id="available-protocols-title">API-native consoles</h2>
          </div>
          <span>Local session</span>
        </header>
        <div className="pp-protocol-choice-list">
          {availableProtocols.map((protocol) => (
            <Link key={protocol.name} to={protocol.to} className="pp-protocol-choice">
              <protocol.icon aria-hidden="true" />
              <span>
                <small>{protocol.state}</small>
                <strong>{protocol.name}</strong>
                <p>{protocol.detail}</p>
              </span>
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <section className="pp-suite-section" aria-labelledby="future-protocols-title">
        <header>
          <div>
            <span className="pp-kicker">Deliberately gated</span>
            <h2 id="future-protocols-title">Future protocol research</h2>
          </div>
          <span>No generic-client promises</span>
        </header>
        <div className="pp-future-protocol-list">
          {futureProtocols.map((protocol) => (
            <article key={protocol.name}>
              <protocol.icon aria-hidden="true" />
              <div>
                <strong>{protocol.name}</strong>
                <p>{protocol.detail}</p>
              </div>
              <span>{protocol.state}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

import { useId, useMemo, useState } from 'react';
import { compactDate } from '@/shared/runtime';
import type { PathTrace } from './network-path';
import { pathGeography } from './network-path-geography';
import { worldLandPaths } from './world-map-land';

export default function NetworkPathGeography({ trace }: { trace: PathTrace }) {
  const titleID = useId();
  const descriptionID = useId();
  const geography = useMemo(() => pathGeography(trace), [trace]);
  const [selected, setSelected] = useState('');
  const active = geography.points.find((point) => point.key === selected) ?? geography.points[0];
  return (
    <section className="pp-path-geography" aria-labelledby={titleID}>
      <header>
        <h3 id={titleID}>Approximate places</h3>
        <span>
          {geography.points.length} located responders · {geography.unplaced.length} unplaced
          observations
        </span>
      </header>
      <p id={descriptionID}>
        Locations come from the IP provider. CDN, VPN, and anycast IPs may show a provider’s
        registered location rather than where packets traveled. Dashed lines indicate consecutive
        hop observations, never physical cables or measured link distances. The return route is
        unknown.
      </p>
      {geography.points.length ? (
        <>
          <svg
            viewBox="0 0 360 180"
            role="img"
            aria-label="Approximate world locations of responding hops"
            aria-describedby={descriptionID}
          >
            <title>Approximate world locations of responding hops</title>
            <rect width="360" height="180" className="pp-geography-ocean" />
            {[-120, -60, 0, 60, 120].map((longitude) => (
              <line
                key={longitude}
                x1={longitude + 180}
                x2={longitude + 180}
                y1={0}
                y2={180}
                className="pp-geography-grid"
              />
            ))}
            {[-60, -30, 0, 30, 60].map((latitude) => (
              <line
                key={latitude}
                x1={0}
                x2={360}
                y1={90 - latitude}
                y2={90 - latitude}
                className="pp-geography-grid"
              />
            ))}
            {worldLandPaths.map((path) => (
              <path key={path} d={path} className="pp-geography-land" />
            ))}
            {geography.connections.map(({ from, to }) => (
              <line
                key={`${from.key}:${to.key}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="pp-geography-order"
              />
            ))}
            {geography.points.map((point) => (
              <g key={point.key} className={active?.key === point.key ? 'is-selected' : ''}>
                <title>{`Hop ${point.ttl}: ${point.address}, ${[point.label.city, point.label.country].filter(Boolean).join(', ')}, ${point.medianRTT === null ? 'no measured RTT' : `${point.medianRTT.toFixed(1)} ms RTT`}`}</title>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={active?.key === point.key ? 2.5 : 1.7}
                  className="pp-geography-point"
                />
              </g>
            ))}
            {active ? (
              <text
                x={Math.min(345, Math.max(5, active.x + 4))}
                y={Math.max(8, active.y - 4)}
                className="pp-geography-marker-label"
              >
                Hop {active.ttl}
              </text>
            ) : null}
          </svg>
          <fieldset className="pp-geography-hops">
            <legend>Located hops</legend>
            {geography.points.map((point) => (
              <button
                type="button"
                key={point.key}
                aria-pressed={active?.key === point.key}
                onClick={() => setSelected(point.key)}
              >
                <strong>Hop {point.ttl}</strong>
                <span>
                  {point.label.city || point.label.region || point.label.country || point.address}
                </span>
                <small>
                  {point.medianRTT === null
                    ? 'RTT unavailable'
                    : `${point.medianRTT.toFixed(1)} ms RTT`}
                </small>
              </button>
            ))}
          </fieldset>
          {active ? (
            <div className="pp-geography-selected" role="status">
              <strong>{active.address}</strong>
              <span>
                {[active.label.city, active.label.region, active.label.country]
                  .filter(Boolean)
                  .join(', ') || 'Place name unavailable'}{' '}
                · {active.label.isp || active.label.organization || 'Provider unknown'}
              </span>
              <small>
                {active.label.latitude?.toFixed(3)}°, {active.label.longitude?.toFixed(3)}° ·
                Approximate provider location · {compactDate(active.label.observedAt)}
                {active.label.cached ? ' · cached' : ''}
              </small>
            </div>
          ) : null}
        </>
      ) : (
        <p>
          No provider coordinates were returned. These hops stay unplaced; their measured replies
          remain in the hop map.
        </p>
      )}
      {geography.unplaced.length ? (
        <details>
          <summary>Unplaced observations ({geography.unplaced.length})</summary>
          <ul>
            {geography.unplaced.map((hop) => (
              <li key={`${hop.ttl}:${hop.address}`}>
                Hop {hop.ttl}
                {hop.address ? ` · ${hop.address}` : ''} · {hop.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="pp-geography-source">
        IP locations:{' '}
        <a href={trace.attribution?.source} target="_blank" rel="noreferrer">
          IPWHOIS
        </a>{' '}
        · Map outline:{' '}
        <a
          href="https://www.naturalearthdata.com/about/terms-of-use/"
          target="_blank"
          rel="noreferrer"
        >
          Natural Earth
        </a>
        . No map tiles or browser location are requested.
      </p>
    </section>
  );
}

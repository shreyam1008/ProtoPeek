import { ArrowRight, CircleHelp, Computer, Globe, Router } from 'lucide-react';
import { buildHopRows, type PathTrace, pathRegionDictionary } from './network-path';
import './network-path-map.css';

export default function NetworkPathMap({ trace }: { trace: PathTrace }) {
  const rows = buildHopRows(trace);
  const greatestRTT = Math.max(
    1,
    ...rows.flatMap((row) => row.responderRTTs.map((value) => value.rtt.median))
  );
  return (
    <section className="pp-measured-path-map" aria-label="Measured hop map">
      <header>
        <div>
          <h3>Route to {trace.resolution.input}</h3>
          <p>Observed router replies in hop order · each time is a round trip from this machine</p>
        </div>
        <span>{trace.reached ? 'Destination reached' : 'Partial route'}</span>
      </header>
      <ol>
        <li className="is-source">
          <Computer aria-hidden="true" />
          <strong>This machine</strong>
          <code>{trace.route.sourceIp || 'Source address unavailable'}</code>
          <small>{trace.route.interfaceName || 'Interface not reported'}</small>
        </li>
        {rows.map((row) => (
          <li key={row.ttl} className={`is-${row.state}`}>
            <ArrowRight className="pp-map-connector" aria-hidden="true" />
            {row.responders.includes(trace.resolution.pinnedAddress) ? (
              <Globe aria-hidden="true" />
            ) : (
              <Router aria-hidden="true" />
            )}
            <strong>Hop {row.ttl}</strong>
            {row.responders.length ? (
              row.responders.map((address) => {
                const label = trace.attribution?.entries.find(
                  (entry) => entry.ip === address && entry.status === 'observed'
                );
                const measurement = row.responderRTTs.find((value) => value.responder === address);
                return (
                  <div className="pp-map-responder" key={address}>
                    <code>{address}</code>
                    {label ? (
                      <small>
                        {[
                          label.asn ? `AS${label.asn}` : '',
                          label.isp || label.organization,
                          label.city || label.region,
                          label.country,
                        ]
                          .filter(Boolean)
                          .join(' · ')}{' '}
                        · approximate
                      </small>
                    ) : null}
                    {measurement ? (
                      <>
                        <span>{measurement.rtt.median.toFixed(1)} ms RTT</span>
                        <i
                          aria-hidden="true"
                          style={{
                            width: `${Math.max(3, (measurement.rtt.median / greatestRTT) * 100)}%`,
                          }}
                        />
                      </>
                    ) : (
                      <span>No timed reply</span>
                    )}
                  </div>
                );
              })
            ) : (
              <>
                <span>No reply</span>
                <small>May still forward traffic</small>
              </>
            )}
          </li>
        ))}
        {!trace.reached ? (
          <li className="is-unconfirmed">
            <ArrowRight className="pp-map-connector" aria-hidden="true" />
            <Globe aria-hidden="true" />
            <strong>Destination unconfirmed</strong>
            <code>{trace.resolution.pinnedAddress}</code>
            <small>{trace.termination}</small>
          </li>
        ) : null}
      </ol>
      <p className="pp-map-limitation">
        This is a logical hop map. Probes cannot identify towers, physical cables, every router, or
        the return route. Provider locations are approximate; the website’s request may take a
        different path.
      </p>
    </section>
  );
}

export function PathEvidenceNotes({ trace }: { trace: PathTrace }) {
  return (
    <>
      <div className="pp-path-truth">
        {trace.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>
      <details className="pp-path-dictionary">
        <summary>
          <CircleHelp aria-hidden="true" /> How to read hops and region labels
        </summary>
        <div>
          <p>
            <strong>RTT</strong> is the round trip from this ProtoPeek process to a responder. A
            difference between adjacent RTTs is not measured link latency.
          </p>
          <p>
            <strong>Timeout</strong> means no matching reply arrived in the probe window. The device
            may still forward traffic.
          </p>
          <p>
            <strong>Multiple responders</strong> at one TTL can be real load balancing (ECMP), not a
            parsing error.
          </p>
          <dl>
            {Object.entries(pathRegionDictionary).map(([code, entry]) => (
              <div key={code}>
                <dt>{code}</dt>
                <dd>
                  {entry.label} · {entry.caveat}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
      <details className="pp-path-raw">
        <summary>Raw normalized evidence</summary>
        <pre>{JSON.stringify(trace, null, 2)}</pre>
      </details>
    </>
  );
}

import {
  ArrowRight,
  CircleHelp,
  LoaderCircle,
  Network,
  Route,
  Save,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { classNames, compactDate } from '@/shared/runtime';

import {
  buildHopRows,
  type PathCapabilities,
  type PathTrace,
  pathRegionDictionary,
  summarizePathTrace,
} from './network-path';
import { fetchPathCapabilities, type PathTraceRequest, traceNetworkPath } from './network-path-api';

export function NetworkPathPanel({ onSaveTrace }: { onSaveTrace?: (trace: PathTrace) => unknown }) {
  const [capabilities, setCapabilities] = useState<PathCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [destination, setDestination] = useState('1.1.1.1');
  const [family, setFamily] = useState<PathTraceRequest['family']>('auto');
  const [method, setMethod] = useState<PathTraceRequest['method']>('auto');
  const [maxHops, setMaxHops] = useState(24);
  const [probesPerHop, setProbesPerHop] = useState(3);
  const [perProbeTimeoutMs, setPerProbeTimeoutMs] = useState(750);
  const [wallTimeoutMs, setWallTimeoutMs] = useState(20_000);
  const [consent, setConsent] = useState(false);
  const [trace, setTrace] = useState<PathTrace | null>(null);
  const [traceError, setTraceError] = useState('');
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(false);
  const traceAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPathCapabilities(controller.signal)
      .then((response) => {
        setCapabilities(response);
        setMaxHops(response.limits.defaultMaxHops);
        setProbesPerHop(response.limits.defaultProbesPerHop);
        setPerProbeTimeoutMs(response.limits.defaultProbeTimeoutMs);
        setWallTimeoutMs(response.limits.defaultWallTimeoutMs);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setCapabilityError(
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'Path capability evidence is unavailable.'
        );
      });
    return () => {
      controller.abort();
      traceAbortRef.current?.abort();
    };
  }, []);

  const availableCapabilities =
    capabilities?.capabilities.filter((capability) => capability.available) ?? [];
  const selectedCapability = availableCapabilities.find((capability) => {
    const methodMatches =
      method === 'auto' ? capability.method === 'udp' : capability.method === method;
    const familyMatches = family === 'auto' || capability.families.includes(family);
    return methodMatches && familyMatches;
  });
  const unavailableReason =
    capabilities?.capabilities.find((capability) => !capability.available)?.reason ?? '';
  const maximumProbes = maxHops * probesPerHop;
  const planValid = Boolean(
    capabilities &&
      Number.isInteger(maxHops) &&
      maxHops >= 1 &&
      maxHops <= capabilities.limits.maxHops &&
      Number.isInteger(probesPerHop) &&
      probesPerHop >= 1 &&
      probesPerHop <= capabilities.limits.maxProbesPerHop &&
      maximumProbes <= capabilities.limits.maxTotalProbes &&
      Number.isFinite(perProbeTimeoutMs) &&
      perProbeTimeoutMs >= capabilities.limits.minProbeTimeoutMs &&
      perProbeTimeoutMs <= capabilities.limits.maxProbeTimeoutMs &&
      Number.isFinite(wallTimeoutMs) &&
      wallTimeoutMs >= 1_000 &&
      wallTimeoutMs <= capabilities.limits.maxWallTimeoutMs
  );

  function updatePlan(update: () => void) {
    if (running) return;
    update();
    setConsent(false);
    setTrace(null);
    setTraceError('');
    setSaved(false);
  }

  async function runTrace() {
    if (!consent || !selectedCapability || !planValid || running || !destination.trim()) return;
    const controller = new AbortController();
    traceAbortRef.current = controller;
    setRunning(true);
    setTrace(null);
    setTraceError('');
    setSaved(false);
    try {
      const result = await traceNetworkPath(
        {
          destination: destination.trim(),
          family,
          method,
          destinationPort: capabilities?.limits.defaultUdpPort ?? 33434,
          maxHops,
          probesPerHop,
          perProbeTimeoutMs,
          wallTimeoutMs,
          consent: { activeProbe: true, publicTarget: true },
        },
        controller.signal
      );
      if (traceAbortRef.current !== controller) return;
      setTrace(result);
    } catch (error) {
      if (traceAbortRef.current !== controller) return;
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        setTraceError('Path trace cancelled.');
      } else {
        setTraceError(
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'Path trace failed.'
        );
      }
    } finally {
      if (traceAbortRef.current === controller) traceAbortRef.current = null;
      setRunning(false);
    }
  }

  return (
    <section className="pp-network-path" aria-labelledby="network-path-title">
      <header className="pp-network-page-heading">
        <div>
          <span className="pp-kicker">Network Path</span>
          <h1 id="network-path-title">See how this machine reaches a target.</h1>
          <p>
            DNS, the kernel-selected next hop, and bounded active hop evidence stay separate so one
            timing is never mistaken for another.
          </p>
        </div>
        {capabilities ? (
          selectedCapability ? (
            <span className="pp-path-capability is-ready">
              <ShieldCheck aria-hidden="true" /> Built in · no elevation
            </span>
          ) : (
            <span className="pp-path-capability is-unavailable">Trace unavailable</span>
          )
        ) : (
          <span className="pp-path-capability">
            <LoaderCircle aria-hidden="true" /> Checking capability
          </span>
        )}
      </header>

      <section className="pp-path-presets" aria-label="Trace target presets">
        <button
          type="button"
          className={destination === '1.1.1.1' ? 'is-selected' : ''}
          disabled={running}
          onClick={() => updatePlan(() => setDestination('1.1.1.1'))}
        >
          <strong>Cloudflare resolver</strong>
          <code>1.1.1.1</code>
          <small>Anycast target · not a fixed datacenter</small>
        </button>
        <button
          type="button"
          className={destination === '8.8.8.8' ? 'is-selected' : ''}
          disabled={running}
          onClick={() => updatePlan(() => setDestination('8.8.8.8'))}
        >
          <strong>Google resolver</strong>
          <code>8.8.8.8</code>
          <small>Anycast target · path can change</small>
        </button>
      </section>

      <div className="pp-path-controls">
        <label className="pp-path-target">
          <span>Hostname or IP</span>
          <input
            value={destination}
            disabled={running}
            onChange={(event) => updatePlan(() => setDestination(event.target.value))}
            spellCheck={false}
            placeholder="service.example.com or 203.0.113.10"
          />
        </label>
        <label>
          <span>Address family</span>
          <select
            value={family}
            disabled={running}
            onChange={(event) =>
              updatePlan(() => setFamily(event.target.value as PathTraceRequest['family']))
            }
          >
            <option value="auto">Auto</option>
            <option value="ipv4">IPv4</option>
            <option value="ipv6">IPv6</option>
          </select>
        </label>
        <label>
          <span>Probe method</span>
          <select
            value={method}
            disabled={running}
            onChange={(event) =>
              updatePlan(() => setMethod(event.target.value as PathTraceRequest['method']))
            }
          >
            <option value="auto">Auto · native UDP</option>
            <option value="udp">UDP</option>
            <option
              value="icmp"
              disabled={!availableCapabilities.some((entry) => entry.method === 'icmp')}
            >
              ICMP{' '}
              {availableCapabilities.some((entry) => entry.method === 'icmp')
                ? ''
                : '· unavailable'}
            </option>
            <option
              value="tcp"
              disabled={!availableCapabilities.some((entry) => entry.method === 'tcp')}
            >
              TCP{' '}
              {availableCapabilities.some((entry) => entry.method === 'tcp') ? '' : '· unavailable'}
            </option>
          </select>
        </label>
        <button
          type="button"
          className={classNames('pp-path-run', running && 'is-cancel')}
          disabled={
            !running && (!consent || !selectedCapability || !planValid || !destination.trim())
          }
          onClick={running ? () => traceAbortRef.current?.abort() : () => void runTrace()}
        >
          {running ? <Square aria-hidden="true" /> : <Route aria-hidden="true" />}
          {running ? 'Cancel trace' : 'Trace path'}
        </button>
      </div>

      <details className="pp-path-plan">
        <summary>Probe plan and limits</summary>
        <div>
          <label>
            Max hops
            <input
              type="number"
              min={1}
              max={capabilities?.limits.maxHops ?? 32}
              value={maxHops}
              disabled={running}
              onChange={(event) => updatePlan(() => setMaxHops(Number(event.target.value)))}
            />
          </label>
          <label>
            Probes / hop
            <input
              type="number"
              min={1}
              max={capabilities?.limits.maxProbesPerHop ?? 4}
              value={probesPerHop}
              disabled={running}
              onChange={(event) => updatePlan(() => setProbesPerHop(Number(event.target.value)))}
            />
          </label>
          <label>
            Probe timeout
            <input
              type="number"
              min={capabilities?.limits.minProbeTimeoutMs ?? 100}
              max={capabilities?.limits.maxProbeTimeoutMs ?? 2_000}
              step={50}
              value={perProbeTimeoutMs}
              disabled={running}
              onChange={(event) =>
                updatePlan(() => setPerProbeTimeoutMs(Number(event.target.value)))
              }
            />
            ms
          </label>
          <label>
            Wall limit
            <input
              type="number"
              min={1}
              max={(capabilities?.limits.maxWallTimeoutMs ?? 30_000) / 1_000}
              value={wallTimeoutMs / 1_000}
              disabled={running}
              onChange={(event) =>
                updatePlan(() => setWallTimeoutMs(Number(event.target.value) * 1_000))
              }
            />
            s
          </label>
        </div>
      </details>

      <div className="pp-path-consent">
        <label>
          <input
            type="checkbox"
            checked={consent}
            disabled={running || !planValid || !selectedCapability || !destination.trim()}
            onChange={(event) => setConsent(event.target.checked)}
          />
          I authorize these active {method === 'auto' ? 'UDP' : method.toUpperCase()} path probes,
          including probes to public Internet targets.
        </label>
        <span>
          {maxHops} hops × {probesPerHop} probes · {maximumProbes} maximum probes ·{' '}
          {perProbeTimeoutMs} ms each · {wallTimeoutMs / 1_000} s wall
        </span>
      </div>

      {capabilities && maximumProbes > capabilities.limits.maxTotalProbes ? (
        <p className="pp-evidence-error" role="alert">
          This {maximumProbes}-probe plan exceeds the {capabilities.limits.maxTotalProbes}-probe
          backend limit. Reduce hops or probes per hop.
        </p>
      ) : null}

      {capabilityError ? (
        <p className="pp-evidence-error" role="alert">
          {capabilityError}
        </p>
      ) : null}
      {!selectedCapability && unavailableReason ? (
        <div className="pp-path-unavailable" role="status">
          <strong>{unavailableReason}</strong>
          <p>
            ProtoPeek never runs a package manager or asks for root/admin. Kernel route lookup stays
            available without active hop probes.
          </p>
        </div>
      ) : null}
      {traceError ? (
        <p className="pp-path-status" role={traceError.endsWith('cancelled.') ? 'status' : 'alert'}>
          {traceError}
        </p>
      ) : null}
      {running ? (
        <p className="pp-path-status" role="status">
          <LoaderCircle aria-hidden="true" /> Running the bounded plan from the ProtoPeek process…
        </p>
      ) : null}

      {trace ? (
        <PathEvidence
          trace={trace}
          onSave={
            onSaveTrace
              ? async () => {
                  try {
                    const result = await onSaveTrace(trace);
                    if (result === false) return;
                    setSaved(true);
                  } catch (error) {
                    setTraceError(
                      error instanceof Error ? error.message : 'Path evidence could not be saved.'
                    );
                  }
                }
              : undefined
          }
          saved={saved}
        />
      ) : running ? null : (
        <PathEmptyState />
      )}
    </section>
  );
}

function PathEmptyState() {
  return (
    <div className="pp-path-empty">
      <Network aria-hidden="true" />
      <div>
        <strong>No active trace yet</strong>
        <p>
          Choose a target, review the fixed plan, authorize it, then trace. Nothing runs on load.
        </p>
      </div>
    </div>
  );
}

function PathEvidence({
  trace,
  onSave,
  saved,
}: {
  trace: PathTrace;
  onSave?: () => unknown;
  saved: boolean;
}) {
  const rows = useMemo(() => buildHopRows(trace), [trace]);
  const summary = useMemo(() => summarizePathTrace(trace), [trace]);
  const interfaceLabel =
    trace.route.interfaceName || `Interface ${trace.route.interfaceIndex || 'unknown'}`;
  return (
    <div className="pp-path-evidence">
      <section className="pp-evidence-spine" aria-label="Network evidence spine">
        <article>
          <span>01</span>
          <div>
            <small>DNS resolution</small>
            <strong>{trace.resolution.pinnedAddress}</strong>
            <p>
              {trace.resolution.source} · {formatMilliseconds(trace.resolution.durationMs)}
            </p>
          </div>
          <ArrowRight aria-hidden="true" />
        </article>
        <article>
          <span>02</span>
          <div>
            <small>Kernel route</small>
            <strong>
              {interfaceLabel} · {trace.route.nextHop || 'on-link / unknown gateway'}
            </strong>
            <p>
              {trace.route.sourceIp || 'source not reported'} · {trace.route.backend}
            </p>
          </div>
          <ArrowRight aria-hidden="true" />
        </article>
        <article>
          <span>03</span>
          <div>
            <small>Active hop trace</small>
            <strong>
              {summary.respondingHopSlots}/{summary.hopSlots} hop slots replied
            </strong>
            <p>
              {summary.responderCount} distinct responders · {trace.backend}
            </p>
          </div>
          <ArrowRight aria-hidden="true" />
        </article>
        <article className={trace.reached ? 'is-reached' : 'is-partial'}>
          <span>04</span>
          <div>
            <small>{trace.reached ? 'Destination reached' : 'Destination not confirmed'}</small>
            <strong>{trace.resolution.pinnedAddress}</strong>
            <p>
              {summary.destinationRTT === null
                ? trace.termination
                : `${formatMilliseconds(summary.destinationRTT)} median RTT`}
            </p>
          </div>
        </article>
      </section>

      <div className="pp-path-result-heading">
        <div>
          <span className="pp-kicker">Observed {compactDate(trace.observedAt)}</span>
          <h2>Hop evidence from this machine</h2>
        </div>
        {onSave ? (
          <button type="button" onClick={() => void onSave()} disabled={saved}>
            <Save aria-hidden="true" /> {saved ? 'Trace saved' : 'Save trace'}
          </button>
        ) : null}
      </div>

      <div className="pp-hop-spine">
        {rows.map((row) => (
          <article key={row.ttl} className={`is-${row.state}`}>
            <span className="pp-hop-ttl">{String(row.ttl).padStart(2, '0')}</span>
            <i aria-hidden="true" />
            <div>
              <header>
                <strong>
                  {row.responders.length
                    ? row.responders.join(' · ')
                    : 'No reply · this hop may still forward traffic'}
                </strong>
                <small>{row.state === 'mixed' ? 'Mixed reply' : row.state}</small>
              </header>
              {row.rtt ? (
                <p>
                  RTT from this machine · min {formatMilliseconds(row.rtt.min)} · median{' '}
                  {formatMilliseconds(row.rtt.median)} · max {formatMilliseconds(row.rtt.max)}
                </p>
              ) : row.responderRTTs.length > 1 ? (
                <ul
                  className="pp-hop-responder-rtts"
                  aria-label={`Hop ${row.ttl} RTT by responder`}
                >
                  {row.responderRTTs.map(({ responder, rtt }) => (
                    <li key={responder}>
                      <code>{responder}</code> · RTT min {formatMilliseconds(rtt.min)} · median{' '}
                      {formatMilliseconds(rtt.median)} · max {formatMilliseconds(rtt.max)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>RTT from this machine · no matching reply</p>
              )}
              <ul className="pp-hop-samples" aria-label={`Hop ${row.ttl} probe samples`}>
                {row.samples.map((sample) => (
                  <li key={sample.sequence} className={`is-${sample.status}`}>
                    #{sample.sequence}{' '}
                    {sample.rttMs === null ? sample.status : formatMilliseconds(sample.rttMs)}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

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
    </div>
  );
}

function formatMilliseconds(value: number) {
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
}

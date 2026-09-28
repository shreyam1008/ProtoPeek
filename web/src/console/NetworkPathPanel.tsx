import { Link } from '@tanstack/react-router';
import { ArrowRight, LoaderCircle, Route, Save, ShieldCheck, Square } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/console/shell/EmptyState';
import { PageHeader } from '@/console/shell/PageHeader';
import { classNames, compactDate } from '@/shared/runtime';
import type { IPAttribution } from './ip-attribution';
import {
  buildHopRows,
  type PathCapabilities,
  type PathTrace,
  summarizePathTrace,
} from './network-path';
import { fetchPathCapabilities, type PathTraceRequest, traceNetworkPath } from './network-path-api';
import { normalizePathDestination, takePathTarget } from './network-path-draft';
import { ProtocolInfo } from './ProtocolInfo';
import { OperationStatus } from './shell/OperationStatus';
import { rememberPathWebsiteTarget } from './website-draft';

const HopAttribution = lazy(() => import('./HopAttribution'));
const NetworkPathMap = lazy(() => import('./NetworkPathMap'));
const PathEvidenceNotes = lazy(() =>
  import('./NetworkPathMap').then((module) => ({ default: module.PathEvidenceNotes }))
);
const NetworkPathGeography = lazy(() => import('./NetworkPathGeography'));

export function NetworkPathPanel({
  onSaveTrace,
  initialDestination,
}: {
  onSaveTrace?: (trace: PathTrace) => unknown;
  initialDestination?: string;
}) {
  const [capabilities, setCapabilities] = useState<PathCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [destination, setDestination] = useState(initialDestination || '1.1.1.1');
  const [family, setFamily] = useState<PathTraceRequest['family']>('auto');
  const [method, setMethod] = useState<PathTraceRequest['method']>('auto');
  const [maxHops, setMaxHops] = useState(24);
  const [probesPerHop, setProbesPerHop] = useState(3);
  const [perProbeTimeoutMs, setPerProbeTimeoutMs] = useState(750);
  const [wallTimeoutMs, setWallTimeoutMs] = useState(20_000);
  const [trace, setTrace] = useState<PathTrace | null>(null);
  const [traceError, setTraceError] = useState('');
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(false);
  const traceAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const savedTarget = takePathTarget();
    const draft = initialDestination || savedTarget;
    if (draft) setDestination(draft);
  }, [initialDestination]);

  useEffect(() => {
    const controller = new AbortController();
    if (capabilityAttempt > 0) setCapabilities(null);
    setCapabilityError('');
    void fetchPathCapabilities(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
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
  }, [capabilityAttempt]);

  const availableCapabilities =
    capabilities?.capabilities.filter(
      (capability) =>
        capability.available && (family === 'auto' || capability.families.includes(family))
    ) ?? [];
  const selectedCapability = [...availableCapabilities]
    .sort(
      (left, right) =>
        ['udp', 'icmp', 'tcp'].indexOf(left.method) - ['udp', 'icmp', 'tcp'].indexOf(right.method)
    )
    .find((capability) => {
      const methodMatches = method === 'auto' || capability.method === method;
      const familyMatches = family === 'auto' || capability.families.includes(family);
      return methodMatches && familyMatches;
    });
  const unavailableReason = capabilities
    ? `No ${method === 'auto' ? 'native' : method.toUpperCase()} path tracer is available for ${family === 'auto' ? 'this platform' : family.toUpperCase()} on this platform.`
    : '';
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

    setTrace(null);
    setTraceError('');
    setSaved(false);
  }

  async function runTrace() {
    if (!selectedCapability || !planValid || running || !destination.trim()) return;
    let target: string;
    try {
      target = normalizePathDestination(destination);
    } catch (error) {
      setTraceError(error instanceof Error ? error.message : 'Enter a hostname or IP address.');
      return;
    }
    const controller = new AbortController();
    traceAbortRef.current = controller;
    setRunning(true);
    setTrace(null);
    setTraceError('');
    setSaved(false);
    try {
      const result = await traceNetworkPath(
        {
          destination: target,
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
      if (controller.signal.aborted) {
        setTraceError('Path trace cancelled.');
        return;
      }
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
      <PageHeader className="pp-network-page-heading">
        <div>
          <h1 id="network-path-title">Network path</h1>
          <p>Measure hops from this PC. Inspect replies, timeouts, and optional provider labels.</p>
        </div>
        <ProtocolInfo protocol="path" />
        {capabilities ? (
          selectedCapability ? (
            <span className="pp-path-capability is-ready">
              <ShieldCheck aria-hidden="true" /> Built in · no elevation
            </span>
          ) : (
            <span className="pp-path-capability is-unavailable">Trace unavailable</span>
          )
        ) : capabilityError ? (
          <span className="pp-path-capability is-unavailable">Capability unavailable</span>
        ) : (
          <span className="pp-path-capability">
            <LoaderCircle aria-hidden="true" /> Checking capability
          </span>
        )}
      </PageHeader>

      <details className="pp-path-target-examples">
        <summary>Example targets · Cloudflare / Google DNS</summary>
        <section className="pp-path-presets" aria-label="Trace target presets">
          {(
            [
              ['Cloudflare', '1.1.1.1', 'not a fixed datacenter'],
              ['Google', '8.8.8.8', 'path can change'],
            ] as const
          ).map(([provider, address, caveat]) => (
            <button
              key={address}
              type="button"
              className={destination === address ? 'is-selected' : ''}
              disabled={running}
              onClick={() => updatePlan(() => setDestination(address))}
            >
              <strong>{provider} resolver</strong>
              <code>{address}</code>
              <small>Anycast target · {caveat}</small>
            </button>
          ))}
        </section>
      </details>

      <div className="pp-path-controls">
        <label className="pp-path-target">
          <span>Hostname or IP</span>
          <input
            value={destination}
            disabled={running}
            onChange={(event) => updatePlan(() => setDestination(event.target.value))}
            spellCheck={false}
            placeholder="example.com, a website URL, or an IP address"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runTrace();
              }
            }}
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
            <option value="auto">
              Auto · native {selectedCapability?.method.toUpperCase() ?? 'probe'}
            </option>
            {(['udp', 'icmp', 'tcp'] as const).map((probeMethod) => {
              const available = availableCapabilities.some((entry) => entry.method === probeMethod);
              return (
                <option key={probeMethod} value={probeMethod} disabled={!available}>
                  {probeMethod.toUpperCase()} {available ? '' : '· unavailable'}
                </option>
              );
            })}
          </select>
        </label>
        <button
          type="button"
          className={classNames('pp-path-run', running && 'is-cancel')}
          disabled={!running && (!selectedCapability || !planValid || !destination.trim())}
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

      <OperationStatus busy={running} label="Tracing network path" />
      <div className="pp-path-consent">
        <div>
          Run sends active{' '}
          {method === 'auto'
            ? (selectedCapability?.method.toUpperCase() ?? 'native')
            : method.toUpperCase()}{' '}
          path probes, including probes to public Internet targets.
        </div>
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
        <div className="pp-evidence-error" role="alert">
          <p>Could not load path tracing capabilities.</p>
          <details>
            <summary>Technical detail</summary>
            {capabilityError}
          </details>
          <button type="button" onClick={() => setCapabilityAttempt((attempt) => attempt + 1)}>
            Retry capability check
          </button>
        </div>
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
          onAttribution={(attribution) => {
            setTrace((current) => (current ? { ...current, attribution } : current));
            setSaved(false);
          }}
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
    <EmptyState title="No active trace yet">
      Enter a website or IP and choose Trace path. The map shows responding routers and round-trip
      times; nothing runs on load.
    </EmptyState>
  );
}

function PathEvidence({
  trace,
  onSave,
  saved,
  onAttribution,
}: {
  trace: PathTrace;
  onSave?: () => unknown;
  saved: boolean;
  onAttribution: (result: IPAttribution) => void;
}) {
  const rows = useMemo(() => buildHopRows(trace), [trace]);
  const summary = useMemo(() => summarizePathTrace(trace), [trace]);
  const interfaceLabel =
    trace.route.interfaceName || `Interface ${trace.route.interfaceIndex || 'unknown'}`;
  return (
    <div className="pp-path-evidence">
      <details className="pp-path-resolution-details">
        <summary>Resolution and route details</summary>
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
      </details>

      <div className="pp-path-result-heading">
        <div>
          <span className="pp-kicker">Observed {compactDate(trace.observedAt)}</span>
          <h2>Hop evidence from this machine</h2>
          <p>
            {trace.reached ? 'Destination reached' : 'Partial path'} · {summary.respondingHopSlots}/
            {summary.hopSlots} responding hop slots
            {summary.destinationRTT === null
              ? ''
              : ` · ${formatMilliseconds(summary.destinationRTT)} median RTT`}
          </p>
        </div>
        {onSave ? (
          <button type="button" onClick={() => void onSave()} disabled={saved}>
            <Save aria-hidden="true" /> {saved ? 'Trace saved' : 'Save trace'}
          </button>
        ) : null}
      </div>

      <Suspense fallback={<p role="status">Preparing the measured hop map…</p>}>
        <NetworkPathMap trace={trace} />
      </Suspense>
      <nav className="pp-path-next-actions" aria-label="Explore this destination">
        <Link to="/network/ports" search={{ host: trace.resolution.pinnedAddress }}>
          Scan destination ports <ArrowRight aria-hidden="true" />
        </Link>
        <Link to="/security" onClick={() => rememberPathWebsiteTarget(trace.resolution.input)}>
          Website response &amp; TLS <ArrowRight aria-hidden="true" />
        </Link>
      </nav>

      <Suspense fallback={<p>Loading optional hop labels…</p>}>
        <HopAttribution
          addresses={rows.flatMap((row) => row.responders)}
          result={trace.attribution}
          onResult={onAttribution}
        />
      </Suspense>

      {trace.attribution ? (
        <Suspense fallback={<p>Preparing the approximate location map…</p>}>
          <NetworkPathGeography trace={trace} />
        </Suspense>
      ) : null}

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
              {row.responders.map((address) => {
                const label = trace.attribution?.entries.find((entry) => entry.ip === address);
                return label ? (
                  <p className="pp-hop-location" key={address}>
                    {address} ·{' '}
                    {label.status === 'observed'
                      ? [
                          label.asn ? `AS${label.asn}` : '',
                          label.isp || label.organization || 'Provider unknown',
                          [label.city, label.region, label.country].filter(Boolean).join(', ') ||
                            'Location unknown',
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : label.note}{' '}
                    {label.status === 'observed'
                      ? `· approximate · ${compactDate(label.observedAt)}${label.cached ? ' · cached' : ''}`
                      : ''}
                  </p>
                ) : null;
              })}
              {row.rtt ? (
                <p>RTT from this machine · {formatRTT(row.rtt)}</p>
              ) : row.responderRTTs.length > 1 ? (
                <ul
                  className="pp-hop-responder-rtts"
                  aria-label={`Hop ${row.ttl} RTT by responder`}
                >
                  {row.responderRTTs.map(({ responder, rtt }) => (
                    <li key={responder}>
                      <code>{responder}</code> · RTT {formatRTT(rtt)}
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

      <Suspense fallback={<p role="status">Loading trace notes and raw evidence…</p>}>
        <PathEvidenceNotes trace={trace} />
      </Suspense>
    </div>
  );
}

function formatMilliseconds(value: number) {
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
}

function formatRTT(rtt: { min: number; median: number; max: number }) {
  return `min ${formatMilliseconds(rtt.min)} · median ${formatMilliseconds(rtt.median)} · max ${formatMilliseconds(rtt.max)}`;
}

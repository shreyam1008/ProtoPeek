import {
  Activity,
  ArrowRight,
  ChevronRight,
  CircleAlert,
  Gauge,
  Globe2,
  Monitor,
  Network,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Square,
  Timer,
  Upload,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { StatusFact } from './evidence/StatusFact';
import {
  fetchThisPCCapabilities,
  fetchThisPCPublicIdentity,
  fetchThisPCSnapshot,
  inspectThisPCActivity,
  sampleThisPCTraffic,
  type ThisPCActivity,
  ThisPCAPIError,
  type ThisPCCapabilities,
  type ThisPCFamily,
  type ThisPCInterface,
  type ThisPCPublicFamilyResult,
  type ThisPCPublicIdentity,
  type ThisPCSnapshot,
  type ThisPCSocket,
  type ThisPCTrafficSample,
} from './this-pc-api';
import {
  createThisPCBenchmarkConfig,
  startThisPCBenchmark,
  type ThisPCBenchmarkControl,
  type ThisPCBenchmarkProfileID,
  type ThisPCBenchmarkSummary,
  thisPCBenchmarkPayloadBytes,
  thisPCBenchmarkProfiles,
} from './this-pc-benchmark';
import './this-pc.css';

type ThisPCView = 'overview' | 'listeners' | 'activity' | 'benchmark';
type Resource<T> =
  | { status: 'loading'; value?: undefined; error?: undefined }
  | { status: 'ready'; value: T; error?: undefined }
  | { status: 'error'; value?: undefined; error: string };

type BenchmarkStage = 'idle' | 'consent' | 'loading' | 'running' | 'stopped' | 'finished' | 'error';

const sectionViews = [
  { id: 'overview', label: 'Overview', icon: Monitor },
  { id: 'listeners', label: 'Listeners', icon: Radio },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'benchmark', label: 'Benchmark', icon: Gauge },
] as const;

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  if (error instanceof ThisPCAPIError) {
    if (error.status === 403) return 'This local inspection is restricted by the running build.';
    if (error.status === 404 || error.status === 501) {
      return 'This capability is not available in the running ProtoPeek build.';
    }
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message.slice(0, 2048) : fallback;
}

function formatDecimalBytes(value: string) {
  const bytes = BigInt(value);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let unit = 0;
  let divisor = BigInt(1);
  while (bytes >= BigInt(1000) * divisor && unit < units.length - 1) {
    divisor *= BigInt(1000);
    unit += 1;
  }
  if (unit === 0) return `${bytes.toString()} B`;
  const tenths = (bytes * BigInt(10)) / divisor;
  return `${(tenths / BigInt(10)).toString()}.${(tenths % BigInt(10)).toString()} ${units[unit]}`;
}

function formatPayloadBytes(value: number) {
  return `${value.toLocaleString('en-US')} bytes (${(value / 1_000_000).toFixed(1)} MB)`;
}

function formatUptime(value?: string) {
  if (!value) return 'Not reported';
  const seconds = BigInt(value);
  const days = seconds / BigInt(86_400);
  const hours = (seconds % BigInt(86_400)) / BigInt(3600);
  const minutes = (seconds % BigInt(3600)) / BigInt(60);
  return `${days.toString()}d ${hours.toString()}h ${minutes.toString()}m`;
}

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function formatEndpoint(endpoint: ThisPCSocket['local']) {
  const address = endpoint.address || (endpoint.wildcard ? '*' : 'not reported');
  const host = address.includes(':') && address !== '*' ? `[${address}]` : address;
  return `${host}:${endpoint.port}`;
}

function formatRate(value?: number) {
  if (value === undefined) return 'Not measured';
  return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} Mbps`;
}

function formatMilliseconds(value?: number) {
  if (value === undefined) return 'Not measured';
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

function formatAverageBitRate(bytes: string, durationMs: number) {
  const bitsPerSecond = (BigInt(bytes) * BigInt(8000)) / BigInt(durationMs);
  if (bitsPerSecond < BigInt(1_000_000)) {
    return `${(Number(bitsPerSecond) / 1000).toFixed(1)} Kbps average`;
  }
  const tenths = (bitsPerSecond * BigInt(10)) / BigInt(1_000_000);
  return `${(tenths / BigInt(10)).toString()}.${(tenths % BigInt(10)).toString()} Mbps average`;
}

function processLabel(socket: ThisPCSocket) {
  if (socket.processes.length) {
    const owners = socket.processes.map((process) => `${process.comm} (PID ${process.pid})`);
    return `${owners.join(', ')}${socket.ownersTruncated ? ', more owners omitted' : ''}`;
  }
  if (socket.ownerStatus === 'restricted') return 'Restricted by the host';
  if (socket.ownerStatus === 'unsupported') return 'Unsupported on this platform';
  return 'No owner found';
}

function listenerExposure(socket: ThisPCSocket) {
  const labels: Record<ThisPCSocket['exposure'], string> = {
    'loopback-only': 'Loopback only',
    'interface-bound': 'Interface bound',
    'all-interfaces': 'All interfaces',
    unknown: 'Unknown',
  };
  return labels[socket.exposure];
}

function InlineConsent({
  title,
  children,
  acknowledged,
  onAcknowledged,
  acknowledgement,
  onConfirm,
  onCancel,
  confirmLabel,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  acknowledged: boolean;
  onAcknowledged: (value: boolean) => void;
  acknowledgement: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
  disabled?: boolean;
}) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => checkboxRef.current?.focus(), []);

  return (
    <section className="this-pc-consent" role="dialog" aria-modal="false" aria-label={title}>
      <header>
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>{title}</strong>
          <span>Nothing starts until you confirm.</span>
        </div>
      </header>
      <div className="this-pc-consent-copy">{children}</div>
      <label>
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledged(event.target.checked)}
        />
        <span>{acknowledgement}</span>
      </label>
      <footer>
        <button type="button" className="this-pc-button is-quiet" onClick={onCancel}>
          Not now
        </button>
        <button
          type="button"
          className="this-pc-button"
          disabled={!acknowledged || disabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </footer>
    </section>
  );
}

function ThisPCSectionTabs({
  active,
  onChange,
  mobile = false,
}: {
  active: ThisPCView;
  onChange: (view: ThisPCView) => void;
  mobile?: boolean;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (current + direction + sectionViews.length) % sectionViews.length;
    const next = sectionViews[nextIndex];
    onChange(next.id);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  }

  if (mobile) {
    return (
      <nav className="this-pc-bottom-tabs" aria-label="This PC mobile sections">
        {sectionViews.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={active === section.id ? 'page' : undefined}
            className={active === section.id ? 'is-active' : undefined}
            onClick={() => onChange(section.id)}
          >
            <section.icon aria-hidden="true" />
            <span>{section.label}</span>
          </button>
        ))}
      </nav>
    );
  }
  return (
    <div className="this-pc-tabs" role="tablist" aria-label="This PC sections">
      {sectionViews.map((section, index) => (
        <button
          key={section.id}
          id={`this-pc-tab-${section.id}`}
          type="button"
          role="tab"
          aria-selected={active === section.id}
          aria-controls={`this-pc-panel-${section.id}`}
          className={active === section.id ? 'is-active' : undefined}
          onClick={() => onChange(section.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          <section.icon aria-hidden="true" />
          <span>{section.label}</span>
        </button>
      ))}
    </div>
  );
}

function EvidenceSpine({
  snapshotReady,
  exposureReady,
  internetReady,
  onChange,
}: {
  snapshotReady: boolean;
  exposureReady: boolean;
  internetReady: boolean;
  onChange: (view: ThisPCView) => void;
}) {
  const steps = [
    { label: 'Device', icon: Monitor, ready: snapshotReady, view: 'overview' as const },
    { label: 'Interfaces', icon: Network, ready: snapshotReady, view: 'overview' as const },
    { label: 'Exposure', icon: ShieldCheck, ready: exposureReady, view: 'listeners' as const },
    { label: 'Internet', icon: Globe2, ready: internetReady, view: 'benchmark' as const },
  ];
  return (
    <ol className="this-pc-evidence-spine" aria-label="Evidence path">
      {steps.map((step, index) => (
        <li key={step.label}>
          <button type="button" onClick={() => onChange(step.view)}>
            <step.icon aria-hidden="true" />
            <span>{step.label}</span>
            <i className={step.ready ? 'is-ready' : undefined} aria-hidden="true" />
            <span className="sr-only">{step.ready ? 'Observed' : 'Not observed'}</span>
          </button>
          {index < steps.length - 1 ? <ArrowRight aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: Resource<ThisPCSnapshot> }) {
  if (snapshot.status === 'loading') {
    return (
      <div className="this-pc-summary this-pc-loading" role="status">
        Reading local machine identity…
      </div>
    );
  }
  if (snapshot.status === 'error') {
    return (
      <div className="this-pc-summary this-pc-error" role="alert">
        <CircleAlert aria-hidden="true" />
        <span>{snapshot.error}</span>
      </div>
    );
  }
  const value = snapshot.value;
  return (
    <section className="this-pc-summary" aria-label="Local machine identity">
      <dl>
        <StatusFact label="Host name" value={value.hostname ?? 'Not reported'} />
        <StatusFact label="OS" value={value.os} />
        <StatusFact label="Architecture" value={value.arch} />
        <StatusFact label="Logical CPUs" value={value.logicalCpus} />
        <StatusFact label="Uptime" value={formatUptime(value.linuxSystem?.uptimeSeconds)} />
        <StatusFact label="Scope" value="Local process/network namespace" />
      </dl>
      <p>{value.scopeNotice}</p>
    </section>
  );
}

function InterfaceRow({ item }: { item: ThisPCInterface }) {
  const up = item.flags.some((flag) => flag.toLowerCase() === 'up');
  return (
    <article className="this-pc-interface-row">
      <div className="this-pc-interface-name">
        <Network aria-hidden="true" />
        <span>
          <strong>{item.name}</strong>
          <small>
            <i className={up ? 'is-up' : undefined} aria-hidden="true" />
            {item.flags.length ? item.flags.join(', ') : 'No flags reported'}
          </small>
        </span>
      </div>
      <div className="this-pc-interface-addresses">
        {item.addresses.length ? (
          item.addresses.map((address) => (
            <span key={`${address.family}-${address.address}-${address.prefix}`}>
              <b>{address.family === 'ipv4' ? 'IPv4' : 'IPv6'}</b>
              <code>
                {address.address}/{address.prefix}
              </code>
              <small>{address.scope}</small>
            </span>
          ))
        ) : (
          <span>
            <b>Address</b>
            <code>Not reported</code>
          </span>
        )}
      </div>
      <div className="this-pc-interface-meta">
        <span>
          <b>MTU</b>
          <code>{item.mtu}</code>
        </span>
        {item.traffic ? (
          <span>
            <b>Counters</b>
            <code>
              RX {formatDecimalBytes(item.traffic.receivedBytes)} · TX{' '}
              {formatDecimalBytes(item.traffic.transmittedBytes)}
            </code>
          </span>
        ) : null}
      </div>
      <ChevronRight aria-hidden="true" />
    </article>
  );
}

function InterfacesPanel({ snapshot }: { snapshot: Resource<ThisPCSnapshot> }) {
  return (
    <section
      className="this-pc-panel this-pc-interfaces"
      aria-labelledby="this-pc-interfaces-title"
    >
      <header>
        <div>
          <h2 id="this-pc-interfaces-title">Interfaces</h2>
          <p>Addresses and counters reported by the local process/network namespace.</p>
        </div>
        {snapshot.status === 'ready' ? (
          <span>{snapshot.value.interfaces.length} observed</span>
        ) : null}
      </header>
      {snapshot.status === 'ready' ? (
        snapshot.value.interfaces.length ? (
          <div className="this-pc-interface-list">
            {snapshot.value.interfaces.map((item) => (
              <InterfaceRow key={item.index} item={item} />
            ))}
          </div>
        ) : (
          <p className="this-pc-empty">
            No interfaces were reported by this process/network namespace.
          </p>
        )
      ) : (
        <p className="this-pc-empty">
          {snapshot.status === 'error'
            ? 'Interface evidence is unavailable.'
            : 'Reading interfaces…'}
        </p>
      )}
    </section>
  );
}

function PublicFamily({ result }: { result: ThisPCPublicFamilyResult }) {
  return (
    <article className={`this-pc-public-family is-${result.status}`}>
      <header>
        <strong>Public {result.family === 'ipv4' ? 'IPv4' : 'IPv6'}</strong>
        <span>{result.status === 'ok' ? 'Observed' : 'Unavailable'}</span>
      </header>
      <code>{result.address ?? '—'}</code>
      {result.error ? <p>{result.error}</p> : null}
      {result.bgpOriginNetwork ? (
        <dl>
          <div>
            <dt>{result.bgpOriginNetwork.label}</dt>
            <dd>{result.bgpOriginNetwork.prefix}</dd>
          </div>
          <div>
            <dt>ASN</dt>
            <dd>{result.bgpOriginNetwork.asn}</dd>
          </div>
          {result.bgpOriginNetwork.name ? (
            <div>
              <dt>BGP origin registry name</dt>
              <dd>{result.bgpOriginNetwork.name}</dd>
            </div>
          ) : null}
          <div>
            <dt>Evidence</dt>
            <dd>Provider-reported by Team Cymru</dd>
          </div>
        </dl>
      ) : (
        <small>
          BGP origin network: {result.bgpOriginError || result.bgpOriginStatus.replace('-', ' ')}
        </small>
      )}
    </article>
  );
}

function PublicIdentityCard({
  capabilities,
  state,
  consentOpen,
  acknowledged,
  families,
  onOpen,
  onAcknowledged,
  onFamilies,
  onConfirm,
  onCancel,
}: {
  capabilities: Resource<ThisPCCapabilities>;
  state: Resource<ThisPCPublicIdentity> | { status: 'idle' };
  consentOpen: boolean;
  acknowledged: boolean;
  families: ThisPCFamily[];
  onOpen: () => void;
  onAcknowledged: (value: boolean) => void;
  onFamilies: (families: ThisPCFamily[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const publicCapability =
    capabilities.status === 'ready' ? capabilities.value.publicIdentity : null;
  const disabled = !publicCapability?.supported;
  return (
    <section className="this-pc-panel this-pc-public" aria-labelledby="this-pc-public-title">
      <header>
        <div>
          <h2 id="this-pc-public-title">Public identity</h2>
          <p>Your public addresses and BGP origin evidence stay hidden until you check.</p>
        </div>
      </header>
      {state.status === 'ready' ? (
        <div className="this-pc-public-results">
          {state.value.families.map((family) => (
            <PublicFamily key={family.family} result={family} />
          ))}
          <p>{state.value.externalRequestDisclosure}</p>
        </div>
      ) : state.status === 'loading' ? (
        <p className="this-pc-empty" role="status">
          Contacting the disclosed public providers once…
        </p>
      ) : state.status === 'error' ? (
        <p className="this-pc-inline-error" role="alert">
          {state.error}
        </p>
      ) : (
        <dl className="this-pc-public-placeholder">
          <div>
            <dt>Public IPv4</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Public IPv6</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>BGP origin network</dt>
            <dd>—</dd>
          </div>
        </dl>
      )}
      {consentOpen ? (
        <InlineConsent
          title="Check public IPv4 and IPv6"
          acknowledged={acknowledged}
          onAcknowledged={onAcknowledged}
          acknowledgement="I understand this makes the disclosed external requests once."
          onConfirm={onConfirm}
          onCancel={onCancel}
          confirmLabel="Check selected families"
          disabled={!families.length}
        >
          <p>
            ProtoPeek will ask ipify for each selected address family. For a returned address, it
            may ask Team Cymru for provider-reported BGP origin network evidence.
          </p>
          <p>{publicCapability?.dnsResolverDisclosure}</p>
          <fieldset>
            <legend>Address families</legend>
            {(['ipv4', 'ipv6'] as const).map((family) => (
              <label key={family}>
                <input
                  type="checkbox"
                  checked={families.includes(family)}
                  onChange={(event) =>
                    onFamilies(
                      event.target.checked
                        ? [...families, family]
                        : families.filter((value) => value !== family)
                    )
                  }
                />
                {family === 'ipv4' ? 'IPv4' : 'IPv6'}
              </label>
            ))}
          </fieldset>
        </InlineConsent>
      ) : (
        <button
          type="button"
          className="this-pc-button is-wide"
          onClick={onOpen}
          disabled={disabled}
        >
          <Globe2 aria-hidden="true" />
          {state.status === 'ready' ? 'Check public identity again' : 'Check public identity'}
        </button>
      )}
      <small className="this-pc-action-note">
        {disabled
          ? publicCapability?.reason || 'Public identity capability is unavailable.'
          : 'No external request is made on page load.'}
      </small>
    </section>
  );
}

function BenchmarkSummaryCard({ onOpen }: { onOpen: () => void }) {
  const profile = thisPCBenchmarkProfiles.quick;
  const maximum = thisPCBenchmarkPayloadBytes('quick', false);
  return (
    <section
      className="this-pc-panel this-pc-benchmark-card"
      aria-labelledby="benchmark-card-title"
    >
      <header>
        <div>
          <h2 id="benchmark-card-title">
            Benchmark <small>(internet path quality)</small>
          </h2>
          <p>Idle until you consent. Results are not stored.</p>
        </div>
      </header>
      <dl>
        <div>
          <dt>Provider</dt>
          <dd>Cloudflare edge</dd>
        </div>
        <div>
          <dt>Profile</dt>
          <dd>Quick · download only by default</dd>
        </div>
        <div>
          <dt>Max planned payload</dt>
          <dd>{formatPayloadBytes(maximum)}</dd>
        </div>
        <div>
          <dt>Wall guard</dt>
          <dd>{profile.wallLimitMs / 1000} seconds</dd>
        </div>
      </dl>
      <button type="button" className="this-pc-button is-wide" onClick={onOpen}>
        <Gauge aria-hidden="true" /> Run bounded benchmark
      </button>
      <small className="this-pc-action-note">
        Single-flow HTTPS quality from this browser to Cloudflare edge; not host throughput or line
        speed.
      </small>
    </section>
  );
}

function BoundariesCard() {
  return (
    <section
      className="this-pc-panel this-pc-boundaries"
      aria-labelledby="this-pc-boundaries-title"
    >
      <header>
        <h2 id="this-pc-boundaries-title">What this view does not do</h2>
      </header>
      <ul>
        <li>Does not scan or probe the network automatically.</li>
        <li>Does not prove a local listener is reachable from the internet.</li>
        <li>Does not collect or store This PC evidence in browser storage.</li>
        <li>Shows only information gathered on demand in this process/network namespace.</li>
      </ul>
    </section>
  );
}

function ActivityConsent({
  acknowledged,
  purpose,
  onAcknowledged,
  onConfirm,
  onCancel,
}: {
  acknowledged: boolean;
  purpose: 'listeners' | 'connections';
  onAcknowledged: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <InlineConsent
      title={purpose === 'listeners' ? 'Inspect local listeners' : 'Inspect current connections'}
      acknowledged={acknowledged}
      onAcknowledged={onAcknowledged}
      acknowledgement="I understand this reads a one-time local socket snapshot."
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmLabel="Inspect once"
    >
      <p>
        This reads local listeners and current connections visible to the ProtoPeek process/network
        namespace at one moment. It does not send network probes.
      </p>
      <p>Process labels are best-effort local evidence and may be absent or restricted.</p>
    </InlineConsent>
  );
}

function SocketTable({
  sockets,
  kind,
}: {
  sockets: ThisPCSocket[];
  kind: 'listeners' | 'connections';
}) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(50);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sockets;
    return sockets.filter((socket) =>
      [
        socket.protocol,
        socket.state,
        formatEndpoint(socket.local),
        formatEndpoint(socket.remote),
        socket.exposure,
        socket.ownerStatus,
        ...socket.processes.flatMap((process) => [process.comm, String(process.pid)]),
      ].some((value) => value.toLowerCase().includes(needle))
    );
  }, [query, sockets]);

  if (!sockets.length) {
    return (
      <p className="this-pc-empty">
        No {kind === 'listeners' ? 'local listeners' : 'current connections'} were observed in this
        process/network namespace at that moment.
      </p>
    );
  }
  const visible = filtered.slice(0, shown);
  const keyOccurrences = new Map<string, number>();
  const keyedVisible = visible.map((socket) => {
    const base = `${socket.protocol}-${formatEndpoint(socket.local)}-${formatEndpoint(socket.remote)}-${socket.state}-${socket.processes.map((process) => `${process.pid}:${process.comm}`).join(',')}`;
    const occurrence = keyOccurrences.get(base) ?? 0;
    keyOccurrences.set(base, occurrence + 1);
    return { key: `${base}-${occurrence}`, socket };
  });
  return (
    <div className="this-pc-table-region">
      <div className="this-pc-table-tools">
        <label>
          <span className="sr-only">Filter {kind}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(50);
            }}
            placeholder={`Filter ${kind}`}
          />
        </label>
        <span>
          Showing {visible.length} of {filtered.length}
          {filtered.length !== sockets.length ? ` filtered from ${sockets.length}` : ''}
        </span>
      </div>
      <div className="this-pc-table-wrap">
        <table className="this-pc-table">
          <thead>
            <tr>
              <th>Protocol</th>
              <th>Local endpoint</th>
              {kind === 'connections' ? <th>Remote endpoint</th> : null}
              <th>State</th>
              <th>Process</th>
              {kind === 'listeners' ? <th>Bind scope</th> : null}
            </tr>
          </thead>
          <tbody>
            {keyedVisible.map(({ key, socket }) => (
              <tr key={key}>
                <td data-label="Protocol">
                  <code>{socket.protocol.toUpperCase()}</code>
                </td>
                <td data-label="Local endpoint">
                  <code>{formatEndpoint(socket.local)}</code>
                </td>
                {kind === 'connections' ? (
                  <td data-label="Remote endpoint">
                    <code>{formatEndpoint(socket.remote)}</code>
                  </td>
                ) : null}
                <td data-label="State">{socket.state || 'Not reported'}</td>
                <td data-label="Process">{processLabel(socket)}</td>
                {kind === 'listeners' ? (
                  <td data-label="Bind scope">{listenerExposure(socket)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length < filtered.length ? (
        <button
          type="button"
          className="this-pc-button is-quiet this-pc-show-more"
          onClick={() => setShown((current) => Math.min(current + 50, filtered.length))}
        >
          Show 50 more
        </button>
      ) : null}
    </div>
  );
}

function ActivityNotes({ activity }: { activity: ThisPCActivity }) {
  return (
    <aside className="this-pc-notes">
      <p>
        Backend result truncated: {activity.truncated ? 'yes' : 'no'} · observed{' '}
        {activity.listeners.length + activity.connections.length} of at most{' '}
        {activity.limits.maxSockets} sockets.
      </p>
      {activity.truncated ? (
        <p>
          Results reached a local bound: at most {activity.limits.maxSockets} sockets within{' '}
          {activity.limits.wallTimeMs} ms.
        </p>
      ) : null}
      {activity.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </aside>
  );
}

function ListenersView({
  capabilities,
  activity,
  consentOpen,
  acknowledged,
  onOpen,
  onAcknowledged,
  onConfirm,
  onCancel,
}: {
  capabilities: Resource<ThisPCCapabilities>;
  activity: Resource<ThisPCActivity> | { status: 'idle' };
  consentOpen: boolean;
  acknowledged: boolean;
  onOpen: () => void;
  onAcknowledged: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const capability = capabilities.status === 'ready' ? capabilities.value.activity : null;
  return (
    <section className="this-pc-panel this-pc-workspace-panel" aria-labelledby="listeners-title">
      <header>
        <div>
          <h2 id="listeners-title">Local listeners</h2>
          <p>What this process/network namespace reports as bound locally at one moment.</p>
        </div>
        {!consentOpen ? (
          <button
            type="button"
            className="this-pc-button"
            disabled={!capability?.supported || activity.status === 'loading'}
            onClick={onOpen}
          >
            <Radio aria-hidden="true" />
            {activity.status === 'ready' ? 'Inspect again' : 'Inspect local listeners'}
          </button>
        ) : null}
      </header>
      {consentOpen ? (
        <ActivityConsent
          acknowledged={acknowledged}
          purpose="listeners"
          onAcknowledged={onAcknowledged}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ) : activity.status === 'ready' ? (
        <>
          <SocketTable
            key={`listeners-${activity.value.observedAt}`}
            sockets={activity.value.listeners}
            kind="listeners"
          />
          <ActivityNotes activity={activity.value} />
          <p className="this-pc-limitation">
            A wildcard local bind does not prove reachability beyond this machine.
          </p>
        </>
      ) : activity.status === 'loading' ? (
        <p className="this-pc-empty" role="status">
          Reading one local socket snapshot…
        </p>
      ) : activity.status === 'error' ? (
        <p className="this-pc-inline-error" role="alert">
          {activity.error}
        </p>
      ) : (
        <p className="this-pc-empty">
          Not inspected. No local listener or process information is read on page load.
          {!capability?.supported && capability?.reason ? ` ${capability.reason}` : ''}
        </p>
      )}
    </section>
  );
}

function TrafficSamplePanel({
  capabilities,
  state,
  duration,
  onDuration,
  onSample,
}: {
  capabilities: Resource<ThisPCCapabilities>;
  state: Resource<ThisPCTrafficSample> | { status: 'idle' };
  duration: 500 | 1000 | 2000;
  onDuration: (duration: 500 | 1000 | 2000) => void;
  onSample: () => void;
}) {
  const capability = capabilities.status === 'ready' ? capabilities.value.trafficSample : null;
  const durations = capability?.durationsMs ?? [];
  return (
    <section className="this-pc-panel this-pc-traffic" aria-labelledby="traffic-sample-title">
      <header>
        <div>
          <h2 id="traffic-sample-title">One-shot interface traffic sample</h2>
          <p>
            Reads local interface counters twice; no background sampling and no per-process claim.
          </p>
        </div>
        <div className="this-pc-sample-actions">
          <label>
            <span>Duration</span>
            <select
              aria-label="Traffic sample duration"
              value={duration}
              disabled={!capability?.supported || state.status === 'loading'}
              onChange={(event) => onDuration(Number(event.target.value) as 500 | 1000 | 2000)}
            >
              {durations.map((item) => (
                <option key={item} value={item}>
                  {item} ms
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="this-pc-button"
            disabled={!capability?.supported || state.status === 'loading'}
            onClick={onSample}
          >
            <Timer aria-hidden="true" /> {state.status === 'loading' ? 'Sampling…' : 'Sample once'}
          </button>
        </div>
      </header>
      {state.status === 'ready' ? (
        <div className="this-pc-traffic-results">
          {state.value.interfaces.map((item) => (
            <article key={item.name}>
              <header>
                <strong>{item.name}</strong>
                <span>{item.status.replace('-', ' ')}</span>
              </header>
              {item.counters ? (
                <dl>
                  <div>
                    <dt>Received delta</dt>
                    <dd>{formatDecimalBytes(item.counters.receivedBytes)}</dd>
                  </div>
                  <div>
                    <dt>Transmitted delta</dt>
                    <dd>{formatDecimalBytes(item.counters.transmittedBytes)}</dd>
                  </div>
                  <div>
                    <dt>Average RX rate</dt>
                    <dd>
                      {formatAverageBitRate(item.counters.receivedBytes, state.value.durationMs)}
                    </dd>
                  </div>
                  <div>
                    <dt>Average TX rate</dt>
                    <dd>
                      {formatAverageBitRate(item.counters.transmittedBytes, state.value.durationMs)}
                    </dd>
                  </div>
                  <div>
                    <dt>RX packets</dt>
                    <dd>{item.counters.receivedPackets}</dd>
                  </div>
                  <div>
                    <dt>TX packets</dt>
                    <dd>{item.counters.transmittedPackets}</dd>
                  </div>
                </dl>
              ) : (
                <p>No delta is reported for this interface state.</p>
              )}
            </article>
          ))}
          <small>
            {state.value.durationMs} ms local sample · finished{' '}
            {formatObservedAt(state.value.finishedAt)}
          </small>
        </div>
      ) : state.status === 'error' ? (
        <p className="this-pc-inline-error" role="alert">
          {state.error}
        </p>
      ) : state.status === 'idle' ? (
        <p className="this-pc-empty">
          No traffic sample has been requested.
          {!capability?.supported && capability?.reason ? ` ${capability.reason}` : ''}
        </p>
      ) : (
        <p className="this-pc-empty" role="status">
          Waiting for the bounded local sample…
        </p>
      )}
    </section>
  );
}

function ActivityView({
  capabilities,
  activity,
  consentOpen,
  acknowledged,
  onOpen,
  onAcknowledged,
  onConfirm,
  onCancel,
  traffic,
  duration,
  onDuration,
  onSample,
}: {
  capabilities: Resource<ThisPCCapabilities>;
  activity: Resource<ThisPCActivity> | { status: 'idle' };
  consentOpen: boolean;
  acknowledged: boolean;
  onOpen: () => void;
  onAcknowledged: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  traffic: Resource<ThisPCTrafficSample> | { status: 'idle' };
  duration: 500 | 1000 | 2000;
  onDuration: (duration: 500 | 1000 | 2000) => void;
  onSample: () => void;
}) {
  const capability = capabilities.status === 'ready' ? capabilities.value.activity : null;
  return (
    <div className="this-pc-stack">
      <section
        className="this-pc-panel this-pc-workspace-panel"
        aria-labelledby="connections-title"
      >
        <header>
          <div>
            <h2 id="connections-title">Current connections</h2>
            <p>A one-time socket view initiated locally; it is not a background monitor.</p>
          </div>
          {!consentOpen ? (
            <button
              type="button"
              className="this-pc-button"
              disabled={!capability?.supported || activity.status === 'loading'}
              onClick={onOpen}
            >
              <Activity aria-hidden="true" />
              {activity.status === 'ready' ? 'Observe again' : 'Inspect current connections'}
            </button>
          ) : null}
        </header>
        {consentOpen ? (
          <ActivityConsent
            acknowledged={acknowledged}
            purpose="connections"
            onAcknowledged={onAcknowledged}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ) : activity.status === 'ready' ? (
          <>
            <SocketTable
              key={`connections-${activity.value.observedAt}`}
              sockets={activity.value.connections}
              kind="connections"
            />
            <ActivityNotes activity={activity.value} />
          </>
        ) : activity.status === 'loading' ? (
          <p className="this-pc-empty" role="status">
            Reading one local socket snapshot…
          </p>
        ) : activity.status === 'error' ? (
          <p className="this-pc-inline-error" role="alert">
            {activity.error}
          </p>
        ) : (
          <p className="this-pc-empty">
            Not inspected. No current-connection or process information is read on page load.
          </p>
        )}
      </section>
      <TrafficSamplePanel
        capabilities={capabilities}
        state={traffic}
        duration={duration}
        onDuration={onDuration}
        onSample={onSample}
      />
    </div>
  );
}

function BenchmarkResults({ summary }: { summary: ThisPCBenchmarkSummary }) {
  const rows = [
    ['Download sample', formatRate(summary.download)],
    ['Upload sample', formatRate(summary.upload)],
    ['Idle latency', formatMilliseconds(summary.latency)],
    ['Idle jitter', formatMilliseconds(summary.jitter)],
    ['Latency during download', formatMilliseconds(summary.downLoadedLatency)],
    ['Latency during upload', formatMilliseconds(summary.upLoadedLatency)],
  ];
  return (
    <dl className="this-pc-benchmark-results">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function BenchmarkView({
  stage,
  summary,
  phase,
  message,
  profileID,
  uploadEnabled,
  acknowledged,
  onOpen,
  onProfile,
  onUpload,
  onAcknowledged,
  onStart,
  onCancel,
  onStop,
}: {
  stage: BenchmarkStage;
  summary: ThisPCBenchmarkSummary;
  phase: string;
  message: string;
  profileID: ThisPCBenchmarkProfileID;
  uploadEnabled: boolean;
  acknowledged: boolean;
  onOpen: () => void;
  onProfile: (profile: ThisPCBenchmarkProfileID) => void;
  onUpload: (enabled: boolean) => void;
  onAcknowledged: (acknowledged: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
  onStop: () => void;
}) {
  const profile = thisPCBenchmarkProfiles[profileID];
  const config = createThisPCBenchmarkConfig(profileID, uploadEnabled);
  const payload = thisPCBenchmarkPayloadBytes(profileID, uploadEnabled);
  return (
    <div className="this-pc-benchmark-layout">
      <section className="this-pc-panel this-pc-benchmark-main" aria-labelledby="benchmark-title">
        <header>
          <div>
            <h2 id="benchmark-title">Bounded connection benchmark</h2>
            <p>
              Single-flow HTTPS quality from this browser to Cloudflare edge; this is not host
              throughput or a line-speed claim.
            </p>
          </div>
          {stage === 'running' || stage === 'loading' ? (
            <button type="button" className="this-pc-button is-stop" onClick={onStop}>
              <Square aria-hidden="true" /> Stop after current measurement
            </button>
          ) : null}
        </header>

        {stage === 'consent' ? (
          <InlineConsent
            title="Run one bounded Cloudflare benchmark"
            acknowledged={acknowledged}
            onAcknowledged={onAcknowledged}
            acknowledgement="I understand this sends the selected synthetic traffic to Cloudflare once."
            onConfirm={onStart}
            onCancel={onCancel}
            confirmLabel="Start one run"
          >
            <p>
              Cloudflare sees your public IP and the synthetic HTTPS measurement requests, and may
              retain ordinary service logs. ProtoPeek disables the engine's dedicated
              per-measurement and final-results logging endpoints.
            </p>
            <p>
              The upstream engine would otherwise submit completed results. ProtoPeek sets both
              logging endpoints to null for this run. Results stay in memory and disappear when this
              page closes.
            </p>
            <p>
              ProtoPeek does not add collected PC evidence to benchmark requests, but the browser
              may send ordinary request metadata such as its local origin.
            </p>
            <fieldset className="this-pc-profile-options">
              <legend>Run profile</legend>
              {(
                Object.values(thisPCBenchmarkProfiles) as Array<
                  (typeof thisPCBenchmarkProfiles)[ThisPCBenchmarkProfileID]
                >
              ).map((item) => (
                <label key={item.id}>
                  <input
                    type="radio"
                    name="this-pc-benchmark-profile"
                    value={item.id}
                    checked={profileID === item.id}
                    onChange={() => onProfile(item.id)}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      {item.wallLimitMs / 1000}s wall ·{' '}
                      {formatPayloadBytes(thisPCBenchmarkPayloadBytes(item.id, false))}{' '}
                      download-only
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="this-pc-upload-option">
              <input
                type="checkbox"
                checked={uploadEnabled}
                onChange={(event) => onUpload(event.target.checked)}
              />
              <Upload aria-hidden="true" />
              <span>
                <strong>Include upload samples</strong>
                <small>Off by default. Adds synthetic POST payloads.</small>
              </span>
            </label>
            <dl className="this-pc-budget-preview">
              <div>
                <dt>Maximum planned payload</dt>
                <dd>{formatPayloadBytes(payload)}</dd>
              </div>
              <div>
                <dt>Largest planned item</dt>
                <dd>{formatPayloadBytes(profile.largestItemBytes)}</dd>
              </div>
              <div>
                <dt>Wall guard</dt>
                <dd>{profile.wallLimitMs / 1000} seconds</dd>
              </div>
            </dl>
            <p className="this-pc-confidence-note">{profile.confidence}</p>
            <small>
              The configured profile starts with {profile.latencyPackets} unloaded-latency probes.
              The planned payload cap counts configured download/upload bodies; it excludes HTTP/TLS
              overhead plus zero-byte unloaded and loaded-latency probes. Slow paths can finish
              early; the wall guard pauses further work but does not promise browser-level abortion
              of an already-started request.
            </small>
          </InlineConsent>
        ) : stage === 'idle' ? (
          <div className="this-pc-benchmark-idle">
            <Gauge aria-hidden="true" />
            <h3>Nothing runs until you review the exact budget.</h3>
            <p>Download-only is the default. Upload is a separate opt-in inside the run preview.</p>
            <button type="button" className="this-pc-button" onClick={onOpen}>
              <Play aria-hidden="true" /> Review and run
            </button>
          </div>
        ) : (
          <div className="this-pc-benchmark-live" aria-live="polite">
            <div className="this-pc-benchmark-state">
              <i className={stage === 'running' ? 'is-running' : undefined} aria-hidden="true" />
              <span>
                <strong>
                  {stage === 'loading'
                    ? 'Loading the benchmark engine after consent'
                    : stage === 'running'
                      ? `Measuring ${phase || 'connection quality'}`
                      : stage === 'finished'
                        ? 'One bounded run finished'
                        : stage === 'stopped'
                          ? 'Further measurements paused'
                          : 'Benchmark could not finish'}
                </strong>
                <small>{message || 'Results update after each completed measurement.'}</small>
              </span>
            </div>
            <BenchmarkResults summary={summary} />
            {stage === 'finished' || stage === 'stopped' || stage === 'error' ? (
              <button type="button" className="this-pc-button is-quiet" onClick={onOpen}>
                Review a new one-run budget
              </button>
            ) : null}
          </div>
        )}
      </section>

      <aside className="this-pc-panel this-pc-benchmark-contract">
        <h2>Run contract</h2>
        <dl>
          <div>
            <dt>Engine</dt>
            <dd>@cloudflare/speedtest 1.12.1</dd>
          </div>
          <div>
            <dt>Start</dt>
            <dd>Explicit consent; auto-start disabled</dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{profile.label}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{uploadEnabled ? 'Download + opted-in upload' : 'Download only'}</dd>
          </div>
          <div>
            <dt>Payload cap</dt>
            <dd>{formatPayloadBytes(payload)}</dd>
          </div>
          <div>
            <dt>Request guard</dt>
            <dd>{Number(config.bandwidthAbortRequestDuration) / 1000} seconds</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>Memory only</dd>
          </div>
        </dl>
        <p>
          Stop uses the library's pause control. ProtoPeek does not claim a general hard-cancel API
          or a measurement of full line capacity.
        </p>
      </aside>
    </div>
  );
}

export function ThisPC() {
  const [view, setView] = useState<ThisPCView>('overview');
  const [capabilities, setCapabilities] = useState<Resource<ThisPCCapabilities>>({
    status: 'loading',
  });
  const [snapshot, setSnapshot] = useState<Resource<ThisPCSnapshot>>({ status: 'loading' });
  const [activity, setActivity] = useState<Resource<ThisPCActivity> | { status: 'idle' }>({
    status: 'idle',
  });
  const [activityConsent, setActivityConsent] = useState(false);
  const [activityAcknowledged, setActivityAcknowledged] = useState(false);
  const [activityPurpose, setActivityPurpose] = useState<'listeners' | 'connections'>('listeners');
  const [traffic, setTraffic] = useState<Resource<ThisPCTrafficSample> | { status: 'idle' }>({
    status: 'idle',
  });
  const [trafficDuration, setTrafficDuration] = useState<500 | 1000 | 2000>(1000);
  const [publicIdentity, setPublicIdentity] = useState<
    Resource<ThisPCPublicIdentity> | { status: 'idle' }
  >({ status: 'idle' });
  const [publicConsent, setPublicConsent] = useState(false);
  const [publicAcknowledged, setPublicAcknowledged] = useState(false);
  const [publicFamilies, setPublicFamilies] = useState<ThisPCFamily[]>(['ipv4', 'ipv6']);
  const [benchmarkStage, setBenchmarkStage] = useState<BenchmarkStage>('idle');
  const [benchmarkSummary, setBenchmarkSummary] = useState<ThisPCBenchmarkSummary>({});
  const [benchmarkPhase, setBenchmarkPhase] = useState('');
  const [benchmarkMessage, setBenchmarkMessage] = useState('');
  const [benchmarkProfile, setBenchmarkProfile] = useState<ThisPCBenchmarkProfileID>('quick');
  const [benchmarkUpload, setBenchmarkUpload] = useState(false);
  const [benchmarkAcknowledged, setBenchmarkAcknowledged] = useState(false);
  const snapshotControllerRef = useRef<AbortController | null>(null);
  const actionControllerRef = useRef<AbortController | null>(null);
  const benchmarkControlRef = useRef<ThisPCBenchmarkControl | null>(null);
  const benchmarkControllerRef = useRef<AbortController | null>(null);

  const loadSnapshot = useCallback(() => {
    snapshotControllerRef.current?.abort();
    const controller = new AbortController();
    snapshotControllerRef.current = controller;
    setSnapshot({ status: 'loading' });
    void fetchThisPCSnapshot(controller.signal).then(
      (value) => setSnapshot({ status: 'ready', value }),
      (error: unknown) => {
        const message = errorMessage(error, 'Local machine snapshot failed.');
        if (message) setSnapshot({ status: 'error', error: message });
      }
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchThisPCCapabilities(controller.signal).then(
      (value) => {
        setCapabilities({ status: 'ready', value });
        const durations = value.trafficSample.durationsMs;
        setTrafficDuration((current) =>
          durations.length && !durations.includes(current) ? durations[0] : current
        );
      },
      (error: unknown) => {
        const message = errorMessage(error, 'This PC capabilities could not be loaded.');
        if (message) setCapabilities({ status: 'error', error: message });
      }
    );
    loadSnapshot();
    return () => {
      controller.abort();
      snapshotControllerRef.current?.abort();
      actionControllerRef.current?.abort();
      benchmarkControllerRef.current?.abort();
      benchmarkControlRef.current?.pause();
    };
  }, [loadSnapshot]);

  function openActivityConsent(purpose: 'listeners' | 'connections') {
    setActivityPurpose(purpose);
    setActivityAcknowledged(false);
    setActivityConsent(true);
  }

  function inspectActivity() {
    setActivityConsent(false);
    setActivityAcknowledged(false);
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    actionControllerRef.current = controller;
    setActivity({ status: 'loading' });
    void inspectThisPCActivity(controller.signal).then(
      (value) => setActivity({ status: 'ready', value }),
      (error: unknown) => {
        const message = errorMessage(error, 'Local activity inspection failed.');
        if (message) setActivity({ status: 'error', error: message });
      }
    );
  }

  function sampleTraffic() {
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    actionControllerRef.current = controller;
    setTraffic({ status: 'loading' });
    void sampleThisPCTraffic(trafficDuration, controller.signal).then(
      (value) => setTraffic({ status: 'ready', value }),
      (error: unknown) => {
        const message = errorMessage(error, 'Local traffic sample failed.');
        if (message) setTraffic({ status: 'error', error: message });
      }
    );
  }

  function checkPublicIdentity() {
    setPublicConsent(false);
    setPublicAcknowledged(false);
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    actionControllerRef.current = controller;
    setPublicIdentity({ status: 'loading' });
    void fetchThisPCPublicIdentity(publicFamilies, controller.signal).then(
      (value) => setPublicIdentity({ status: 'ready', value }),
      (error: unknown) => {
        const message = errorMessage(error, 'Public identity check failed.');
        if (message) setPublicIdentity({ status: 'error', error: message });
      }
    );
  }

  function openBenchmark() {
    benchmarkControllerRef.current?.abort();
    benchmarkControlRef.current?.pause();
    benchmarkControlRef.current = null;
    setView('benchmark');
    setBenchmarkStage('consent');
    setBenchmarkAcknowledged(false);
    setBenchmarkMessage('');
  }

  async function startBenchmark() {
    benchmarkControllerRef.current?.abort();
    const controller = new AbortController();
    benchmarkControllerRef.current = controller;
    setBenchmarkStage('loading');
    setBenchmarkSummary({});
    setBenchmarkPhase('');
    setBenchmarkMessage('The engine is imported only now, after consent.');
    try {
      const control = await startThisPCBenchmark(benchmarkProfile, benchmarkUpload, {
        signal: controller.signal,
        onRunningChange(running) {
          if (running) {
            setBenchmarkStage('running');
            setBenchmarkMessage('One bounded run is active. Results are kept in memory only.');
          }
        },
        onProgress(summary, phase) {
          setBenchmarkSummary(summary);
          setBenchmarkPhase(phase.replace(/([A-Z])/g, ' $1').toLowerCase());
        },
        onFinish(summary) {
          setBenchmarkSummary(summary);
          const hasCompletedMeasurement =
            summary.download !== undefined ||
            summary.upload !== undefined ||
            summary.latency !== undefined;
          setBenchmarkStage(hasCompletedMeasurement ? 'finished' : 'error');
          setBenchmarkMessage(
            hasCompletedMeasurement
              ? 'Completed measurements are shown locally and were not stored.'
              : 'The bounded run ended without a completed quality measurement.'
          );
        },
        onError(message) {
          setBenchmarkMessage(
            `Measurement warning: ${message || 'one sample failed; the bounded run is continuing.'}`
          );
        },
        onWallLimit(summary) {
          setBenchmarkSummary(summary);
          setBenchmarkStage('stopped');
          setBenchmarkMessage(
            `The ${thisPCBenchmarkProfiles[benchmarkProfile].wallLimitMs / 1000}-second wall guard paused further work. An already-started request may still settle.`
          );
        },
      });
      benchmarkControlRef.current = control;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setBenchmarkStage('error');
      setBenchmarkMessage(errorMessage(error, 'The benchmark engine could not start.'));
    }
  }

  function stopBenchmark() {
    benchmarkControllerRef.current?.abort();
    benchmarkControlRef.current?.pause();
    setBenchmarkStage('stopped');
    setBenchmarkMessage(
      'Further measurements were paused. An already-started request may still settle; partial results are not stored.'
    );
  }

  const snapshotReady = snapshot.status === 'ready';
  const exposureReady = activity.status === 'ready';
  const internetReady = publicIdentity.status === 'ready' || benchmarkStage === 'finished';
  const currentSection = sectionViews.find((section) => section.id === view) ?? sectionViews[0];

  return (
    <div className="this-pc-page">
      <div className="this-pc-page-inner">
        <header className="this-pc-hero">
          <div>
            <h1>This PC</h1>
            <p>See what this machine exposes — and how it reaches the internet.</p>
          </div>
          <div>
            <button
              type="button"
              className="this-pc-button this-pc-refresh"
              disabled={snapshot.status === 'loading'}
              onClick={loadSnapshot}
            >
              <RefreshCw aria-hidden="true" />
              {snapshot.status === 'loading' ? 'Reading local snapshot…' : 'Refresh local snapshot'}
            </button>
            <small>Captures state once. Nothing runs in background.</small>
          </div>
        </header>

        <EvidenceSpine
          snapshotReady={snapshotReady}
          exposureReady={exposureReady}
          internetReady={internetReady}
          onChange={setView}
        />
        <p className="this-pc-perspective-note">
          Device, interface, exposure, and public-IP evidence describe the ProtoPeek process/network
          namespace. A benchmark measures this browser's selected network path, which can differ
          under containers, proxies, VPNs, or remote browsing.
        </p>
        <SnapshotSummary snapshot={snapshot} />
        {capabilities.status === 'error' ? (
          <section
            className="this-pc-unavailable"
            role="alert"
            aria-labelledby="this-pc-unavailable-title"
          >
            <CircleAlert aria-hidden="true" />
            <div>
              <h2 id="this-pc-unavailable-title">This PC is unavailable in this runtime</h2>
              <p>{capabilities.error}</p>
              <small>
                ProtoPeek will not offer a browser-only benchmark here because it could be mistaken
                for evidence about the host process/network namespace.
              </small>
            </div>
          </section>
        ) : capabilities.status === 'loading' ? (
          <section className="this-pc-unavailable is-loading" role="status">
            <RefreshCw aria-hidden="true" />
            <div>
              <h2>Confirming the local capability boundary</h2>
              <p>
                Benchmark and inspection actions remain unavailable until the local backend
                responds.
              </p>
            </div>
          </section>
        ) : (
          <>
            <ThisPCSectionTabs active={view} onChange={setView} />

            <section
              id={`this-pc-panel-${view}`}
              role="tabpanel"
              aria-labelledby={`this-pc-tab-${view}`}
              className="this-pc-view"
            >
              {view === 'overview' ? (
                <div className="this-pc-overview-grid">
                  <div className="this-pc-stack">
                    <InterfacesPanel snapshot={snapshot} />
                    {snapshot.status === 'ready' && snapshot.value.notes.length ? (
                      <aside className="this-pc-notes">
                        {snapshot.value.notes.map((note) => (
                          <p key={note}>{note}</p>
                        ))}
                      </aside>
                    ) : null}
                  </div>
                  <aside className="this-pc-stack">
                    <PublicIdentityCard
                      capabilities={capabilities}
                      state={publicIdentity}
                      consentOpen={publicConsent}
                      acknowledged={publicAcknowledged}
                      families={publicFamilies}
                      onOpen={() => {
                        setPublicAcknowledged(false);
                        setPublicConsent(true);
                      }}
                      onAcknowledged={setPublicAcknowledged}
                      onFamilies={setPublicFamilies}
                      onConfirm={checkPublicIdentity}
                      onCancel={() => setPublicConsent(false)}
                    />
                    <BenchmarkSummaryCard onOpen={openBenchmark} />
                    <BoundariesCard />
                  </aside>
                </div>
              ) : view === 'listeners' ? (
                <ListenersView
                  capabilities={capabilities}
                  activity={activity}
                  consentOpen={activityConsent && activityPurpose === 'listeners'}
                  acknowledged={activityAcknowledged}
                  onOpen={() => openActivityConsent('listeners')}
                  onAcknowledged={setActivityAcknowledged}
                  onConfirm={inspectActivity}
                  onCancel={() => setActivityConsent(false)}
                />
              ) : view === 'activity' ? (
                <ActivityView
                  capabilities={capabilities}
                  activity={activity}
                  consentOpen={activityConsent && activityPurpose === 'connections'}
                  acknowledged={activityAcknowledged}
                  onOpen={() => openActivityConsent('connections')}
                  onAcknowledged={setActivityAcknowledged}
                  onConfirm={inspectActivity}
                  onCancel={() => setActivityConsent(false)}
                  traffic={traffic}
                  duration={trafficDuration}
                  onDuration={setTrafficDuration}
                  onSample={sampleTraffic}
                />
              ) : (
                <BenchmarkView
                  stage={benchmarkStage}
                  summary={benchmarkSummary}
                  phase={benchmarkPhase}
                  message={benchmarkMessage}
                  profileID={benchmarkProfile}
                  uploadEnabled={benchmarkUpload}
                  acknowledged={benchmarkAcknowledged}
                  onOpen={openBenchmark}
                  onProfile={setBenchmarkProfile}
                  onUpload={setBenchmarkUpload}
                  onAcknowledged={setBenchmarkAcknowledged}
                  onStart={() => void startBenchmark()}
                  onCancel={() => setBenchmarkStage('idle')}
                  onStop={stopBenchmark}
                />
              )}
            </section>

            <footer className="this-pc-footer">
              <span>
                <b>Observed</b>
                {snapshot.status === 'ready'
                  ? formatObservedAt(snapshot.value.observedAt)
                  : 'Not available'}
              </span>
              <span>
                <b>Scope</b>
                Local process/network namespace
              </span>
              <span>
                <b>Limitations</b>
                Local view only. No guarantee of completeness.
              </span>
            </footer>
          </>
        )}
      </div>
      {capabilities.status === 'ready' ? (
        <ThisPCSectionTabs active={view} onChange={setView} mobile />
      ) : null}
      <span className="sr-only" aria-live="polite">
        Current section: {currentSection.label}
      </span>
    </div>
  );
}

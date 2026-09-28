import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/console/shell/PageHeader';
import {
  buildLocalNetworkPlanPreview,
  defaultLocalNetworkInterface,
  discoverLocalNetwork,
  fetchLocalNetworkCapabilities,
  type LocalNetworkCapabilities,
  type LocalNetworkDiscovery,
  type LocalNetworkInterface,
  type LocalNetworkPlanPreview,
  localNetworkDiscoveryToSnapshot,
} from './local-network';
import type { NetworkSnapshot } from './network-model';
import { OperationStatus } from './shell/OperationStatus';
import '@/features/network/local-discovery.css';

const LocalNetworkInventory = lazy(() =>
  import('@/features/network/LocalNetworkInventory').then((module) => ({
    default: module.LocalNetworkInventory,
  }))
);

const LocalNetworkAdvertisements = lazy(() =>
  import('@/features/network/LocalNetworkInventory').then((module) => ({
    default: module.LocalNetworkAdvertisements,
  }))
);

type HostDraft = {
  label: string;
  tags: string;
};

export function LocalNetworkPanel({
  onSaveSnapshot,
}: {
  onSaveSnapshot: (snapshot: NetworkSnapshot) => unknown;
}) {
  const [capabilities, setCapabilities] = useState<LocalNetworkCapabilities | null>(null);
  const [cidr, setCIDR] = useState('');
  const [networkKey, setNetworkKey] = useState('');
  const [profileID, setProfileID] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<LocalNetworkDiscovery | null>(null);
  const [hostDrafts, setHostDrafts] = useState<Record<string, HostDraft>>({});
  const [message, setMessage] = useState('');
  const capabilityAbortRef = useRef<AbortController | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  const loadCapabilities = useCallback(
    async (selection?: { networkKey: string; cidr: string; profileID: string }) => {
      capabilityAbortRef.current?.abort();
      const controller = new AbortController();
      capabilityAbortRef.current = controller;
      setCapabilities(null);
      setCIDR('');
      setProfileID('');
      setMessage('');
      setLoading(true);
      try {
        const next = await fetchLocalNetworkCapabilities(controller.signal);
        if (controller.signal.aborted) return;
        setCapabilities(next);
        const selected = next.interfaces.find(
          (network) => interfaceKey(network) === selection?.networkKey
        );
        const defaultNetwork = selected ?? defaultLocalNetworkInterface(next);
        const custom = selection?.networkKey === '';
        const nextCIDR = custom ? selection.cidr : (defaultNetwork?.suggestedCidr ?? '');
        const nextKey = custom ? '' : defaultNetwork ? interfaceKey(defaultNetwork) : '';
        const nextProfile =
          next.profiles.find((profile) => profile.id === selection?.profileID)?.id ??
          next.profiles.find((profile) => profile.id === 'quick')?.id ??
          next.profiles[0]?.id ??
          '';
        setCIDR(nextCIDR);
        setNetworkKey(nextKey);
        setProfileID(nextProfile);
        if (
          selection &&
          (selection.networkKey !== nextKey ||
            selection.cidr !== nextCIDR ||
            selection.profileID !== nextProfile)
        ) {
          setResult(null);
          setHostDrafts({});
        }
      } catch (reason: unknown) {
        if (!controller.signal.aborted) {
          setMessage(
            reason instanceof Error ? reason.message.trim() : 'Could not load network suggestions.'
          );
        }
      } finally {
        if (capabilityAbortRef.current === controller) capabilityAbortRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadCapabilities();
    return () => {
      capabilityAbortRef.current?.abort();
      scanAbortRef.current?.abort();
    };
  }, [loadCapabilities]);

  const previewState = useMemo<
    { plan: LocalNetworkPlanPreview; error: '' } | { plan: null; error: string }
  >(() => {
    if (!capabilities || !cidr || !profileID) {
      return { plan: null, error: capabilities ? 'Choose a private CIDR and scan profile.' : '' };
    }
    try {
      return {
        plan: buildLocalNetworkPlanPreview(capabilities, cidr, profileID),
        error: '',
      };
    } catch (reason) {
      return {
        plan: null,
        error: reason instanceof Error ? reason.message : 'The network plan is invalid.',
      };
    }
  }, [capabilities, cidr, profileID]);

  const selectedInterface = capabilities?.interfaces.find(
    (item) => interfaceKey(item) === networkKey
  );

  async function startScan() {
    if (!previewState.plan || scanning || scanAbortRef.current) return;
    const controller = new AbortController();
    scanAbortRef.current = controller;
    setScanning(true);
    setMessage('');
    setResult(null);
    setHostDrafts({});
    try {
      const discovery = await discoverLocalNetwork(
        {
          cidr: previewState.plan.cidr,
          profile: previewState.plan.profile.id,
          consent: true,
          ...(selectedInterface ? { interfaceIndex: selectedInterface.index } : {}),
        },
        controller.signal
      );
      setResult(discovery);
      setHostDrafts(
        Object.fromEntries(
          discovery.hosts.map((host) => [host.address, { label: host.address, tags: '' }])
        )
      );
    } catch (reason) {
      setMessage(
        controller.signal.aborted
          ? 'Scan cancelled. No result was saved.'
          : reason instanceof Error
            ? reason.message.trim()
            : 'Local network discovery failed.'
      );
    } finally {
      if (scanAbortRef.current === controller) scanAbortRef.current = null;
      setScanning(false);
    }
  }

  function updateScope(nextCIDR: string) {
    setCIDR(nextCIDR);

    setResult(null);
    setHostDrafts({});
    setMessage('');
  }

  function updateProfile(nextProfile: string) {
    setProfileID(nextProfile);

    setResult(null);
    setHostDrafts({});
    setMessage('');
  }

  function updateHostDraft(address: string, field: keyof HostDraft, value: string) {
    setHostDrafts((current) => ({
      ...current,
      [address]: {
        ...(current[address] ?? { label: address, tags: '' }),
        [field]: value,
      },
    }));
  }

  async function saveSnapshot() {
    if (!result) return;
    try {
      const metadata = Object.fromEntries(
        result.hosts.map((host) => {
          const draft = hostDrafts[host.address] ?? { label: host.address, tags: '' };
          return [
            host.address,
            {
              label: draft.label,
              tags: Array.from(
                new Set(
                  draft.tags
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                )
              ),
            },
          ];
        })
      );
      const saved = await onSaveSnapshot(localNetworkDiscoveryToSnapshot(result, metadata));
      setMessage(
        saved === false
          ? 'The snapshot was not saved. Review the workspace storage message.'
          : 'Network evidence saved as an immutable snapshot.'
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : 'Could not save the local network snapshot.'
      );
    }
  }

  return (
    <section
      className="pp-launcher-card pp-local-network-panel"
      aria-labelledby="local-network-heading"
      aria-busy={loading || scanning}
    >
      <PageHeader className="pp-card-heading">
        <div>
          <span className="pp-kicker">Local network</span>
          <h1 id="local-network-heading">Nearby devices</h1>
        </div>
        <span className="pp-reflection-chip">ProtoPeek process view</span>
      </PageHeader>

      <p className="pp-scan-policy">
        Choose a cached device to inspect it, or scan your selected network for open services.
      </p>

      {loading ? (
        <p className="pp-scan-progress" role="status">
          Reading available networks and cached devices…
        </p>
      ) : null}

      {capabilities ? (
        <>
          <div className="pp-local-scope">
            <div className="pp-local-scope-field">
              <label className="pp-label" htmlFor="local-network-scope">
                Your network
              </label>
              <select
                id="local-network-scope"
                className="pp-input"
                disabled={scanning}
                value={networkKey}
                onChange={(event) => {
                  const key = event.target.value;
                  const next = capabilities.interfaces.find((item) => interfaceKey(item) === key);
                  setNetworkKey(key);
                  updateScope(next?.suggestedCidr ?? '');
                }}
              >
                {capabilities.interfaces.map((item) => (
                  <option key={interfaceKey(item)} value={interfaceKey(item)}>
                    {item.name} · this device {item.address}
                    {capabilities.inventory?.defaultInterfaceIndex === item.index
                      ? ' · default route'
                      : ''}
                  </option>
                ))}
                <option value="">Advanced: enter another private network…</option>
              </select>
            </div>
            <button
              type="button"
              className="pp-button-secondary"
              disabled={scanning}
              onClick={() => void loadCapabilities({ networkKey, cidr, profileID })}
            >
              Refresh devices
            </button>

            {!selectedInterface ? (
              <div className="pp-local-scope-field pp-local-scope-custom">
                <label className="pp-label" htmlFor="local-network-cidr">
                  Private IPv4 CIDR
                </label>
                <input
                  id="local-network-cidr"
                  className="pp-input"
                  value={cidr}
                  disabled={scanning}
                  placeholder="192.168.1.0/24"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => updateScope(event.target.value)}
                />
                <p className="pp-scan-policy">
                  A range groups addresses: 192.168.1.0/24 checks 192.168.1.1–254. Use a network you
                  manage, /24 or smaller.
                </p>
              </div>
            ) : null}
          </div>
          {selectedInterface ? (
            <p className="pp-scan-policy">
              {selectedInterface.name} · your address {selectedInterface.address} · network{' '}
              {selectedInterface.interfaceCidr}
              {selectedInterface.interfaceCidr !== selectedInterface.suggestedCidr
                ? ` · service scan checks the nearby ${selectedInterface.suggestedCidr} portion`
                : ''}
            </p>
          ) : null}

          {capabilities.inventory && selectedInterface ? (
            <Suspense
              fallback={
                <p className="pp-scan-progress" role="status">
                  Loading device view…
                </p>
              }
            >
              <LocalNetworkInventory
                key={interfaceKey(selectedInterface)}
                inventory={capabilities.inventory}
                network={selectedInterface}
                result={result}
              />
            </Suspense>
          ) : selectedInterface ? (
            <p className="pp-empty-copy">
              Neighbor cache unavailable. Scan network to find open services.
            </p>
          ) : null}

          <section className="pp-local-service-scan" aria-label="Find open services">
            <h3>Find open services</h3>
            <p className="pp-scan-policy">
              Scanning starts only when you choose Scan network.
              {previewState.plan
                ? ` Check ${previewState.plan.portCount} selected TCP ports across ${previewState.plan.hostCount} addresses in ${previewState.plan.cidr}.`
                : ''}
            </p>
            <details className="pp-local-scan-settings">
              <summary>
                Scan settings · {previewState.plan?.profile.label ?? 'choose a profile'}
              </summary>
              <div className="pp-local-scope-field">
                <label className="pp-label" htmlFor="local-network-profile">
                  Scan profile
                </label>
                <select
                  id="local-network-profile"
                  className="pp-input"
                  value={profileID}
                  disabled={scanning}
                  onChange={(event) => updateProfile(event.target.value)}
                >
                  {capabilities.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </div>
              {previewState.plan ? <PlanPreview plan={previewState.plan} /> : null}
              <CapabilityWarnings capabilities={capabilities} />
            </details>
            {previewState.error ? (
              <p className="pp-scan-message" role="alert">
                {previewState.error}
              </p>
            ) : null}

            <div className="pp-private-scan-toggle">
              Application ports: bounded gRPC reflection and HTTP HEAD /, no redirects. Other ports:
              TCP connect only. mDNS: two seconds on the selected interface, advertised names and
              services within this range only. TCP follows OS routes; VPNs and overlapping networks
              can change which device answers.
            </div>

            <button
              type="button"
              className={scanning ? 'pp-button-secondary' : 'pp-button-primary'}
              disabled={scanning ? false : !previewState.plan}
              onClick={scanning ? () => scanAbortRef.current?.abort() : () => void startScan()}
            >
              {scanning ? 'Cancel scan' : 'Scan network'}
            </button>

            <OperationStatus busy={scanning} label="Discovering local devices" />
          </section>
        </>
      ) : null}

      {message && !capabilities && !loading ? (
        <div className="pp-local-availability" role="alert">
          <div>
            <strong>Scan setup could not load</strong>
            <p>
              Couldn’t load scan settings. Check the local service and retry. No probes were sent.
            </p>
            <details>
              <summary>Technical details</summary>
              <code>{message}</code>
            </details>
          </div>
          <button
            type="button"
            className="pp-button-secondary"
            onClick={() => void loadCapabilities()}
          >
            Retry
          </button>
        </div>
      ) : message ? (
        <p className="pp-scan-message" role="status">
          {message}
        </p>
      ) : null}

      {result ? (
        <DiscoveryResult
          result={result}
          hostDrafts={hostDrafts}
          onUpdateHost={updateHostDraft}
          onSave={saveSnapshot}
        />
      ) : null}
    </section>
  );
}

function interfaceKey(network: LocalNetworkInterface) {
  return `${network.index}:${network.address}`;
}

function PlanPreview({ plan }: { plan: LocalNetworkPlanPreview }) {
  return (
    <section className="pp-status-grid" aria-label="Exact scan plan">
      <div>
        <span>Scope</span>
        <strong>{plan.cidr}</strong>
      </div>
      <div>
        <span>Workload</span>
        <strong>
          <span>{plan.hostCount.toLocaleString()} hosts</span> ·{' '}
          <span>{plan.portCount.toLocaleString()} ports</span> ·{' '}
          <span>{plan.attempts.toLocaleString()} endpoint probes</span>
        </strong>
      </div>
      <div>
        <span>Limits</span>
        <strong>
          <span>{plan.concurrency.toLocaleString()} concurrent</span> ·{' '}
          <span>{formatDuration(plan.deadlineMs)} deadline</span>
        </strong>
      </div>
      <div>
        <span>Application inspection</span>
        <strong>
          {plan.applicationProbePorts.join(', ') || 'None'} · gRPC reflection + HTTP HEAD /
        </strong>
      </div>
      <div>
        <span>TCP connect only</span>
        <strong>{plan.connectOnlyPorts.join(', ') || 'None in this profile'}</strong>
      </div>
      <div>
        <span>All selected TCP ports</span>
        <strong>{plan.ports.join(', ')}</strong>
      </div>
    </section>
  );
}

function CapabilityWarnings({ capabilities }: { capabilities: LocalNetworkCapabilities }) {
  if (capabilities.warnings.length === 0) return null;
  return (
    <details className="pp-capability-boundaries">
      <summary>Safety boundaries · {capabilities.warnings.length}</summary>
      <ul className="pp-capability-warnings">
        {capabilities.warnings.map((warning) => (
          <li key={warning} className="pp-scan-policy">
            {warning}
          </li>
        ))}
      </ul>
    </details>
  );
}

function DiscoveryResult({
  result,
  hostDrafts,
  onUpdateHost,
  onSave,
}: {
  result: LocalNetworkDiscovery;
  hostDrafts: Readonly<Record<string, HostDraft>>;
  onUpdateHost: (address: string, field: keyof HostDraft, value: string) => void;
  onSave: () => unknown;
}) {
  const [query, setQuery] = useState('');
  const [selectedAddress, setSelectedAddress] = useState(result.hosts[0]?.address ?? '');
  const filteredHosts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return result.hosts;
    return result.hosts.filter((host) =>
      [
        host.address,
        ...host.ports.flatMap((port) => [
          String(port.port),
          ...port.protocols,
          ...port.services,
          port.reflection,
          port.httpProtocol,
          port.httpStatus,
          port.httpServer,
          ...port.evidenceNotes,
        ]),
        ...host.hints.flatMap((hint) => [hint.label, hint.reason]),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [query, result.hosts]);
  const selectedHost =
    filteredHosts.find((host) => host.address === selectedAddress) ?? filteredHosts[0] ?? null;
  const openPortCount = result.hosts.reduce((total, host) => total + host.ports.length, 0);

  return (
    <section aria-label="Local network evidence">
      <h3>Observed endpoint evidence</h3>
      <p className="pp-scan-policy">
        Observed means the ProtoPeek process received positive selected-port evidence. Device-role
        hints are unverified.
      </p>
      <section
        className="pp-evidence-scope"
        aria-label={`Evidence plan: ${result.cidr}, ${result.profile.label}`}
      >
        <strong>{result.cidr}</strong> · {result.profile.label} · observed{' '}
        <time dateTime={result.observedAt}>{new Date(result.observedAt).toLocaleString()}</time>
      </section>
      <p className="pp-local-discovery-summary">
        <strong>{result.hosts.length}</strong> hosts with observed endpoints
        <span aria-hidden="true"> · </span>
        <strong>{openPortCount}</strong> open TCP ports
        <span aria-hidden="true"> · </span>
        <strong>{result.profile.ports.length}</strong> selected ports per host
      </p>
      {!result.complete ? (
        <p className="pp-scan-message" role="status">
          Partial result: {result.attemptsCompleted.toLocaleString()} of{' '}
          {result.attemptsPlanned.toLocaleString()} endpoint probe calls returned
          {result.stoppedReason ? ` · stopped: ${result.stoppedReason}` : ''}.
        </p>
      ) : (
        <p className="pp-scan-message" role="status">
          Complete: all {result.attemptsCompleted.toLocaleString()} selected endpoint probe calls
          returned.
        </p>
      )}

      {result.hosts.length === 0 ? (
        <p className="pp-empty-copy">
          No open endpoints were observed on the selected ports. This does not mean devices are
          offline.
        </p>
      ) : (
        <>
          <div className="pp-local-discovery-toolbar">
            <label className="pp-local-discovery-filter">
              <span>Filter by address, port, service, or hint</span>
              <input
                type="search"
                className="pp-input"
                placeholder="192.168.1.20, 50051, gRPC…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <span className="pp-local-discovery-count" aria-live="polite">
              {filteredHosts.length} of {result.hosts.length} hosts
            </span>
          </div>

          {selectedHost ? (
            <div className="pp-history-layout pp-local-discovery-layout">
              <nav aria-label="Observed hosts">
                <header>
                  <strong>Hosts</strong>
                  <span>{filteredHosts.length} matching</span>
                </header>
                {filteredHosts.map((host) => (
                  <button
                    key={host.address}
                    type="button"
                    className={selectedHost.address === host.address ? 'is-active' : ''}
                    aria-pressed={selectedHost.address === host.address}
                    onClick={() => setSelectedAddress(host.address)}
                  >
                    <strong>{host.address}</strong>
                    <span>
                      {host.ports.length} open {host.ports.length === 1 ? 'port' : 'ports'} ·{' '}
                      {host.ports.map((port) => port.port).join(', ')}
                    </span>
                    {host.hints.length > 0 ? (
                      <small>{host.hints.map((hint) => hint.label).join(' · ')}</small>
                    ) : null}
                  </button>
                ))}
              </nav>

              <DiscoveredHostDetails
                host={selectedHost}
                result={result}
                draft={
                  hostDrafts[selectedHost.address] ?? { label: selectedHost.address, tags: '' }
                }
                onUpdateHost={onUpdateHost}
              />
            </div>
          ) : (
            <p className="pp-empty-copy">No observed hosts match “{query}”.</p>
          )}
        </>
      )}

      {result.advertisements ? (
        <Suspense
          fallback={
            <p className="pp-scan-progress" role="status">
              Loading advertised services…
            </p>
          }
        >
          <LocalNetworkAdvertisements advertisements={result.advertisements} />
        </Suspense>
      ) : null}

      {result.warnings.length > 0 ? (
        <aside aria-label="Result warnings">
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning} className="pp-scan-policy">
                {warning}
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      <button type="button" className="pp-button-primary" onClick={() => void onSave()}>
        Save snapshot
      </button>
    </section>
  );
}

function DiscoveredHostDetails({
  host,
  result,
  draft,
  onUpdateHost,
}: {
  host: LocalNetworkDiscovery['hosts'][number];
  result: LocalNetworkDiscovery;
  draft: HostDraft;
  onUpdateHost: (address: string, field: keyof HostDraft, value: string) => void;
}) {
  return (
    <article className="pp-local-discovery-detail" aria-label={`Details for ${host.address}`}>
      <header>
        <div>
          <span className="pp-kicker">Observed host</span>
          <h4>{host.address}</h4>
          <p>
            {host.ports.length} positive selected-port{' '}
            {host.ports.length === 1 ? 'observation' : 'observations'}
          </p>
        </div>
        <a className="pp-button" href={`#/network/ports?host=${encodeURIComponent(host.address)}`}>
          Scan ports on {host.address}
        </a>
      </header>

      <section
        className="pp-local-discovery-observations"
        aria-label={`Observed ports for ${host.address}`}
      >
        <h5>Observed services</h5>
        <ul>
          {host.ports.map((port) => {
            const applicationProbe = result.profile.applicationProbePorts.includes(port.port);
            const summary = [
              port.grpc ? 'gRPC' : '',
              port.http ? 'HTTP' : '',
              port.reflection ? `reflection ${port.reflection}` : '',
              `${port.probeDurationMs} ms ${applicationProbe ? 'application probe' : 'TCP connect'}`,
            ]
              .filter(Boolean)
              .join(' · ');
            const details: { label: string; value: string }[] = [
              {
                label: 'Probe mode',
                value: applicationProbe ? 'Application inspection' : 'TCP connect only',
              },
              ...(port.protocols.length
                ? [{ label: 'Protocols', value: port.protocols.join(', ') }]
                : []),
              ...(port.reflection ? [{ label: 'gRPC reflection', value: port.reflection }] : []),
              ...(port.services.length
                ? [{ label: 'Services', value: port.services.join(', ') }]
                : []),
              ...(port.httpProtocol ? [{ label: 'HTTP protocol', value: port.httpProtocol }] : []),
              ...(port.httpStatus ? [{ label: 'HTTP status', value: port.httpStatus }] : []),
              ...(port.httpServer ? [{ label: 'HTTP Server', value: port.httpServer }] : []),
            ];

            return (
              <li key={port.port} className="pp-local-port-observation">
                <div className="pp-local-port-heading">
                  <strong>Observed · TCP {port.port}</strong>
                  <span>{summary}</span>
                </div>
                <details>
                  <summary>Probe evidence</summary>
                  <dl>
                    {details.map((detail) => (
                      <div key={detail.label}>
                        <dt>{detail.label}</dt>
                        <dd>{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {port.evidenceNotes.length > 0 ? (
                    <ul aria-label={`Evidence notes for TCP ${port.port}`}>
                      {port.evidenceNotes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      {host.hints.length > 0 ? (
        <section
          className="pp-local-discovery-hints"
          aria-label={`Inferred device-role hints for ${host.address}`}
        >
          <h5>Inferred device-role hints</h5>
          <ul>
            {host.hints.map((hint) => (
              <li key={`${hint.label}:${hint.reason}`}>
                <strong>
                  Inferred · {hint.confidence} confidence · {hint.label}
                </strong>
                {' — '}
                {hint.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="pp-local-discovery-metadata" open>
        <summary>Snapshot label and tags</summary>
        <div>
          <label className="pp-label" htmlFor={`host-label-${host.address}`}>
            Host label
          </label>
          <input
            id={`host-label-${host.address}`}
            className="pp-input"
            aria-label={`Label for ${host.address}`}
            value={draft.label}
            maxLength={512}
            onChange={(event) => onUpdateHost(host.address, 'label', event.target.value)}
          />
          <label className="pp-label" htmlFor={`host-tags-${host.address}`}>
            Tags (comma separated)
          </label>
          <input
            id={`host-tags-${host.address}`}
            className="pp-input"
            aria-label={`Tags for ${host.address}`}
            value={draft.tags}
            maxLength={4096}
            onChange={(event) => onUpdateHost(host.address, 'tags', event.target.value)}
          />
        </div>
      </details>
    </article>
  );
}

function formatDuration(milliseconds: number) {
  return milliseconds % 1000 === 0
    ? `${(milliseconds / 1000).toLocaleString()} s`
    : `${milliseconds.toLocaleString()} ms`;
}

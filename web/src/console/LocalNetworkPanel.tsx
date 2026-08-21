import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildLocalNetworkPlanPreview,
  discoverLocalNetwork,
  fetchLocalNetworkCapabilities,
  type LocalNetworkCapabilities,
  type LocalNetworkDiscovery,
  type LocalNetworkPlanPreview,
  localNetworkDiscoveryToSnapshot,
} from './local-network';
import type { NetworkSnapshot } from './network-model';

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
  const [profileID, setProfileID] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<LocalNetworkDiscovery | null>(null);
  const [hostDrafts, setHostDrafts] = useState<Record<string, HostDraft>>({});
  const [message, setMessage] = useState('');
  const capabilityAbortRef = useRef<AbortController | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    capabilityAbortRef.current = controller;
    void fetchLocalNetworkCapabilities(controller.signal)
      .then((next) => {
        setCapabilities(next);
        setCIDR(next.interfaces[0]?.suggestedCidr ?? '');
        setProfileID(
          next.profiles.find((profile) => profile.id === 'quick')?.id ?? next.profiles[0]?.id ?? ''
        );
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(
            reason instanceof Error ? reason.message.trim() : 'Could not load network suggestions.'
          );
        }
      })
      .finally(() => {
        if (capabilityAbortRef.current === controller) capabilityAbortRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      scanAbortRef.current?.abort();
    };
  }, []);

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

  async function startScan() {
    if (!authorized || !previewState.plan || scanning || scanAbortRef.current) return;
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
    setAuthorized(false);
    setResult(null);
    setHostDrafts({});
    setMessage('');
  }

  function updateProfile(nextProfile: string) {
    setProfileID(nextProfile);
    setAuthorized(false);
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
      <header className="pp-card-heading">
        <div>
          <span className="pp-kicker">Bounded discovery</span>
          <h2 id="local-network-heading">Local network</h2>
        </div>
        <span className="pp-reflection-chip">ProtoPeek process view</span>
      </header>

      <p className="pp-scan-policy">
        Suggestions are read-only interface metadata. A scan starts only after you review the exact
        TCP-connect and application-inspection plan and confirm authorization.
      </p>

      {loading ? (
        <p className="pp-scan-progress" role="status">
          Loading local interface suggestions without probing…
        </p>
      ) : null}

      {capabilities ? (
        <>
          <label className="pp-label" htmlFor="local-network-interface">
            Interface suggestion
          </label>
          <select
            id="local-network-interface"
            className="pp-input"
            disabled={scanning}
            value={capabilities.interfaces.some((item) => item.suggestedCidr === cidr) ? cidr : ''}
            onChange={(event) => {
              if (event.target.value) updateScope(event.target.value);
            }}
          >
            {capabilities.interfaces.length === 0 ? (
              <option value="">No private interface suggestion</option>
            ) : (
              <>
                <option value="">Custom scope</option>
                {capabilities.interfaces.map((item) => (
                  <option key={`${item.index}:${item.address}`} value={item.suggestedCidr}>
                    {item.name} · {item.address} · {item.suggestedCidr}
                  </option>
                ))}
              </>
            )}
          </select>

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

          {previewState.plan ? <PlanPreview plan={previewState.plan} /> : null}
          {previewState.error ? (
            <p className="pp-scan-message" role="alert">
              {previewState.error}
            </p>
          ) : null}

          <label className="pp-private-scan-toggle">
            <input
              type="checkbox"
              checked={authorized}
              disabled={!previewState.plan || scanning}
              onChange={(event) => setAuthorized(event.target.checked)}
            />{' '}
            I am authorized to probe this private CIDR. On application-inspection ports, ProtoPeek
            may send bounded gRPC reflection and HTTP HEAD / requests; redirects are not followed.
            Every other listed port receives TCP connect only.
          </label>

          <button
            type="button"
            className={scanning ? 'pp-button-secondary' : 'pp-button-primary'}
            disabled={scanning ? false : !authorized || !previewState.plan}
            onClick={scanning ? () => scanAbortRef.current?.abort() : () => void startScan()}
          >
            {scanning ? 'Cancel scan' : 'Scan network'}
          </button>

          <CapabilityWarnings capabilities={capabilities} />
        </>
      ) : null}

      {message ? (
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
      ) : !loading && !message ? (
        <p className="pp-empty-copy">No active network probe has run.</p>
      ) : null}
    </section>
  );
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
  return (
    <section aria-label="Local network evidence">
      <h3>Observed endpoint evidence</h3>
      <p className="pp-scan-policy">
        Observed means the ProtoPeek process received positive selected-port evidence. Inferred
        device-role hints are hypotheses, not verified device identities.
      </p>
      <section
        className="pp-evidence-scope"
        aria-label={`Evidence plan: ${result.cidr}, ${result.profile.label}`}
      >
        <strong>{result.cidr}</strong> · {result.profile.label} · observed{' '}
        <time dateTime={result.observedAt}>{new Date(result.observedAt).toLocaleString()}</time>
      </section>
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
        result.hosts.map((host) => {
          const draft = hostDrafts[host.address] ?? { label: host.address, tags: '' };
          return (
            <article key={host.address} className="pp-discovery-result" aria-label={host.address}>
              <strong>{host.address}</strong>
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

              <ul aria-label={`Observed ports for ${host.address}`}>
                {host.ports.map((port) => (
                  <li key={port.port}>
                    <strong>Observed · TCP {port.port}</strong>
                    {' · '}
                    {[
                      port.grpc ? 'gRPC' : '',
                      port.http ? 'HTTP' : '',
                      port.reflection ? `reflection ${port.reflection}` : '',
                      `${port.probeDurationMs} ms ${result.profile.applicationProbePorts.includes(port.port) ? 'application probe' : 'TCP connect'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </li>
                ))}
              </ul>

              {host.hints.length > 0 ? (
                <section aria-label={`Inferred device-role hints for ${host.address}`}>
                  <h4>Inferred device-role hints</h4>
                  <ul>
                    {host.hints.map((hint) => (
                      <li key={`${hint.label}:${hint.reason}`}>
                        <strong>
                          Inferred · {hint.confidence} confidence · {hint.label}
                        </strong>{' '}
                        — {hint.reason}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </article>
          );
        })
      )}

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

function formatDuration(milliseconds: number) {
  return milliseconds % 1000 === 0
    ? `${(milliseconds / 1000).toLocaleString()} s`
    : `${milliseconds.toLocaleString()} ms`;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/console/shell/EmptyState';
import { PageHeader } from '@/console/shell/PageHeader';
import { usePagination } from '@/shared/use-pagination';
import { fetchJSON } from './api';
import type { NetBirdSnapshot } from './netbird-api';
import { useProtocolShell } from './ProtocolShellContext';
import './netbird.css';

export function NetBirdWorkbench() {
  const { openScan } = useProtocolShell();
  const [snapshot, setSnapshot] = useState<NetBirdSnapshot | null>(null);
  const [busy, setBusy] = useState<'inspect' | 'action' | ''>('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [action, setAction] = useState<'connect' | 'disconnect' | ''>('');
  const [consent, setConsent] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [port, setPort] = useState('80');
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = useMemo(
    () =>
      (snapshot?.peers ?? []).filter((peer) =>
        `${peer.name} ${peer.ips.join(' ')} ${peer.state}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [snapshot, query]
  );
  const table = usePagination(rows);
  const peer = snapshot?.peers.find((item) => item.id === selected);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (action) heading.current?.focus();
  }, [action]);
  async function run(operation: 'inspect' | 'action') {
    if (controller.current || (operation === 'action' && (!snapshot || !action || !consent)))
      return;
    const request = new AbortController();
    controller.current = request;
    setBusy(operation);
    setError('');
    setMessage('');
    try {
      const result = await fetchJSON<
        NetBirdSnapshot | { outcome: string; message: string; snapshot: NetBirdSnapshot | null }
      >(`api/netbird/${operation}`, {
        method: 'POST',
        signal: request.signal,
        ...(operation === 'action'
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action, revision: snapshot?.revision, consent }),
            }
          : {}),
      });
      if (request.signal.aborted || controller.current !== request) return;
      const next = 'outcome' in result ? result.snapshot : result;
      setSnapshot(next);
      setAction('');
      setConsent(false);
      setSelected((current) =>
        next?.peers.some((item) => item.id === current) ? current : (next?.peers[0]?.id ?? '')
      );
      setMessage(
        'outcome' in result
          ? result.message
          : next?.available
            ? 'NetBird inspection complete. No background refresh.'
            : 'NetBird client unavailable. No background refresh.'
      );
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'NetBird operation failed.');
        if (operation === 'action') {
          setSnapshot(null);
          setAction('');
          setConsent(false);
        }
      }
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy('');
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    if (busy === 'action') {
      setSnapshot(null);
      setAction('');
      setConsent(false);
    }
    setBusy('');
    setMessage(
      busy === 'inspect'
        ? 'Inspection cancelled locally. No daemon action was requested.'
        : 'Cancelled locally. An accepted daemon action may already have applied; inspect again before another operation.'
    );
  }
  return (
    <section className="pp-netbird" aria-label="NetBird workbench">
      <PageHeader>
        <h1>NetBird</h1>
        <button type="button" disabled={!!busy} onClick={() => void run('inspect')}>
          {snapshot ? 'Refresh NetBird' : 'Inspect NetBird'}
        </button>
        {busy ? (
          <button type="button" onClick={cancel}>
            Cancel operation
          </button>
        ) : null}
      </PageHeader>
      <p role="status">
        {busy
          ? busy === 'inspect'
            ? 'Inspecting NetBird…'
            : 'Running reviewed NetBird operation…'
          : message || 'Read the installed client when needed. No background refresh.'}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!snapshot ? (
        <EmptyState title="Installed NetBird, native evidence">
          Inspect the existing local daemon for Management, Signal, relay, ICE and DNS state.
          ProtoPeek does not install, sign in or change provider settings.
        </EmptyState>
      ) : !snapshot.available ? (
        <p>
          NetBird is unavailable.{' '}
          <a href="https://docs.netbird.io/get-started/install" target="_blank" rel="noreferrer">
            Install the official NetBird client
          </a>
          , then inspect again.
        </p>
      ) : (
        <>
          <div className="pp-netbird-summary">
            <strong>{snapshot.state}</strong>
            <span>{snapshot.profile || 'Profile not reported'}</span>
            <span>{snapshot.ips.join(', ') || 'No assigned address reported'}</span>
            <span>
              CLI {snapshot.cliVersion} · daemon {snapshot.daemonVersion}
            </span>
            <time dateTime={snapshot.observedAt}>
              {new Date(snapshot.observedAt).toLocaleString()}
            </time>
          </div>
          {snapshot.warnings.map((warning) => (
            <p role="status" key={warning}>
              {warning}
            </p>
          ))}
          <div className="pp-netbird-endpoints">
            {(['management', 'signal'] as const).map((kind) => (
              <article key={kind}>
                <h2>{kind === 'management' ? 'Management' : 'Signal'}</h2>
                <p>
                  {snapshot[kind].connected === null
                    ? 'Not reported'
                    : snapshot[kind].connected
                      ? 'Connected'
                      : 'Disconnected'}
                  {snapshot[kind].hasError ? ' · provider reported an error' : ''}
                </p>
                <code>{snapshot[kind].url || 'Endpoint not reported'}</code>
              </article>
            ))}
          </div>
          <div className="pp-netbird-actions">
            <button
              type="button"
              disabled={!!busy || !snapshot.connectAllowed}
              onClick={() => {
                setAction('connect');
                setConsent(false);
              }}
            >
              Review reconnect
            </button>
            <button
              type="button"
              disabled={!!busy || !snapshot.disconnectAllowed}
              onClick={() => {
                setAction('disconnect');
                setConsent(false);
              }}
            >
              Review disconnect
            </button>
          </div>
          {snapshot.controlReason ? <p>{snapshot.controlReason}</p> : null}
          {snapshot.environment.length ? (
            <p>
              Excluded environment variable names: {snapshot.environment.join(', ')}. Their values
              are never returned.
            </p>
          ) : null}
          {action ? (
            <section className="pp-netbird-review" aria-label="Review NetBird operation">
              <h2 ref={heading} tabIndex={-1}>
                {action === 'connect' ? 'Reconnect saved profile' : 'Disconnect NetBird'}
              </h2>
              <p>
                {action === 'connect'
                  ? 'Reconnect the observed saved profile with the installed daemon. Sign-in, browser flows and settings changes are not offered.'
                  : 'Disconnect this computer from Management and its peers. Active private-network connections will be interrupted.'}{' '}
                A fresh revision is checked before execution.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={!!busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                I authorize this operation on this computer.
              </label>
              <button
                type="button"
                disabled={!!busy || !consent}
                onClick={() => void run('action')}
              >
                Run selected operation
              </button>
              <button type="button" disabled={!!busy} onClick={() => setAction('')}>
                Dismiss operation
              </button>
            </section>
          ) : null}
          <section>
            <h2>Peers · {snapshot.peerTotal} reported</h2>
            <label>
              Find NetBird peers{' '}
              <input
                type="search"
                value={query}
                maxLength={128}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="pp-netbird-table">
              <table>
                <thead>
                  <tr>
                    <th>Peer</th>
                    <th>Address</th>
                    <th>State</th>
                    <th>Connection</th>
                  </tr>
                </thead>
                <tbody>
                  {table.pageItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button type="button" onClick={() => setSelected(item.id)}>
                          {item.name || item.ips[0] || 'Unnamed peer'}
                        </button>
                      </td>
                      <td>{item.ips.join(', ') || 'Not reported'}</td>
                      <td>{item.state || 'Unknown'}</td>
                      <td>{item.connectionType || 'Not reported'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pp-netbird-actions">
              <button type="button" disabled={!table.canPreviousPage} onClick={table.previousPage}>
                Previous peers
              </button>
              <span>
                Page {table.pageIndex + 1} of {Math.max(1, table.pageCount)}
              </span>
              <button type="button" disabled={!table.canNextPage} onClick={table.nextPage}>
                Next peers
              </button>
            </div>
          </section>
          {peer ? (
            <section aria-label="Selected NetBird peer">
              <h3>{peer.name || 'Peer details'}</h3>
              <dl>
                <dt>ICE candidates (local / remote)</dt>
                <dd>
                  {peer.ice.local || 'Unknown'} / {peer.ice.remote || 'Unknown'}
                </dd>
                <dt>ICE endpoints (local / remote)</dt>
                <dd>
                  {peer.endpoints.local || 'Unknown'} / {peer.endpoints.remote || 'Unknown'}
                </dd>
                <dt>Relay</dt>
                <dd>{peer.relay || 'Not reported'}</dd>
                <dt>Latency</dt>
                <dd>
                  {peer.latencyMs === null
                    ? 'Not reported'
                    : `${peer.latencyMs.toFixed(2)} ms · native client observation`}
                </dd>
                <dt>Received / sent</dt>
                <dd>
                  {peer.received || 'Not reported'} / {peer.sent || 'Not reported'} bytes
                </dd>
                <dt>Networks</dt>
                <dd>{peer.networks.join(', ') || 'None reported'}</dd>
              </dl>
              <div className="pp-netbird-actions">
                <label>
                  Service port{' '}
                  <input
                    aria-label="NetBird peer service port"
                    inputMode="numeric"
                    maxLength={5}
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    !peer.ips.length ||
                    !/^\d+$/.test(port) ||
                    Number(port) < 1 ||
                    Number(port) > 65535
                  }
                  onClick={() => {
                    const ip = peer.ips[0];
                    openScan({ initialTarget: `${ip.includes(':') ? `[${ip}]` : ip}:${port}` });
                  }}
                >
                  Inspect peer service
                </button>
              </div>
            </section>
          ) : null}
          <div className="pp-netbird-endpoints">
            <section>
              <h2>Relays</h2>
              {snapshot.relays.length ? (
                snapshot.relays.map((relay, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: immutable provider observations have positional identity and no child state
                  <p key={`${relay.uri}-${index}`}>
                    {relay.uri || 'URI not reported'} ·{' '}
                    {relay.available === null
                      ? 'Not reported'
                      : relay.available
                        ? 'Available'
                        : 'Unavailable'}{' '}
                    · {relay.transport || 'Transport not reported'}
                    {relay.hasError ? ' · provider reported an error' : ''}
                  </p>
                ))
              ) : (
                <p>No relay observations reported.</p>
              )}
            </section>
            <section>
              <h2>DNS groups</h2>
              {snapshot.dns.length ? (
                snapshot.dns.map((group, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: immutable provider observations have positional identity and no child state
                  <p key={`${group.servers.join(',')}-${index}`}>
                    {group.servers.join(', ') || 'No servers reported'} ·{' '}
                    {group.domains.join(', ') || 'No domains reported'} ·{' '}
                    {group.enabled === null
                      ? 'Not reported'
                      : group.enabled
                        ? 'Enabled'
                        : 'Disabled'}
                    {group.hasError ? ' · provider reported an error' : ''}
                  </p>
                ))
              ) : (
                <p>No DNS groups reported.</p>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

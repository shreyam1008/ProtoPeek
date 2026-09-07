import {
  type ColumnDef,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/console/shell/EmptyState';
import { PageHeader } from '@/console/shell/PageHeader';
import { fetchJSON } from './api';
import { DirectoryPicker } from './DirectoryPicker';
import { ProtocolInfo } from './ProtocolInfo';
import { useProtocolShell } from './ProtocolShellContext';
import { type TailAction, type TailPeer, type TailSnapshot, tailActions } from './tailnet-api';
import './tailnet.css';

const sections = ['Devices', 'Accounts', 'Exit nodes', 'Diagnostics', 'Taildrop'] as const;
type Section = (typeof sections)[number];
function readView(): { section: Section; query: string } {
  try {
    const encoded = localStorage.getItem('protopeek.tailnet.view.v1') || '{}';
    const value = encoded.length <= 2048 ? JSON.parse(encoded) : {};
    return {
      section: sections.includes(value.section) ? value.section : 'Devices',
      query: typeof value.query === 'string' ? value.query.slice(0, 256) : '',
    };
  } catch {
    return { section: 'Devices', query: '' };
  }
}
type Draft = { action: TailAction; target: string; label: string; path: string };
const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columns: ColumnDef<typeof features, TailPeer>[] = [{ accessorKey: 'name' }];

export function TailnetWorkbench() {
  const { openScan } = useProtocolShell();
  const [snapshot, setSnapshot] = useState<TailSnapshot | null>(null);
  const [initial] = useState(readView);
  const [section, setSection] = useState<Section>(initial.section);
  const [query, setQuery] = useState(initial.query);
  const [storageWarning, setStorageWarning] = useState('');
  const [selected, setSelected] = useState('');
  const [port, setPort] = useState('80');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [consent, setConsent] = useState(false);
  const [output, setOutput] = useState<{
    action: TailAction;
    text: string;
    observedAt: string;
  } | null>(null);
  const [filePath, setFilePath] = useState('');
  const request = useRef<AbortController | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (draft) reviewHeading.current?.focus();
  }, [draft]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    try {
      localStorage.setItem('protopeek.tailnet.view.v1', JSON.stringify({ section, query }));
      setStorageWarning('');
    } catch {
      setStorageWarning('Tailscale view preferences could not be saved in this browser.');
    }
  }, [section, query]);
  const peers = useMemo(() => snapshot?.peers ?? [], [snapshot]);
  const peer = peers.find((item) => item.id === selected) ?? null;
  const rows = useMemo(
    () =>
      peers.filter((item) =>
        `${item.name} ${item.dnsName} ${item.ips.join(' ')} ${item.os}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [peers, query]
  );
  const table = useTable({
    features,
    columns,
    data: rows,
    initialState: { pagination: { pageSize: 50, pageIndex: 0 } },
  });

  async function inspect() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy('Inspecting Tailscale…');
    setError('');
    setMessage('');
    try {
      const next = await fetchJSON<TailSnapshot>('api/tailnet/inspect', {
        method: 'POST',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSnapshot(next);
      setDraft(null);
      setConsent(false);
      setSelected((current) =>
        next.peers.some((item) => item.id === current) ? current : (next.peers[0]?.id ?? '')
      );
      setMessage('Local client snapshot refreshed.');
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Cannot inspect Tailscale.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy('');
      }
    }
  }
  function prepare(action: TailAction, target = '', label = '', path = '') {
    setDraft({ action, target, label, path });
    setConsent(false);
    setOutput(null);
    setError('');
  }
  function cancel() {
    request.current?.abort();
    request.current = null;
    setBusy('');
    setMessage(
      'Operation cancelled. A daemon change or file transfer may already have occurred; refresh to check.'
    );
  }
  async function execute() {
    if (!snapshot || !draft || !consent || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(tailActions[draft.action].label);
    setError('');
    setMessage('');
    try {
      const result = await fetchJSON<{ output: string; arguments: string[]; observedAt: string }>(
        'api/tailnet/action',
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: draft.action,
            target: draft.target,
            path: draft.path,
            revision: snapshot.revision,
            consent,
          }),
        }
      );
      if (controller.signal.aborted) return;
      setOutput({ action: draft.action, text: result.output, observedAt: result.observedAt });
      setDraft(null);
      setConsent(false);
      setMessage('Operation completed. Refresh to observe the current client state.');
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Tailscale operation failed.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy('');
      }
    }
  }
  return (
    <section className="pp-tailnet" aria-label="Tailscale workbench">
      <PageHeader>
        <h1>Tailscale</h1>
        <ProtocolInfo protocol="tailscale" />
        <button type="button" disabled={!!busy} onClick={() => void inspect()}>
          {snapshot ? 'Refresh Tailscale' : 'Inspect Tailscale'}
        </button>
        {busy ? (
          <button type="button" onClick={cancel}>
            Cancel operation
          </button>
        ) : null}
      </PageHeader>
      <p role="status">
        {busy || message || 'Read the installed client when needed. No background refresh.'}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {storageWarning ? <p role="status">{storageWarning}</p> : null}
      {[...new Set(snapshot?.warnings ?? [])].map((warning) => (
        <p role="status" key={warning}>
          {warning}
        </p>
      ))}
      {!snapshot ? (
        <EmptyState title="Your private network, in one place">
          Inspect the installed Tailscale client to see devices, accounts, exit nodes, connection
          diagnostics and Taildrop.
        </EmptyState>
      ) : !snapshot.available ? (
        <p>
          <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
            Install Tailscale
          </a>
          , then inspect again.
        </p>
      ) : (
        <>
          <div className="pp-tailnet-summary">
            <strong>{snapshot.state}</strong>
            <span>{snapshot.tailnet || 'Tailnet unknown'}</span>
            <span>
              {snapshot.self?.name} · {snapshot.self?.ips.join(', ')}
            </span>
            <small>Observed {new Date(snapshot.observedAt).toLocaleString()}</small>
          </div>
          <div className="pp-tailnet-body">
            <nav aria-label="Tailscale sections">
              {sections.map((name) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={section === name}
                  onClick={() => {
                    setSection(name);
                    if (!busy) {
                      setDraft(null);
                      setConsent(false);
                    }
                  }}
                >
                  {name}
                </button>
              ))}
            </nav>
            <div className="pp-tailnet-content">
              {section === 'Devices' ? (
                <div className="pp-tailnet-devices">
                  <div className="pp-tailnet-inventory">
                    <div className="pp-tailnet-toolbar">
                      <input
                        aria-label="Find a Tailscale device"
                        maxLength={256}
                        placeholder="Name, IP or operating system"
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          table.setPageIndex(0);
                        }}
                      />
                      <span>{rows.length} devices</span>
                    </div>
                    <div className="pp-tailnet-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Device</th>
                            <th>Address</th>
                            <th>Presence</th>
                            <th>Connection</th>
                          </tr>
                        </thead>
                        <tbody>
                          {table.getRowModel().rows.map(({ id, original: item }) => (
                            <tr key={id} aria-selected={peer?.id === item.id}>
                              <td>
                                <button type="button" onClick={() => setSelected(item.id)}>
                                  {item.name}
                                </button>
                                <small>{item.os || 'Unknown OS'}</small>
                              </td>
                              <td>{item.ips[0] || 'Unknown'}</td>
                              <td>
                                {item.online === null
                                  ? 'Unknown'
                                  : item.online
                                    ? 'Online'
                                    : 'Offline'}
                              </td>
                              <td>{item.connection}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!rows.length ? <p>No matching peers in this snapshot.</p> : null}
                    <div className="pp-tailnet-toolbar">
                      <button
                        type="button"
                        disabled={!table.getCanPreviousPage()}
                        onClick={() => table.previousPage()}
                      >
                        Previous devices
                      </button>
                      <span>
                        Page {table.state.pagination.pageIndex + 1} of{' '}
                        {Math.max(1, table.getPageCount())}
                      </span>
                      <button
                        type="button"
                        disabled={!table.getCanNextPage()}
                        onClick={() => table.nextPage()}
                      >
                        Next devices
                      </button>
                    </div>
                  </div>
                  {peer ? (
                    <aside aria-label={`Device ${peer.name}`}>
                      <h2>{peer.name}</h2>
                      <p>{peer.dnsName || 'No DNS name reported'}</p>
                      <dl>
                        <dt>Addresses</dt>
                        <dd>{peer.ips.join(', ') || 'Unknown'}</dd>
                        <dt>Connection endpoint</dt>
                        <dd>{peer.endpoint || 'No active endpoint reported'}</dd>
                        <dt>Assigned DERP region</dt>
                        <dd>
                          {peer.relay || 'Unknown'} · assignment alone does not prove relay use
                        </dd>
                        <dt>Allowed routes beyond own IPs</dt>
                        <dd>{peer.routes.join(', ') || 'None reported'}</dd>
                        <dt>Received / sent</dt>
                        <dd>
                          {peer.rxBytes} / {peer.txBytes} bytes · client counters
                        </dd>
                        <dt>Last handshake</dt>
                        <dd>{peer.lastHandshake || 'Unknown'}</dd>
                        <dt>Key expiry</dt>
                        <dd>{peer.keyExpiry || 'Not reported'}</dd>
                      </dl>
                      <div className="pp-tailnet-toolbar">
                        <label>
                          Service port{' '}
                          <input
                            aria-label="Peer service port"
                            value={port}
                            inputMode="numeric"
                            maxLength={5}
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
                            openScan({
                              initialTarget: `${ip.includes(':') ? `[${ip}]` : ip}:${port}`,
                            });
                          }}
                        >
                          Inspect peer service
                        </button>
                        <button
                          type="button"
                          disabled={!!busy || !peer.ips.length}
                          onClick={() => prepare('ping', peer.id, peer.name)}
                        >
                          Check peer connection
                        </button>
                      </div>
                    </aside>
                  ) : null}
                </div>
              ) : null}
              {section === 'Accounts' ? (
                <>
                  <h2>Accounts on this computer</h2>
                  <div className="pp-tailnet-toolbar">
                    <button
                      type="button"
                      disabled={!!busy || snapshot.state === 'Running'}
                      onClick={() => prepare('connect')}
                    >
                      Connect
                    </button>
                    <button
                      type="button"
                      disabled={!!busy || snapshot.state !== 'Running'}
                      onClick={() => prepare('disconnect')}
                    >
                      Disconnect
                    </button>
                    <button type="button" disabled={!!busy} onClick={() => prepare('logout')}>
                      Log out
                    </button>
                  </div>
                  {snapshot.profiles.map((profile) => (
                    <article key={profile.id}>
                      <strong>{profile.nickname || profile.tailnet || profile.account}</strong>
                      <p>
                        {profile.account} · {profile.tailnet}
                      </p>
                      <button
                        type="button"
                        disabled={!!busy || profile.selected || !profile.id}
                        onClick={() =>
                          prepare('switch', profile.id, profile.nickname || profile.account)
                        }
                      >
                        {profile.selected ? 'Current account' : 'Switch to this account'}
                      </button>
                    </article>
                  ))}
                  {!snapshot.profiles.length ? (
                    <p>No saved accounts reported. Sign in using the installed Tailscale app.</p>
                  ) : null}
                  <p>
                    Sign-in and OS permissions remain with Tailscale. ProtoPeek never asks for your
                    password.
                  </p>
                </>
              ) : null}
              {section === 'Exit nodes' ? (
                <>
                  <h2>Internet routing</h2>
                  <p>
                    Current exit node:{' '}
                    {peers.find((item) => item.exitNode)?.name || 'None reported'}
                  </p>
                  {!peers.some((item) => item.exitNodeOption) ? (
                    <p>No peers currently advertise exit-node availability to this client.</p>
                  ) : null}
                  <div className="pp-tailnet-toolbar">
                    <button
                      type="button"
                      disabled={!!busy || !peers.some((item) => item.exitNode)}
                      onClick={() => prepare('clear-exit')}
                    >
                      Stop using exit node
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => prepare('advertise-exit')}
                    >
                      Offer this device
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => prepare('stop-advertising-exit')}
                    >
                      Stop offering this device
                    </button>
                  </div>
                  {peers
                    .filter((item) => item.exitNodeOption)
                    .map((item) => (
                      <article key={item.id}>
                        <strong>{item.name}</strong>
                        <p>
                          {item.ips.join(', ')} · {item.online ? 'Online' : 'Offline or unknown'}
                        </p>
                        <button
                          type="button"
                          disabled={!!busy || item.exitNode || !item.online}
                          onClick={() => prepare('exit-node', item.id, item.name)}
                        >
                          {item.exitNode ? 'Current exit node' : 'Use this exit node'}
                        </button>
                      </article>
                    ))}
                </>
              ) : null}
              {section === 'Diagnostics' ? (
                <>
                  <h2>Connection diagnostics</h2>
                  <p>
                    Read local client health above, or explicitly probe NAT, UDP and relay
                    reachability.
                  </p>
                  <button type="button" disabled={!!busy} onClick={() => prepare('netcheck')}>
                    Prepare network diagnostics
                  </button>
                  <details>
                    <summary>Installed client</summary>
                    <p>{snapshot.version}</p>
                    <code>{snapshot.path}</code>
                    <p>MagicDNS suffix: {snapshot.magicDNS || 'Not reported'}</p>
                  </details>
                </>
              ) : null}
              {section === 'Taildrop' ? (
                <>
                  <h2>Taildrop files</h2>
                  <label>
                    Absolute local file or destination directory
                    <input
                      aria-label="Taildrop local path"
                      value={filePath}
                      maxLength={4096}
                      onChange={(event) => setFilePath(event.target.value)}
                    />
                  </label>
                  <DirectoryPicker initialPath={filePath} onChoose={setFilePath} />
                  <button
                    type="button"
                    disabled={!!busy || !filePath}
                    onClick={() => prepare('receive-files', '', filePath, filePath)}
                  >
                    Receive pending files here
                  </button>
                  <h3>Available recipients</h3>
                  {peers
                    .filter((item) => item.taildropAvailable)
                    .map((item) => (
                      <article key={item.id}>
                        <strong>{item.name}</strong>
                        <button
                          type="button"
                          disabled={!!busy || !filePath}
                          onClick={() => prepare('send-file', item.id, item.name, filePath)}
                        >
                          Send file to {item.name}
                        </button>
                      </article>
                    ))}
                  {!peers.some((item) => item.taildropAvailable) ? (
                    <p>The client reports no available Taildrop recipients.</p>
                  ) : null}
                  <p>
                    A file transfer has a five-minute limit. A timed-out transfer may have sent
                    bytes; inspect the destination before retrying.
                  </p>
                </>
              ) : null}
            </div>
          </div>
          {draft ? (
            <section className="pp-tailnet-review" aria-label="Review Tailscale operation">
              <h2 ref={reviewHeading} tabIndex={-1}>
                {tailActions[draft.action].label}
              </h2>
              <p>{tailActions[draft.action].detail}</p>
              {draft.label ? (
                <p>
                  Target: <strong>{draft.label}</strong>
                </p>
              ) : null}
              {draft.path ? (
                <p>
                  Path: <code>{draft.path}</code>
                </p>
              ) : null}
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={!!busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />{' '}
                I authorize this operation on this computer.
              </label>
              <div className="pp-tailnet-toolbar">
                <button type="button" disabled={!!busy || !consent} onClick={() => void execute()}>
                  Run selected operation
                </button>
                <button type="button" disabled={!!busy} onClick={() => setDraft(null)}>
                  Dismiss operation
                </button>
              </div>
            </section>
          ) : null}
          {output ? (
            <section aria-label="Tailscale command result">
              <h2>{tailActions[output.action].label} · result</h2>
              {output.observedAt ? (
                <small>Observed {new Date(output.observedAt).toLocaleString()}</small>
              ) : null}
              <pre>{output.text}</pre>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

import { Activity, Radio } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ThisPCActivity, ThisPCCapabilities, ThisPCSocket } from '@/console/this-pc-api';

import { ConsentPrompt } from './ConsentPrompt';
import type { IdleResource, Resource } from './device-state';

function formatEndpoint(endpoint: ThisPCSocket['local']) {
  const address = endpoint.address || (endpoint.wildcard ? '*' : 'not reported');
  const host = address.includes(':') && address !== '*' ? `[${address}]` : address;
  return `${host}:${endpoint.port}`;
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

export function SocketsPanel({
  kind,
  capabilities,
  activity,
  consentOpen,
  acknowledged,
  onOpen,
  onAcknowledged,
  onConfirm,
  onCancel,
}: {
  kind: 'listeners' | 'connections';
  capabilities: Resource<ThisPCCapabilities>;
  activity: IdleResource<ThisPCActivity>;
  consentOpen: boolean;
  acknowledged: boolean;
  onOpen: () => void;
  onAcknowledged: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const listeners = kind === 'listeners';
  const capability = capabilities.status === 'ready' ? capabilities.value.activity : null;
  const title = listeners ? 'Local listeners' : 'Current connections';
  const action =
    activity.status === 'ready'
      ? listeners
        ? 'Inspect again'
        : 'Observe again'
      : listeners
        ? 'Inspect local listeners'
        : 'Inspect current connections';
  return (
    <section
      className="this-pc-panel this-pc-workspace-panel"
      aria-labelledby={listeners ? 'listeners-title' : 'connections-title'}
    >
      <header>
        <div>
          <h2 id={listeners ? 'listeners-title' : 'connections-title'}>{title}</h2>
          <p>
            {listeners
              ? 'What this process/network namespace reports as bound locally at one moment.'
              : 'A one-time socket view initiated locally; it is not a background monitor.'}
          </p>
        </div>
        {!consentOpen ? (
          <button
            type="button"
            className="this-pc-button"
            disabled={!capability?.supported || activity.status === 'loading'}
            onClick={onOpen}
          >
            {listeners ? <Radio aria-hidden="true" /> : <Activity aria-hidden="true" />}
            {action}
          </button>
        ) : null}
      </header>
      {consentOpen ? (
        <ConsentPrompt
          title={listeners ? 'Inspect local listeners' : 'Inspect current connections'}
          acknowledged={acknowledged}
          onAcknowledged={onAcknowledged}
          acknowledgement="I understand this reads a one-time local socket snapshot."
          onConfirm={onConfirm}
          onCancel={onCancel}
          confirmLabel="Inspect once"
        >
          <p>
            This reads local listeners and current connections visible to the ProtoPeek
            process/network namespace at one moment. It does not send network probes.
          </p>
          <p>Process labels are best-effort local evidence and may be absent or restricted.</p>
        </ConsentPrompt>
      ) : activity.status === 'ready' ? (
        <>
          <SocketTable
            key={`${kind}-${activity.value.observedAt}`}
            sockets={listeners ? activity.value.listeners : activity.value.connections}
            kind={kind}
          />
          <ActivityNotes activity={activity.value} />
          {listeners ? (
            <p className="this-pc-limitation">
              A wildcard local bind does not prove reachability beyond this machine.
            </p>
          ) : null}
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
          {listeners
            ? 'Not inspected. No local listener or process information is read on page load.'
            : 'Not inspected. No current-connection or process information is read on page load.'}
          {listeners && !capability?.supported && capability?.reason ? ` ${capability.reason}` : ''}
        </p>
      )}
    </section>
  );
}

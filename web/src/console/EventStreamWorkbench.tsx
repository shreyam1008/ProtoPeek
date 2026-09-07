import { useEffect, useRef, useState } from 'react';
import {
  connectEventStream,
  type EventProtocol,
  type EventStreamRequest,
  parseStreamHeaders,
  type StreamEvent,
  sendStreamMessage,
} from './event-stream-api';
import { ProtocolInfo } from './ProtocolInfo';
import './event-stream.css';

type TimelineEvent = Omit<StreamEvent, 'kind'> & {
  kind: StreamEvent['kind'] | 'sent';
  key: number;
};

export function EventStreamWorkbench() {
  const [protocol, setProtocol] = useState<EventProtocol>('websocket');
  const [url, setURL] = useState('ws://localhost:8080/');
  const [headers, setHeaders] = useState('');
  const [subprotocols, setSubprotocols] = useState('');
  const [duration, setDuration] = useState('60');
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [encoding, setEncoding] = useState<'text' | 'base64'>('text');
  const [sending, setSending] = useState(false);
  const connection = useRef<AbortController | null>(null);
  const sendController = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const started = useRef(0);
  useEffect(
    () => () => {
      connection.current?.abort();
      sendController.current?.abort();
    },
    []
  );

  function append(event: StreamEvent | Omit<TimelineEvent, 'key'>) {
    const row = { ...event, key: ++sequence.current };
    setEvents((current) => [...current.slice(-199), row]);
  }

  async function connect() {
    if (connection.current) return;
    setError('');
    let request: EventStreamRequest;
    try {
      const target = new URL(url.trim());
      const schemes = protocol === 'websocket' ? ['ws:', 'wss:'] : ['http:', 'https:'];
      if (!schemes.includes(target.protocol) || target.username || target.password || target.hash) {
        throw new Error(`Use ${schemes.join(' or ')} without embedded credentials or a fragment.`);
      }
      const seconds = Number(duration);
      if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 120)
        throw new Error('Session duration must be 0.1–120 seconds.');
      request = {
        protocol,
        url: target.href,
        headers: parseStreamHeaders(headers),
        subprotocols:
          protocol === 'websocket'
            ? subprotocols
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
            : [],
        timeoutMs: Math.round(seconds * 1000),
      };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a valid endpoint.');
      return;
    }
    const controller = new AbortController();
    connection.current = controller;
    started.current = performance.now();
    setEvents([]);
    setSelected(null);
    setSessionId('');
    setBusy(true);
    setStatus('Connecting…');
    try {
      await connectEventStream(request, controller.signal, (event) => {
        if (controller.signal.aborted) return;
        append({ ...event, elapsedMs: Math.round(performance.now() - started.current) });
        if (event.kind === 'open') {
          setSessionId(event.sessionId ?? '');
          setStatus('Connected');
        }
        if (event.kind === 'closed' || event.kind === 'limit')
          setStatus(event.detail || 'Connection closed');
      });
      if (!controller.signal.aborted)
        setStatus((current) =>
          current === 'Connected' || current === 'Connecting…' ? 'Connection ended' : current
        );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Connection failed.');
        setStatus('Connection failed');
      }
    } finally {
      if (connection.current === controller) {
        connection.current = null;
        sendController.current?.abort();
        setBusy(false);
        setSending(false);
        setSessionId('');
      }
    }
  }

  function disconnect() {
    connection.current?.abort();
    sendController.current?.abort();
    setStatus('Disconnected by you');
  }

  async function send() {
    if (!sessionId || sending) return;
    setError('');
    const controller = new AbortController();
    sendController.current = controller;
    setSending(true);
    try {
      await sendStreamMessage(sessionId, message, encoding, controller.signal);
      if (!controller.signal.aborted)
        append({
          kind: 'sent',
          data: message,
          encoding,
          elapsedMs: Math.round(performance.now() - started.current),
        });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Message failed.');
    } finally {
      if (sendController.current === controller) {
        sendController.current = null;
        setSending(false);
      }
    }
  }
  const detail = events.find((event) => event.key === selected);

  return (
    <section className="pp-events" aria-label="Event stream workbench">
      <header>
        <h1>Event streams</h1>
        <ProtocolInfo protocol={protocol} />
      </header>
      <form
        className="pp-events-connect"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <label>
          Protocol
          <select
            value={protocol}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value as EventProtocol;
              setProtocol(next);
              setURL((current) =>
                next === 'sse'
                  ? current.replace(/^ws(s?):/, 'http$1:')
                  : current.replace(/^http(s?):/, 'ws$1:')
              );
            }}
          >
            <option value="websocket">WebSocket</option>
            <option value="sse">Server-sent events</option>
          </select>
        </label>
        <label className="pp-events-url">
          Endpoint URL
          <input
            type="url"
            required
            maxLength={8192}
            value={url}
            disabled={busy}
            onChange={(event) => setURL(event.target.value)}
            spellCheck={false}
          />
        </label>
        <label>
          Duration (seconds)
          <input
            type="number"
            min="0.1"
            max="120"
            step="0.1"
            value={duration}
            disabled={busy}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
        {busy ? (
          <button
            key="disconnect"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              disconnect();
            }}
          >
            Disconnect
          </button>
        ) : (
          <button key="connect" type="submit">
            Connect
          </button>
        )}
      </form>
      <details className="pp-events-options">
        <summary>Connection options</summary>
        <label>
          Headers
          <textarea
            value={headers}
            disabled={busy}
            onChange={(event) => setHeaders(event.target.value)}
            maxLength={270000}
            placeholder="Authorization: Bearer …"
            rows={3}
            spellCheck={false}
          />
        </label>
        {protocol === 'websocket' && (
          <label>
            Subprotocols
            <input
              value={subprotocols}
              disabled={busy}
              onChange={(event) => setSubprotocols(event.target.value)}
              maxLength={1032}
              placeholder="graphql-transport-ws, another-protocol"
            />
          </label>
        )}
        <small>
          Headers and messages stay in memory. TLS certificates are verified. Redirects are not
          followed.
        </small>
      </details>
      <div className="pp-events-status">
        <span role="status">{status}</span>
        <span>Latest {events.length} events · keeps 200</span>
        <button
          type="button"
          disabled={!events.length}
          onClick={() => {
            setEvents([]);
            setSelected(null);
          }}
        >
          Clear events
        </button>
      </div>
      {error && (
        <p role="alert" className="pp-events-error">
          {error}
        </p>
      )}
      <div className="pp-events-results">
        <section className="pp-events-timeline" aria-label="Stream events">
          {!events.length ? (
            <p>Connect to receive events. Nothing is sent until you connect.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th title="Browser observation time since Connect">Observed</th>
                  <th>Direction / event</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.key} aria-selected={event.key === selected}>
                    <td>{(event.elapsedMs / 1000).toFixed(3)}s</td>
                    <td>
                      {event.kind === 'message'
                        ? `↓ ${event.event || 'received'}`
                        : event.kind === 'sent'
                          ? '↑ sent'
                          : event.kind}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelected(event.key)}
                        aria-label={`Inspect event ${event.key}`}
                      >
                        {(
                          event.data ??
                          event.detail ??
                          (event.status ? `Status ${event.status}` : event.kind)
                        ).slice(0, 180) || '(empty message)'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {detail && (
          <aside aria-label="Selected event">
            <header>
              <strong>
                Event {detail.key} · {detail.encoding || detail.kind}
              </strong>
              <button type="button" onClick={() => setSelected(null)}>
                Close detail
              </button>
            </header>
            {detail.event && <p>Event type: {detail.event}</p>}
            {detail.id && <p>Last event ID: {detail.id}</p>}
            {detail.subprotocol && <p>Subprotocol: {detail.subprotocol}</p>}
            {detail.status !== undefined && <p>Status: {detail.status}</p>}
            <pre>{detail.data ?? detail.detail ?? 'Connection opened'}</pre>
          </aside>
        )}
      </div>
      {protocol === 'websocket' && (
        <form
          className="pp-events-send"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label>
            Message
            <textarea
              value={message}
              maxLength={90000}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="Type a text message or JSON"
            />
          </label>
          <label>
            Message format
            <select
              value={encoding}
              onChange={(event) => setEncoding(event.target.value as 'text' | 'base64')}
            >
              <option value="text">Text / JSON</option>
              <option value="base64">Binary (base64)</option>
            </select>
          </label>
          <button type="submit" disabled={!sessionId || sending}>
            {sending ? 'Sending…' : 'Send message'}
          </button>
        </form>
      )}
      <small className="pp-events-limits">
        Sessions stop at the chosen duration, 500 received events, or 2 MiB. Each message can be up
        to 64 KiB. Leaving this workbench disconnects. SSE does not reconnect automatically.
      </small>
    </section>
  );
}

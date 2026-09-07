import { Link } from '@tanstack/react-router';
import { Bot, Check, Copy, LoaderCircle, RefreshCw, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type AgentResult, type AgentState, agentFetch } from './agent-api';
import { normalizeHTTPResponse } from './api';
import { featureForPath } from './app/feature-registry';
import { HTTPResponsePanel } from './HTTPResponsePanel';
import './agent-workbench.css';

const example =
  'Use ProtoPeek to inspect my local listeners. Check the HTTP service I select, explain its response and timing, and show the results in ProtoPeek. Do not change services or download files.';

export function AgentWorkbench() {
  const [snapshot, setSnapshot] = useState<AgentState | null>(null);
  const setup = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            protopeek: {
              command: snapshot?.executable || 'protopeek',
              args: ['mcp'],
              ...(snapshot?.connectionFile
                ? { env: { PROTOPEEK_AGENT_CONNECTION: snapshot.connectionFile } }
                : {}),
            },
          },
        },
        null,
        2
      ),
    [snapshot?.executable, snapshot?.connectionFile]
  );
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);
  const [visible, setVisible] = useState(!document.hidden);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState('');
  const [writes, setWrites] = useState(false);
  const [selected, setSelected] = useState('');
  const [follow, setFollow] = useState(true);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [resultError, setResultError] = useState('');
  const [resultLoading, setResultLoading] = useState(false);
  const [copied, setCopied] = useState('');
  const controlRef = useRef<AbortController | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => {
      document.removeEventListener('visibilitychange', changed);
      controlRef.current?.abort();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // One revision wait while this view is visible. No timer polling in other
  // workspaces or hidden tabs; the server wakes this request on an actual change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly restarts the revision wait after a retry or local control.
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    async function watch() {
      let after: number | undefined;
      do {
        try {
          const next = await agentFetch<AgentState>(
            after === undefined ? 'state' : `state?after=${after}`,
            controller.signal
          );
          if (controller.signal.aborted) return;
          setSnapshot((prior) =>
            prior && prior.instance === next.instance && prior.revision > next.revision
              ? prior
              : next
          );
          setError('');
          after = next.revision;
        } catch (cause) {
          if (!controller.signal.aborted) {
            setError(
              cause instanceof Error ? cause.message : 'Agent activity could not be loaded.'
            );
            setLive(false);
          }
          return;
        }
      } while (live && !controller.signal.aborted);
    }
    void watch();
    return () => controller.abort();
  }, [live, visible, refresh]);

  const record = follow
    ? snapshot?.records[0]
    : snapshot?.records.find((item) => item.id === selected);
  const recordID = record?.id;
  const recordState = record?.state;
  const httpResponse = useMemo(() => {
    if (record?.tool !== 'http_request' || !result?.data) return null;
    try {
      return normalizeHTTPResponse(result.data);
    } catch {
      return null;
    }
  }, [record?.tool, result]);
  const destination = record ? featureForPath(record.route) : undefined;
  useEffect(() => {
    setResult(null);
    setResultError('');
    setResultLoading(false);
    if (!recordID || recordState === 'running') return;
    const controller = new AbortController();
    setResultLoading(true);
    void agentFetch<AgentResult>(`result?id=${encodeURIComponent(recordID)}`, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setResultError(cause instanceof Error ? cause.message : 'Result unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setResultLoading(false);
      });
    return () => controller.abort();
  }, [recordID, recordState]);

  async function control(action: string, id?: string) {
    const controller = new AbortController();
    controlRef.current?.abort();
    controlRef.current = controller;
    setBusy(action);
    setError('');
    try {
      const next = await agentFetch<AgentState>('control', controller.signal, {
        action,
        id,
        allowWrites: writes,
      });
      if (!controller.signal.aborted) {
        setSnapshot(next);
        setWrites(next.allowWrites);
        setRefresh((value) => value + 1);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Agent setting could not be changed.');
    } finally {
      if (!controller.signal.aborted) setBusy('');
    }
  }
  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(''), 2000);
    } catch {
      setError('Clipboard unavailable. Select and copy the visible text.');
    }
  }

  return (
    <div className="pp-agent-workbench">
      <header className="pp-agent-heading">
        <div>
          <Bot aria-hidden="true" />
          <h1>AI agents</h1>
          <span>Local MCP · shared workbench</span>
        </div>
        <span className={`pp-agent-status ${snapshot?.enabled ? 'is-enabled' : ''}`}>
          {snapshot ? (snapshot.enabled ? 'Connection enabled' : 'Connection off') : 'Connecting…'}
        </span>
      </header>
      {error ? (
        <p className="pp-agent-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pp-agent-layout">
        <aside className="pp-agent-setup" aria-label="Agent connection setup">
          <h2>Bring your agent</h2>
          <p>
            Your agent runs the tools. You see the evidence here. ProtoPeek does not run an AI model
            or require an account.
          </p>
          <ol>
            <li>
              <strong>Pair this workbench</strong>
              <p>
                Save a private connection file on this machine. Keep ProtoPeek running; pair again
                after a restart.
              </p>
            </li>
            <li>
              <strong>Add ProtoPeek to your agent</strong>
              <p>
                This MCP entry uses the running binary and its pairing file, so your agent attaches
                to this workbench.
              </p>
            </li>
            <li>
              <strong>Ask for a real check</strong>
              <p>Requests, results and cancellation appear alongside your work.</p>
            </li>
          </ol>
          <label className="pp-agent-check">
            <input
              type="checkbox"
              checked={snapshot?.enabled ? snapshot.allowWrites : writes}
              disabled={!!snapshot?.enabled || !!busy}
              onChange={(event) => setWrites(event.target.checked)}
            />
            Allow write actions
          </label>
          <p className="pp-agent-caption">
            Adds HTTP POST/PUT/PATCH/DELETE and download controls. Turn the connection off to change
            this choice.
          </p>
          <button
            type="button"
            className="pp-agent-primary"
            disabled={!!busy || !snapshot}
            onClick={() => void control(snapshot?.enabled ? 'disable' : 'enable')}
          >
            {busy ? (
              <LoaderCircle className="pp-agent-spin" aria-hidden="true" />
            ) : snapshot?.enabled ? (
              <Square aria-hidden="true" />
            ) : (
              <Bot aria-hidden="true" />
            )}
            {snapshot?.enabled ? 'Disable and cancel active calls' : 'Enable agent connection'}
          </button>
          <div className="pp-agent-code-title">
            <strong>MCP configuration</strong>
            <button
              type="button"
              onClick={() => void copy('config', setup)}
              aria-label="Copy MCP configuration"
            >
              {copied === 'config' ? <Check /> : <Copy />}
            </button>
          </div>
          <figure aria-label="MCP configuration">
            <pre>{setup}</pre>
          </figure>
          <details>
            <summary>CLI and agent instructions</summary>
            <p>Agents that use a shell can discover the same tools and JSON schemas:</p>
            <pre>
              protopeek agent tools{'\n'}protopeek agent guide{'\n'}protopeek agent --help
            </pre>
            <p>
              Pass a JSON object on stdin to <code>protopeek agent call NAME</code>. The MCP guide
              is also available as <code>protopeek://agent-guide</code>.
            </p>
          </details>
          <details>
            <summary>Example prompt</summary>
            <p>{example}</p>
            <button type="button" onClick={() => void copy('prompt', example)}>
              {copied === 'prompt' ? 'Copied' : 'Copy example prompt'}
            </button>
          </details>
          <details>
            <summary>Data and limits</summary>
            <p>
              The latest 32 results stay in memory, up to 64 KiB each. Inputs are not kept in
              activity. Results can contain service data and are visible to your agent and its model
              provider. No cloud sync.
            </p>
            <p>
              Two calls at a time, 60 seconds each. Cancellation cannot undo a request already
              received by a service. Queued downloads continue separately.
            </p>
          </details>
          <details>
            <summary>{snapshot?.tools.length ?? 'Available'} tools</summary>
            {snapshot?.tools.map((tool) => (
              <div className="pp-agent-tool" key={tool.name}>
                <strong>{tool.name}</strong>
                <p>{tool.description}</p>
              </div>
            ))}
            <p>
              gRPC calls, WebSocket/SSE, Cap’n Proto, capture and tunnel changes remain in their
              existing UI workspaces; this adapter does not expose them yet.
            </p>
          </details>
        </aside>
        <section className="pp-agent-activity" aria-label="Agent activity">
          <div className="pp-agent-toolbar">
            <h2>
              Activity <span>{snapshot?.records.length ?? 0}/32</span>
            </h2>
            <label>
              <input
                type="checkbox"
                checked={live}
                onChange={(event) => setLive(event.target.checked)}
              />
              Live
            </label>
            <label>
              <input
                type="checkbox"
                checked={follow}
                onChange={(event) => setFollow(event.target.checked)}
              />
              Follow latest
            </label>
            <button
              type="button"
              aria-label="Refresh agent activity"
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw />
            </button>
            <button
              type="button"
              disabled={!!busy || !snapshot?.records.some((item) => item.state !== 'running')}
              onClick={() => void control('clear')}
            >
              Clear finished
            </button>
          </div>
          {!snapshot ? (
            <p role="status">
              <LoaderCircle className="pp-agent-spin" />
              Loading connection and activity…
            </p>
          ) : !snapshot.records.length ? (
            <div className="pp-agent-empty">
              <Bot aria-hidden="true" />
              <h3>Watch your agent work</h3>
              <p>
                Connect your agent, then ask it to inspect local listeners or check an HTTP
                endpoint. Actual tool calls will appear here.
              </p>
              <code>Find my local service → inspect its response → explain the evidence</code>
            </div>
          ) : (
            <div className="pp-agent-evidence">
              <ul className="pp-agent-records" aria-label="Recent agent calls">
                {snapshot.records.map((item) => (
                  <li key={item.id} className={recordID === item.id ? 'is-selected' : ''}>
                    <button
                      type="button"
                      aria-pressed={recordID === item.id}
                      onClick={() => {
                        setSelected(item.id);
                        setFollow(false);
                      }}
                    >
                      <span>
                        {item.state === 'running' ? (
                          <LoaderCircle className="pp-agent-spin" />
                        ) : (
                          <Bot />
                        )}
                        <strong>{item.tool}</strong>
                      </span>
                      <span>
                        {item.state.replaceAll('_', ' ')} ·{' '}
                        {item.state === 'running' ? 'in progress' : `${item.durationMs} ms`}
                      </span>
                      <small>{new Date(item.startedAt).toLocaleTimeString()}</small>
                    </button>
                    {item.state === 'running' ? (
                      <button
                        type="button"
                        disabled={!!busy}
                        aria-label={`Cancel ${item.tool}`}
                        onClick={() => void control('cancel', item.id)}
                      >
                        <X />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <section className="pp-agent-result" aria-label="Selected agent result">
                <div className="pp-agent-result-title">
                  <h3>{record?.tool ?? 'Select a call'}</h3>
                  {destination ? (
                    <Link to={destination.route}>Open {destination.label}</Link>
                  ) : null}
                </div>
                {record ? (
                  <p className="pp-agent-caption">
                    Receipt {record.id} · {record.state.replaceAll('_', ' ')}
                    {record.status >= 400 ? ` · ${record.status}` : ''}
                  </p>
                ) : null}
                {record?.state === 'running' ? (
                  <p role="status">
                    <LoaderCircle className="pp-agent-spin" />
                    Waiting for the service. You can cancel this call.
                  </p>
                ) : null}
                {resultLoading ? <p role="status">Loading result…</p> : null}
                {resultError ? <p role="alert">{resultError}</p> : null}
                {result?.truncated ? (
                  <p role="status">
                    Truncated preview. This activity view retains at most 64 KiB per result.
                  </p>
                ) : null}
                {httpResponse ? (
                  <div className="pp-agent-http-result">
                    <HTTPResponsePanel response={httpResponse} loading={false} error={null} />
                  </div>
                ) : result ? (
                  <figure aria-label="Agent result JSON">
                    <pre>
                      {result.data === undefined
                        ? result.preview || 'No response body.'
                        : JSON.stringify(result.data, null, 2)}
                    </pre>
                  </figure>
                ) : null}
              </section>
            </div>
          )}
        </section>
      </div>
      <footer className="pp-agent-footer">
        <span>
          {visible && live ? 'Live while this view is visible' : 'Activity updates paused'}
        </span>
        <span>Shared local services · results are service evidence</span>
      </footer>
    </div>
  );
}

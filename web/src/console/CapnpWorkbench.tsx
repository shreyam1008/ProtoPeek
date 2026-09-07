import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/console/shell/EmptyState';
import { PageHeader } from '@/console/shell/PageHeader';
import {
  type CapnpResult,
  type CapnpSchema,
  type CapnpSource,
  callCapnp,
  capnpCapabilities,
  loadCapnpSchema,
  readCapnpFiles,
} from './capnp-api';
import { ProtocolInfo } from './ProtocolInfo';
import './capnp.css';

type SchemaInput = { schemaBase64?: string; files?: CapnpSource[]; root?: string };
const methodKey = (method: { interfaceId: string; ordinal: number }) =>
  `${method.interfaceId}/${method.ordinal}`;

export function CapnpWorkbench() {
  const [schema, setSchema] = useState<CapnpSchema | null>(null);
  const [input, setInput] = useState<SchemaInput | null>(null);
  const [selection, setSelection] = useState('');
  const [filter, setFilter] = useState('');
  const [address, setAddress] = useState('localhost:7000');
  const [transport, setTransport] = useState('tcp');
  const [timeout, setTimeoutValue] = useState('10');
  const [serverName, setServerName] = useState('');
  const [rootCaPem, setRootCaPem] = useState('');
  const [params, setParams] = useState('{}');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<CapnpResult | null>(null);
  const [compiler, setCompiler] = useState<{ available: boolean; reason: string } | null>(null);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [pastedSource, setPastedSource] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void capnpCapabilities(controller.signal)
      .then(setCompiler)
      .catch(() => {
        if (!controller.signal.aborted)
          setCompiler({
            available: false,
            reason:
              'Could not check the source compiler. You can still try loading a compiled .bin schema.',
          });
      });
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, []);
  const method = schema?.methods.find((item) => methodKey(item) === selection);
  const methods = useMemo(
    () =>
      schema?.methods.filter((item) =>
        `${item.interfaceName} ${item.name}`.toLowerCase().includes(filter.toLowerCase())
      ) ?? [],
    [schema, filter]
  );
  const response = result ? JSON.stringify(result.result, null, 2) : '';

  function cancel() {
    active.current?.abort();
    active.current = null;
    setBusy('');
    setMessage('Cancelled. A request already delivered to the peer may have taken effect.');
  }
  async function chooseFiles(files: File[]) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy('Reading files');
    setError('');
    setMessage('');
    try {
      const next = await readCapnpFiles(files);
      if (active.current !== controller) return;
      setInput(next);
      setSchema(null);
      setResult(null);
      setSelection('');
    } catch (cause) {
      if (active.current === controller)
        setError(cause instanceof Error ? cause.message : 'Unable to read schema files.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy('');
      }
    }
  }
  async function load(next: SchemaInput | null = input) {
    if (!next || busy) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy('Loading schema');
    setError('');
    setMessage('');
    setResult(null);
    try {
      const loaded = await loadCapnpSchema(next, controller.signal);
      if (active.current !== controller) return;
      setSchema(loaded);
      setSelection(loaded.methods[0] ? methodKey(loaded.methods[0]) : '');
      setParams('{}');
      setSourceOpen(false);
      setMessage(
        loaded.methods.length
          ? `${loaded.methods.length} methods loaded. No connection has been made.`
          : 'Schema loaded, but it contains no RPC interfaces.'
      );
    } catch (cause) {
      if (active.current === controller)
        setError(cause instanceof Error ? cause.message : 'Schema loading failed.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy('');
      }
    }
  }
  async function send() {
    if (!schema || !method || busy) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy('Calling');
    setError('');
    setMessage('');
    setResult(null);
    try {
      if (new TextEncoder().encode(params).length > 65536)
        throw new Error('Request JSON exceeds 64 KiB.');
      const seconds = Number(timeout);
      if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 30)
        throw new Error('Timeout must be 0.1–30 seconds.');
      const value = await callCapnp(
        {
          schemaBase64: schema.schemaBase64,
          address: address.trim(),
          transport,
          serverName: transport === 'tls' ? serverName.trim() : '',
          rootCaPem: transport === 'tls' ? rootCaPem : '',
          interfaceId: method.interfaceId,
          ordinal: method.ordinal,
          timeoutMs: Math.round(seconds * 1000),
          params,
        },
        controller.signal
      );
      if (active.current === controller) {
        setResult(value);
        setMessage('Call completed.');
      }
    } catch (cause) {
      if (active.current === controller)
        setError(cause instanceof Error ? cause.message : 'Call failed.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy('');
      }
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(response);
      setMessage('Response copied.');
    } catch {
      setError('Clipboard unavailable. Select the response text to copy it.');
    }
  }
  function save() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'protopeek-capnp-response.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return (
    <div className="pp-capnp">
      <PageHeader className="pp-capnp-heading">
        <h1>Cap’n Proto</h1>
        <ProtocolInfo protocol="capnp" />
      </PageHeader>
      <aside className="pp-capnp-sidebar" aria-label="Cap’n Proto schema and methods">
        <details open={sourceOpen} onToggle={(event) => setSourceOpen(event.currentTarget.open)}>
          <summary>Schema {schema ? `· ${schema.nodeCount} nodes` : '· not loaded'}</summary>
          <label>
            Schema files
            <input
              aria-label="Cap’n Proto schema files"
              type="file"
              accept=".capnp,.bin"
              multiple
              disabled={Boolean(busy)}
              onChange={(event) => void chooseFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          {input?.files ? (
            <label>
              Root file
              <select
                value={input.root}
                disabled={Boolean(busy)}
                onChange={(event) => setInput({ ...input, root: event.target.value })}
              >
                {input.files.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" disabled={!input || Boolean(busy)} onClick={() => void load()}>
            Load selected schema
          </button>
          <details>
            <summary>Paste a source schema</summary>
            <label>
              Schema source
              <textarea
                aria-label="Cap’n Proto schema source"
                value={pastedSource}
                maxLength={512 * 1024}
                spellCheck={false}
                rows={8}
                onChange={(event) => setPastedSource(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!pastedSource.trim() || Boolean(busy)}
              onClick={() =>
                void load({
                  root: 'workbench.capnp',
                  files: [{ path: 'workbench.capnp', source: pastedSource }],
                })
              }
            >
              Compile pasted schema
            </button>
          </details>
          <small>
            {compiler?.available
              ? 'Source compiler available. RPC runtime is built in.'
              : compiler?.reason || 'Checking local compiler availability…'}
          </small>
          <details>
            <summary>Compiled schema help</summary>
            <p>
              For schemas with imports, compile them locally or upload the required source files
              together.
            </p>
            <code>capnp compile -o- service.capnp &gt; service.bin</code>
            <p>On Windows, use Command Prompt or PowerShell 7.4+ for binary redirection.</p>
            <p>
              Load the .bin file without installing a compiler on this computer. Schemas and request
              bodies stay in this session.
            </p>
            <a href="https://capnproto.org/install.html" target="_blank" rel="noreferrer">
              Official compiler setup
            </a>
          </details>
        </details>
        {schema ? (
          <>
            <label>
              Find a method
              <input
                type="search"
                value={filter}
                maxLength={128}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            <nav aria-label="Cap’n Proto methods">
              {methods.map((item) => (
                <button
                  type="button"
                  key={methodKey(item)}
                  aria-label={`${item.interfaceName} ${item.name}`}
                  aria-current={selection === methodKey(item) ? 'true' : undefined}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setSelection(methodKey(item));
                    setParams('{}');
                    setResult(null);
                    setError('');
                    setMessage('');
                  }}
                >
                  <small title={item.interfaceName}>{item.interfaceName.split(':').pop()}</small>
                  <strong>{item.name}</strong>
                </button>
              ))}
            </nav>
            {!methods.length ? <p>No matching methods.</p> : null}
          </>
        ) : null}
      </aside>
      <section className="pp-capnp-main" aria-label="Cap’n Proto call workspace">
        <form
          className="pp-capnp-connect"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="pp-capnp-target">
            Endpoint
            <input
              aria-label="Cap’n Proto endpoint"
              value={address}
              maxLength={320}
              autoComplete="off"
              spellCheck={false}
              disabled={Boolean(busy)}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
          <label>
            Transport
            <select
              value={transport}
              disabled={Boolean(busy)}
              onChange={(event) => setTransport(event.target.value)}
            >
              <option value="tcp">TCP · plaintext</option>
              <option value="tls">TLS · verified</option>
            </select>
          </label>
          <label>
            Timeout (s)
            <input
              aria-label="Cap’n Proto timeout"
              type="number"
              min="0.1"
              max="30"
              step="0.1"
              value={timeout}
              disabled={Boolean(busy)}
              onChange={(event) => setTimeoutValue(event.target.value)}
            />
          </label>
          {busy ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                cancel();
              }}
            >
              Cancel {busy.toLowerCase()}
            </button>
          ) : (
            <button type="submit" disabled={!method}>
              Call method
            </button>
          )}
        </form>
        {transport === 'tls' ? (
          <details className="pp-capnp-tls">
            <summary>TLS identity & custom CA</summary>
            <label>
              Server name override
              <input
                value={serverName}
                maxLength={253}
                onChange={(event) => setServerName(event.target.value)}
              />
            </label>
            <label>
              Additional CA certificates (PEM)
              <textarea
                value={rootCaPem}
                maxLength={32768}
                rows={4}
                spellCheck={false}
                onChange={(event) => setRootCaPem(event.target.value)}
              />
            </label>
            <small>Certificate and hostname verification stay enabled.</small>
          </details>
        ) : null}
        {error ? (
          <p role="alert" className="pp-capnp-error">
            {error}
          </p>
        ) : null}
        {busy || message ? (
          <p role="status" className="pp-capnp-status">
            {busy ? `${busy}…` : message}
          </p>
        ) : null}
        {method ? (
          <div className="pp-capnp-editors">
            <section aria-label="Cap’n Proto request">
              <header>
                <strong>{method.name}</strong>
                <small>
                  {method.interfaceId} / {method.ordinal}
                </small>
              </header>
              <details>
                <summary>Parameter fields · {method.fields.length}</summary>
                <p>
                  Omit fields to use schema defaults. Int64/UInt64 responses use exact strings; Data
                  uses base64. One field per union.
                </p>
                <dl>
                  {method.fields.map((field) => (
                    <div key={field.name}>
                      <dt>
                        {field.name}
                        {field.union ? ' (union)' : ''}
                      </dt>
                      <dd>{field.type}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <label className="pp-capnp-json">
                Request JSON
                <textarea
                  aria-label="Cap’n Proto request JSON"
                  value={params}
                  onChange={(event) => setParams(event.target.value)}
                  maxLength={65536}
                  spellCheck={false}
                  disabled={Boolean(busy)}
                />
              </label>
            </section>
            <section aria-label="Cap’n Proto response">
              <header>
                <strong>Response</strong>
                <div>
                  <button type="button" disabled={!result} onClick={() => void copy()}>
                    Copy
                  </button>
                  <button type="button" disabled={!result} onClick={save}>
                    Save JSON
                  </button>
                </div>
              </header>
              {result ? (
                <>
                  <small>
                    {result.durationMs} ms · {result.remoteAddress} · {result.tlsVersion || 'TCP'} ·{' '}
                    {new Date(result.observedAt).toLocaleTimeString()}
                  </small>
                  <textarea
                    className="pp-capnp-response-json"
                    aria-label="Cap’n Proto response JSON"
                    readOnly
                    value={response}
                    spellCheck={false}
                  />
                </>
              ) : (
                <p className="pp-capnp-empty">
                  {busy === 'Calling'
                    ? 'Waiting for the peer…'
                    : 'Call the selected method to inspect its response.'}
                </p>
              )}
            </section>
          </div>
        ) : (
          <EmptyState title="Load your service schema">
            Choose .capnp source files or a compiled schema, select a method, then call your local
            or remote endpoint. This client calls the connection’s bootstrap capability.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

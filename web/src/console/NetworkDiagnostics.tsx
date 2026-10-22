import { Link, useSearch } from '@tanstack/react-router';
import { useContext, useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';
import { type ReceiptOutcome, recordOperationReceipt } from './app/operation-receipts';
import {
  type DiagnosticCertificate,
  type DiagnosticCheck,
  type DiagnosticMode,
  type DiagnosticResult,
  diagnosticHandoff,
  diagnosticModes,
} from './network-diagnostics';
import { ProtocolShellContext } from './ProtocolShellContext';
import { OperationStatus } from './shell/OperationStatus';
import { PageHeader } from './shell/PageHeader';
import './network-diagnostics.css';

export function NetworkDiagnostics() {
  const shell = useContext(ProtocolShellContext);
  const incoming = useSearch({ from: '/network/diagnostics' });
  const [mode, setMode] = useState<DiagnosticMode>(incoming.mode ?? 'diagnose');
  const [target, setTarget] = useState(incoming.target ?? '');
  const [timeoutMs, setTimeoutMs] = useState(1500);
  const [recordType, setRecordType] = useState('A');
  const [resolver, setResolver] = useState('');
  const [serverName, setServerName] = useState('');
  const [alpn, setALPN] = useState('h2,http/1.1');
  const [caPem, setCAPEM] = useState('');
  const [testTls, setTestTls] = useState(!incoming.target?.startsWith('http://'));
  const [samples, setSamples] = useState(5);
  const [intervalMs, setIntervalMs] = useState(250);
  const [payload, setPayload] = useState('');
  const [encoding, setEncoding] = useState('text');
  const [proxy, setProxy] = useState('');
  const [proxyUsername, setProxyUsername] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [resultTLSRequested, setResultTLSRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const resultRegion = useRef<HTMLElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (result) resultRegion.current?.focus();
  }, [result]);
  const dns = mode === 'dns' || mode === 'dns-compare';
  const tls = mode === 'tls' || mode === 'http3' || (mode === 'diagnose' && testTls);
  const exchange = mode === 'tcp-exchange' || mode === 'udp-exchange';
  const proxyMode = mode === 'http-proxy' || mode === 'socks5-proxy';
  const description = diagnosticModes.find(([id]) => id === mode)?.[2];
  async function run() {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setNotice('');
    setResult(null);
    const started = performance.now();
    let receiptOutcome: ReceiptOutcome = 'failed';
    try {
      const data = await fetchJSON<DiagnosticResult>('api/network/diagnostics', {
        method: 'POST',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          target: target.trim(),
          timeoutMs,
          recordType: dns ? recordType : '',
          resolver: dns ? resolver.trim() : '',
          serverName: tls ? serverName.trim() : '',
          alpn: tls
            ? alpn
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
            : [],
          caPem: tls ? caPem : '',
          testTls,
          samples,
          intervalMs,
          payload: exchange ? payload : '',
          encoding,
          proxy: proxyMode ? proxy.trim() : '',
          proxyUsername: proxyMode ? proxyUsername : '',
          proxyPassword: proxyMode ? proxyPassword : '',
        }),
      });
      receiptOutcome = abort.signal.aborted
        ? 'cancelled'
        : !data.complete || data.outcome === 'partial'
          ? 'partial'
          : ['success', 'received'].includes(data.outcome)
            ? 'success'
            : 'failed';
      if (!abort.signal.aborted) {
        setResultTLSRequested(tls);
        setResult(data);
      }
    } catch (cause) {
      receiptOutcome = abort.signal.aborted ? 'cancelled' : 'failed';
      if (abort.signal.aborted) setNotice('Cancelled. No completed result was received.');
      else setError(cause instanceof Error ? cause.message : 'The diagnostic could not complete.');
    } finally {
      if (abort.signal.aborted) setNotice('Cancelled. No completed result was received.');
      recordOperationReceipt({
        operation: 'diagnostics',
        outcome: receiptOutcome,
        durationMs: performance.now() - started,
      });
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function prepareRequest(protocol: 'http' | 'grpc') {
    if (!result || !shell) return;
    try {
      const prepared = shell.openHandoff(diagnosticHandoff(result, protocol, resultTLSRequested));
      if (!prepared.ok)
        setNotice(`${prepared.error} Choose Run diagnostic to refresh the evidence.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Run the diagnostic again.');
    }
  }
  function exportResult() {
    if (!result) return;
    // The API result excludes credentials, CA input and sent payload. Replies are
    // deliberately excluded too: a service can echo a private payload.
    const safe = {
      ...result,
      exchange: result.exchange
        ? { ...result.exchange, replyHex: undefined, replyText: undefined }
        : undefined,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'protopeek-diagnostic.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="pp-diagnostics">
      <PageHeader>
        <div>
          <h1>Diagnostics</h1>
          <p>One target. Clear evidence. No background monitoring.</p>
        </div>
        <Link to="/network/path">Trace a path</Link>
      </PageHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <fieldset disabled={busy}>
          <div className="pp-diag-target">
            <label>
              Diagnostic
              <select
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as DiagnosticMode);
                  setResult(null);
                  setError('');
                  setNotice('');
                }}
              >
                {diagnosticModes.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {mode === 'subnet'
                ? 'CIDR prefix'
                : dns
                  ? recordType === 'PTR'
                    ? 'IP address'
                    : 'DNS name'
                  : 'Target'}
              <input
                required
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                maxLength={1024}
                placeholder={
                  mode === 'subnet'
                    ? '192.168.1.0/24'
                    : dns
                      ? 'example.com'
                      : exchange
                        ? 'localhost:8080'
                        : 'localhost:8080 or https://example.com'
                }
                spellCheck={false}
              />
            </label>
            <button className="pp-diag-run" type="submit">
              {mode === 'subnet' ? 'Calculate' : 'Run diagnostic'}
            </button>
          </div>
          <p className="pp-diag-description">{description}</p>
          <div className="pp-diag-options">
            {mode !== 'subnet' && (
              <label>
                Probe timeout
                <select
                  value={timeoutMs}
                  onChange={(event) => setTimeoutMs(Number(event.target.value))}
                >
                  <option value={500}>500 ms</option>
                  <option value={1500}>1.5 seconds</option>
                  <option value={3000}>3 seconds</option>
                </select>
              </label>
            )}
            {mode === 'diagnose' && (
              <label className="pp-diag-checkbox">
                <input
                  type="checkbox"
                  checked={testTls}
                  onChange={(event) => setTestTls(event.target.checked)}
                />
                Verify TLS after connecting
              </label>
            )}
            {dns && (
              <>
                <label>
                  Record
                  <select
                    value={recordType}
                    onChange={(event) => setRecordType(event.target.value)}
                  >
                    {['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'SRV', 'PTR'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  DNS server {mode === 'dns' ? '(optional)' : ''}
                  <input
                    required={mode === 'dns-compare'}
                    value={resolver}
                    onChange={(event) => setResolver(event.target.value)}
                    placeholder="IP or IP:port"
                  />
                </label>
              </>
            )}
            {mode === 'availability' && (
              <>
                <label>
                  Samples
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={samples}
                    onChange={(event) => setSamples(Number(event.target.value))}
                  />
                </label>
                <label>
                  Interval (ms)
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={50}
                    value={intervalMs}
                    onChange={(event) => setIntervalMs(Number(event.target.value))}
                  />
                </label>
              </>
            )}
            {exchange && (
              <label>
                Payload encoding
                <select value={encoding} onChange={(event) => setEncoding(event.target.value)}>
                  <option value="text">UTF-8 text</option>
                  <option value="hex">Hex bytes</option>
                </select>
              </label>
            )}
          </div>
          {tls && (
            <details className="pp-diag-advanced">
              <summary>TLS identity and trust</summary>
              <div className="pp-diag-options">
                <label>
                  Server name (optional)
                  <input
                    value={serverName}
                    maxLength={253}
                    onChange={(event) => setServerName(event.target.value)}
                    placeholder="Defaults to target host"
                  />
                </label>
                {mode !== 'http3' && (
                  <label>
                    ALPN protocols
                    <input
                      value={alpn}
                      onChange={(event) => setALPN(event.target.value)}
                      placeholder="h2,http/1.1"
                    />
                  </label>
                )}
              </div>
              <label>
                Private CA certificate (optional)
                <textarea
                  value={caPem}
                  onChange={(event) => setCAPEM(event.target.value)}
                  maxLength={65536}
                  placeholder="PEM certificate"
                  rows={4}
                />
              </label>
              <small>
                Added to system trust for this run only. Kept in memory; never installed or saved.
              </small>
            </details>
          )}
          {exchange && (
            <label>
              Payload (optional, up to 4 KiB)
              <textarea
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                maxLength={12288}
                rows={4}
                spellCheck={false}
              />
              <small>
                {mode === 'udp-exchange'
                  ? 'An empty payload listens without sending a datagram.'
                  : 'An empty payload connects and listens.'}{' '}
                Reply limit: 64 KiB. Total operation limit: 15 seconds.
              </small>
            </label>
          )}
          {proxyMode && (
            <>
              <div className="pp-diag-options">
                <label>
                  Proxy address
                  <input
                    required
                    value={proxy}
                    onChange={(event) => setProxy(event.target.value)}
                    placeholder={mode === 'http-proxy' ? '127.0.0.1:8080' : '127.0.0.1:1080'}
                  />
                </label>
                <label>
                  Username (optional)
                  <input
                    value={proxyUsername}
                    maxLength={255}
                    autoComplete="off"
                    onChange={(event) => setProxyUsername(event.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={proxyPassword}
                    maxLength={255}
                    autoComplete="off"
                    onChange={(event) => setProxyPassword(event.target.value)}
                  />
                </label>
              </div>
              <p className="pp-diag-caution">
                Proxy authentication uses the proxy's plaintext connection. Use trusted networks.
                Credentials stay in memory; the destination is resolved locally and pinned.
              </p>
            </>
          )}
        </fieldset>
        {busy && (
          <button type="button" onClick={() => controller.current?.abort()}>
            Cancel diagnostic
          </button>
        )}
      </form>
      <OperationStatus busy={busy} label="Running bounded diagnostic" />
      {error && (
        <p className="pp-diag-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {result ? (
        <section
          ref={resultRegion}
          tabIndex={-1}
          className="pp-diag-results"
          aria-label="Diagnostic result"
        >
          <div className="pp-diag-result-heading">
            <div>
              <strong>{result.outcome}</strong>
              <h2>{result.target}</h2>
            </div>
            <button type="button" onClick={exportResult}>
              Export evidence
            </button>
          </div>
          <p>{result.summary}</p>
          <small>
            {new Date(result.observedAt).toLocaleString()} · {result.durationMs.toFixed(1)} ms ·{' '}
            {result.complete ? 'Operation complete' : 'Partial evidence'}
          </small>
          {result.warnings.map((warning) => (
            <p className="pp-diag-caution" key={warning}>
              {warning}
            </p>
          ))}
          {result.addresses.length > 0 && (
            <p className="pp-diag-addresses">Pinned addresses: {result.addresses.join(', ')}</p>
          )}
          {result.checks.length > 0 && <CheckTable checks={result.checks} />}
          {result.comparison && <h3>Resolver comparison: {result.comparison}</h3>}
          {result.dns.map((observation) => (
            <section key={observation.resolver}>
              <h3>
                {observation.resolver} · {observation.outcome}
              </h3>
              <p>
                {observation.transport} · {observation.durationMs.toFixed(1)} ms
                {observation.responseCode
                  ? ` · ${observation.responseCode}${observation.authoritative ? ' · authoritative' : ''}`
                  : ' · TTL and response code unavailable'}
              </p>
              {observation.detail && <p>{observation.detail}</p>}
              {observation.limited && (
                <p className="pp-diag-caution">Limited response. Comparison may be incomplete.</p>
              )}
              <section
                className="pp-diag-table"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Horizontal evidence needs keyboard scrolling (WCAG 2.1.1).
                tabIndex={0}
                aria-label={`${observation.resolver} DNS records`}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Value</th>
                      <th>TTL (s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidenceRows(observation.records, (record) => JSON.stringify(record)).map(
                      ({ key, value: record }) => (
                        <tr key={key}>
                          <td>{record.name}</td>
                          <td>{record.type}</td>
                          <td>{record.value}</td>
                          <td>{record.ttlSeconds ?? 'Unavailable'}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </section>
            </section>
          ))}
          {result.tls && (
            <section>
              <h3>TLS · {result.tls.verified ? 'Verified' : 'Not verified'}</h3>
              <p>
                {result.tls.version} · {result.tls.cipher} · ALPN:{' '}
                {result.tls.alpn || 'None negotiated'}
              </p>
              <p>
                Identity: {result.tls.serverName} · Trust: {result.tls.verifier}
              </p>
              {result.tls.verifyError && <p className="pp-diag-error">{result.tls.verifyError}</p>}
              {result.tls.limited && (
                <p className="pp-diag-caution">
                  Certificate display is limited to 8 certificates per chain, 32 names and addresses
                  per certificate, and bounded text fields. Verification used the complete received
                  chain.
                </p>
              )}
              <CertificateList
                title="Received certificates"
                certificates={result.tls.receivedChain}
              />
              <CertificateList title="Verified chain" certificates={result.tls.verifiedChain} />
            </section>
          )}
          {result.statistics && (
            <section>
              <h3>Connection samples</h3>
              <dl className="pp-diag-facts">
                <dt>Connected / requested</dt>
                <dd>
                  {result.statistics.connected} / {result.statistics.requested}
                </dd>
                <dt>Refused / timeout</dt>
                <dd>
                  {result.statistics.refused} / {result.statistics.timeouts}
                </dd>
                <dt>Successful min / median / p95</dt>
                <dd>
                  {[result.statistics.minMs, result.statistics.medianMs, result.statistics.p95Ms]
                    .map((value) =>
                      value === undefined ? 'Unavailable' : `${value.toFixed(1)} ms`
                    )
                    .join(' / ')}
                </dd>
              </dl>
              <CheckTable checks={result.samples} />
            </section>
          )}
          {result.exchange && (
            <section>
              <h3>
                {result.exchange.protocol.toUpperCase()} reply · {result.exchange.outcome}
              </h3>
              <p>
                {result.exchange.sentBytes} bytes sent · {result.exchange.receivedBytes} bytes
                received{result.exchange.limited ? ' · reply truncated' : ''}
              </p>
              {result.exchange.detail && <p>{result.exchange.detail}</p>}
              <details open>
                <summary>Text (invalid UTF-8 replaced)</summary>
                <pre>{result.exchange.replyText || 'No reply bytes'}</pre>
              </details>
              <details>
                <summary>Hexadecimal bytes</summary>
                <pre>{result.exchange.replyHex || 'No reply bytes'}</pre>
              </details>
              <small>
                Raw replies stay on this screen and are excluded from exported evidence.
              </small>
            </section>
          )}
          {result.proxy && (
            <section>
              <h3>
                {result.proxy.protocol} · {result.proxy.outcome}
              </h3>
              <p>
                {result.proxy.address} → {result.proxy.destination}
              </p>
              {result.proxy.status > 0 && <p>Protocol status: {result.proxy.status}</p>}
              <p>{result.proxy.resolution}</p>
              <p>{result.proxy.detail}</p>
            </section>
          )}
          {result.http2 && (
            <section>
              <h3>{result.http2.protocol}</h3>
              <p>
                Matching PING acknowledgement: {result.http2.pingAck ? 'Received' : 'Not observed'}
              </p>
              <ul>
                {evidenceRows(result.http2.settings, (setting) => setting).map(
                  ({ key, value: setting }) => (
                    <li key={key}>
                      <code>{setting}</code>
                    </li>
                  )
                )}
              </ul>
              <p>{result.http2.detail}</p>
            </section>
          )}
          {result.http3 && (
            <section>
              <h3>HTTP/3 over QUIC</h3>
              <dl className="pp-diag-facts">
                <dt>Remote / socket bind</dt>
                <dd>
                  {result.http3.address} / {result.http3.local || 'Unavailable'}
                </dd>
                <dt>QUIC / TLS / ALPN</dt>
                <dd>
                  {result.http3.quicVersion || 'Not negotiated'} /{' '}
                  {result.http3.tlsVersion || 'Not negotiated'} / {result.http3.alpn || 'None'}
                </dd>
                <dt>Handshake</dt>
                <dd>{result.http3.handshakeMs.toFixed(1)} ms</dd>
                <dt>HTTP status</dt>
                <dd>{result.http3.status || 'No response'}</dd>
              </dl>
              <p>{result.http3.detail}</p>
              <small>
                The socket bind can be unspecified; it does not identify the route's source address.
              </small>
            </section>
          )}
          {result.subnet && (
            <section>
              <h3>{result.subnet.family} range</h3>
              <dl className="pp-diag-facts">
                <dt>Network</dt>
                <dd>{result.subnet.network}</dd>
                <dt>Address range</dt>
                <dd>
                  {result.subnet.first} – {result.subnet.last}
                </dd>
                <dt>Total addresses</dt>
                <dd>{result.subnet.totalAddresses}</dd>
                <dt>Usable host count</dt>
                <dd>{result.subnet.usableHosts}</dd>
                <dt>Usable range</dt>
                <dd>
                  {result.subnet.firstUsable} – {result.subnet.lastUsable}
                </dd>
              </dl>
              <p>{result.subnet.detail}</p>
              {result.subnet.discoveryEligible && (
                <Link to="/network/local" search={{ draftSubnet: result.subnet.prefix }}>
                  Prepare a nearby-device scan
                </Link>
              )}
            </section>
          )}
          {result.addresses.length > 0 && (
            <nav aria-label="Next steps">
              <Link to="/network/ports" search={{ host: result.addresses[0] }}>
                Inspect ports
              </Link>
              {shell && !['dns', 'dns-compare', 'udp-exchange'].includes(result.mode) && (
                <>
                  <button type="button" onClick={() => prepareRequest('http')}>
                    Prepare HTTP request
                  </button>
                  <button type="button" onClick={() => prepareRequest('grpc')}>
                    Prepare gRPC target
                  </button>
                  <small>
                    Protocol is your choice. Review the unsent target and transport before
                    connecting.
                  </small>
                </>
              )}
            </nav>
          )}
        </section>
      ) : (
        !busy &&
        !error && (
          <section className="pp-diag-empty">
            <h2>Start with the question you need to answer</h2>
            <p>
              Choose a diagnostic and enter a target. Results stay in memory until you export or
              leave this screen.
            </p>
            <p>
              Network operations stop after 15 seconds. Subnet planning makes no network requests.
            </p>
          </section>
        )
      )}
    </div>
  );
}

function CheckTable({ checks }: { checks: DiagnosticCheck[] }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll this bounded horizontal table (WCAG 2.1.1).
    <section className="pp-diag-table" tabIndex={0} aria-label="Connection evidence table">
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Remote address</th>
            <th>Outcome</th>
            <th>Time</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {evidenceRows(checks, (check) => JSON.stringify(check)).map(({ key, value: check }) => (
            <tr key={key}>
              <td>{check.stage}</td>
              <td>
                {check.address}
                {check.local && <small>From {check.local}</small>}
              </td>
              <td>{check.outcome}</td>
              <td>{check.durationMs.toFixed(1)} ms</td>
              <td>{check.detail || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
function CertificateList({
  title,
  certificates,
}: {
  title: string;
  certificates: DiagnosticCertificate[];
}) {
  return (
    <details>
      <summary>
        {title} ({certificates.length})
      </summary>
      {certificates.length === 0 && <p>No certificate chain available.</p>}
      {evidenceRows(certificates, (certificate) => certificate.sha256).map(
        ({ key, value: certificate }) => (
          <dl className="pp-diag-facts" key={key}>
            <dt>Subject</dt>
            <dd>{certificate.subject}</dd>
            <dt>Issuer</dt>
            <dd>{certificate.issuer}</dd>
            <dt>Names</dt>
            <dd>
              {[...(certificate.dnsNames ?? []), ...certificate.ipAddresses].join(', ') || 'None'}
            </dd>
            <dt>Validity</dt>
            <dd>
              {certificate.notBefore} – {certificate.notAfter}
            </dd>
            <dt>SHA-256</dt>
            <dd>
              <code>{certificate.sha256}</code>
            </dd>
            <dt>Serial</dt>
            <dd>{certificate.serial}</dd>
          </dl>
        )
      )}
    </details>
  );
}

// Identical observations still represent separate samples or chain positions.
function evidenceRows<T>(rows: T[], identity: (row: T) => string) {
  const occurrences = new Map<string, number>();
  return rows.map((value) => {
    const id = identity(value);
    const count = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, count);
    return { key: `${id}-${count}`, value };
  });
}

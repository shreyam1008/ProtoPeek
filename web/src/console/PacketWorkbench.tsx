import { Link } from '@tanstack/react-router';
import {
  type ColumnDef,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ProtocolInfo } from './ProtocolInfo';
import {
  type CaptureInterface,
  type PacketReport,
  type PacketRow,
  packetRequest,
  parsePacketReport,
} from './packet-api';
import './packets.css';

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columns: ColumnDef<typeof features, PacketRow>[] = [
  { accessorKey: 'number' },
  { accessorKey: 'protocol' },
];

export function PacketWorkbench() {
  const [mode, setMode] = useState('file');
  const [file, setFile] = useState<File | null>(null);
  const [interfaces, setInterfaces] = useState<CaptureInterface[]>([]);
  const [iface, setIface] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [seconds, setSeconds] = useState('5');
  const [consent, setConsent] = useState(false);
  const [capability, setCapability] = useState('Checking capture support…');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<PacketReport | null>(null);
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [selection, setSelection] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void packetRequest('capabilities', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setCapability(
            value.available === true
              ? 'Capture tool found. Refresh interfaces to check capture access.'
              : typeof value.reason === 'string'
                ? value.reason
                : 'Capture support unavailable.'
          );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCapability('Could not check capture support. Offline inspection is available.');
      });
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, []);
  const rows = useMemo(
    () =>
      (report?.packets ?? []).filter(
        (row) =>
          (protocol === 'all' || row.protocol === protocol) &&
          `${row.source} ${row.destination} ${row.sourcePort ?? ''} ${row.destinationPort ?? ''} ${row.info}`
            .toLowerCase()
            .includes(query.toLowerCase())
      ),
    [report, protocol, query]
  );
  const table = useTable({
    features,
    columns,
    data: rows,
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
    getRowId: (row) => String(row.number),
  });
  const selected = report?.packets.find((row) => row.number === selection);
  function cancel() {
    active.current?.abort();
    active.current = null;
    setBusy('');
    setNotice('Cancelled. This run was discarded; earlier results remain.');
  }
  async function run(operation: 'interfaces' | 'analyze' | 'capture') {
    if (active.current) return;
    setError('');
    setNotice('');
    if (operation === 'analyze' && (!file || file.size > 16 * 1024 * 1024)) {
      setError('Choose a capture file up to 16 MiB.');
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(
      operation === 'capture'
        ? `Capturing for up to ${seconds} seconds`
        : operation === 'interfaces'
          ? 'Finding interfaces'
          : 'Reading capture'
    );
    try {
      const input =
        operation === 'analyze'
          ? file
          : operation === 'interfaces'
            ? {}
            : {
                interface: iface,
                host: host.trim(),
                port: Number(port),
                seconds: Number(seconds),
                packets: 2000,
                consent,
              };
      const result = await packetRequest(operation, input, controller.signal);
      if (active.current !== controller) return;
      if (operation === 'interfaces') {
        if (
          !Array.isArray(result) ||
          result.length > 64 ||
          result.some(
            (item) =>
              !item ||
              typeof item.name !== 'string' ||
              item.name.length > 320 ||
              typeof item.label !== 'string' ||
              item.label.length > 512
          )
        )
          throw new Error('Invalid interface listing.');
        setInterfaces(result);
        setIface((old) => (result.some((item) => item.name === old) ? old : ''));
        setNotice(
          result.length
            ? 'Choose the interface you want to capture.'
            : 'No capture interfaces are available. Check OS capture permissions.'
        );
      } else {
        setReport(parsePacketReport(result));
        setSource(
          operation === 'analyze'
            ? (file?.name ?? 'Capture file')
            : `Interface ${iface} · ${host || 'any host'} · port ${port || 'any'}`
        );
        setSelection(0);
        setQuery('');
        setProtocol('all');
        table.setPageIndex(0);
        setNotice(
          'Inspection completed. Results stay in memory until cleared or this page closes.'
        );
      }
    } catch (cause) {
      if (active.current === controller)
        setError(cause instanceof Error ? cause.message : 'Packet inspection failed.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy('');
      }
    }
  }
  function save() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ source, ...report }, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'protopeek-packet-metadata.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return (
    <div className="pp-packets">
      <header>
        <h1>Packet inspection</h1>
        <ProtocolInfo protocol="packets" />
        <Link to="/network/local">Network tools</Link>
      </header>
      <aside className="pp-packet-controls" aria-label="Packet inspection controls">
        <nav aria-label="Packet sources">
          <button
            type="button"
            aria-pressed={mode === 'file'}
            disabled={Boolean(busy)}
            onClick={() => setMode('file')}
          >
            Open capture file
          </button>
          <button
            type="button"
            aria-pressed={mode === 'live'}
            disabled={Boolean(busy)}
            onClick={() => setMode('live')}
          >
            Capture this host
          </button>
        </nav>
        {mode === 'file' ? (
          <>
            <label>
              PCAP / PCAPNG file
              <input
                type="file"
                aria-label="Packet capture file"
                accept=".pcap,.pcapng,.cap"
                disabled={Boolean(busy)}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              disabled={!file || Boolean(busy)}
              onClick={() => void run('analyze')}
            >
              Inspect file
            </button>
            <small>
              Up to 16 MiB. File bytes go to this ProtoPeek server for analysis. No packets are sent
              to captured endpoints.
            </small>
          </>
        ) : (
          <>
            <details>
              <summary>Capture tool setup</summary>
              <p>{capability}</p>
            </details>
            <button type="button" disabled={Boolean(busy)} onClick={() => void run('interfaces')}>
              Refresh interfaces
            </button>
            <label>
              Interface
              <select
                value={iface}
                disabled={Boolean(busy)}
                onChange={(event) => {
                  setIface(event.target.value);
                  setConsent(false);
                }}
              >
                <option value="">Choose an interface</option>
                {interfaces.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              IP filter
              <input
                value={host}
                placeholder="127.0.0.1 or another IP"
                maxLength={64}
                disabled={Boolean(busy)}
                onChange={(event) => setHost(event.target.value)}
              />
            </label>
            <div className="pp-packet-options">
              <label>
                Port filter
                <input
                  type="number"
                  value={port}
                  min={1}
                  max={65535}
                  disabled={Boolean(busy)}
                  onChange={(event) => setPort(event.target.value)}
                />
              </label>
              <label>
                Duration (seconds)
                <input
                  type="number"
                  value={seconds}
                  min={1}
                  max={30}
                  disabled={Boolean(busy)}
                  onChange={(event) => setSeconds(event.target.value)}
                />
              </label>
            </div>
            <details>
              <summary>Capture limits and filter rules</summary>
              <p>
                IP and port filters combine with AND. Up to 2,000 packets, 512 bytes each. Capture
                does not request promiscuous mode. Results appear when the run ends.
              </p>
            </details>
            <label className="pp-packet-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={Boolean(busy)}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I have permission to capture this traffic.
            </label>
            <button
              type="button"
              disabled={!iface || !consent || (!host.trim() && !port) || Boolean(busy)}
              onClick={() => void run('capture')}
            >
              Start capture
            </button>
            <a
              href="https://www.wireshark.org/docs/wsug_html_chunked/ChapterCapture.html"
              target="_blank"
              rel="noreferrer"
            >
              Capture setup and permissions
            </a>
          </>
        )}
        {busy ? (
          <button type="button" onClick={cancel}>
            Cancel inspection
          </button>
        ) : null}
        <details>
          <summary>What this reader shows</summary>
          <p>
            Endpoints, packet sizes, TCP flags, DNS questions, HTTP method/status and TLS record
            signatures. Port numbers alone do not identify an application.
          </p>
          <p>
            No TCP reassembly, decryption, process attribution or payload retention. Use Wireshark
            for deeper inspection of your original capture.
          </p>
        </details>
      </aside>
      <section className="pp-packet-results" aria-label="Packet results">
        {error ? <p role="alert">{error}</p> : null}
        {busy || notice ? <p role="status">{busy || notice}</p> : null}
        {report ? (
          <>
            <div className="pp-packet-summary">
              <strong>{source}</strong>
              <span>
                {report.packetCount.toLocaleString()} packets · {report.wireBytes.toLocaleString()}{' '}
                wire bytes · {report.format}
              </span>
              <button type="button" onClick={save}>
                Save metadata
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setReport(null);
                  setSelection(0);
                  setSource('');
                  setNotice('Results cleared. The original capture file is unchanged.');
                }}
              >
                Clear results
              </button>
            </div>
            {report.warnings.map((warning) => (
              <small key={warning}>{warning}</small>
            ))}
            {report.packetCount > report.packets.length ? (
              <small>
                The table retains the first {report.packets.length.toLocaleString()} packets. Totals
                include {report.packetCount.toLocaleString()} parsed records.
              </small>
            ) : null}
            <div className="pp-packet-filters">
              <label>
                Filter packets
                <input
                  type="search"
                  value={query}
                  maxLength={128}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    table.setPageIndex(0);
                  }}
                />
              </label>
              <label>
                Protocol
                <select
                  value={protocol}
                  onChange={(event) => {
                    setProtocol(event.target.value);
                    table.setPageIndex(0);
                  }}
                >
                  <option value="all">All protocols</option>
                  {Object.keys(report.protocols)
                    .sort()
                    .map((name) => (
                      <option key={name} value={name}>
                        {name} ({report.protocols[name]})
                      </option>
                    ))}
                </select>
              </label>
              <span>{rows.length} matching rows</span>
            </div>
            <div className={`pp-packet-body${selected ? ' has-selection' : ''}`}>
              <div className="pp-packet-table">
                <table>
                  <thead>
                    <tr>
                      <th>Packet</th>
                      <th>Source</th>
                      <th>Destination</th>
                      <th>Protocol</th>
                      <th>Bytes</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.getRowModel().rows.map(({ original: row }) => (
                      <tr key={row.number} aria-selected={selection === row.number}>
                        <td>
                          <button
                            type="button"
                            aria-label={`Inspect packet ${row.number}`}
                            onClick={() => setSelection(row.number)}
                          >
                            {row.number}
                          </button>
                        </td>
                        <td>
                          {row.source || '—'}
                          {row.sourcePort ? ` : ${row.sourcePort}` : ''}
                        </td>
                        <td>
                          {row.destination || '—'}
                          {row.destinationPort ? ` : ${row.destinationPort}` : ''}
                        </td>
                        <td>{row.protocol}</td>
                        <td>{row.length}</td>
                        <td>{row.info}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length ? <p>No packets match these filters.</p> : null}
              </div>
              {selected ? (
                <aside aria-label={`Packet ${selected.number} details`}>
                  <header>
                    <strong>Packet {selected.number}</strong>
                    <button type="button" onClick={() => setSelection(0)}>
                      Close details
                    </button>
                  </header>
                  <dl>
                    <dt>Time (UTC)</dt>
                    <dd>{selected.timestamp || 'Not recorded'}</dd>
                    <dt>Source</dt>
                    <dd>
                      {selected.source || 'Unknown'}
                      {selected.sourcePort ? ` : ${selected.sourcePort}` : ''}
                    </dd>
                    <dt>Destination</dt>
                    <dd>
                      {selected.destination || 'Unknown'}
                      {selected.destinationPort ? ` : ${selected.destinationPort}` : ''}
                    </dd>
                    <dt>Protocol</dt>
                    <dd>{selected.protocol}</dd>
                    <dt>Decoded information</dt>
                    <dd>{selected.info}</dd>
                    <dt>Captured / wire size</dt>
                    <dd>
                      {selected.captured} / {selected.length} bytes
                    </dd>
                    <dt>Header completeness</dt>
                    <dd>
                      {selected.truncated
                        ? 'Truncated or malformed; decoding may be incomplete'
                        : 'No truncation detected'}
                    </dd>
                    <dt>Interface index</dt>
                    <dd>{selected.interface}</dd>
                  </dl>
                </aside>
              ) : null}
            </div>
            <footer>
              <button
                type="button"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                Previous packets
              </button>
              <span>
                Page {table.state.pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
              </span>
              <button
                type="button"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                Next packets
              </button>
            </footer>
          </>
        ) : (
          <div className="pp-packet-empty">
            <h2>See what crossed a network interface</h2>
            <p>
              Open an existing capture, or explicitly capture one IP or port on this host. Choose a
              packet to inspect its decoded details.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

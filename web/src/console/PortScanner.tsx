import { Link } from '@tanstack/react-router';
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
import { ProtocolInfo } from './ProtocolInfo';
import { useProtocolShell } from './ProtocolShellContext';
import {
  type PortResult,
  type PortScanResponse,
  portPresets,
  previewPorts,
  serviceHint,
} from './port-scan';
import { scanHostPorts } from './port-scan-api';
import { readPortScannerDraft, writePortScannerDraft } from './port-scan-store';
import './port-scan.css';

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columns: ColumnDef<typeof features, PortResult>[] = [
  { accessorKey: 'port' },
  { accessorKey: 'state' },
  { accessorKey: 'durationMs' },
];
const emptyResults: PortResult[] = [];

export function PortScanner() {
  const { openScan } = useProtocolShell();
  const [initial] = useState(readPortScannerDraft);
  const [host, setHost] = useState(initial.host);
  const [ports, setPorts] = useState(initial.ports);
  const [family, setFamily] = useState(initial.family);
  const [timeout, setTimeoutValue] = useState(initial.timeout);
  const [result, setResult] = useState<PortScanResponse | null>(initial.result);
  const [observedAt, setObservedAt] = useState(initial.observedAt);
  const [storageNotice, setStorageNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(
    initial.result ? 'Restored last scan. Scan again to refresh.' : ''
  );
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('open');
  const [query, setQuery] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const save = () =>
      setStorageNotice(writePortScannerDraft({ host, ports, family, timeout, result, observedAt }));
    const timer = window.setTimeout(save, 250);
    const flush = () => {
      writePortScannerDraft({ host, ports, family, timeout, result, observedAt });
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [host, ports, family, timeout, result, observedAt]);
  const preview = useMemo(() => {
    try {
      return { ports: previewPorts(ports), error: '' };
    } catch (cause) {
      return { ports: [], error: cause instanceof Error ? cause.message : 'Invalid ports' };
    }
  }, [ports]);
  const data = useMemo(
    () =>
      (result?.results ?? emptyResults).filter(
        (row) =>
          (filter === 'all' || row.state === filter) &&
          `${row.port} ${serviceHint(row.port)}`.toLowerCase().includes(query.toLowerCase())
      ),
    [result, filter, query]
  );
  const table = useTable({
    features,
    columns,
    data,
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
    getRowId: (row) => String(row.port),
  });
  async function scan() {
    if (controller.current) return;
    if (preview.error) {
      setError(preview.error);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setNotice('Scanning the selected host…');
    setResult(null);
    try {
      const response = await scanHostPorts(
        { host: host.trim(), ports, family, timeoutMs: Number(timeout) },
        abort.signal
      );
      if (!abort.signal.aborted) {
        setResult(response);
        setObservedAt(new Date().toISOString());
        setNotice(
          response.complete
            ? 'Scan complete'
            : '30-second limit reached. Some ports were not scanned.'
        );
        table.setPageIndex(0);
      }
    } catch (cause) {
      if (!abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Scan failed');
        setNotice('Scan failed');
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    setNotice('Scan cancelled');
  }
  const openCount = result?.results.filter((row) => row.state === 'open').length ?? 0;
  return (
    <section className="pp-ports" aria-label="Port scanner">
      <PageHeader>
        <h1>Port scanner</h1>
        <ProtocolInfo protocol="tcp" />
      </PageHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void scan();
        }}
      >
        <label>
          Host or IP
          <input
            value={host}
            onChange={(event) => setHost(event.target.value)}
            maxLength={253}
            disabled={busy}
            required
            spellCheck={false}
          />
        </label>
        <label>
          IP family
          <select
            value={family}
            onChange={(event) => setFamily(event.target.value)}
            disabled={busy}
          >
            <option value="auto">Auto (prefer IPv4)</option>
            <option value="ipv4">IPv4</option>
            <option value="ipv6">IPv6</option>
          </select>
        </label>
        <label>
          Timeout per port
          <select
            value={timeout}
            onChange={(event) => setTimeoutValue(event.target.value)}
            disabled={busy}
          >
            <option value="100">100 ms</option>
            <option value="500">500 ms</option>
            <option value="1000">1 second</option>
            <option value="2000">2 seconds</option>
          </select>
        </label>
        <label className="pp-ports-range">
          Ports
          <input
            value={ports}
            onChange={(event) => setPorts(event.target.value)}
            maxLength={8192}
            disabled={busy}
            required
            spellCheck={false}
          />
        </label>
        <div className="pp-ports-presets">
          <button type="button" disabled={busy} onClick={() => setPorts(portPresets.common)}>
            Common services
          </button>
          <button type="button" disabled={busy} onClick={() => setPorts(portPresets.development)}>
            Development
          </button>
          <button type="button" disabled={busy} onClick={() => setPorts('1-1024')}>
            Ports 1–1024
          </button>
        </div>
        <p>
          {preview.error ||
            `${preview.ports.length} TCP ports · one resolved IP · at most 30 seconds. Use a host you own or are authorized to inspect.`}
        </p>
        {busy ? (
          <button
            key="cancel"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              cancel();
            }}
          >
            Cancel scan
          </button>
        ) : (
          <button key="scan" type="submit" disabled={!!preview.error}>
            Scan ports
          </button>
        )}
      </form>
      <div className="pp-ports-status">
        <span role="status">{notice || 'Ready. No scan has run.'}</span>
        {result && (
          <span>
            {result.address} · {openCount} open · {(result.durationMs / 1000).toFixed(2)}s
          </span>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {storageNotice && <p role="status">{storageNotice}</p>}
      {!result && (
        <EmptyState
          title={busy ? 'Checking the selected ports' : 'Find an open service'}
          busy={busy}
        >
          Choose a host and a port preset, then scan. Results will show open ports, connection times
          and service inspection actions.
        </EmptyState>
      )}
      {result && observedAt && <small>Observed {new Date(observedAt).toLocaleString()}</small>}
      {result && (
        <>
          <div className="pp-ports-filters">
            <label>
              Show
              <select
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  table.setPageIndex(0);
                }}
              >
                <option value="open">Open ports</option>
                <option value="all">All results</option>
                <option value="closed">Closed</option>
                <option value="no-response">No response</option>
                <option value="unreachable">Unreachable</option>
                <option value="not-scanned">Not scanned</option>
              </select>
            </label>
            <label>
              Find port or service
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  table.setPageIndex(0);
                }}
                maxLength={128}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setNotice('Results cleared');
              }}
            >
              Clear results
            </button>
          </div>
          <div className="pp-ports-table">
            <table>
              <thead>
                <tr>
                  <th>Port</th>
                  <th>Result</th>
                  <th>Likely service</th>
                  <th>Connect time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {table.getRowModel().rows.map(({ original: row }) => (
                  <tr key={row.port}>
                    <td>{row.port}/tcp</td>
                    <td>{row.state.replaceAll('-', ' ')}</td>
                    <td>
                      {serviceHint(row.port)}
                      {serviceHint(row.port) !== 'Unknown' ? ' (port hint)' : ''}
                    </td>
                    <td>{row.state === 'not-scanned' ? '—' : `${row.durationMs} ms`}</td>
                    <td>
                      {row.state === 'open' && (
                        <button
                          type="button"
                          onClick={() =>
                            openScan({
                              initialTarget: `${result.address.includes(':') ? `[${result.address}]` : result.address}:${row.port}`,
                            })
                          }
                        >
                          Inspect service
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.length && (
              <p>
                {filter === 'open'
                  ? 'No open ports in these results. Check All results for refusals and timeouts.'
                  : 'No matching results.'}
              </p>
            )}
          </div>
          <nav aria-label="Port result pages">
            <button
              type="button"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Previous page
            </button>
            <span>
              Page {table.state.pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())} ·{' '}
              {data.length} results
            </span>
            <button
              type="button"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next page
            </button>
          </nav>
        </>
      )}
      <footer>
        TCP connect checks send no application payload. Port names are hints; Inspect service can
        verify HTTP/gRPC. A timeout does not prove a port is closed.{' '}
        <Link to="/network/local">Discover local devices</Link> ·{' '}
        <Link to="/this-pc">See this device’s processes</Link>
      </footer>
    </section>
  );
}

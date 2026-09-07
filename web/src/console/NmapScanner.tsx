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
import { fetchJSON, type NmapImportResponse } from './api';
import { previewNmapPlan } from './nmap-plan';
import { ProtocolInfo } from './ProtocolInfo';
import { useProtocolShell } from './ProtocolShellContext';
import './port-scan.css';

type Capability = { available: boolean; message: string; path: string };
type Scan = {
  plan: {
    target: string;
    ports: number[];
    hosts: number;
    detectServices: boolean;
    arguments: string[];
  };
  observedAt: string;
  inventory: NmapImportResponse;
  warning?: string;
};
type Row = {
  address: string;
  port: number;
  state: string;
  name: string;
  detail: string;
  method: string;
};
const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columns: ColumnDef<typeof features, Row>[] = [
  { accessorKey: 'address' },
  { accessorKey: 'port' },
  { accessorKey: 'state' },
];
const draftKey = 'protopeek.nmap.draft.v1';
function readDraft() {
  try {
    const text = localStorage.getItem(draftKey);
    const value = text && text.length < 10_000 ? JSON.parse(text) : null;
    return {
      target: typeof value?.target === 'string' ? value.target.slice(0, 128) : '127.0.0.1',
      ports: typeof value?.ports === 'string' ? value.ports.slice(0, 8192) : '22,80,443,8080,50051',
    };
  } catch {
    return { target: '127.0.0.1', ports: '22,80,443,8080,50051' };
  }
}

export function NmapScanner() {
  const { openScan } = useProtocolShell();
  const [initial] = useState(readDraft);
  const [target, setTarget] = useState(initial.target);
  const [ports, setPorts] = useState(initial.ports);
  const [detectServices, setDetectServices] = useState(false);
  const [consent, setConsent] = useState(false);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const [query, setQuery] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const capabilityRequest = useRef<AbortController | null>(null);
  async function check() {
    capabilityRequest.current?.abort();
    const request = new AbortController();
    capabilityRequest.current = request;
    setChecking(true);
    setError('');
    try {
      const next = await fetchJSON<Capability>('api/nmap/capabilities', { signal: request.signal });
      if (!request.signal.aborted) setCapability(next);
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Cannot inspect Nmap availability.');
    } finally {
      if (!request.signal.aborted) setChecking(false);
    }
  }
  // Capability lookup reads executable locations; it never starts Nmap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial capability lookup only.
  useEffect(() => {
    void check();
    return () => {
      controller.current?.abort();
      capabilityRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ target, ports }));
      setStorageWarning('');
    } catch {
      setStorageWarning('Scan preferences could not be saved in this browser.');
    }
    setConsent(false);
  }, [target, ports]);
  const preview = useMemo(() => {
    try {
      return { ...previewNmapPlan(target, ports), error: '' };
    } catch (cause) {
      return {
        target: '',
        hosts: 0,
        ports: [],
        pairs: 0,
        error: cause instanceof Error ? cause.message : 'Invalid scan plan',
      };
    }
  }, [target, ports]);
  const data = useMemo(() => {
    const rows: Row[] = [];
    for (const host of result?.inventory.hosts ?? []) {
      const address = host.addresses.find(
        (item) => item.type === 'ipv4' || item.type === 'ipv6'
      )?.address;
      if (!address) continue;
      for (const port of host.ports) {
        if (port.protocol !== 'tcp' || (onlyOpen && port.state !== 'open')) continue;
        const row = {
          address,
          port: port.port,
          state: port.state,
          name: port.service.name || 'Unknown',
          detail: [port.service.product, port.service.version, port.service.extrainfo]
            .filter(Boolean)
            .join(' '),
          method: port.service.method,
        };
        if (
          `${row.address} ${row.port} ${row.state} ${row.name} ${row.detail}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
          rows.push(row);
      }
    }
    return rows;
  }, [result, query, onlyOpen]);
  const table = useTable({
    features,
    columns,
    data,
    initialState: { pagination: { pageSize: 50, pageIndex: 0 } },
  });
  async function scan() {
    if (controller.current || !consent || preview.error || !capability?.available) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    setMessage('Nmap is checking the selected plan…');
    try {
      const next = await fetchJSON<Scan>('api/nmap/scan', {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: preview.target, ports, detectServices, consent }),
      });
      if (!request.signal.aborted) {
        setResult(next);
        table.setPageIndex(0);
        setMessage(
          next.inventory.complete ? 'Nmap scan complete.' : 'Nmap returned partial evidence.'
        );
      }
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Nmap failed.');
        setMessage('Scan failed. Previous results are retained.');
      }
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setMessage('Scan cancelled. Previous results are retained.');
  }
  function exportResult() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'protopeek-nmap.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="pp-ports" aria-label="Nmap scanner">
      <PageHeader>
        <h1>Nmap</h1>
        <ProtocolInfo protocol="nmap" />
      </PageHeader>
      <div className="pp-ports-status">
        <span>{checking ? 'Checking installation…' : capability?.message}</span>
        <button type="button" disabled={checking || busy} onClick={() => void check()}>
          Refresh Nmap
        </button>
      </div>
      {capability && !capability.available ? (
        <p>
          <a href="https://nmap.org/download.html" target="_blank" rel="noreferrer">
            Nmap downloads
          </a>{' '}
          · <Link to="/network/ports">Use built-in port scanner</Link>
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void scan();
        }}
      >
        <label>
          IP or private subnet
          <input
            value={target}
            maxLength={128}
            disabled={busy}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="192.168.1.0/28"
          />
        </label>
        <label>
          TCP ports
          <input
            value={ports}
            maxLength={8192}
            disabled={busy}
            onChange={(event) => setPorts(event.target.value)}
          />
        </label>
        <label>
          Inspection
          <select
            value={detectServices ? 'services' : 'connect'}
            disabled={busy}
            onChange={(event) => {
              setDetectServices(event.target.value === 'services');
              setConsent(false);
            }}
          >
            <option value="connect">TCP connect</option>
            <option value="services">Light service detection</option>
          </select>
        </label>
        {busy ? (
          <button key="cancel" type="button" onClick={cancel}>
            Cancel Nmap scan
          </button>
        ) : (
          <button
            key="scan"
            type="submit"
            disabled={!consent || !!preview.error || !capability?.available}
          >
            Run Nmap
          </button>
        )}
        <p>
          {preview.error ||
            `${preview.target} · ${preview.hosts} addresses × ${preview.ports.length} TCP ports = ${preview.pairs.toLocaleString()} checks · 30 s limit`}
        </p>
      </form>
      <label>
        <span>
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(event) => setConsent(event.target.checked)}
          />{' '}
          I authorize this target and these{' '}
          {detectServices ? 'TCP connections and light application probes' : 'TCP connections'}.
        </span>
      </label>
      <span role="status">{message || 'Ready. No scan has run.'}</span>
      {error ? <p role="alert">{error}</p> : null}
      {storageWarning ? <p role="status">{storageWarning}</p> : null}
      {!result && (
        <EmptyState
          title={busy ? 'Scanning the selected network' : 'Discover hosts and services'}
          busy={busy}
        >
          Choose a target and ports, review the check count, and authorize the scan. Observations
          and service evidence will appear here.
        </EmptyState>
      )}
      {result ? (
        <>
          <div className="pp-ports-status">
            <span>
              Observed {new Date(result.observedAt).toLocaleString()} · {result.plan.target}
            </span>
            <button type="button" onClick={exportResult}>
              Export result
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setResult(null);
                setMessage('Results cleared.');
              }}
            >
              Clear results
            </button>
          </div>
          {result.warning ? <p role="status">{result.warning}</p> : null}
          <div className="pp-ports-filters">
            <label>
              Find host or service
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  table.setPageIndex(0);
                }}
              />
            </label>
            <label>
              <span>
                <input
                  type="checkbox"
                  checked={onlyOpen}
                  onChange={(event) => {
                    setOnlyOpen(event.target.checked);
                    table.setPageIndex(0);
                  }}
                />{' '}
                Open ports only
              </span>
            </label>
          </div>
          <div className="pp-ports-table">
            <table>
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Port</th>
                  <th>State</th>
                  <th>Service evidence</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {table.getRowModel().rows.map(({ id, original: row }) => (
                  <tr key={id}>
                    <td>{row.address}</td>
                    <td>{row.port}/tcp</td>
                    <td>{row.state}</td>
                    <td>
                      {row.name} · {row.method === 'probed' ? 'Nmap probe' : 'port hint'}
                      <br />
                      {row.detail}
                    </td>
                    <td>
                      {row.state === 'open' ? (
                        <button
                          type="button"
                          onClick={() =>
                            openScan({
                              initialTarget: `${row.address.includes(':') ? `[${row.address}]` : row.address}:${row.port}`,
                            })
                          }
                        >
                          Inspect service
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.length ? (
              <p>No matching port evidence. An absent host is not proof it is offline.</p>
            ) : null}
          </div>
          <nav aria-label="Nmap result pages">
            <button
              type="button"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Previous
            </button>
            <span>
              {data.length} results · Page {table.state.pagination.pageIndex + 1} of{' '}
              {Math.max(1, table.getPageCount())}
            </span>
            <button
              type="button"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next
            </button>
          </nav>
          <details>
            <summary>Executed plan</summary>
            <code>{result.plan.arguments.join(' ')}</code>
          </details>
        </>
      ) : null}
      <footer>
        Nmap supplies observations and service guesses. Inspect verifies the selected endpoint.{' '}
        <Link to="/network/local">Local discovery</Link>
      </footer>
    </section>
  );
}

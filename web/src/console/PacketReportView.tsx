import { lazy, Suspense, useMemo, useState } from 'react';
import { usePagination } from '@/shared/use-pagination';
import { packetConversationKey, packetRelativeTime } from './packet-analysis';
import type { PacketReport } from './packet-api';

const PayloadEvidence = lazy(() =>
  import('./PacketReconstruction').then((module) => ({ default: module.PayloadEvidence }))
);
const ConversationControl = lazy(() =>
  import('./PacketConversations').then((module) => ({ default: module.ConversationControl }))
);

export default function PacketReportView({
  report,
  source,
  busy,
  onClear,
  onForgetPayload,
}: {
  report: PacketReport;
  source: string;
  busy: boolean;
  onClear: () => void;
  onForgetPayload: () => void;
}) {
  const [query, setQuery] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [selection, setSelection] = useState(0);
  const [conversation, setConversation] = useState('');
  const origin = report.packets.find((row) => row.timestamp)?.timestamp;
  const rows = useMemo(
    () =>
      report.packets.filter(
        (row) =>
          (protocol === 'all' || row.protocol === protocol) &&
          (!conversation || packetConversationKey(row) === conversation) &&
          `${row.source} ${row.destination} ${row.sourcePort ?? ''} ${row.destinationPort ?? ''} ${row.info}`
            .toLowerCase()
            .includes(query.toLowerCase())
      ),
    [report, protocol, query, conversation]
  );
  const table = usePagination(rows);
  const selected = report.packets.find((row) => row.number === selection);
  function save() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ source, ...report, reconstruction: undefined }, null, 2)], {
        type: 'application/json',
      })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'protopeek-packet-metadata.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return (
    <>
      <div className="pp-packet-summary">
        <strong>{source}</strong>
        <span>
          {report.packetCount.toLocaleString()} packets · {report.wireBytes.toLocaleString()} wire
          bytes · {report.format}
        </span>
        <button type="button" onClick={save}>
          Save metadata
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={onClear}>
          Clear results
        </button>
      </div>
      {report.warnings.map((warning) => (
        <small key={warning}>{warning}</small>
      ))}
      {report.reconstruction !== undefined ? (
        <Suspense fallback={<p>Preparing bounded TCP evidence…</p>}>
          <PayloadEvidence value={report.reconstruction} onForget={onForgetPayload} />
        </Suspense>
      ) : null}
      {report.packetCount > report.packets.length ? (
        <small>
          The table retains the first {report.packets.length.toLocaleString()} packets. Totals
          include {report.packetCount.toLocaleString()} parsed records.
        </small>
      ) : null}
      <Suspense fallback={null}>
        <ConversationControl
          packets={report.packets}
          selected={conversation}
          onSelect={(key) => {
            setConversation((current) => (current === key ? '' : key));
            setSelection(0);
            table.setPageIndex(0);
          }}
        />
      </Suspense>
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
        {conversation || query || protocol !== 'all' ? (
          <button
            type="button"
            onClick={() => {
              setConversation('');
              setQuery('');
              setProtocol('all');
              setSelection(0);
              table.setPageIndex(0);
            }}
          >
            Reset filters
          </button>
        ) : null}
      </div>
      <div className={`pp-packet-body${selected ? ' has-selection' : ''}`}>
        <div className="pp-packet-table">
          <table>
            <thead>
              <tr>
                <th>Packet</th>
                <th>Time from start</th>
                <th>Source</th>
                <th>Destination</th>
                <th>Protocol</th>
                <th>Bytes</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {table.pageItems.map((row) => (
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
                  <td title={row.timestamp}>{packetRelativeTime(row, origin)}</td>
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
          {!rows.length ? (
            <p>
              {report.packetCount === 0
                ? 'No packets were observed. Use the service during capture, then check the interface and IP/port filter.'
                : 'No packets match these filters.'}
            </p>
          ) : null}
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
              <dt>Capture section</dt>
              <dd>{selected.section ?? 0}</dd>
              <dt>Underlying transport</dt>
              <dd>{selected.transport || 'Not recorded'}</dd>
            </dl>
          </aside>
        ) : null}
      </div>
      <footer>
        <button
          type="button"
          disabled={!table.canPreviousPage}
          onClick={() => table.previousPage()}
        >
          Previous packets
        </button>
        <span>
          Page {table.pageIndex + 1} of {Math.max(1, table.pageCount)}
        </span>
        <button type="button" disabled={!table.canNextPage} onClick={() => table.nextPage()}>
          Next packets
        </button>
      </footer>
    </>
  );
}

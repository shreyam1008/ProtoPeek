import {
  type ColumnDef,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import {
  packetConversationKey,
  packetRelativeTime,
  summarizeConversations,
} from './packet-analysis';
import type { PacketReport, PacketRow } from './packet-api';

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columns: ColumnDef<typeof features, PacketRow>[] = [
  { accessorKey: 'number' },
  { accessorKey: 'protocol' },
];

export default function PacketReportView({
  report,
  source,
  busy,
  onClear,
}: {
  report: PacketReport;
  source: string;
  busy: boolean;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [selection, setSelection] = useState(0);
  const [conversation, setConversation] = useState('');
  const conversations = useMemo(() => summarizeConversations(report.packets), [report]);
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
  const table = useTable({
    features,
    columns,
    data: rows,
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
    getRowId: (row) => String(row.number),
  });
  const selected = report.packets.find((row) => row.number === selection);
  function save() {
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
      {report.packetCount > report.packets.length ? (
        <small>
          The table retains the first {report.packets.length.toLocaleString()} packets. Totals
          include {report.packetCount.toLocaleString()} parsed records.
        </small>
      ) : null}
      {conversations.length ? (
        <details className="pp-packet-conversations" open={Boolean(conversation) || undefined}>
          <summary>
            {conversations.length} endpoint pairs · explore traffic in both directions
          </summary>
          <p>Grouped by addresses, ports and capture interface across the retained packets.</p>
          <div>
            {conversations.slice(0, 12).map((pair) => (
              <button
                type="button"
                key={pair.key}
                aria-pressed={conversation === pair.key}
                onClick={() => {
                  setConversation((current) => (current === pair.key ? '' : pair.key));
                  setSelection(0);
                  table.setPageIndex(0);
                }}
              >
                <strong>
                  {pair.first} ↔ {pair.second}
                </strong>
                <span>
                  {pair.forward} → · {pair.reverse} ← · {pair.bytes.toLocaleString()} bytes ·{' '}
                  {pair.protocols.join(', ')}
                </span>
              </button>
            ))}
          </div>
          {conversations.length > 12 ? (
            <small>
              Showing the 12 largest pairs by wire bytes. All retained packets are searchable below.
            </small>
          ) : null}
        </details>
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
        <button type="button" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
          Next packets
        </button>
      </footer>
    </>
  );
}

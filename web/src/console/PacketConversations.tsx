import { useMemo, useState } from 'react';
import { usePagination } from '@/shared/use-pagination';
import { packetConversationKey } from './packet-analysis';
import type { PacketRow } from './packet-api';
import { summarizeConversations } from './packet-conversations';

type ConversationProps = {
  packets: PacketRow[];
  selected: string;
  onSelect: (key: string) => void;
};

export function ConversationControl(props: ConversationProps) {
  const [open, setOpen] = useState(false);
  const count = useMemo(
    () => new Set(props.packets.map(packetConversationKey)).size,
    [props.packets]
  );
  return count ? (
    <details
      className="pp-packet-conversations"
      open={Boolean(props.selected) || undefined}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{count} endpoint pairs · explore traffic in both directions</summary>
      {open ? <PacketConversations {...props} /> : null}
    </details>
  ) : null;
}

export default function PacketConversations({ packets, selected, onSelect }: ConversationProps) {
  const conversations = useMemo(() => summarizeConversations(packets), [packets]);
  const page = usePagination(conversations, { pageSize: 12 });
  return (
    <>
      <p>
        Grouped by addresses, ports, underlying transport, capture section and interface across
        retained packets.
      </p>
      <div>
        {page.pageItems.map((pair) => (
          <button
            type="button"
            key={pair.key}
            aria-pressed={selected === pair.key}
            onClick={() => onSelect(pair.key)}
          >
            <strong>
              {pair.first} ↔ {pair.second}
            </strong>
            <span>
              {pair.forward} → · {pair.reverse} ← · {pair.bytes.toLocaleString()} bytes ·{' '}
              {pair.protocols.join(', ')} · {pair.transport} · section {pair.section}, interface{' '}
              {pair.interface}
              {pair.firstTime && pair.lastTime
                ? ` · ${((Date.parse(pair.lastTime) - Date.parse(pair.firstTime)) / 1000).toFixed(3)} s observed span`
                : ' · time not recorded'}
            </span>
          </button>
        ))}
      </div>
      {page.pageCount > 1 ? (
        <nav aria-label="Endpoint pair pages">
          <button type="button" disabled={!page.canPreviousPage} onClick={page.previousPage}>
            Previous pairs
          </button>
          <span>
            {page.pageIndex + 1} / {page.pageCount}
          </span>
          <button type="button" disabled={!page.canNextPage} onClick={page.nextPage}>
            Next pairs
          </button>
        </nav>
      ) : null}
    </>
  );
}

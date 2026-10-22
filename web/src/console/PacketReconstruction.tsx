import { useMemo, useState } from 'react';
import {
  parseTCPReconstruction,
  reconstructDirection,
  type TCPDirection,
} from './packet-reconstruction';
import './packet-reconstruction.css';

export function PayloadNotice() {
  return (
    <small>
      May expose credentials and private content. Retains up to 32 flows, 512 segments, 64 KiB per
      flow and 256 KiB total in memory. Encrypted bytes stay encrypted. Metadata export excludes
      payload.
    </small>
  );
}
export function ReaderHelp() {
  return (
    <>
      <p>
        Endpoints, sizes, TCP flags, DNS/HTTP/TLS, DHCP offers and QUIC-like headers. Ports are
        hints.
      </p>
      <p>
        File payload is opt-in; live capture keeps metadata. No decryption or process attribution.
        Use Wireshark for deeper analysis.
      </p>
    </>
  );
}

export function PayloadEvidence({ value, onForget }: { value: unknown; onForget: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="pp-packet-reconstruction">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide TCP payload evidence' : 'View TCP payload evidence'}
      </button>
      <button type="button" onClick={onForget}>
        Forget retained payload
      </button>
      {open ? (
        <PacketReconstruction value={value} />
      ) : (
        <small>Payload retained in memory. Save metadata excludes it.</small>
      )}
    </section>
  );
}

export default function PacketReconstruction({ value }: { value: unknown }) {
  const parsed = useMemo(() => {
    try {
      return { result: parseTCPReconstruction(value), error: '' };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : 'TCP evidence could not be read.',
      };
    }
  }, [value]);
  const [selected, setSelected] = useState('');
  const [format, setFormat] = useState<'text' | 'hex'>('text');
  if (!parsed.result) return <p role="alert">{parsed.error}</p>;
  const result = parsed.result;
  const flow = result.flows.find((flow) => flow.id === selected) ?? result.flows[0];
  return (
    <section className="pp-tcp-evidence" aria-label="TCP payload evidence">
      <h2>Captured TCP sequence evidence</h2>
      <p>
        {result.retainedBytes.toLocaleString()} retained bytes including retransmissions ·{' '}
        {result.flows.length} connection observations · {result.skippedFragments} fragmented records
        excluded
      </p>
      <p>
        Captured bytes only. Gaps stay empty; conflicting bytes are withheld. The preview is
        incomplete; encrypted bytes stay encrypted. A new SYN starts an observation for a reused
        tuple.
      </p>
      {result.limited ? (
        <p role="status">A limit omitted flows, segments, bytes or conflict details.</p>
      ) : null}
      {!flow ? (
        <p>No eligible TCP sequence evidence was retained.</p>
      ) : (
        <>
          <label>
            Connection observation
            <select value={flow.id} onChange={(event) => setSelected(event.target.value)}>
              {result.flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.directions[0].source} ↔ {flow.directions[0].destination} · section{' '}
                  {flow.section}, interface {flow.interface} · packets {flow.firstPacket}–
                  {flow.lastPacket}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payload display
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as 'text' | 'hex')}
            >
              <option value="text">UTF-8 text preview</option>
              <option value="hex">Hex bytes</option>
            </select>
          </label>
          {format === 'text' ? (
            <small>
              Invalid or incomplete UTF-8 uses replacement characters. Hex preserves exact bytes.
            </small>
          ) : null}
          {flow.limited ? (
            <p role="status">This connection observation is incomplete or bounded.</p>
          ) : null}
          {flow.directions.map((direction) => (
            <Direction
              key={`${flow.id}:${direction.source}`}
              direction={direction}
              format={format}
            />
          ))}
        </>
      )}
    </section>
  );
}

function display(bytes: readonly number[] | Uint8Array, format: 'text' | 'hex') {
  return format === 'hex'
    ? Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ')
    : new TextDecoder().decode(Uint8Array.from(bytes));
}
function Direction({ direction, format }: { direction: TCPDirection; format: 'text' | 'hex' }) {
  const blocks = useMemo(() => reconstructDirection(direction), [direction]);
  return (
    <details open>
      <summary>
        {direction.source} → {direction.destination}
      </summary>
      <p>
        Start {direction.startObserved ? 'SYN observed' : 'not observed'} · end{' '}
        {direction.endObserved ? 'FIN observed' : 'not observed'} · {direction.segments.length}{' '}
        retained segments
      </p>
      {direction.sequenceAmbiguous ? (
        <p>Sequence distance exceeded the bounded window; those bytes were omitted.</p>
      ) : null}
      {direction.conflictsLimited ? (
        <p>
          Conflict ranges exceeded the detail limit. Combined preview withheld; inspect the original
          capture.
        </p>
      ) : null}
      {direction.gaps.map((span) => (
        <p key={`gap:${span.start}`}>
          Unobserved gap: offsets {span.start}–{span.end - 1} ({span.end - span.start} bytes)
        </p>
      ))}
      {direction.conflicts.map((span) => (
        <p key={`conflict:${span.start}`}>
          Conflicting overlap: offsets {span.start}–{span.end - 1}; no byte value selected
        </p>
      ))}
      {blocks.map((block) => (
        <div key={block.start}>
          <small>
            Captured offsets {block.start}–{block.start + block.bytes.length - 1}
          </small>
          <pre>{display(block.bytes, format)}</pre>
        </div>
      ))}
      {!direction.segments.length ? (
        <p>No payload bytes retained in this direction.</p>
      ) : (
        <details>
          <summary>Per-packet segments, including retransmissions</summary>
          {direction.segments.map((segment) => (
            <div key={segment.packet}>
              <small>
                Packet {segment.packet} · sequence {segment.sequence} · offset {segment.offset} ·{' '}
                {segment.bytes.length} bytes
              </small>
              <pre>{display(segment.bytes, format)}</pre>
            </div>
          ))}
        </details>
      )}
    </details>
  );
}

import type { NmapTopologyPreview as Preview } from '@/console/nmap-to-network';
import './snapshot-comparison.css';

export default function NmapTopologyPreview({
  preview,
  busy,
  onSave,
  onCancel,
}: {
  preview: Preview;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="pp-snapshot-comparison" aria-label="Review Nmap topology import">
      <h2>Review imported map</h2>
      <p>
        {preview.workspace.nodes.length} hosts ·{' '}
        {preview.workspace.nodes.reduce((count, node) => count + node.ports.length, 0)} ports ·{' '}
        {preview.bytes.toLocaleString()} bytes · no inferred links
      </p>
      <p>
        Imported assertions, not verified services. Times record import time; source scan time is
        unknown. Command arguments, scripts, OS guesses and traces are omitted.
      </p>
      {!preview.complete ? (
        <p role="status">
          The source scan has no successful completion marker. This is partial evidence.
        </p>
      ) : null}
      <p>
        Omitted: {preview.losses.hosts} hosts · {preview.losses.identities} invalid or duplicate
        identities · {preview.losses.ports} unsupported, duplicate or excess ports ·{' '}
        {preview.losses.services} unnamed service hints.
      </p>
      <p>
        {preview.losses.compositeStates} port states represented as unknown; original state/reason
        remains in provenance.
      </p>
      <div className="pp-snapshot-selectors">
        <button type="button" disabled={busy} onClick={onSave}>
          {busy ? 'Saving…' : 'Save imported map'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel import
        </button>
      </div>
    </section>
  );
}

import { useContext, useState, useSyncExternalStore } from 'react';
import {
  clearOperationReceipts,
  type ReceiptOperation,
  readOperationReceipts,
  receiptHandoff,
  receiptOperations,
  receiptTargetLabel,
  recentSuccessfulTargets,
  subscribeOperationReceipts,
} from './app/operation-receipts';
import { ProtocolShellContext } from './ProtocolShellContext';
import './operation-history.css';

const outcomes = {
  success: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  partial: 'Partial',
  stale: 'Superseded',
};
export default function OperationHistory({
  operations,
}: {
  operations?: readonly ReceiptOperation[];
}) {
  const receipts = useSyncExternalStore(
    subscribeOperationReceipts,
    readOperationReceipts,
    readOperationReceipts
  );
  const shell = useContext(ProtocolShellContext);
  const [notice, setNotice] = useState('');
  const visible = operations
    ? receipts.filter((receipt) => operations.includes(receipt.operation))
    : receipts;
  const recent = recentSuccessfulTargets(visible);
  return (
    <section className="pp-operation-history-view" aria-label="Session operation history">
      <header>
        <h2>Session activity</h2>
        <button type="button" disabled={!receipts.length} onClick={clearOperationReceipts}>
          Clear all session activity
        </button>
      </header>
      <p>
        Up to 40 sanitized receipts in this tab’s memory. Reloading clears them. HTTP endpoints omit
        paths and parameters; no request content, credentials or raw error messages are kept.
      </p>
      {recent.length ? (
        <section aria-label="Recent completed endpoints">
          <h3>Resume an endpoint</h3>
          <p>
            Opens an unsent manual draft. Earlier success does not establish current reachability.
          </p>
          {recent.map((receipt) => (
            <button
              type="button"
              key={receipt.id}
              onClick={() => {
                const handoff = receiptHandoff(receipt);
                if (!handoff || !shell) {
                  setNotice('Open this view inside the workbench to resume a draft.');
                  return;
                }
                const result = shell.openHandoff(handoff);
                if (!result.ok) setNotice(result.error);
              }}
            >
              {receiptTargetLabel(receipt)} · {receiptOperations[receipt.operation]}
            </button>
          ))}
        </section>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!visible.length ? (
        <p>No explicit operations recorded in this view.</p>
      ) : (
        <ol>
          {visible.map((receipt) => (
            <li key={receipt.id}>
              <strong>
                {receiptOperations[receipt.operation]} · {outcomes[receipt.outcome]}
              </strong>
              <time dateTime={receipt.observedAt}>
                {new Date(receipt.observedAt).toLocaleString()}
              </time>
              {receipt.target ? <code>{receiptTargetLabel(receipt)}</code> : null}
              <span>
                {receipt.httpStatus !== undefined ? `HTTP ${receipt.httpStatus} · ` : ''}
                {receipt.grpcCode !== undefined ? `gRPC code ${receipt.grpcCode} · ` : ''}
                {receipt.count !== undefined ? `${receipt.count} records · ` : ''}
                {receipt.durationMs !== undefined ? `${Math.round(receipt.durationMs)} ms` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

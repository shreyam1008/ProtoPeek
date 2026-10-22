import { lazy, Suspense, useState } from 'react';
import type { ReceiptOperation } from './app/operation-receipts';

const OperationHistory = lazy(() => import('./OperationHistory'));
export function OperationHistoryControl({
  operations,
}: {
  operations?: readonly ReceiptOperation[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="pp-operation-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Session activity</summary>
      {open ? (
        <Suspense fallback={<p>Loading session activity…</p>}>
          <OperationHistory operations={operations} />
        </Suspense>
      ) : null}
    </details>
  );
}

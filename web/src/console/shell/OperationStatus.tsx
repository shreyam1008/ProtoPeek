import { useEffect, useState } from 'react';

export function OperationStatus({
  busy,
  label,
  completed,
  total,
}: {
  busy: boolean;
  label: string;
  completed?: number;
  total?: number;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setSeconds(0);
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [busy]);
  if (!busy) return null;
  const measured = total !== undefined && total > 0 && completed !== undefined;
  return (
    <section className="pp-operation-status" aria-label={label}>
      <div>
        <span>{label}</span>
        <span>{seconds}s elapsed</span>
      </div>
      <progress
        aria-label={label}
        max={measured ? total : undefined}
        value={measured ? Math.min(total, Math.max(0, completed)) : undefined}
      />
      <small>
        {measured
          ? `${completed.toLocaleString()} of ${total.toLocaleString()}`
          : 'Waiting for results. You can cancel the operation.'}
      </small>
    </section>
  );
}

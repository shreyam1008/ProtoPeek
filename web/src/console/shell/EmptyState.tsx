import { Activity, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  children,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="pp-empty-state" role={busy ? 'status' : undefined}>
      <span className="pp-empty-state-icon">
        {busy ? <LoaderCircle data-loading aria-hidden="true" /> : <Activity aria-hidden="true" />}
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

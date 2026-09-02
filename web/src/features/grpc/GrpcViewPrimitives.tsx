import { CircleAlert, Clock3, X } from 'lucide-react';
import { classNames } from '@/shared/utils';

export function GrpcMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-pp-border bg-white p-3">
      <div className="pp-label">{label}</div>
      <div className="mt-1 text-sm font-semibold text-pp-ink">{value}</div>
    </div>
  );
}

export function GrpcStatusBanner({
  tone,
  title,
  description,
  onDismiss,
  actions,
}: {
  tone: 'danger' | 'info';
  title: string;
  description: string;
  onDismiss?: () => void;
  actions?: Array<{ label: string; run: () => void }>;
}) {
  return (
    <div
      className={classNames('pp-operation-banner', tone === 'danger' && 'is-danger')}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-pp-ink">
        {tone === 'danger' ? (
          <CircleAlert className="size-4 text-pp-danger" />
        ) : (
          <Clock3 className="size-4 text-pp-brand" />
        )}
        {title}
        {onDismiss ? (
          <button
            type="button"
            className="pp-operation-dismiss"
            aria-label="Dismiss notification"
            onClick={onDismiss}
          >
            <X className="pp-operation-dismiss-icon" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className="pp-muted mt-1">{description}</p>
      {actions?.length ? (
        <div className="pp-operation-actions">
          {actions.map((action) => (
            <button key={action.label} type="button" onClick={action.run}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

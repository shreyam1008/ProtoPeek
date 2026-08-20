import { Activity, CircleStop, Play, Stethoscope } from 'lucide-react';

import type { HealthRun } from './health';

type HealthPanelProps = {
  service: string;
  onServiceChange: (value: string) => void;
  selectedService: string;
  serviceSuggestions: string[];
  checkDeadlineSeconds: number;
  onCheckDeadlineChange: (value: number) => void;
  watchDurationSeconds: number;
  onWatchDurationChange: (value: number) => void;
  run: HealthRun | null;
  busy: boolean;
  blockedBy: string | null;
  operationError: string | null;
  healthAdvertised: boolean;
  currentContextKey: string;
  currentTarget: string;
  onCheck: () => void;
  onWatch: () => void;
  onCancel: () => void;
};

function statusClass(name: string | undefined) {
  switch (name) {
    case 'SERVING':
      return 'is-serving';
    case 'NOT_SERVING':
      return 'is-not-serving';
    case 'SERVICE_UNKNOWN':
      return 'is-service-unknown';
    default:
      return 'is-unknown';
  }
}

function milliseconds(value: number) {
  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 100) return `${value.toFixed(1)} ms`;
  return `${Math.round(value)} ms`;
}

function keyedMetadata(entries: HealthRun['headers']) {
  const occurrences = new Map<string, number>();
  return entries.map((entry) => {
    const fingerprint = `${entry.name}\u0000${entry.value}`;
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return { ...entry, key: `${fingerprint}\u0000${occurrence}` };
  });
}

function endCopy(run: HealthRun) {
  switch (run.endReason) {
    case 'duration-limit':
      return 'Expected bounded completion: the configured Watch duration ended. This does not mark the service unhealthy.';
    case 'user-cancelled':
      return 'Cancelled locally; partial observations are preserved.';
    case 'canceled':
      return 'The relay reported RPC cancellation; partial observations are preserved.';
    case 'navigation':
      return 'Cancelled when you left Checks; partial observations are preserved.';
    case 'context-changed':
      return 'Cancelled because the target or method context changed; partial observations are preserved.';
    case 'unsupported':
      return 'Watch is unimplemented by this server. ProtoPeek did not retry.';
    case 'observation-limit':
      return 'The relay observation cap ended this Watch; retained transitions remain available.';
    case 'relay-error':
      return 'The browser/HTTP relay could not complete this operation.';
    case 'protocol-error':
      return 'The relay returned malformed or truncated Health evidence.';
    case 'rpc-error':
      return 'The Health RPC ended with a gRPC error.';
    case 'completed':
      return 'The server completed the Watch stream.';
    case 'check-completed':
      return 'Health Check returned once.';
    default:
      return run.phase === 'running' ? 'Health operation in progress…' : '';
  }
}

export function HealthPanel({
  service,
  onServiceChange,
  selectedService,
  serviceSuggestions,
  checkDeadlineSeconds,
  onCheckDeadlineChange,
  watchDurationSeconds,
  onWatchDurationChange,
  run,
  busy,
  blockedBy,
  operationError,
  healthAdvertised,
  currentContextKey,
  currentTarget,
  onCheck,
  onWatch,
  onCancel,
}: HealthPanelProps) {
  const checkValid =
    Number.isFinite(checkDeadlineSeconds) &&
    checkDeadlineSeconds >= 0.1 &&
    checkDeadlineSeconds <= 30;
  const watchValid =
    Number.isFinite(watchDurationSeconds) &&
    watchDurationSeconds >= 1 &&
    watchDurationSeconds <= 600;
  const previousConnection = Boolean(
    run && (run.contextKey !== currentContextKey || run.target !== currentTarget)
  );
  const headerRows = keyedMetadata(run?.headers ?? []);
  const trailerRows = keyedMetadata(run?.trailers ?? []);
  const disabledReason = blockedBy || null;

  return (
    <section className="pp-health-panel" aria-labelledby="health-heading">
      <div className="pp-health-heading">
        <div>
          <span className="pp-health-kicker">
            <Activity aria-hidden="true" /> Standard gRPC protocol
          </span>
          <h3 id="health-heading" className="pp-heading text-base">
            Health Check / Watch
          </h3>
          <p>Probe grpc.health.v1.Health without reflection or an application descriptor.</p>
          <span className="pp-health-advertised">
            {healthAdvertised
              ? 'Advertised in schema'
              : 'Not advertised · direct probe still available'}
          </span>
        </div>
        {busy ? (
          <button
            type="button"
            className="pp-button-secondary pp-health-cancel"
            aria-label={run?.operation === 'watch' ? 'Cancel Watch' : 'Cancel Check'}
            onClick={onCancel}
          >
            <CircleStop aria-hidden="true" /> Cancel{' '}
            {run?.operation === 'watch' ? 'Watch' : 'Check'}
          </button>
        ) : null}
      </div>

      <div className="pp-health-controls">
        <label className="pp-health-service">
          <span>Service</span>
          <input
            className="pp-input"
            aria-label="Health service"
            list="pp-health-service-suggestions"
            maxLength={1024}
            placeholder="Blank = overall server"
            value={service}
            disabled={busy}
            onChange={(event) => onServiceChange(event.target.value)}
          />
        </label>
        <datalist id="pp-health-service-suggestions">
          {serviceSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <button
          type="button"
          className="pp-button-ghost pp-health-use-selected"
          aria-label="Use selected service"
          disabled={busy || !selectedService || selectedService === service}
          onClick={() => onServiceChange(selectedService)}
        >
          Use selected
        </button>
        <label>
          <span>Check deadline</span>
          <span className="pp-health-input-unit">
            <input
              aria-label="Check deadline in seconds"
              type="number"
              min={0.1}
              max={30}
              step={0.1}
              value={Number.isFinite(checkDeadlineSeconds) ? checkDeadlineSeconds : ''}
              disabled={busy}
              onChange={(event) =>
                onCheckDeadlineChange(
                  event.target.value === '' ? Number.NaN : Number(event.target.value)
                )
              }
            />
            <small>s</small>
          </span>
        </label>
        <label>
          <span>Watch duration</span>
          <span className="pp-health-input-unit">
            <input
              aria-label="Watch duration in seconds"
              type="number"
              min={1}
              max={600}
              step={1}
              value={Number.isFinite(watchDurationSeconds) ? watchDurationSeconds : ''}
              disabled={busy}
              onChange={(event) =>
                onWatchDurationChange(
                  event.target.value === '' ? Number.NaN : Number(event.target.value)
                )
              }
            />
            <small>s</small>
          </span>
        </label>
      </div>

      <div className="pp-health-actions">
        <button
          type="button"
          className="pp-button-secondary"
          disabled={busy || Boolean(disabledReason) || !checkValid}
          onClick={onCheck}
        >
          <Stethoscope aria-hidden="true" /> Check now
        </button>
        <button
          type="button"
          className="pp-button-primary"
          disabled={busy || Boolean(disabledReason) || !watchValid}
          onClick={onWatch}
        >
          <Play aria-hidden="true" /> Start Watch
        </button>
        <span>Check 0.1–30 s · Watch 1–600 s · latest 200 transitions retained</span>
      </div>

      {disabledReason ? <p className="pp-health-message">{disabledReason}</p> : null}
      {operationError ? (
        <div className="pp-health-error" role="alert">
          <strong>Health operation needs attention</strong>
          <span>{operationError}</span>
        </div>
      ) : null}

      {run ? (
        <div className="pp-health-evidence">
          <div
            className="pp-health-current"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={`${run.latestStatus?.name ?? 'No status observed'} for ${run.service || 'the overall server'} at ${run.target}.${
              previousConnection ? ' Previous connection.' : ''
            }${
              run.phase === 'ended'
                ? ` ${endCopy(run)}${run.grpcStatus ? ` Final gRPC status: ${run.grpcStatus.name} (${run.grpcStatus.code}).` : ''}${run.error ? ` ${run.error}` : ''}`
                : ''
            }`}
          >
            <div>
              <span className={`pp-health-status ${statusClass(run.latestStatus?.name)}`}>
                <i aria-hidden="true" /> {run.latestStatus?.name ?? 'NO STATUS OBSERVED'}
              </span>
              {previousConnection ? (
                <span className="pp-health-previous">Previous connection</span>
              ) : null}
            </div>
            <strong>{run.service || 'Overall server'}</strong>
            <span>{run.target}</span>
          </div>

          <div className="pp-health-attribution">
            <span>
              {run.operation === 'watch'
                ? `${run.watchDurationSeconds} s Watch duration`
                : `${run.checkDeadlineSeconds} s Check deadline`}
            </span>
            <span>
              {run.metadataCount} editor metadata {run.metadataCount === 1 ? 'entry' : 'entries'}
            </span>
            <time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString()}</time>
            {run.handlerInvokeMs !== null ? (
              <span>{milliseconds(run.handlerInvokeMs)} ProtoPeek handler invoke</span>
            ) : null}
          </div>

          {run.droppedTransitions > 0 ? (
            <p className="pp-health-dropped">
              {run.droppedTransitions} earlier transitions dropped from this bounded view.
            </p>
          ) : null}

          {run.transitions.length ? (
            <ol className="pp-health-timeline" aria-label="Health status transitions">
              {run.transitions.map((transition) => (
                <li key={transition.sequence}>
                  <i className={statusClass(transition.servingStatus.name)} aria-hidden="true" />
                  <span>{transition.servingStatus.name}</span>
                  <time>Observed +{milliseconds(transition.observedOffsetMs)}</time>
                </li>
              ))}
            </ol>
          ) : null}

          {run.phase === 'ended' ? (
            <div className="pp-health-end">
              <strong>{endCopy(run)}</strong>
              {run.grpcStatus ? (
                <span>
                  Final gRPC status: {run.grpcStatus.name} ({run.grpcStatus.code})
                  {run.grpcStatus.message ? ` · ${run.grpcStatus.message}` : ''}
                  {run.grpcStatus.messageTruncated ? ' · message truncated' : ''}
                </span>
              ) : null}
              {run.error ? <span>{run.error}</span> : null}
            </div>
          ) : null}

          {run.headers.length ||
          run.trailers.length ||
          run.headersTruncated ||
          run.trailersTruncated ? (
            <details className="pp-health-metadata">
              <summary>
                Response metadata · {run.headers.length} headers · {run.trailers.length} trailers
              </summary>
              <p>
                {run.headersTruncated || run.trailersTruncated
                  ? 'Response metadata evidence is incomplete or truncated at the relay boundary.'
                  : 'Response metadata was callback-observed by the ProtoPeek handler.'}
              </p>
              <div className="pp-health-metadata-columns">
                <section>
                  <strong>Headers</strong>
                  {run.headers.length ? (
                    <dl>
                      {headerRows.map((entry) => (
                        <div key={entry.key}>
                          <dt>{entry.name}</dt>
                          <dd>{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <span>No headers observed.</span>
                  )}
                </section>
                <section>
                  <strong>Trailers</strong>
                  {run.trailers.length ? (
                    <dl>
                      {trailerRows.map((entry) => (
                        <div key={entry.key}>
                          <dt>{entry.name}</dt>
                          <dd>{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <span>No trailers observed.</span>
                  )}
                </section>
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="pp-health-empty">No Health evidence in this browser session yet.</p>
      )}

      <div className="pp-health-boundaries">
        <p>
          Status comes from the selected backend or replica for this RPC—not every replica,
          dependency, or the next call.
        </p>
        <p>
          Times are handler/relay callback-observed lifecycle boundaries, not packet arrival, server
          processing time, or wire TTFB.
        </p>
        <p>
          Sendable live editor metadata values are sent but never retained in Health evidence.
          Configured CLI or preserved relay metadata may also apply. No storage or export is
          created.
        </p>
        <p>Watch opens one bounded stream with no background retry; SERVICE_UNKNOWN may recover.</p>
      </div>
    </section>
  );
}

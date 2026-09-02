import { CheckCircle2, Download, Play, Plus, X } from 'lucide-react';
import { HealthPanel } from '@/console/HealthPanel';
import type { HealthRun } from '@/console/health';
import { GrpcMetric, GrpcStatusBanner } from '@/features/grpc/GrpcViewPrimitives';
import type {
  AssertionResult,
  AssertionRule,
  BootstrapMethod,
  RepeatConfig,
  RepeatRun,
} from '@/shared/types';
import { classNames, durationLabel } from '@/shared/utils';
import { repeatAggregateLimitMs, repeatPresets } from '../operations/repeat-model';

const assertionKindOptions: Array<{ value: AssertionRule['kind']; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'latency_ms', label: 'Latency' },
  { value: 'header', label: 'Header' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'response_count', label: 'Resp count' },
  { value: 'body_text', label: 'Body text' },
];

const assertionComparatorOptions: Array<{
  value: AssertionRule['comparator'];
  label: string;
}> = [
  { value: 'equals', label: '=' },
  { value: 'contains', label: 'contains' },
  { value: 'lte', label: '<=' },
  { value: 'gte', label: '>=' },
];

export function ChecksView({
  healthService,
  onHealthServiceChange,
  selectedHealthService,
  healthServiceSuggestions,
  healthCheckDeadlineSeconds,
  onHealthCheckDeadlineChange,
  healthWatchDurationSeconds,
  onHealthWatchDurationChange,
  healthRun,
  healthBusy,
  healthBlockedBy,
  healthError,
  healthAdvertised,
  currentHealthContextKey,
  currentTarget,
  onHealthCheck,
  onHealthWatch,
  onCancelHealth,
  rules,
  results,
  onChangeRule,
  onAddRule,
  onRemoveRule,
  onRunAssertions,
  method,
  repeatConfig,
  setRepeatConfig,
  repeatRun,
  repeatBusy,
  repeatError,
  repeatProgress,
  onRepeat,
  onCancelRepeat,
  onExportRepeat,
  repeatLatencySparkline,
  passingAssertions,
}: {
  healthService: string;
  onHealthServiceChange: (value: string) => void;
  selectedHealthService: string;
  healthServiceSuggestions: string[];
  healthCheckDeadlineSeconds: number;
  onHealthCheckDeadlineChange: (value: number) => void;
  healthWatchDurationSeconds: number;
  onHealthWatchDurationChange: (value: number) => void;
  healthRun: HealthRun | null;
  healthBusy: boolean;
  healthBlockedBy: string | null;
  healthError: string | null;
  healthAdvertised: boolean;
  currentHealthContextKey: string;
  currentTarget: string;
  onHealthCheck: () => void;
  onHealthWatch: () => void;
  onCancelHealth: () => void;
  rules: AssertionRule[];
  results: AssertionResult[];
  onChangeRule: (id: string, rule: AssertionRule) => void;
  onAddRule: () => void;
  onRemoveRule: (id: string) => void;
  onRunAssertions: () => void;
  method: BootstrapMethod;
  repeatConfig: RepeatConfig;
  setRepeatConfig: (update: (config: RepeatConfig) => RepeatConfig) => void;
  repeatRun: RepeatRun | null;
  repeatBusy: boolean;
  repeatError: string | null;
  repeatProgress: { attempted: number; requested: number };
  onRepeat: () => void;
  onCancelRepeat: () => void;
  onExportRepeat: () => void;
  repeatLatencySparkline: string;
  passingAssertions: number;
}) {
  const repeatEligible = !method.clientStreaming && !method.serverStreaming;
  const minimumPacedMs = Math.max(0, repeatConfig.count - 1) * repeatConfig.thinkTimeMs;
  const displayedAttempts = repeatRun?.attempts.length ?? repeatProgress.attempted;
  const displayedRequested = repeatRun?.requestedCount ?? repeatProgress.requested;
  const repeatConfigChanged = Boolean(
    repeatRun &&
      (repeatRun.config.count !== repeatConfig.count ||
        repeatRun.config.thinkTimeMs !== repeatConfig.thinkTimeMs ||
        repeatRun.config.deadlineSeconds !== repeatConfig.deadlineSeconds)
  );
  return (
    <div className="space-y-6">
      <HealthPanel
        service={healthService}
        onServiceChange={onHealthServiceChange}
        selectedService={selectedHealthService}
        serviceSuggestions={healthServiceSuggestions}
        checkDeadlineSeconds={healthCheckDeadlineSeconds}
        onCheckDeadlineChange={onHealthCheckDeadlineChange}
        watchDurationSeconds={healthWatchDurationSeconds}
        onWatchDurationChange={onHealthWatchDurationChange}
        run={healthRun}
        busy={healthBusy}
        blockedBy={healthBlockedBy}
        operationError={healthError}
        healthAdvertised={healthAdvertised}
        currentContextKey={currentHealthContextKey}
        currentTarget={currentTarget}
        onCheck={onHealthCheck}
        onWatch={onHealthWatch}
        onCancel={onCancelHealth}
      />

      <section>
        <div className="flex items-center justify-between">
          <h3 className="pp-heading text-base">Assertions</h3>
          <div className="flex gap-2">
            <button
              className="pp-button-primary py-1.5 text-xs"
              type="button"
              disabled={repeatBusy || healthBusy}
              title={
                healthBusy
                  ? 'Cancel Health first, then run assertions.'
                  : repeatBusy
                    ? 'Cancel Repeat first, then run assertions.'
                    : undefined
              }
              onClick={onRunAssertions}
            >
              <CheckCircle2 className="size-3" />
              Run
            </button>
            <button
              className="pp-button-secondary py-1.5 text-xs"
              type="button"
              onClick={onAddRule}
            >
              <Plus className="size-3" />
              Add
            </button>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-lg border border-pp-border bg-white p-3">
              <div className="flex gap-2">
                <input
                  className="pp-input flex-1 text-xs"
                  value={rule.name}
                  onChange={(event) => onChangeRule(rule.id, { ...rule, name: event.target.value })}
                  placeholder="Rule name"
                />
                <select
                  className="pp-input w-28 text-xs"
                  value={rule.kind}
                  onChange={(event) =>
                    onChangeRule(rule.id, {
                      ...rule,
                      kind: event.target.value as AssertionRule['kind'],
                      target:
                        event.target.value === 'header' || event.target.value === 'trailer'
                          ? rule.target
                          : '',
                    })
                  }
                >
                  {assertionKindOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="pp-input w-20 text-xs"
                  value={rule.comparator}
                  onChange={(event) =>
                    onChangeRule(rule.id, {
                      ...rule,
                      comparator: event.target.value as AssertionRule['comparator'],
                    })
                  }
                >
                  {assertionComparatorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  className="pp-button-ghost px-2"
                  type="button"
                  onClick={() => onRemoveRule(rule.id)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  className="pp-input flex-1 text-xs"
                  value={rule.target}
                  onChange={(event) =>
                    onChangeRule(rule.id, { ...rule, target: event.target.value })
                  }
                  placeholder={
                    rule.kind === 'header' || rule.kind === 'trailer' ? 'metadata key' : 'target'
                  }
                />
                <input
                  className="pp-input flex-1 text-xs"
                  value={rule.value}
                  onChange={(event) =>
                    onChangeRule(rule.id, { ...rule, value: event.target.value })
                  }
                  placeholder="expected"
                />
              </div>
            </div>
          ))}
        </div>
        {results.length > 0 ? (
          <div className="mt-3 space-y-1">
            <span className="pp-label">
              {passingAssertions}/{results.length} passing
            </span>
            {results.map((result) => (
              <div
                key={result.id}
                className={classNames(
                  'rounded-lg border p-2 text-xs',
                  result.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                )}
              >
                <span
                  className={classNames(
                    'font-semibold',
                    result.passed ? 'text-pp-ok' : 'text-pp-danger'
                  )}
                >
                  {result.passed ? 'PASS' : 'FAIL'}
                </span>{' '}
                <span className="text-pp-ink">{result.name}</span>
                <div className="text-pp-muted">{result.message}</div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="pp-repeat-panel">
        <div className="pp-repeat-heading">
          <div>
            <h3 className="pp-heading text-base">Unary repeat</h3>
            <p>
              Sequentially repeat this unary request through the same target. Browser-observed
              debugging evidence, not a load test.
            </p>
          </div>
          <button
            className={classNames(
              'pp-button-primary py-1.5 text-xs',
              repeatBusy && 'pp-repeat-cancel'
            )}
            type="button"
            aria-label={repeatBusy ? 'Cancel repeat' : 'Run repeat'}
            disabled={!repeatBusy && (!repeatEligible || healthBusy)}
            onClick={repeatBusy ? onCancelRepeat : onRepeat}
          >
            {repeatBusy ? <X className="size-3" /> : <Play className="size-3" />}
            {repeatBusy
              ? 'Cancel'
              : `Run ${Number.isInteger(repeatConfig.count) ? repeatConfig.count : '—'} calls`}
          </button>
        </div>

        {!repeatEligible ? (
          <div className="mt-3">
            <GrpcStatusBanner
              tone="info"
              title="Unary only"
              description="Repeat is disabled for client-, server-, and bidirectional-streaming methods. Use Invoke to inspect stream evidence without multiplying the stream."
            />
          </div>
        ) : null}

        <fieldset className="pp-repeat-presets" aria-label="Repeat presets">
          {repeatPresets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={repeatBusy || healthBusy || !repeatEligible}
              onClick={() => setRepeatConfig(() => preset.config)}
            >
              {preset.label}
            </button>
          ))}
        </fieldset>
        <div className="pp-repeat-config">
          <label>
            <span>Calls</span>
            <input
              aria-label="Calls"
              type="number"
              min={2}
              max={50}
              step={1}
              disabled={repeatBusy || healthBusy || !repeatEligible}
              value={Number.isFinite(repeatConfig.count) ? repeatConfig.count : ''}
              onChange={(event) =>
                setRepeatConfig((config) => ({
                  ...config,
                  count: event.target.value === '' ? Number.NaN : Number(event.target.value),
                }))
              }
            />
          </label>
          <label>
            <span>Think time</span>
            <span className="pp-repeat-input-unit">
              <input
                aria-label="Think time in milliseconds"
                type="number"
                min={0}
                max={5000}
                step={1}
                disabled={repeatBusy || healthBusy || !repeatEligible}
                value={Number.isFinite(repeatConfig.thinkTimeMs) ? repeatConfig.thinkTimeMs : ''}
                onChange={(event) =>
                  setRepeatConfig((config) => ({
                    ...config,
                    thinkTimeMs:
                      event.target.value === '' ? Number.NaN : Number(event.target.value),
                  }))
                }
              />
              <small>ms</small>
            </span>
          </label>
          <label>
            <span>Per-call deadline</span>
            <span className="pp-repeat-input-unit">
              <input
                aria-label="Per-call deadline in seconds"
                type="number"
                min={0.1}
                max={30}
                step={0.1}
                disabled={repeatBusy || healthBusy || !repeatEligible}
                value={
                  Number.isFinite(repeatConfig.deadlineSeconds) ? repeatConfig.deadlineSeconds : ''
                }
                onChange={(event) =>
                  setRepeatConfig((config) => ({
                    ...config,
                    deadlineSeconds:
                      event.target.value === '' ? Number.NaN : Number(event.target.value),
                  }))
                }
              />
              <small>s</small>
            </span>
          </label>
        </div>
        <p className="pp-repeat-boundary">
          2–50 calls · one at a time · 60 s wall cap · think time occurs only between calls
        </p>
        <p className="pp-repeat-safety">
          Every Repeat attempt is a real RPC and may mutate service data. Protobuf descriptors do
          not reliably guarantee idempotency.
        </p>
        {minimumPacedMs >= repeatAggregateLimitMs ? (
          <p className="pp-repeat-warning">
            Think time alone exceeds the 60 second wall cap; expect a partial run.
          </p>
        ) : null}

        {repeatError ? (
          <div className="mt-3">
            <GrpcStatusBanner
              tone="danger"
              title={repeatBusy ? 'Repeat owns this request' : 'Repeat did not start'}
              description={repeatError}
            />
          </div>
        ) : null}

        {repeatBusy || repeatRun ? (
          <div className="pp-repeat-progress" aria-live="polite">
            <div>
              <strong>
                {displayedAttempts} of {displayedRequested} attempts
              </strong>
              <span>
                {repeatBusy
                  ? 'Running sequentially…'
                  : repeatRun?.stopReason === 'completed'
                    ? 'Completed all requested calls.'
                    : repeatRun?.stopReason === 'aggregate-limit'
                      ? 'Stopped at the 60 second wall cap; partial results preserved.'
                      : 'Cancelled; partial results preserved.'}
              </span>
            </div>
            <progress
              aria-label="Repeat progress"
              max={Math.max(1, displayedRequested)}
              value={displayedAttempts}
            />
          </div>
        ) : null}

        {repeatRun ? (
          <div className="pp-repeat-results">
            <div className="pp-repeat-actions">
              <div>
                <strong>{repeatRun.method}</strong>
                <span>
                  {repeatRun.target} · {durationLabel(repeatRun.totalMs)} total
                </span>
                <span className="pp-repeat-run-attribution">
                  Run started{' '}
                  <time title="Repeat run started" dateTime={repeatRun.createdAt}>
                    {new Date(repeatRun.createdAt).toLocaleString()}
                  </time>{' '}
                  · {repeatRun.config.count} calls · {repeatRun.config.thinkTimeMs} ms think ·{' '}
                  {repeatRun.config.deadlineSeconds} s deadline
                </span>
                {repeatConfigChanged ? (
                  <span className="pp-repeat-stale">Previous run · controls have changed</span>
                ) : null}
              </div>
              <button type="button" className="pp-button-secondary" onClick={onExportRepeat}>
                <Download className="size-3" />
                Export JSON
              </button>
            </div>
            <p className="pp-repeat-snapshot-note">
              Request payload and metadata were snapshotted at run start, but are not retained or
              exported with this evidence.
            </p>
            <div className="pp-repeat-outcomes">
              <GrpcMetric label="OK" value={String(repeatRun.counts.ok)} />
              <GrpcMetric label="gRPC errors" value={String(repeatRun.counts.grpcError)} />
              <GrpcMetric label="Local limits" value={String(repeatRun.counts.localLimit)} />
              <GrpcMetric
                label="Relay / transport errors"
                value={String(repeatRun.counts.relayTransportError)}
              />
              <GrpcMetric label="Cancelled" value={String(repeatRun.counts.cancelled)} />
            </div>
            <div className="pp-repeat-latency">
              <GrpcMetric
                label="Min"
                value={
                  repeatRun.latency.minMs === null ? '—' : durationLabel(repeatRun.latency.minMs)
                }
              />
              <GrpcMetric
                label="Median"
                value={
                  repeatRun.latency.medianMs === null
                    ? '—'
                    : durationLabel(repeatRun.latency.medianMs)
                }
              />
              <GrpcMetric
                label="p95"
                value={
                  repeatRun.latency.p95Ms === null
                    ? `Needs 20 (${repeatRun.latency.sampleCount})`
                    : durationLabel(repeatRun.latency.p95Ms)
                }
              />
              <GrpcMetric
                label="Max"
                value={
                  repeatRun.latency.maxMs === null ? '—' : durationLabel(repeatRun.latency.maxMs)
                }
              />
            </div>
            <p className="pp-repeat-latency-source">
              Summary source:{' '}
              {repeatRun.latency.source === 'handler-invoke'
                ? `ProtoPeek handler invoke (${repeatRun.latency.sampleCount} measured calls)`
                : `console round-trip fallback (${repeatRun.latency.sampleCount} completed RPCs)`}
              <br />
              {repeatRun.latency.source === 'handler-invoke'
                ? 'Handler timing includes JSON/protobuf conversion and callbacks, but excludes the browser and HTTP relay.'
                : 'Console round trip includes the browser and HTTP relay plus response parsing.'}
            </p>
            {repeatLatencySparkline ? (
              <div className="pp-repeat-sparkline">
                <span>
                  {repeatRun.latency.source === 'handler-invoke'
                    ? 'ProtoPeek handler invoke duration in call order'
                    : 'Console round-trip fallback in call order'}
                </span>
                <svg aria-label="Repeat latency sparkline" role="img" viewBox="0 0 200 48">
                  <title>Repeat latency sparkline</title>
                  <path
                    d={repeatLatencySparkline}
                    fill="none"
                    stroke="var(--pp-accent-signal)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            ) : null}
            <details className="pp-repeat-attempts">
              <summary>Attempt details ({repeatRun.attempts.length})</summary>
              <div>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Result</th>
                      <th>Latency</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repeatRun.attempts.map((attempt) => (
                      <tr key={attempt.sequence}>
                        <td>{attempt.sequence}</td>
                        <td>
                          <span className={`pp-repeat-result is-${attempt.outcome}`}>
                            {attempt.outcome}
                          </span>
                        </td>
                        <td>
                          {attempt.handlerInvokeMs === null
                            ? `Console ${durationLabel(attempt.consoleRoundTripMs)}`
                            : `Handler ${durationLabel(attempt.handlerInvokeMs)} · Console ${durationLabel(attempt.consoleRoundTripMs)}`}
                        </td>
                        <td>
                          {attempt.grpcStatus
                            ? `${attempt.grpcStatus.name} (${attempt.grpcStatus.code}): ${attempt.grpcStatus.message}`
                            : attempt.error ||
                              `${attempt.responseCount} message(s), ${attempt.headerCount} header(s), ${attempt.trailerCount} trailer(s)`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <p className="pp-repeat-export-note">
              Export includes method, target, run configuration, timestamps, counts, per-attempt
              offsets and timings, classifications, and error and status text. Request bodies and
              metadata are excluded. Review target and service-provided details before sharing.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

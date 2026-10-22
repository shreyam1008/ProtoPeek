import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import type { InvokeResponse, MetadataEntry } from '@/shared/types';
import { classNames, durationLabel, prettyJson } from '@/shared/utils';

type ResponseTab = 'messages' | 'headers' | 'trailers' | 'status';
function timingLabel(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? durationLabel(value)
    : '—';
}
export function GrpcResponseEvidence({
  tab,
  response,
  latencyMs,
  filtered,
  selectedIndex,
  selected,
  onSelect,
  onCopy,
}: {
  tab: ResponseTab;
  response: InvokeResponse;
  latencyMs: number;
  filtered: Array<{ item: InvokeResponse['responses'][number]; index: number }>;
  selectedIndex: number;
  selected: InvokeResponse['responses'][number] | null;
  onSelect: (index: number) => void;
  onCopy: () => void;
}) {
  switch (tab) {
    case 'messages':
      return (
        <ResponseMessages
          responses={response.responses}
          filtered={filtered}
          selectedIndex={selectedIndex}
          selected={selected}
          onSelect={onSelect}
          onCopy={onCopy}
        />
      );
    case 'headers':
      return <MetadataGrid title="Response headers" values={response.headers} />;
    case 'trailers':
      return response.finalStatusObserved === false ? (
        <ResponsePlaceholder>
          Final server status and trailers have not been observed.
        </ResponsePlaceholder>
      ) : (
        <MetadataGrid title="Response trailers" values={response.trailers} />
      );
    case 'status':
      return <StatusGrid response={response} latencyMs={latencyMs} />;
  }
}

function ResponseMessages({
  responses,
  filtered,
  selectedIndex,
  selected,
  onSelect,
  onCopy,
}: {
  responses: InvokeResponse['responses'];
  filtered: Array<{ item: InvokeResponse['responses'][number]; index: number }>;
  selectedIndex: number;
  selected: InvokeResponse['responses'][number] | null;
  onSelect: (index: number) => void;
  onCopy: () => void;
}) {
  if (!responses.length) return <ResponsePlaceholder>No response messages.</ResponsePlaceholder>;

  return (
    <div className="pp-response-messages">
      <section className="pp-message-timeline" aria-label="Response message timeline">
        <div className="pp-message-row pp-message-heading">
          <span>#</span>
          <span>Message</span>
          <span title="Callback-observed message boundaries, not packet arrival or TTFB">
            Observed / +gap
          </span>
        </div>
        {filtered.map(({ item, index }) => {
          const cumulativeMs = item.elapsedMs;
          const previousCumulativeMs = index === 0 ? 0 : responses[index - 1]?.elapsedMs;
          const gapMs =
            cumulativeMs !== null &&
            previousCumulativeMs !== null &&
            previousCumulativeMs !== undefined &&
            cumulativeMs >= previousCumulativeMs
              ? cumulativeMs - previousCumulativeMs
              : null;
          return (
            <button
              key={`${item.sequence}-${index}`}
              type="button"
              className={classNames('pp-message-row', index === selectedIndex && 'is-active')}
              onClick={() => onSelect(index)}
            >
              <span>{item.sequence || index + 1}</span>
              <span>
                <i aria-hidden="true" /> Message {item.sequence || index + 1}
              </span>
              <span className="pp-message-time">
                <span>{timingLabel(cumulativeMs)}</span>
                <small>{gapMs === null ? '+—' : `+${timingLabel(gapMs)}`}</small>
              </span>
            </button>
          );
        })}
        {!filtered.length ? <p className="pp-filter-empty">No messages match the filter.</p> : null}
      </section>
      {selected ? (
        <div className="pp-selected-message">
          <div className="pp-editor-toolbar">
            <span>Message {selected.sequence || selectedIndex + 1}</span>
            <button type="button" onClick={onCopy}>
              <Copy aria-hidden="true" /> Copy JSON
            </button>
          </div>
          <pre>{prettyJson(selected.message)}</pre>
        </div>
      ) : null}
    </div>
  );
}

function ResponsePlaceholder({ children }: { children: ReactNode }) {
  return <div className="pp-response-placeholder">{children}</div>;
}

function MetadataGrid({ title, values }: { title: string; values: MetadataEntry[] }) {
  if (!values.length) return <ResponsePlaceholder>No {title.toLowerCase()}.</ResponsePlaceholder>;
  return (
    <div className="pp-transport-table">
      <h3>{title}</h3>
      <div className="pp-transport-row pp-transport-heading">
        <span>Key</span>
        <span>Value</span>
      </div>
      {values.map((entry, index) => (
        <div
          className="pp-transport-row"
          // biome-ignore lint/suspicious/noArrayIndexKey: duplicate metadata keys are valid and ordered
          key={`${entry.name}-${index}`}
        >
          <code>{entry.name}</code>
          <code>{entry.value}</code>
        </div>
      ))}
    </div>
  );
}

function StatusGrid({ response, latencyMs }: { response: InvokeResponse; latencyMs: number }) {
  const timings = [
    ['Headers observed', response.timings?.headersMs],
    ['First message observed', response.timings?.firstMessageMs],
    ['Final status observed', response.timings?.trailersMs],
    [
      response.finalStatusObserved === false ? 'Handler elapsed' : 'Invoke returned',
      response.timings?.totalMs,
    ],
    [response.finalStatusObserved === false ? 'Console elapsed' : 'Console round trip', latencyMs],
  ] as const;
  const statusLabel =
    response.finalStatusObserved === false
      ? 'Not observed'
      : response.localLimit
        ? 'Not observed (local limit)'
        : response.error
          ? `${response.error.name} (${response.error.code})`
          : 'OK (0)';
  const statusDetails =
    response.finalStatusObserved === false
      ? response.localLimit?.message ||
        response.relayError ||
        'The call has no observed final server status.'
      : response.localLimit
        ? response.localLimit.message
        : response.error?.message || 'RPC completed successfully.';
  return (
    <div className="pp-status-evidence">
      <div className="pp-status-grid">
        <div>
          <span>Code</span>
          <strong
            className={
              response.error || response.localLimit
                ? 'pp-error-text'
                : response.finalStatusObserved === false
                  ? undefined
                  : 'pp-ok-text'
            }
          >
            {statusLabel}
          </strong>
        </div>
        <div>
          <span>Details</span>
          <strong>{statusDetails}</strong>
        </div>
        <div>
          <span>Requests</span>
          <strong>
            {response.requests ? `${response.requests.sent}/${response.requests.total} sent` : '—'}
          </strong>
        </div>
      </div>
      <section className="pp-grpc-timing-grid" aria-label="gRPC timing evidence">
        {timings.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{timingLabel(value)}</strong>
          </div>
        ))}
      </section>
      <p className="pp-grpc-timing-note">
        Callback-observed lifecycle boundaries, cumulative from invoke start. Unary callbacks can
        cluster after transport completion; these are not packet arrival, server processing, or TTFB
        measurements. Handler invoke includes JSON/protobuf conversion and callbacks, but excludes
        the browser and HTTP relay. Console round trip includes that relay and response parsing.
      </p>
    </div>
  );
}

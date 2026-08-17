import { CircleAlert, Clock3, LoaderCircle, Play, Plus, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import type {
  BootstrapMethod,
  InvokeResponse,
  MetadataEntry,
  SchemaResponse,
} from '@/shared/types';
import { classNames, durationLabel, prettyJson } from '@/shared/utils';

type InvokeState = {
  loading: boolean;
  error: string | null;
  result: InvokeResponse | null;
  latencyMs: number;
};

export function CallWorkspace({
  method,
  schema,
  requestText,
  onRequestChange,
  metadata,
  onMetadataChange,
  onAddMetadata,
  onRemoveMetadata,
  timeoutSeconds,
  onTimeoutChange,
  onInvoke,
  invokeState,
}: {
  method: BootstrapMethod;
  schema: SchemaResponse;
  requestText: string;
  onRequestChange: (value: string) => void;
  metadata: MetadataEntry[];
  onMetadataChange: (index: number, value: MetadataEntry) => void;
  onAddMetadata: () => void;
  onRemoveMetadata: (index: number) => void;
  timeoutSeconds: number;
  onTimeoutChange: (value: number) => void;
  onInvoke: () => void;
  invokeState: InvokeState;
}) {
  const [requestTab, setRequestTab] = useState<'request' | 'metadata'>('request');
  const [responseTab, setResponseTab] = useState<'messages' | 'headers' | 'trailers' | 'status'>(
    'messages'
  );
  const response = invokeState.result;
  const lineCount = Math.max(1, requestText.split('\n').length);

  useEffect(() => {
    function invokeFromKeyboard(event: KeyboardEvent) {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      onInvoke();
    }
    window.addEventListener('keydown', invokeFromKeyboard);
    return () => window.removeEventListener('keydown', invokeFromKeyboard);
  }, [onInvoke]);

  return (
    <section className="pp-call-workspace" aria-label={`${method.name} call workspace`}>
      <div className="pp-call-pane pp-request-pane">
        <div className="pp-pane-tabs" role="tablist" aria-label="Request input">
          <button
            type="button"
            role="tab"
            aria-selected={requestTab === 'request'}
            className={classNames('pp-pane-tab', requestTab === 'request' && 'pp-pane-tab-active')}
            onClick={() => setRequestTab('request')}
          >
            Request
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={requestTab === 'metadata'}
            className={classNames('pp-pane-tab', requestTab === 'metadata' && 'pp-pane-tab-active')}
            onClick={() => setRequestTab('metadata')}
          >
            Metadata <span className="pp-count">{metadata.filter((item) => item.name).length}</span>
          </button>
        </div>

        {requestTab === 'request' ? (
          <div className="pp-editor-region">
            <div className="pp-editor-toolbar">
              <span>Message</span>
              <span>JSON</span>
            </div>
            <div className="pp-json-editor">
              <div className="pp-line-numbers" aria-hidden="true">
                {Array.from({ length: lineCount }, (_, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: visual line numbers have no identity beyond position
                    key={index}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>
              <textarea
                aria-label="Request JSON"
                spellCheck={false}
                value={requestText}
                onChange={(event) => onRequestChange(event.target.value)}
              />
            </div>
            <div className="pp-schema-note">
              {schema.requestStream
                ? 'Send a JSON array for this client stream.'
                : schema.requestType}
            </div>
          </div>
        ) : (
          <div className="pp-metadata-editor">
            <div className="pp-editor-toolbar">
              <span>Outgoing metadata</span>
              <button type="button" className="pp-inline-action" onClick={onAddMetadata}>
                <Plus aria-hidden="true" /> Add field
              </button>
            </div>
            <div className="pp-metadata-rows">
              {metadata.map((entry, index) => (
                <div
                  className="pp-metadata-row"
                  // biome-ignore lint/suspicious/noArrayIndexKey: editable metadata entries have no persisted identifier
                  key={`${index}-${entry.name}`}
                >
                  <label>
                    <span className="sr-only">Metadata key {index + 1}</span>
                    <input
                      value={entry.name}
                      onChange={(event) =>
                        onMetadataChange(index, { ...entry, name: event.target.value })
                      }
                      placeholder="authorization"
                    />
                  </label>
                  <label>
                    <span className="sr-only">Metadata value {index + 1}</span>
                    <input
                      value={entry.value}
                      onChange={(event) =>
                        onMetadataChange(index, { ...entry, value: event.target.value })
                      }
                      placeholder="Bearer …"
                    />
                  </label>
                  <button
                    type="button"
                    className="pp-icon-button"
                    aria-label={`Remove metadata field ${index + 1}`}
                    onClick={() => onRemoveMetadata(index)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ))}
              {metadata.length === 0 ? (
                <p className="pp-empty-copy">
                  No outgoing metadata. Add auth, tracing, or routing keys.
                </p>
              ) : null}
            </div>
          </div>
        )}

        <div className="pp-invoke-bar">
          <label>
            <span>Deadline</span>
            <span className="pp-deadline-input">
              <Clock3 aria-hidden="true" />
              <input
                aria-label="Deadline in seconds"
                type="number"
                min={0}
                value={timeoutSeconds}
                onChange={(event) => onTimeoutChange(Number(event.target.value))}
              />
              <span>s</span>
            </span>
          </label>
          <button
            type="button"
            className="pp-invoke-button"
            disabled={invokeState.loading}
            onClick={onInvoke}
          >
            {invokeState.loading ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            Invoke
            <kbd>⌘↵</kbd>
          </button>
        </div>
      </div>

      <div className="pp-call-pane pp-response-pane" aria-live="polite">
        <ResponseSummary state={invokeState} />
        <div className="pp-pane-tabs pp-response-tabs" role="tablist" aria-label="RPC response">
          {(
            [
              ['messages', 'Messages', response?.responses.length ?? 0],
              ['headers', 'Headers', response?.headers.length ?? 0],
              ['trailers', 'Trailers', response?.trailers.length ?? 0],
              ['status', 'Status', null],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={responseTab === key}
              className={classNames('pp-pane-tab', responseTab === key && 'pp-pane-tab-active')}
              onClick={() => setResponseTab(key)}
            >
              {label} {count !== null ? <span className="pp-count">{count}</span> : null}
            </button>
          ))}
        </div>
        <div className="pp-response-content">
          {invokeState.loading ? (
            <ResponsePlaceholder>Waiting for the server…</ResponsePlaceholder>
          ) : null}
          {invokeState.error ? (
            <div className="pp-response-error" role="alert">
              <CircleAlert aria-hidden="true" />
              <div>
                <strong>Invocation failed</strong>
                <p>{invokeState.error}</p>
              </div>
            </div>
          ) : null}
          {!invokeState.loading && !invokeState.error && !response ? (
            <ResponsePlaceholder>
              Invoke this method to inspect messages and transport metadata.
            </ResponsePlaceholder>
          ) : null}
          {response && responseTab === 'messages' ? (
            response.responses.length ? (
              response.responses.map((item, index) => (
                <div
                  className="pp-response-message"
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered streaming messages have no protocol identifier
                  key={index}
                >
                  <div className="pp-editor-toolbar">
                    <span>Message {response.responses.length > 1 ? index + 1 : ''}</span>
                    <span>JSON</span>
                  </div>
                  <pre>{prettyJson(item.message)}</pre>
                </div>
              ))
            ) : (
              <ResponsePlaceholder>No response messages.</ResponsePlaceholder>
            )
          ) : null}
          {response && responseTab === 'headers' ? (
            <MetadataGrid title="Response headers" values={response.headers} />
          ) : null}
          {response && responseTab === 'trailers' ? (
            <MetadataGrid title="Response trailers" values={response.trailers} />
          ) : null}
          {response && responseTab === 'status' ? <StatusGrid response={response} /> : null}
        </div>
      </div>
    </section>
  );
}

function ResponseSummary({ state }: { state: InvokeState }) {
  const response = state.result;
  const failed = Boolean(state.error || response?.error);
  return (
    <div className="pp-response-summary">
      <span className={classNames('pp-status-mark', failed && 'pp-status-mark-error')}>
        {state.loading ? '…' : failed ? 'ERR' : response ? 'OK' : 'READY'}
      </span>
      <span>{state.latencyMs > 0 ? durationLabel(state.latencyMs) : '—'}</span>
      <span>
        {response?.responses.length ?? 0} response{response?.responses.length === 1 ? '' : 's'}
      </span>
      <span className="pp-response-time">{response ? 'Just now' : 'Not invoked'}</span>
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
          // biome-ignore lint/suspicious/noArrayIndexKey: duplicate metadata keys are valid and order is meaningful
          key={`${entry.name}-${index}`}
        >
          <code>{entry.name}</code>
          <code>{entry.value}</code>
        </div>
      ))}
    </div>
  );
}

function StatusGrid({ response }: { response: InvokeResponse }) {
  return (
    <div className="pp-status-grid">
      <div>
        <span>Code</span>
        <strong className={response.error ? 'pp-error-text' : 'pp-ok-text'}>
          {response.error ? `${response.error.name} (${response.error.code})` : 'OK (0)'}
        </strong>
      </div>
      <div>
        <span>Details</span>
        <strong>{response.error?.message || 'RPC completed successfully.'}</strong>
      </div>
      <div>
        <span>Requests</span>
        <strong>
          {response.requests ? `${response.requests.sent}/${response.requests.total} sent` : '—'}
        </strong>
      </div>
    </div>
  );
}

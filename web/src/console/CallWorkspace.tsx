import {
  Braces,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  KeyRound,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Square,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import type {
  BootstrapMethod,
  InvokeResponse,
  MetadataEntry,
  SchemaResponse,
} from '@/shared/types';
import { classNames, durationLabel, prettyJson, safeParseJson } from '@/shared/utils';

type InvokeState = {
  loading: boolean;
  error: string | null;
  result: InvokeResponse | null;
  latencyMs: number;
};

type ResponseTab = 'messages' | 'headers' | 'trailers' | 'status';

function downloadJSON(name: string, value: unknown) {
  const blob = new Blob([prettyJson(value)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function streamMode(method: BootstrapMethod) {
  if (method.clientStreaming && method.serverStreaming) return 'Bidirectional stream';
  if (method.clientStreaming) return 'Client stream';
  if (method.serverStreaming) return 'Server stream';
  return 'Unary';
}

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
  onCancel,
  onSaveRequest,
  onResetRequest,
  invokeState,
}: {
  method: BootstrapMethod;
  schema: SchemaResponse;
  requestText: string;
  onRequestChange: (value: string) => void;
  metadata: MetadataEntry[];
  onMetadataChange: (index: number, value: MetadataEntry) => void;
  onAddMetadata: (entry?: MetadataEntry) => void;
  onRemoveMetadata: (index: number) => void;
  timeoutSeconds: number;
  onTimeoutChange: (value: number) => void;
  onInvoke: () => void;
  onCancel: () => void;
  onSaveRequest: () => void;
  onResetRequest: () => void;
  invokeState: InvokeState;
}) {
  const [requestTab, setRequestTab] = useState<'request' | 'metadata'>('request');
  const [responseTab, setResponseTab] = useState<ResponseTab>('messages');
  const [mobilePane, setMobilePane] = useState<'request' | 'response'>('request');
  const [responseQuery, setResponseQuery] = useState('');
  const [selectedResponse, setSelectedResponse] = useState(0);
  const response = invokeState.result;
  const parsedRequest = useMemo(() => safeParseJson(requestText), [requestText]);
  const lineCount = Math.max(1, requestText.split('\n').length);

  const filteredResponses = useMemo(() => {
    const query = responseQuery.trim().toLowerCase();
    return (response?.responses ?? [])
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !query || prettyJson(item.message).toLowerCase().includes(query));
  }, [response, responseQuery]);

  useEffect(() => {
    if (!response) return;
    setSelectedResponse(0);
  }, [response]);

  useEffect(() => {
    function invokeFromKeyboard(event: KeyboardEvent) {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      if (invokeState.loading) onCancel();
      else onInvoke();
    }
    window.addEventListener('keydown', invokeFromKeyboard);
    return () => window.removeEventListener('keydown', invokeFromKeyboard);
  }, [invokeState.loading, onCancel, onInvoke]);

  const visibleSelectedIndex = filteredResponses.some(({ index }) => index === selectedResponse)
    ? selectedResponse
    : (filteredResponses[0]?.index ?? 0);
  const selected = filteredResponses.length
    ? (response?.responses[visibleSelectedIndex] ?? null)
    : null;
  const mode = streamMode(method);

  return (
    <section className="pp-call-workspace" aria-label={`${method.name} call workspace`}>
      <div className="pp-mobile-workspace-tabs" role="tablist" aria-label="Call workspace pane">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'request'}
          onClick={() => setMobilePane('request')}
        >
          Request
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'response'}
          onClick={() => setMobilePane('response')}
        >
          Response
          {response?.responses.length ? <span>{response.responses.length}</span> : null}
        </button>
      </div>

      <div
        className={classNames(
          'pp-call-pane pp-request-pane',
          mobilePane !== 'request' && 'pp-mobile-pane-hidden'
        )}
      >
        <div className="pp-pane-titlebar">
          <div>
            <strong>{method.name}</strong>
            <span>{mode}</span>
          </div>
          <button type="button" onClick={onSaveRequest}>
            <Save aria-hidden="true" /> Save request
          </button>
        </div>
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
              <span>
                <Braces aria-hidden="true" /> JSON
              </span>
              <div>
                <span className={parsedRequest.error ? 'pp-json-invalid' : 'pp-json-valid'}>
                  {parsedRequest.error ? 'Invalid JSON' : 'Valid JSON'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!parsedRequest.error) onRequestChange(prettyJson(parsedRequest.value));
                  }}
                  disabled={Boolean(parsedRequest.error)}
                >
                  Format
                </button>
                <button type="button" onClick={onResetRequest}>
                  <RotateCcw aria-hidden="true" /> Reset
                </button>
              </div>
            </div>
            <div className="pp-json-editor">
              <div className="pp-line-numbers" aria-hidden="true">
                {Array.from({ length: lineCount }, (_, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: visual line numbers follow source order
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
              {schema.requestStream ? 'Send a JSON array' : schema.requestType}
            </div>
          </div>
        ) : (
          <MetadataEditor
            metadata={metadata}
            onMetadataChange={onMetadataChange}
            onAddMetadata={onAddMetadata}
            onRemoveMetadata={onRemoveMetadata}
          />
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
                max={86400}
                value={timeoutSeconds}
                onChange={(event) => onTimeoutChange(Number(event.target.value))}
              />
              <span>s</span>
            </span>
          </label>
          <button
            type="button"
            className={classNames('pp-invoke-button', invokeState.loading && 'pp-cancel-button')}
            disabled={!invokeState.loading && Boolean(parsedRequest.error)}
            onClick={invokeState.loading ? onCancel : onInvoke}
          >
            {invokeState.loading ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
            {invokeState.loading ? 'Cancel' : 'Invoke'}
            <kbd>⌘↵</kbd>
          </button>
        </div>
      </div>

      <div
        className={classNames(
          'pp-call-pane pp-response-pane',
          mobilePane !== 'response' && 'pp-mobile-pane-hidden'
        )}
        aria-live="polite"
      >
        <div className="pp-response-summary">
          <span
            className={classNames(
              'pp-status-mark',
              (invokeState.error || response?.error) && 'pp-status-mark-error',
              invokeState.loading && 'pp-status-mark-running'
            )}
          >
            {invokeState.loading
              ? method.serverStreaming || method.clientStreaming
                ? 'STREAMING'
                : 'IN FLIGHT'
              : invokeState.error || response?.error
                ? 'ERROR'
                : response
                  ? 'OK'
                  : 'READY'}
          </span>
          <span>{invokeState.latencyMs > 0 ? durationLabel(invokeState.latencyMs) : '—'}</span>
          <span>{response?.responses.length ?? 0} messages</span>
          <label className="pp-response-filter">
            <Search aria-hidden="true" />
            <input
              value={responseQuery}
              onChange={(event) => setResponseQuery(event.target.value)}
              placeholder="Filter responses"
              aria-label="Filter responses"
            />
          </label>
          <button
            type="button"
            className="pp-response-action"
            aria-label="Copy response JSON"
            disabled={!response}
            onClick={() => void navigator.clipboard.writeText(prettyJson(response))}
          >
            <Copy aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pp-response-action"
            aria-label="Export response JSON"
            disabled={!response}
            onClick={() => downloadJSON(`${method.name}-response.json`, response)}
          >
            <Download aria-hidden="true" />
          </button>
        </div>

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
            <ResponsePlaceholder>
              <LoaderCircle className="pp-response-spinner" aria-hidden="true" />
              Waiting for {mode.toLowerCase()}… Use Cancel to stop the RPC.
            </ResponsePlaceholder>
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
            <ResponsePlaceholder>Invoke this method to inspect gRPC evidence.</ResponsePlaceholder>
          ) : null}
          {response && responseTab === 'messages' ? (
            <ResponseMessages
              responses={response.responses}
              filtered={filteredResponses}
              selectedIndex={visibleSelectedIndex}
              selected={selected}
              totalLatencyMs={invokeState.latencyMs}
              onSelect={setSelectedResponse}
            />
          ) : null}
          {response && responseTab === 'headers' ? (
            <MetadataGrid title="Response headers" values={response.headers} />
          ) : null}
          {response && responseTab === 'trailers' ? (
            <MetadataGrid title="Response trailers" values={response.trailers} />
          ) : null}
          {response && responseTab === 'status' ? (
            <StatusGrid response={response} latencyMs={invokeState.latencyMs} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function MetadataEditor({
  metadata,
  onMetadataChange,
  onAddMetadata,
  onRemoveMetadata,
}: {
  metadata: MetadataEntry[];
  onMetadataChange: (index: number, value: MetadataEntry) => void;
  onAddMetadata: (entry?: MetadataEntry) => void;
  onRemoveMetadata: (index: number) => void;
}) {
  function addBearer() {
    const existing = metadata.findIndex((entry) => entry.name.toLowerCase() === 'authorization');
    if (existing >= 0) return;
    onAddMetadata({ name: 'authorization', value: 'Bearer ' });
  }

  return (
    <div className="pp-metadata-editor">
      <div className="pp-editor-toolbar">
        <span>Outgoing metadata</span>
        <div>
          <button type="button" onClick={addBearer}>
            <KeyRound aria-hidden="true" /> Bearer auth
          </button>
          <button type="button" onClick={() => onAddMetadata()}>
            <Plus aria-hidden="true" /> Add field
          </button>
        </div>
      </div>
      <div className="pp-metadata-rows">
        {metadata.map((entry, index) => (
          <div
            className="pp-metadata-row"
            // biome-ignore lint/suspicious/noArrayIndexKey: editable metadata entries have positional identity
            key={index}
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
          <p className="pp-empty-copy">No metadata. Add auth, tracing, or routing keys.</p>
        ) : null}
        <p className="pp-secret-note">
          Metadata stays in memory unless you explicitly save this request or workspace.
        </p>
      </div>
    </div>
  );
}

function ResponseMessages({
  responses,
  filtered,
  selectedIndex,
  selected,
  totalLatencyMs,
  onSelect,
}: {
  responses: InvokeResponse['responses'];
  filtered: Array<{ item: InvokeResponse['responses'][number]; index: number }>;
  selectedIndex: number;
  selected: InvokeResponse['responses'][number] | null;
  totalLatencyMs: number;
  onSelect: (index: number) => void;
}) {
  if (!responses.length) return <ResponsePlaceholder>No response messages.</ResponsePlaceholder>;

  return (
    <div className="pp-response-messages">
      <section className="pp-message-timeline" aria-label="Response message timeline">
        <div className="pp-message-row pp-message-heading">
          <span>#</span>
          <span>Message</span>
          <span>Time</span>
        </div>
        {filtered.map(({ item, index }) => {
          const elapsed = item.elapsedMs || (totalLatencyMs / responses.length) * (index + 1);
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
              <span>{durationLabel(elapsed)}</span>
            </button>
          );
        })}
        {!filtered.length ? <p className="pp-filter-empty">No messages match the filter.</p> : null}
      </section>
      {selected ? (
        <div className="pp-selected-message">
          <div className="pp-editor-toolbar">
            <span>Message {selected.sequence || selectedIndex + 1}</span>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(prettyJson(selected.message))}
            >
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
        <span>Elapsed</span>
        <strong>{durationLabel(latencyMs)}</strong>
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

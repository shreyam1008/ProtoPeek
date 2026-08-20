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
import {
  classNames,
  durationLabel,
  modifierKeyLabel,
  prettyJson,
  safeParseJson,
  sanitizeInvokeResponseForExport,
} from '@/shared/utils';

import { AccessibleTabs, TabPanel } from './AccessibleTabs';

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

function timingLabel(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? durationLabel(value)
    : '—';
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
  const modifier = modifierKeyLabel();

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
  const responseStatus = invokeState.loading
    ? method.serverStreaming || method.clientStreaming
      ? 'STREAMING'
      : 'IN FLIGHT'
    : response?.localLimit
      ? 'LOCAL LIMIT'
      : invokeState.error || response?.error
        ? 'ERROR'
        : response
          ? 'OK'
          : 'READY';
  const responseTabs = (
    [
      ['messages', 'Messages', response?.responses.length ?? 0],
      ['headers', 'Headers', response?.headers.length ?? 0],
      ['trailers', 'Trailers', response?.trailers.length ?? 0],
      ['status', 'Status', null],
    ] as const
  ).map(([value, label, count]) => ({
    value,
    label: (
      <>
        {label} {count !== null ? <span className="pp-count">{count}</span> : null}
      </>
    ),
  }));

  function renderResponseTab(tab: ResponseTab) {
    if (invokeState.loading) {
      return (
        <ResponsePlaceholder>
          <LoaderCircle className="pp-response-spinner" aria-hidden="true" />
          Waiting for {mode.toLowerCase()}… Use Cancel to stop the RPC.
        </ResponsePlaceholder>
      );
    }
    if (invokeState.error) {
      return (
        <div className="pp-response-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>Invocation failed</strong>
            <p>{invokeState.error}</p>
          </div>
        </div>
      );
    }
    if (!response) {
      return (
        <ResponsePlaceholder>Invoke this method to inspect gRPC evidence.</ResponsePlaceholder>
      );
    }
    switch (tab) {
      case 'messages':
        return (
          <ResponseMessages
            responses={response.responses}
            filtered={filteredResponses}
            selectedIndex={visibleSelectedIndex}
            selected={selected}
            onSelect={setSelectedResponse}
          />
        );
      case 'headers':
        return <MetadataGrid title="Response headers" values={response.headers} />;
      case 'trailers':
        return <MetadataGrid title="Response trailers" values={response.trailers} />;
      case 'status':
        return <StatusGrid response={response} latencyMs={invokeState.latencyMs} />;
    }
  }

  return (
    <section className="pp-call-workspace" aria-label={`${method.name} call workspace`}>
      <AccessibleTabs
        id="grpc-mobile-pane"
        label="Call workspace pane"
        tabs={[
          { value: 'request' as const, label: 'Request' },
          {
            value: 'response' as const,
            label: (
              <>
                Response
                {response?.responses.length ? <span>{response.responses.length}</span> : null}
              </>
            ),
          },
        ]}
        value={mobilePane}
        onChange={setMobilePane}
        className="pp-mobile-workspace-tabs"
      />

      <div
        className={classNames(
          'pp-call-pane pp-request-pane',
          mobilePane !== 'request' && 'pp-mobile-pane-hidden'
        )}
        id="grpc-mobile-pane-panel-request"
        role="tabpanel"
        aria-labelledby="grpc-mobile-pane-tab-request"
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
        <AccessibleTabs
          id="grpc-request"
          label="Request input"
          tabs={[
            { value: 'request' as const, label: 'Request' },
            {
              value: 'metadata' as const,
              label: (
                <>
                  Metadata{' '}
                  <span className="pp-count">{metadata.filter((item) => item.name).length}</span>
                </>
              ),
            },
          ]}
          value={requestTab}
          onChange={setRequestTab}
        />

        <TabPanel
          id="grpc-request"
          tab="request"
          className="pp-editor-region"
          active={requestTab === 'request'}
        >
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
                Reset
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
        </TabPanel>
        <TabPanel
          id="grpc-request"
          tab="metadata"
          className="pp-metadata-editor"
          active={requestTab === 'metadata'}
        >
          <MetadataEditor
            metadata={metadata}
            onMetadataChange={onMetadataChange}
            onAddMetadata={onAddMetadata}
            onRemoveMetadata={onRemoveMetadata}
          />
        </TabPanel>

        <div className="pp-invoke-bar">
          <label>
            <span>Deadline</span>
            <span className="pp-deadline-input">
              <Clock3 aria-hidden="true" />
              <input
                aria-label="Deadline in seconds"
                title="Omitted or larger deadlines use ProtoPeek's 60-second local safety wall."
                type="number"
                min={0}
                max={60}
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
            <kbd>{modifier}↵</kbd>
          </button>
        </div>
      </div>

      <div
        className={classNames(
          'pp-call-pane pp-response-pane',
          mobilePane !== 'response' && 'pp-mobile-pane-hidden'
        )}
        id="grpc-mobile-pane-panel-response"
        role="tabpanel"
        aria-labelledby="grpc-mobile-pane-tab-response"
      >
        <div className="pp-response-summary">
          <span
            className={classNames(
              'pp-status-mark',
              (invokeState.error || response?.error || response?.localLimit) &&
                'pp-status-mark-error',
              invokeState.loading && 'pp-status-mark-running'
            )}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={`RPC status ${responseStatus}`}
          >
            {responseStatus}
          </span>
          <span title="ProtoPeek handler invoke duration; includes conversion and callbacks, but excludes the browser and HTTP relay">
            Handler {timingLabel(response?.timings?.totalMs)}
          </span>
          <span title="Browser request through the ProtoPeek console relay">
            Console {response ? timingLabel(invokeState.latencyMs) : '—'}
          </span>
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
            onClick={() =>
              response &&
              void navigator.clipboard.writeText(
                prettyJson(sanitizeInvokeResponseForExport(response))
              )
            }
          >
            <Copy aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pp-response-action"
            aria-label="Export response JSON"
            disabled={!response}
            onClick={() =>
              response &&
              downloadJSON(
                `${method.name}-response.json`,
                sanitizeInvokeResponseForExport(response)
              )
            }
          >
            <Download aria-hidden="true" />
          </button>
        </div>

        {response?.localLimit ? (
          <div className="pp-response-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <div>
              <strong>Partial response evidence</strong>
              <p>{response.localLimit.message}</p>
            </div>
          </div>
        ) : null}

        <AccessibleTabs
          id="grpc-response"
          label="RPC response"
          tabs={responseTabs}
          value={responseTab}
          onChange={setResponseTab}
          className="pp-response-tabs"
        />

        {(['messages', 'headers', 'trailers', 'status'] as const).map((tab) => (
          <TabPanel
            key={tab}
            id="grpc-response"
            tab={tab}
            className="pp-response-content"
            active={responseTab === tab}
          >
            {responseTab === tab ? renderResponseTab(tab) : null}
          </TabPanel>
        ))}
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
          Sensitive metadata stays live here but is redacted from saved requests, history, and
          exports.
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
  onSelect,
}: {
  responses: InvokeResponse['responses'];
  filtered: Array<{ item: InvokeResponse['responses'][number]; index: number }>;
  selectedIndex: number;
  selected: InvokeResponse['responses'][number] | null;
  onSelect: (index: number) => void;
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
  const timings = [
    ['Headers observed', response.timings?.headersMs],
    ['First message observed', response.timings?.firstMessageMs],
    ['Final status observed', response.timings?.trailersMs],
    ['Invoke returned', response.timings?.totalMs],
    ['Console round trip', latencyMs],
  ] as const;
  const statusLabel = response.localLimit
    ? 'Not observed (local limit)'
    : response.error
      ? `${response.error.name} (${response.error.code})`
      : 'OK (0)';
  const statusDetails = response.localLimit
    ? response.localLimit.message
    : response.error?.message || 'RPC completed successfully.';
  return (
    <div className="pp-status-evidence">
      <div className="pp-status-grid">
        <div>
          <span>Code</span>
          <strong
            className={response.error || response.localLimit ? 'pp-error-text' : 'pp-ok-text'}
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

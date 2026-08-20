import { useMutation } from '@tanstack/react-query';
import { Clock3, History, KeyRound, LockKeyhole, Play, Plus, Square, X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type {
  HTTPHistoryEntry,
  HTTPRequestInput,
  HTTPResponse,
  MetadataEntry,
} from '@/shared/types';
import {
  appStorageKeys,
  classNames,
  compactDate,
  loadStoredValue,
  modifierKeyLabel,
  redactedValue,
  removeStoredValue,
  sanitizeMetadataForPersistence,
  sanitizeURLForPersistence,
  storeValue,
  toHTTPHistoryEntry,
} from '@/shared/utils';

import { AccessibleTabs, TabPanel } from './AccessibleTabs';
import { sendHTTPRequest } from './api';
import { HTTPResponsePanel } from './HTTPResponsePanel';
import { protocolShellEvents } from './ProtocolShellContext';

type RequestTab = 'params' | 'headers' | 'auth' | 'body';
type BodyMode = 'none' | 'json' | 'text';
type AuthMode = 'none' | 'bearer' | 'basic' | 'api-key';

const requestTabs: Array<{ value: RequestTab; label: string }> = [
  { value: 'params', label: 'Params' },
  { value: 'headers', label: 'Headers' },
  { value: 'auth', label: 'Auth' },
  { value: 'body', label: 'Body' },
];

const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function HTTPWorkbench() {
  const [method, setMethod] = useState('GET');
  const [url, setURL] = useState(() => {
    const pendingURL = loadStoredValue<string>(appStorageKeys.pendingHTTPURL, '');
    if (pendingURL) removeStoredValue(appStorageKeys.pendingHTTPURL);
    return pendingURL || 'http://localhost:8080/';
  });
  const [params, setParams] = useState<MetadataEntry[]>([]);
  const [headers, setHeaders] = useState<MetadataEntry[]>([]);
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [authName, setAuthName] = useState('X-API-Key');
  const [authUser, setAuthUser] = useState('');
  const [authSecret, setAuthSecret] = useState('');
  const [bodyMode, setBodyMode] = useState<BodyMode>('none');
  const [body, setBody] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(30);
  const [followRedirects, setFollowRedirects] = useState(false);
  const [requestTab, setRequestTab] = useState<RequestTab>('params');
  const [mobilePane, setMobilePane] = useState<'request' | 'response'>('request');
  const [response, setResponse] = useState<HTTPResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [history, setHistory] = useState<HTTPHistoryEntry[]>(() =>
    loadStoredValue<HTTPHistoryEntry[]>(appStorageKeys.httpHistory, []).map((entry) => ({
      ...entry,
      url: sanitizeURLForPersistence(entry.url),
      requestHeaders: sanitizeMetadataForPersistence(entry.requestHeaders ?? []),
    }))
  );
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<HTMLDetailsElement | null>(null);
  const modifier = modifierKeyLabel();
  const mutation = useMutation<
    HTTPResponse,
    Error,
    { input: HTTPRequestInput; signal: AbortSignal }
  >({
    mutationFn: ({ input, signal }) => sendHTTPRequest(input, signal),
  });

  useEffect(() => {
    storeValue(appStorageKeys.httpHistory, history);
  }, [history]);

  useEffect(() => {
    function handleDiscovery(event: Event) {
      const nextURL = (event as CustomEvent<string>).detail;
      if (!nextURL) return;
      removeStoredValue(appStorageKeys.pendingHTTPURL);
      setURL(nextURL);
    }
    window.addEventListener(protocolShellEvents.openHTTPDiscovery, handleDiscovery);
    return () => window.removeEventListener(protocolShellEvents.openHTTPDiscovery, handleDiscovery);
  }, []);

  function buildURL() {
    const parsed = new URL(url.trim());
    for (const param of params) {
      const name = param.name.trim();
      if (name) parsed.searchParams.append(name, param.value);
    }
    return parsed.toString();
  }

  function buildHeaders() {
    const result = headers.filter((header) => header.name.trim()).map((header) => ({ ...header }));
    if (authMode === 'bearer' && authSecret) {
      result.push({ name: 'Authorization', value: `Bearer ${authSecret}` });
    } else if (authMode === 'basic' && (authUser || authSecret)) {
      result.push({
        name: 'Authorization',
        value: `Basic ${encodeBasicAuth(authUser, authSecret)}`,
      });
    } else if (authMode === 'api-key' && authName.trim() && authSecret) {
      result.push({ name: authName.trim(), value: authSecret });
    }
    if (
      bodyMode !== 'none' &&
      !result.some((header) => header.name.toLowerCase() === 'content-type')
    ) {
      result.push({
        name: 'Content-Type',
        value: bodyMode === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
      });
    }
    return result;
  }

  async function handleSend() {
    if (mutation.isPending) return;
    setValidationError(null);
    mutation.reset();
    let requestURL: string;
    try {
      requestURL = buildURL();
    } catch {
      setValidationError('Enter an absolute http:// or https:// URL.');
      return;
    }
    const requestHeaders = buildHeaders();
    const input: HTTPRequestInput = {
      method,
      url: requestURL,
      headers: requestHeaders,
      body: bodyMode === 'none' ? '' : body,
      timeoutMs: Math.round(timeoutSeconds * 1000),
      followRedirects,
    };
    const controller = new AbortController();
    abortRef.current = controller;
    setResponse(null);
    setMobilePane('response');
    try {
      const result = await mutation.mutateAsync({ input, signal: controller.signal });
      setResponse(result);
      setHistory((entries) =>
        [
          toHTTPHistoryEntry({
            method,
            url: requestURL,
            requestHeaders,
            status: result.status,
            statusCode: result.statusCode,
            totalMs: result.timings.totalMs,
          }),
          ...entries,
        ].slice(0, 50)
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setValidationError('HTTP request cancelled.');
      } else if (!(error instanceof Error)) {
        setValidationError('HTTP request failed.');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const sendFromShortcut = useEffectEvent(() => {
    if (mutation.isPending) abortRef.current?.abort();
    else void handleSend();
  });

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      sendFromShortcut();
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const requestError =
    validationError ??
    (mutation.error ? mutation.error.message.trim() || 'HTTP request failed.' : null);

  function loadHistory(entry: HTTPHistoryEntry) {
    setMethod(entry.method);
    setURL(entry.url);
    setParams([]);
    setHeaders(entry.requestHeaders.filter((header) => header.value !== redactedValue));
    setAuthMode('none');
    setAuthSecret('');
    setMobilePane('request');
    if (historyRef.current) historyRef.current.open = false;
  }

  return (
    <div className="pp-http-workbench">
      <header className="pp-http-header">
        <div>
          <i className="pp-http-glyph" aria-hidden="true">
            H
          </i>
          <span>HTTP / REST</span>
          <strong>Request workbench</strong>
        </div>
        <span className="pp-connection-fact">
          <LockKeyhole aria-hidden="true" /> Local relay
        </span>
        <details ref={historyRef} className="pp-http-history">
          <summary>
            <History aria-hidden="true" /> History <span>{history.length}</span>
          </summary>
          <div>
            <header>
              <strong>Secret-safe local history</strong>
              {history.length ? (
                <button type="button" onClick={() => setHistory([])}>
                  Clear
                </button>
              ) : null}
            </header>
            {history.length ? (
              history.slice(0, 12).map((entry) => (
                <button key={entry.id} type="button" onClick={() => loadHistory(entry)}>
                  <span>{entry.method}</span>
                  <strong>{entry.status || 'Failed'}</strong>
                  <code>{entry.url}</code>
                  <small>{compactDate(entry.createdAt)}</small>
                </button>
              ))
            ) : (
              <p>Send a request to build local history. Auth values are never retained.</p>
            )}
          </div>
        </details>
      </header>

      <div className="pp-http-request-line">
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          aria-label="HTTP method"
        >
          {httpMethods.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
        <input
          value={url}
          onChange={(event) => setURL(event.target.value)}
          aria-label="Request URL"
          spellCheck={false}
          placeholder="https://api.example.test/v1/items"
        />
        <button
          type="button"
          className={classNames('pp-http-send', mutation.isPending && 'is-cancel')}
          onClick={mutation.isPending ? () => abortRef.current?.abort() : () => void handleSend()}
        >
          {mutation.isPending ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
          {mutation.isPending ? 'Cancel' : 'Send'}
          <kbd>{modifier} ↵</kbd>
        </button>
      </div>

      <AccessibleTabs
        id="http-mobile-pane"
        label="HTTP workbench pane"
        tabs={[
          { value: 'request' as const, label: 'Request' },
          {
            value: 'response' as const,
            label: response ? `Response ${response.statusCode}` : 'Response',
          },
        ]}
        value={mobilePane}
        onChange={setMobilePane}
        className="pp-http-mobile-tabs"
      />

      <div className="pp-http-workspace">
        <section
          id="http-mobile-pane-panel-request"
          role="tabpanel"
          aria-labelledby="http-mobile-pane-tab-request"
          className={classNames(
            'pp-http-request-editor',
            mobilePane !== 'request' && 'pp-mobile-pane-hidden'
          )}
        >
          <div className="pp-http-request-settings">
            <label>
              <Clock3 aria-hidden="true" /> Timeout
              <input
                type="number"
                min={0.1}
                max={120}
                step={0.1}
                value={timeoutSeconds}
                onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
              />
              s
            </label>
            <label>
              <input
                type="checkbox"
                checked={followRedirects}
                onChange={(event) => setFollowRedirects(event.target.checked)}
              />
              Follow redirects
            </label>
            <span>TLS verification on</span>
          </div>
          <AccessibleTabs
            id="http-request"
            label="HTTP request settings"
            tabs={requestTabs}
            value={requestTab}
            onChange={setRequestTab}
            className="pp-http-request-tabs"
          />
          <div className="pp-http-request-content">
            <TabPanel id="http-request" tab="params" active={requestTab === 'params'}>
              <KeyValueEditor
                label="Query parameters"
                entries={params}
                namePlaceholder="page"
                valuePlaceholder="1"
                onChange={setParams}
              />
            </TabPanel>
            <TabPanel id="http-request" tab="headers" active={requestTab === 'headers'}>
              <KeyValueEditor
                label="Request headers"
                entries={headers}
                namePlaceholder="Accept"
                valuePlaceholder="application/json"
                onChange={setHeaders}
              />
            </TabPanel>
            <TabPanel
              id="http-request"
              tab="auth"
              className="pp-http-auth-panel"
              active={requestTab === 'auth'}
            >
              <label>
                <span>Auth type</span>
                <select
                  value={authMode}
                  onChange={(event) => setAuthMode(event.target.value as AuthMode)}
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="basic">Basic auth</option>
                  <option value="api-key">API key header</option>
                </select>
              </label>
              {authMode === 'basic' ? (
                <label>
                  <span>Username</span>
                  <input value={authUser} onChange={(event) => setAuthUser(event.target.value)} />
                </label>
              ) : null}
              {authMode === 'api-key' ? (
                <label>
                  <span>Header name</span>
                  <input value={authName} onChange={(event) => setAuthName(event.target.value)} />
                </label>
              ) : null}
              {authMode !== 'none' ? (
                <label>
                  <span>
                    {authMode === 'basic' ? 'Password' : authMode === 'bearer' ? 'Token' : 'Value'}
                  </span>
                  <input
                    type="password"
                    value={authSecret}
                    autoComplete="off"
                    onChange={(event) => setAuthSecret(event.target.value)}
                  />
                </label>
              ) : (
                <p>No authorization header will be added.</p>
              )}
              <p className="pp-http-secret-note">
                <KeyRound aria-hidden="true" /> Auth remains in this live editor and is redacted
                from history and exports.
              </p>
            </TabPanel>
            <TabPanel
              id="http-request"
              tab="body"
              className="pp-http-body-editor"
              active={requestTab === 'body'}
            >
              <div>
                <label>
                  Body type
                  <select
                    value={bodyMode}
                    onChange={(event) => setBodyMode(event.target.value as BodyMode)}
                  >
                    <option value="none">None</option>
                    <option value="json">JSON</option>
                    <option value="text">Text</option>
                  </select>
                </label>
                <span>
                  {new TextEncoder()
                    .encode(bodyMode === 'none' ? '' : body)
                    .length.toLocaleString()}{' '}
                  bytes
                </span>
              </div>
              <textarea
                value={body}
                disabled={bodyMode === 'none'}
                onChange={(event) => setBody(event.target.value)}
                spellCheck={false}
                aria-label="HTTP request body"
                placeholder={bodyMode === 'json' ? '{\n  "name": "ProtoPeek"\n}' : 'Request body'}
              />
            </TabPanel>
          </div>
        </section>
        <div
          id="http-mobile-pane-panel-response"
          role="tabpanel"
          aria-labelledby="http-mobile-pane-tab-response"
          className={classNames(mobilePane !== 'response' && 'pp-mobile-pane-hidden')}
        >
          <HTTPResponsePanel
            response={response}
            loading={mutation.isPending}
            error={requestError}
          />
        </div>
      </div>
    </div>
  );
}

function KeyValueEditor({
  label,
  entries,
  namePlaceholder,
  valuePlaceholder,
  onChange,
}: {
  label: string;
  entries: MetadataEntry[];
  namePlaceholder: string;
  valuePlaceholder: string;
  onChange: (entries: MetadataEntry[]) => void;
}) {
  return (
    <div className="pp-http-key-values">
      <header>
        <strong>{label}</strong>
        <button type="button" onClick={() => onChange([...entries, { name: '', value: '' }])}>
          <Plus aria-hidden="true" /> Add
        </button>
      </header>
      {entries.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: editable key/value rows have positional identity and are never reordered
        <div key={`http-kv-${index}`}>
          <input
            value={entry.name}
            aria-label={`${label} name ${index + 1}`}
            placeholder={namePlaceholder}
            onChange={(event) =>
              onChange(
                entries.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, name: event.target.value } : item
                )
              )
            }
          />
          <input
            value={entry.value}
            aria-label={`${label} value ${index + 1}`}
            placeholder={valuePlaceholder}
            onChange={(event) =>
              onChange(
                entries.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, value: event.target.value } : item
                )
              )
            }
          />
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()} row ${index + 1}`}
            onClick={() => onChange(entries.filter((_, itemIndex) => itemIndex !== index))}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ))}
      {!entries.length ? <p>No fields. Add one when this request needs it.</p> : null}
    </div>
  );
}

function encodeBasicAuth(username: string, password: string) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

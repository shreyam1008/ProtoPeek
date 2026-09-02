import {
  ChevronDown,
  Clock3,
  Copy,
  FileJson2,
  History,
  KeyRound,
  LockKeyhole,
  Play,
  Plus,
  Square,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react';

import type { HTTPHistoryEntry, HTTPResponse, MetadataEntry } from '@/shared/types';
import {
  appStorageKeys,
  classNames,
  compactDate,
  filterMetadataForInvoke,
  isRedactedValue,
  loadStoredValue,
  modifierKeyLabel,
  normalizeHTTPHistory,
  prepareMetadataForReplay,
  prepareURLForReplay,
  removeStoredValue,
  storeValue,
  toHTTPHistoryEntry,
} from '@/shared/utils';

import { AccessibleTabs, TabPanel } from './AccessibleTabs';
import { sendHTTPRequest } from './api';
import { HTTPResponsePanel } from './HTTPResponsePanel';
import { buildCurlCommand } from './http-curl';
import {
  formatJSONDraft,
  normalizeHTTPDraftURL,
  prepareHTTPRequestDraft,
} from './http-request-draft';
import type { OpenAPICollection, OpenAPIOperation } from './openapi';
import { protocolShellEvents } from './ProtocolShellContext';

const OpenAPIImportPanel = lazy(() =>
  import('./OpenAPIWorkbenchAddons').then((module) => ({ default: module.OpenAPIImportPanel }))
);
const OpenAPIOperationRail = lazy(() =>
  import('./OpenAPIWorkbenchAddons').then((module) => ({ default: module.OpenAPIOperationRail }))
);

type RequestTab = 'params' | 'headers' | 'auth' | 'body';
type BodyMode = 'none' | 'json' | 'text';
type AuthMode = 'none' | 'bearer' | 'basic' | 'api-key';
type CurlCopyNotice = { kind: 'success' | 'error'; message: string };

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
  const [requestPending, setRequestPending] = useState(false);
  const [requestFailure, setRequestFailure] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [historyStorageError, setHistoryStorageError] = useState<string | null>(null);
  const [curlCopyNotice, setCurlCopyNotice] = useState<CurlCopyNotice | null>(null);
  const [openAPIImportOpen, setOpenAPIImportOpen] = useState(false);
  const [openAPIImportURL, setOpenAPIImportURL] = useState('');
  const [openAPIImportError, setOpenAPIImportError] = useState<string | null>(null);
  const [openAPIImporting, setOpenAPIImporting] = useState(false);
  const [openAPICollection, setOpenAPICollection] = useState<OpenAPICollection | null>(null);
  const [selectedOpenAPIOperation, setSelectedOpenAPIOperation] = useState<string | null>(null);
  const [openAPIRailVisible, setOpenAPIRailVisible] = useState(false);
  const [history, setHistory] = useState<HTTPHistoryEntry[]>(() =>
    normalizeHTTPHistory(loadStoredValue<unknown>(appStorageKeys.httpHistory, []))
  );
  const abortRef = useRef<AbortController | null>(null);
  const openAPIAbortRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const curlCopyGenerationRef = useRef(0);
  const historyRef = useRef<HTMLDetailsElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const modifier = modifierKeyLabel();

  function resetRequest(nextURL = 'http://localhost:8080/') {
    requestGenerationRef.current++;
    curlCopyGenerationRef.current++;
    const active = abortRef.current;
    abortRef.current = null;
    active?.abort();
    setRequestPending(false);
    setRequestFailure(null);
    setMethod('GET');
    setURL(nextURL);
    setParams([]);
    setHeaders([]);
    setAuthMode('none');
    setAuthName('X-API-Key');
    setAuthUser('');
    setAuthSecret('');
    setBodyMode('none');
    setBody('');
    setTimeoutSeconds(30);
    setFollowRedirects(false);
    setResponse(null);
    setValidationError(null);
    setHistoryNotice(null);
    setCurlCopyNotice(null);
    setRequestTab('params');
    setMobilePane('request');
    if (historyRef.current) historyRef.current.open = false;
    requestAnimationFrame(() => urlInputRef.current?.focus());
  }

  function applyOpenAPIOperation(operation: OpenAPIOperation) {
    requestGenerationRef.current++;
    curlCopyGenerationRef.current++;
    const active = abortRef.current;
    abortRef.current = null;
    active?.abort();
    setRequestPending(false);
    setRequestFailure(null);
    setMethod(operation.method);
    setURL(operation.url);
    setParams(operation.query.map((entry) => ({ ...entry })));
    setHeaders(operation.headers.map((entry) => ({ ...entry })));
    setAuthMode('none');
    setAuthName('X-API-Key');
    setAuthUser('');
    setAuthSecret('');
    setBodyMode(operation.body === null ? 'none' : 'json');
    setBody(operation.body ?? '');
    setResponse(null);
    setValidationError(null);
    setHistoryNotice(null);
    setCurlCopyNotice(null);
    setRequestTab(operation.body === null ? 'params' : 'body');
    setMobilePane('request');
    setSelectedOpenAPIOperation(operation.id);
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1180px)').matches
    ) {
      setOpenAPIRailVisible(false);
    }
  }

  function acceptOpenAPICollection(collection: OpenAPICollection) {
    setOpenAPICollection(collection);
    setOpenAPIRailVisible(true);
    setOpenAPIImportOpen(false);
    setOpenAPIImportError(null);
    applyOpenAPIOperation(collection.operations[0]);
  }

  async function importOpenAPIURL() {
    const target = openAPIImportURL.trim();
    if (!target) {
      setOpenAPIImportError('Enter a Swagger, Scalar, or OpenAPI definition URL.');
      return;
    }
    openAPIAbortRef.current?.abort();
    const controller = new AbortController();
    openAPIAbortRef.current = controller;
    setOpenAPIImporting(true);
    setOpenAPIImportError(null);
    try {
      const { importOpenAPIFromURL } = await import('./openapi-import');
      acceptOpenAPICollection(await importOpenAPIFromURL(target, controller.signal));
    } catch (error) {
      if (!controller.signal.aborted) {
        setOpenAPIImportError(
          error instanceof Error ? error.message : 'Could not import the API definition.'
        );
      }
    } finally {
      if (openAPIAbortRef.current === controller) openAPIAbortRef.current = null;
      setOpenAPIImporting(false);
    }
  }

  async function importOpenAPIFile(file?: File) {
    if (!file) return;
    setOpenAPIImporting(true);
    setOpenAPIImportError(null);
    try {
      const { importOpenAPIFromFile } = await import('./openapi-import');
      acceptOpenAPICollection(await importOpenAPIFromFile(file));
    } catch (error) {
      setOpenAPIImportError(
        error instanceof Error ? error.message : 'Could not import the API definition.'
      );
    } finally {
      setOpenAPIImporting(false);
    }
  }

  const applyDiscoveryURL = useEffectEvent((nextURL: string) => {
    try {
      const parsed = new URL(nextURL);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    } catch {
      return;
    }
    removeStoredValue(appStorageKeys.pendingHTTPURL);
    resetRequest(nextURL);
  });

  useEffect(() => {
    const stored = storeValue(appStorageKeys.httpHistory, history);
    if (!stored.ok) {
      setHistoryStorageError(
        `HTTP history is session-only because browser storage failed: ${stored.error}`
      );
    } else {
      setHistoryStorageError(null);
    }
  }, [history]);

  useEffect(
    () => () => {
      requestGenerationRef.current++;
      curlCopyGenerationRef.current++;
      const active = abortRef.current;
      abortRef.current = null;
      active?.abort();
      openAPIAbortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!openAPIImportOpen) return;
    function closeImport(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenAPIImportOpen(false);
    }
    window.addEventListener('keydown', closeImport);
    return () => window.removeEventListener('keydown', closeImport);
  }, [openAPIImportOpen]);

  useEffect(() => {
    function handleDiscovery(event: Event) {
      const nextURL = (event as CustomEvent<string>).detail;
      if (!nextURL) return;
      applyDiscoveryURL(nextURL);
    }
    window.addEventListener(protocolShellEvents.openHTTPDiscovery, handleDiscovery);
    return () => window.removeEventListener(protocolShellEvents.openHTTPDiscovery, handleDiscovery);
  }, []);

  function invalidateCurlCopy() {
    curlCopyGenerationRef.current++;
    setCurlCopyNotice(null);
  }

  function buildURL() {
    const normalized = normalizeHTTPDraftURL(url);
    if (!normalized.ok) throw new Error(normalized.error);
    const parsed = new URL(normalized.url);
    for (const param of params) {
      const name = param.name.trim();
      if (name) parsed.searchParams.append(name, param.value);
    }
    return parsed.toString();
  }

  function buildHeaders() {
    const result = filterMetadataForInvoke(headers).map((header) => ({ ...header }));
    const authPlaceholderOmitted = authMode !== 'none' && isRedactedValue(authSecret);
    const usableAuthSecret = authPlaceholderOmitted ? '' : authSecret;
    const omittedHeaderPlaceholderCount = headers.filter(
      (header) => header.name.trim() && isRedactedValue(header.value)
    ).length;
    let authHeaderName: string | null = null;
    if (authMode === 'bearer' && usableAuthSecret) {
      result.push({ name: 'Authorization', value: `Bearer ${usableAuthSecret}` });
      authHeaderName = 'Authorization';
    } else if (authMode === 'basic' && !authPlaceholderOmitted && (authUser || usableAuthSecret)) {
      result.push({
        name: 'Authorization',
        value: `Basic ${encodeBasicAuth(authUser, usableAuthSecret)}`,
      });
      authHeaderName = 'Authorization';
    } else if (authMode === 'api-key' && authName.trim() && usableAuthSecret) {
      result.push({ name: authName.trim(), value: usableAuthSecret });
      authHeaderName = authName.trim();
    }
    if (
      bodyMode !== 'none' &&
      !result.some((header) => header.name.trim().toLowerCase() === 'content-type')
    ) {
      result.push({
        name: 'Content-Type',
        value: bodyMode === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
      });
    }
    return {
      requestHeaders: result,
      authHeaderName,
      authPlaceholderOmitted,
      preOmittedCredentialCount: omittedHeaderPlaceholderCount + Number(authPlaceholderOmitted),
    };
  }

  function prepareCurrentDraft() {
    let requestURL = url.trim();
    try {
      requestURL = buildURL();
    } catch {
      // The shared preparer returns the actionable URL error for both actions.
    }
    const headerDraft = buildHeaders();
    const prepared = prepareHTTPRequestDraft({
      method,
      url: requestURL,
      headers: headerDraft.requestHeaders,
      body: bodyMode === 'none' ? null : body,
      timeoutMs: Math.round(timeoutSeconds * 1000),
      followRedirects,
    });
    if (!prepared.ok) return prepared;
    return {
      ...prepared,
      authHeaderName: headerDraft.authHeaderName,
      authPlaceholderOmitted: headerDraft.authPlaceholderOmitted,
      preOmittedCredentialCount:
        headerDraft.preOmittedCredentialCount + prepared.redactedQueryCount,
    };
  }

  function showResponsePane() {
    setMobilePane('response');
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 760px)').matches
    ) {
      requestAnimationFrame(() => {
        document.getElementById('http-mobile-pane-tab-response')?.focus();
      });
    }
  }

  async function handleSend() {
    if (abortRef.current || requestPending) return;
    setValidationError(null);
    setHistoryNotice(null);
    setRequestFailure(null);
    setResponse(null);
    const prepared = prepareCurrentDraft();
    if (!prepared.ok) {
      setValidationError(prepared.error);
      showResponsePane();
      return;
    }
    const { input } = prepared;
    if (prepared.redactedQueryCount > 0) {
      setHistoryNotice(
        `${prepared.redactedQueryCount} redacted query ${prepared.redactedQueryCount === 1 ? 'value was' : 'values were'} left blank. Re-enter before sending if the endpoint requires them.`
      );
    }
    if (prepared.authPlaceholderOmitted) {
      setHistoryNotice('The [redacted] auth placeholder was not sent. Re-enter the credential.');
    }
    const controller = new AbortController();
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    abortRef.current = controller;
    setRequestPending(true);
    showResponsePane();
    try {
      const result = await sendHTTPRequest(input, controller.signal);
      if (requestGenerationRef.current !== requestGeneration || abortRef.current !== controller) {
        return;
      }
      if (controller.signal.aborted)
        throw new DOMException('HTTP request cancelled.', 'AbortError');
      setResponse(result);
      setHistory((entries) =>
        normalizeHTTPHistory([
          toHTTPHistoryEntry({
            method: input.method,
            url: input.url,
            requestHeaders: input.headers,
            status: result.status,
            statusCode: result.statusCode,
            totalMs: result.timings.totalMs,
          }),
          ...entries,
        ])
      );
    } catch (error) {
      if (requestGenerationRef.current !== requestGeneration || abortRef.current !== controller) {
        return;
      }
      if (controller.signal.aborted) {
        setValidationError('HTTP request cancelled.');
      } else {
        setRequestFailure(
          error instanceof Error
            ? error.message.trim() || 'HTTP request failed.'
            : 'HTTP request failed.'
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setRequestPending(false);
      }
    }
  }

  async function handleCopyAsCurl() {
    const copyGeneration = curlCopyGenerationRef.current + 1;
    curlCopyGenerationRef.current = copyGeneration;
    const prepared = prepareCurrentDraft();
    if (!prepared.ok) {
      setCurlCopyNotice({ kind: 'error', message: prepared.error });
      return;
    }
    const result = buildCurlCommand({
      ...prepared.input,
      authHeaderName: prepared.authHeaderName,
      body: prepared.bodyActive ? prepared.input.body : null,
      preOmittedCredentialCount: prepared.preOmittedCredentialCount,
    });
    if (!result.ok) {
      setCurlCopyNotice({ kind: 'error', message: result.error });
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        setCurlCopyNotice({
          kind: 'error',
          message:
            'Clipboard access is unavailable. Use a browser context with clipboard permission and try again.',
        });
        return;
      }
      await navigator.clipboard.writeText(result.command);
    } catch {
      if (curlCopyGenerationRef.current !== copyGeneration) return;
      setCurlCopyNotice({
        kind: 'error',
        message: 'Could not copy cURL. Allow clipboard access and try again.',
      });
      return;
    }
    if (curlCopyGenerationRef.current !== copyGeneration) return;

    const omissionLabel = `${result.omittedCredentialCount} credential-like ${
      result.omittedCredentialCount === 1 ? 'value was' : 'values were'
    } omitted.`;
    setCurlCopyNotice({
      kind: 'success',
      message: result.bodyCopiedVerbatim
        ? `Copied cURL for a POSIX shell. ${omissionLabel} Request body content was copied verbatim; review the command before sharing or running it.`
        : `Copied cURL for a POSIX shell. ${omissionLabel} Review the command before sharing or running it.`,
    });
  }

  const sendFromShortcut = useEffectEvent(() => {
    if (abortRef.current) abortRef.current.abort();
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

  const requestError = validationError ?? requestFailure;
  const visibleHistoryNotice = historyStorageError ?? historyNotice;
  const jsonDraft = bodyMode === 'json' ? formatJSONDraft(body) : null;

  function loadHistory(entry: HTTPHistoryEntry) {
    requestGenerationRef.current++;
    curlCopyGenerationRef.current++;
    const active = abortRef.current;
    abortRef.current = null;
    active?.abort();
    const replayURL = prepareURLForReplay(entry.url);
    const replayHeaders = prepareMetadataForReplay(entry.requestHeaders);
    setMethod(entry.method);
    setURL(replayURL.url);
    setParams([]);
    setHeaders(replayHeaders.metadata.filter((header) => header.value !== ''));
    setAuthMode('none');
    setAuthName('X-API-Key');
    setAuthUser('');
    setAuthSecret('');
    setBodyMode('none');
    setBody('');
    setTimeoutSeconds(30);
    setFollowRedirects(false);
    setResponse(null);
    setRequestPending(false);
    setRequestFailure(null);
    setValidationError(null);
    setCurlCopyNotice(null);
    const redactedCount = replayURL.redactedCount + replayHeaders.redactedCount;
    setHistoryNotice(
      redactedCount > 0
        ? `${redactedCount} redacted ${redactedCount === 1 ? 'value was' : 'values were'} omitted from replay. Re-enter credentials before sending.`
        : null
    );
    setRequestTab('params');
    setMobilePane('request');
    if (historyRef.current) historyRef.current.open = false;
    urlInputRef.current?.focus();
  }

  return (
    <div className="pp-http-workbench">
      <header className="pp-http-header">
        <div>
          <i className="pp-http-glyph" aria-hidden="true">
            H
          </i>
          <span>HTTP / REST</span>
          <h1>Request workbench</h1>
        </div>
        <span className="pp-connection-fact">
          <LockKeyhole aria-hidden="true" /> Local relay
        </span>
        <button type="button" className="pp-http-new-request" onClick={() => resetRequest()}>
          <Plus aria-hidden="true" /> New request
        </button>
        <button
          type="button"
          className="pp-openapi-import-trigger"
          aria-expanded={openAPIImportOpen}
          onClick={() => {
            setOpenAPIImportError(null);
            setOpenAPIImportOpen((open) => !open);
          }}
        >
          <FileJson2 aria-hidden="true" /> Import OpenAPI <ChevronDown aria-hidden="true" />
        </button>
        {openAPICollection ? (
          <button
            type="button"
            className="pp-openapi-collection-trigger"
            aria-expanded={openAPIRailVisible}
            onClick={() => setOpenAPIRailVisible((visible) => !visible)}
          >
            {openAPICollection.title} <span>{openAPICollection.operations.length}</span>
          </button>
        ) : null}
        {openAPIImportOpen ? (
          <Suspense fallback={null}>
            <OpenAPIImportPanel
              url={openAPIImportURL}
              error={openAPIImportError}
              importing={openAPIImporting}
              onURLChange={setOpenAPIImportURL}
              onImportURL={() => void importOpenAPIURL()}
              onImportFile={(file) => void importOpenAPIFile(file)}
              onClose={() => setOpenAPIImportOpen(false)}
            />
          </Suspense>
        ) : null}
        <details ref={historyRef} className="pp-http-history">
          <summary>
            <History aria-hidden="true" /> History <span>{history.length}</span>
          </summary>
          <div>
            <header>
              <strong>
                Secret-safe local history
                {history.length > 12 ? ` · 12 newest of ${history.length}` : ''}
              </strong>
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
                  <small>
                    {compactDate(entry.createdAt)} · {entry.totalMs.toFixed(1)} ms total
                  </small>
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
          onChange={(event) => {
            invalidateCurlCopy();
            setMethod(event.target.value);
          }}
          aria-label="HTTP method"
        >
          {httpMethods.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
        <input
          ref={urlInputRef}
          value={url}
          onChange={(event) => {
            invalidateCurlCopy();
            setURL(event.target.value);
          }}
          aria-label="Request URL"
          spellCheck={false}
          placeholder="https://api.example.test/v1/items"
        />
        <button
          type="button"
          className={classNames('pp-http-send', requestPending && 'is-cancel')}
          onClick={requestPending ? () => abortRef.current?.abort() : () => void handleSend()}
        >
          {requestPending ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
          {requestPending ? 'Cancel' : 'Send'}
          <kbd>{modifier} ↵</kbd>
        </button>
      </div>

      {visibleHistoryNotice ? (
        <div className="pp-http-replay-notice" role="status">
          <KeyRound className="pp-http-notice-icon" aria-hidden="true" />
          <span>{visibleHistoryNotice}</span>
          {!historyStorageError ? (
            <button
              type="button"
              className="pp-http-notice-dismiss"
              aria-label="Dismiss HTTP history notice"
              onClick={() => setHistoryNotice(null)}
            >
              <X className="pp-http-notice-icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {curlCopyNotice ? (
        <div
          className={classNames(
            'pp-http-curl-notice',
            curlCopyNotice.kind === 'error' && 'is-error'
          )}
          role={curlCopyNotice.kind === 'error' ? 'alert' : 'status'}
        >
          <Copy className="pp-http-notice-icon" aria-hidden="true" />
          <span>{curlCopyNotice.message}</span>
        </div>
      ) : null}

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

      <div
        className={classNames(
          'pp-http-workspace',
          openAPICollection && openAPIRailVisible && 'has-openapi-rail'
        )}
      >
        {openAPICollection && openAPIRailVisible ? (
          <Suspense fallback={null}>
            <OpenAPIOperationRail
              collection={openAPICollection}
              selectedOperation={selectedOpenAPIOperation}
              onSelect={applyOpenAPIOperation}
              onClose={() => setOpenAPIRailVisible(false)}
            />
          </Suspense>
        ) : null}
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
                onChange={(event) => {
                  invalidateCurlCopy();
                  setTimeoutSeconds(Number(event.target.value));
                }}
              />
              s
            </label>
            <label>
              <input
                type="checkbox"
                checked={followRedirects}
                onChange={(event) => {
                  invalidateCurlCopy();
                  setFollowRedirects(event.target.checked);
                }}
              />
              Follow redirects
            </label>
            <button
              type="button"
              className="pp-http-copy-curl"
              aria-describedby="http-curl-shell-boundary"
              onClick={() => void handleCopyAsCurl()}
            >
              <Copy aria-hidden="true" /> Copy as cURL
            </button>
            <span id="http-curl-shell-boundary">POSIX shell export</span>
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
                onChange={(entries) => {
                  invalidateCurlCopy();
                  setParams(entries);
                }}
              />
            </TabPanel>
            <TabPanel id="http-request" tab="headers" active={requestTab === 'headers'}>
              <KeyValueEditor
                label="Request headers"
                entries={headers}
                namePlaceholder="Accept"
                valuePlaceholder="application/json"
                onChange={(entries) => {
                  invalidateCurlCopy();
                  setHeaders(entries);
                }}
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
                  onChange={(event) => {
                    invalidateCurlCopy();
                    setAuthMode(event.target.value as AuthMode);
                  }}
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
                  <input
                    value={authUser}
                    onChange={(event) => {
                      invalidateCurlCopy();
                      setAuthUser(event.target.value);
                    }}
                  />
                </label>
              ) : null}
              {authMode === 'api-key' ? (
                <label>
                  <span>Header name</span>
                  <input
                    value={authName}
                    onChange={(event) => {
                      invalidateCurlCopy();
                      setAuthName(event.target.value);
                    }}
                  />
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
                    onChange={(event) => {
                      invalidateCurlCopy();
                      setAuthSecret(event.target.value);
                    }}
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
                    onChange={(event) => {
                      invalidateCurlCopy();
                      setBodyMode(event.target.value as BodyMode);
                    }}
                  >
                    <option value="none">None</option>
                    <option value="json">JSON</option>
                    <option value="text">Text</option>
                  </select>
                </label>
                <span className="pp-http-body-state">
                  {jsonDraft ? (
                    <>
                      <em className={jsonDraft.ok ? 'is-valid' : 'is-invalid'}>
                        {jsonDraft.ok ? 'Valid JSON' : jsonDraft.error}
                      </em>
                      <button
                        type="button"
                        disabled={!jsonDraft.ok}
                        onClick={() => {
                          if (!jsonDraft.ok) return;
                          invalidateCurlCopy();
                          setBody(jsonDraft.text);
                        }}
                      >
                        Format JSON
                      </button>
                    </>
                  ) : null}
                  <span>
                    {new TextEncoder()
                      .encode(bodyMode === 'none' ? '' : body)
                      .length.toLocaleString()}{' '}
                    bytes
                  </span>
                </span>
              </div>
              <textarea
                value={body}
                disabled={bodyMode === 'none'}
                onChange={(event) => {
                  invalidateCurlCopy();
                  setBody(event.target.value);
                }}
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
          <HTTPResponsePanel response={response} loading={requestPending} error={requestError} />
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

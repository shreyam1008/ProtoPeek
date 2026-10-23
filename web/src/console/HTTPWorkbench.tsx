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
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PageHeader } from '@/console/shell/PageHeader';
import type { HTTPHistoryEntry, HTTPResponse, MetadataEntry } from '@/shared/types';
import {
  appStorageKeys,
  classNames,
  compactDate,
  loadStoredValue,
  modifierKeyLabel,
  normalizeHTTPHistory,
  prepareMetadataForReplay,
  prepareURLForReplay,
  sanitizeURLForPersistence,
  storeValue,
  toHTTPHistoryEntry,
} from '@/shared/utils';
import { AccessibleTabs, TabPanel } from './AccessibleTabs';
import { sendHTTPRequest } from './api';
import { handoffEvidence } from './app/handoff-display';
import { consumeLegacyHandoff, consumePendingHandoff } from './app/handoff-store';
import { type ReceiptOutcome, recordOperationReceipt } from './app/operation-receipts';
import { HTTPResponsePanel } from './HTTPResponsePanel';
import { buildCurlCommand } from './http-curl';
import type { ImportedHTTPRequest } from './http-curl-import';
import { type HTTPDraft, httpMethods, readHTTPDraft, writeHTTPDraft } from './http-draft-store';
import type { HTTPEnvironment } from './http-environments';
import { prepareHTTPExecution } from './http-execution';
import { type HTTPRecipe, readHTTPLibrary } from './http-library';
import { consumeHTTPRecipe, httpRecipeLoadEvent } from './http-library-handoff';
import { formatJSONDraft } from './http-request-draft';
import { diagnosticDraftTarget } from './network-diagnostics';
import type { OpenAPICollection, OpenAPIOperation } from './openapi';
import { ProtocolInfo } from './ProtocolInfo';
import { protocolShellEvents } from './ProtocolShellContext';
import { OperationStatus } from './shell/OperationStatus';
import { shouldHandleWorkbenchShortcut } from './workbench-shortcut';
import './http-workbench.css';

const OpenAPIImportPanel = lazy(() =>
  import('./OpenAPIWorkbenchAddons').then((module) => ({ default: module.OpenAPIImportPanel }))
);
const HTTPRequestLibrary = lazy(() =>
  import('./HTTPRequestLibrary').then((module) => ({ default: module.HTTPRequestLibrary }))
);
const HTTPEnvironmentControls = lazy(() =>
  import('./HTTPEnvironmentControls').then((module) => ({
    default: module.HTTPEnvironmentControls,
  }))
);
const HTTPImportPanel = lazy(() =>
  import('./HTTPImportPanel').then((module) => ({ default: module.HTTPImportPanel }))
);
const OpenAPIOperationRail = lazy(() =>
  import('./OpenAPIWorkbenchAddons').then((module) => ({ default: module.OpenAPIOperationRail }))
);

type RequestTab = 'params' | 'headers' | 'auth' | 'body';
type BodyMode = 'none' | 'json' | 'text';
type AuthMode = 'none' | 'bearer' | 'basic' | 'api-key';
type CurlCopyNotice = { kind: 'success' | 'error'; message: string };
type HandoffRecovery = {
  draft: HTTPDraft;
  auth: { mode: AuthMode; name: string; user: string; secret: string };
  tab: RequestTab;
  recipe: HTTPRecipe | null;
};

const requestTabs: Array<{ value: RequestTab; label: string }> = [
  { value: 'params', label: 'Params' },
  { value: 'headers', label: 'Headers' },
  { value: 'auth', label: 'Auth' },
  { value: 'body', label: 'Body' },
];

export function HTTPWorkbench() {
  const [restored] = useState(readHTTPDraft);
  const [method, setMethod] = useState(restored.draft.method);
  const [url, setURL] = useState(restored.draft.url);
  const [params, setParams] = useState<MetadataEntry[]>(restored.draft.params);
  const [headers, setHeaders] = useState<MetadataEntry[]>(restored.draft.headers);
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [authName, setAuthName] = useState('X-API-Key');
  const [authUser, setAuthUser] = useState('');
  const [authSecret, setAuthSecret] = useState('');
  const [bodyMode, setBodyMode] = useState<BodyMode>(restored.draft.bodyMode);
  const [body, setBody] = useState(restored.draft.body);
  const [rememberBody, setRememberBody] = useState(restored.draft.rememberBody);
  const [draftNotice, setDraftNotice] = useState(restored.notice);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [timeoutSeconds, setTimeoutSeconds] = useState(restored.draft.timeoutSeconds);
  const [followRedirects, setFollowRedirects] = useState(restored.draft.followRedirects);
  const [requestTab, setRequestTab] = useState<RequestTab>('params');
  const [mobilePane, setMobilePane] = useState<'request' | 'response'>('request');
  const [response, setResponse] = useState<HTTPResponse | null>(null);
  const [sentRequest, setSentRequest] = useState<{ method: string; url: string } | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [requestCancelled, setRequestCancelled] = useState(false);
  const [requestFailure, setRequestFailure] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [handoffRecovery, setHandoffRecovery] = useState<HandoffRecovery | null>(null);
  const [historyStorageError, setHistoryStorageError] = useState<string | null>(null);
  const [curlCopyNotice, setCurlCopyNotice] = useState<CurlCopyNotice | null>(null);
  const [openAPIImportOpen, setOpenAPIImportOpen] = useState(false);
  const [openAPIImportURL, setOpenAPIImportURL] = useState('');
  const [openAPIImportError, setOpenAPIImportError] = useState<string | null>(null);
  const [openAPIImporting, setOpenAPIImporting] = useState(false);
  const [openAPICollection, setOpenAPICollection] = useState<OpenAPICollection | null>(null);
  const [selectedOpenAPIOperation, setSelectedOpenAPIOperation] = useState<string | null>(null);
  const [openAPIRailVisible, setOpenAPIRailVisible] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [curlImportOpen, setCurlImportOpen] = useState(false);
  const [curlImportNotice, setCurlImportNotice] = useState<string | null>(null);
  const [curlImportInput, setCurlImportInput] = useState({ command: '', revision: 0 });
  const [environment, setEnvironment] = useState<HTTPEnvironment | null>(null);
  const [activeRecipe, setActiveRecipe] = useState<HTTPRecipe | null>(null);
  const [history, setHistory] = useState<HTTPHistoryEntry[]>(() =>
    normalizeHTTPHistory(loadStoredValue<unknown>(appStorageKeys.httpHistory, []))
  );
  const abortRef = useRef<AbortController | null>(null);
  const openAPIAbortRef = useRef<AbortController | null>(null);
  const openAPIImportGenerationRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const sentExecutionRef = useRef<string | null>(null);
  const curlCopyGenerationRef = useRef(0);
  const historyRef = useRef<HTMLDetailsElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const requestLineRef = useRef<HTMLDivElement | null>(null);
  const requestEditorRef = useRef<HTMLElement | null>(null);
  const openAPICollectionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modifier = modifierKeyLabel();

  const draftRef = useRef<HTTPDraft>(restored.draft);
  useEffect(() => {
    draftRef.current = {
      method,
      url,
      params,
      headers,
      bodyMode,
      body,
      rememberBody,
      timeoutSeconds,
      followRedirects,
    };
    const timer = window.setTimeout(() => setDraftSaveError(writeHTTPDraft(draftRef.current)), 250);
    return () => window.clearTimeout(timer);
  }, [method, url, params, headers, bodyMode, body, rememberBody, timeoutSeconds, followRedirects]);

  useEffect(() => {
    const flush = () => {
      writeHTTPDraft(draftRef.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  function cancelOpenAPIImport() {
    openAPIImportGenerationRef.current++;
    openAPIAbortRef.current?.abort();
    openAPIAbortRef.current = null;
    setOpenAPIImporting(false);
  }

  function closeOpenAPIImport() {
    cancelOpenAPIImport();
    setOpenAPIImportOpen(false);
  }

  function closeCurlImport() {
    setCurlImportOpen(false);
    setCurlImportInput((current) => ({ command: '', revision: current.revision + 1 }));
  }

  function openCurlImport(command = '') {
    closeOpenAPIImport();
    setCurlImportNotice(null);
    setCurlImportInput((current) => ({ command, revision: current.revision + 1 }));
    setCurlImportOpen(true);
  }

  function invalidateActiveRequest() {
    closeOpenAPIImport();
    closeCurlImport();
    setCurlImportNotice(null);
    setActiveRecipe(null);
    setSelectedOpenAPIOperation(null);
    setDraftNotice(null);
    setHandoffNotice(null);
    setHandoffRecovery(null);
    setRequestCancelled(false);
    requestGenerationRef.current++;
    curlCopyGenerationRef.current++;
    const active = abortRef.current;
    abortRef.current = null;
    active?.abort();
    setRequestPending(false);
    setRequestFailure(null);
    setResponse(null);
    setSentRequest(null);
    sentExecutionRef.current = null;
    setValidationError(null);
    setHistoryNotice(null);
    setCurlCopyNotice(null);
  }

  function resetRequest(
    nextURL = 'http://localhost:8080/',
    nextHandoffNotice: string | null = null
  ) {
    invalidateActiveRequest();
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
    setRememberBody(false);
    setDraftNotice(null);
    setTimeoutSeconds(30);
    setFollowRedirects(false);
    setHandoffNotice(nextHandoffNotice);
    setRequestTab('params');
    setMobilePane('request');
    if (historyRef.current) historyRef.current.open = false;
    requestAnimationFrame(() => urlInputRef.current?.focus());
  }

  function applyOpenAPIOperation(operation: OpenAPIOperation) {
    invalidateActiveRequest();
    setRememberBody(false);
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
    setRequestTab(operation.body === null ? 'params' : 'body');
    setMobilePane('request');
    setSelectedOpenAPIOperation(operation.id);
    if (hideOpenAPIDrawer()) requestAnimationFrame(() => urlInputRef.current?.focus());
  }

  function hideOpenAPIDrawer() {
    if (
      typeof window.matchMedia !== 'function' ||
      !window.matchMedia('(max-width: 1180px)').matches
    )
      return false;
    setOpenAPIRailVisible(false);
    return true;
  }

  const closeOpenAPIRailOnResize = useEffectEvent(() => {
    const focusWasInRail =
      document.activeElement instanceof Element &&
      document.activeElement.closest('.pp-openapi-rail') !== null;
    setOpenAPIRailVisible(false);
    if (focusWasInRail) requestAnimationFrame(() => openAPICollectionTriggerRef.current?.focus());
  });
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const layout = window.matchMedia('(max-width: 1180px)');
    const handleLayoutChange = (event: MediaQueryListEvent) => {
      if (event.matches) closeOpenAPIRailOnResize();
    };
    layout.addEventListener?.('change', handleLayoutChange);
    return () => layout.removeEventListener?.('change', handleLayoutChange);
  }, []);

  function acceptOpenAPICollection(collection: OpenAPICollection) {
    setOpenAPICollection(collection);
    setOpenAPIRailVisible(true);
    setLibraryOpen(false);
    setOpenAPIImportOpen(false);
    setOpenAPIImportError(null);
    setSelectedOpenAPIOperation(null);
    setDraftNotice('API definition loaded. Choose an operation to replace the current request.');
  }

  async function importOpenAPIURL() {
    const target = openAPIImportURL.trim();
    if (!target) {
      setOpenAPIImportError('Enter a Swagger, Scalar, or OpenAPI definition URL.');
      return;
    }
    cancelOpenAPIImport();
    const generation = openAPIImportGenerationRef.current;
    const controller = new AbortController();
    openAPIAbortRef.current = controller;
    setOpenAPIImporting(true);
    setOpenAPIImportError(null);
    try {
      const { importOpenAPIFromURL } = await import('./openapi-import');
      if (openAPIImportGenerationRef.current !== generation) return;
      const collection = await importOpenAPIFromURL(target, controller.signal);
      if (openAPIImportGenerationRef.current !== generation || controller.signal.aborted) return;
      acceptOpenAPICollection(collection);
    } catch (error) {
      if (openAPIImportGenerationRef.current === generation && !controller.signal.aborted) {
        setOpenAPIImportError(
          error instanceof Error ? error.message : 'Could not import the API definition.'
        );
      }
    } finally {
      if (openAPIImportGenerationRef.current === generation) {
        openAPIAbortRef.current = null;
        setOpenAPIImporting(false);
      }
    }
  }

  async function importOpenAPIFile(file?: File) {
    if (!file) return;
    cancelOpenAPIImport();
    const generation = openAPIImportGenerationRef.current;
    setOpenAPIImporting(true);
    setOpenAPIImportError(null);
    try {
      const { importOpenAPIFromFile } = await import('./openapi-import');
      if (openAPIImportGenerationRef.current !== generation) return;
      const collection = await importOpenAPIFromFile(file);
      if (openAPIImportGenerationRef.current !== generation) return;
      acceptOpenAPICollection(collection);
    } catch (error) {
      if (openAPIImportGenerationRef.current === generation) {
        setOpenAPIImportError(
          error instanceof Error ? error.message : 'Could not import the API definition.'
        );
      }
    } finally {
      if (openAPIImportGenerationRef.current === generation) setOpenAPIImporting(false);
    }
  }

  const applyPendingHTTPHandoff = useEffectEvent((includeLegacy: boolean) => {
    const pending =
      consumePendingHandoff('http-url-draft') ??
      (includeLegacy ? consumeLegacyHandoff('http-url-draft') : null);
    if (!pending) return;
    const previous = {
      draft: {
        method,
        url,
        params,
        headers,
        bodyMode,
        body,
        rememberBody,
        timeoutSeconds,
        followRedirects,
      },
      auth: { mode: authMode, name: authName, user: authUser, secret: authSecret },
      tab: requestTab,
      recipe: activeRecipe,
    };
    const hasPreviousDraft =
      method !== 'GET' ||
      url !== 'http://localhost:8080/' ||
      params.length > 0 ||
      headers.length > 0 ||
      bodyMode !== 'none' ||
      body !== '' ||
      authMode !== 'none' ||
      timeoutSeconds !== 30 ||
      followRedirects;
    resetRequest(
      pending.draft.target.url,
      `${handoffEvidence(pending.provenance, 'storage' in pending && pending.storage === 'memory')}. Review the URL, then choose Send; no request has been sent.`
    );
    if (hasPreviousDraft) setHandoffRecovery(previous);
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
      openAPIImportGenerationRef.current++;
      const active = abortRef.current;
      abortRef.current = null;
      active?.abort();
      openAPIAbortRef.current?.abort();
    },
    []
  );

  const closeImportFromEscape = useEffectEvent(closeOpenAPIImport);
  useEffect(() => {
    if (!openAPIImportOpen) return;
    function closeImport(event: KeyboardEvent) {
      if (event.key === 'Escape') closeImportFromEscape();
    }
    window.addEventListener('keydown', closeImport);
    return () => window.removeEventListener('keydown', closeImport);
  }, [openAPIImportOpen]);

  useEffect(() => {
    applyPendingHTTPHandoff(true);
    const handleHandoff = () => applyPendingHTTPHandoff(false);
    window.addEventListener(protocolShellEvents.pendingHandoff, handleHandoff);
    return () => window.removeEventListener(protocolShellEvents.pendingHandoff, handleHandoff);
  }, []);

  function invalidateCurlCopy() {
    curlCopyGenerationRef.current++;
    setCurlCopyNotice(null);
    setCurlImportNotice(null);
  }

  const prepareCurrentDraft = useCallback(
    () =>
      prepareHTTPExecution(
        {
          method,
          url,
          params,
          headers,
          bodyMode,
          body,
          rememberBody,
          timeoutSeconds,
          followRedirects,
        },
        { mode: authMode, name: authName, user: authUser, secret: authSecret },
        environment
      ),
    [
      method,
      url,
      params,
      headers,
      bodyMode,
      body,
      rememberBody,
      timeoutSeconds,
      followRedirects,
      authMode,
      authName,
      authUser,
      authSecret,
      environment,
    ]
  );

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
    setCurlImportNotice(null);
    hideOpenAPIDrawer();
    setRequestCancelled(false);
    setValidationError(null);
    setHistoryNotice(null);
    setRequestFailure(null);
    setResponse(null);
    setSentRequest(null);
    sentExecutionRef.current = null;
    const prepared = prepareCurrentDraft();
    if (!prepared.ok) {
      setValidationError(prepared.error);
      showResponsePane();
      return;
    }
    const { input } = prepared;
    sentExecutionRef.current = JSON.stringify(input);
    setSentRequest({ method: input.method, url: sanitizeURLForPersistence(input.url) });
    setHandoffNotice(null);
    setHandoffRecovery(null);
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
    const receiptStarted = performance.now();
    const receiptURL = url;
    let receiptOutcome: ReceiptOutcome = 'failed';
    let receiptHTTPStatus: number | undefined;
    try {
      const result = await sendHTTPRequest(input, controller.signal);
      receiptHTTPStatus = result.statusCode;
      receiptOutcome = controller.signal.aborted ? 'cancelled' : 'success';
      if (requestGenerationRef.current !== requestGeneration || abortRef.current !== controller) {
        if (!controller.signal.aborted) receiptOutcome = 'stale';
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
            requestHeaders: prepared.historyHeaders,
            status: result.status,
            statusCode: result.statusCode,
            totalMs: result.timings.totalMs,
          }),
          ...entries,
        ])
      );
    } catch (error) {
      receiptOutcome = controller.signal.aborted ? 'cancelled' : 'failed';
      if (requestGenerationRef.current !== requestGeneration || abortRef.current !== controller) {
        return;
      }
      if (controller.signal.aborted) {
        setRequestCancelled(true);
      } else {
        setRequestFailure(
          error instanceof Error
            ? error.message.trim() || 'HTTP request failed.'
            : 'HTTP request failed.'
        );
      }
    } finally {
      recordOperationReceipt({
        operation: 'http',
        outcome: receiptOutcome,
        target: { kind: 'http-url', url: receiptURL },
        durationMs: performance.now() - receiptStarted,
        httpStatus: receiptHTTPStatus,
      });
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
      ...prepared.exportInput,
      authHeaderName: prepared.authHeaderName,
      body: prepared.bodyActive ? prepared.exportInput.body : null,
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
      if (
        !shouldHandleWorkbenchShortcut(event, requestLineRef.current) &&
        !shouldHandleWorkbenchShortcut(event, requestEditorRef.current)
      )
        return;
      event.preventDefault();
      sendFromShortcut();
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const requestError = validationError ?? requestFailure;
  const visibleHistoryNotice = historyStorageError ?? historyNotice;
  const jsonDraft = useMemo(
    () => (bodyMode === 'json' ? formatJSONDraft(body) : null),
    [bodyMode, body]
  );
  const bodyBytes = useMemo(
    () => new TextEncoder().encode(bodyMode === 'none' ? '' : body).length,
    [bodyMode, body]
  );
  const currentExecutionIdentity = useMemo(() => {
    if (!sentRequest) return null;
    const prepared = prepareCurrentDraft();
    return prepared.ok ? JSON.stringify(prepared.input) : null;
  }, [sentRequest, prepareCurrentDraft]);
  const sentDraftChanged =
    sentRequest !== null && currentExecutionIdentity !== sentExecutionRef.current;

  function loadHistory(entry: HTTPHistoryEntry) {
    invalidateActiveRequest();
    setRememberBody(false);
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

  function loadRecipe(recipe: HTTPRecipe) {
    resetRequest(recipe.draft.url);
    setActiveRecipe(recipe);
    const draft = recipe.draft;
    setMethod(draft.method);
    setParams(draft.params);
    setHeaders(draft.headers);
    setBodyMode(draft.bodyMode);
    setBody(draft.body);
    setRememberBody(draft.rememberBody);
    setTimeoutSeconds(draft.timeoutSeconds);
    setFollowRedirects(draft.followRedirects);
    setDraftNotice(`Loaded “${recipe.name}”. Re-enter credentials before sending.`);
    if (window.matchMedia?.('(max-width: 760px)').matches) setLibraryOpen(false);
  }

  function restoreHandoffDraft() {
    if (!handoffRecovery) return;
    const { draft, auth, tab, recipe } = handoffRecovery;
    resetRequest(draft.url);
    setMethod(draft.method);
    setParams(draft.params);
    setHeaders(draft.headers);
    setBodyMode(draft.bodyMode);
    setBody(draft.body);
    setRememberBody(draft.rememberBody);
    setTimeoutSeconds(draft.timeoutSeconds);
    setFollowRedirects(draft.followRedirects);
    setAuthMode(auth.mode);
    setAuthName(auth.name);
    setAuthUser(auth.user);
    setAuthSecret(auth.secret);
    setRequestTab(tab);
    setActiveRecipe(recipe);
    setDraftNotice('Previous draft restored. No request has been sent.');
  }

  function loadCurl(request: ImportedHTTPRequest) {
    loadRecipe({
      id: '',
      name: 'cURL request',
      savedAt: new Date().toISOString(),
      draft: request.draft,
    });
    setActiveRecipe(null);
    setAuthMode(request.auth.mode);
    setAuthName(request.auth.name);
    setAuthUser(request.auth.user);
    setAuthSecret(request.auth.secret);
    setRequestTab(request.draft.bodyMode === 'none' ? 'params' : 'body');
    setDraftNotice(
      'cURL loaded. Review before sending. Credentials stay in this live editor; body is not saved.'
    );
  }

  const applySavedRequest = useEffectEvent(() => {
    const id = consumeHTTPRecipe();
    if (!id) return;
    const library = readHTTPLibrary();
    const recipe = library.requests.find((item) => item.id === id);
    if (!recipe) {
      setDraftNotice(library.error || 'This saved request is no longer available.');
      return;
    }
    loadRecipe(recipe);
    setLibraryOpen(true);
    setOpenAPIRailVisible(false);
  });
  useEffect(() => {
    applySavedRequest();
    const apply = () => applySavedRequest();
    window.addEventListener(httpRecipeLoadEvent, apply);
    return () => window.removeEventListener(httpRecipeLoadEvent, apply);
  }, []);

  return (
    <div className="pp-http-workbench">
      <PageHeader className="pp-http-header">
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
        <ProtocolInfo protocol="http" />
        <button type="button" className="pp-http-new-request" onClick={() => resetRequest()}>
          <Plus aria-hidden="true" /> New request
        </button>
        <button
          type="button"
          className="pp-http-new-request"
          aria-expanded={libraryOpen}
          onClick={() => {
            setLibraryOpen((open) => !open);
            setOpenAPIRailVisible(false);
            setMobilePane('request');
          }}
        >
          Saved requests
        </button>
        <button
          type="button"
          className="pp-openapi-import-trigger"
          aria-expanded={openAPIImportOpen}
          onClick={() => {
            setOpenAPIImportError(null);
            if (openAPIImportOpen) closeOpenAPIImport();
            else setOpenAPIImportOpen(true);
            closeCurlImport();
          }}
        >
          <FileJson2 aria-hidden="true" /> Import OpenAPI <ChevronDown aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pp-openapi-import-trigger"
          aria-expanded={curlImportOpen}
          onClick={() => {
            if (curlImportOpen) closeCurlImport();
            else openCurlImport();
          }}
        >
          Import cURL
        </button>
        {curlImportOpen ? (
          <Suspense fallback={null}>
            <HTTPImportPanel
              key={curlImportInput.revision}
              initialCommand={curlImportInput.command}
              onLoad={loadCurl}
              onClose={closeCurlImport}
            />
          </Suspense>
        ) : null}
        {openAPICollection ? (
          <button
            ref={openAPICollectionTriggerRef}
            type="button"
            className="pp-openapi-collection-trigger"
            aria-label={`${openAPICollection.title} operations`}
            aria-controls={openAPIRailVisible ? 'http-openapi-operations' : undefined}
            aria-expanded={openAPIRailVisible}
            title="Show or hide API operations"
            onClick={() => {
              setLibraryOpen(false);
              setOpenAPIRailVisible((visible) => !visible);
            }}
          >
            <FileJson2 aria-hidden="true" /> {openAPICollection.title}{' '}
            <span>{openAPICollection.operations.length}</span>
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
              onClose={closeOpenAPIImport}
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
      </PageHeader>

      <div ref={requestLineRef} className="pp-http-request-line">
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
          onPaste={(event) => {
            const command = event.clipboardData.getData('text/plain');
            if (!/^\s*curl(?:\.exe)?(?:\s|$)/i.test(command)) return;
            event.preventDefault();
            if (
              command.length > 512 * 1024 ||
              new TextEncoder().encode(command).length > 512 * 1024
            ) {
              setCurlImportNotice(
                'cURL import is limited to 512 KiB. The current request is unchanged.'
              );
              return;
            }
            openCurlImport(command);
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

      {curlImportNotice ? (
        <div className="pp-http-curl-notice is-error" role="alert">
          {curlImportNotice}
        </div>
      ) : null}
      <OperationStatus busy={requestPending} label="Sending HTTP request" />
      {requestPending ? (
        <p className="pp-http-running-notice" role="status">
          Leaving this tool cancels the request.
        </p>
      ) : null}
      {draftSaveError || draftNotice ? (
        <div className="pp-http-replay-notice" role="status">
          <span>{draftSaveError ?? draftNotice}</span>
          {!draftSaveError ? (
            <button
              type="button"
              className="pp-http-notice-dismiss"
              aria-label="Dismiss draft notice"
              onClick={() => setDraftNotice(null)}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {handoffNotice ? (
        <div className="pp-http-replay-notice" role="status">
          <Clock3 className="pp-http-notice-icon" aria-hidden="true" />
          <span>{handoffNotice} HTTP drafts autosave with recognized credentials redacted.</span>
          {handoffRecovery ? (
            <button type="button" className="pp-http-restore-draft" onClick={restoreHandoffDraft}>
              Restore previous draft
            </button>
          ) : null}
          <button
            type="button"
            className="pp-http-notice-dismiss"
            aria-label="Dismiss HTTP handoff notice"
            onClick={() => {
              setHandoffNotice(null);
              setHandoffRecovery(null);
            }}
          >
            <X className="pp-http-notice-icon" aria-hidden="true" />
          </button>
        </div>
      ) : null}

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
        onChange={(pane) => {
          setMobilePane(pane);
          if (pane === 'response' && window.matchMedia?.('(max-width: 760px)').matches)
            setLibraryOpen(false);
        }}
        className="pp-http-mobile-tabs"
      />

      <div
        className={classNames(
          'pp-http-workspace',
          libraryOpen && 'has-library-rail',
          openAPICollection && openAPIRailVisible && 'has-openapi-rail'
        )}
      >
        {libraryOpen ? (
          <Suspense fallback={<aside aria-busy="true">Loading saved requests…</aside>}>
            <HTTPRequestLibrary
              activeRecipe={activeRecipe}
              onSaved={setActiveRecipe}
              getDraft={() => ({
                method,
                url,
                params,
                headers,
                bodyMode,
                body,
                rememberBody,
                timeoutSeconds,
                followRedirects,
              })}
              onLoad={loadRecipe}
              onClose={() => setLibraryOpen(false)}
            />
          </Suspense>
        ) : null}
        {openAPICollection && openAPIRailVisible ? (
          <Suspense fallback={null}>
            <OpenAPIOperationRail
              collection={openAPICollection}
              selectedOperation={selectedOpenAPIOperation}
              onSelect={applyOpenAPIOperation}
              onClose={() => {
                setOpenAPIRailVisible(false);
                requestAnimationFrame(() => openAPICollectionTriggerRef.current?.focus());
              }}
            />
          </Suspense>
        ) : null}
        <section
          ref={requestEditorRef}
          id="http-mobile-pane-panel-request"
          role="tabpanel"
          aria-labelledby="http-mobile-pane-tab-request"
          className={classNames(
            'pp-http-request-editor',
            mobilePane !== 'request' && 'pp-mobile-pane-hidden'
          )}
        >
          <div className="pp-http-request-settings">
            <Suspense fallback={null}>
              <HTTPEnvironmentControls onChange={setEnvironment} />
            </Suspense>
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
            orientation="vertical"
            tabs={requestTabs}
            value={requestTab}
            onChange={setRequestTab}
            className="pp-http-request-tabs pp-workbench-side-tabs"
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
                  <span>{bodyBytes.toLocaleString()} bytes</span>
                </span>
              </div>
              <label className="pp-http-remember-body">
                <input
                  type="checkbox"
                  checked={rememberBody}
                  onChange={(event) => setRememberBody(event.target.checked)}
                />
                Remember body in this browser
                <small>Stores body text as entered, including any secrets in it.</small>
              </label>
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
          <HTTPResponsePanel
            response={response}
            loading={requestPending}
            error={requestError}
            cancelled={requestCancelled}
            sentRequest={sentRequest}
            draftChanged={sentDraftChanged}
          />
          {requestFailure && sentRequest && diagnosticDraftTarget(sentRequest.url) ? (
            <p>
              <a
                href={`#/network/diagnostics?mode=diagnose&target=${encodeURIComponent(diagnosticDraftTarget(sentRequest.url) ?? '')}`}
              >
                Diagnose this connection
              </a>{' '}
              · Review the target before running.
            </p>
          ) : null}
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

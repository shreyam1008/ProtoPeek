import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  connectWorkspaceTarget,
  disconnectWorkspaceSession,
  fetchBootstrap,
  fetchProtoCatalog,
  fetchSchema,
  fetchWorkspaceProtoCatalog,
  fetchWorkspaceSchema,
  type ScanResult,
} from '@/console/api';
import { handoffEvidence } from '@/console/app/handoff-display';
import { consumeLegacyHandoff, consumePendingHandoff } from '@/console/app/handoff-store';
import type { GRPCTargetRef, HandoffProvenance } from '@/console/app/handoff-types';
import type { PaletteAction } from '@/console/CommandPalette';
import { hasCanonicalHealthDescriptor } from '@/console/health';
import { protocolShellEvents } from '@/console/ProtocolShellContext';
import type { WorkbenchView } from '@/console/ServiceNavigator';
import { initialConsoleSession, sessionReducer } from '@/console/session';
import type { BrowserProtoFolderSelection } from '@/shared/proto-folder';
import type {
  BootstrapResponse,
  MetadataEntry,
  MethodFilter,
  ProtoCatalogResponse,
  SchemaResponse,
  WorkspaceTargetProfile,
} from '@/shared/types';
import {
  appStorageKeys,
  generateRequestTemplate,
  loadStoredValue,
  matchesMethodFilter,
  modifierKeyLabel,
  prettyJson,
  storeValue,
} from '@/shared/utils';
import { useGrpcHealth } from '../operations/useGrpcHealth';
import { useGrpcInvoke } from '../operations/useGrpcInvoke';
import { useGrpcRepeat } from '../operations/useGrpcRepeat';
import {
  materializeTarget,
  newTargetDraft,
  type OperationMessage,
  reuseExistingTargetID,
} from './model';
import { useGrpcReplay } from './useGrpcReplay';
import { useWorkspaceRecords } from './useWorkspaceRecords';

export function useGrpcWorkbench() {
  const [consoleSession, dispatchSession] = useReducer(sessionReducer, initialConsoleSession);
  const rootBootstrap = consoleSession.rootBootstrap;
  const bootstrap = consoleSession.bootstrap;
  const workspaceSessionId = consoleSession.sessionId;
  const activeTargetId = consoleSession.activeTargetId;
  const workspaceBusy = consoleSession.connectStatus === 'connecting';
  const [bootError, setBootError] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<OperationMessage | null>(null);
  const workspace = useWorkspaceRecords({ setOperationMessage });
  const [schemaResource, setSchemaResource] = useState<{
    method: string;
    sessionId: string;
    data: SchemaResponse | null;
  }>({ method: '', sessionId: '', data: null });
  const [targetDraft, setTargetDraft] = useState<WorkspaceTargetProfile>(newTargetDraft());
  const [browserProtoFolder, setBrowserProtoFolder] = useState<BrowserProtoFolderSelection | null>(
    null
  );
  const [browserProtoFolderBusy, setBrowserProtoFolderBusy] = useState(false);
  const [discoveryAutoStart, setDiscoveryAutoStart] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [protoCatalog, setProtoCatalog] = useState<ProtoCatalogResponse | null>(null);
  const [selectedProtoFile, setSelectedProtoFile] = useState('');
  const [protoSearchText, setProtoSearchText] = useState('');
  const [showWellKnownProto, setShowWellKnownProto] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState(
    loadStoredValue<string>(appStorageKeys.selectedMethod, '')
  );
  const schema =
    schemaResource.method === selectedMethod && schemaResource.sessionId === workspaceSessionId
      ? schemaResource.data
      : null;
  const [searchText, setSearchText] = useState('');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>(
    loadStoredValue(appStorageKeys.methodFilter, 'all')
  );
  const [activeView, setActiveView] = useState<WorkbenchView>('compose');
  const [requestText, setRequestText] = useState('{}');
  const [timeoutSeconds, setTimeoutSeconds] = useState(15);
  const [metadata, setMetadata] = useState<MetadataEntry[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const connectRequestRef = useRef(0);
  const connectAbortRef = useRef<AbortController | null>(null);
  const workspaceSessionIdRef = useRef(workspaceSessionId);
  workspaceSessionIdRef.current = workspaceSessionId;
  const deferredSearchText = useDeferredValue(searchText);

  const selectedMethodContext = useMemo(() => {
    for (const service of bootstrap?.services ?? []) {
      const method = service.methods.find((candidate) => candidate.fullName === selectedMethod);
      if (method) return { service, method };
    }
    return { service: null, method: null };
  }, [bootstrap?.services, selectedMethod]);
  const currentService = selectedMethodContext.service;
  const currentMethod = selectedMethodContext.method;
  const healthServices = bootstrap?.services;
  const healthCatalog = useMemo(
    () => ({
      serviceSuggestions: (healthServices ?? []).map((service) => service.name),
      advertised: healthServices ? hasCanonicalHealthDescriptor(healthServices) : false,
    }),
    [healthServices]
  );
  const healthContextKey = workspaceSessionId
    ? `workspace:${workspaceSessionId}`
    : `direct:${bootstrap?.target ?? ''}:${consoleSession.requestId}`;
  const activeTarget = workspace.targets.find((target) => target.id === activeTargetId) ?? null;
  const currentReplayScope = {
    targetId: activeTarget?.id,
    targetAddress: (activeTarget?.address || bootstrap?.target || '').trim(),
  };

  const invoke = useGrpcInvoke({
    schema,
    service: currentService,
    method: currentMethod,
    workspaceSessionId,
    requestText,
    timeoutSeconds,
    metadata,
    assertionRules: workspace.assertionRules,
    replayScope: currentReplayScope,
    setHistory: workspace.setHistory,
    setOperationMessage,
    setActiveView,
  });
  const repeat = useGrpcRepeat({
    bootstrap,
    schema,
    method: currentMethod,
    workspaceSessionId,
    requestText,
    metadata,
    setOperationMessage,
    setActiveView,
    cancelInvokeSilently: invoke.cancelSilently,
    resetInvoke: invoke.reset,
  });
  const health = useGrpcHealth({
    bootstrap,
    workspaceSessionId,
    workspaceBusy,
    metadata,
    contextKey: healthContextKey,
    isRepeatActive: repeat.isActive,
    isInvokeActive: () => invoke.isActive() || invoke.state.loading,
  });
  const replay = useGrpcReplay({
    bootstrap,
    schema,
    selectedMethod,
    currentService,
    currentMethod,
    replayScope: currentReplayScope,
    targets: workspace.targets,
    workspaceSessionId,
    requestText,
    metadata,
    timeoutSeconds,
    assertionRules: workspace.assertionRules,
    collections: workspace.collections,
    history: workspace.history,
    setRequestText,
    setMetadata,
    setTimeoutSeconds,
    setAssertionRules: workspace.setAssertionRules,
    setCollections: workspace.setCollections,
    setHistory: workspace.setHistory,
    setSelectedMethod,
    setActiveView,
    setSidebarOpen,
    setOperationMessage,
    storeWorkspaceValue: workspace.storeWorkspaceValue,
    cancelHealthForContext: () => health.cancel('context-changed'),
    invalidateRepeat: repeat.invalidate,
    cancelInvokeSilently: invoke.cancelSilently,
    resetInvoke: invoke.reset,
    clearInvokeResult: invoke.clearResult,
  });
  const pendingDraftRef = replay.pendingDraftRef;
  const clearInvokeResultEffect = useEffectEvent(() => invoke.clearResult());

  useEffect(
    () => () => {
      connectRequestRef.current++;
      const connection = connectAbortRef.current;
      connectAbortRef.current = null;
      connection?.abort();
      const sessionId = workspaceSessionIdRef.current;
      if (sessionId) void disconnectWorkspaceSession(sessionId).catch(() => undefined);
    },
    []
  );

  useEffect(() => {
    if (!sidebarOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setSidebarOpen(false);
      sidebarToggleRef.current?.focus();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  useEffect(() => {
    function handleWorkbenchShortcuts(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#method-search')?.focus();
      }
    }
    window.addEventListener('keydown', handleWorkbenchShortcuts);
    return () => window.removeEventListener('keydown', handleWorkbenchShortcuts);
  }, []);

  function applyBootstrap(next: BootstrapResponse) {
    health.cancel('context-changed');
    repeat.invalidate();
    replay.pendingDraftRef.current = null;
    const methods = next.services.flatMap((service) => service.methods);
    const stored = loadStoredValue<string>(appStorageKeys.selectedMethod, '');
    const lowFriction =
      methods.find((method) => /(^|\/|\.)(ping|check)$/i.test(method.fullName)) ??
      methods.find((method) => !method.clientStreaming && !method.serverStreaming);
    const initial = methods.some((method) => method.fullName === stored)
      ? stored
      : (lowFriction?.fullName ?? methods[0]?.fullName ?? '');
    setBootError(null);
    setWorkspaceError(null);
    setSchemaResource({ method: '', sessionId: '', data: null });
    setProtoCatalog(null);
    setSelectedProtoFile('');
    setMetadata(next.defaultMetadata);
    invoke.reset();
    if (initial) startTransition(() => setSelectedMethod(initial));
    else setSelectedMethod('');
  }

  function applyGRPCHandoff(
    target: GRPCTargetRef,
    provenance: HandoffProvenance,
    defaults: BootstrapResponse['targetDefaults'],
    memoryOnly = false
  ) {
    if (connectAbortRef.current) cancelConnection();
    setDiscoveryAutoStart(false);
    setBrowserProtoFolder(null);
    setBrowserProtoFolderBusy(false);
    setWorkspaceError(null);
    setTargetDraft({
      ...newTargetDraft(defaults),
      address: target.address,
      plaintext: target.plaintext,
    });
    setActiveView('workspace');
    setOperationMessage({
      tone: 'info',
      title: 'Target draft opened',
      description: `${handoffEvidence(provenance, memoryOnly)}. Review the address and transport, then choose Connect; no connection has been attempted.`,
    });
  }

  const applyBootstrapEffect = useEffectEvent((next: BootstrapResponse) => applyBootstrap(next));
  const consumeGRPCHandoffEffect = useEffectEvent(
    (defaults: BootstrapResponse['targetDefaults'], includeLegacy: boolean) => {
      const pending =
        consumePendingHandoff('grpc-target-draft') ??
        (includeLegacy ? consumeLegacyHandoff('grpc-target-draft') : null);
      if (!pending) return false;
      applyGRPCHandoff(
        pending.draft.target,
        pending.provenance,
        defaults,
        'storage' in pending && pending.storage === 'memory'
      );
      return true;
    }
  );
  const consumeNotifiedGRPCHandoff = useEffectEvent(() => {
    const defaults = rootBootstrap?.targetDefaults ?? bootstrap?.targetDefaults;
    if (defaults) consumeGRPCHandoffEffect(defaults, false);
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await fetchBootstrap();
        if (cancelled) return;
        dispatchSession({ type: 'bootstrap.loaded', bootstrap: next });
        applyBootstrapEffect(next);
        const consumedHandoff = consumeGRPCHandoffEffect(next.targetDefaults, true);
        setDiscoveryAutoStart(!consumedHandoff);
        if (!consumedHandoff) {
          setTargetDraft(newTargetDraft(next.targetDefaults));
        }
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : 'Failed to load ProtoPeek.');
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleHandoff = () => consumeNotifiedGRPCHandoff();
    window.addEventListener(protocolShellEvents.pendingHandoff, handleHandoff);
    return () => window.removeEventListener(protocolShellEvents.pendingHandoff, handleHandoff);
  }, []);

  useEffect(() => {
    if (!bootstrap || !selectedMethod) return;
    let cancelled = false;
    const requestedMethod = selectedMethod;
    const requestedSession = workspaceSessionId;
    setSchemaResource({ method: requestedMethod, sessionId: requestedSession, data: null });
    async function loadSchema() {
      try {
        const next = requestedSession
          ? await fetchWorkspaceSchema(requestedSession, requestedMethod)
          : await fetchSchema(requestedMethod);
        if (cancelled) return;
        setSchemaResource({ method: requestedMethod, sessionId: requestedSession, data: next });
        const pending =
          pendingDraftRef.current?.method === requestedMethod ? pendingDraftRef.current : null;
        setRequestText(pending?.requestText ?? prettyJson(generateRequestTemplate(next)));
        if (pending) {
          setMetadata(pending.metadata);
          setTimeoutSeconds(pending.timeoutSeconds);
          if (pending.migrationError) {
            setOperationMessage({
              tone: 'danger',
              title: 'Legacy replay was not migrated',
              description: pending.migrationError,
            });
          } else if (pending.redactedCount > 0) {
            setOperationMessage({
              tone: 'info',
              title: 'Sensitive metadata omitted',
              description: `${pending.redactedCount} redacted metadata ${pending.redactedCount === 1 ? 'value was' : 'values were'} left blank. Re-enter before invoking; blank or [redacted] sensitive values are never sent.${pending.legacyScope ? ' This legacy record is now scoped to the current target.' : ''}`,
            });
          } else if (pending.legacyScope) {
            setOperationMessage({
              tone: 'info',
              title: 'Legacy replay scoped',
              description:
                'This unscoped legacy record was applied to an available method and is now bound to the current target/profile.',
            });
          }
          pendingDraftRef.current = null;
        }
        clearInvokeResultEffect();
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : 'Failed to load schema.');
        }
      }
    }
    storeValue(appStorageKeys.selectedMethod, requestedMethod);
    void loadSchema();
    return () => {
      cancelled = true;
    };
  }, [bootstrap, selectedMethod, workspaceSessionId, pendingDraftRef]);

  useEffect(() => {
    storeValue(appStorageKeys.methodFilter, methodFilter);
  }, [methodFilter]);
  useEffect(() => {
    storeValue(appStorageKeys.activeTargetId, activeTargetId);
  }, [activeTargetId]);

  useEffect(() => {
    if (!bootstrap || bootstrap.services.length === 0) return;
    let cancelled = false;
    async function loadProto() {
      try {
        const catalog = workspaceSessionId
          ? await fetchWorkspaceProtoCatalog(workspaceSessionId)
          : await fetchProtoCatalog();
        if (cancelled) return;
        setProtoCatalog(catalog);
        const files = catalog.files.filter((file) => showWellKnownProto || !file.wellKnown);
        setSelectedProtoFile((current) =>
          files.some((file) => file.name === current) ? current : (files[0]?.name ?? '')
        );
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(error instanceof Error ? error.message : 'Failed to load protos.');
        }
      }
    }
    void loadProto();
    return () => {
      cancelled = true;
    };
  }, [bootstrap, showWellKnownProto, workspaceSessionId]);

  const query = deferredSearchText.trim().toLowerCase();
  const visibleServices = useMemo(
    () =>
      (bootstrap?.services ?? [])
        .map((service) => {
          const serviceMatches = !query || service.name.toLowerCase().includes(query);
          return {
            ...service,
            methods: service.methods.filter(
              (method) =>
                matchesMethodFilter(method, methodFilter) &&
                (serviceMatches ||
                  !query ||
                  method.name.toLowerCase().includes(query) ||
                  method.fullName.toLowerCase().includes(query))
            ),
          };
        })
        .filter((service) => service.methods.length > 0),
    [bootstrap?.services, methodFilter, query]
  );
  const filteredProtoFiles = useMemo(() => {
    const query = protoSearchText.trim().toLowerCase();
    return (protoCatalog?.files ?? []).filter((file) => {
      if (!showWellKnownProto && file.wellKnown) return false;
      if (!query) return true;
      return (
        file.name.toLowerCase().includes(query) ||
        file.package.toLowerCase().includes(query) ||
        file.services.some((service) => service.fullName.toLowerCase().includes(query)) ||
        file.messages.some((message) => message.fullName.toLowerCase().includes(query))
      );
    });
  }, [protoCatalog?.files, protoSearchText, showWellKnownProto]);
  const selectedProto = useMemo(
    () => filteredProtoFiles.find((file) => file.name === selectedProtoFile) ?? null,
    [filteredProtoFiles, selectedProtoFile]
  );
  const responsePayload = useMemo(
    () => invoke.state.result?.responses.map((entry) => entry.message) ?? [],
    [invoke.state.result]
  );
  const passingAssertions = invoke.assertionResults.filter((result) => result.passed).length;

  function invalidateConnectionAttempt() {
    connectRequestRef.current++;
    const active = connectAbortRef.current;
    connectAbortRef.current = null;
    active?.abort();
  }

  function cancelConnection() {
    const active = connectAbortRef.current;
    if (!active) return;
    const requestId = connectRequestRef.current;
    connectRequestRef.current = requestId + 1;
    connectAbortRef.current = null;
    active.abort();
    dispatchSession({ type: 'connect.cancelled', requestId });
    setWorkspaceError(null);
  }

  async function connectTarget(
    target: WorkspaceTargetProfile,
    folder?: BrowserProtoFolderSelection
  ) {
    health.cancel('context-changed');
    repeat.invalidate();
    invoke.cancelSilently();
    replay.pendingDraftRef.current = null;
    const requestId = connectRequestRef.current + 1;
    connectRequestRef.current = requestId;
    connectAbortRef.current?.abort();
    const controller = new AbortController();
    connectAbortRef.current = controller;
    dispatchSession({ type: 'connect.started', requestId, targetId: target.id });
    setWorkspaceError(null);
    const previousSessionId = workspaceSessionId;
    try {
      const result = await connectWorkspaceTarget(
        {
          address: target.address,
          plaintext: target.plaintext,
          insecure: target.insecure,
          authority: target.authority,
          cacertPath: target.cacertPath,
          certPath: target.certPath,
          keyPath: target.keyPath,
          schemaSource: target.schemaSource,
          protoFiles: target.protoFiles,
          importPaths: target.importPaths,
          protosets: target.protosets,
        },
        controller.signal,
        folder
      );
      if (connectRequestRef.current !== requestId) {
        void disconnectWorkspaceSession(result.sessionId);
        return false;
      }
      workspaceSessionIdRef.current = result.sessionId;
      dispatchSession({
        type: 'connect.succeeded',
        requestId,
        targetId: target.id,
        sessionId: result.sessionId,
        bootstrap: result.bootstrap,
      });
      applyBootstrap(result.bootstrap);
      setTargetDraft(target);
      if (previousSessionId && previousSessionId !== result.sessionId) {
        void disconnectWorkspaceSession(previousSessionId);
      }
      return true;
    } catch (error) {
      if (connectRequestRef.current !== requestId) return false;
      if (error instanceof DOMException && error.name === 'AbortError') {
        dispatchSession({ type: 'connect.cancelled', requestId });
        return false;
      }
      const message = error instanceof Error ? error.message : 'Connection failed.';
      dispatchSession({ type: 'connect.failed', requestId, message });
      setWorkspaceError(message);
      return false;
    } finally {
      if (connectAbortRef.current === controller) connectAbortRef.current = null;
    }
  }

  function persistTarget(target: WorkspaceTargetProfile) {
    const next = [target, ...workspace.targets.filter((entry) => entry.id !== target.id)];
    const stored = workspace.storeWorkspaceValue(appStorageKeys.targets, next);
    if (!stored.ok) {
      setOperationMessage({
        tone: 'danger',
        title: 'Target was not saved',
        description: `The connection is live, but the target could not be persisted: ${stored.error}`,
      });
      setTargetDraft(target);
      return;
    }
    workspace.setTargets(next);
    setBrowserProtoFolder(null);
    setBrowserProtoFolderBusy(false);
    setTargetDraft(newTargetDraft(rootBootstrap?.targetDefaults));
  }

  async function saveAndConnect() {
    if (!targetDraft.address.trim()) {
      setWorkspaceError('Address required.');
      return;
    }
    if (targetDraft.schemaSource === 'browser-proto-folder') {
      if (browserProtoFolderBusy) {
        setWorkspaceError('Wait for the folder scan to finish before connecting.');
        return;
      }
      if (!browserProtoFolder) {
        setWorkspaceError('Folder required. Choose the proto folder again before connecting.');
        return;
      }
    }
    const target = reuseExistingTargetID(materializeTarget(targetDraft), workspace.targets);
    const folder = target.schemaSource === 'browser-proto-folder' ? browserProtoFolder : undefined;
    if (await connectTarget(target, folder ?? undefined)) persistTarget(target);
  }

  async function connectRecent(target: WorkspaceTargetProfile) {
    const materialized = materializeTarget(target);
    if (materialized.schemaSource === 'browser-proto-folder') {
      setBrowserProtoFolder(null);
      setBrowserProtoFolderBusy(false);
      setTargetDraft(materialized);
      setWorkspaceError('Folder required. Choose the proto folder again before connecting.');
      return;
    }
    if (await connectTarget(materialized)) persistTarget(materialized);
  }

  function editTarget(target: WorkspaceTargetProfile) {
    setBrowserProtoFolder(null);
    setBrowserProtoFolderBusy(false);
    setWorkspaceError(null);
    setTargetDraft(materializeTarget(target));
  }

  function openDiscovered(result: ScanResult) {
    const defaults = rootBootstrap?.targetDefaults ?? bootstrap?.targetDefaults;
    if (!defaults) {
      setWorkspaceError('Target defaults are unavailable. Try the discovery again.');
      return;
    }
    applyGRPCHandoff(
      {
        kind: 'grpc-target',
        address: result.address,
        plaintext: result.transport !== 'tls',
      },
      {
        source: 'bounded-discovery',
        quality: 'observed',
        observedAt: new Date().toISOString(),
      },
      defaults
    );
  }

  function deleteTarget(id: string) {
    workspace.setTargets((current) => current.filter((target) => target.id !== id));
    if (activeTargetId === id) {
      health.cancel('context-changed');
      repeat.invalidate();
      invalidateConnectionAttempt();
      invoke.cancelSilently();
      replay.pendingDraftRef.current = null;
      if (workspaceSessionId) void disconnectWorkspaceSession(workspaceSessionId);
      dispatchSession({ type: 'connection.cleared' });
      if (rootBootstrap) applyBootstrap(rootBootstrap);
    }
    if (targetDraft.id === id) {
      setBrowserProtoFolder(null);
      setBrowserProtoFolderBusy(false);
      setTargetDraft(newTargetDraft(rootBootstrap?.targetDefaults));
    }
  }

  function resetToLauncher() {
    health.cancel('context-changed');
    repeat.invalidate();
    invalidateConnectionAttempt();
    invoke.cancelSilently();
    replay.pendingDraftRef.current = null;
    const sessionId = workspaceSessionIdRef.current;
    workspaceSessionIdRef.current = '';
    if (sessionId) void disconnectWorkspaceSession(sessionId);
    dispatchSession({ type: 'connection.cleared' });
    setWorkspaceError(null);
    setBrowserProtoFolder(null);
    setBrowserProtoFolderBusy(false);
    setDiscoveryAutoStart(true);
    if (rootBootstrap) {
      if (sessionId) applyBootstrap(rootBootstrap);
      setTargetDraft(newTargetDraft(rootBootstrap.targetDefaults));
    }
  }

  function updateDraft(next: Partial<WorkspaceTargetProfile>) {
    if (next.schemaSource && next.schemaSource !== targetDraft.schemaSource) {
      setBrowserProtoFolder(null);
      setBrowserProtoFolderBusy(false);
      setWorkspaceError(null);
    }
    setTargetDraft((current) => ({
      ...current,
      ...next,
      ...(next.schemaSource === 'browser-proto-folder'
        ? { protoFiles: [], importPaths: [], protosets: [] }
        : {}),
    }));
  }

  function changeBrowserProtoFolder(selection: BrowserProtoFolderSelection | null) {
    setBrowserProtoFolder(selection);
    if (selection) setWorkspaceError(null);
  }

  async function invokeCurrent() {
    if (health.isActive()) {
      health.setError('Cancel Health first, then invoke the RPC or run assertions.');
      setActiveView('tests');
      return;
    }
    if (repeat.isActive()) {
      repeat.setError('Cancel Repeat first, then invoke the RPC or run assertions.');
      setActiveView('tests');
      return;
    }
    repeat.invalidate(true);
    await invoke.run();
  }

  async function startRepeat() {
    if (health.isActive()) {
      health.setError('Cancel Health first, then start Unary Repeat.');
      setActiveView('tests');
      return;
    }
    await repeat.start();
  }

  function navigateToView(view: WorkbenchView) {
    if (view !== 'tests') health.cancel('navigation');
    if (view !== 'tests') repeat.cancel();
    setActiveView(view);
  }

  function changeMetadata(index: number, next: MetadataEntry) {
    setMetadata((current) => current.map((entry, i) => (i === index ? next : entry)));
  }
  function addMetadata(entry: MetadataEntry = { name: '', value: '' }) {
    setMetadata((current) => [...current, entry]);
  }
  function removeMetadata(index: number) {
    setMetadata((current) => current.filter((_, i) => i !== index));
  }

  const paletteActions: PaletteAction[] = [
    {
      id: 'invoke',
      label: invoke.state.loading ? 'Cancel active RPC' : 'Invoke current method',
      hint: `${modifierKeyLabel()}↵`,
      keywords: 'run send cancel',
      run: () => {
        if (invoke.state.loading) invoke.cancel();
        else void invokeCurrent();
      },
    },
    {
      id: 'save-request',
      label: 'Save current request',
      keywords: 'collection workspace',
      run: replay.saveCollection,
    },
    {
      id: 'search-methods',
      label: 'Search services and methods',
      hint: '/',
      keywords: 'filter rpc',
      run: () => document.querySelector<HTMLInputElement>('#method-search')?.focus(),
    },
    {
      id: 'history',
      label: 'Open history and saved requests',
      keywords: 'recent collection',
      run: () => navigateToView('history'),
    },
    {
      id: 'schema',
      label: 'Inspect schema',
      keywords: 'proto descriptor structure',
      run: () => navigateToView('structure'),
    },
    {
      id: 'targets',
      label: 'Manage targets',
      keywords: 'endpoint connect reflection proto protoset',
      run: () => navigateToView('workspace'),
    },
    ...(bootstrap?.services.flatMap((service) =>
      service.methods.map((method) => ({
        id: `method-${method.fullName}`,
        label: `Open ${service.name.split('.').pop()}.${method.name}`,
        keywords: `${service.name} ${method.fullName} rpc method`,
        run: () => replay.selectMethod(method.fullName),
      }))
    ) ?? []),
  ];

  return {
    status: { bootError, bootstrap, schema, currentMethod, currentService },
    shell: {
      activeTarget,
      activeView,
      commandPaletteOpen,
      importInputRef,
      methodFilter,
      paletteActions,
      searchText,
      sidebarOpen,
      sidebarToggleRef,
      visibleServices,
      setCommandPaletteOpen,
      setMethodFilter,
      setSearchText,
      setSidebarOpen,
    },
    notices: {
      operationMessage,
      recoveries: workspace.recoveries,
      dismiss: () => setOperationMessage(null),
      downloadRecovery: workspace.downloadRecovery,
      useRecoveredWorkspace: workspace.useRecoveredWorkspace,
    },
    request: {
      metadata,
      requestText,
      timeoutSeconds,
      setRequestText,
      setTimeoutSeconds,
      addMetadata,
      changeMetadata,
      removeMetadata,
    },
    invoke,
    repeat,
    health: { ...health, catalog: healthCatalog, contextKey: healthContextKey },
    evidence: {
      assertionRules: workspace.assertionRules,
      collections: workspace.collections,
      history: workspace.history,
      passingAssertions,
      responsePayload,
    },
    proto: {
      catalog: protoCatalog,
      filteredFiles: filteredProtoFiles,
      searchText: protoSearchText,
      selectedFile: selectedProtoFile,
      selectedProto,
      showWellKnown: showWellKnownProto,
      setSearchText: setProtoSearchText,
      setSelectedFile: setSelectedProtoFile,
      setShowWellKnown: setShowWellKnownProto,
    },
    targets: {
      activeTargetId,
      browserProtoFolder,
      browserProtoFolderBusy,
      busy: workspaceBusy,
      draft: targetDraft,
      discoveryAutoStart,
      error: workspaceError,
      items: workspace.targets,
      rootBootstrap,
      setBrowserProtoFolderBusy,
      cancelConnection,
      changeBrowserProtoFolder,
      connectRecent,
      deleteTarget,
      editTarget,
      openDiscovered,
      resetToLauncher,
      saveAndConnect,
      updateDraft,
    },
    actions: {
      addAssertion: replay.addAssertion,
      applyCollection: replay.applyCollection,
      applyHistory: replay.applyHistory,
      changeAssertion: replay.changeAssertion,
      exportRepeat: repeat.exportRun,
      exportWorkspace: workspace.exportWorkspace,
      importWorkspace: (event: React.ChangeEvent<HTMLInputElement>) =>
        workspace.importWorkspace(event, resetToLauncher),
      invokeCurrent,
      navigateToView,
      removeAssertion: replay.removeAssertion,
      resetRequestFromSchema: replay.resetRequestFromSchema,
      saveCollection: replay.saveCollection,
      selectMethod: replay.selectMethod,
      startHealth: health.start,
      startRepeat,
    },
  };
}

export type GrpcWorkbenchModel = ReturnType<typeof useGrpcWorkbench>;

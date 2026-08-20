import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  LoaderCircle,
  LockKeyhole,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
} from 'react';

import type {
  AssertionResult,
  AssertionRule,
  BootstrapMethod,
  BootstrapResponse,
  EnvironmentPreset,
  ExampleResponse,
  InvokeRequest,
  InvokeResponse,
  MetadataEntry,
  MethodFilter,
  ProtoCatalogResponse,
  ProtoEnumSummary,
  ProtoFileSummary,
  ProtoMessageSummary,
  RequestHistoryEntry,
  SavedCollection,
  SchemaResponse,
  SimulationConfig,
  SimulationRun,
  WorkspaceTargetConfig,
  WorkspaceTargetProfile,
} from '@/shared/types';
import {
  appStorageKeys,
  clampSimulationConfig,
  classNames,
  commandPreview,
  compactDate,
  displayBuildVersion,
  durationLabel,
  evaluateAssertions,
  generateRequestTemplate,
  loadStoredValue,
  matchesMethodFilter,
  modifierKeyLabel,
  prettyJson,
  removeStoredValue,
  safeParseJson,
  sanitizeAssertionForPersistence,
  sanitizeMetadataForPersistence,
  simulationSummary,
  sparklinePath,
  storeValue,
  toCollection,
  toEnvironmentPreset,
  toHistoryEntry,
  toWorkspaceTargetProfile,
  uid,
} from '@/shared/utils';

import {
  connectWorkspaceTarget,
  disconnectWorkspaceSession,
  fetchBootstrap,
  fetchExamples,
  fetchProtoCatalog,
  fetchSchema,
  fetchWorkspaceProtoCatalog,
  fetchWorkspaceSchema,
  invokeMethod,
  invokeWorkspaceMethod,
  type ScanResult,
} from './api';
import { CallWorkspace } from './CallWorkspace';
import { CommandPalette, type PaletteAction } from './CommandPalette';
import { DiscoveryPanel } from './DiscoveryScanner';
import { protocolShellEvents } from './ProtocolShellContext';
import { ProtoPeekMark } from './ProtoPeekMark';
import { ServiceNavigator, type WorkbenchView } from './ServiceNavigator';
import { initialConsoleSession, sessionReducer } from './session';
import { WorkbenchHeader } from './WorkbenchHeader';

type ActiveView = WorkbenchView;

const defaultSimulation: SimulationConfig = { runs: 25, concurrency: 5, thinkTimeMs: 0 };

const defaultAssertions: AssertionRule[] = [
  {
    id: uid('assert'),
    name: 'Status is OK',
    kind: 'status',
    comparator: 'equals',
    target: '',
    value: 'OK',
  },
  {
    id: uid('assert'),
    name: 'Latency under 800ms',
    kind: 'latency_ms',
    comparator: 'lte',
    target: '',
    value: '800',
  },
];

const simulationPresets: Array<{ label: string; config: SimulationConfig }> = [
  { label: 'Quick', config: { runs: 12, concurrency: 3, thinkTimeMs: 0 } },
  { label: 'Burst', config: { runs: 60, concurrency: 12, thinkTimeMs: 0 } },
  { label: 'Soak', config: { runs: 120, concurrency: 8, thinkTimeMs: 120 } },
];

const assertionKindOptions: Array<{ value: AssertionRule['kind']; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'latency_ms', label: 'Latency' },
  { value: 'header', label: 'Header' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'response_count', label: 'Resp count' },
  { value: 'body_text', label: 'Body text' },
];

const assertionComparatorOptions: Array<{ value: AssertionRule['comparator']; label: string }> = [
  { value: 'equals', label: '=' },
  { value: 'contains', label: 'contains' },
  { value: 'lte', label: '<=' },
  { value: 'gte', label: '>=' },
];

function newTargetDraft(defaults?: WorkspaceTargetConfig): WorkspaceTargetProfile {
  return toWorkspaceTargetProfile({
    name: '',
    notes: '',
    config: {
      address: '',
      plaintext: defaults?.plaintext ?? true,
      insecure: defaults?.insecure ?? false,
      authority: defaults?.authority ?? '',
      cacertPath: defaults?.cacertPath ?? '',
      certPath: defaults?.certPath ?? '',
      keyPath: defaults?.keyPath ?? '',
      schemaSource: defaults?.schemaSource ?? 'reflection',
      protoFiles: defaults?.protoFiles ?? [],
      importPaths: defaults?.importPaths ?? [],
      protosets: defaults?.protosets ?? [],
    },
  });
}

function targetIdentity(target: WorkspaceTargetProfile) {
  return JSON.stringify([
    target.address.trim(),
    target.plaintext,
    target.insecure,
    target.authority.trim(),
    target.cacertPath.trim(),
    target.certPath.trim(),
    target.keyPath.trim(),
    target.schemaSource,
    target.protoFiles,
    target.importPaths,
    target.protosets,
  ]);
}

function reuseExistingTargetID(
  candidate: WorkspaceTargetProfile,
  existingTargets: WorkspaceTargetProfile[]
) {
  const existing = existingTargets.find(
    (target) => target.id !== candidate.id && targetIdentity(target) === targetIdentity(candidate)
  );
  return existing ? { ...candidate, id: existing.id } : candidate;
}

function parseMultilineValues(value: string) {
  return value
    .split('\n')
    .map((e) => e.trim())
    .filter(Boolean);
}

function schemaSourceLabel(value: WorkspaceTargetProfile['schemaSource']) {
  return value === 'proto-files' ? 'Proto files' : value === 'protoset' ? 'Protoset' : 'Reflection';
}

function countMessages(msgs: ProtoMessageSummary[]): number {
  return msgs.reduce((t, m) => t + 1 + countMessages(m.messages), 0);
}

function countEnums(msgs: ProtoMessageSummary[], enums: ProtoEnumSummary[]): number {
  return enums.length + msgs.reduce((t, m) => t + countEnums(m.messages, m.enums), 0);
}

export function App() {
  const [consoleSession, dispatchSession] = useReducer(sessionReducer, initialConsoleSession);
  const rootBootstrap = consoleSession.rootBootstrap;
  const bootstrap = consoleSession.bootstrap;
  const workspaceSessionId = consoleSession.sessionId;
  const activeTargetId = consoleSession.activeTargetId;
  const workspaceBusy = consoleSession.connectStatus === 'connecting';
  const [examples, setExamples] = useState<ExampleResponse[]>([]);
  const [schemaResource, setSchemaResource] = useState<{
    method: string;
    sessionId: string;
    data: SchemaResponse | null;
  }>({ method: '', sessionId: '', data: null });
  const [targets, setTargets] = useState<WorkspaceTargetProfile[]>(
    loadStoredValue(appStorageKeys.targets, [])
  );
  const [targetDraft, setTargetDraft] = useState<WorkspaceTargetProfile>(newTargetDraft());
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
  const [activeView, setActiveView] = useState<ActiveView>('compose');
  const [requestText, setRequestText] = useState('{}');
  const [timeoutSeconds, setTimeoutSeconds] = useState(15);
  const [metadata, setMetadata] = useState<MetadataEntry[]>([]);
  const [collections, setCollections] = useState<SavedCollection[]>(
    loadStoredValue<SavedCollection[]>(appStorageKeys.collections, []).map((entry) => ({
      ...entry,
      metadata: sanitizeMetadataForPersistence(entry.metadata ?? []),
    }))
  );
  const [environments, setEnvironments] = useState<EnvironmentPreset[]>(
    loadStoredValue<EnvironmentPreset[]>(appStorageKeys.environments, []).map((entry) => ({
      ...entry,
      metadata: sanitizeMetadataForPersistence(entry.metadata ?? []),
    }))
  );
  const [history, setHistory] = useState<RequestHistoryEntry[]>(
    loadStoredValue<RequestHistoryEntry[]>(appStorageKeys.history, []).map((entry) => ({
      ...entry,
      metadata: sanitizeMetadataForPersistence(entry.metadata ?? []),
    }))
  );
  const [collectionName, setCollectionName] = useState('');
  const [collectionNotes, setCollectionNotes] = useState('');
  const [environmentName, setEnvironmentName] = useState('');
  const [environmentNotes, setEnvironmentNotes] = useState('');
  const [assertionRules, setAssertionRules] = useState<AssertionRule[]>(
    loadStoredValue<AssertionRule[]>(appStorageKeys.assertions, defaultAssertions).map(
      sanitizeAssertionForPersistence
    )
  );
  const [assertionResults, setAssertionResults] = useState<AssertionResult[]>([]);
  const [invokeState, setInvokeState] = useState<{
    loading: boolean;
    error: string | null;
    result: InvokeResponse | null;
    latencyMs: number;
  }>({ loading: false, error: null, result: null, latencyMs: 0 });
  const [simulationConfig, setSimulationConfig] = useState(
    loadStoredValue(appStorageKeys.simulation, defaultSimulation)
  );
  const [simulationRun, setSimulationRun] = useState<SimulationRun | null>(null);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const pendingDraftRef = useRef<{
    method: string;
    metadata: MetadataEntry[];
    timeoutSeconds: number;
    requestText: string;
  } | null>(null);
  const connectRequestRef = useRef(0);
  const connectAbortRef = useRef<AbortController | null>(null);
  const invokeAbortRef = useRef<AbortController | null>(null);
  const deferredSearchText = useDeferredValue(searchText);

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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#method-search')?.focus();
      }
    }
    window.addEventListener('keydown', handleWorkbenchShortcuts);
    return () => window.removeEventListener('keydown', handleWorkbenchShortcuts);
  }, []);

  function applyBootstrap(next: BootstrapResponse) {
    const methods = next.services.flatMap((s) => s.methods);
    const stored = loadStoredValue<string>(appStorageKeys.selectedMethod, '');
    const lowFriction =
      methods.find((method) => /(^|\/|\.)(ping|check)$/i.test(method.fullName)) ??
      methods.find((method) => !method.clientStreaming && !method.serverStreaming);
    const initial = methods.some((m) => m.fullName === stored)
      ? stored
      : (lowFriction?.fullName ?? methods[0]?.fullName ?? '');
    setBootError(null);
    setWorkspaceError(null);
    setSchemaResource({ method: '', sessionId: '', data: null });
    setProtoCatalog(null);
    setSelectedProtoFile('');
    setMetadata(next.defaultMetadata);
    setInvokeState({ loading: false, error: null, result: null, latencyMs: 0 });
    setAssertionResults([]);
    if (initial) startTransition(() => setSelectedMethod(initial));
    else setSelectedMethod('');
  }

  const applyBootstrapEffect = useEffectEvent((next: BootstrapResponse) => applyBootstrap(next));
  const openDiscoveredEffect = useEffectEvent((result: ScanResult) => {
    removeStoredValue(appStorageKeys.pendingGRPCTarget);
    void handleOpenDiscovered(result);
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [b, e] = await Promise.all([fetchBootstrap(), fetchExamples()]);
        if (cancelled) return;
        dispatchSession({ type: 'bootstrap.loaded', bootstrap: b });
        applyBootstrapEffect(b);
        setExamples(e);
        const pendingTarget = loadStoredValue<{ address: string; plaintext: boolean } | null>(
          appStorageKeys.pendingGRPCTarget,
          null
        );
        if (pendingTarget?.address) {
          setTargetDraft({
            ...newTargetDraft(b.targetDefaults),
            address: pendingTarget.address,
            plaintext: pendingTarget.plaintext,
          });
          removeStoredValue(appStorageKeys.pendingGRPCTarget);
        } else {
          setTargetDraft((x) => (x.address ? x : newTargetDraft(b.targetDefaults)));
        }
      } catch (err) {
        if (!cancelled)
          setBootError(err instanceof Error ? err.message : 'Failed to load ProtoPeek.');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleDiscovery(event: Event) {
      const result = (event as CustomEvent<ScanResult>).detail;
      if (!result?.address) return;
      openDiscoveredEffect(result);
    }
    window.addEventListener(protocolShellEvents.openGRPCDiscovery, handleDiscovery);
    return () => window.removeEventListener(protocolShellEvents.openGRPCDiscovery, handleDiscovery);
  }, []);

  useEffect(() => {
    if (!bootstrap || !selectedMethod) return;
    let cancelled = false;
    const requestedMethod = selectedMethod;
    const requestedSession = workspaceSessionId;
    setSchemaResource({ method: requestedMethod, sessionId: requestedSession, data: null });
    async function loadSchema() {
      try {
        const s = requestedSession
          ? await fetchWorkspaceSchema(requestedSession, requestedMethod)
          : await fetchSchema(requestedMethod);
        if (cancelled) return;
        setSchemaResource({ method: requestedMethod, sessionId: requestedSession, data: s });
        const pending =
          pendingDraftRef.current?.method === requestedMethod ? pendingDraftRef.current : null;
        setRequestText(pending?.requestText ?? prettyJson(generateRequestTemplate(s)));
        if (pending) {
          setMetadata(pending.metadata);
          setTimeoutSeconds(pending.timeoutSeconds);
          pendingDraftRef.current = null;
        }
        setInvokeState({ loading: false, error: null, result: null, latencyMs: 0 });
      } catch (err) {
        if (!cancelled) setBootError(err instanceof Error ? err.message : 'Failed to load schema.');
      }
    }
    storeValue(appStorageKeys.selectedMethod, requestedMethod);
    void loadSchema();
    return () => {
      cancelled = true;
    };
  }, [bootstrap, selectedMethod, workspaceSessionId]);

  useEffect(() => {
    storeValue(appStorageKeys.collections, collections);
  }, [collections]);
  useEffect(() => {
    storeValue(appStorageKeys.environments, environments);
  }, [environments]);
  useEffect(() => {
    storeValue(appStorageKeys.history, history);
  }, [history]);
  useEffect(() => {
    storeValue(appStorageKeys.assertions, assertionRules.map(sanitizeAssertionForPersistence));
  }, [assertionRules]);
  useEffect(() => {
    storeValue(appStorageKeys.simulation, simulationConfig);
  }, [simulationConfig]);
  useEffect(() => {
    storeValue(appStorageKeys.methodFilter, methodFilter);
  }, [methodFilter]);
  useEffect(() => {
    storeValue(appStorageKeys.targets, targets);
  }, [targets]);
  useEffect(() => {
    storeValue(appStorageKeys.activeTargetId, activeTargetId);
  }, [activeTargetId]);

  useEffect(() => {
    if (!bootstrap || bootstrap.services.length === 0) return;
    let cancelled = false;
    async function loadProto() {
      try {
        const cat = workspaceSessionId
          ? await fetchWorkspaceProtoCatalog(workspaceSessionId)
          : await fetchProtoCatalog();
        if (cancelled) return;
        setProtoCatalog(cat);
        const files = cat.files.filter((f) => showWellKnownProto || !f.wellKnown);
        setSelectedProtoFile((x) => (files.some((f) => f.name === x) ? x : (files[0]?.name ?? '')));
      } catch (err) {
        if (!cancelled)
          setWorkspaceError(err instanceof Error ? err.message : 'Failed to load protos.');
      }
    }
    void loadProto();
    return () => {
      cancelled = true;
    };
  }, [bootstrap, showWellKnownProto, workspaceSessionId]);

  const currentService =
    bootstrap?.services.find((s) => s.methods.some((m) => m.fullName === selectedMethod)) ?? null;
  const currentMethod = currentService?.methods.find((m) => m.fullName === selectedMethod) ?? null;
  const _matchingExamples = examples.filter(
    (e) =>
      `${e.service}.${e.method}` === selectedMethod || `${e.service}/${e.method}` === selectedMethod
  );
  const q = deferredSearchText.trim().toLowerCase();
  const visibleServices = (bootstrap?.services ?? [])
    .map((s) => {
      const sMatch = !q || s.name.toLowerCase().includes(q);
      return {
        ...s,
        methods: s.methods.filter(
          (m) =>
            matchesMethodFilter(m, methodFilter) &&
            (sMatch ||
              !q ||
              m.name.toLowerCase().includes(q) ||
              m.fullName.toLowerCase().includes(q))
        ),
      };
    })
    .filter((s) => s.methods.length > 0);
  const filteredProtoFiles = (protoCatalog?.files ?? []).filter((f) => {
    if (!showWellKnownProto && f.wellKnown) return false;
    const pq = protoSearchText.trim().toLowerCase();
    if (!pq) return true;
    return (
      f.name.toLowerCase().includes(pq) ||
      f.package.toLowerCase().includes(pq) ||
      f.services.some((s) => s.fullName.toLowerCase().includes(pq)) ||
      f.messages.some((m) => m.fullName.toLowerCase().includes(pq))
    );
  });
  const selectedProto = filteredProtoFiles.find((f) => f.name === selectedProtoFile) ?? null;
  const _grpcCommand =
    bootstrap && currentMethod
      ? commandPreview({
          target: bootstrap.target,
          method: currentMethod.fullName,
          metadata,
          timeoutSeconds,
          requestText,
          grpcurlOptions: bootstrap.grpcurlOptions,
        })
      : '';
  const responsePayload = invokeState.result?.responses.map((e) => e.message) ?? [];
  const latencySparkline = sparklinePath(simulationRun?.latencies ?? [], 200, 48);
  const passingAssertions = assertionResults.filter((r) => r.passed).length;

  async function handleConnectTarget(target: WorkspaceTargetProfile) {
    invokeAbortRef.current?.abort();
    const requestId = connectRequestRef.current + 1;
    connectRequestRef.current = requestId;
    connectAbortRef.current?.abort();
    const controller = new AbortController();
    connectAbortRef.current = controller;
    dispatchSession({ type: 'connect.started', requestId, targetId: target.id });
    setWorkspaceError(null);
    const previousSessionId = workspaceSessionId;
    try {
      const r = await connectWorkspaceTarget(
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
        controller.signal
      );
      if (connectRequestRef.current !== requestId) {
        void disconnectWorkspaceSession(r.sessionId);
        return false;
      }
      dispatchSession({
        type: 'connect.succeeded',
        requestId,
        targetId: target.id,
        sessionId: r.sessionId,
        bootstrap: r.bootstrap,
      });
      applyBootstrap(r.bootstrap);
      setTargetDraft(target);
      if (previousSessionId && previousSessionId !== r.sessionId) {
        void disconnectWorkspaceSession(previousSessionId);
      }
      return true;
    } catch (err) {
      if (connectRequestRef.current !== requestId) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        dispatchSession({ type: 'connect.cancelled', requestId });
        return false;
      }
      const message = err instanceof Error ? err.message : 'Connection failed.';
      dispatchSession({ type: 'connect.failed', requestId, message });
      setWorkspaceError(message);
      return false;
    }
  }

  function materializeTarget(p: WorkspaceTargetProfile) {
    return toWorkspaceTargetProfile({
      id: p.id,
      name: p.name.trim() || p.address || 'Untitled',
      notes: p.notes,
      config: {
        address: p.address.trim(),
        plaintext: p.plaintext,
        insecure: p.insecure,
        authority: p.authority.trim(),
        cacertPath: p.cacertPath.trim(),
        certPath: p.certPath.trim(),
        keyPath: p.keyPath.trim(),
        schemaSource: p.schemaSource,
        protoFiles: p.protoFiles,
        importPaths: p.importPaths,
        protosets: p.protosets,
      },
    });
  }

  function persistTarget(t: WorkspaceTargetProfile) {
    setTargets((x) => [t, ...x.filter((e) => e.id !== t.id)]);
    setTargetDraft(newTargetDraft(rootBootstrap?.targetDefaults));
  }

  async function handleSaveAndConnect() {
    if (!targetDraft.address.trim()) {
      setWorkspaceError('Address required.');
      return;
    }
    const t = reuseExistingTargetID(materializeTarget(targetDraft), targets);
    if (await handleConnectTarget(t)) persistTarget(t);
  }

  async function handleConnectRecent(target: WorkspaceTargetProfile) {
    const materialized = materializeTarget(target);
    if (await handleConnectTarget(materialized)) persistTarget(materialized);
  }

  async function handleOpenDiscovered(result: ScanResult) {
    const t = reuseExistingTargetID(
      materializeTarget({
        ...newTargetDraft(rootBootstrap?.targetDefaults),
        address: result.address,
        name: result.services?.[0]?.split('.').pop() ?? result.address,
        plaintext: result.transport !== 'tls',
        insecure: false,
        schemaSource: 'reflection',
      }),
      targets
    );
    if (await handleConnectTarget(t)) persistTarget(t);
  }

  function handleDeleteTarget(id: string) {
    setTargets((x) => x.filter((e) => e.id !== id));
    if (activeTargetId === id) {
      if (workspaceSessionId) void disconnectWorkspaceSession(workspaceSessionId);
      dispatchSession({ type: 'connection.cleared' });
      if (rootBootstrap) applyBootstrap(rootBootstrap);
    }
    if (targetDraft.id === id) setTargetDraft(newTargetDraft(rootBootstrap?.targetDefaults));
  }

  function handleResetToLauncher() {
    connectAbortRef.current?.abort();
    invokeAbortRef.current?.abort();
    if (workspaceSessionId) void disconnectWorkspaceSession(workspaceSessionId);
    dispatchSession({ type: 'connection.cleared' });
    setWorkspaceError(null);
    if (rootBootstrap) {
      applyBootstrap(rootBootstrap);
      setTargetDraft(newTargetDraft(rootBootstrap.targetDefaults));
    }
  }

  function updateDraft(next: Partial<WorkspaceTargetProfile>) {
    setTargetDraft((x) => ({ ...x, ...next }));
  }

  function downloadFile(name: string, content: string, type = 'text/plain') {
    const b = new Blob([content], { type });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.click();
    URL.revokeObjectURL(u);
  }

  async function handleInvoke() {
    if (!schema || !currentService || !currentMethod) return;
    const parsed = safeParseJson(requestText);
    if (parsed.error) {
      setAssertionResults([]);
      setInvokeState({ loading: false, error: parsed.error, result: null, latencyMs: 0 });
      setActiveView('compose');
      return;
    }
    if (schema.requestStream && !Array.isArray(parsed.value)) {
      setAssertionResults([]);
      setInvokeState({
        loading: false,
        error: 'Streaming RPCs need a JSON array.',
        result: null,
        latencyMs: 0,
      });
      setActiveView('compose');
      return;
    }
    if (!schema.requestStream && Array.isArray(parsed.value)) {
      setAssertionResults([]);
      setInvokeState({
        loading: false,
        error: 'Unary RPCs need a single object.',
        result: null,
        latencyMs: 0,
      });
      setActiveView('compose');
      return;
    }
    const payload: InvokeRequest = {
      timeout_seconds: timeoutSeconds,
      metadata: metadata.filter((e) => e.name.trim()),
      data: schema.requestStream ? (parsed.value as unknown[]) : [parsed.value],
    };
    invokeAbortRef.current?.abort();
    const controller = new AbortController();
    invokeAbortRef.current = controller;
    setInvokeState({ loading: true, error: null, result: null, latencyMs: 0 });
    setActiveView('compose');
    const t0 = performance.now();
    try {
      const result = workspaceSessionId
        ? await invokeWorkspaceMethod(
            workspaceSessionId,
            currentMethod.fullName,
            payload,
            controller.signal
          )
        : await invokeMethod(currentMethod.fullName, payload, controller.signal);
      const lat = performance.now() - t0;
      setInvokeState({ loading: false, error: null, result, latencyMs: lat });
      setAssertionResults(evaluateAssertions({ rules: assertionRules, result, latencyMs: lat }));
      setHistory((x) =>
        [
          toHistoryEntry({
            service: currentService.name,
            method: currentMethod.fullName,
            latencyMs: lat,
            success: !result.error,
            requestText,
            response: result.responses[0]?.message ?? result.error ?? null,
            metadata,
            timeoutSeconds,
          }),
          ...x,
        ].slice(0, 50)
      );
    } catch (err) {
      setAssertionResults([]);
      setInvokeState({
        loading: false,
        error:
          err instanceof DOMException && err.name === 'AbortError'
            ? 'Invocation cancelled.'
            : err instanceof Error
              ? err.message
              : 'Invocation failed.',
        result: null,
        latencyMs: 0,
      });
    } finally {
      if (invokeAbortRef.current === controller) invokeAbortRef.current = null;
    }
  }

  function handleCancelInvoke() {
    invokeAbortRef.current?.abort();
  }

  async function handleSimulation() {
    if (!schema || !currentMethod) return;
    const parsed = safeParseJson(requestText);
    if (parsed.error) {
      setSimulationError(parsed.error);
      return;
    }
    if (schema.requestStream && !Array.isArray(parsed.value)) {
      setSimulationError('Need JSON array for streaming.');
      return;
    }
    if (!schema.requestStream && Array.isArray(parsed.value)) {
      setSimulationError('Need single object for unary.');
      return;
    }
    const norm = clampSimulationConfig(simulationConfig);
    setSimulationBusy(true);
    setSimulationError(null);
    const payload: InvokeRequest = {
      timeout_seconds: timeoutSeconds,
      metadata: metadata.filter((e) => e.name.trim()),
      data: schema.requestStream ? (parsed.value as unknown[]) : [parsed.value],
    };
    const mName = currentMethod.fullName;
    const lats: number[] = [];
    let ok = 0;
    let fail = 0;
    let idx = 0;
    const t0 = performance.now();
    async function worker() {
      while (idx < norm.runs) {
        const ci = idx;
        idx++;
        const rt = performance.now();
        try {
          const r = workspaceSessionId
            ? await invokeWorkspaceMethod(workspaceSessionId, mName, payload)
            : await invokeMethod(mName, payload);
          lats[ci] = performance.now() - rt;
          if (r.error) fail++;
          else ok++;
        } catch {
          lats[ci] = performance.now() - rt;
          fail++;
        }
        if (norm.thinkTimeMs > 0) await new Promise((r) => setTimeout(r, norm.thinkTimeMs));
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(norm.concurrency, norm.runs) }, () => worker())
      );
      setSimulationRun(simulationSummary(mName, norm, lats, ok, fail, performance.now() - t0));
    } catch (err) {
      setSimulationError(err instanceof Error ? err.message : 'Simulation failed.');
    } finally {
      setSimulationBusy(false);
      setActiveView('tests');
    }
  }

  function handleMetadataChange(i: number, next: MetadataEntry) {
    setMetadata((x) => x.map((e, j) => (j === i ? next : e)));
  }
  function handleAddMetadata(entry: MetadataEntry = { name: '', value: '' }) {
    setMetadata((x) => [...x, entry]);
  }
  function handleRemoveMetadata(i: number) {
    setMetadata((x) => x.filter((_, j) => j !== i));
  }

  function handleSaveCollection() {
    if (!currentService || !currentMethod) return;
    const c = toCollection({
      name: collectionName.trim() || `${currentMethod.name} snapshot`,
      notes: collectionNotes,
      service: currentService.name,
      method: currentMethod.fullName,
      metadata,
      timeoutSeconds,
      requestText,
    });
    setCollections((x) => [c, ...x.filter((e) => e.id !== c.id)]);
    setCollectionName('');
    setCollectionNotes('');
  }

  function _handleSaveEnvironment() {
    const e = toEnvironmentPreset({
      name: environmentName.trim() || `${currentService?.name.split('.').pop() ?? 'default'} env`,
      notes: environmentNotes,
      metadata: metadata.filter((e) => e.name.trim()),
      timeoutSeconds,
    });
    setEnvironments((x) => [e, ...x.filter((i) => i.id !== e.id)]);
    setEnvironmentName('');
    setEnvironmentNotes('');
  }

  function _applyEnvironment(e: EnvironmentPreset) {
    setMetadata(e.metadata);
    setTimeoutSeconds(e.timeoutSeconds);
    setEnvironmentName(e.name);
    setEnvironmentNotes(e.notes);
  }

  function handleAssertionChange(id: string, next: AssertionRule) {
    setAssertionRules((x) => x.map((r) => (r.id === id ? next : r)));
  }
  function handleAddAssertion() {
    setAssertionRules((x) => [
      ...x,
      {
        id: uid('assert'),
        name: 'Response count >= 1',
        kind: 'response_count',
        comparator: 'gte',
        target: '',
        value: '1',
      },
    ]);
  }
  function handleRemoveAssertion(id: string) {
    setAssertionRules((x) => x.filter((r) => r.id !== id));
  }

  function applyCollection(c: SavedCollection) {
    pendingDraftRef.current = {
      method: c.method,
      metadata: c.metadata,
      timeoutSeconds: c.timeoutSeconds,
      requestText: c.requestText,
    };
    startTransition(() => {
      setSelectedMethod(c.method);
      setCollectionName(c.name);
      setCollectionNotes(c.notes);
      setActiveView('compose');
    });
  }

  function applyHistory(e: RequestHistoryEntry) {
    pendingDraftRef.current = {
      method: e.method,
      metadata: e.metadata,
      timeoutSeconds: e.timeoutSeconds,
      requestText: e.requestText,
    };
    startTransition(() => {
      setSelectedMethod(e.method);
      setActiveView('compose');
    });
  }

  function resetRequestFromSchema() {
    if (!schema) return;
    setRequestText(prettyJson(generateRequestTemplate(schema)));
  }

  function handleSelectMethod(method: string) {
    invokeAbortRef.current?.abort();
    setInvokeState({ loading: false, error: null, result: null, latencyMs: 0 });
    startTransition(() => {
      setSelectedMethod(method);
      setActiveView('compose');
      setSidebarOpen(false);
    });
  }

  function handleExportWorkspace() {
    const safeCollections = collections.map((entry) => ({
      ...entry,
      metadata: sanitizeMetadataForPersistence(entry.metadata),
    }));
    const safeEnvironments = environments.map((entry) => ({
      ...entry,
      metadata: sanitizeMetadataForPersistence(entry.metadata),
    }));
    const safeHistory = history.map((entry) => ({
      ...entry,
      metadata: sanitizeMetadataForPersistence(entry.metadata),
    }));
    downloadFile(
      'protopeek-workspace.json',
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          assertions: assertionRules.map(sanitizeAssertionForPersistence),
          collections: safeCollections,
          environments: safeEnvironments,
          history: safeHistory,
          targets,
        },
        null,
        2
      ),
      'application/json'
    );
  }

  async function handleImportWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0];
    if (!f) return;
    const parsed = safeParseJson(await f.text());
    if (parsed.error || typeof parsed.value !== 'object' || !parsed.value) {
      setBootError('Invalid workspace JSON.');
      return;
    }
    const d = parsed.value as {
      assertions?: AssertionRule[];
      collections?: SavedCollection[];
      environments?: EnvironmentPreset[];
      history?: RequestHistoryEntry[];
      targets?: WorkspaceTargetProfile[];
    };
    if (d.assertions) setAssertionRules(d.assertions.map(sanitizeAssertionForPersistence));
    if (d.collections)
      setCollections(
        d.collections.map((entry) => ({
          ...entry,
          metadata: sanitizeMetadataForPersistence(entry.metadata ?? []),
        }))
      );
    if (d.environments)
      setEnvironments(
        d.environments.map((entry) => ({
          ...entry,
          metadata: sanitizeMetadataForPersistence(entry.metadata ?? []),
        }))
      );
    if (d.history)
      setHistory(
        d.history.map((entry) => ({
          ...entry,
          metadata: sanitizeMetadataForPersistence(entry.metadata ?? []),
        }))
      );
    if (d.targets) setTargets(d.targets);
  }

  const paletteActions: PaletteAction[] = [
    {
      id: 'invoke',
      label: invokeState.loading ? 'Cancel active RPC' : 'Invoke current method',
      hint: `${modifierKeyLabel()}↵`,
      keywords: 'run send cancel',
      run: () => {
        if (invokeState.loading) handleCancelInvoke();
        else void handleInvoke();
      },
    },
    {
      id: 'save-request',
      label: 'Save current request',
      keywords: 'collection workspace',
      run: handleSaveCollection,
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
      run: () => setActiveView('history'),
    },
    {
      id: 'schema',
      label: 'Inspect schema',
      keywords: 'proto descriptor structure',
      run: () => setActiveView('structure'),
    },
    {
      id: 'targets',
      label: 'Manage targets',
      keywords: 'endpoint connect reflection proto protoset',
      run: () => setActiveView('workspace'),
    },
    ...(bootstrap?.services.flatMap((service) =>
      service.methods.map((method) => ({
        id: `method-${method.fullName}`,
        label: `Open ${service.name.split('.').pop()}.${method.name}`,
        keywords: `${service.name} ${method.fullName} rpc method`,
        run: () => handleSelectMethod(method.fullName),
      }))
    ) ?? []),
  ];

  // boot/loading states
  if (bootError)
    return (
      <div className="flex h-screen items-center justify-center bg-pp-bg">
        <div className="pp-panel max-w-md text-center">
          <CircleAlert className="mx-auto mb-3 size-8 text-pp-danger" />
          <h1 className="pp-heading text-xl">ProtoPeek couldn&apos;t start</h1>
          <p className="pp-muted mt-2">{bootError}</p>
        </div>
      </div>
    );

  if (!bootstrap)
    return (
      <div className="flex h-screen items-center justify-center bg-pp-bg">
        <div className="flex items-center gap-3">
          <LoaderCircle className="size-5 animate-spin text-pp-brand" />
          <span className="text-sm text-pp-muted">Loading ProtoPeek...</span>
        </div>
      </div>
    );

  if (bootstrap.launcherMode && bootstrap.services.length === 0)
    return (
      <LauncherView
        bootstrap={bootstrap}
        targets={targets}
        activeTargetId={activeTargetId}
        draft={targetDraft}
        busy={workspaceBusy}
        error={workspaceError}
        onChangeDraft={updateDraft}
        onSaveAndConnect={() => {
          void handleSaveAndConnect();
        }}
        onConnect={(t) => {
          void handleConnectRecent(t);
        }}
        onEdit={setTargetDraft}
        onDelete={handleDeleteTarget}
        onOpenDiscovered={(result) => {
          void handleOpenDiscovered(result);
        }}
      />
    );

  if (!schema || !currentMethod || !currentService)
    return (
      <div className="flex h-screen items-center justify-center bg-pp-bg">
        <div className="flex items-center gap-3">
          <LoaderCircle className="size-5 animate-spin text-pp-brand" />
          <span className="text-sm text-pp-muted">Loading schema...</span>
        </div>
      </div>
    );

  return (
    <div className="pp-shell">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close service navigation"
          className="pp-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside className={classNames('pp-sidebar', sidebarOpen && 'pp-sidebar-open')}>
        <ServiceNavigator
          services={visibleServices}
          selectedMethod={selectedMethod}
          searchText={searchText}
          filter={methodFilter}
          activeView={activeView}
          historyCount={history.length}
          savedCount={collections.length}
          onSearchChange={setSearchText}
          onFilterChange={setMethodFilter}
          onSelectMethod={handleSelectMethod}
          onViewChange={(view) => {
            setActiveView(view);
            setSidebarOpen(false);
          }}
          onExport={handleExportWorkspace}
          onImport={() => importInputRef.current?.click()}
        />
        <input
          ref={importInputRef}
          className="hidden"
          type="file"
          accept="application/json"
          onChange={handleImportWorkspace}
        />
      </aside>

      <div className="pp-main">
        <WorkbenchHeader
          target={bootstrap.target}
          targetProfile={targets.find((target) => target.id === activeTargetId) ?? null}
          serviceName={currentService.name}
          method={currentMethod}
          sidebarButtonRef={sidebarToggleRef}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onSwitchTarget={() => {
            if (rootBootstrap?.launcherMode) handleResetToLauncher();
            else setActiveView('workspace');
          }}
        />

        <div
          className={classNames('flex-1 overflow-y-auto', activeView === 'compose' ? 'p-0' : 'p-4')}
        >
          {activeView === 'compose' ? (
            <CallWorkspace
              method={currentMethod}
              schema={schema}
              requestText={requestText}
              onRequestChange={setRequestText}
              timeoutSeconds={timeoutSeconds}
              onTimeoutChange={setTimeoutSeconds}
              metadata={metadata}
              onAddMetadata={handleAddMetadata}
              onRemoveMetadata={handleRemoveMetadata}
              onMetadataChange={handleMetadataChange}
              onInvoke={handleInvoke}
              onCancel={handleCancelInvoke}
              onSaveRequest={handleSaveCollection}
              onResetRequest={resetRequestFromSchema}
              invokeState={invokeState}
            />
          ) : null}

          {activeView === 'history' ? (
            <HistoryView
              history={history}
              collections={collections}
              onApply={applyHistory}
              onApplyCollection={applyCollection}
            />
          ) : null}

          {activeView === 'tests' ? (
            <TestsView
              rules={assertionRules}
              results={assertionResults}
              onChangeRule={handleAssertionChange}
              onAddRule={handleAddAssertion}
              onRemoveRule={handleRemoveAssertion}
              onRunAssertions={() => {
                void handleInvoke().then(() => setActiveView('tests'));
              }}
              simulationConfig={simulationConfig}
              setSimulationConfig={setSimulationConfig}
              simulationRun={simulationRun}
              simulationBusy={simulationBusy}
              simulationError={simulationError}
              onSimulate={() => {
                void handleSimulation();
              }}
              latencySparkline={latencySparkline}
              passingAssertions={passingAssertions}
            />
          ) : null}

          {activeView === 'transport' ? (
            <TransportView
              bootstrap={bootstrap}
              schema={schema}
              method={currentMethod}
              invokeResult={invokeState.result}
              responsePayload={responsePayload}
            />
          ) : null}

          {activeView === 'structure' ? (
            <StructureView
              catalog={protoCatalog}
              searchText={protoSearchText}
              onSearchChange={setProtoSearchText}
              selectedFile={selectedProtoFile}
              onSelectFile={setSelectedProtoFile}
              selectedProto={selectedProto}
              showWellKnown={showWellKnownProto}
              onToggleWellKnown={setShowWellKnownProto}
              visibleFiles={filteredProtoFiles}
              onExportCatalog={() =>
                downloadFile(
                  'protopeek-catalog.json',
                  prettyJson(protoCatalog ?? { files: [] }),
                  'application/json'
                )
              }
              onExportProto={(f) =>
                downloadFile(f.name.split('/').pop() || 'schema.proto', f.protoText)
              }
            />
          ) : null}

          {activeView === 'workspace' ? (
            <WorkspaceView
              targets={targets}
              activeTargetId={activeTargetId}
              draft={targetDraft}
              busy={workspaceBusy}
              error={workspaceError}
              rootBootstrap={rootBootstrap}
              onChangeDraft={updateDraft}
              onSaveAndConnect={() => {
                void handleSaveAndConnect();
              }}
              onConnect={(t) => {
                void handleConnectRecent(t);
              }}
              onEdit={setTargetDraft}
              onDelete={handleDeleteTarget}
              onReset={handleResetToLauncher}
              onOpenDiscovered={(result) => {
                void handleOpenDiscovered(result);
              }}
            />
          ) : null}
        </div>
      </div>
      <CommandPalette
        open={commandPaletteOpen}
        actions={paletteActions}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  );
}

// ─── Compose view ──────────────────────────────────────────────

function _ComposeView({
  schema,
  requestText,
  setRequestText,
  timeoutSeconds,
  setTimeoutSeconds,
  metadata,
  onAddMeta,
  onRemoveMeta,
  onChangeMeta,
  grpcCommand,
  onInvoke,
  onSimulate,
  invokeLoading,
  simulationBusy,
  onResetFromSchema,
  matchingExamples,
  setRequestFromExample,
  collectionName,
  setCollectionName,
  collectionNotes,
  setCollectionNotes,
  onSaveCollection,
  environmentName,
  setEnvironmentName,
  environmentNotes,
  setEnvironmentNotes,
  onSaveEnvironment,
  environments,
  onApplyEnvironment,
  collections,
  onApplyCollection,
}: {
  schema: SchemaResponse;
  requestText: string;
  setRequestText: (v: string) => void;
  timeoutSeconds: number;
  setTimeoutSeconds: (v: number) => void;
  metadata: MetadataEntry[];
  onAddMeta: () => void;
  onRemoveMeta: (i: number) => void;
  onChangeMeta: (i: number, v: MetadataEntry) => void;
  grpcCommand: string;
  onInvoke: () => void;
  onSimulate: () => void;
  invokeLoading: boolean;
  simulationBusy: boolean;
  onResetFromSchema: () => void;
  matchingExamples: ExampleResponse[];
  setRequestFromExample: (e: ExampleResponse) => void;
  collectionName: string;
  setCollectionName: (v: string) => void;
  collectionNotes: string;
  setCollectionNotes: (v: string) => void;
  onSaveCollection: () => void;
  environmentName: string;
  setEnvironmentName: (v: string) => void;
  environmentNotes: string;
  setEnvironmentNotes: (v: string) => void;
  onSaveEnvironment: () => void;
  environments: EnvironmentPreset[];
  onApplyEnvironment: (e: EnvironmentPreset) => void;
  collections: SavedCollection[];
  onApplyCollection: (c: SavedCollection) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="pp-label" htmlFor="req-body">
              Request body
            </label>
            <button
              className="pp-button-ghost py-1 text-xs"
              type="button"
              onClick={onResetFromSchema}
            >
              <RefreshCw className="size-3" />
              Reset
            </button>
          </div>
          <textarea
            id="req-body"
            className="pp-input min-h-[280px] font-mono text-xs leading-relaxed"
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
          />
        </div>

        <div className="flex items-end gap-3">
          <div>
            <label className="pp-label" htmlFor="timeout">
              Timeout (s)
            </label>
            <input
              id="timeout"
              className="pp-input mt-1 w-24"
              type="number"
              min={0}
              value={timeoutSeconds}
              onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
            />
          </div>
          <button className="pp-button-primary" type="button" onClick={onInvoke}>
            {invokeLoading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Invoke
          </button>
          <button className="pp-button-secondary" type="button" onClick={onSimulate}>
            {simulationBusy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Simulate
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="pp-label">Metadata</span>
            <button className="pp-button-ghost py-1 text-xs" type="button" onClick={onAddMeta}>
              <Plus className="size-3" />
              Add
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {metadata.map((entry, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: metadata rows are edited in-place, never reordered
              <div className="flex gap-2" key={i}>
                <input
                  className="pp-input flex-1"
                  value={entry.name}
                  onChange={(e) => onChangeMeta(i, { ...entry, name: e.target.value })}
                  placeholder="key"
                />
                <input
                  className="pp-input flex-1"
                  value={entry.value}
                  onChange={(e) => onChangeMeta(i, { ...entry, value: e.target.value })}
                  placeholder="value"
                />
                <button
                  className="pp-button-ghost px-2"
                  type="button"
                  onClick={() => onRemoveMeta(i)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {metadata.length === 0 ? (
              <div className="text-xs text-pp-muted">
                No metadata. Add headers, auth tokens, or trace IDs.
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="pp-label">grpcurl</span>
            <button
              className="pp-button-ghost py-1 text-xs"
              type="button"
              onClick={() => void navigator.clipboard.writeText(grpcCommand)}
            >
              <Copy className="size-3" />
              Copy
            </button>
          </div>
          <pre className="pp-code mt-1 text-xs">{grpcCommand}</pre>
        </div>
      </div>

      <div className="space-y-4">
        <div className="pp-panel">
          <span className="pp-label">Request schema</span>
          <div className="mt-2 space-y-1.5">
            {(schema.messageTypes[schema.requestType] ?? []).map((f) => (
              <SchemaField key={f.name} field={f} schema={schema} depth={0} />
            ))}
          </div>
        </div>

        {matchingExamples.length > 0 ? (
          <div className="pp-panel">
            <span className="pp-label">Examples</span>
            <div className="mt-2 space-y-1">
              {matchingExamples.map((ex) => (
                <button
                  key={ex.name}
                  type="button"
                  onClick={() => setRequestFromExample(ex)}
                  className="block w-full rounded-md border border-pp-border p-2 text-left text-xs hover:bg-pp-bg"
                >
                  <div className="font-semibold text-pp-ink">{ex.name}</div>
                  {ex.description ? <div className="text-pp-muted">{ex.description}</div> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="pp-panel">
          <span className="pp-label">Recipes</span>
          <div className="mt-2 space-y-2">
            <input
              className="pp-input text-xs"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              placeholder="Recipe name"
            />
            <textarea
              className="pp-input text-xs"
              rows={2}
              value={collectionNotes}
              onChange={(e) => setCollectionNotes(e.target.value)}
              placeholder="Notes"
            />
            <button
              className="pp-button-secondary w-full text-xs"
              type="button"
              onClick={onSaveCollection}
            >
              <Save className="size-3" />
              Save recipe
            </button>
          </div>
          {collections.length > 0 ? (
            <div className="mt-3 space-y-1">
              {collections.slice(0, 5).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onApplyCollection(c)}
                  className="block w-full rounded-md border border-pp-border p-2 text-left text-xs hover:bg-pp-bg"
                >
                  <div className="font-semibold text-pp-ink">{c.name}</div>
                  <div className="text-pp-muted">{c.method.split('.').pop()}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="pp-panel">
          <span className="pp-label">Environments</span>
          <div className="mt-2 space-y-2">
            <input
              className="pp-input text-xs"
              value={environmentName}
              onChange={(e) => setEnvironmentName(e.target.value)}
              placeholder="Env name"
            />
            <textarea
              className="pp-input text-xs"
              rows={2}
              value={environmentNotes}
              onChange={(e) => setEnvironmentNotes(e.target.value)}
              placeholder="Notes"
            />
            <button
              className="pp-button-secondary w-full text-xs"
              type="button"
              onClick={onSaveEnvironment}
            >
              <Save className="size-3" />
              Save env
            </button>
          </div>
          {environments.length > 0 ? (
            <div className="mt-3 space-y-1">
              {environments.slice(0, 4).map((env) => (
                <button
                  key={env.id}
                  type="button"
                  onClick={() => onApplyEnvironment(env)}
                  className="block w-full rounded-md border border-pp-border p-2 text-left text-xs hover:bg-pp-bg"
                >
                  <div className="font-semibold text-pp-ink">{env.name}</div>
                  <div className="text-pp-muted">{env.timeoutSeconds}s timeout</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Response view ─────────────────────────────────────────────

function _ResponseView({
  invokeState,
  responsePayload,
}: {
  invokeState: {
    loading: boolean;
    error: string | null;
    result: InvokeResponse | null;
    latencyMs: number;
  };
  responsePayload: unknown[];
}) {
  if (invokeState.loading)
    return (
      <StatusBanner tone="info" title="In flight" description="Waiting for server response..." />
    );
  if (invokeState.error)
    return <StatusBanner tone="danger" title="Error" description={invokeState.error} />;
  if (!invokeState.result)
    return <div className="text-sm text-pp-muted">Invoke a method to see the response.</div>;

  const r = invokeState.result;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Latency" value={durationLabel(invokeState.latencyMs)} />
        <Metric label="Messages" value={String(r.responses.length)} />
        <Metric label="Status" value={r.error ? r.error.name : 'OK'} />
        <Metric label="Sent" value={r.requests ? `${r.requests.sent}/${r.requests.total}` : '—'} />
      </div>
      <MetadataTable title="Headers" values={r.headers} />
      <PayloadBlock title="Responses" values={responsePayload} />
      {r.error ? (
        <div className="rounded-lg border border-pp-danger/30 bg-red-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-pp-danger">
            <CircleAlert className="size-4" />
            {r.error.name} ({r.error.code})
          </div>
          <p className="mt-1 text-sm text-pp-ink">{r.error.message}</p>
          {r.error.details.length > 0 ? (
            <PayloadBlock title="Details" values={r.error.details.map((d) => d.message)} />
          ) : null}
        </div>
      ) : null}
      <MetadataTable title="Trailers" values={r.trailers} />
    </div>
  );
}

// ─── History view ──────────────────────────────────────────────

function HistoryView({
  history,
  collections,
  onApply,
  onApplyCollection,
}: {
  history: RequestHistoryEntry[];
  collections: SavedCollection[];
  onApply: (e: RequestHistoryEntry) => void;
  onApplyCollection: (collection: SavedCollection) => void;
}) {
  return (
    <div className="pp-history-layout">
      <section>
        <div className="pp-section-heading">
          <div>
            <span className="pp-kicker">Reusable</span>
            <h2>Saved requests</h2>
          </div>
          <span className="pp-count">{collections.length}</span>
        </div>
        {collections.length ? (
          <div className="pp-history-list">
            {collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                onClick={() => onApplyCollection(collection)}
                className="pp-history-row"
              >
                <div>
                  <strong>{collection.name}</strong>
                  <span>{collection.method}</span>
                </div>
                <small>{compactDate(collection.createdAt)}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="pp-empty-copy">Save the current request to reuse its body and metadata.</p>
        )}
      </section>
      <section>
        <div className="pp-section-heading">
          <div>
            <span className="pp-kicker">Evidence</span>
            <h2>Recent calls</h2>
          </div>
          <span className="pp-count">{history.length}</span>
        </div>
        {history.length ? (
          <div className="pp-history-list">
            {history.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onApply(entry)}
                className="pp-history-row"
              >
                <div>
                  <strong>{entry.method.split('/').pop() || entry.method}</strong>
                  <span>{entry.responsePreview}</span>
                </div>
                <small>
                  {compactDate(entry.createdAt)} · {durationLabel(entry.latencyMs)} ·{' '}
                  {entry.success ? 'OK' : 'ERR'}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="pp-empty-copy">Run an RPC to build local history.</p>
        )}
      </section>
    </div>
  );
}

// ─── Tests view ────────────────────────────────────────────────

function TestsView({
  rules,
  results,
  onChangeRule,
  onAddRule,
  onRemoveRule,
  onRunAssertions,
  simulationConfig,
  setSimulationConfig,
  simulationRun,
  simulationBusy,
  simulationError,
  onSimulate,
  latencySparkline,
  passingAssertions,
}: {
  rules: AssertionRule[];
  results: AssertionResult[];
  onChangeRule: (id: string, r: AssertionRule) => void;
  onAddRule: () => void;
  onRemoveRule: (id: string) => void;
  onRunAssertions: () => void;
  simulationConfig: SimulationConfig;
  setSimulationConfig: (fn: (c: SimulationConfig) => SimulationConfig) => void;
  simulationRun: SimulationRun | null;
  simulationBusy: boolean;
  simulationError: string | null;
  onSimulate: () => void;
  latencySparkline: string;
  passingAssertions: number;
}) {
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between">
          <h3 className="pp-heading text-base">Assertions</h3>
          <div className="flex gap-2">
            <button
              className="pp-button-primary py-1.5 text-xs"
              type="button"
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
                  onChange={(e) => onChangeRule(rule.id, { ...rule, name: e.target.value })}
                  placeholder="Rule name"
                />
                <select
                  className="pp-input w-28 text-xs"
                  value={rule.kind}
                  onChange={(e) =>
                    onChangeRule(rule.id, {
                      ...rule,
                      kind: e.target.value as AssertionRule['kind'],
                      target:
                        e.target.value === 'header' || e.target.value === 'trailer'
                          ? rule.target
                          : '',
                    })
                  }
                >
                  {assertionKindOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  className="pp-input w-20 text-xs"
                  value={rule.comparator}
                  onChange={(e) =>
                    onChangeRule(rule.id, {
                      ...rule,
                      comparator: e.target.value as AssertionRule['comparator'],
                    })
                  }
                >
                  {assertionComparatorOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
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
                  onChange={(e) => onChangeRule(rule.id, { ...rule, target: e.target.value })}
                  placeholder={
                    rule.kind === 'header' || rule.kind === 'trailer' ? 'metadata key' : 'target'
                  }
                />
                <input
                  className="pp-input flex-1 text-xs"
                  value={rule.value}
                  onChange={(e) => onChangeRule(rule.id, { ...rule, value: e.target.value })}
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
            {results.map((r) => (
              <div
                key={r.id}
                className={classNames(
                  'rounded-lg border p-2 text-xs',
                  r.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                )}
              >
                <span
                  className={classNames(
                    'font-semibold',
                    r.passed ? 'text-pp-ok' : 'text-pp-danger'
                  )}
                >
                  {r.passed ? 'PASS' : 'FAIL'}
                </span>{' '}
                <span className="text-pp-ink">{r.name}</span>
                <div className="text-pp-muted">{r.message}</div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h3 className="pp-heading text-base">Simulation</h3>
          <button className="pp-button-primary py-1.5 text-xs" type="button" onClick={onSimulate}>
            {simulationBusy ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3" />
            )}
            Run
          </button>
        </div>
        <p className="pp-muted mt-2 text-xs">
          Browser-driven diagnostic repetition, not a service load benchmark.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {simulationPresets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setSimulationConfig(() => clampSimulationConfig(p.config))}
              className="rounded-lg border border-pp-border px-3 py-1.5 text-xs font-medium hover:bg-pp-bg"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <label className="block">
            <span className="pp-label">Runs</span>
            <input
              className="pp-input mt-1 text-xs"
              type="number"
              value={simulationConfig.runs}
              onChange={(e) => setSimulationConfig((c) => ({ ...c, runs: Number(e.target.value) }))}
            />
          </label>
          <label className="block">
            <span className="pp-label">Concurrency</span>
            <input
              className="pp-input mt-1 text-xs"
              type="number"
              value={simulationConfig.concurrency}
              onChange={(e) =>
                setSimulationConfig((c) => ({ ...c, concurrency: Number(e.target.value) }))
              }
            />
          </label>
          <label className="block">
            <span className="pp-label">Think (ms)</span>
            <input
              className="pp-input mt-1 text-xs"
              type="number"
              value={simulationConfig.thinkTimeMs}
              onChange={(e) =>
                setSimulationConfig((c) => ({ ...c, thinkTimeMs: Number(e.target.value) }))
              }
            />
          </label>
        </div>
        {simulationError ? (
          <div className="mt-3">
            <StatusBanner tone="danger" title="Simulation failed" description={simulationError} />
          </div>
        ) : null}
        {simulationRun ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <Metric label="Success" value={String(simulationRun.successCount)} />
              <Metric label="Errors" value={String(simulationRun.errorCount)} />
              <Metric label="Observed req/s" value={simulationRun.throughputRps.toFixed(1)} />
              <Metric label="Total" value={durationLabel(simulationRun.totalMs)} />
            </div>
            <div className="rounded-lg border border-pp-border bg-white p-3">
              <span className="text-xs font-semibold text-pp-ink">
                p50 {durationLabel(simulationRun.p50)} · p95 {durationLabel(simulationRun.p95)} ·
                p99 {durationLabel(simulationRun.p99)}
              </span>
              <svg
                aria-label="Latency sparkline"
                role="img"
                viewBox="0 0 200 48"
                className="mt-2 h-12 w-full"
              >
                <title>Latency sparkline</title>
                <path
                  d={latencySparkline}
                  fill="none"
                  stroke="var(--pp-brand)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

// ─── Transport view ────────────────────────────────────────────

function TransportView({
  bootstrap,
  schema,
  method,
  invokeResult,
  responsePayload,
}: {
  bootstrap: BootstrapResponse;
  schema: SchemaResponse;
  method: BootstrapMethod;
  invokeResult: InvokeResponse | null;
  responsePayload: unknown[];
}) {
  const headerCount = invokeResult?.headers.length ?? 0;
  const trailerCount = invokeResult?.trailers.length ?? 0;
  const status = invokeResult?.error?.name ?? (invokeResult ? 'OK' : '—');
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Discovery" value={bootstrap.services.length > 0 ? 'Loaded' : 'N/A'} />
        <Metric label="Request" value={schema.requestStream ? 'Client stream' : 'Unary'} />
        <Metric label="Headers" value={String(headerCount)} />
        <Metric label="Trailers" value={String(trailerCount)} />
      </div>
      <div className="pp-panel text-sm">
        <p>
          <strong>Target:</strong> {bootstrap.target} at {bootstrap.basePath}
        </p>
        <p>
          <strong>Mode:</strong>{' '}
          {method.clientStreaming || method.serverStreaming ? 'Stream-aware' : 'Unary'}
        </p>
        <p>
          <strong>Last status:</strong> {status}, {responsePayload.length} message
          {responsePayload.length !== 1 ? 's' : ''}
        </p>
      </div>
      <div className="pp-panel text-xs text-pp-muted">
        <p className="font-semibold text-pp-ink">gRPC transport notes</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>Proto files define the contract; reflection discovers services at runtime.</li>
          <li>Metadata (headers) carry auth, trace IDs, deadlines before payloads.</li>
          <li>Unary, client stream, server stream, and bidi are all supported.</li>
          <li>Final status and trailing metadata arrive after response messages.</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Structure view ────────────────────────────────────────────

function StructureView({
  catalog,
  searchText,
  onSearchChange,
  selectedFile,
  onSelectFile,
  selectedProto,
  showWellKnown,
  onToggleWellKnown,
  visibleFiles,
  onExportCatalog,
  onExportProto,
}: {
  catalog: ProtoCatalogResponse | null;
  searchText: string;
  onSearchChange: (v: string) => void;
  selectedFile: string;
  onSelectFile: (v: string) => void;
  selectedProto: ProtoFileSummary | null;
  showWellKnown: boolean;
  onToggleWellKnown: (v: boolean) => void;
  visibleFiles: ProtoFileSummary[];
  onExportCatalog: () => void;
  onExportProto: (f: ProtoFileSummary) => void;
}) {
  if (!catalog) return <div className="text-sm text-pp-muted">Loading proto catalog...</div>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Files" value={String(catalog.files.length)} />
        <Metric
          label="Services"
          value={String(catalog.files.reduce((t, f) => t + f.services.length, 0))}
        />
        <Metric
          label="Messages"
          value={String(catalog.files.reduce((t, f) => t + countMessages(f.messages), 0))}
        />
        <Metric
          label="Enums"
          value={String(catalog.files.reduce((t, f) => t + countEnums(f.messages, f.enums), 0))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-pp-muted" />
          <input
            className="pp-input pl-8 text-xs"
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search protos..."
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showWellKnown}
            onChange={(e) => onToggleWellKnown(e.target.checked)}
          />
          Well-known
        </label>
        <button className="pp-button-secondary text-xs" type="button" onClick={onExportCatalog}>
          <Download className="size-3" />
          Export JSON
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="space-y-1 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {visibleFiles.map((f) => (
            <button
              key={f.name}
              type="button"
              onClick={() => onSelectFile(f.name)}
              className={classNames(
                'block w-full rounded-md border p-2 text-left text-xs transition',
                f.name === selectedFile
                  ? 'border-pp-brand bg-pp-brand/5 font-semibold'
                  : 'border-pp-border hover:bg-pp-bg'
              )}
            >
              <div className="truncate text-pp-ink">{f.name}</div>
              <div className="text-pp-muted">
                {f.package || 'no pkg'} · {f.services.length}s · {countMessages(f.messages)}m
              </div>
            </button>
          ))}
        </div>
        {selectedProto ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="pp-heading text-base">{selectedProto.name}</h4>
                <div className="text-xs text-pp-muted">
                  pkg {selectedProto.package || 'none'} · {selectedProto.dependencies.length} deps
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="pp-button-secondary text-xs"
                  type="button"
                  onClick={() => onExportProto(selectedProto)}
                >
                  <Download className="size-3" />
                  .proto
                </button>
                <button
                  className="pp-button-ghost text-xs"
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(selectedProto.protoText)}
                >
                  <Copy className="size-3" />
                  Copy
                </button>
              </div>
            </div>
            {selectedProto.services.map((svc) => (
              <div key={svc.fullName} className="pp-panel">
                <div className="text-sm font-semibold text-pp-ink">{svc.fullName}</div>
                <div className="mt-2 space-y-1">
                  {svc.methods.map((m) => (
                    <div
                      key={m.fullName}
                      className="flex items-center justify-between rounded border border-pp-border bg-pp-bg px-2 py-1 text-xs"
                    >
                      <span className="font-medium">{m.name}</span>
                      <span className="font-mono text-pp-muted">
                        {m.requestType} → {m.responseType}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {selectedProto.messages.map((m) => (
              <ProtoMsg key={m.fullName} message={m} />
            ))}
            {selectedProto.enums.map((e) => (
              <ProtoEnum key={e.fullName} entry={e} />
            ))}
            <div>
              <span className="pp-label">Raw proto</span>
              <pre className="pp-code mt-1 max-h-80 overflow-auto text-xs">
                {selectedProto.protoText}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-sm text-pp-muted">Select a file to inspect.</div>
        )}
      </div>
    </div>
  );
}

// ─── Workspace view ────────────────────────────────────────────

function WorkspaceView({
  targets,
  activeTargetId,
  draft,
  busy,
  error,
  rootBootstrap,
  onChangeDraft,
  onSaveAndConnect,
  onConnect,
  onEdit,
  onDelete,
  onReset,
  onOpenDiscovered,
}: {
  targets: WorkspaceTargetProfile[];
  activeTargetId: string;
  draft: WorkspaceTargetProfile;
  busy: boolean;
  error: string | null;
  rootBootstrap: BootstrapResponse | null;
  onChangeDraft: (n: Partial<WorkspaceTargetProfile>) => void;
  onSaveAndConnect: () => void;
  onConnect: (t: WorkspaceTargetProfile) => void;
  onEdit: (t: WorkspaceTargetProfile) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
  onOpenDiscovered: (result: ScanResult) => void;
}) {
  return (
    <div className="space-y-6">
      <DiscoveryPanel onOpenGRPC={onOpenDiscovered} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="pp-heading text-base">Target connection</h3>
          {error ? <StatusBanner tone="danger" title="Error" description={error} /> : null}
          <TargetForm
            draft={draft}
            busy={busy}
            onChange={onChangeDraft}
            onSaveAndConnect={onSaveAndConnect}
          />
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="pp-heading text-base">Successful connections</h3>
            {rootBootstrap?.launcherMode ? (
              <button className="pp-button-ghost text-xs" type="button" onClick={onReset}>
                Launcher
              </button>
            ) : null}
          </div>
          {targets.length === 0 ? (
            <div className="text-sm text-pp-muted">No successful connections yet.</div>
          ) : (
            <div className="space-y-2">
              {targets.map((t) => (
                <div key={t.id} className="rounded-lg border border-pp-border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-pp-ink">{t.name}</div>
                      <div className="text-xs text-pp-muted">{t.address}</div>
                    </div>
                    {t.id === activeTargetId ? (
                      <span className="pp-badge text-pp-ok">Active</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="pp-badge">{schemaSourceLabel(t.schemaSource)}</span>
                    <span className="pp-badge">{t.plaintext ? 'Plain' : 'TLS'}</span>
                    {t.insecure ? (
                      <span className="pp-badge text-amber-600">Skip verify</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="pp-button-primary py-1 text-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => onConnect(t)}
                    >
                      {busy ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : (
                        <Play className="size-3" />
                      )}
                      Connect
                    </button>
                    <button
                      className="pp-button-secondary py-1 text-xs"
                      type="button"
                      onClick={() => onEdit(t)}
                    >
                      Edit
                    </button>
                    <button
                      className="pp-button-ghost py-1 text-xs"
                      type="button"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => onDelete(t.id)}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Launcher view (no services discovered yet) ────────────────

function LauncherView({
  bootstrap,
  targets,
  activeTargetId,
  draft,
  busy,
  error,
  onChangeDraft,
  onSaveAndConnect,
  onConnect,
  onEdit,
  onDelete,
  onOpenDiscovered,
}: {
  bootstrap: BootstrapResponse;
  targets: WorkspaceTargetProfile[];
  activeTargetId: string;
  draft: WorkspaceTargetProfile;
  busy: boolean;
  error: string | null;
  onChangeDraft: (n: Partial<WorkspaceTargetProfile>) => void;
  onSaveAndConnect: () => void;
  onConnect: (t: WorkspaceTargetProfile) => void;
  onEdit: (t: WorkspaceTargetProfile) => void;
  onDelete: (id: string) => void;
  onOpenDiscovered: (result: ScanResult) => void;
}) {
  return (
    <div className="pp-launcher">
      <header className="pp-launcher-header">
        <div className="pp-wordmark">
          <span className="pp-wordmark-icon">
            <ProtoPeekMark />
          </span>
          <span>ProtoPeek</span>
          <span className="pp-version">{displayBuildVersion(bootstrap.version)}</span>
        </div>
        <span className="pp-local-indicator">
          <LockKeyhole aria-hidden="true" /> Local only
        </span>
      </header>
      <div className="pp-launcher-main">
        <section className="pp-launcher-intro">
          <span className="pp-kicker">gRPC workbench</span>
          <h1>Open a gRPC target.</h1>
          <p>Reflection first. Proto files and protosets when you need them.</p>
          <div className="pp-trust-row">
            <span>Auto-find loopback services</span>
            <span>
              <LockKeyhole aria-hidden="true" /> No account, cloud, or database
            </span>
          </div>
        </section>

        <section className="pp-launcher-card" aria-labelledby="connect-title">
          <div className="pp-card-heading">
            <div>
              <span className="pp-kicker">New session</span>
              <h2 id="connect-title">Connect a target</h2>
            </div>
            <span className="pp-reflection-chip">Reflection ready</span>
          </div>
          {error ? (
            <StatusBanner tone="danger" title="Connection failed" description={error} />
          ) : null}
          <TargetForm
            draft={draft}
            busy={busy}
            onChange={onChangeDraft}
            onSaveAndConnect={onSaveAndConnect}
          />
        </section>

        <DiscoveryPanel
          autoStart
          initialTarget={bootstrap.initialScanTarget}
          onOpenGRPC={onOpenDiscovered}
        />

        <section className="pp-saved-targets" aria-labelledby="saved-targets-title">
          <div className="pp-card-heading">
            <div>
              <span className="pp-kicker">Recent</span>
              <h2 id="saved-targets-title">Successful connections</h2>
            </div>
            <span className="pp-version">{targets.length} recent</span>
          </div>
          {targets.length === 0 ? (
            <div className="pp-launcher-empty">
              A target appears here only after it connects successfully.
            </div>
          ) : (
            <div className="pp-target-list">
              {targets.map((t) => (
                <div key={t.id} className="pp-target-row">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-pp-ink">{t.name}</div>
                      <div className="text-xs text-pp-muted">{t.address}</div>
                    </div>
                    {t.id === activeTargetId ? (
                      <span className="pp-badge text-pp-ok">Active</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="pp-badge">{schemaSourceLabel(t.schemaSource)}</span>
                    <span className="pp-badge">{t.plaintext ? 'Plain' : 'TLS'}</span>
                    {t.insecure ? (
                      <span className="pp-badge text-amber-600">Skip verify</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="pp-button-primary py-1 text-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => onConnect(t)}
                    >
                      {busy ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : (
                        <Play className="size-3" />
                      )}
                      Connect
                    </button>
                    <button
                      className="pp-button-secondary py-1 text-xs"
                      type="button"
                      onClick={() => onEdit(t)}
                    >
                      Edit
                    </button>
                    <button
                      className="pp-button-ghost py-1 text-xs"
                      type="button"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => onDelete(t.id)}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <footer className="pp-launcher-footer">
        Nothing leaves this device. ProtoPeek stores workspace preferences in this browser only.
      </footer>
    </div>
  );
}

// ─── Target form ───────────────────────────────────────────────

function TargetForm({
  draft,
  busy,
  onChange,
  onSaveAndConnect,
}: {
  draft: WorkspaceTargetProfile;
  busy: boolean;
  onChange: (n: Partial<WorkspaceTargetProfile>) => void;
  onSaveAndConnect: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="pp-label">Address</span>
          <input
            className="pp-input mt-1"
            value={draft.address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="localhost:50051"
          />
        </label>
        <label className="block">
          <span className="pp-label">
            Name <small>optional</small>
          </span>
          <input
            className="pp-input mt-1"
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Local dev"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="pp-label">Schema source</span>
          <select
            className="pp-input mt-1"
            value={draft.schemaSource}
            onChange={(e) =>
              onChange({ schemaSource: e.target.value as WorkspaceTargetProfile['schemaSource'] })
            }
          >
            <option value="reflection">Reflection</option>
            <option value="proto-files">Proto files</option>
            <option value="protoset">Protoset</option>
          </select>
        </label>
        <div className="pp-transport-choice">
          <span className="pp-label">Transport</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.plaintext}
              onChange={(e) =>
                onChange({
                  plaintext: e.target.checked,
                  insecure: e.target.checked ? false : draft.insecure,
                })
              }
            />
            {draft.plaintext ? 'Plaintext' : 'TLS'}
          </label>
        </div>
      </div>
      <details className="pp-target-advanced">
        <summary>Advanced connection options</summary>
        <div className="pp-target-advanced-body">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="pp-label">Authority</span>
              <input
                className="pp-input mt-1"
                value={draft.authority}
                onChange={(e) => onChange({ authority: e.target.value })}
                placeholder="grpc.example.internal"
              />
            </label>
            <label className="block">
              <span className="pp-label">Notes</span>
              <input
                className="pp-input mt-1"
                value={draft.notes}
                onChange={(e) => onChange({ notes: e.target.value })}
                placeholder="Optional context"
              />
            </label>
          </div>
          {!draft.plaintext ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.insecure}
                onChange={(e) => onChange({ insecure: e.target.checked })}
              />
              Skip certificate verification
            </label>
          ) : null}
          {!draft.plaintext ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="pp-label">CA cert</span>
                <input
                  className="pp-input mt-1"
                  value={draft.cacertPath}
                  onChange={(e) => onChange({ cacertPath: e.target.value })}
                  placeholder="/certs/ca.pem"
                />
              </label>
              <label className="block">
                <span className="pp-label">Client cert</span>
                <input
                  className="pp-input mt-1"
                  value={draft.certPath}
                  onChange={(e) => onChange({ certPath: e.target.value })}
                  placeholder="/certs/client.pem"
                />
              </label>
              <label className="block">
                <span className="pp-label">Client key</span>
                <input
                  className="pp-input mt-1"
                  value={draft.keyPath}
                  onChange={(e) => onChange({ keyPath: e.target.value })}
                  placeholder="/certs/key.pem"
                />
              </label>
            </div>
          ) : null}
          {draft.schemaSource === 'proto-files' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="pp-label">Proto files</span>
                <textarea
                  className="pp-input mt-1 font-mono text-xs"
                  rows={3}
                  value={draft.protoFiles.join('\n')}
                  onChange={(e) => onChange({ protoFiles: parseMultilineValues(e.target.value) })}
                  placeholder="api/service.proto"
                />
              </label>
              <label className="block">
                <span className="pp-label">Import paths</span>
                <textarea
                  className="pp-input mt-1 font-mono text-xs"
                  rows={3}
                  value={draft.importPaths.join('\n')}
                  onChange={(e) => onChange({ importPaths: parseMultilineValues(e.target.value) })}
                  placeholder="proto"
                />
              </label>
            </div>
          ) : null}
          {draft.schemaSource === 'protoset' ? (
            <label className="block">
              <span className="pp-label">Protoset files</span>
              <textarea
                className="pp-input mt-1 font-mono text-xs"
                rows={3}
                value={draft.protosets.join('\n')}
                onChange={(e) => onChange({ protosets: parseMultilineValues(e.target.value) })}
                placeholder="dist/service.protoset"
              />
            </label>
          ) : null}
        </div>
      </details>
      <div className="flex gap-2">
        <button
          className="pp-button-primary"
          type="button"
          disabled={busy}
          onClick={onSaveAndConnect}
        >
          {busy ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Connect
        </button>
      </div>
    </div>
  );
}

// ─── Small shared components ───────────────────────────────────

function _MethodBadge({ method }: { method: BootstrapMethod }) {
  const mode = `${method.clientStreaming ? 'client stream' : 'unary'} → ${method.serverStreaming ? 'server stream' : 'unary'}`;
  return <span className="pp-badge">{mode}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-pp-border bg-white p-3">
      <div className="pp-label">{label}</div>
      <div className="mt-1 text-sm font-semibold text-pp-ink">{value}</div>
    </div>
  );
}

function StatusBanner({
  tone,
  title,
  description,
}: {
  tone: 'danger' | 'info';
  title: string;
  description: string;
}) {
  return (
    <div
      className={classNames(
        'rounded-lg border p-3',
        tone === 'danger' ? 'border-pp-danger/30 bg-red-50' : 'border-pp-brand/30 bg-blue-50'
      )}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-pp-ink">
        {tone === 'danger' ? (
          <CircleAlert className="size-4 text-pp-danger" />
        ) : (
          <Clock3 className="size-4 text-pp-brand" />
        )}
        {title}
      </div>
      <p className="pp-muted mt-1">{description}</p>
    </div>
  );
}

function MetadataTable({ title, values }: { title: string; values: MetadataEntry[] }) {
  return (
    <div className="rounded-lg border border-pp-border bg-white p-3">
      <span className="pp-label">{title}</span>
      {values.length === 0 ? (
        <div className="mt-2 text-xs text-pp-muted">None.</div>
      ) : (
        <div className="mt-2 space-y-1">
          {values.map((e, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: read-only response metadata, never reordered
              key={i}
              className="flex gap-2 rounded border border-pp-border bg-pp-bg px-2 py-1 text-xs"
            >
              <span className="shrink-0 font-mono font-semibold text-pp-ink">{e.name}</span>
              <span className="break-all font-mono text-pp-muted">{e.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PayloadBlock({ title, values }: { title: string; values: unknown[] }) {
  return (
    <div className="rounded-lg border border-pp-border bg-white p-3">
      <span className="pp-label">{title}</span>
      {values.length === 0 ? (
        <div className="mt-2 text-xs text-pp-muted">No payloads.</div>
      ) : (
        <div className="mt-2 space-y-2">
          {values.map((v, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: read-only response payload list, never reordered
            <pre key={i} className="pp-code text-xs">
              {prettyJson(v)}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaField({
  field,
  schema,
  depth,
}: {
  field: SchemaResponse['messageTypes'][string][number];
  schema: SchemaResponse;
  depth: number;
}) {
  return (
    <div className="rounded border border-pp-border bg-pp-bg p-2" style={{ marginLeft: depth * 8 }}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs font-semibold text-pp-ink">{field.name}</span>
        <span className="pp-badge">{field.type}</span>
        {field.isRequired ? <span className="pp-badge text-amber-600">req</span> : null}
        {field.isArray ? <span className="pp-badge">[]</span> : null}
        {field.isMap ? <span className="pp-badge">map</span> : null}
      </div>
      {field.description ? (
        <div className="mt-1 text-[0.65rem] text-pp-muted">{field.description}</div>
      ) : null}
      {field.isMessage && depth < 6 && schema.messageTypes[field.type]?.length ? (
        <div className="mt-1 space-y-1">
          {schema.messageTypes[field.type].map((nf) => (
            <SchemaField
              key={`${field.name}-${nf.name}`}
              field={nf}
              schema={schema}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
      {field.type === 'oneof' && field.oneOfFields.length > 0 ? (
        <div className="mt-1 space-y-1">
          {field.oneOfFields.map((c) => (
            <SchemaField
              key={`${field.name}-${c.name}`}
              field={c}
              schema={schema}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProtoMsg({ message }: { message: ProtoMessageSummary }) {
  return (
    <div className="rounded-lg border border-pp-border bg-white p-3">
      <div className="text-sm font-semibold text-pp-ink">{message.fullName}</div>
      <div className="mt-2 space-y-1">
        {message.fields.map((f) => (
          <div
            key={`${message.fullName}-${f.name}`}
            className="flex flex-wrap items-center gap-1 rounded border border-pp-border bg-pp-bg px-2 py-1 text-xs"
          >
            <span className="font-semibold text-pp-ink">{f.name}</span>
            <span className="pp-badge">{f.type}</span>
            <span className="pp-badge">{f.label}</span>
            {f.oneOf ? <span className="pp-badge">oneof {f.oneOf}</span> : null}
            {f.map ? <span className="pp-badge">map</span> : null}
          </div>
        ))}
      </div>
      {message.enums.length > 0 ? (
        <div className="mt-2 space-y-1">
          {message.enums.map((e) => (
            <ProtoEnum key={e.fullName} entry={e} />
          ))}
        </div>
      ) : null}
      {message.messages.length > 0 ? (
        <div className="mt-2 space-y-1">
          {message.messages.map((m) => (
            <ProtoMsg key={m.fullName} message={m} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProtoEnum({ entry }: { entry: ProtoEnumSummary }) {
  return (
    <div className="rounded-lg border border-pp-border bg-white p-3">
      <div className="text-xs font-semibold text-pp-ink">{entry.fullName}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {entry.values.map((v) => (
          <span key={`${entry.fullName}-${v.name}`} className="pp-badge">
            {v.name}={v.number}
          </span>
        ))}
      </div>
    </div>
  );
}

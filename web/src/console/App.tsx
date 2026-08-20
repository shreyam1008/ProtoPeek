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
  type ReactNode,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { BrowserProtoFolderSelection } from '@/shared/proto-folder';
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
  RepeatAttempt,
  RepeatConfig,
  RepeatRun,
  RepeatStopReason,
  RequestHistoryEntry,
  SavedCollection,
  SchemaResponse,
  WorkspaceTargetConfig,
  WorkspaceTargetProfile,
} from '@/shared/types';
import {
  appStorageKeys,
  buildRepeatRun,
  classNames,
  compactDate,
  displayBuildVersion,
  durationLabel,
  evaluateAssertions,
  filterMetadataForInvoke,
  generateRequestTemplate,
  loadStoredValue,
  loadStoredWorkspaceSection,
  matchesMethodFilter,
  modifierKeyLabel,
  prepareMetadataForReplay,
  prettyJson,
  redactedValue,
  removeStoredValue,
  type StoredWorkspaceRecovery,
  safeParseJson,
  sanitizeAssertionForPersistence,
  serializeRepeatRun,
  serializeWorkspaceExport,
  sparklinePath,
  storeValue,
  storeValuesAtomically,
  toCollection,
  toEnvironmentPreset,
  toHistoryEntry,
  toWorkspaceTargetProfile,
  uid,
  validateRepeatConfig,
  validateWorkspaceImport,
  workspaceImportLimits,
  workspaceImportMaxBytes,
  workspaceSchemaSourceLabel,
  workspaceTargetReferenceError,
} from '@/shared/utils';

import {
  checkHealth,
  connectWorkspaceTarget,
  disconnectWorkspaceSession,
  fetchBootstrap,
  fetchProtoCatalog,
  fetchSchema,
  fetchWorkspaceProtoCatalog,
  fetchWorkspaceSchema,
  invokeMethod,
  invokeWorkspaceMethod,
  type ScanResult,
  watchHealth,
} from './api';
import { BrowserProtoFolderPicker } from './BrowserProtoFolderPicker';
import { CallWorkspace } from './CallWorkspace';
import { CommandPalette, type PaletteAction } from './CommandPalette';
import { DiscoveryPanel } from './DiscoveryScanner';
import { HealthPanel } from './HealthPanel';
import {
  applyHealthCheckResult,
  applyHealthWatchEvent,
  finishHealthRun,
  type HealthRun,
  type HealthRunEndReason,
  hasCanonicalHealthDescriptor,
} from './health';
import { protocolShellEvents } from './ProtocolShellContext';
import { ProtoPeekMark } from './ProtoPeekMark';
import { ServiceNavigator, type WorkbenchView } from './ServiceNavigator';
import { initialConsoleSession, sessionReducer } from './session';
import { WorkbenchHeader } from './WorkbenchHeader';

type ActiveView = WorkbenchView;

type OperationMessage = {
  tone: 'danger' | 'info';
  title: string;
  description: string;
  actions?: Array<{ label: string; run: () => void }>;
};

type WorkspaceStorageSection =
  | 'assertions'
  | 'collections'
  | 'environments'
  | 'history'
  | 'targets';

const workspaceSectionByStorageKey = new Map<string, WorkspaceStorageSection>([
  [appStorageKeys.assertions, 'assertions'],
  [appStorageKeys.collections, 'collections'],
  [appStorageKeys.environments, 'environments'],
  [appStorageKeys.history, 'history'],
  [appStorageKeys.targets, 'targets'],
]);

function prepareWorkspaceStorageValue(key: string, value: unknown) {
  const section = workspaceSectionByStorageKey.get(key);
  if (!section) {
    return { ok: false as const, error: 'Unknown workspace storage section.' };
  }
  const validated = validateWorkspaceImport({ [section]: value });
  if (validated.error || !validated.value) {
    return {
      ok: false as const,
      error: validated.error || `Invalid ${section} workspace data.`,
    };
  }
  return { ok: true as const, value: validated.value[section] ?? [] };
}

function prepareWorkspaceStorageWrites(entries: Array<[string, unknown]>) {
  const values: Array<[string, unknown]> = [];
  for (const [key, value] of entries) {
    const prepared = prepareWorkspaceStorageValue(key, value);
    if (!prepared.ok) return prepared;
    values.push([key, prepared.value]);
  }
  return { ok: true as const, values };
}

const repeatAggregateLimitMs = 60_000;
const repeatErrorMessageLimit = 2048;
const defaultRepeat: RepeatConfig = { count: 5, thinkTimeMs: 0, deadlineSeconds: 5 };

type ActiveRepeat = {
  controller: AbortController;
  stopReason: RepeatStopReason | null;
};

type LocalHealthStopReason = Extract<
  HealthRunEndReason,
  'user-cancelled' | 'navigation' | 'context-changed' | 'relay-error' | 'protocol-error'
>;

type ActiveHealth = {
  controller: AbortController;
  generation: number;
  operation: 'check' | 'watch';
};

function repeatAbortError() {
  return new DOMException('Repeat cancelled.', 'AbortError');
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(repeatAbortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(repeatAbortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}

function waitForRepeatDelay(delayMs: number, signal: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(repeatAbortError());
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      window.clearTimeout(timer);
      reject(repeatAbortError());
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function boundedRepeatError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : '';
  return (message || fallback).slice(0, repeatErrorMessageLimit);
}

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

const repeatPresets: Array<{ label: string; config: RepeatConfig }> = [
  { label: 'Quick', config: { count: 5, thinkTimeMs: 0, deadlineSeconds: 5 } },
  { label: 'Tail sample', config: { count: 20, thinkTimeMs: 0, deadlineSeconds: 5 } },
  { label: 'Paced', config: { count: 20, thinkTimeMs: 250, deadlineSeconds: 5 } },
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

function countMessages(msgs: ProtoMessageSummary[]): number {
  return msgs.reduce((t, m) => t + 1 + countMessages(m.messages), 0);
}

function countEnums(msgs: ProtoMessageSummary[], enums: ProtoEnumSummary[]): number {
  return enums.length + msgs.reduce((t, m) => t + countEnums(m.messages, m.enums), 0);
}

function remapImportedTargetIDs(
  data: NonNullable<ReturnType<typeof validateWorkspaceImport>['value']>,
  currentTargets: WorkspaceTargetProfile[]
) {
  const referenceError = workspaceTargetReferenceError(
    [...data.collections, ...(data.history ?? [])],
    data.sections.targets ? data.targets : currentTargets
  );
  if (referenceError) throw new Error(referenceError);
  const targetIDs = new Map<string, string>();
  const importedTargetsByID = new Map<string, WorkspaceTargetProfile>();
  const targets = data.targets.map((target) => {
    const nextID = uid('target');
    targetIDs.set(target.id.trim(), nextID);
    importedTargetsByID.set(target.id.trim(), target);
    return { ...target, id: nextID };
  });
  const currentTargetsByID = new Map(currentTargets.map((target) => [target.id.trim(), target]));
  const remapScope = <T extends { targetId?: string; targetAddress?: string }>(entry: T): T => {
    const targetId = entry.targetId?.trim();
    const targetAddress = entry.targetAddress?.trim() || undefined;
    if (!targetId) return { ...entry, targetId: undefined, targetAddress };
    if (targetIDs.has(targetId)) {
      const target = importedTargetsByID.get(targetId);
      if (targetAddress && target && targetAddress !== target.address.trim()) {
        throw new Error(`Saved request target address conflicts with profile ${targetId}.`);
      }
      return { ...entry, targetId: targetIDs.get(targetId), targetAddress };
    }
    if (!data.sections.targets && currentTargetsByID.has(targetId)) {
      const target = currentTargetsByID.get(targetId);
      if (targetAddress && target && targetAddress !== target.address.trim()) {
        throw new Error(`Saved request target address conflicts with profile ${targetId}.`);
      }
      return { ...entry, targetId, targetAddress };
    }
    if (!targetAddress) {
      throw new Error(
        `Saved request target ${targetId} is not present and has no address fallback.`
      );
    }
    return { ...entry, targetId, targetAddress };
  };
  return {
    ...data,
    targets,
    collections: data.collections.map(remapScope),
    history: data.history?.map(remapScope),
  };
}

export function App() {
  const [consoleSession, dispatchSession] = useReducer(sessionReducer, initialConsoleSession);
  const rootBootstrap = consoleSession.rootBootstrap;
  const bootstrap = consoleSession.bootstrap;
  const workspaceSessionId = consoleSession.sessionId;
  const activeTargetId = consoleSession.activeTargetId;
  const workspaceBusy = consoleSession.connectStatus === 'connecting';
  const [schemaResource, setSchemaResource] = useState<{
    method: string;
    sessionId: string;
    data: SchemaResponse | null;
  }>({ method: '', sessionId: '', data: null });
  const [initialWorkspace] = useState(() => ({
    assertions: loadStoredWorkspaceSection(
      appStorageKeys.assertions,
      'assertions',
      defaultAssertions
    ),
    collections: loadStoredWorkspaceSection(appStorageKeys.collections, 'collections', []),
    environments: loadStoredWorkspaceSection(appStorageKeys.environments, 'environments', []),
    history: loadStoredWorkspaceSection(appStorageKeys.history, 'history', []),
    targets: loadStoredWorkspaceSection(appStorageKeys.targets, 'targets', []),
  }));
  const initialRecoveries = Object.values(initialWorkspace)
    .map((entry) => entry.recovery)
    .filter((entry): entry is StoredWorkspaceRecovery => entry !== null);
  const blockedWorkspaceStorageRef = useRef(
    new Set(initialRecoveries.map((recovery) => recovery.key))
  );
  const [workspaceRecoveries, setWorkspaceRecoveries] =
    useState<StoredWorkspaceRecovery[]>(initialRecoveries);
  const [targets, setTargets] = useState<WorkspaceTargetProfile[]>(initialWorkspace.targets.value);
  const [targetDraft, setTargetDraft] = useState<WorkspaceTargetProfile>(newTargetDraft());
  const [browserProtoFolder, setBrowserProtoFolder] = useState<BrowserProtoFolderSelection | null>(
    null
  );
  const [browserProtoFolderBusy, setBrowserProtoFolderBusy] = useState(false);
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
    initialWorkspace.collections.value
  );
  const [environments, setEnvironments] = useState<EnvironmentPreset[]>(
    initialWorkspace.environments.value
  );
  const [history, setHistory] = useState<RequestHistoryEntry[]>(initialWorkspace.history.value);
  const [collectionName, setCollectionName] = useState('');
  const [collectionNotes, setCollectionNotes] = useState('');
  const [environmentName, setEnvironmentName] = useState('');
  const [environmentNotes, setEnvironmentNotes] = useState('');
  const [assertionRules, setAssertionRules] = useState<AssertionRule[]>(
    initialWorkspace.assertions.value
  );
  const [assertionResults, setAssertionResults] = useState<AssertionResult[]>([]);
  const [invokeState, setInvokeState] = useState<{
    loading: boolean;
    error: string | null;
    result: InvokeResponse | null;
    latencyMs: number;
  }>({ loading: false, error: null, result: null, latencyMs: 0 });
  const [repeatConfig, setRepeatConfig] = useState<RepeatConfig>(defaultRepeat);
  const [repeatRun, setRepeatRun] = useState<RepeatRun | null>(null);
  const [repeatBusy, setRepeatBusy] = useState(false);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [repeatProgress, setRepeatProgress] = useState({ attempted: 0, requested: 0 });
  const [healthService, setHealthService] = useState('');
  const [healthCheckDeadlineSeconds, setHealthCheckDeadlineSeconds] = useState(5);
  const [healthWatchDurationSeconds, setHealthWatchDurationSeconds] = useState(60);
  const [healthRun, setHealthRun] = useState<HealthRun | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<OperationMessage | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const pendingDraftRef = useRef<{
    method: string;
    metadata: MetadataEntry[];
    timeoutSeconds: number;
    requestText: string;
    redactedCount: number;
    legacyScope: boolean;
    migrationError?: string;
  } | null>(null);
  const connectRequestRef = useRef(0);
  const connectAbortRef = useRef<AbortController | null>(null);
  const invokeAbortRef = useRef<AbortController | null>(null);
  const repeatRef = useRef<ActiveRepeat | null>(null);
  const healthRef = useRef<ActiveHealth | null>(null);
  const healthGenerationRef = useRef(0);
  const workspaceSessionIdRef = useRef(workspaceSessionId);
  workspaceSessionIdRef.current = workspaceSessionId;
  const deferredSearchText = useDeferredValue(searchText);

  useEffect(
    () => () => {
      connectRequestRef.current++;
      const connection = connectAbortRef.current;
      connectAbortRef.current = null;
      connection?.abort();
      const invocation = invokeAbortRef.current;
      invokeAbortRef.current = null;
      invocation?.abort();
      const repeat = repeatRef.current;
      repeatRef.current = null;
      repeat?.controller.abort();
      healthGenerationRef.current++;
      const health = healthRef.current;
      healthRef.current = null;
      health?.controller.abort();
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
    cancelActiveHealth('context-changed');
    invalidateActiveRepeat();
    pendingDraftRef.current = null;
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
  function storeWorkspaceValue(key: string, value: unknown) {
    if (blockedWorkspaceStorageRef.current.has(key)) {
      return {
        ok: false as const,
        error:
          'Resolve the recovered workspace data before replacing this browser-storage section.',
      };
    }
    const prepared = prepareWorkspaceStorageValue(key, value);
    if (!prepared.ok) return prepared;
    return storeValue(key, prepared.value);
  }
  const persistWorkspaceEffect = useEffectEvent((key: string, value: unknown) => {
    if (blockedWorkspaceStorageRef.current.has(key)) return;
    const stored = storeWorkspaceValue(key, value);
    if (stored.ok) return;
    setOperationMessage((current) =>
      current?.tone === 'danger'
        ? current
        : {
            tone: 'danger',
            title: 'Workspace changes are session-only',
            description: `Workspace validation or browser storage refused the write: ${stored.error}`,
          }
    );
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const b = await fetchBootstrap();
        if (cancelled) return;
        dispatchSession({ type: 'bootstrap.loaded', bootstrap: b });
        applyBootstrapEffect(b);
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
    persistWorkspaceEffect(appStorageKeys.collections, collections);
  }, [collections]);
  useEffect(() => {
    persistWorkspaceEffect(appStorageKeys.environments, environments);
  }, [environments]);
  useEffect(() => {
    persistWorkspaceEffect(appStorageKeys.history, history);
  }, [history]);
  useEffect(() => {
    persistWorkspaceEffect(
      appStorageKeys.assertions,
      assertionRules.map(sanitizeAssertionForPersistence)
    );
  }, [assertionRules]);
  useEffect(() => {
    storeValue(appStorageKeys.methodFilter, methodFilter);
  }, [methodFilter]);
  useEffect(() => {
    persistWorkspaceEffect(appStorageKeys.targets, targets);
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
  const activeTarget = targets.find((target) => target.id === activeTargetId) ?? null;
  const currentReplayScope = {
    targetId: activeTarget?.id,
    targetAddress: (activeTarget?.address || bootstrap?.target || '').trim(),
  };
  const q = deferredSearchText.trim().toLowerCase();
  const visibleServices = useMemo(
    () =>
      (bootstrap?.services ?? [])
        .map((service) => {
          const serviceMatches = !q || service.name.toLowerCase().includes(q);
          return {
            ...service,
            methods: service.methods.filter(
              (method) =>
                matchesMethodFilter(method, methodFilter) &&
                (serviceMatches ||
                  !q ||
                  method.name.toLowerCase().includes(q) ||
                  method.fullName.toLowerCase().includes(q))
            ),
          };
        })
        .filter((service) => service.methods.length > 0),
    [bootstrap?.services, methodFilter, q]
  );
  const filteredProtoFiles = useMemo(() => {
    const protoQuery = protoSearchText.trim().toLowerCase();
    return (protoCatalog?.files ?? []).filter((file) => {
      if (!showWellKnownProto && file.wellKnown) return false;
      if (!protoQuery) return true;
      return (
        file.name.toLowerCase().includes(protoQuery) ||
        file.package.toLowerCase().includes(protoQuery) ||
        file.services.some((service) => service.fullName.toLowerCase().includes(protoQuery)) ||
        file.messages.some((message) => message.fullName.toLowerCase().includes(protoQuery))
      );
    });
  }, [protoCatalog?.files, protoSearchText, showWellKnownProto]);
  const selectedProto = useMemo(
    () => filteredProtoFiles.find((file) => file.name === selectedProtoFile) ?? null,
    [filteredProtoFiles, selectedProtoFile]
  );
  const responsePayload = useMemo(
    () => invokeState.result?.responses.map((entry) => entry.message) ?? [],
    [invokeState.result]
  );
  const repeatLatencySparkline = sparklinePath(
    repeatRun?.attempts
      .filter(
        (attempt) =>
          (attempt.outcome === 'ok' || attempt.outcome === 'grpc-error') &&
          (repeatRun.latency.source === 'console-round-trip' || attempt.handlerInvokeMs !== null)
      )
      .map((attempt) =>
        repeatRun.latency.source === 'handler-invoke'
          ? (attempt.handlerInvokeMs ?? 0)
          : attempt.consoleRoundTripMs
      ) ?? [],
    200,
    48
  );
  const passingAssertions = assertionResults.filter((r) => r.passed).length;

  function cancelActiveInvokeSilently() {
    const active = invokeAbortRef.current;
    invokeAbortRef.current = null;
    active?.abort();
  }

  function invalidateActiveRepeat(preserveCompleted = false) {
    const active = repeatRef.current;
    if (!active && preserveCompleted) return;
    repeatRef.current = null;
    active?.controller.abort();
    setRepeatBusy(false);
    setRepeatError(null);
    setRepeatRun(null);
    setRepeatProgress({ attempted: 0, requested: 0 });
  }

  function cancelActiveHealth(reason: LocalHealthStopReason) {
    const active = healthRef.current;
    if (!active) return;
    healthGenerationRef.current++;
    healthRef.current = null;
    active.controller.abort();
    setHealthBusy(false);
    setHealthError(null);
    setHealthRun((current) =>
      current?.phase === 'running' ? finishHealthRun(current, reason) : current
    );
  }

  function healthFailureReason(error: unknown): 'relay-error' | 'protocol-error' {
    return error instanceof Error && /Invalid gRPC Health evidence/i.test(error.message)
      ? 'protocol-error'
      : 'relay-error';
  }

  function invalidateConnectionAttempt() {
    connectRequestRef.current++;
    const active = connectAbortRef.current;
    connectAbortRef.current = null;
    active?.abort();
  }

  function handleCancelConnection() {
    const active = connectAbortRef.current;
    if (!active) return;
    const requestId = connectRequestRef.current;
    connectRequestRef.current = requestId + 1;
    connectAbortRef.current = null;
    active.abort();
    dispatchSession({ type: 'connect.cancelled', requestId });
    setWorkspaceError(null);
  }

  async function handleConnectTarget(
    target: WorkspaceTargetProfile,
    folder?: BrowserProtoFolderSelection
  ) {
    cancelActiveHealth('context-changed');
    invalidateActiveRepeat();
    cancelActiveInvokeSilently();
    pendingDraftRef.current = null;
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
        controller.signal,
        folder
      );
      if (connectRequestRef.current !== requestId) {
        void disconnectWorkspaceSession(r.sessionId);
        return false;
      }
      workspaceSessionIdRef.current = r.sessionId;
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
    } finally {
      if (connectAbortRef.current === controller) connectAbortRef.current = null;
    }
  }

  function materializeTarget(p: WorkspaceTargetProfile) {
    const browserFolderSource = p.schemaSource === 'browser-proto-folder';
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
        protoFiles: browserFolderSource ? [] : p.protoFiles,
        importPaths: browserFolderSource ? [] : p.importPaths,
        protosets: browserFolderSource ? [] : p.protosets,
      },
    });
  }

  function persistTarget(t: WorkspaceTargetProfile) {
    const next = [t, ...targets.filter((entry) => entry.id !== t.id)];
    const stored = storeWorkspaceValue(appStorageKeys.targets, next);
    if (!stored.ok) {
      setOperationMessage({
        tone: 'danger',
        title: 'Target was not saved',
        description: `The connection is live, but the target could not be persisted: ${stored.error}`,
      });
      setTargetDraft(t);
      return;
    }
    setTargets(next);
    setBrowserProtoFolder(null);
    setBrowserProtoFolderBusy(false);
    setTargetDraft(newTargetDraft(rootBootstrap?.targetDefaults));
  }

  async function handleSaveAndConnect() {
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
    const t = reuseExistingTargetID(materializeTarget(targetDraft), targets);
    const folder = t.schemaSource === 'browser-proto-folder' ? browserProtoFolder : undefined;
    if (await handleConnectTarget(t, folder ?? undefined)) persistTarget(t);
  }

  async function handleConnectRecent(target: WorkspaceTargetProfile) {
    const materialized = materializeTarget(target);
    if (materialized.schemaSource === 'browser-proto-folder') {
      setBrowserProtoFolder(null);
      setBrowserProtoFolderBusy(false);
      setTargetDraft(materialized);
      setWorkspaceError('Folder required. Choose the proto folder again before connecting.');
      return;
    }
    if (await handleConnectTarget(materialized)) persistTarget(materialized);
  }

  function handleEditTarget(target: WorkspaceTargetProfile) {
    setBrowserProtoFolder(null);
    setBrowserProtoFolderBusy(false);
    setWorkspaceError(null);
    setTargetDraft(materializeTarget(target));
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
      cancelActiveHealth('context-changed');
      invalidateActiveRepeat();
      invalidateConnectionAttempt();
      cancelActiveInvokeSilently();
      pendingDraftRef.current = null;
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

  function handleResetToLauncher() {
    cancelActiveHealth('context-changed');
    invalidateActiveRepeat();
    invalidateConnectionAttempt();
    cancelActiveInvokeSilently();
    pendingDraftRef.current = null;
    const sessionId = workspaceSessionIdRef.current;
    workspaceSessionIdRef.current = '';
    if (sessionId) void disconnectWorkspaceSession(sessionId);
    dispatchSession({ type: 'connection.cleared' });
    setWorkspaceError(null);
    setBrowserProtoFolder(null);
    setBrowserProtoFolderBusy(false);
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

  function handleBrowserProtoFolderChange(selection: BrowserProtoFolderSelection | null) {
    setBrowserProtoFolder(selection);
    if (selection) setWorkspaceError(null);
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

  function downloadWorkspaceRecovery() {
    downloadFile(
      'protopeek-storage-recovery.json',
      JSON.stringify(
        {
          format: 'protopeek-storage-recovery',
          exportedAt: new Date().toISOString(),
          warning:
            'This is a raw, non-importable recovery snapshot. Readable originals may contain credentials, request bodies, and host file paths. A null raw value means the browser refused the read and the original key was only left untouched.',
          sections: workspaceRecoveries,
        },
        null,
        2
      ),
      'application/json'
    );
  }

  function handleUseRecoveredWorkspace() {
    const values = new Map<string, unknown>([
      [appStorageKeys.assertions, assertionRules.map(sanitizeAssertionForPersistence)],
      [appStorageKeys.collections, collections],
      [appStorageKeys.environments, environments],
      [appStorageKeys.history, history],
      [appStorageKeys.targets, targets],
    ]);
    const writes = workspaceRecoveries.map(
      (recovery) => [recovery.key, values.get(recovery.key) ?? []] as [string, unknown]
    );
    const prepared = prepareWorkspaceStorageWrites(writes);
    if (!prepared.ok) {
      setOperationMessage({
        tone: 'danger',
        title: 'Recovered workspace is not valid yet',
        description: prepared.error,
      });
      return;
    }
    const stored = storeValuesAtomically(prepared.values);
    if (!stored.ok) {
      setOperationMessage({
        tone: 'danger',
        title: 'Recovered workspace remains session-only',
        description: `Recovery remains unresolved. Browser storage reported: ${stored.error} Use the downloaded originals if rollback was incomplete.`,
      });
      return;
    }
    for (const recovery of workspaceRecoveries) {
      blockedWorkspaceStorageRef.current.delete(recovery.key);
    }
    setWorkspaceRecoveries([]);
    setOperationMessage({
      tone: 'info',
      title: 'Recovered workspace accepted',
      description: 'Only the bounded valid records now remain in browser storage.',
    });
  }

  async function handleInvoke() {
    if (healthRef.current) {
      setHealthError('Cancel Health first, then invoke the RPC or run assertions.');
      setActiveView('tests');
      return;
    }
    if (repeatRef.current) {
      setRepeatError('Cancel Repeat first, then invoke the RPC or run assertions.');
      setActiveView('tests');
      return;
    }
    if (!schema || !currentService || !currentMethod) return;
    invalidateActiveRepeat(true);
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
      metadata: filterMetadataForInvoke(metadata),
      data: schema.requestStream ? (parsed.value as unknown[]) : [parsed.value],
    };
    if (payload.metadata.length < metadata.filter((entry) => entry.name.trim()).length) {
      setOperationMessage({
        tone: 'info',
        title: 'Sensitive metadata omitted',
        description:
          'Blank or [redacted] sensitive metadata was not sent. Re-enter the value to include it in a later RPC.',
      });
    }
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
      if (invokeAbortRef.current !== controller) return;
      if (controller.signal.aborted) throw new DOMException('Invocation cancelled.', 'AbortError');
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
            ...currentReplayScope,
          }),
          ...x,
        ].slice(0, 50)
      );
    } catch (err) {
      if (invokeAbortRef.current !== controller) return;
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

  async function handleRepeat() {
    if (healthRef.current) {
      setHealthError('Cancel Health first, then start Unary Repeat.');
      setActiveView('tests');
      return;
    }
    if (!schema || !currentMethod || !bootstrap || repeatRef.current) return;
    if (currentMethod.clientStreaming || currentMethod.serverStreaming || schema.requestStream) {
      setRepeatError('Unary Repeat is available only when request and response are both unary.');
      return;
    }
    const parsed = safeParseJson(requestText);
    if (parsed.error) {
      setRepeatError(parsed.error);
      return;
    }
    if (Array.isArray(parsed.value)) {
      setRepeatError('Unary RPCs need a single JSON object.');
      return;
    }
    const validated = validateRepeatConfig(repeatConfig);
    if (validated.error || !validated.value) {
      setRepeatError(validated.error || 'Repeat settings are invalid.');
      return;
    }

    cancelActiveInvokeSilently();
    setInvokeState({ loading: false, error: null, result: null, latencyMs: 0 });
    setAssertionResults([]);
    const config = validated.value;
    const payload: InvokeRequest = {
      timeout_seconds: config.deadlineSeconds,
      metadata: filterMetadataForInvoke(metadata),
      data: [parsed.value],
    };
    if (payload.metadata.length < metadata.filter((entry) => entry.name.trim()).length) {
      setOperationMessage({
        tone: 'info',
        title: 'Sensitive metadata omitted',
        description:
          'Blank or [redacted] sensitive metadata was not sent. Re-enter the value to include it in a later RPC.',
      });
    }

    const method = currentMethod.fullName;
    const target = bootstrap.target;
    const sessionId = workspaceSessionId;
    const active: ActiveRepeat = { controller: new AbortController(), stopReason: null };
    const { signal } = active.controller;
    repeatRef.current = active;
    setRepeatBusy(true);
    setRepeatError(null);
    setRepeatRun(null);
    setRepeatProgress({ attempted: 0, requested: config.count });
    setActiveView('tests');
    const attempts: RepeatAttempt[] = [];
    const createdAt = new Date().toISOString();
    const startedAt = performance.now();
    const aggregateTimer = window.setTimeout(() => {
      if (repeatRef.current !== active || signal.aborted) return;
      active.stopReason = 'aggregate-limit';
      active.controller.abort();
    }, repeatAggregateLimitMs);

    try {
      for (let index = 0; index < config.count; index++) {
        if (signal.aborted) break;
        const attemptStartedAt = performance.now();
        const common = {
          sequence: index + 1,
          startedOffsetMs: attemptStartedAt - startedAt,
        };
        try {
          const invocation = sessionId
            ? invokeWorkspaceMethod(sessionId, method, payload, signal)
            : invokeMethod(method, payload, signal);
          const result = await awaitWithAbort(invocation, signal);
          if (repeatRef.current !== active) return;
          attempts.push({
            ...common,
            consoleRoundTripMs: performance.now() - attemptStartedAt,
            handlerInvokeMs: result.timings?.totalMs ?? null,
            outcome: result.error ? 'grpc-error' : 'ok',
            responseCount: result.responses.length,
            headerCount: result.headers.length,
            trailerCount: result.trailers.length,
            grpcStatus: result.error
              ? {
                  code: result.error.code,
                  name: result.error.name.slice(0, repeatErrorMessageLimit),
                  message: result.error.message.slice(0, repeatErrorMessageLimit),
                }
              : null,
            error: '',
          });
        } catch (error) {
          if (repeatRef.current !== active) return;
          const cancelled = signal.aborted;
          attempts.push({
            ...common,
            consoleRoundTripMs: performance.now() - attemptStartedAt,
            handlerInvokeMs: null,
            outcome: cancelled ? 'cancelled' : 'relay-transport-error',
            responseCount: 0,
            headerCount: 0,
            trailerCount: 0,
            grpcStatus: null,
            error: cancelled
              ? active.stopReason === 'aggregate-limit'
                ? 'The 60 second Repeat limit was reached.'
                : 'Repeat cancelled.'
              : boundedRepeatError(error, 'ProtoPeek could not complete the request.'),
          });
        }

        setRepeatProgress({ attempted: attempts.length, requested: config.count });
        if (signal.aborted) break;
        if (index < config.count - 1 && config.thinkTimeMs > 0) {
          try {
            await waitForRepeatDelay(config.thinkTimeMs, signal);
          } catch {
            if (repeatRef.current !== active) return;
            break;
          }
        }
      }

      if (repeatRef.current !== active) return;
      setRepeatError(null);
      setRepeatRun(
        buildRepeatRun({
          createdAt,
          method,
          target,
          config,
          attempts,
          totalMs: performance.now() - startedAt,
          stopReason: active.stopReason ?? 'completed',
        })
      );
      setRepeatProgress({ attempted: attempts.length, requested: config.count });
    } finally {
      window.clearTimeout(aggregateTimer);
      if (repeatRef.current === active) {
        repeatRef.current = null;
        setRepeatBusy(false);
      }
    }
  }

  function handleCancelRepeat() {
    const active = repeatRef.current;
    if (!active || active.controller.signal.aborted) return;
    active.stopReason = 'user-cancelled';
    active.controller.abort();
  }

  async function handleHealthOperation(operation: 'check' | 'watch') {
    if (!bootstrap || healthRef.current) return;
    if (repeatRef.current) {
      setHealthError('Cancel Repeat first, then start a Health operation.');
      return;
    }
    if (invokeAbortRef.current || invokeState.loading) {
      setHealthError('Cancel the active RPC first, then start a Health operation.');
      return;
    }
    if (workspaceBusy) {
      setHealthError('Wait for the target connection to settle before starting Health.');
      return;
    }

    const service = healthService.trim();
    if (new TextEncoder().encode(service).byteLength > 1024) {
      setHealthError('Health service exceeds the 1024-byte limit.');
      return;
    }
    if (
      operation === 'check' &&
      (!Number.isFinite(healthCheckDeadlineSeconds) ||
        healthCheckDeadlineSeconds < 0.1 ||
        healthCheckDeadlineSeconds > 30)
    ) {
      setHealthError('Check deadline must be between 0.1 and 30 seconds.');
      return;
    }
    if (
      operation === 'watch' &&
      (!Number.isFinite(healthWatchDurationSeconds) ||
        healthWatchDurationSeconds < 1 ||
        healthWatchDurationSeconds > 600)
    ) {
      setHealthError('Watch duration must be between 1 and 600 seconds.');
      return;
    }

    const sendableMetadata = filterMetadataForInvoke(metadata);
    if (sendableMetadata.length > 64) {
      setHealthError('Health accepts at most 64 sendable metadata entries.');
      return;
    }
    const generation = healthGenerationRef.current + 1;
    healthGenerationRef.current = generation;
    const active: ActiveHealth = {
      controller: new AbortController(),
      generation,
      operation,
    };
    healthRef.current = active;
    let evidence: HealthRun = {
      operation,
      phase: 'running',
      contextKey: healthContextKey,
      target: bootstrap.target,
      service,
      startedAt: new Date().toISOString(),
      metadataCount: sendableMetadata.length,
      checkDeadlineSeconds: operation === 'check' ? healthCheckDeadlineSeconds : null,
      watchDurationSeconds: operation === 'watch' ? healthWatchDurationSeconds : null,
      handlerInvokeMs: null,
      latestStatus: null,
      transitions: [],
      droppedTransitions: 0,
      headers: [],
      trailers: [],
      headersTruncated: false,
      trailersTruncated: false,
      grpcStatus: null,
      endReason: null,
      observationCount: 0,
      error: '',
    };
    const sessionId = workspaceSessionId;
    setHealthRun(evidence);
    setHealthBusy(true);
    setHealthError(null);

    try {
      if (operation === 'check') {
        const result = await checkHealth(
          sessionId,
          {
            service,
            timeout_seconds: healthCheckDeadlineSeconds,
            metadata: sendableMetadata,
          },
          active.controller.signal
        );
        if (healthRef.current !== active || healthGenerationRef.current !== generation) return;
        evidence = applyHealthCheckResult(evidence, result);
        setHealthRun(evidence);
      } else {
        await watchHealth(
          sessionId,
          {
            service,
            duration_seconds: healthWatchDurationSeconds,
            metadata: sendableMetadata,
          },
          (event) => {
            if (healthRef.current !== active || healthGenerationRef.current !== generation) return;
            evidence = applyHealthWatchEvent(evidence, event);
            setHealthRun(evidence);
          },
          active.controller.signal
        );
      }
    } catch (error) {
      if (healthRef.current !== active || healthGenerationRef.current !== generation) return;
      const message =
        error instanceof Error ? error.message.slice(0, 2048) : 'Health operation failed.';
      evidence = finishHealthRun(evidence, healthFailureReason(error), message);
      setHealthRun(evidence);
    } finally {
      if (healthRef.current === active && healthGenerationRef.current === generation) {
        healthRef.current = null;
        setHealthBusy(false);
        setHealthError(null);
      }
    }
  }

  function handleCancelHealth() {
    cancelActiveHealth('user-cancelled');
  }

  function navigateToView(view: ActiveView) {
    if (view !== 'tests') cancelActiveHealth('navigation');
    const active = repeatRef.current;
    if (view !== 'tests' && active && !active.controller.signal.aborted) {
      active.stopReason = 'user-cancelled';
      active.controller.abort();
    }
    setActiveView(view);
  }

  function handleExportRepeat() {
    if (!repeatRun || repeatBusy) return;
    const methodName =
      repeatRun.method
        .split('/')
        .pop()
        ?.replaceAll(/[^a-z0-9_-]/gi, '-') || 'rpc';
    const timestamp = repeatRun.createdAt.replaceAll(/[:.]/g, '-');
    downloadFile(
      `protopeek-repeat-${methodName}-${timestamp}.json`,
      serializeRepeatRun(repeatRun),
      'application/json'
    );
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
      ...currentReplayScope,
    });
    const valid = validateWorkspaceImport({ collections: [c] });
    if (valid.error) {
      setOperationMessage({
        tone: 'danger',
        title: 'Request was not saved',
        description: valid.error,
      });
      return;
    }
    const next = [c, ...collections.filter((entry) => entry.id !== c.id)];
    const stored = storeWorkspaceValue(appStorageKeys.collections, next);
    if (!stored.ok) {
      setOperationMessage({
        tone: 'danger',
        title: 'Request was not saved',
        description: `The request could not be persisted: ${stored.error}`,
      });
      return;
    }
    setCollections(next);
    setCollectionName('');
    setCollectionNotes('');
    const redactedCount = c.metadata.filter((entry) => entry.value === redactedValue).length;
    setOperationMessage({
      tone: 'info',
      title: 'Request saved locally',
      description: redactedCount
        ? `${redactedCount} sensitive metadata ${redactedCount === 1 ? 'value was' : 'values were'} redacted and must be re-entered on replay.`
        : 'The request is scoped to the current target/profile.',
    });
  }

  function _handleSaveEnvironment() {
    const e = toEnvironmentPreset({
      name: environmentName.trim() || `${currentService?.name.split('.').pop() ?? 'default'} env`,
      notes: environmentNotes,
      metadata: metadata.filter((e) => e.name.trim()),
      timeoutSeconds,
    });
    const next = [e, ...environments.filter((item) => item.id !== e.id)];
    const stored = storeWorkspaceValue(appStorageKeys.environments, next);
    if (!stored.ok) {
      setOperationMessage({
        tone: 'danger',
        title: 'Environment was not saved',
        description: stored.error,
      });
      return;
    }
    setEnvironments(next);
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
    if (assertionRules.length >= workspaceImportLimits.assertions) {
      setOperationMessage({
        tone: 'danger',
        title: 'Assertion limit reached',
        description: `A workspace can keep at most ${workspaceImportLimits.assertions} assertions.`,
      });
      return;
    }
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

  function prepareReplay(entry: SavedCollection | RequestHistoryEntry) {
    const methodAvailable = bootstrap?.services.some((service) =>
      service.methods.some((method) => method.fullName === entry.method)
    );
    if (!methodAvailable) {
      pendingDraftRef.current = null;
      setOperationMessage({
        tone: 'danger',
        title: 'Replay refused',
        description: `${entry.method} is not available on the current target. The active request was not changed.`,
      });
      return null;
    }

    const storedTargetId = entry.targetId?.trim() || '';
    const storedTargetAddress = entry.targetAddress?.trim() || '';
    const currentTargetId = currentReplayScope.targetId?.trim() || '';
    const scoped = Boolean(storedTargetId || storedTargetAddress);
    const storedProfileExists = Boolean(
      storedTargetId && targets.some((target) => target.id === storedTargetId)
    );
    const wrongAddress = Boolean(
      storedTargetAddress && storedTargetAddress !== currentReplayScope.targetAddress
    );
    const wrongExistingProfile = Boolean(
      storedTargetId && storedProfileExists && storedTargetId !== currentTargetId
    );
    const orphanedProfile = Boolean(
      storedTargetId &&
        !storedProfileExists &&
        (!storedTargetAddress || currentTargetId || workspaceSessionId || wrongAddress)
    );
    if (scoped && (wrongExistingProfile || orphanedProfile || wrongAddress)) {
      pendingDraftRef.current = null;
      setOperationMessage({
        tone: 'danger',
        title: 'Replay refused',
        description: orphanedProfile
          ? 'The saved target profile is unavailable. Restore that profile or use an address-scoped direct session; the active request was not changed.'
          : 'This record belongs to a different target/profile. Connect that target before applying it; the active request was not changed.',
      });
      return null;
    }

    const restored = prepareMetadataForReplay(entry.metadata);
    return {
      method: entry.method,
      metadata: restored.metadata,
      timeoutSeconds: entry.timeoutSeconds,
      requestText: entry.requestText,
      redactedCount: restored.redactedCount,
      legacyScope: !scoped,
      migrationError: undefined as string | undefined,
    };
  }

  function applyReplayDraft(draft: NonNullable<ReturnType<typeof prepareReplay>>) {
    if (draft.method !== selectedMethod) cancelActiveHealth('context-changed');
    invalidateActiveRepeat();
    cancelActiveInvokeSilently();
    setInvokeState({ loading: false, error: null, result: null, latencyMs: 0 });
    setAssertionResults([]);
    if (draft.method === selectedMethod) {
      pendingDraftRef.current = null;
      setRequestText(draft.requestText);
      setMetadata(draft.metadata);
      setTimeoutSeconds(draft.timeoutSeconds);
      if (draft.migrationError) {
        setOperationMessage({
          tone: 'danger',
          title: 'Legacy replay was not migrated',
          description: draft.migrationError,
        });
      } else if (draft.redactedCount > 0) {
        setOperationMessage({
          tone: 'info',
          title: 'Sensitive metadata omitted',
          description: `${draft.redactedCount} redacted metadata ${draft.redactedCount === 1 ? 'value was' : 'values were'} left blank. Re-enter before invoking; blank or [redacted] sensitive values are never sent.${draft.legacyScope ? ' This legacy record is now scoped to the current target.' : ''}`,
        });
      } else if (draft.legacyScope) {
        setOperationMessage({
          tone: 'info',
          title: 'Legacy replay scoped',
          description:
            'This unscoped legacy record was applied to an available method and is now bound to the current target/profile.',
        });
      } else {
        setOperationMessage(null);
      }
      setActiveView('compose');
      return;
    }
    pendingDraftRef.current = draft;
    startTransition(() => {
      setSelectedMethod(draft.method);
      setActiveView('compose');
    });
  }

  function applyCollection(collection: SavedCollection) {
    const draft = prepareReplay(collection);
    if (!draft) return;
    setCollectionName(collection.name);
    setCollectionNotes(collection.notes);
    if (draft.legacyScope) {
      const migrated = { ...collection, ...currentReplayScope };
      const next = collections.map((entry) => (entry.id === collection.id ? migrated : entry));
      const stored = storeWorkspaceValue(appStorageKeys.collections, next);
      if (!stored.ok) {
        draft.migrationError = `The request was loaded safely for this session, but browser storage failed: ${stored.error}`;
      } else {
        setCollections(next);
      }
    }
    applyReplayDraft(draft);
  }

  function applyHistory(entry: RequestHistoryEntry) {
    const draft = prepareReplay(entry);
    if (!draft) return;
    if (draft.legacyScope) {
      const migrated = { ...entry, ...currentReplayScope };
      const next = history.map((item) => (item.id === entry.id ? migrated : item));
      const stored = storeWorkspaceValue(appStorageKeys.history, next);
      if (!stored.ok) {
        draft.migrationError = `The request was loaded safely for this session, but browser storage failed: ${stored.error}`;
      } else {
        setHistory(next);
      }
    }
    applyReplayDraft(draft);
  }

  function resetRequestFromSchema() {
    if (!schema) return;
    setRequestText(prettyJson(generateRequestTemplate(schema)));
  }

  function handleSelectMethod(method: string) {
    cancelActiveHealth('context-changed');
    invalidateActiveRepeat();
    cancelActiveInvokeSilently();
    pendingDraftRef.current = null;
    setOperationMessage(null);
    setInvokeState({ loading: false, error: null, result: null, latencyMs: 0 });
    startTransition(() => {
      setSelectedMethod(method);
      setActiveView('compose');
      setSidebarOpen(false);
    });
  }

  function handleExportWorkspace() {
    if (workspaceRecoveries.length > 0) {
      setOperationMessage({
        tone: 'danger',
        title: 'Workspace export paused for recovery',
        description:
          'Download or accept the original browser-storage recovery before creating a normal importable workspace.',
      });
      return;
    }
    try {
      const content = serializeWorkspaceExport({
        assertions: assertionRules,
        collections,
        environments,
        targets,
      });
      downloadFile('protopeek-workspace.json', content, 'application/json');
      setOperationMessage({
        tone: 'info',
        title: 'Version 1 workspace exported',
        description:
          'Automatic RPC history was excluded. Saved request bodies are deliberate workspace data; review them before sharing the file.',
      });
    } catch (error) {
      setOperationMessage({
        tone: 'danger',
        title: 'Workspace export refused',
        description: error instanceof Error ? error.message : 'Workspace export failed.',
      });
    }
  }

  async function handleImportWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > workspaceImportMaxBytes) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import refused',
          description: 'The file exceeds the 4 MiB workspace import limit.',
        });
        return;
      }
      const parsed = safeParseJson(await file.text());
      if (parsed.error) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import refused',
          description: `Invalid workspace JSON: ${parsed.error}`,
        });
        return;
      }
      const validated = validateWorkspaceImport(parsed.value);
      if (validated.error || !validated.value) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import refused',
          description: validated.error || 'Invalid workspace JSON.',
        });
        return;
      }
      const imported = remapImportedTargetIDs(validated.value, targets);
      const hasBrowserFolderProfiles = imported.targets.some(
        (target) => target.schemaSource === 'browser-proto-folder'
      );
      const writes: Array<[string, unknown]> = [];
      if (imported.sections.assertions) {
        writes.push([appStorageKeys.assertions, imported.assertions]);
      }
      if (imported.sections.collections) {
        writes.push([appStorageKeys.collections, imported.collections]);
      }
      if (imported.sections.environments) {
        writes.push([appStorageKeys.environments, imported.environments]);
      }
      if (imported.sections.history) writes.push([appStorageKeys.history, imported.history ?? []]);
      if (imported.sections.targets) writes.push([appStorageKeys.targets, imported.targets]);
      const blockedImport = writes.find(([key]) => blockedWorkspaceStorageRef.current.has(key));
      if (blockedImport) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import paused for recovery',
          description:
            'Download or accept the original browser-storage recovery before replacing an affected section.',
        });
        return;
      }
      const prepared = prepareWorkspaceStorageWrites(writes);
      if (!prepared.ok) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace import refused',
          description: prepared.error,
        });
        return;
      }
      const stored = storeValuesAtomically(prepared.values);
      if (!stored.ok) {
        setOperationMessage({
          tone: 'danger',
          title: 'Workspace was not imported',
          description: `Browser storage failed: ${stored.error}`,
        });
        return;
      }

      if (imported.sections.assertions) setAssertionRules(imported.assertions);
      if (imported.sections.collections) setCollections(imported.collections);
      if (imported.sections.environments) setEnvironments(imported.environments);
      if (imported.sections.history) setHistory(imported.history ?? []);
      if (imported.sections.targets) {
        handleResetToLauncher();
        setTargets(imported.targets);
      }
      setOperationMessage({
        tone: 'info',
        title: imported.legacy ? 'Legacy workspace imported safely' : 'Workspace imported',
        description: `${
          imported.hasHostFilePaths
            ? 'No target was connected. Imported proto, protoset, certificate, and key paths refer to paths on the ProtoPeek host; connecting that target grants the ProtoPeek process local file-read authority for those paths.'
            : 'No target was connected. Imported targets remain inactive until you explicitly connect one.'
        }${
          hasBrowserFolderProfiles
            ? ' Browser-folder profiles include no schema snapshot bytes, folder handle, root name, or local path. They show Folder required and must be repicked before connecting.'
            : ''
        }`,
      });
    } catch (error) {
      setOperationMessage({
        tone: 'danger',
        title: 'Workspace import refused',
        description: error instanceof Error ? error.message : 'Workspace import failed.',
      });
    } finally {
      input.value = '';
    }
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
        run: () => handleSelectMethod(method.fullName),
      }))
    ) ?? []),
  ];

  const workspaceNotices = (
    <>
      {workspaceRecoveries.length > 0 ? (
        <div className="px-4 pt-4">
          <StatusBanner
            tone="danger"
            title="Workspace storage needs recovery"
            description={`${workspaceRecoveries.map((recovery) => `${recovery.section}: ${recovery.reason}`).join(' ')} Original keys remain untouched. Download captures exact readable originals; a browser read failure can only be left in place. Accept the bounded valid records explicitly after reviewing the recovery, which may contain credentials, request bodies, and host paths.`}
            actions={[
              { label: 'Download originals', run: downloadWorkspaceRecovery },
              { label: 'Use recovered data', run: handleUseRecoveredWorkspace },
            ]}
          />
        </div>
      ) : null}

      {operationMessage ? (
        <div className="px-4 pt-4">
          <StatusBanner
            tone={operationMessage.tone}
            title={operationMessage.title}
            description={operationMessage.description}
            actions={operationMessage.actions}
            onDismiss={() => setOperationMessage(null)}
          />
        </div>
      ) : null}
    </>
  );

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
        notices={workspaceNotices}
        targets={targets}
        activeTargetId={activeTargetId}
        draft={targetDraft}
        browserProtoFolder={browserProtoFolder}
        browserProtoFolderBusy={browserProtoFolderBusy}
        busy={workspaceBusy}
        error={workspaceError}
        onChangeDraft={updateDraft}
        onBrowserProtoFolderChange={handleBrowserProtoFolderChange}
        onBrowserProtoFolderBusyChange={setBrowserProtoFolderBusy}
        onSaveAndConnect={() => {
          void handleSaveAndConnect();
        }}
        onCancelConnect={handleCancelConnection}
        onConnect={(t) => {
          void handleConnectRecent(t);
        }}
        onEdit={handleEditTarget}
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
            navigateToView(view);
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
          onChange={(event) => void handleImportWorkspace(event)}
        />
      </aside>

      <div className="pp-main">
        <WorkbenchHeader
          target={bootstrap.target}
          targetProfile={activeTarget}
          serviceName={currentService.name}
          method={currentMethod}
          sidebarButtonRef={sidebarToggleRef}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onSwitchTarget={() => {
            if (rootBootstrap?.launcherMode) handleResetToLauncher();
            else navigateToView('workspace');
          }}
        />

        {workspaceNotices}

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
              healthService={healthService}
              onHealthServiceChange={setHealthService}
              selectedHealthService={currentService.name}
              healthServiceSuggestions={healthCatalog.serviceSuggestions}
              healthCheckDeadlineSeconds={healthCheckDeadlineSeconds}
              onHealthCheckDeadlineChange={setHealthCheckDeadlineSeconds}
              healthWatchDurationSeconds={healthWatchDurationSeconds}
              onHealthWatchDurationChange={setHealthWatchDurationSeconds}
              healthRun={healthRun}
              healthBusy={healthBusy}
              healthBlockedBy={
                repeatBusy
                  ? 'Cancel Repeat first to use Health.'
                  : invokeState.loading
                    ? 'Cancel the active RPC first to use Health.'
                    : workspaceBusy
                      ? 'Wait for the target connection to settle.'
                      : null
              }
              healthError={healthError}
              healthAdvertised={healthCatalog.advertised}
              currentHealthContextKey={healthContextKey}
              currentTarget={bootstrap.target}
              onHealthCheck={() => {
                void handleHealthOperation('check');
              }}
              onHealthWatch={() => {
                void handleHealthOperation('watch');
              }}
              onCancelHealth={handleCancelHealth}
              rules={assertionRules}
              results={assertionResults}
              onChangeRule={handleAssertionChange}
              onAddRule={handleAddAssertion}
              onRemoveRule={handleRemoveAssertion}
              onRunAssertions={() => {
                void handleInvoke().then(() => setActiveView('tests'));
              }}
              method={currentMethod}
              repeatConfig={repeatConfig}
              setRepeatConfig={setRepeatConfig}
              repeatRun={repeatRun}
              repeatBusy={repeatBusy}
              repeatError={repeatError}
              repeatProgress={repeatProgress}
              onRepeat={() => {
                void handleRepeat();
              }}
              onCancelRepeat={handleCancelRepeat}
              onExportRepeat={handleExportRepeat}
              repeatLatencySparkline={repeatLatencySparkline}
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
              browserProtoFolder={browserProtoFolder}
              browserProtoFolderBusy={browserProtoFolderBusy}
              busy={workspaceBusy}
              error={workspaceError}
              rootBootstrap={rootBootstrap}
              onChangeDraft={updateDraft}
              onBrowserProtoFolderChange={handleBrowserProtoFolderChange}
              onBrowserProtoFolderBusyChange={setBrowserProtoFolderBusy}
              onSaveAndConnect={() => {
                void handleSaveAndConnect();
              }}
              onCancelConnect={handleCancelConnection}
              onConnect={(t) => {
                void handleConnectRecent(t);
              }}
              onEdit={handleEditTarget}
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
  invokeLoading,
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
  invokeLoading: boolean;
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
  onChangeRule: (id: string, r: AssertionRule) => void;
  onAddRule: () => void;
  onRemoveRule: (id: string) => void;
  onRunAssertions: () => void;
  method: BootstrapMethod;
  repeatConfig: RepeatConfig;
  setRepeatConfig: (fn: (config: RepeatConfig) => RepeatConfig) => void;
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
            <StatusBanner
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
            <StatusBanner
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
              <Metric label="OK" value={String(repeatRun.counts.ok)} />
              <Metric label="gRPC errors" value={String(repeatRun.counts.grpcError)} />
              <Metric
                label="Relay / transport errors"
                value={String(repeatRun.counts.relayTransportError)}
              />
              <Metric label="Cancelled" value={String(repeatRun.counts.cancelled)} />
            </div>
            <div className="pp-repeat-latency">
              <Metric
                label="Min"
                value={
                  repeatRun.latency.minMs === null ? '—' : durationLabel(repeatRun.latency.minMs)
                }
              />
              <Metric
                label="Median"
                value={
                  repeatRun.latency.medianMs === null
                    ? '—'
                    : durationLabel(repeatRun.latency.medianMs)
                }
              />
              <Metric
                label="p95"
                value={
                  repeatRun.latency.p95Ms === null
                    ? `Needs 20 (${repeatRun.latency.sampleCount})`
                    : durationLabel(repeatRun.latency.p95Ms)
                }
              />
              <Metric
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
  browserProtoFolder,
  browserProtoFolderBusy,
  busy,
  error,
  rootBootstrap,
  onChangeDraft,
  onBrowserProtoFolderChange,
  onBrowserProtoFolderBusyChange,
  onSaveAndConnect,
  onCancelConnect,
  onConnect,
  onEdit,
  onDelete,
  onReset,
  onOpenDiscovered,
}: {
  targets: WorkspaceTargetProfile[];
  activeTargetId: string;
  draft: WorkspaceTargetProfile;
  browserProtoFolder: BrowserProtoFolderSelection | null;
  browserProtoFolderBusy: boolean;
  busy: boolean;
  error: string | null;
  rootBootstrap: BootstrapResponse | null;
  onChangeDraft: (n: Partial<WorkspaceTargetProfile>) => void;
  onBrowserProtoFolderChange: (selection: BrowserProtoFolderSelection | null) => void;
  onBrowserProtoFolderBusyChange: (busy: boolean) => void;
  onSaveAndConnect: () => void;
  onCancelConnect: () => void;
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
            browserProtoFolder={browserProtoFolder}
            browserProtoFolderBusy={browserProtoFolderBusy}
            busy={busy}
            onChange={onChangeDraft}
            onBrowserProtoFolderChange={onBrowserProtoFolderChange}
            onBrowserProtoFolderBusyChange={onBrowserProtoFolderBusyChange}
            onSaveAndConnect={onSaveAndConnect}
            onCancelConnect={onCancelConnect}
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
                    <span className="pp-badge">{workspaceSchemaSourceLabel(t.schemaSource)}</span>
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
                      {t.schemaSource === 'browser-proto-folder' ? 'Repick folder' : 'Connect'}
                    </button>
                    <button
                      className="pp-button-secondary py-1 text-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => onEdit(t)}
                    >
                      Edit
                    </button>
                    <button
                      className="pp-button-ghost py-1 text-xs"
                      type="button"
                      aria-label={`Delete ${t.name}`}
                      disabled={busy}
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
  notices,
  targets,
  activeTargetId,
  draft,
  browserProtoFolder,
  browserProtoFolderBusy,
  busy,
  error,
  onChangeDraft,
  onBrowserProtoFolderChange,
  onBrowserProtoFolderBusyChange,
  onSaveAndConnect,
  onCancelConnect,
  onConnect,
  onEdit,
  onDelete,
  onOpenDiscovered,
}: {
  bootstrap: BootstrapResponse;
  notices?: ReactNode;
  targets: WorkspaceTargetProfile[];
  activeTargetId: string;
  draft: WorkspaceTargetProfile;
  browserProtoFolder: BrowserProtoFolderSelection | null;
  browserProtoFolderBusy: boolean;
  busy: boolean;
  error: string | null;
  onChangeDraft: (n: Partial<WorkspaceTargetProfile>) => void;
  onBrowserProtoFolderChange: (selection: BrowserProtoFolderSelection | null) => void;
  onBrowserProtoFolderBusyChange: (busy: boolean) => void;
  onSaveAndConnect: () => void;
  onCancelConnect: () => void;
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
          <LockKeyhole aria-hidden="true" /> Local console
        </span>
      </header>
      {notices}
      <div className="pp-launcher-main">
        <section className="pp-launcher-intro">
          <span className="pp-kicker">gRPC workbench</span>
          <h1>Open a gRPC target.</h1>
          <p>Reflection first. Browser folders or host descriptors when it is off.</p>
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
            browserProtoFolder={browserProtoFolder}
            browserProtoFolderBusy={browserProtoFolderBusy}
            busy={busy}
            onChange={onChangeDraft}
            onBrowserProtoFolderChange={onBrowserProtoFolderChange}
            onBrowserProtoFolderBusyChange={onBrowserProtoFolderBusyChange}
            onSaveAndConnect={onSaveAndConnect}
            onCancelConnect={onCancelConnect}
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
                    <span className="pp-badge">{workspaceSchemaSourceLabel(t.schemaSource)}</span>
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
                      {t.schemaSource === 'browser-proto-folder' ? 'Repick folder' : 'Connect'}
                    </button>
                    <button
                      className="pp-button-secondary py-1 text-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => onEdit(t)}
                    >
                      Edit
                    </button>
                    <button
                      className="pp-button-ghost py-1 text-xs"
                      type="button"
                      aria-label={`Delete ${t.name}`}
                      disabled={busy}
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
        Workspace preferences stay in this browser. Selected schema snapshots go only to this
        running ProtoPeek instance, never to the gRPC target.
      </footer>
    </div>
  );
}

// ─── Target form ───────────────────────────────────────────────

function TargetForm({
  draft,
  browserProtoFolder,
  browserProtoFolderBusy,
  busy,
  onChange,
  onBrowserProtoFolderChange,
  onBrowserProtoFolderBusyChange,
  onSaveAndConnect,
  onCancelConnect,
}: {
  draft: WorkspaceTargetProfile;
  browserProtoFolder: BrowserProtoFolderSelection | null;
  browserProtoFolderBusy: boolean;
  busy: boolean;
  onChange: (n: Partial<WorkspaceTargetProfile>) => void;
  onBrowserProtoFolderChange: (selection: BrowserProtoFolderSelection | null) => void;
  onBrowserProtoFolderBusyChange: (busy: boolean) => void;
  onSaveAndConnect: () => void;
  onCancelConnect: () => void;
}) {
  return (
    <div className="space-y-3">
      <fieldset disabled={busy} className="min-w-0 space-y-3 border-0 p-0">
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
              <option value="browser-proto-folder">Browser folder</option>
              <option value="proto-files">Host proto paths</option>
              <option value="protoset">Host protoset paths</option>
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
        {draft.schemaSource === 'browser-proto-folder' ? (
          <BrowserProtoFolderPicker
            selection={browserProtoFolder}
            onChange={onBrowserProtoFolderChange}
            onBusyChange={onBrowserProtoFolderBusyChange}
            disabled={busy}
          />
        ) : null}
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
                    onChange={(e) =>
                      onChange({ importPaths: parseMultilineValues(e.target.value) })
                    }
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
      </fieldset>
      <div className="flex gap-2">
        <button
          className={busy ? 'pp-button-secondary' : 'pp-button-primary'}
          type="button"
          disabled={
            !busy &&
            (browserProtoFolderBusy ||
              (draft.schemaSource === 'browser-proto-folder' && !browserProtoFolder))
          }
          aria-describedby={
            !busy && draft.schemaSource === 'browser-proto-folder' && !browserProtoFolder
              ? 'pp-browser-proto-folder-required'
              : undefined
          }
          onClick={busy ? onCancelConnect : onSaveAndConnect}
        >
          {busy ? <X className="size-3.5" /> : <Play className="size-3.5" />}
          {busy ? 'Cancel connection' : 'Connect'}
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
  onDismiss,
  actions,
}: {
  tone: 'danger' | 'info';
  title: string;
  description: string;
  onDismiss?: () => void;
  actions?: Array<{ label: string; run: () => void }>;
}) {
  return (
    <div
      className={classNames('pp-operation-banner', tone === 'danger' && 'is-danger')}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-pp-ink">
        {tone === 'danger' ? (
          <CircleAlert className="size-4 text-pp-danger" />
        ) : (
          <Clock3 className="size-4 text-pp-brand" />
        )}
        {title}
        {onDismiss ? (
          <button
            type="button"
            className="pp-operation-dismiss"
            aria-label="Dismiss notification"
            onClick={onDismiss}
          >
            <X className="pp-operation-dismiss-icon" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className="pp-muted mt-1">{description}</p>
      {actions?.length ? (
        <div className="pp-operation-actions">
          {actions.map((action) => (
            <button key={action.label} type="button" onClick={action.run}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
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

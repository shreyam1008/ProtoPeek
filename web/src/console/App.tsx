import {
  Activity,
  BadgeHelp,
  BookMarked,
  BookOpenText,
  Cable,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  FileCode2,
  FlaskConical,
  History,
  Library,
  LoaderCircle,
  Play,
  Save,
  Search,
  Server,
  Sparkles,
  SquareArrowOutUpRight,
  Upload,
} from 'lucide-react';
import {
  type ChangeEvent,
  type ComponentType,
  Fragment,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

import { featureIdeas } from '@/shared/feature-data';
import type {
  AssertionResult,
  AssertionRule,
  BootstrapMethod,
  BootstrapResponse,
  BootstrapService,
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
  durationLabel,
  evaluateAssertions,
  generateRequestTemplate,
  loadStoredValue,
  matchesMethodFilter,
  prettyJson,
  safeParseJson,
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
  fetchBootstrap,
  fetchExamples,
  fetchProtoCatalog,
  fetchSchema,
  fetchWorkspaceProtoCatalog,
  fetchWorkspaceSchema,
  invokeMethod,
  invokeWorkspaceMethod,
} from './api';

type ActiveView = 'compose' | 'response' | 'history' | 'tests' | 'transport' | 'structure';

const defaultSimulation: SimulationConfig = {
  runs: 25,
  concurrency: 5,
  thinkTimeMs: 0,
};

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
    name: 'Latency stays under 800 ms',
    kind: 'latency_ms',
    comparator: 'lte',
    target: '',
    value: '800',
  },
];

const methodFilterOptions: Array<{ value: MethodFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unary', label: 'Unary' },
  { value: 'client-streaming', label: 'Client stream' },
  { value: 'server-streaming', label: 'Server stream' },
  { value: 'bidirectional', label: 'Bidi' },
];

const simulationPresets: Array<{
  label: string;
  description: string;
  config: SimulationConfig;
}> = [
  {
    label: 'Quick pulse',
    description: 'Fast sanity check for local iteration.',
    config: { runs: 12, concurrency: 3, thinkTimeMs: 0 },
  },
  {
    label: 'Burst probe',
    description: 'Short concurrency spike to expose tail latency.',
    config: { runs: 60, concurrency: 12, thinkTimeMs: 0 },
  },
  {
    label: 'Steady soak',
    description: 'Longer run with think time to mimic paced traffic.',
    config: { runs: 120, concurrency: 8, thinkTimeMs: 120 },
  },
];

const assertionKindOptions: Array<{
  value: AssertionRule['kind'];
  label: string;
}> = [
  { value: 'status', label: 'Status' },
  { value: 'latency_ms', label: 'Latency' },
  { value: 'header', label: 'Header' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'response_count', label: 'Response count' },
  { value: 'body_text', label: 'Body text' },
];

const assertionComparatorOptions: Array<{
  value: AssertionRule['comparator'];
  label: string;
}> = [
  { value: 'equals', label: 'equals' },
  { value: 'contains', label: 'contains' },
  { value: 'lte', label: '<=' },
  { value: 'gte', label: '>=' },
];

const transportMoments = [
  {
    title: 'Contract and reflection',
    body: 'Proto files define the contract, and reflection lets ProtoPeek discover services, methods, messages, and enums at runtime.',
  },
  {
    title: 'Metadata before payloads',
    body: 'Headers are part of the request path, not an afterthought. Auth, trace IDs, deadlines, and feature flags travel here.',
  },
  {
    title: 'Messages can stream both ways',
    body: 'Unary is only one mode. gRPC also supports client streaming, server streaming, and full bidi sessions over the same transport.',
  },
  {
    title: 'Status lands with trailers',
    body: 'The final status and trailing metadata often arrive after the response messages, which is why trailer visibility is essential.',
  },
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

export function App() {
  const [rootBootstrap, setRootBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [examples, setExamples] = useState<ExampleResponse[]>([]);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [workspaceSessionId, setWorkspaceSessionId] = useState('');
  const [targets, setTargets] = useState<WorkspaceTargetProfile[]>(
    loadStoredValue<WorkspaceTargetProfile[]>(appStorageKeys.targets, [])
  );
  const [activeTargetId, setActiveTargetId] = useState(
    loadStoredValue<string>(appStorageKeys.activeTargetId, '')
  );
  const [targetDraft, setTargetDraft] = useState<WorkspaceTargetProfile>(newTargetDraft());
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [protoCatalog, setProtoCatalog] = useState<ProtoCatalogResponse | null>(null);
  const [selectedProtoFile, setSelectedProtoFile] = useState('');
  const [protoSearchText, setProtoSearchText] = useState('');
  const [showWellKnownProto, setShowWellKnownProto] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState(
    loadStoredValue<string>(appStorageKeys.selectedMethod, '')
  );
  const [searchText, setSearchText] = useState('');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>(
    loadStoredValue<MethodFilter>(appStorageKeys.methodFilter, 'all')
  );
  const [activeView, setActiveView] = useState<ActiveView>('compose');
  const [requestText, setRequestText] = useState('{}');
  const [timeoutSeconds, setTimeoutSeconds] = useState(15);
  const [metadata, setMetadata] = useState<MetadataEntry[]>([]);
  const [collections, setCollections] = useState<SavedCollection[]>(
    loadStoredValue<SavedCollection[]>(appStorageKeys.collections, [])
  );
  const [environments, setEnvironments] = useState<EnvironmentPreset[]>(
    loadStoredValue<EnvironmentPreset[]>(appStorageKeys.environments, [])
  );
  const [history, setHistory] = useState<RequestHistoryEntry[]>(
    loadStoredValue<RequestHistoryEntry[]>(appStorageKeys.history, [])
  );
  const [collectionName, setCollectionName] = useState('');
  const [collectionNotes, setCollectionNotes] = useState('');
  const [environmentName, setEnvironmentName] = useState('');
  const [environmentNotes, setEnvironmentNotes] = useState('');
  const [assertionRules, setAssertionRules] = useState<AssertionRule[]>(
    loadStoredValue<AssertionRule[]>(appStorageKeys.assertions, defaultAssertions)
  );
  const [assertionResults, setAssertionResults] = useState<AssertionResult[]>([]);
  const [invokeState, setInvokeState] = useState<{
    loading: boolean;
    error: string | null;
    result: InvokeResponse | null;
    latencyMs: number;
  }>({
    loading: false,
    error: null,
    result: null,
    latencyMs: 0,
  });
  const [simulationConfig, setSimulationConfig] = useState(
    loadStoredValue<SimulationConfig>(appStorageKeys.simulation, defaultSimulation)
  );
  const [simulationRun, setSimulationRun] = useState<SimulationRun | null>(null);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pendingDraftRef = useRef<{
    method: string;
    metadata: MetadataEntry[];
    timeoutSeconds: number;
    requestText: string;
  } | null>(null);
  const deferredSearchText = useDeferredValue(searchText);

  function applyBootstrap(nextBootstrap: BootstrapResponse, rememberRoot = false) {
    const availableMethods = nextBootstrap.services.flatMap((service) => service.methods);
    const storedMethod = loadStoredValue<string>(appStorageKeys.selectedMethod, '');
    const initialMethod = availableMethods.some((method) => method.fullName === storedMethod)
      ? storedMethod
      : (availableMethods[0]?.fullName ?? '');

    if (rememberRoot) {
      setRootBootstrap(nextBootstrap);
    }

    setBootstrap(nextBootstrap);
    setBootError(null);
    setWorkspaceError(null);
    setSchema(null);
    setProtoCatalog(null);
    setSelectedProtoFile('');
    setMetadata(nextBootstrap.defaultMetadata);
    setInvokeState({
      loading: false,
      error: null,
      result: null,
      latencyMs: 0,
    });
    setAssertionResults([]);

    if (initialMethod) {
      startTransition(() => {
        setSelectedMethod(initialMethod);
      });
    } else {
      setSelectedMethod('');
    }
  }

  const applyBootstrapEffect = useEffectEvent(
    (nextBootstrap: BootstrapResponse, rememberRoot = false) => {
      applyBootstrap(nextBootstrap, rememberRoot);
    }
  );

  const connectTargetEffect = useEffectEvent((target: WorkspaceTargetProfile) => {
    void handleConnectTarget(target, true);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [bootstrapResponse, exampleResponse] = await Promise.all([
          fetchBootstrap(),
          fetchExamples(),
        ]);
        if (cancelled) {
          return;
        }

        applyBootstrapEffect(bootstrapResponse, true);
        setExamples(exampleResponse);
        setTargetDraft((existing) =>
          existing.address || targets.length > 0
            ? existing
            : newTargetDraft(bootstrapResponse.targetDefaults)
        );
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
  }, [targets.length]);

  useEffect(() => {
    if (!bootstrap || !selectedMethod) {
      return;
    }

    let cancelled = false;

    async function loadMethodSchema() {
      try {
        const nextSchema = workspaceSessionId
          ? await fetchWorkspaceSchema(workspaceSessionId, selectedMethod)
          : await fetchSchema(selectedMethod);
        if (cancelled) {
          return;
        }

        setSchema(nextSchema);
        const pendingDraft =
          pendingDraftRef.current && pendingDraftRef.current.method === selectedMethod
            ? pendingDraftRef.current
            : null;
        const nextTemplate = prettyJson(generateRequestTemplate(nextSchema));
        setRequestText(pendingDraft?.requestText ?? nextTemplate);
        if (pendingDraft) {
          setMetadata(pendingDraft.metadata);
          setTimeoutSeconds(pendingDraft.timeoutSeconds);
          pendingDraftRef.current = null;
        }
        setInvokeState({
          loading: false,
          error: null,
          result: null,
          latencyMs: 0,
        });
      } catch (error) {
        if (!cancelled) {
          setBootError(
            error instanceof Error ? error.message : 'Failed to load the method schema.'
          );
        }
      }
    }

    storeValue(appStorageKeys.selectedMethod, selectedMethod);
    void loadMethodSchema();

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
    storeValue(appStorageKeys.assertions, assertionRules);
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
    if (!rootBootstrap?.launcherMode || !activeTargetId || workspaceSessionId || !bootstrap) {
      return;
    }

    const target = targets.find((entry) => entry.id === activeTargetId);
    if (!target) {
      return;
    }

    connectTargetEffect(target);
  }, [activeTargetId, bootstrap, rootBootstrap, targets, workspaceSessionId]);

  useEffect(() => {
    if (!bootstrap || bootstrap.services.length === 0) {
      return;
    }

    let cancelled = false;

    async function loadProtoData() {
      try {
        const nextCatalog = workspaceSessionId
          ? await fetchWorkspaceProtoCatalog(workspaceSessionId)
          : await fetchProtoCatalog();
        if (cancelled) {
          return;
        }
        setProtoCatalog(nextCatalog);
        const availableFiles = nextCatalog.files.filter(
          (file) => showWellKnownProto || !file.wellKnown
        );
        setSelectedProtoFile((existing) =>
          availableFiles.some((file) => file.name === existing)
            ? existing
            : (availableFiles[0]?.name ?? '')
        );
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(
            error instanceof Error ? error.message : 'Failed to load the proto explorer.'
          );
        }
      }
    }

    void loadProtoData();

    return () => {
      cancelled = true;
    };
  }, [bootstrap, showWellKnownProto, workspaceSessionId]);

  const currentService =
    bootstrap?.services.find((service) =>
      service.methods.some((method) => method.fullName === selectedMethod)
    ) ?? null;
  const currentMethod =
    currentService?.methods.find((method) => method.fullName === selectedMethod) ?? null;
  const matchingExamples = examples.filter(
    (example) =>
      `${example.service}.${example.method}` === selectedMethod ||
      `${example.service}/${example.method}` === selectedMethod
  );

  const methodInventory = bootstrap?.services.flatMap((service) => service.methods) ?? [];
  const query = deferredSearchText.trim().toLowerCase();
  const visibleServices = (bootstrap?.services ?? [])
    .map((service) => {
      const serviceMatches = !query || service.name.toLowerCase().includes(query);
      return {
        ...service,
        methods: service.methods.filter((method) => {
          if (!matchesMethodFilter(method, methodFilter)) {
            return false;
          }

          if (serviceMatches || !query) {
            return true;
          }

          return (
            method.name.toLowerCase().includes(query) ||
            method.fullName.toLowerCase().includes(query)
          );
        }),
      };
    })
    .filter((service) => service.methods.length > 0);

  const methodCounts: Record<MethodFilter, number> = {
    all: methodInventory.length,
    unary: methodInventory.filter((method) => matchesMethodFilter(method, 'unary')).length,
    'client-streaming': methodInventory.filter((method) =>
      matchesMethodFilter(method, 'client-streaming')
    ).length,
    'server-streaming': methodInventory.filter((method) =>
      matchesMethodFilter(method, 'server-streaming')
    ).length,
    bidirectional: methodInventory.filter((method) => matchesMethodFilter(method, 'bidirectional'))
      .length,
  };
  const activeTargetProfile =
    targets.find((target) => target.id === activeTargetId) ??
    targets.find((target) => target.address === bootstrap?.target) ??
    null;
  const filteredProtoFiles = (protoCatalog?.files ?? []).filter((file) => {
    if (!showWellKnownProto && file.wellKnown) {
      return false;
    }

    const queryText = protoSearchText.trim().toLowerCase();
    if (!queryText) {
      return true;
    }

    return (
      file.name.toLowerCase().includes(queryText) ||
      file.package.toLowerCase().includes(queryText) ||
      file.services.some((service) => service.fullName.toLowerCase().includes(queryText)) ||
      file.messages.some((message) => message.fullName.toLowerCase().includes(queryText))
    );
  });
  const selectedProto = filteredProtoFiles.find((file) => file.name === selectedProtoFile) ?? null;

  const grpcCommand =
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

  async function handleConnectTarget(target: WorkspaceTargetProfile, silent = false) {
    setWorkspaceBusy(true);
    if (!silent) {
      setWorkspaceError(null);
    }

    try {
      const response = await connectWorkspaceTarget({
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
      });

      setWorkspaceSessionId(response.sessionId);
      setActiveTargetId(target.id);
      applyBootstrap(response.bootstrap);
      setTargetDraft(target);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : 'Failed to connect to the selected target.'
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }

  function materializeTarget(profile: WorkspaceTargetProfile) {
    return toWorkspaceTargetProfile({
      id: profile.id,
      name: profile.name.trim() || profile.address || 'Untitled target',
      notes: profile.notes,
      config: {
        address: profile.address.trim(),
        plaintext: profile.plaintext,
        insecure: profile.insecure,
        authority: profile.authority.trim(),
        cacertPath: profile.cacertPath.trim(),
        certPath: profile.certPath.trim(),
        keyPath: profile.keyPath.trim(),
        schemaSource: profile.schemaSource,
        protoFiles: profile.protoFiles,
        importPaths: profile.importPaths,
        protosets: profile.protosets,
      },
    });
  }

  function persistTarget(nextTarget: WorkspaceTargetProfile) {
    setTargets((existing) => [
      nextTarget,
      ...existing.filter((entry) => entry.id !== nextTarget.id),
    ]);
    setActiveTargetId(nextTarget.id);
    setTargetDraft(newTargetDraft(rootBootstrap?.targetDefaults));
  }

  function handleSaveTarget() {
    if (!targetDraft.address.trim()) {
      setWorkspaceError('Target address is required before saving a workspace target.');
      return;
    }
    persistTarget(materializeTarget(targetDraft));
  }

  async function handleSaveAndConnectTarget() {
    if (!targetDraft.address.trim()) {
      setWorkspaceError('Target address is required before connecting to a workspace target.');
      return;
    }
    const nextTarget = materializeTarget(targetDraft);
    persistTarget(nextTarget);
    await handleConnectTarget(nextTarget);
  }

  function handleDeleteTarget(id: string) {
    setTargets((existing) => existing.filter((entry) => entry.id !== id));
    if (activeTargetId === id) {
      setActiveTargetId('');
      setWorkspaceSessionId('');
      if (rootBootstrap) {
        applyBootstrap(rootBootstrap);
      }
    }
    if (targetDraft.id === id) {
      setTargetDraft(newTargetDraft(rootBootstrap?.targetDefaults));
    }
  }

  function handleResetToLauncher() {
    setWorkspaceSessionId('');
    setActiveTargetId('');
    setWorkspaceError(null);
    if (rootBootstrap) {
      applyBootstrap(rootBootstrap);
      setTargetDraft(newTargetDraft(rootBootstrap.targetDefaults));
    }
  }

  function updateTargetDraft(next: Partial<WorkspaceTargetProfile>) {
    setTargetDraft((existing) => ({
      ...existing,
      ...next,
    }));
  }

  function downloadTextFile(filename: string, contents: string, type = 'text/plain') {
    const blob = new Blob([contents], { type });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  async function handleInvoke() {
    if (!schema || !currentService || !currentMethod) {
      return;
    }

    const parsed = safeParseJson(requestText);
    if (parsed.error) {
      setAssertionResults([]);
      setInvokeState({
        loading: false,
        error: parsed.error,
        result: null,
        latencyMs: 0,
      });
      setActiveView('response');
      return;
    }

    if (schema.requestStream && !Array.isArray(parsed.value)) {
      setAssertionResults([]);
      setInvokeState({
        loading: false,
        error: 'Streaming RPCs expect the request editor to contain a JSON array of messages.',
        result: null,
        latencyMs: 0,
      });
      setActiveView('response');
      return;
    }

    if (!schema.requestStream && Array.isArray(parsed.value)) {
      setAssertionResults([]);
      setInvokeState({
        loading: false,
        error: 'Unary RPCs expect a single JSON object, not an array.',
        result: null,
        latencyMs: 0,
      });
      setActiveView('response');
      return;
    }

    const payload: InvokeRequest = {
      timeout_seconds: timeoutSeconds,
      metadata: metadata.filter((entry) => entry.name.trim()),
      data: schema.requestStream ? (parsed.value as unknown[]) : [parsed.value],
    };

    setInvokeState({
      loading: true,
      error: null,
      result: null,
      latencyMs: 0,
    });
    setActiveView('response');

    const startedAt = performance.now();

    try {
      const result = workspaceSessionId
        ? await invokeWorkspaceMethod(workspaceSessionId, currentMethod.fullName, payload)
        : await invokeMethod(currentMethod.fullName, payload);
      const latencyMs = performance.now() - startedAt;

      setInvokeState({
        loading: false,
        error: null,
        result,
        latencyMs,
      });
      setAssertionResults(
        evaluateAssertions({
          rules: assertionRules,
          result,
          latencyMs,
        })
      );

      const firstResponse = result.responses[0]?.message ?? result.error ?? null;
      setHistory((existing) =>
        [
          toHistoryEntry({
            service: currentService.name,
            method: currentMethod.fullName,
            latencyMs,
            success: !result.error,
            requestText,
            response: firstResponse,
            metadata,
            timeoutSeconds,
          }),
          ...existing,
        ].slice(0, 50)
      );
    } catch (error) {
      setAssertionResults([]);
      setInvokeState({
        loading: false,
        error: error instanceof Error ? error.message : 'Invocation failed.',
        result: null,
        latencyMs: 0,
      });
    }
  }

  async function handleSimulation() {
    if (!schema || !currentMethod) {
      return;
    }

    const parsed = safeParseJson(requestText);
    if (parsed.error) {
      setSimulationError(parsed.error);
      return;
    }

    if (schema.requestStream && !Array.isArray(parsed.value)) {
      setSimulationError('Streaming RPCs expect the request editor to contain a JSON array.');
      return;
    }

    if (!schema.requestStream && Array.isArray(parsed.value)) {
      setSimulationError('Unary RPCs expect a single JSON object.');
      return;
    }

    const normalized = clampSimulationConfig(simulationConfig);
    setSimulationBusy(true);
    setSimulationError(null);

    const payload: InvokeRequest = {
      timeout_seconds: timeoutSeconds,
      metadata: metadata.filter((entry) => entry.name.trim()),
      data: schema.requestStream ? (parsed.value as unknown[]) : [parsed.value],
    };
    const methodFullName = currentMethod.fullName;

    const latencies: number[] = [];
    let successCount = 0;
    let errorCount = 0;
    let index = 0;

    const startedAt = performance.now();

    async function worker() {
      while (index < normalized.runs) {
        const currentIndex = index;
        index += 1;

        const runStartedAt = performance.now();
        try {
          const result = workspaceSessionId
            ? await invokeWorkspaceMethod(workspaceSessionId, methodFullName, payload)
            : await invokeMethod(methodFullName, payload);
          const latency = performance.now() - runStartedAt;
          latencies[currentIndex] = latency;
          if (result.error) {
            errorCount += 1;
          } else {
            successCount += 1;
          }
        } catch {
          latencies[currentIndex] = performance.now() - runStartedAt;
          errorCount += 1;
        }

        if (normalized.thinkTimeMs > 0) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, normalized.thinkTimeMs);
          });
        }
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(normalized.concurrency, normalized.runs) }, () => worker())
      );
      const totalMs = performance.now() - startedAt;
      setSimulationRun(
        simulationSummary(methodFullName, normalized, latencies, successCount, errorCount, totalMs)
      );
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : 'Simulation failed.');
    } finally {
      setSimulationBusy(false);
      setActiveView('tests');
    }
  }

  async function handleRunAssertions() {
    await handleInvoke();
    setActiveView('tests');
  }

  function handleMetadataChange(index: number, nextField: MetadataEntry) {
    setMetadata((existing) =>
      existing.map((entry, entryIndex) => (entryIndex === index ? nextField : entry))
    );
  }

  function handleAddMetadata() {
    setMetadata((existing) => [...existing, { name: '', value: '' }]);
  }

  function handleRemoveMetadata(index: number) {
    setMetadata((existing) => existing.filter((_, entryIndex) => entryIndex !== index));
  }

  function handleSaveCollection() {
    if (!currentService || !currentMethod) {
      return;
    }

    const name = collectionName.trim() || `${currentMethod.name} snapshot`;
    const collection = toCollection({
      name,
      notes: collectionNotes,
      service: currentService.name,
      method: currentMethod.fullName,
      metadata,
      timeoutSeconds,
      requestText,
    });

    setCollections((existing) => [
      collection,
      ...existing.filter((item) => item.id !== collection.id),
    ]);
    setCollectionName('');
    setCollectionNotes('');
  }

  function handleSaveEnvironment() {
    const name =
      environmentName.trim() || `${currentService?.name.split('.').pop() ?? 'default'} env`;
    const nextEnvironment = toEnvironmentPreset({
      name,
      notes: environmentNotes,
      metadata: metadata.filter((entry) => entry.name.trim()),
      timeoutSeconds,
    });

    setEnvironments((existing) => [
      nextEnvironment,
      ...existing.filter((entry) => entry.id !== nextEnvironment.id),
    ]);
    setEnvironmentName('');
    setEnvironmentNotes('');
  }

  function applyEnvironment(environment: EnvironmentPreset) {
    setMetadata(environment.metadata);
    setTimeoutSeconds(environment.timeoutSeconds);
    setEnvironmentName(environment.name);
    setEnvironmentNotes(environment.notes);
  }

  function handleAssertionChange(id: string, nextRule: AssertionRule) {
    setAssertionRules((existing) => existing.map((rule) => (rule.id === id ? nextRule : rule)));
  }

  function handleAddAssertion() {
    setAssertionRules((existing) => [
      ...existing,
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
    setAssertionRules((existing) => existing.filter((rule) => rule.id !== id));
  }

  function applyCollection(collection: SavedCollection) {
    pendingDraftRef.current = {
      method: collection.method,
      metadata: collection.metadata,
      timeoutSeconds: collection.timeoutSeconds,
      requestText: collection.requestText,
    };
    startTransition(() => {
      setSelectedMethod(collection.method);
      setCollectionName(collection.name);
      setCollectionNotes(collection.notes);
      setActiveView('compose');
    });
  }

  function applyHistory(entry: RequestHistoryEntry) {
    pendingDraftRef.current = {
      method: entry.method,
      metadata: entry.metadata,
      timeoutSeconds: entry.timeoutSeconds,
      requestText: entry.requestText,
    };
    startTransition(() => {
      setSelectedMethod(entry.method);
      setActiveView('compose');
    });
  }

  function handleExportWorkspace() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            assertions: assertionRules,
            collections,
            environments,
            history,
            targets,
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'protopeek-workspace.json';
    link.click();
    window.URL.revokeObjectURL(url);
  }

  async function handleImportWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const contents = await file.text();
    const parsed = safeParseJson(contents);
    if (parsed.error || typeof parsed.value !== 'object' || parsed.value === null) {
      setBootError('Imported workspace is not valid JSON.');
      return;
    }

    const imported = parsed.value as {
      assertions?: AssertionRule[];
      collections?: SavedCollection[];
      environments?: EnvironmentPreset[];
      history?: RequestHistoryEntry[];
      targets?: WorkspaceTargetProfile[];
    };

    if (imported.assertions) {
      setAssertionRules(imported.assertions);
    }
    if (imported.collections) {
      setCollections(imported.collections);
    }
    if (imported.environments) {
      setEnvironments(imported.environments);
    }
    if (imported.history) {
      setHistory(imported.history);
    }
    if (imported.targets) {
      setTargets(imported.targets);
    }
  }

  const responsePayload = invokeState.result?.responses.map((entry) => entry.message) ?? [];
  const latencySparkline = sparklinePath(simulationRun?.latencies ?? [], 220, 56);
  const passingAssertions = assertionResults.filter((result) => result.passed).length;
  const latestStatus = invokeState.result?.error?.name ?? (invokeState.result ? 'OK' : 'Not run');
  const latestHeaderCount = invokeState.result?.headers.length ?? 0;
  const latestTrailerCount = invokeState.result?.trailers.length ?? 0;

  if (bootError) {
    return (
      <div className="pp-shell flex items-center justify-center">
        <div className="pp-panel max-w-xl text-center">
          <CircleAlert className="mx-auto mb-4 size-10 text-pp-danger" />
          <h1 className="pp-heading text-3xl">ProtoPeek couldn&apos;t boot.</h1>
          <p className="pp-muted mt-4">{bootError}</p>
        </div>
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="pp-shell">
        <div className="mx-auto max-w-7xl">
          <div className="pp-panel relative overflow-hidden">
            <div className="pp-skeleton absolute inset-0" />
            <div className="relative flex items-center gap-4">
              <LoaderCircle className="size-6 animate-spin text-pp-brand" />
              <div>
                <div className="pp-label">Booting</div>
                <div className="pp-heading text-2xl">Loading the ProtoPeek console...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (bootstrap.launcherMode && bootstrap.services.length === 0) {
    return (
      <LauncherShell
        activeTargetId={activeTargetId}
        bootstrap={bootstrap}
        busy={workspaceBusy}
        error={workspaceError}
        onChangeDraft={updateTargetDraft}
        onConnectTarget={(target) => {
          void handleConnectTarget(target);
        }}
        onDeleteTarget={handleDeleteTarget}
        onEditTarget={setTargetDraft}
        onSaveTarget={handleSaveTarget}
        onSaveAndConnectTarget={() => {
          void handleSaveAndConnectTarget();
        }}
        targetDraft={targetDraft}
        targets={targets}
      />
    );
  }

  if (!schema || !currentMethod || !currentService) {
    return (
      <div className="pp-shell">
        <div className="mx-auto max-w-7xl">
          <div className="pp-panel relative overflow-hidden">
            <div className="pp-skeleton absolute inset-0" />
            <div className="relative flex items-center gap-4">
              <LoaderCircle className="size-6 animate-spin text-pp-brand" />
              <div>
                <div className="pp-label">Booting</div>
                <div className="pp-heading text-2xl">Loading the ProtoPeek console...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pp-shell">
      <div className="pp-orb pointer-events-none absolute left-[-120px] top-24 size-72 rounded-full bg-pp-brand/15 blur-3xl" />
      <div className="pp-orb pointer-events-none absolute right-[-80px] top-40 size-64 rounded-full bg-pp-accent/20 blur-3xl" />

      <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="pp-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="pp-label">ProtoPeek</div>
                <h1 className="pp-heading mt-2 text-3xl">Modern gRPC workbench</h1>
                <p className="pp-muted mt-3">
                  JSON-first request authoring, grpcurl parity, local test assertions, and
                  lightweight load simulation in one responsive console.
                </p>
              </div>
              <Sparkles className="size-8 text-pp-accent" />
            </div>

            <div className="mt-5 space-y-3">
              <InfoRow icon={Server} label="Target" value={bootstrap.target} />
              <InfoRow icon={Cable} label="Method" value={currentMethod.fullName} />
              <InfoRow icon={Activity} label="Version" value={bootstrap.version} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <a
                className="pp-button-secondary"
                href={bootstrap.docsURL}
                target="_blank"
                rel="noreferrer"
              >
                <BookOpenText className="size-4" />
                Website
              </a>
              <a
                className="pp-button-secondary"
                href={bootstrap.learnURL}
                target="_blank"
                rel="noreferrer"
              >
                <BadgeHelp className="size-4" />
                Learn gRPC
              </a>
            </div>
          </section>

          <section className="pp-panel">
            <div className="pp-label">Navigate</div>
            <div className="mt-4 grid gap-2">
              <ViewButton
                active={activeView === 'compose'}
                icon={FileCode2}
                label="Compose"
                onClick={() => setActiveView('compose')}
              />
              <ViewButton
                active={activeView === 'response'}
                icon={Activity}
                label="Response Lab"
                onClick={() => setActiveView('response')}
              />
              <ViewButton
                active={activeView === 'history'}
                icon={History}
                label="History"
                onClick={() => setActiveView('history')}
              />
              <ViewButton
                active={activeView === 'tests'}
                icon={FlaskConical}
                label="Tests & Sim"
                onClick={() => setActiveView('tests')}
              />
              <ViewButton
                active={activeView === 'transport'}
                icon={Cable}
                label="Transport Lens"
                onClick={() => setActiveView('transport')}
              />
              <ViewButton
                active={activeView === 'structure'}
                icon={BookMarked}
                label="Structure"
                onClick={() => setActiveView('structure')}
              />
            </div>
          </section>

          {rootBootstrap?.launcherMode ? (
            <section className="pp-panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="pp-label">Target registry</div>
                  <div className="mt-2 text-sm font-semibold text-pp-ink">
                    {activeTargetProfile
                      ? `Connected to ${activeTargetProfile.name || activeTargetProfile.address}`
                      : 'No active target selected'}
                  </div>
                  <div className="pp-muted mt-2">
                    Save local and remote gRPC endpoints with transport settings, then switch
                    without restarting `pp`.
                  </div>
                </div>
                <button
                  className="pp-button-ghost px-3 py-2"
                  onClick={handleResetToLauncher}
                  type="button"
                >
                  Launcher
                </button>
              </div>

              {workspaceError ? (
                <div className="mt-4">
                  <StatusBanner
                    tone="danger"
                    title="Target action failed"
                    description={workspaceError}
                  />
                </div>
              ) : null}

              <div className="mt-4 space-y-3">
                {targets.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-pp-border px-4 py-5 text-sm text-pp-muted">
                    No saved targets yet. Use the launcher to add local services, remote staging
                    clusters, or proto-backed descriptor sessions.
                  </div>
                ) : (
                  targets.slice(0, 4).map((target) => (
                    <div
                      className="rounded-[22px] border border-pp-border bg-white/80 p-4"
                      key={target.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-pp-ink">{target.name}</div>
                          <div className="pp-muted mt-1 break-all">{target.address}</div>
                        </div>
                        {target.id === activeTargetId ? (
                          <span className="pp-badge text-emerald-700">Active</span>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="pp-badge">{schemaSourceLabel(target.schemaSource)}</span>
                        <span className="pp-badge">{target.plaintext ? 'Plaintext' : 'TLS'}</span>
                        {target.insecure ? (
                          <span className="pp-badge text-amber-700">Skip verify</span>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          className="pp-button-secondary px-3 py-2"
                          onClick={() => {
                            void handleConnectTarget(target);
                          }}
                          type="button"
                        >
                          <Play className="size-4" />
                          Connect
                        </button>
                        <button
                          className="pp-button-ghost px-3 py-2"
                          onClick={() => setTargetDraft(target)}
                          type="button"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}

          <section className="pp-panel">
            <div className="flex items-center justify-between gap-3">
              <div className="pp-label">Method rail</div>
              <span className="pp-badge">{methodCounts[methodFilter]} visible</span>
            </div>
            <div className="mt-4">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-pp-muted" />
                <input
                  className="pp-input pl-11"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search methods"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {methodFilterOptions.map((option) => (
                <button
                  className={classNames(
                    'rounded-full px-3 py-2 text-xs font-semibold transition',
                    methodFilter === option.value
                      ? 'bg-pp-brand text-white shadow-lg shadow-pp-brand/20'
                      : 'border border-pp-border bg-white/75 text-pp-ink hover:bg-white'
                  )}
                  key={option.value}
                  onClick={() => setMethodFilter(option.value)}
                  type="button"
                >
                  {option.label} · {methodCounts[option.value]}
                </button>
              ))}
            </div>

            <div className="mt-4 max-h-[48vh] space-y-3 overflow-auto pr-1">
              {visibleServices.map((service) => (
                <ServiceTree
                  key={service.name}
                  service={service}
                  selectedMethod={selectedMethod}
                  searchText={deferredSearchText}
                  onSelect={setSelectedMethod}
                />
              ))}
            </div>
          </section>

          <section className="pp-panel">
            <div className="flex items-center justify-between gap-3">
              <div className="pp-label">Workspace</div>
              <div className="flex items-center gap-2">
                <button
                  className="pp-button-ghost px-3 py-2"
                  onClick={handleExportWorkspace}
                  type="button"
                >
                  <Download className="size-4" />
                </button>
                <button
                  className="pp-button-ghost px-3 py-2"
                  onClick={() => importInputRef.current?.click()}
                  type="button"
                >
                  <Upload className="size-4" />
                </button>
                <input
                  ref={importInputRef}
                  className="hidden"
                  type="file"
                  accept="application/json"
                  onChange={handleImportWorkspace}
                />
              </div>
            </div>
            <div className="mt-4 rounded-3xl border border-pp-border bg-white/70 p-4">
              <div className="flex items-center gap-3">
                <Library className="size-5 text-pp-brand" />
                <div>
                  <div className="text-sm font-semibold text-pp-ink">
                    Recipes, environments, and tests stay local
                  </div>
                  <div className="pp-muted">
                    Portable JSON export, no hosted account, no background sync.
                  </div>
                </div>
              </div>
            </div>
          </section>
        </aside>

        <main className="space-y-5">
          <section className="pp-panel-strong overflow-hidden">
            <div className="grid gap-6 border-b border-pp-border px-6 py-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="pp-badge">
                    <Server className="size-3.5" />
                    {currentService.name}
                  </span>
                  <MethodModeBadge method={currentMethod} />
                </div>
                <div>
                  <div className="pp-label">Selected RPC</div>
                  <h2 className="pp-heading mt-2 text-4xl">{currentMethod.name}</h2>
                </div>
                <pre className="rounded-[24px] border border-pp-border bg-white/70 px-4 py-4 font-mono text-xs leading-6 text-pp-ink">
                  {currentMethod.description}
                </pre>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <MetricCard
                  label="Request shape"
                  value={schema.requestStream ? 'Stream batch' : 'Unary JSON'}
                />
                <MetricCard
                  label="Response mode"
                  value={currentMethod.serverStreaming ? 'Server stream' : 'Unary'}
                />
                <MetricCard label="Environments" value={String(environments.length)} />
                <MetricCard label="Assertions" value={String(assertionRules.length)} />
                <MetricCard label="Collections" value={String(collections.length)} />
                <MetricCard label="History" value={String(history.length)} />
              </div>
            </div>

            <div className="grid gap-5 px-6 py-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-5">
                <PanelHeader
                  icon={FileCode2}
                  title="Request studio"
                  description="Author JSON payloads, carry metadata, keep reusable environments, and keep a grpcurl command ready for copy."
                />

                <div className="grid gap-4 md:grid-cols-[1fr_160px]">
                  <div className="space-y-2">
                    <label className="pp-label" htmlFor="request-payload">
                      Request payload
                    </label>
                    <textarea
                      id="request-payload"
                      className="pp-input min-h-[360px] font-mono text-[0.84rem] leading-6"
                      value={requestText}
                      onChange={(event) => setRequestText(event.target.value)}
                    />
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="pp-label" htmlFor="request-timeout">
                        Timeout
                      </label>
                      <input
                        id="request-timeout"
                        className="pp-input mt-2"
                        min={0}
                        step={1}
                        type="number"
                        value={timeoutSeconds}
                        onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
                      />
                    </div>
                    <button
                      className="pp-button-secondary w-full"
                      onClick={() => setRequestText(prettyJson(generateRequestTemplate(schema)))}
                      type="button"
                    >
                      <Sparkles className="size-4" />
                      Reset from schema
                    </button>
                    <button
                      className="pp-button-primary w-full"
                      onClick={handleInvoke}
                      type="button"
                    >
                      {invokeState.loading ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Play className="size-4" />
                      )}
                      Invoke
                    </button>
                    <button
                      className="pp-button-secondary w-full"
                      onClick={() => {
                        void handleSimulation();
                      }}
                      type="button"
                    >
                      {simulationBusy ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <FlaskConical className="size-4" />
                      )}
                      Simulate
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="pp-label">Metadata</div>
                    <button
                      className="pp-button-ghost px-3 py-2"
                      onClick={handleAddMetadata}
                      type="button"
                    >
                      <Save className="size-4" />
                      Add row
                    </button>
                  </div>
                  <div className="space-y-3">
                    {metadata.map((entry, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: metadata rows are edited in-place, never reordered
                      <div className="grid gap-3 md:grid-cols-[1fr_1fr_44px]" key={index}>
                        <input
                          className="pp-input"
                          value={entry.name}
                          onChange={(event) =>
                            handleMetadataChange(index, {
                              ...entry,
                              name: event.target.value,
                            })
                          }
                          placeholder="header-name"
                        />
                        <input
                          className="pp-input"
                          value={entry.value}
                          onChange={(event) =>
                            handleMetadataChange(index, {
                              ...entry,
                              value: event.target.value,
                            })
                          }
                          placeholder="header value"
                        />
                        <button
                          className="pp-button-secondary h-full px-0"
                          onClick={() => handleRemoveMetadata(index)}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {metadata.length === 0 ? (
                      <div className="rounded-[24px] border border-dashed border-pp-border px-4 py-5 text-sm text-pp-muted">
                        No metadata rows yet. Add auth headers or tracing tags here.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="pp-label">grpcurl preview</div>
                    <button
                      className="pp-button-ghost px-3 py-2"
                      onClick={() => void navigator.clipboard.writeText(grpcCommand)}
                      type="button"
                    >
                      <Copy className="size-4" />
                      Copy
                    </button>
                  </div>
                  <pre className="pp-code mt-3">{grpcCommand}</pre>
                </div>
              </div>

              <div className="space-y-5">
                <PanelHeader
                  icon={BookMarked}
                  title="Schema and recipes"
                  description="Keep structure visible while you work, then turn useful payloads into repeatable recipes."
                />

                <section className="rounded-[28px] border border-pp-border bg-white/70 p-4">
                  <div className="pp-label">Request schema</div>
                  <div className="mt-3 space-y-3">
                    {(schema.messageTypes[schema.requestType] ?? []).map((field) => (
                      <SchemaField key={field.name} field={field} schema={schema} depth={0} />
                    ))}
                  </div>
                </section>

                <section className="rounded-[28px] border border-pp-border bg-white/70 p-4">
                  <div className="pp-label">Save recipe</div>
                  <div className="mt-3 grid gap-3">
                    <input
                      className="pp-input"
                      value={collectionName}
                      onChange={(event) => setCollectionName(event.target.value)}
                      placeholder="Friendly recipe name"
                    />
                    <textarea
                      className="pp-input min-h-[110px]"
                      value={collectionNotes}
                      onChange={(event) => setCollectionNotes(event.target.value)}
                      placeholder="What this request validates, where it is useful, or any environment notes."
                    />
                    <button
                      className="pp-button-primary"
                      onClick={handleSaveCollection}
                      type="button"
                    >
                      <Save className="size-4" />
                      Save to local workspace
                    </button>
                  </div>
                </section>

                <section className="rounded-[28px] border border-pp-border bg-white/70 p-4">
                  <div className="pp-label">Environment preset</div>
                  <div className="mt-2 text-sm leading-6 text-pp-muted">
                    Save auth metadata, trace headers, and timeout defaults as a reusable profile.
                  </div>
                  <div className="mt-3 grid gap-3">
                    <input
                      className="pp-input"
                      value={environmentName}
                      onChange={(event) => setEnvironmentName(event.target.value)}
                      placeholder="Frontend staging token"
                    />
                    <textarea
                      className="pp-input min-h-[96px]"
                      value={environmentNotes}
                      onChange={(event) => setEnvironmentNotes(event.target.value)}
                      placeholder="Who uses this profile, where it points, and any auth caveats."
                    />
                    <button
                      className="pp-button-secondary"
                      onClick={handleSaveEnvironment}
                      type="button"
                    >
                      <Save className="size-4" />
                      Save environment
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {environments.length === 0 ? (
                      <div className="rounded-[22px] border border-dashed border-pp-border px-4 py-5 text-sm text-pp-muted">
                        Save a preset to reuse metadata and timeout defaults across services.
                      </div>
                    ) : (
                      environments.slice(0, 4).map((environment) => (
                        <button
                          className="block w-full rounded-[22px] border border-pp-border bg-white/80 p-4 text-left transition hover:border-pp-brand/35 hover:bg-white"
                          key={environment.id}
                          onClick={() => applyEnvironment(environment)}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold text-pp-ink">{environment.name}</div>
                            <span className="pp-badge">{environment.timeoutSeconds}s timeout</span>
                          </div>
                          <div className="pp-muted mt-2">
                            {environment.notes || 'Reusable auth and metadata profile.'}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </section>

                {matchingExamples.length > 0 ? (
                  <section className="rounded-[28px] border border-pp-border bg-white/70 p-4">
                    <div className="pp-label">Built-in examples</div>
                    <div className="mt-3 space-y-3">
                      {matchingExamples.map((example) => (
                        <button
                          className="block w-full rounded-[22px] border border-pp-border bg-white/80 p-4 text-left transition hover:border-pp-brand/40 hover:bg-white"
                          key={example.name}
                          onClick={() => {
                            setRequestText(prettyJson(example.request.data));
                            setMetadata(example.request.metadata);
                            setTimeoutSeconds(example.request.timeout_secs);
                          }}
                          type="button"
                        >
                          <div className="font-semibold text-pp-ink">{example.name}</div>
                          <div className="pp-muted mt-2">{example.description}</div>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
          </section>

          <section className="grid gap-5 2xl:grid-cols-[1.2fr_0.8fr]">
            <div className="pp-panel">
              <PanelHeader
                icon={
                  activeView === 'tests'
                    ? FlaskConical
                    : activeView === 'transport'
                      ? Cable
                      : activeView === 'structure'
                        ? BookMarked
                        : activeView === 'history'
                          ? History
                          : Activity
                }
                title={
                  activeView === 'tests'
                    ? 'Tests and simulation'
                    : activeView === 'transport'
                      ? 'Transport lens'
                      : activeView === 'structure'
                        ? 'Proto structure explorer'
                        : activeView === 'history'
                          ? 'Request history'
                          : 'Response lab'
                }
                description={
                  activeView === 'tests'
                    ? 'Run lightweight assertions and controlled request sweeps without leaving the console.'
                    : activeView === 'transport'
                      ? 'Understand how reflection, metadata, gRPC-Web, and trailers shape the current RPC.'
                      : activeView === 'structure'
                        ? 'Explore file topology, nested messages, enums, and raw proto text, then export the contract you are debugging.'
                        : activeView === 'history'
                          ? 'Replay previous requests without rebuilding payloads.'
                          : 'Headers, trailers, payloads, and errors stay visible together.'
                }
              />

              {activeView === 'response' ? (
                <div className="mt-5 space-y-4">
                  {invokeState.error ? (
                    <StatusBanner
                      tone="danger"
                      title="Invocation failed"
                      description={invokeState.error}
                    />
                  ) : null}

                  {invokeState.loading ? (
                    <StatusBanner
                      tone="info"
                      title="Request in flight"
                      description="ProtoPeek is waiting for the server response."
                    />
                  ) : null}

                  {invokeState.result ? (
                    <Fragment>
                      <div className="grid gap-3 md:grid-cols-4">
                        <MetricCard label="Latency" value={durationLabel(invokeState.latencyMs)} />
                        <MetricCard
                          label="Messages"
                          value={String(invokeState.result.responses.length)}
                        />
                        <MetricCard
                          label="Status"
                          value={invokeState.result.error ? invokeState.result.error.name : 'OK'}
                        />
                        <MetricCard
                          label="Sent"
                          value={
                            invokeState.result.requests
                              ? `${invokeState.result.requests.sent}/${invokeState.result.requests.total}`
                              : '0'
                          }
                        />
                      </div>

                      <ResponseMetadata title="Headers" values={invokeState.result.headers} />
                      <ResponseData title="Responses" values={responsePayload} />
                      {invokeState.result.error ? (
                        <div className="rounded-[28px] border border-pp-danger/20 bg-pp-danger/5 p-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-pp-danger">
                            <CircleAlert className="size-4" />
                            {invokeState.result.error.name} ({invokeState.result.error.code})
                          </div>
                          <p className="mt-2 text-sm leading-6 text-pp-ink">
                            {invokeState.result.error.message}
                          </p>
                          {invokeState.result.error.details.length > 0 ? (
                            <ResponseData
                              title="Error details"
                              values={invokeState.result.error.details.map(
                                (entry) => entry.message
                              )}
                            />
                          ) : null}
                        </div>
                      ) : null}
                      <ResponseMetadata title="Trailers" values={invokeState.result.trailers} />
                    </Fragment>
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-pp-border px-4 py-6 text-sm text-pp-muted">
                      Invoke a method to populate the response lab.
                    </div>
                  )}
                </div>
              ) : null}

              {activeView === 'history' ? (
                <div className="mt-5 space-y-3">
                  {history.length === 0 ? (
                    <EmptyState
                      icon={History}
                      title="No history yet"
                      description="Run an RPC and ProtoPeek will capture the request snapshot and response preview here."
                    />
                  ) : (
                    history.map((entry) => (
                      <button
                        className="block w-full rounded-[24px] border border-pp-border bg-white/75 p-4 text-left transition hover:border-pp-brand/35 hover:bg-white"
                        key={entry.id}
                        onClick={() => applyHistory(entry)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-pp-ink">{entry.method}</div>
                            <div className="pp-muted">{compactDate(entry.createdAt)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="pp-badge">{durationLabel(entry.latencyMs)}</span>
                            <span
                              className={classNames(
                                'pp-badge',
                                entry.success ? 'text-emerald-700' : 'text-pp-danger'
                              )}
                            >
                              {entry.success ? (
                                <CheckCircle2 className="size-3.5" />
                              ) : (
                                <CircleAlert className="size-3.5" />
                              )}
                              {entry.success ? 'OK' : 'Error'}
                            </span>
                          </div>
                        </div>
                        <p className="pp-muted mt-3">{entry.responsePreview}</p>
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              {activeView === 'tests' ? (
                <div className="mt-5 space-y-5">
                  <div className="grid gap-3 md:grid-cols-4">
                    <MetricCard label="Rules" value={String(assertionRules.length)} />
                    <MetricCard
                      label="Passing"
                      value={
                        assertionResults.length > 0
                          ? `${passingAssertions}/${assertionResults.length}`
                          : 'Not run'
                      }
                    />
                    <MetricCard label="Last status" value={latestStatus} />
                    <MetricCard
                      label="Last latency"
                      value={invokeState.result ? durationLabel(invokeState.latencyMs) : 'Not run'}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="pp-button-primary"
                      onClick={() => {
                        void handleRunAssertions();
                      }}
                      type="button"
                    >
                      <CheckCircle2 className="size-4" />
                      Run assertions
                    </button>
                    <button
                      className="pp-button-secondary"
                      onClick={handleAddAssertion}
                      type="button"
                    >
                      <Save className="size-4" />
                      Add assertion
                    </button>
                    <p className="pp-muted">
                      Assertions evaluate gRPC status, headers, trailers, latency, and payload text
                      against the current request.
                    </p>
                  </div>

                  <section className="rounded-[28px] border border-pp-border bg-white/75 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="pp-label">Assertion rules</div>
                      <span className="pp-badge">{assertionRules.length} configured</span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {assertionRules.map((rule) => (
                        <div
                          className="rounded-[24px] border border-pp-border bg-white/85 p-4"
                          key={rule.id}
                        >
                          <div className="grid gap-3 xl:grid-cols-[1.2fr_180px_180px]">
                            <input
                              className="pp-input"
                              value={rule.name}
                              onChange={(event) =>
                                handleAssertionChange(rule.id, {
                                  ...rule,
                                  name: event.target.value,
                                })
                              }
                              placeholder="Readable rule name"
                            />
                            <select
                              className="pp-input"
                              value={rule.kind}
                              onChange={(event) =>
                                handleAssertionChange(rule.id, {
                                  ...rule,
                                  kind: event.target.value as AssertionRule['kind'],
                                  target:
                                    event.target.value === 'header' ||
                                    event.target.value === 'trailer'
                                      ? rule.target
                                      : '',
                                })
                              }
                            >
                              {assertionKindOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <div className="flex gap-3">
                              <select
                                className="pp-input flex-1"
                                value={rule.comparator}
                                onChange={(event) =>
                                  handleAssertionChange(rule.id, {
                                    ...rule,
                                    comparator: event.target.value as AssertionRule['comparator'],
                                  })
                                }
                              >
                                {assertionComparatorOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="pp-button-secondary px-4"
                                onClick={() => handleRemoveAssertion(rule.id)}
                                type="button"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <input
                              className="pp-input"
                              value={rule.target}
                              onChange={(event) =>
                                handleAssertionChange(rule.id, {
                                  ...rule,
                                  target: event.target.value,
                                })
                              }
                              placeholder={
                                rule.kind === 'header' || rule.kind === 'trailer'
                                  ? 'metadata key, for example x-request-id'
                                  : 'Optional target'
                              }
                            />
                            <input
                              className="pp-input"
                              value={rule.value}
                              onChange={(event) =>
                                handleAssertionChange(rule.id, {
                                  ...rule,
                                  value: event.target.value,
                                })
                              }
                              placeholder="Expected value"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[28px] border border-pp-border bg-white/75 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="pp-label">Assertion results</div>
                      <span className="pp-badge">
                        {assertionResults.length > 0
                          ? `${passingAssertions} passing`
                          : 'Awaiting run'}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {!invokeState.result ? (
                        <EmptyState
                          icon={CheckCircle2}
                          title="No assertion run yet"
                          description="Invoke the current RPC with assertions enabled to capture status, latency, headers, trailers, and payload checks."
                        />
                      ) : assertionResults.length === 0 ? (
                        <div className="rounded-[22px] border border-dashed border-pp-border px-4 py-5 text-sm text-pp-muted">
                          The last invocation completed, but no assertion results were recorded.
                        </div>
                      ) : (
                        assertionResults.map((result) => (
                          <div
                            className="rounded-[22px] border border-pp-border bg-white/85 p-4"
                            key={result.id}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-semibold text-pp-ink">{result.name}</div>
                              <span
                                className={classNames(
                                  'pp-badge',
                                  result.passed ? 'text-emerald-700' : 'text-pp-danger'
                                )}
                              >
                                {result.passed ? (
                                  <CheckCircle2 className="size-3.5" />
                                ) : (
                                  <CircleAlert className="size-3.5" />
                                )}
                                {result.passed ? 'Pass' : 'Fail'}
                              </span>
                            </div>
                            <div className="pp-muted mt-2">{result.message}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="rounded-[28px] border border-pp-border bg-white/75 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="pp-label">Simulation studio</div>
                        <div className="pp-muted mt-2">
                          Run small concurrency sweeps to estimate throughput and tail latency for
                          the current unary request.
                        </div>
                      </div>
                      <button
                        className="pp-button-primary"
                        onClick={() => void handleSimulation()}
                        type="button"
                      >
                        {simulationBusy ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <FlaskConical className="size-4" />
                        )}
                        Run simulation
                      </button>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      {simulationPresets.map((preset) => (
                        <button
                          className="rounded-[20px] border border-pp-border bg-white/85 px-4 py-3 text-left transition hover:border-pp-brand/35 hover:bg-white"
                          key={preset.label}
                          onClick={() => setSimulationConfig(clampSimulationConfig(preset.config))}
                          type="button"
                        >
                          <div className="font-semibold text-pp-ink">{preset.label}</div>
                          <div className="pp-muted mt-1">{preset.description}</div>
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <LabeledInput
                        label="Runs"
                        type="number"
                        value={simulationConfig.runs}
                        onChange={(value) =>
                          setSimulationConfig((existing) => ({ ...existing, runs: Number(value) }))
                        }
                      />
                      <LabeledInput
                        label="Concurrency"
                        type="number"
                        value={simulationConfig.concurrency}
                        onChange={(value) =>
                          setSimulationConfig((existing) => ({
                            ...existing,
                            concurrency: Number(value),
                          }))
                        }
                      />
                      <LabeledInput
                        label="Think time (ms)"
                        type="number"
                        value={simulationConfig.thinkTimeMs}
                        onChange={(value) =>
                          setSimulationConfig((existing) => ({
                            ...existing,
                            thinkTimeMs: Number(value),
                          }))
                        }
                      />
                    </div>

                    {simulationError ? (
                      <div className="mt-4">
                        <StatusBanner
                          tone="danger"
                          title="Simulation failed"
                          description={simulationError}
                        />
                      </div>
                    ) : null}

                    <div className="mt-5">
                      {simulationRun ? (
                        <Fragment>
                          <div className="grid gap-3 md:grid-cols-4">
                            <MetricCard
                              label="Success"
                              value={String(simulationRun.successCount)}
                            />
                            <MetricCard label="Errors" value={String(simulationRun.errorCount)} />
                            <MetricCard
                              label="Throughput"
                              value={`${simulationRun.throughputRps.toFixed(2)} req/s`}
                            />
                            <MetricCard
                              label="Total time"
                              value={durationLabel(simulationRun.totalMs)}
                            />
                          </div>

                          <div className="mt-4 rounded-[28px] border border-pp-border bg-white/85 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="pp-label">Latency sparkline</div>
                                <div className="mt-2 text-sm font-semibold text-pp-ink">
                                  p50 {durationLabel(simulationRun.p50)} · p95{' '}
                                  {durationLabel(simulationRun.p95)} · p99{' '}
                                  {durationLabel(simulationRun.p99)}
                                </div>
                              </div>
                              <svg
                                aria-label="Latency sparkline"
                                height="56"
                                role="img"
                                viewBox="0 0 220 56"
                                width="220"
                              >
                                <title>Latency sparkline</title>
                                <path
                                  className="text-pp-brand"
                                  d={latencySparkline}
                                  fill="none"
                                  stroke="currentColor"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="3"
                                />
                              </svg>
                            </div>
                          </div>
                        </Fragment>
                      ) : (
                        <EmptyState
                          icon={FlaskConical}
                          title="No simulation data yet"
                          description="Run a sweep to see throughput, p50, p95, and p99 latency against the current request."
                        />
                      )}
                    </div>
                  </section>
                </div>
              ) : null}

              {activeView === 'transport' ? (
                <div className="mt-5 space-y-5">
                  <div className="grid gap-3 md:grid-cols-4">
                    <MetricCard
                      label="Discovery"
                      value={bootstrap.services.length > 0 ? 'Schema loaded' : 'Unavailable'}
                    />
                    <MetricCard
                      label="Request mode"
                      value={schema.requestStream ? 'Client stream' : 'Unary'}
                    />
                    <MetricCard label="Headers seen" value={String(latestHeaderCount)} />
                    <MetricCard label="Trailers seen" value={String(latestTrailerCount)} />
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    {transportMoments.map((moment) => (
                      <div
                        className="rounded-[28px] border border-pp-border bg-white/75 p-4"
                        key={moment.title}
                      >
                        <div className="font-semibold text-pp-ink">{moment.title}</div>
                        <div className="pp-muted mt-2">{moment.body}</div>
                      </div>
                    ))}
                  </div>

                  <section className="rounded-[28px] border border-pp-border bg-white/75 p-4">
                    <div className="pp-label">Latest call anatomy</div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-[22px] border border-pp-border bg-white/85 p-4">
                        <div className="font-semibold text-pp-ink">Current transport snapshot</div>
                        <div className="pp-muted mt-2">
                          Target {bootstrap.target} is mounted at {bootstrap.basePath} with{' '}
                          {currentMethod.clientStreaming || currentMethod.serverStreaming
                            ? 'stream-aware'
                            : 'unary'}{' '}
                          request handling.
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-pp-border bg-white/85 p-4">
                        <div className="font-semibold text-pp-ink">Observed response state</div>
                        <div className="pp-muted mt-2">
                          Status {latestStatus}, {responsePayload.length} message
                          {responsePayload.length === 1 ? '' : 's'}, {latestHeaderCount} header
                          value{latestHeaderCount === 1 ? '' : 's'}, and {latestTrailerCount}{' '}
                          trailer value{latestTrailerCount === 1 ? '' : 's'} on the latest call.
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}

              {activeView === 'structure' ? (
                <div className="mt-5">
                  <ProtoStructurePanel
                    catalog={protoCatalog}
                    searchText={protoSearchText}
                    selectedFile={selectedProtoFile}
                    selectedProto={selectedProto}
                    showWellKnown={showWellKnownProto}
                    visibleFiles={filteredProtoFiles}
                    onJumpToCompose={() => setActiveView('compose')}
                    onSearchChange={setProtoSearchText}
                    onSelectFile={setSelectedProtoFile}
                    onToggleWellKnown={setShowWellKnownProto}
                    onExportCatalog={() => {
                      downloadTextFile(
                        'protopeek-proto-catalog.json',
                        prettyJson(protoCatalog ?? { files: [] }),
                        'application/json'
                      );
                    }}
                    onExportProto={(file) => {
                      downloadTextFile(
                        file.name.split('/').pop() || 'schema.proto',
                        file.protoText,
                        'text/plain'
                      );
                    }}
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-5">
              <section className="pp-panel">
                <PanelHeader
                  icon={Library}
                  title="Saved recipes"
                  description="Compact snapshots for repeatable debug flows."
                />
                <div className="mt-5 space-y-3">
                  {collections.length === 0 ? (
                    <EmptyState
                      icon={Save}
                      title="No recipes saved"
                      description="Store the current payload and metadata as a recipe to make repeat work one click away."
                    />
                  ) : (
                    collections.slice(0, 6).map((collection) => (
                      <button
                        className="block w-full rounded-[24px] border border-pp-border bg-white/75 p-4 text-left transition hover:border-pp-brand/35 hover:bg-white"
                        key={collection.id}
                        onClick={() => applyCollection(collection)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-pp-ink">{collection.name}</div>
                          <span className="pp-badge">{collection.method.split('.').pop()}</span>
                        </div>
                        <div className="pp-muted mt-2">{collection.notes || 'No notes yet.'}</div>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="pp-panel">
                <PanelHeader
                  icon={BookOpenText}
                  title="Core capabilities"
                  description="Ten shipped surfaces defining the current ProtoPeek workbench."
                />
                <div className="mt-5 space-y-3">
                  {featureIdeas.map((feature) => (
                    <div
                      className="rounded-[24px] border border-pp-border bg-white/75 p-4"
                      key={feature.name}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-pp-ink">{feature.name}</div>
                        <span
                          className={classNames(
                            'pp-badge',
                            feature.status === 'Shipped' ? 'text-emerald-700' : 'text-amber-700'
                          )}
                        >
                          {feature.status}
                        </span>
                      </div>
                      <div className="pp-muted mt-2">{feature.summary}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="pp-panel">
                <PanelHeader
                  icon={SquareArrowOutUpRight}
                  title="Protocol learning links"
                  description="Use the console, then jump into the deeper transport context."
                />
                <div className="mt-5 space-y-3">
                  <ExternalLink
                    href={bootstrap.learnURL}
                    title="Learn gRPC with charts and transport diagrams"
                    description="ProtoPeek’s public learn page explains reflection, metadata, streaming, and browser transport tradeoffs."
                  />
                  <ExternalLink
                    href={bootstrap.grpcWebURL}
                    title="Why gRPC-Web still needs a bridge"
                    description="The official gRPC-Web and Envoy guidance matters when your consumers live in browsers."
                  />
                  <ExternalLink
                    href={bootstrap.debuggingURL}
                    title="gRPC debugging beyond request payloads"
                    description="grpcdebug and admin services become essential when the problem is transport state, not request JSON."
                  />
                </div>
              </section>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function schemaSourceLabel(value: WorkspaceTargetProfile['schemaSource']) {
  switch (value) {
    case 'proto-files':
      return 'Proto files';
    case 'protoset':
      return 'Protoset';
    default:
      return 'Reflection';
  }
}

function parseMultilineValues(value: string) {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function countProtoMessages(messages: ProtoMessageSummary[]): number {
  return messages.reduce((total, message) => total + 1 + countProtoMessages(message.messages), 0);
}

function countProtoEnums(messages: ProtoMessageSummary[], enums: ProtoEnumSummary[]): number {
  return (
    enums.length +
    messages.reduce((total, message) => total + countProtoEnums(message.messages, message.enums), 0)
  );
}

function LauncherShell({
  activeTargetId,
  bootstrap,
  busy,
  error,
  onChangeDraft,
  onConnectTarget,
  onDeleteTarget,
  onEditTarget,
  onSaveAndConnectTarget,
  onSaveTarget,
  targetDraft,
  targets,
}: {
  activeTargetId: string;
  bootstrap: BootstrapResponse;
  busy: boolean;
  error: string | null;
  onChangeDraft: (next: Partial<WorkspaceTargetProfile>) => void;
  onConnectTarget: (target: WorkspaceTargetProfile) => void;
  onDeleteTarget: (id: string) => void;
  onEditTarget: (target: WorkspaceTargetProfile) => void;
  onSaveAndConnectTarget: () => void;
  onSaveTarget: () => void;
  targetDraft: WorkspaceTargetProfile;
  targets: WorkspaceTargetProfile[];
}) {
  return (
    <div className="pp-shell">
      <div className="pp-orb pointer-events-none absolute left-[-120px] top-24 size-72 rounded-full bg-pp-brand/15 blur-3xl" />
      <div className="pp-orb pointer-events-none absolute right-[-80px] top-40 size-64 rounded-full bg-pp-accent/20 blur-3xl" />

      <div className="mx-auto max-w-7xl space-y-6">
        <section className="pp-panel-strong overflow-hidden px-6 py-6 lg:px-8 lg:py-8">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-5">
              <div className="pp-badge">
                <Sparkles className="size-4" />
                `pp` can boot without a bound target
              </div>
              <h1 className="pp-heading max-w-4xl text-5xl leading-[1.02] tracking-[-0.05em] md:text-7xl">
                Launch ProtoPeek first, then attach any gRPC server you need.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-pp-muted">
                Save local, staging, or internet-reachable gRPC targets with transport-aware
                settings. Reflection, proto files, and protosets stay explicit so the tool remains
                unmistakably gRPC-focused instead of drifting into a generic API client.
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Saved targets" value={String(targets.length)} />
                <MetricCard
                  label="Active mode"
                  value={busy ? 'Connecting' : 'Workspace launcher'}
                />
                <MetricCard label="Binary path" value="protopeek / pp" />
              </div>
            </div>

            <div className="grid gap-4 self-start md:grid-cols-2">
              <FeatureTeaser
                icon={Server}
                title="Multi-target registry"
                body="Keep separate local, staging, and remote endpoints without restarting the console."
              />
              <FeatureTeaser
                icon={FileCode2}
                title="Descriptor-aware launch"
                body="Choose reflection, proto files, or protosets per target instead of forcing a single global mode."
              />
              <FeatureTeaser
                icon={FlaskConical}
                title="Test and simulate"
                body="Once connected, run assertions and lightweight load sweeps from the same workspace."
              />
              <FeatureTeaser
                icon={BookOpenText}
                title="Learn the transport"
                body="Use the embedded gRPC learning links while you debug trailers, metadata, and browser-facing topologies."
              />
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
          <section className="pp-panel">
            <PanelHeader
              icon={Server}
              title="Connect a gRPC target"
              description="Define one target profile or edit an existing one, then connect into the full ProtoPeek console."
            />

            {error ? (
              <div className="mt-5">
                <StatusBanner tone="danger" title="Connection failed" description={error} />
              </div>
            ) : null}

            <TargetDraftForm
              busy={busy}
              draft={targetDraft}
              onChange={onChangeDraft}
              onSave={onSaveTarget}
              onSaveAndConnect={onSaveAndConnectTarget}
            />
          </section>

          <div className="space-y-6">
            <section className="pp-panel">
              <PanelHeader
                icon={Library}
                title="Saved targets"
                description="Persist transport-aware endpoints locally and jump between them from the launcher or inside the console."
              />
              <div className="mt-5 space-y-3">
                {targets.length === 0 ? (
                  <EmptyState
                    icon={Server}
                    title="No targets saved yet"
                    description="Create a launcher target for localhost, staging, or a remote gRPC endpoint and it will appear here."
                  />
                ) : (
                  targets.map((target) => (
                    <TargetCard
                      active={target.id === activeTargetId}
                      busy={busy}
                      key={target.id}
                      target={target}
                      onConnect={onConnectTarget}
                      onDelete={onDeleteTarget}
                      onEdit={onEditTarget}
                    />
                  ))
                )}
              </div>
            </section>

            <section className="pp-panel">
              <PanelHeader
                icon={SquareArrowOutUpRight}
                title="Docs and project links"
                description="ProtoPeek’s public docs, repo, and author links live here."
              />
              <div className="mt-5 space-y-3">
                <ExternalLink
                  href={bootstrap.docsURL}
                  title="ProtoPeek website"
                  description="Narrative docs, learn pages, and launch material for the new branded project."
                />
                <ExternalLink
                  href={bootstrap.learnURL}
                  title="Learn gRPC visually"
                  description="Use the public learn page while you explore reflection, metadata, streaming, and gRPC-Web."
                />
                <ExternalLink
                  href={bootstrap.authorURL}
                  title={`By ${bootstrap.authorName}`}
                  description="Project branding, writing, and public site by Shreyam Adhikari."
                />
                <ExternalLink
                  href={bootstrap.repoURL}
                  title="GitHub repository"
                  description="Source, issues, release notes, and the install path for ProtoPeek."
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function TargetDraftForm({
  busy,
  draft,
  onChange,
  onSave,
  onSaveAndConnect,
}: {
  busy: boolean;
  draft: WorkspaceTargetProfile;
  onChange: (next: Partial<WorkspaceTargetProfile>) => void;
  onSave: () => void;
  onSaveAndConnect: () => void;
}) {
  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="pp-label">Target name</span>
          <input
            className="pp-input mt-2"
            value={draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="Local dev gateway"
          />
        </label>
        <label className="block">
          <span className="pp-label">Address</span>
          <input
            className="pp-input mt-2"
            value={draft.address}
            onChange={(event) => onChange({ address: event.target.value })}
            placeholder="localhost:50051"
          />
        </label>
      </div>

      <label className="block">
        <span className="pp-label">Notes</span>
        <textarea
          className="pp-input mt-2 min-h-[96px]"
          value={draft.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          placeholder="Why this target exists, expected auth, or when to use it."
        />
      </label>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="pp-label">Schema source</span>
          <select
            className="pp-input mt-2"
            value={draft.schemaSource}
            onChange={(event) =>
              onChange({
                schemaSource: event.target.value as WorkspaceTargetProfile['schemaSource'],
              })
            }
          >
            <option value="reflection">Reflection</option>
            <option value="proto-files">Proto files</option>
            <option value="protoset">Protoset</option>
          </select>
        </label>
        <label className="block">
          <span className="pp-label">Authority override</span>
          <input
            className="pp-input mt-2"
            value={draft.authority}
            onChange={(event) => onChange({ authority: event.target.value })}
            placeholder="grpc.example.internal"
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-3 rounded-[22px] border border-pp-border bg-white/75 px-4 py-3">
            <input
              checked={draft.plaintext}
              onChange={(event) =>
                onChange({
                  plaintext: event.target.checked,
                  insecure: event.target.checked ? false : draft.insecure,
                })
              }
              type="checkbox"
            />
            <span className="text-sm font-semibold text-pp-ink">Plaintext</span>
          </label>
          <label className="flex items-center gap-3 rounded-[22px] border border-pp-border bg-white/75 px-4 py-3">
            <input
              checked={draft.insecure}
              disabled={draft.plaintext}
              onChange={(event) => onChange({ insecure: event.target.checked })}
              type="checkbox"
            />
            <span className="text-sm font-semibold text-pp-ink">Skip verify</span>
          </label>
        </div>
      </div>

      {!draft.plaintext ? (
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="pp-label">CA cert path</span>
            <input
              className="pp-input mt-2"
              value={draft.cacertPath}
              onChange={(event) => onChange({ cacertPath: event.target.value })}
              placeholder="/certs/ca.pem"
            />
          </label>
          <label className="block">
            <span className="pp-label">Client cert path</span>
            <input
              className="pp-input mt-2"
              value={draft.certPath}
              onChange={(event) => onChange({ certPath: event.target.value })}
              placeholder="/certs/client.pem"
            />
          </label>
          <label className="block">
            <span className="pp-label">Client key path</span>
            <input
              className="pp-input mt-2"
              value={draft.keyPath}
              onChange={(event) => onChange({ keyPath: event.target.value })}
              placeholder="/certs/client-key.pem"
            />
          </label>
        </div>
      ) : null}

      {draft.schemaSource === 'proto-files' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="pp-label">Proto files</span>
            <textarea
              className="pp-input mt-2 min-h-[120px] font-mono text-sm"
              value={draft.protoFiles.join('\n')}
              onChange={(event) =>
                onChange({ protoFiles: parseMultilineValues(event.target.value) })
              }
              placeholder={'api/service.proto\napi/types.proto'}
            />
          </label>
          <label className="block">
            <span className="pp-label">Import paths</span>
            <textarea
              className="pp-input mt-2 min-h-[120px] font-mono text-sm"
              value={draft.importPaths.join('\n')}
              onChange={(event) =>
                onChange({ importPaths: parseMultilineValues(event.target.value) })
              }
              placeholder={'proto\nthird_party'}
            />
          </label>
        </div>
      ) : null}

      {draft.schemaSource === 'protoset' ? (
        <label className="block">
          <span className="pp-label">Protoset files</span>
          <textarea
            className="pp-input mt-2 min-h-[120px] font-mono text-sm"
            value={draft.protosets.join('\n')}
            onChange={(event) => onChange({ protosets: parseMultilineValues(event.target.value) })}
            placeholder={'dist/service.protoset\nartifacts/types.protoset'}
          />
        </label>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button className="pp-button-secondary" disabled={busy} onClick={onSave} type="button">
          <Save className="size-4" />
          Save target
        </button>
        <button
          className="pp-button-primary"
          disabled={busy}
          onClick={onSaveAndConnect}
          type="button"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
          Save and connect
        </button>
      </div>
    </div>
  );
}

function TargetCard({
  active,
  busy,
  onConnect,
  onDelete,
  onEdit,
  target,
}: {
  active: boolean;
  busy: boolean;
  onConnect: (target: WorkspaceTargetProfile) => void;
  onDelete: (id: string) => void;
  onEdit: (target: WorkspaceTargetProfile) => void;
  target: WorkspaceTargetProfile;
}) {
  return (
    <div className="rounded-[24px] border border-pp-border bg-white/75 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-pp-ink">{target.name}</div>
          <div className="pp-muted mt-1 break-all">{target.address}</div>
        </div>
        {active ? <span className="pp-badge text-emerald-700">Active</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className="pp-badge">{schemaSourceLabel(target.schemaSource)}</span>
        <span className="pp-badge">{target.plaintext ? 'Plaintext' : 'TLS'}</span>
        {target.insecure ? <span className="pp-badge text-amber-700">Skip verify</span> : null}
      </div>

      <div className="pp-muted mt-3">{target.notes || 'No notes yet.'}</div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="pp-button-primary"
          disabled={busy}
          onClick={() => onConnect(target)}
          type="button"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
          Connect
        </button>
        <button className="pp-button-secondary" onClick={() => onEdit(target)} type="button">
          Edit
        </button>
        <button
          className="pp-button-ghost px-3 py-2"
          onClick={() => onDelete(target.id)}
          type="button"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ProtoStructurePanel({
  catalog,
  onExportCatalog,
  onExportProto,
  onJumpToCompose,
  onSearchChange,
  onSelectFile,
  onToggleWellKnown,
  searchText,
  selectedFile,
  selectedProto,
  showWellKnown,
  visibleFiles,
}: {
  catalog: ProtoCatalogResponse | null;
  onExportCatalog: () => void;
  onExportProto: (file: ProtoFileSummary) => void;
  onJumpToCompose: () => void;
  onSearchChange: (value: string) => void;
  onSelectFile: (value: string) => void;
  onToggleWellKnown: (value: boolean) => void;
  searchText: string;
  selectedFile: string;
  selectedProto: ProtoFileSummary | null;
  showWellKnown: boolean;
  visibleFiles: ProtoFileSummary[];
}) {
  const fileCount = catalog?.files.length ?? 0;
  const serviceCount = catalog?.files.reduce((total, file) => total + file.services.length, 0) ?? 0;
  const messageCount =
    catalog?.files.reduce((total, file) => total + countProtoMessages(file.messages), 0) ?? 0;
  const enumCount =
    catalog?.files.reduce((total, file) => total + countProtoEnums(file.messages, file.enums), 0) ??
    0;

  if (!catalog) {
    return (
      <EmptyState
        icon={BookMarked}
        title="Proto explorer is loading"
        description="ProtoPeek is pulling the available descriptors so it can render file topology and exportable schema views."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Files" value={String(fileCount)} />
        <MetricCard label="Services" value={String(serviceCount)} />
        <MetricCard label="Messages" value={String(messageCount)} />
        <MetricCard label="Enums" value={String(enumCount)} />
      </div>

      <section className="rounded-[28px] border border-pp-border bg-white/75 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="pp-label">Explorer, generator, exporter</div>
            <div className="pp-muted mt-2">
              Browse the full proto contract here, export the raw `.proto` text, and jump back to
              Compose when you want ProtoPeek to generate a starter request body from the selected
              RPC schema.
            </div>
          </div>
          <button className="pp-button-secondary" onClick={onJumpToCompose} type="button">
            <Sparkles className="size-4" />
            Open request generator
          </button>
        </div>
      </section>

      <section className="rounded-[28px] border border-pp-border bg-white/75 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-pp-muted" />
            <input
              className="pp-input pl-11"
              value={searchText}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search proto files, packages, services, or messages"
            />
          </label>
          <label className="flex items-center gap-3 rounded-[22px] border border-pp-border bg-white/85 px-4 py-3">
            <input
              checked={showWellKnown}
              onChange={(event) => onToggleWellKnown(event.target.checked)}
              type="checkbox"
            />
            <span className="text-sm font-semibold text-pp-ink">Show well-known types</span>
          </label>
          <button className="pp-button-secondary" onClick={onExportCatalog} type="button">
            <Download className="size-4" />
            Export catalog JSON
          </button>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-3">
            {visibleFiles.length === 0 ? (
              <EmptyState
                icon={FileCode2}
                title="No proto files matched"
                description="Adjust the search or include well-known protobuf types to widen the explorer scope."
              />
            ) : (
              visibleFiles.map((file) => (
                <button
                  className={classNames(
                    'block w-full rounded-[22px] border p-4 text-left transition',
                    file.name === selectedFile
                      ? 'border-pp-brand bg-pp-brand/5'
                      : 'border-pp-border bg-white/85 hover:border-pp-brand/35 hover:bg-white'
                  )}
                  key={file.name}
                  onClick={() => onSelectFile(file.name)}
                  type="button"
                >
                  <div className="font-semibold text-pp-ink">{file.name}</div>
                  <div className="pp-muted mt-2">
                    {file.package || 'No package'} · {file.services.length} services ·{' '}
                    {countProtoMessages(file.messages)} messages
                  </div>
                </button>
              ))
            )}
          </div>

          {selectedProto ? (
            <div className="space-y-5">
              <section className="rounded-[24px] border border-pp-border bg-white/85 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="pp-label">Selected proto file</div>
                    <h4 className="mt-2 text-2xl font-semibold text-pp-ink">
                      {selectedProto.name}
                    </h4>
                    <div className="pp-muted mt-2">
                      Package {selectedProto.package || 'none'} ·{' '}
                      {selectedProto.dependencies.length} imports
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="pp-button-secondary"
                      onClick={() => onExportProto(selectedProto)}
                      type="button"
                    >
                      <Download className="size-4" />
                      Export `.proto`
                    </button>
                    <button
                      className="pp-button-ghost px-3 py-2"
                      onClick={() => void navigator.clipboard.writeText(selectedProto.protoText)}
                      type="button"
                    >
                      <Copy className="size-4" />
                      Copy text
                    </button>
                  </div>
                </div>

                {selectedProto.dependencies.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedProto.dependencies.map((dependency) => (
                      <span className="pp-badge" key={dependency}>
                        {dependency}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="rounded-[24px] border border-pp-border bg-white/85 p-4">
                <div className="pp-label">Service flow</div>
                <div className="mt-4 space-y-4">
                  {selectedProto.services.length === 0 ? (
                    <div className="pp-muted">No services are declared in this file.</div>
                  ) : (
                    selectedProto.services.map((service) => (
                      <div
                        className="rounded-[22px] border border-pp-border bg-white/80 p-4"
                        key={service.fullName}
                      >
                        <div className="font-semibold text-pp-ink">{service.fullName}</div>
                        <div className="mt-3 space-y-3">
                          {service.methods.map((method) => (
                            <div
                              className="rounded-[18px] border border-pp-border bg-[#f8fcfc] p-3"
                              key={method.fullName}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="font-semibold text-pp-ink">{method.name}</div>
                                <span className="pp-badge">
                                  {method.clientStreaming ? 'client stream' : 'unary'} to{' '}
                                  {method.serverStreaming ? 'server stream' : 'unary'}
                                </span>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-pp-muted">
                                <span className="rounded-full border border-pp-border bg-white px-3 py-1 font-mono">
                                  {method.requestType}
                                </span>
                                <span>→</span>
                                <span className="rounded-full border border-pp-border bg-white px-3 py-1 font-mono">
                                  {method.responseType}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-pp-border bg-white/85 p-4">
                <div className="pp-label">Message structure</div>
                <div className="mt-4 space-y-4">
                  {selectedProto.messages.length === 0 ? (
                    <div className="pp-muted">No top-level messages are declared in this file.</div>
                  ) : (
                    selectedProto.messages.map((message) => (
                      <ProtoMessageCard key={message.fullName} message={message} />
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-pp-border bg-white/85 p-4">
                <div className="pp-label">Enums</div>
                <div className="mt-4 space-y-4">
                  {selectedProto.enums.length === 0 ? (
                    <div className="pp-muted">
                      Top-level enums are nested inside message cards for this file.
                    </div>
                  ) : (
                    selectedProto.enums.map((entry) => (
                      <ProtoEnumCard entry={entry} key={entry.fullName} />
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-pp-border bg-white/85 p-4">
                <div className="pp-label">Raw proto text</div>
                <pre className="pp-code mt-4 max-h-[420px] overflow-auto">
                  {selectedProto.protoText}
                </pre>
              </section>
            </div>
          ) : (
            <EmptyState
              icon={BookMarked}
              title="Pick a proto file"
              description="Select a file from the explorer rail to inspect service flow, nested messages, enums, and exportable raw proto text."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function ProtoMessageCard({ message }: { message: ProtoMessageSummary }) {
  return (
    <div className="rounded-[22px] border border-pp-border bg-white/80 p-4">
      <div className="font-semibold text-pp-ink">{message.fullName}</div>

      <div className="mt-4 space-y-2">
        {message.fields.length === 0 ? (
          <div className="pp-muted">No fields in this message.</div>
        ) : (
          message.fields.map((field) => (
            <div
              className="rounded-[18px] border border-pp-border bg-[#f8fcfc] px-3 py-3"
              key={`${message.fullName}-${field.name}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-pp-ink">{field.name}</span>
                <span className="pp-badge">{field.type}</span>
                <span className="pp-badge">{field.label}</span>
                {field.oneOf ? <span className="pp-badge">oneof {field.oneOf}</span> : null}
                {field.map ? <span className="pp-badge">map</span> : null}
              </div>
            </div>
          ))
        )}
      </div>

      {message.enums.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="pp-label">Nested enums</div>
          {message.enums.map((entry) => (
            <ProtoEnumCard entry={entry} key={entry.fullName} />
          ))}
        </div>
      ) : null}

      {message.messages.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="pp-label">Nested messages</div>
          {message.messages.map((entry) => (
            <ProtoMessageCard key={entry.fullName} message={entry} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProtoEnumCard({ entry }: { entry: ProtoEnumSummary }) {
  return (
    <div className="rounded-[22px] border border-pp-border bg-white/80 p-4">
      <div className="font-semibold text-pp-ink">{entry.fullName}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {entry.values.map((value) => (
          <span className="pp-badge" key={`${entry.fullName}-${value.name}`}>
            {value.name} = {value.number}
          </span>
        ))}
      </div>
    </div>
  );
}

function FeatureTeaser({
  icon: Icon,
  title,
  body,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[28px] border border-pp-border bg-white/75 p-5 shadow-[var(--pp-shadow)]">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-pp-brand/10 text-pp-brand">
        <Icon className="size-5" />
      </div>
      <div className="mt-4 text-lg font-semibold text-pp-ink">{title}</div>
      <p className="pp-muted mt-3">{body}</p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[22px] border border-pp-border bg-white/75 p-3">
      <Icon className="mt-0.5 size-4 text-pp-brand" />
      <div className="min-w-0">
        <div className="pp-label">{label}</div>
        <div className="truncate text-sm font-semibold text-pp-ink">{value}</div>
      </div>
    </div>
  );
}

function ViewButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={classNames(
        'flex items-center justify-between rounded-[22px] px-4 py-3 text-left text-sm font-semibold transition',
        active
          ? 'bg-pp-brand text-white shadow-lg shadow-pp-brand/20'
          : 'border border-pp-border bg-white/75 text-pp-ink hover:bg-white'
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center gap-3">
        <Icon className="size-4" />
        {label}
      </span>
    </button>
  );
}

function MethodModeBadge({ method }: { method: BootstrapMethod }) {
  const mode = `${method.clientStreaming ? 'client stream' : 'unary'} → ${
    method.serverStreaming ? 'server stream' : 'unary'
  }`;
  return <span className="pp-badge">{mode}</span>;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-pp-border bg-white/75 p-4">
      <div className="pp-label">{label}</div>
      <div className="mt-2 text-lg font-semibold text-pp-ink">{value}</div>
    </div>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-pp-brand/10 text-pp-brand">
        <Icon className="size-5" />
      </div>
      <div>
        <h3 className="pp-heading text-2xl">{title}</h3>
        <p className="pp-muted mt-2">{description}</p>
      </div>
    </div>
  );
}

function ServiceTree({
  service,
  selectedMethod,
  searchText,
  onSelect,
}: {
  service: BootstrapService;
  selectedMethod: string;
  searchText: string;
  onSelect: (method: string) => void;
}) {
  const autoOpen = Boolean(searchText.trim());
  const [open, setOpen] = useState(
    autoOpen || service.methods.some((method) => method.fullName === selectedMethod)
  );

  useEffect(() => {
    if (autoOpen) {
      setOpen(true);
    }
  }, [autoOpen]);

  const visibleMethods = service.methods.filter((method) => {
    if (!searchText.trim()) {
      return true;
    }

    const query = searchText.toLowerCase();
    return (
      method.name.toLowerCase().includes(query) || method.fullName.toLowerCase().includes(query)
    );
  });

  if (visibleMethods.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[24px] border border-pp-border bg-white/75 p-3">
      <button
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <div>
          <div className="font-semibold text-pp-ink">{service.name}</div>
          <div className="pp-muted">{visibleMethods.length} methods</div>
        </div>
        <span
          className={classNames(
            'rounded-full border border-pp-border p-2 transition',
            open ? 'rotate-90 bg-pp-brand/10 text-pp-brand' : 'bg-white text-pp-muted'
          )}
        >
          <SquareArrowOutUpRight className="size-3.5" />
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-2">
          {visibleMethods.map((method) => (
            <button
              className={classNames(
                'block w-full rounded-[18px] px-3 py-3 text-left transition',
                method.fullName === selectedMethod
                  ? 'bg-pp-brand text-white shadow-lg shadow-pp-brand/20'
                  : 'border border-transparent bg-white/70 text-pp-ink hover:border-pp-brand/30 hover:bg-white'
              )}
              key={method.fullName}
              onClick={() => onSelect(method.fullName)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{method.name}</span>
                <span className="text-[0.7rem] uppercase tracking-[0.16em] opacity-70">
                  {method.serverStreaming || method.clientStreaming ? 'stream' : 'rpc'}
                </span>
              </div>
              <div className="mt-2 line-clamp-2 text-xs opacity-80">{method.requestType}</div>
            </button>
          ))}
        </div>
      ) : null}
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
    <div
      className="rounded-[20px] border border-pp-border bg-white/80 p-3"
      style={{ marginLeft: depth * 10 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-pp-ink">{field.name}</span>
        <span className="pp-badge">{field.type}</span>
        {field.isRequired ? <span className="pp-badge text-amber-700">required</span> : null}
        {field.isArray ? <span className="pp-badge">array</span> : null}
        {field.isMap ? <span className="pp-badge">map</span> : null}
      </div>
      <pre className="mt-3 whitespace-pre-wrap rounded-[18px] border border-pp-border bg-[#f6fbfb] px-3 py-3 font-mono text-[0.72rem] leading-6 text-pp-muted">
        {field.description}
      </pre>

      {field.isMessage && schema.messageTypes[field.type]?.length ? (
        <div className="mt-3 space-y-3">
          {schema.messageTypes[field.type].map((nestedField) => (
            <SchemaField
              key={`${field.name}-${nestedField.name}`}
              field={nestedField}
              schema={schema}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}

      {field.type === 'oneof' && field.oneOfFields.length > 0 ? (
        <div className="mt-3 space-y-3">
          {field.oneOfFields.map((choice) => (
            <SchemaField
              key={`${field.name}-${choice.name}`}
              field={choice}
              schema={schema}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResponseMetadata({ title, values }: { title: string; values: MetadataEntry[] }) {
  return (
    <section className="rounded-[28px] border border-pp-border bg-white/75 p-4">
      <div className="pp-label">{title}</div>
      <div className="mt-3 space-y-2">
        {values.length === 0 ? (
          <div className="pp-muted">None.</div>
        ) : (
          values.map((entry, index) => (
            <div
              className="grid gap-2 rounded-[18px] border border-pp-border bg-white/80 px-3 py-3 md:grid-cols-[180px_1fr]"
              // biome-ignore lint/suspicious/noArrayIndexKey: read-only response metadata, never reordered
              key={index}
            >
              <span className="font-mono text-xs font-semibold text-pp-ink">{entry.name}</span>
              <span className="break-all font-mono text-xs text-pp-muted">{entry.value}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ResponseData({ title, values }: { title: string; values: unknown[] }) {
  return (
    <section className="rounded-[28px] border border-pp-border bg-white/75 p-4">
      <div className="pp-label">{title}</div>
      <div className="mt-3 space-y-3">
        {values.length === 0 ? (
          <div className="pp-muted">No payloads received yet.</div>
        ) : (
          values.map((value, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: read-only response payload list, never reordered
            <pre className="pp-code" key={index}>
              {prettyJson(value)}
            </pre>
          ))
        )}
      </div>
    </section>
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
        'rounded-[24px] border p-4',
        tone === 'danger'
          ? 'border-pp-danger/20 bg-pp-danger/5'
          : 'border-pp-brand/20 bg-pp-brand/5'
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
      <p className="pp-muted mt-2">{description}</p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-pp-border px-4 py-6 text-center">
      <Icon className="mx-auto size-8 text-pp-brand" />
      <div className="mt-3 font-semibold text-pp-ink">{title}</div>
      <p className="pp-muted mt-2">{description}</p>
    </div>
  );
}

function ExternalLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <a
      className="block rounded-[24px] border border-pp-border bg-white/75 p-4 transition hover:border-pp-brand/35 hover:bg-white"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-pp-ink">{title}</div>
        <SquareArrowOutUpRight className="size-4 text-pp-brand" />
      </div>
      <div className="pp-muted mt-2">{description}</div>
    </a>
  );
}

function LabeledInput({
  label,
  value,
  type,
  onChange,
}: {
  label: string;
  value: number;
  type: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="pp-label">{label}</span>
      <input
        className="pp-input mt-2"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

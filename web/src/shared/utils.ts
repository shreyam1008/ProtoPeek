import type {
  AssertionResult,
  AssertionRule,
  BootstrapMethod,
  EnvironmentPreset,
  FieldDefinition,
  HTTPHistoryEntry,
  InvokeResponse,
  MetadataEntry,
  MethodFilter,
  RequestHistoryEntry,
  SavedCollection,
  SchemaResponse,
  SimulationConfig,
  SimulationRun,
  WorkspaceTargetConfig,
  WorkspaceTargetProfile,
} from './types';

export const appStorageKeys = {
  assertions: 'protopeek.assertions.v1',
  collections: 'protopeek.collections.v1',
  environments: 'protopeek.environments.v1',
  history: 'protopeek.history.v1',
  httpHistory: 'protopeek.httpHistory.v1',
  methodFilter: 'protopeek.methodFilter.v1',
  selectedMethod: 'protopeek.selectedMethod.v1',
  simulation: 'protopeek.simulation.v1',
  targets: 'protopeek.targets.v1',
  activeTargetId: 'protopeek.activeTargetId.v1',
  discoveries: 'protopeek.discoveries.v1',
  pendingGRPCTarget: 'protopeek.pendingGRPCTarget.v1',
  pendingHTTPURL: 'protopeek.pendingHTTPURL.v1',
};

export const redactedValue = '[redacted]';

export function isSensitiveMetadataName(name: string) {
  const normalized = name.trim().toLowerCase().replaceAll('_', '-');
  if (
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'set-cookie' ||
    normalized === 'proxy-authorization' ||
    normalized.endsWith('-bin')
  ) {
    return true;
  }
  const compact = normalized.replaceAll(/[^a-z0-9]/g, '');
  return (
    compact === 'apikey' ||
    compact === 'accesstoken' ||
    compact === 'refreshtoken' ||
    compact === 'idtoken' ||
    /(^|[-.])(api-?key|auth-?token|access-?token|refresh-?token|id-?token|token|secret)([-.]|$)/.test(
      normalized
    )
  );
}

export function sanitizeMetadataForPersistence(entries: MetadataEntry[]) {
  return entries.map((entry) => ({
    ...entry,
    value: isSensitiveMetadataName(entry.name) ? redactedValue : entry.value,
  }));
}

export function sanitizeAssertionForPersistence(rule: AssertionRule) {
  if ((rule.kind === 'header' || rule.kind === 'trailer') && isSensitiveMetadataName(rule.target)) {
    return { ...rule, value: redactedValue };
  }
  return rule;
}

export function sanitizeInvokeResponseForExport(response: InvokeResponse): InvokeResponse {
  return {
    ...response,
    headers: sanitizeMetadataForPersistence(response.headers),
    trailers: sanitizeMetadataForPersistence(response.trailers),
  };
}

export function sanitizeURLForPersistence(value: string) {
  try {
    const parsed = new URL(value);
    for (const name of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveMetadataName(name) || /password|passwd|credential/i.test(name)) {
        parsed.searchParams.set(name, redactedValue);
      }
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function modifierKeyLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌘' : 'Ctrl';
}

export function loadStoredValue<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function storeValue(key: string, value: unknown) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences are an enhancement; storage denial must not break the console.
  }
}

export function removeStoredValue(key: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Keep the live session usable when browser storage is unavailable.
  }
}

export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function safeParseJson(text: string) {
  try {
    return {
      error: null,
      value: JSON.parse(text) as unknown,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid JSON payload.',
      value: null,
    };
  }
}

export function defaultValueForField(
  field: FieldDefinition,
  schema: SchemaResponse,
  seen: Set<string> = new Set()
): unknown {
  if (field.type === 'oneof') {
    return {};
  }

  if (field.isArray) {
    return [];
  }

  if (field.isMap) {
    return {};
  }

  if (field.isEnum) {
    const firstEnum = schema.enumTypes[field.type]?.[0];
    return field.defaultVal ?? firstEnum?.name ?? '';
  }

  if (field.isMessage) {
    if (seen.has(field.type)) {
      return {};
    }
    const nextSeen = new Set(seen);
    nextSeen.add(field.type);
    const messageFields = schema.messageTypes[field.type] ?? [];
    return Object.fromEntries(
      messageFields
        .filter((nestedField) => nestedField.type !== 'oneof')
        .map((nestedField) => [
          nestedField.name,
          defaultValueForField(nestedField, schema, nextSeen),
        ])
    );
  }

  if (field.defaultVal !== null && field.defaultVal !== undefined) {
    return field.defaultVal;
  }

  switch (field.type) {
    case 'string':
    case 'bytes':
      return '';
    case 'bool':
      return false;
    case 'float':
    case 'double':
    case 'int32':
    case 'int64':
    case 'sint32':
    case 'sint64':
    case 'uint32':
    case 'uint64':
    case 'fixed32':
    case 'fixed64':
    case 'sfixed32':
    case 'sfixed64':
      return 0;
    default:
      return '';
  }
}

export function generateRequestTemplate(schema: SchemaResponse) {
  const fields = schema.messageTypes[schema.requestType] ?? [];
  const payload = Object.fromEntries(
    fields
      .filter((field) => field.type !== 'oneof')
      .map((field) => [field.name, defaultValueForField(field, schema)])
  );
  return schema.requestStream ? [payload] : payload;
}

export function clampSimulationConfig(config: SimulationConfig): SimulationConfig {
  return {
    runs: Math.max(1, Math.min(config.runs, 500)),
    concurrency: Math.max(1, Math.min(config.concurrency, 50)),
    thinkTimeMs: Math.max(0, Math.min(config.thinkTimeMs, 5000)),
  };
}

export function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function simulationSummary(
  method: string,
  config: SimulationConfig,
  latencies: number[],
  successCount: number,
  errorCount: number,
  totalMs: number
): SimulationRun {
  return {
    id: uid('sim'),
    createdAt: new Date().toISOString(),
    method,
    config,
    totalMs,
    successCount,
    errorCount,
    throughputRps: totalMs > 0 ? (successCount / totalMs) * 1000 : 0,
    latencies,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  };
}

export function durationLabel(valueMs: number) {
  if (valueMs < 1000) {
    return `${valueMs.toFixed(0)} ms`;
  }

  return `${(valueMs / 1000).toFixed(2)} s`;
}

export function compactDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function responsePreview(value: unknown) {
  const preview = JSON.stringify(value);
  if (!preview) {
    return 'Empty response';
  }

  return preview.length > 140 ? `${preview.slice(0, 137)}...` : preview;
}

export function toHistoryEntry(args: {
  service: string;
  method: string;
  latencyMs: number;
  success: boolean;
  requestText: string;
  response: unknown;
  metadata: MetadataEntry[];
  timeoutSeconds: number;
}): RequestHistoryEntry {
  return {
    id: uid('hist'),
    createdAt: new Date().toISOString(),
    service: args.service,
    method: args.method,
    latencyMs: args.latencyMs,
    success: args.success,
    requestText: args.requestText,
    responsePreview: responsePreview(args.response),
    metadata: sanitizeMetadataForPersistence(args.metadata),
    timeoutSeconds: args.timeoutSeconds,
  };
}

export function toCollection(args: {
  name: string;
  notes: string;
  service: string;
  method: string;
  metadata: MetadataEntry[];
  timeoutSeconds: number;
  requestText: string;
  existingId?: string;
  existingCreatedAt?: string;
}): SavedCollection {
  const now = new Date().toISOString();
  return {
    id: args.existingId ?? uid('collection'),
    createdAt: args.existingCreatedAt ?? now,
    updatedAt: now,
    name: args.name,
    notes: args.notes,
    service: args.service,
    method: args.method,
    metadata: sanitizeMetadataForPersistence(args.metadata),
    timeoutSeconds: args.timeoutSeconds,
    requestText: args.requestText,
  };
}

export function toEnvironmentPreset(args: {
  name: string;
  notes: string;
  metadata: MetadataEntry[];
  timeoutSeconds: number;
  existingId?: string;
}): EnvironmentPreset {
  return {
    id: args.existingId ?? uid('env'),
    name: args.name,
    notes: args.notes,
    metadata: sanitizeMetadataForPersistence(args.metadata),
    timeoutSeconds: args.timeoutSeconds,
    updatedAt: new Date().toISOString(),
  };
}

export function toHTTPHistoryEntry(args: {
  method: string;
  url: string;
  requestHeaders: MetadataEntry[];
  status: string;
  statusCode: number;
  totalMs: number;
}): HTTPHistoryEntry {
  return {
    id: uid('http-history'),
    createdAt: new Date().toISOString(),
    method: args.method,
    url: sanitizeURLForPersistence(args.url),
    requestHeaders: sanitizeMetadataForPersistence(args.requestHeaders),
    status: args.status,
    statusCode: args.statusCode,
    totalMs: args.totalMs,
  };
}

export function toWorkspaceTargetProfile(args: {
  id?: string;
  name: string;
  notes: string;
  config: WorkspaceTargetConfig;
}): WorkspaceTargetProfile {
  return {
    id: args.id ?? uid('target'),
    name: args.name,
    notes: args.notes,
    updatedAt: new Date().toISOString(),
    ...args.config,
  };
}

export function matchesMethodFilter(method: BootstrapMethod, filter: MethodFilter) {
  switch (filter) {
    case 'all':
      return true;
    case 'unary':
      return !method.clientStreaming && !method.serverStreaming;
    case 'client-streaming':
      return method.clientStreaming && !method.serverStreaming;
    case 'server-streaming':
      return !method.clientStreaming && method.serverStreaming;
    case 'bidirectional':
      return method.clientStreaming && method.serverStreaming;
    default:
      return true;
  }
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function metadataEntryFor(entries: MetadataEntry[], target: string) {
  const normalizedTarget = normalizeText(target);
  return entries.find((entry) => normalizeText(entry.name) === normalizedTarget);
}

function compareText(actual: string, expected: string, comparator: AssertionRule['comparator']) {
  if (comparator === 'contains') {
    return actual.toLowerCase().includes(expected.toLowerCase());
  }

  return actual.toLowerCase() === expected.toLowerCase();
}

function compareNumber(actual: number, expected: number, comparator: AssertionRule['comparator']) {
  switch (comparator) {
    case 'gte':
      return actual >= expected;
    case 'lte':
      return actual <= expected;
    default:
      return actual === expected;
  }
}

export function evaluateAssertions(args: {
  rules: AssertionRule[];
  result: InvokeResponse;
  latencyMs: number;
}): AssertionResult[] {
  const payloadText = prettyJson(args.result.responses.map((entry) => entry.message));
  const status = args.result.error ? args.result.error.name : 'OK';

  return args.rules.map((rule) => {
    switch (rule.kind) {
      case 'status': {
        const passed = compareText(status, rule.value || 'OK', rule.comparator);
        return {
          id: rule.id,
          name: rule.name,
          passed,
          message: `Expected status ${rule.comparator} ${rule.value || 'OK'}; saw ${status}.`,
        };
      }
      case 'latency_ms': {
        const expected = Number(rule.value || 0);
        const passed = compareNumber(args.latencyMs, expected, rule.comparator);
        return {
          id: rule.id,
          name: rule.name,
          passed,
          message: `Expected latency ${rule.comparator} ${expected} ms; saw ${args.latencyMs.toFixed(0)} ms.`,
        };
      }
      case 'response_count': {
        const expected = Number(rule.value || 0);
        const actual = args.result.responses.length;
        const passed = compareNumber(actual, expected, rule.comparator);
        return {
          id: rule.id,
          name: rule.name,
          passed,
          message: `Expected response count ${rule.comparator} ${expected}; saw ${actual}.`,
        };
      }
      case 'header': {
        const entry = metadataEntryFor(args.result.headers, rule.target);
        const actual = entry?.value ?? '';
        const passed = rule.target ? compareText(actual, rule.value, rule.comparator) : false;
        return {
          id: rule.id,
          name: rule.name,
          passed,
          message: entry
            ? `Header ${rule.target} matched ${rule.comparator} ${rule.value}.`
            : `Header ${rule.target || '(missing name)'} was not present.`,
        };
      }
      case 'trailer': {
        const entry = metadataEntryFor(args.result.trailers, rule.target);
        const actual = entry?.value ?? '';
        const passed = rule.target ? compareText(actual, rule.value, rule.comparator) : false;
        return {
          id: rule.id,
          name: rule.name,
          passed,
          message: entry
            ? `Trailer ${rule.target} matched ${rule.comparator} ${rule.value}.`
            : `Trailer ${rule.target || '(missing name)'} was not present.`,
        };
      }
      case 'body_text': {
        const passed = compareText(payloadText, rule.value, rule.comparator);
        return {
          id: rule.id,
          name: rule.name,
          passed,
          message: `Expected payload ${rule.comparator} ${rule.value}.`,
        };
      }
      default:
        return {
          id: rule.id,
          name: rule.name,
          passed: false,
          message: 'Unknown assertion rule.',
        };
    }
  });
}

export function commandPreview(args: {
  target: string;
  method: string;
  metadata: MetadataEntry[];
  timeoutSeconds: number;
  requestText: string;
  grpcurlOptions: string;
}) {
  const headers = args.metadata
    .filter((entry) => entry.name.trim())
    .map((entry) => `-H '${entry.name}: ${entry.value}'`)
    .join(' ');
  const timeout = args.timeoutSeconds > 0 ? ` -max-time ${args.timeoutSeconds}` : '';
  const extra = args.grpcurlOptions ? ` ${args.grpcurlOptions}` : '';
  const data = `'${args.requestText.replaceAll("'", "'\"'\"'")}'`;
  return `grpcurl${extra}${timeout} ${headers} -d ${data} ${args.target} ${args.method}`.replace(
    /\s+/g,
    ' '
  );
}

export function displayBuildVersion(version: string) {
  const value = version.trim();
  if (!value || value.includes('<no version set>')) return 'development';
  return value;
}

export function sparklinePath(values: number[], width: number, height: number) {
  if (values.length === 0) {
    return '';
  }

  const max = Math.max(...values, 1);
  const step = values.length === 1 ? 0 : width / (values.length - 1);

  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - (value / max) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

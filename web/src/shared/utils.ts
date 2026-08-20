import { storageErrorMessage } from './runtime';
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
  RepeatAttempt,
  RepeatConfig,
  RepeatExportV1,
  RepeatRun,
  RepeatStopReason,
  RequestHistoryEntry,
  SavedCollection,
  SchemaResponse,
  ValidatedWorkspaceImport,
  WorkspaceExportV1,
  WorkspaceTargetConfig,
  WorkspaceTargetProfile,
} from './types';

export {
  appStorageKeys,
  classNames,
  compactDate,
  displayBuildVersion,
  loadStoredValue,
  modifierKeyLabel,
  removeStoredValue,
  type StorageWriteResult,
  storeValue,
  storeValuesAtomically,
} from './runtime';

export const redactedValue = '[redacted]';
export const workspaceImportMaxBytes = 4 * 1024 * 1024;
export const workspaceExportVersion = 1 as const;

export function workspaceSchemaSourceLabel(value: WorkspaceTargetConfig['schemaSource']) {
  if (value === 'browser-proto-folder') return 'Browser folder';
  if (value === 'proto-files') return 'Host proto paths';
  if (value === 'protoset') return 'Host protoset paths';
  return 'Reflection';
}

export const workspaceImportLimits = {
  assertions: 100,
  collections: 100,
  environments: 50,
  history: 50,
  metadata: 64,
  targetPaths: 32,
  targets: 50,
} as const;

const sensitiveMetadataAliases = [
  'access-key',
  'access-key-id',
  'access-token',
  'account-key',
  'api-key',
  'api-token',
  'app-secret',
  'assertion',
  'auth',
  'authentication',
  'auth-key',
  'auth-token',
  'authorization',
  'bearer',
  'bearer-token',
  'client-secret',
  'code-verifier',
  'consumer-secret',
  'consumer-key',
  'credential',
  'credentials',
  'encryption-key',
  'function-key',
  'functions-key',
  'id-token',
  'jwt',
  'master-key',
  'oauth-verifier',
  'password',
  'password-confirmation',
  'password-hash',
  'passwd',
  'private-key',
  'pwd',
  'refresh-token',
  'recovery-code',
  'backup-code',
  'device-code',
  'user-code',
  'verification-code',
  'mfa-code',
  'saml-response',
  'secret',
  'secret-key',
  'security-token',
  'session-id',
  'session-key',
  'session-token',
  'sig',
  'signature',
  'signing-key',
  'shared-key',
  'storage-key',
  'subscription-key',
  'token',
] as const;

const compactSensitiveMetadataAliases = sensitiveMetadataAliases.map((alias) =>
  alias.replaceAll('-', '')
);

const sensitiveURLExactNames = new Set([
  'code',
  'key',
  'otp',
  'pass',
  'passcode',
  'pin',
  'sas',
  'session',
  'ticket',
]);

const credentialQualifierPattern = /-(?:hint|v\d+)$/;

function canonicalCredentialName(name: string) {
  return name
    .trim()
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

export function isSensitiveMetadataName(name: string) {
  const normalized = canonicalCredentialName(name);
  if (
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'set-cookie' ||
    normalized === 'proxy-authorization' ||
    normalized.endsWith('-bin')
  ) {
    return true;
  }
  const candidates = [normalized];
  let base = normalized;
  while (credentialQualifierPattern.test(base)) {
    base = base.replace(credentialQualifierPattern, '');
    candidates.push(base);
  }
  return candidates.some((candidate) => {
    const compact = candidate.replaceAll('-', '');
    return (
      compactSensitiveMetadataAliases.some((alias) => compact.endsWith(alias)) ||
      sensitiveMetadataAliases.some(
        (alias) => candidate === alias || candidate.endsWith(`-${alias}`)
      )
    );
  });
}

function isSensitiveURLParameterName(name: string) {
  const normalized = canonicalCredentialName(name);
  return isSensitiveMetadataName(name) || sensitiveURLExactNames.has(normalized);
}

export function isRedactedValue(value: string) {
  return value.trim().toLowerCase() === redactedValue;
}

export function sanitizeMetadataForPersistence(entries: MetadataEntry[]) {
  return entries.map((entry) => ({
    ...entry,
    value: isSensitiveMetadataName(entry.name) ? redactedValue : entry.value,
  }));
}

export function prepareMetadataForReplay(entries: MetadataEntry[]) {
  let redactedCount = 0;
  const metadata = sanitizeMetadataForPersistence(entries).map((entry) => {
    if (!isRedactedValue(entry.value)) return entry;
    redactedCount++;
    return { ...entry, value: '' };
  });
  return { metadata, redactedCount };
}

export function filterMetadataForInvoke(entries: MetadataEntry[]) {
  return entries.filter(
    (entry) =>
      entry.name.trim() &&
      !isRedactedValue(entry.value) &&
      (!isSensitiveMetadataName(entry.name) || entry.value.trim().length > 0)
  );
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
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    const sanitized = new URLSearchParams();
    for (const [name, entryValue] of parsed.searchParams) {
      sanitized.append(name, isSensitiveURLParameterName(name) ? redactedValue : entryValue);
    }
    parsed.search = sanitized.toString();
    return parsed.toString();
  } catch {
    return value;
  }
}

export function prepareURLForReplay(value: string) {
  try {
    const parsed = new URL(value);
    let redactedCount = 0;
    parsed.hash = '';
    const replay = new URLSearchParams();
    for (const [name, entryValue] of parsed.searchParams) {
      if (isRedactedValue(entryValue)) {
        replay.append(name, '');
        redactedCount++;
      } else {
        replay.append(name, entryValue);
      }
    }
    parsed.search = replay.toString();
    return { url: parsed.toString(), redactedCount };
  } catch {
    return { url: value, redactedCount: 0 };
  }
}

const safeHTTPHistoryHeaders = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'content-type',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
  'pragma',
  'prefer',
  'range',
  'traceparent',
  'tracestate',
  'x-correlation-id',
  'x-request-id',
]);

export function sanitizeHTTPHeadersForPersistence(entries: MetadataEntry[]) {
  return entries.map((entry) => ({
    ...entry,
    value:
      safeHTTPHistoryHeaders.has(entry.name.trim().toLowerCase()) &&
      !isSensitiveMetadataName(entry.name)
        ? entry.value
        : redactedValue,
  }));
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

export function validateRepeatConfig(config: RepeatConfig): {
  error: string | null;
  value: RepeatConfig | null;
} {
  if (!Number.isInteger(config.count)) {
    return { error: 'Calls must be a whole number between 2 and 50.', value: null };
  }
  if (config.count < 2 || config.count > 50) {
    return { error: 'Calls must be between 2 and 50.', value: null };
  }
  if (!Number.isInteger(config.thinkTimeMs)) {
    return { error: 'Think time must be a whole number between 0 and 5000 ms.', value: null };
  }
  if (config.thinkTimeMs < 0 || config.thinkTimeMs > 5000) {
    return { error: 'Think time must be between 0 and 5000 ms.', value: null };
  }
  if (
    !Number.isFinite(config.deadlineSeconds) ||
    config.deadlineSeconds < 0.1 ||
    config.deadlineSeconds > 30
  ) {
    return { error: 'Per-call deadline must be between 0.1 and 30 seconds.', value: null };
  }
  return { error: null, value: { ...config } };
}

export function buildRepeatRun(args: {
  createdAt: string;
  method: string;
  target: string;
  config: RepeatConfig;
  attempts: RepeatAttempt[];
  totalMs: number;
  stopReason: RepeatStopReason;
}): RepeatRun {
  const counts = { ok: 0, grpcError: 0, localLimit: 0, relayTransportError: 0, cancelled: 0 };
  const completedAttempts: RepeatAttempt[] = [];
  for (const attempt of args.attempts) {
    switch (attempt.outcome) {
      case 'ok':
        counts.ok++;
        completedAttempts.push(attempt);
        break;
      case 'grpc-error':
        counts.grpcError++;
        completedAttempts.push(attempt);
        break;
      case 'local-limit':
        counts.localLimit++;
        break;
      case 'relay-transport-error':
        counts.relayTransportError++;
        break;
      case 'cancelled':
        counts.cancelled++;
        break;
    }
  }
  const hasHandlerInvokeTiming = completedAttempts.some(
    (attempt) => attempt.handlerInvokeMs !== null
  );
  const latencySource = hasHandlerInvokeTiming ? 'handler-invoke' : 'console-round-trip';
  const latencySamples = completedAttempts.flatMap((attempt) => {
    if (latencySource === 'handler-invoke') {
      return attempt.handlerInvokeMs === null ? [] : [attempt.handlerInvokeMs];
    }
    return [attempt.consoleRoundTripMs];
  });
  const sorted = latencySamples.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
        : (sorted[middle] ?? null);
  const p95Index = Math.ceil(sorted.length * 0.95) - 1;

  return {
    id: uid('repeat'),
    createdAt: args.createdAt,
    method: args.method,
    target: args.target,
    config: { ...args.config },
    requestedCount: args.config.count,
    totalMs: args.totalMs,
    stopReason: args.stopReason,
    counts,
    latency: {
      sampleCount: sorted.length,
      source: latencySource,
      minMs: sorted[0] ?? null,
      medianMs,
      p95Ms: sorted.length >= 20 ? (sorted[p95Index] ?? null) : null,
      maxMs: sorted.at(-1) ?? null,
    },
    attempts: [...args.attempts],
  };
}

function repeatRunForExport(run: RepeatRun): RepeatRun {
  return {
    id: run.id,
    createdAt: run.createdAt,
    method: run.method,
    target: run.target,
    config: {
      count: run.config.count,
      thinkTimeMs: run.config.thinkTimeMs,
      deadlineSeconds: run.config.deadlineSeconds,
    },
    requestedCount: run.requestedCount,
    totalMs: run.totalMs,
    stopReason: run.stopReason,
    counts: {
      ok: run.counts.ok,
      grpcError: run.counts.grpcError,
      localLimit: run.counts.localLimit,
      relayTransportError: run.counts.relayTransportError,
      cancelled: run.counts.cancelled,
    },
    latency: {
      sampleCount: run.latency.sampleCount,
      source: run.latency.source,
      minMs: run.latency.minMs,
      medianMs: run.latency.medianMs,
      p95Ms: run.latency.p95Ms,
      maxMs: run.latency.maxMs,
    },
    attempts: run.attempts.map((attempt) => ({
      sequence: attempt.sequence,
      startedOffsetMs: attempt.startedOffsetMs,
      consoleRoundTripMs: attempt.consoleRoundTripMs,
      handlerInvokeMs: attempt.handlerInvokeMs,
      outcome: attempt.outcome,
      responseCount: attempt.responseCount,
      headerCount: attempt.headerCount,
      trailerCount: attempt.trailerCount,
      grpcStatus: attempt.grpcStatus
        ? {
            code: attempt.grpcStatus.code,
            name: attempt.grpcStatus.name,
            message: attempt.grpcStatus.message,
          }
        : null,
      error: attempt.error,
    })),
  };
}

export function serializeRepeatRun(run: RepeatRun) {
  const exported: RepeatExportV1 = {
    format: 'protopeek-repeat',
    version: 1,
    exportedAt: new Date().toISOString(),
    run: repeatRunForExport(run),
  };
  return JSON.stringify(exported, null, 2);
}

export function durationLabel(valueMs: number) {
  if (valueMs < 1000) {
    return `${valueMs.toFixed(0)} ms`;
  }

  return `${(valueMs / 1000).toFixed(2)} s`;
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
  targetId?: string;
  targetAddress?: string;
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
    targetId: args.targetId,
    targetAddress: args.targetAddress,
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
  targetId?: string;
  targetAddress?: string;
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
    targetId: args.targetId,
    targetAddress: args.targetAddress,
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
    requestHeaders: sanitizeHTTPHeadersForPersistence(args.requestHeaders),
    status: args.status,
    statusCode: args.statusCode,
    totalMs: args.totalMs,
  };
}

export function normalizeHTTPHistory(value: unknown): HTTPHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const normalized: HTTPHistoryEntry[] = [];
  for (const candidate of value.slice(0, 50)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const entry = candidate as Record<string, unknown>;
    if (
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      entry.id.length > 512 ||
      typeof entry.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.createdAt)) ||
      typeof entry.method !== 'string' ||
      !/^[A-Z]+$/.test(entry.method) ||
      entry.method.length > 16 ||
      typeof entry.url !== 'string' ||
      entry.url.length > 8192 ||
      typeof entry.status !== 'string' ||
      entry.status.length > 128 ||
      typeof entry.statusCode !== 'number' ||
      !Number.isInteger(entry.statusCode) ||
      entry.statusCode < 0 ||
      entry.statusCode > 999 ||
      typeof entry.totalMs !== 'number' ||
      !Number.isFinite(entry.totalMs) ||
      entry.totalMs < 0 ||
      entry.totalMs > 86_400_000 ||
      !Array.isArray(entry.requestHeaders) ||
      entry.requestHeaders.length > 32
    ) {
      continue;
    }
    try {
      const parsedURL = new URL(entry.url);
      if (parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    const headers: MetadataEntry[] = [];
    let validHeaders = true;
    for (const rawHeader of entry.requestHeaders) {
      if (!rawHeader || typeof rawHeader !== 'object' || Array.isArray(rawHeader)) {
        validHeaders = false;
        break;
      }
      const header = rawHeader as Record<string, unknown>;
      if (
        typeof header.name !== 'string' ||
        header.name.length > 512 ||
        typeof header.value !== 'string' ||
        header.value.length > 4096
      ) {
        validHeaders = false;
        break;
      }
      headers.push({ name: header.name, value: header.value });
    }
    if (!validHeaders) continue;
    const requestHeaders = sanitizeHTTPHeadersForPersistence(headers);
    const next: HTTPHistoryEntry = {
      id: entry.id,
      createdAt: entry.createdAt,
      method: entry.method,
      url: sanitizeURLForPersistence(entry.url),
      requestHeaders,
      status: entry.status,
      statusCode: entry.statusCode,
      totalMs: entry.totalMs,
    };
    if (JSON.stringify(next).length > 32 * 1024) continue;
    normalized.push(next);
  }
  return normalized;
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

const workspaceStringLimits = {
  id: 512,
  label: 512,
  metadataName: 512,
  metadataValue: 64 * 1024,
  notes: 16 * 1024,
  path: 4096,
  preview: 4096,
  request: 512 * 1024,
} as const;

type UnknownRecord = Record<string, unknown>;

function workspaceRecord(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as UnknownRecord;
}

function workspaceString(value: unknown, path: string, max: number, allowEmpty = true): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
  if (!allowEmpty && !value.trim()) throw new Error(`${path} must not be empty.`);
  if (value.length > max) throw new Error(`${path} exceeds the ${max}-character limit.`);
  return value;
}

function workspaceTimestamp(value: unknown, path: string) {
  const timestamp = workspaceString(value, path, 64, false);
  if (!Number.isFinite(Date.parse(timestamp)))
    throw new Error(`${path} must be a valid timestamp.`);
  return timestamp;
}

function optionalWorkspaceString(value: unknown, path: string, max: number) {
  if (value === undefined) return undefined;
  const normalized = workspaceString(value, path, max).trim();
  return normalized || undefined;
}

function workspaceNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} must be a finite number from ${min} to ${max}.`);
  }
  return value;
}

function workspaceBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  return value;
}

function workspaceArray(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > max) throw new Error(`${path} exceeds the ${max}-item limit.`);
  return value;
}

function workspaceMetadata(value: unknown, path: string): MetadataEntry[] {
  const entries = workspaceArray(value, path, workspaceImportLimits.metadata).map((item, index) => {
    const entry = workspaceRecord(item, `${path}[${index}]`);
    return {
      name: workspaceString(
        entry.name,
        `${path}[${index}].name`,
        workspaceStringLimits.metadataName
      ),
      value: workspaceString(
        entry.value,
        `${path}[${index}].value`,
        workspaceStringLimits.metadataValue
      ),
    };
  });
  return sanitizeMetadataForPersistence(entries);
}

function workspacePathList(value: unknown, path: string) {
  return workspaceArray(value, path, workspaceImportLimits.targetPaths).map((item, index) =>
    workspaceString(item, `${path}[${index}]`, workspaceStringLimits.path, false)
  );
}

function assertUniqueWorkspaceIds(items: Array<{ id: string }>, path: string) {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`${path} contains duplicate id ${item.id}.`);
    ids.add(item.id);
  }
}

function parseWorkspaceAssertions(value: unknown): AssertionRule[] {
  const allowedKinds: AssertionRule['kind'][] = [
    'status',
    'latency_ms',
    'header',
    'trailer',
    'response_count',
    'body_text',
  ];
  const allowedComparators: AssertionRule['comparator'][] = ['equals', 'contains', 'lte', 'gte'];
  const result = workspaceArray(value, 'assertions', workspaceImportLimits.assertions).map(
    (item, index) => {
      const path = `assertions[${index}]`;
      const rule = workspaceRecord(item, path);
      const kind = workspaceString(rule.kind, `${path}.kind`, 32) as AssertionRule['kind'];
      const comparator = workspaceString(
        rule.comparator,
        `${path}.comparator`,
        32
      ) as AssertionRule['comparator'];
      if (!allowedKinds.includes(kind)) throw new Error(`${path}.kind is not supported.`);
      if (!allowedComparators.includes(comparator)) {
        throw new Error(`${path}.comparator is not supported.`);
      }
      return sanitizeAssertionForPersistence({
        id: workspaceString(rule.id, `${path}.id`, workspaceStringLimits.id, false),
        name: workspaceString(rule.name, `${path}.name`, workspaceStringLimits.label),
        kind,
        comparator,
        target: workspaceString(rule.target, `${path}.target`, workspaceStringLimits.label),
        value: workspaceString(rule.value, `${path}.value`, workspaceStringLimits.metadataValue),
      });
    }
  );
  assertUniqueWorkspaceIds(result, 'assertions');
  return result;
}

function parseWorkspaceCollections(value: unknown): SavedCollection[] {
  const result = workspaceArray(value, 'collections', workspaceImportLimits.collections).map(
    (item, index) => {
      const path = `collections[${index}]`;
      const entry = workspaceRecord(item, path);
      return {
        id: workspaceString(entry.id, `${path}.id`, workspaceStringLimits.id, false),
        createdAt: workspaceTimestamp(entry.createdAt, `${path}.createdAt`),
        updatedAt: workspaceTimestamp(entry.updatedAt, `${path}.updatedAt`),
        name: workspaceString(entry.name, `${path}.name`, workspaceStringLimits.label),
        notes: workspaceString(entry.notes, `${path}.notes`, workspaceStringLimits.notes),
        service: workspaceString(
          entry.service,
          `${path}.service`,
          workspaceStringLimits.label,
          false
        ),
        method: workspaceString(entry.method, `${path}.method`, workspaceStringLimits.label, false),
        metadata: workspaceMetadata(entry.metadata, `${path}.metadata`),
        timeoutSeconds: workspaceNumber(entry.timeoutSeconds, `${path}.timeoutSeconds`, 0, 86400),
        requestText: workspaceString(
          entry.requestText,
          `${path}.requestText`,
          workspaceStringLimits.request
        ),
        targetId: optionalWorkspaceString(
          entry.targetId,
          `${path}.targetId`,
          workspaceStringLimits.id
        ),
        targetAddress: optionalWorkspaceString(
          entry.targetAddress,
          `${path}.targetAddress`,
          workspaceStringLimits.path
        ),
      };
    }
  );
  assertUniqueWorkspaceIds(result, 'collections');
  return result;
}

function parseWorkspaceEnvironments(value: unknown): EnvironmentPreset[] {
  const result = workspaceArray(value, 'environments', workspaceImportLimits.environments).map(
    (item, index) => {
      const path = `environments[${index}]`;
      const entry = workspaceRecord(item, path);
      return {
        id: workspaceString(entry.id, `${path}.id`, workspaceStringLimits.id, false),
        name: workspaceString(entry.name, `${path}.name`, workspaceStringLimits.label),
        notes: workspaceString(entry.notes, `${path}.notes`, workspaceStringLimits.notes),
        metadata: workspaceMetadata(entry.metadata, `${path}.metadata`),
        timeoutSeconds: workspaceNumber(entry.timeoutSeconds, `${path}.timeoutSeconds`, 0, 86400),
        updatedAt: workspaceTimestamp(entry.updatedAt, `${path}.updatedAt`),
      };
    }
  );
  assertUniqueWorkspaceIds(result, 'environments');
  return result;
}

function parseWorkspaceHistory(value: unknown): RequestHistoryEntry[] {
  const result = workspaceArray(value, 'history', workspaceImportLimits.history).map(
    (item, index) => {
      const path = `history[${index}]`;
      const entry = workspaceRecord(item, path);
      return {
        id: workspaceString(entry.id, `${path}.id`, workspaceStringLimits.id, false),
        createdAt: workspaceTimestamp(entry.createdAt, `${path}.createdAt`),
        service: workspaceString(
          entry.service,
          `${path}.service`,
          workspaceStringLimits.label,
          false
        ),
        method: workspaceString(entry.method, `${path}.method`, workspaceStringLimits.label, false),
        latencyMs: workspaceNumber(entry.latencyMs, `${path}.latencyMs`, 0, 86_400_000),
        success: workspaceBoolean(entry.success, `${path}.success`),
        requestText: workspaceString(
          entry.requestText,
          `${path}.requestText`,
          workspaceStringLimits.request
        ),
        responsePreview: workspaceString(
          entry.responsePreview,
          `${path}.responsePreview`,
          workspaceStringLimits.preview
        ),
        metadata: workspaceMetadata(entry.metadata, `${path}.metadata`),
        timeoutSeconds: workspaceNumber(entry.timeoutSeconds, `${path}.timeoutSeconds`, 0, 86400),
        targetId: optionalWorkspaceString(
          entry.targetId,
          `${path}.targetId`,
          workspaceStringLimits.id
        ),
        targetAddress: optionalWorkspaceString(
          entry.targetAddress,
          `${path}.targetAddress`,
          workspaceStringLimits.path
        ),
      };
    }
  );
  assertUniqueWorkspaceIds(result, 'history');
  return result;
}

function parseWorkspaceTargets(value: unknown): WorkspaceTargetProfile[] {
  const result = workspaceArray(value, 'targets', workspaceImportLimits.targets).map(
    (item, index) => {
      const path = `targets[${index}]`;
      const target = workspaceRecord(item, path);
      const schemaSource = workspaceString(
        target.schemaSource,
        `${path}.schemaSource`,
        32
      ) as WorkspaceTargetProfile['schemaSource'];
      if (
        !['reflection', 'browser-proto-folder', 'proto-files', 'protoset'].includes(schemaSource)
      ) {
        throw new Error(`${path}.schemaSource is not supported.`);
      }
      const protoFiles = workspacePathList(target.protoFiles, `${path}.protoFiles`);
      const importPaths = workspacePathList(target.importPaths, `${path}.importPaths`);
      const protosets = workspacePathList(target.protosets, `${path}.protosets`);
      if (
        schemaSource === 'browser-proto-folder' &&
        (protoFiles.length > 0 || importPaths.length > 0 || protosets.length > 0)
      ) {
        throw new Error(`${path} browser folder cannot include host proto or protoset paths.`);
      }
      return {
        id: workspaceString(target.id, `${path}.id`, workspaceStringLimits.id, false).trim(),
        name: workspaceString(target.name, `${path}.name`, workspaceStringLimits.label),
        notes: workspaceString(target.notes, `${path}.notes`, workspaceStringLimits.notes),
        updatedAt: workspaceTimestamp(target.updatedAt, `${path}.updatedAt`),
        address: workspaceString(
          target.address,
          `${path}.address`,
          workspaceStringLimits.path,
          false
        ),
        plaintext: workspaceBoolean(target.plaintext, `${path}.plaintext`),
        insecure: workspaceBoolean(target.insecure, `${path}.insecure`),
        authority: workspaceString(
          target.authority,
          `${path}.authority`,
          workspaceStringLimits.path
        ),
        cacertPath: workspaceString(
          target.cacertPath,
          `${path}.cacertPath`,
          workspaceStringLimits.path
        ),
        certPath: workspaceString(target.certPath, `${path}.certPath`, workspaceStringLimits.path),
        keyPath: workspaceString(target.keyPath, `${path}.keyPath`, workspaceStringLimits.path),
        schemaSource,
        protoFiles,
        importPaths,
        protosets,
      };
    }
  );
  assertUniqueWorkspaceIds(result, 'targets');
  return result;
}

function workspaceHasHostFilePaths(targets: WorkspaceTargetProfile[]) {
  return targets.some(
    (target) =>
      Boolean(target.cacertPath || target.certPath || target.keyPath) ||
      target.protoFiles.length > 0 ||
      target.importPaths.length > 0 ||
      target.protosets.length > 0
  );
}

export function workspaceTargetReferenceError(
  entries: Array<Pick<SavedCollection | RequestHistoryEntry, 'id' | 'targetId' | 'targetAddress'>>,
  targets: Array<Pick<WorkspaceTargetProfile, 'id' | 'address'>>
) {
  const addresses = new Map(targets.map((target) => [target.id.trim(), target.address.trim()]));
  for (const entry of entries) {
    const targetId = entry.targetId?.trim();
    const targetAddress = entry.targetAddress?.trim();
    if (!targetId) continue;
    const profileAddress = addresses.get(targetId);
    if (profileAddress !== undefined) {
      if (targetAddress && targetAddress !== profileAddress) {
        return `Saved request ${entry.id} target address conflicts with profile ${targetId}.`;
      }
      continue;
    }
    if (!targetAddress) {
      return `Saved request ${entry.id} refers to an unavailable target and has no address fallback.`;
    }
  }
  return null;
}

export function buildWorkspaceExport(args: {
  assertions: AssertionRule[];
  collections: SavedCollection[];
  environments: EnvironmentPreset[];
  targets: WorkspaceTargetProfile[];
}): WorkspaceExportV1 {
  const workspace: WorkspaceExportV1 = {
    format: 'protopeek-workspace',
    version: workspaceExportVersion,
    exportedAt: new Date().toISOString(),
    assertions: args.assertions.map(sanitizeAssertionForPersistence),
    collections: args.collections.map((entry) => ({
      ...entry,
      metadata: sanitizeMetadataForPersistence(entry.metadata),
    })),
    environments: args.environments.map((entry) => ({
      ...entry,
      metadata: sanitizeMetadataForPersistence(entry.metadata),
    })),
    targets: args.targets,
  };
  const validated = validateWorkspaceImport(workspace);
  if (validated.error || !validated.value) {
    throw new Error(`Workspace cannot be exported: ${validated.error || 'Invalid workspace.'}`);
  }
  const referenceError = workspaceTargetReferenceError(
    validated.value.collections,
    validated.value.targets
  );
  if (referenceError) throw new Error(`Workspace cannot be exported: ${referenceError}`);
  return {
    ...workspace,
    assertions: validated.value.assertions,
    collections: validated.value.collections,
    environments: validated.value.environments,
    targets: validated.value.targets,
  };
}

export function serializeWorkspaceExport(args: Parameters<typeof buildWorkspaceExport>[0]) {
  const serialized = JSON.stringify(buildWorkspaceExport(args), null, 2);
  if (new TextEncoder().encode(serialized).length > workspaceImportMaxBytes) {
    throw new Error('Workspace cannot be exported: the file would exceed the 4 MiB import limit.');
  }
  return serialized;
}

export function validateWorkspaceImport(
  value: unknown
): { error: string; value: null } | { error: null; value: ValidatedWorkspaceImport } {
  try {
    const input = workspaceRecord(value, 'Workspace');
    const versioned = Object.hasOwn(input, 'version') || Object.hasOwn(input, 'format');
    if (versioned) {
      if (input.format !== 'protopeek-workspace') {
        throw new Error('Workspace format must be "protopeek-workspace".');
      }
      if (input.version !== workspaceExportVersion) {
        throw new Error(`Workspace version ${String(input.version)} is not supported.`);
      }
      workspaceTimestamp(input.exportedAt, 'exportedAt');
      for (const field of ['assertions', 'collections', 'environments', 'targets'] as const) {
        if (!Object.hasOwn(input, field)) throw new Error(`${field} is required.`);
      }
    } else if (
      !['assertions', 'collections', 'environments', 'history', 'targets'].some((field) =>
        Object.hasOwn(input, field)
      )
    ) {
      throw new Error('Legacy workspace has no supported collections.');
    }

    const assertions = Object.hasOwn(input, 'assertions')
      ? parseWorkspaceAssertions(input.assertions)
      : [];
    const collections = Object.hasOwn(input, 'collections')
      ? parseWorkspaceCollections(input.collections)
      : [];
    const environments = Object.hasOwn(input, 'environments')
      ? parseWorkspaceEnvironments(input.environments)
      : [];
    const history = Object.hasOwn(input, 'history')
      ? parseWorkspaceHistory(input.history)
      : undefined;
    const targets = Object.hasOwn(input, 'targets') ? parseWorkspaceTargets(input.targets) : [];

    return {
      error: null,
      value: {
        legacy: !versioned,
        sections: {
          assertions: Object.hasOwn(input, 'assertions'),
          collections: Object.hasOwn(input, 'collections'),
          environments: Object.hasOwn(input, 'environments'),
          history: Object.hasOwn(input, 'history'),
          targets: Object.hasOwn(input, 'targets'),
        },
        assertions,
        collections,
        environments,
        history,
        targets,
        hasHostFilePaths: workspaceHasHostFilePaths(targets),
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid workspace JSON.',
      value: null,
    };
  }
}

type StoredWorkspaceSections = {
  assertions: AssertionRule[];
  collections: SavedCollection[];
  environments: EnvironmentPreset[];
  history: RequestHistoryEntry[];
  targets: WorkspaceTargetProfile[];
};

export type StoredWorkspaceRecovery = {
  key: string;
  section: keyof StoredWorkspaceSections;
  /** Exact stored JSON, or null when the browser refused the read. */
  raw: string | null;
  reason: string;
};

export type StoredWorkspaceSectionLoad<T> = {
  value: T;
  recovery: StoredWorkspaceRecovery | null;
};

const maxStoredRecoveryInspection = 1000;

function storedSectionLimit(section: keyof StoredWorkspaceSections) {
  return workspaceImportLimits[section];
}

function validatedStoredFallback<K extends keyof StoredWorkspaceSections>(
  section: K,
  fallback: StoredWorkspaceSections[K]
) {
  const validated = validateWorkspaceImport({ [section]: fallback });
  const value = validated.value?.[section];
  return (Array.isArray(value) ? value : []) as StoredWorkspaceSections[K];
}

function storedWorkspaceRecovery<K extends keyof StoredWorkspaceSections>(
  key: string,
  section: K,
  raw: string | null,
  reason: string
): StoredWorkspaceRecovery {
  return { key, section, raw, reason };
}

export function loadStoredWorkspaceSection<K extends keyof StoredWorkspaceSections>(
  key: string,
  section: K,
  fallback: StoredWorkspaceSections[K]
): StoredWorkspaceSectionLoad<StoredWorkspaceSections[K]> {
  const safeFallback = validatedStoredFallback(section, fallback);
  if (typeof window === 'undefined') return { value: safeFallback, recovery: null };

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch (error) {
    return {
      value: safeFallback,
      recovery: storedWorkspaceRecovery(
        key,
        section,
        null,
        `Browser storage could not be read: ${storageErrorMessage(error)}`
      ),
    };
  }
  if (raw === null) return { value: safeFallback, recovery: null };

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return {
      value: safeFallback,
      recovery: storedWorkspaceRecovery(key, section, raw, 'Stored JSON is malformed.'),
    };
  }
  if (!Array.isArray(stored)) {
    return {
      value: safeFallback,
      recovery: storedWorkspaceRecovery(key, section, raw, 'Stored data is not an array.'),
    };
  }

  const limit = storedSectionLimit(section);
  const recovered: StoredWorkspaceSections[K] = [] as unknown as StoredWorkspaceSections[K];
  const ids = new Set<string>();
  let rejected = 0;
  let overLimit = 0;
  const inspected = stored.slice(0, maxStoredRecoveryInspection);
  const uninspected = stored.length - inspected.length;
  for (const candidate of inspected) {
    const validated = validateWorkspaceImport({ [section]: [candidate] });
    const values = validated.value?.[section];
    const entry = Array.isArray(values) ? values[0] : undefined;
    if (!entry) {
      rejected++;
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || ids.has(id)) {
      rejected++;
      continue;
    }
    ids.add(id);
    if (recovered.length >= limit) {
      overLimit++;
      continue;
    }
    recovered.push(entry as never);
  }

  if (rejected === 0 && overLimit === 0 && uninspected === 0) {
    return { value: recovered, recovery: null };
  }
  const reasons = [
    rejected > 0
      ? `${rejected} invalid or duplicate ${rejected === 1 ? 'entry was' : 'entries were'} skipped`
      : '',
    overLimit > 0
      ? `${overLimit} ${overLimit === 1 ? 'entry was' : 'entries were'} beyond the ${limit}-item limit`
      : '',
    uninspected > 0
      ? `${uninspected} ${uninspected === 1 ? 'entry was' : 'entries were'} left only in the raw recovery after the ${maxStoredRecoveryInspection}-item inspection cap`
      : '',
  ].filter(Boolean);
  return {
    value: recovered,
    recovery: storedWorkspaceRecovery(key, section, raw, `${reasons.join('; ')}.`),
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
  const status = args.result.localLimit
    ? 'LOCAL_LIMIT'
    : args.result.error
      ? args.result.error.name
      : 'OK';

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

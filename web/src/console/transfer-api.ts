export type TransferHealthStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'binary_missing'
  | 'locked'
  | 'failed'
  | 'unavailable';

export type TransferJobStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type TransferHealth = {
  ready: boolean;
  status: TransferHealthStatus;
  message: string;
  binaryPath: string;
  engineVersion: string;
};

export type TransferHostConfig = {
  version: number;
  aria2Path: string;
  downloadDirectory: string;
  maxActiveJobs: number;
  maxQueuedJobs: number;
  maxTrackedJobs: number;
  maxConnectionsPerHost: number;
  split: number;
  minSplitSizeBytes: number;
  maxDownloadBytesPerSecond: number;
  minimumFreeDiskBytes: number;
  continuePartialDownloads: boolean;
  autoRenameConflictingFiles: boolean;
  allowOverwriteExistingFiles: boolean;
  allowInsecureTls: boolean;
  userAgent: string;
};

export type TransferJob = {
  id: string;
  name: string;
  status: TransferJobStatus;
  directory: string;
  outputPath: string;
  source: string;
  totalBytes: number;
  completedBytes: number;
  progressPercent: number;
  bytesPerSecond: number;
  connections: number;
  etaSeconds: number;
  errorCode: string;
  errorMessage: string;
  expectedSha256: string;
  actualSha256: string;
  verifiedBytes: number;
  verificationStatus:
    | 'not_requested'
    | 'pending'
    | 'verifying'
    | 'verified'
    | 'failed'
    | 'mismatch'
    | 'unavailable';
  verificationMessage: string;
};

export type TransferMetrics = {
  activeCount: number;
  queuedCount: number;
  pausedCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  totalCount: number;
  bytesPerSecond: number;
};

export type TransferSnapshot = {
  observedAt: string;
  health: TransferHealth;
  config: TransferHostConfig;
  metrics: TransferMetrics;
  jobs: TransferJob[];
};

export type TransferMutationResult = {
  id: string;
  persistenceWarning: string;
};

const healthStatuses = new Set<TransferHealthStatus>([
  'stopped',
  'starting',
  'running',
  'stopping',
  'binary_missing',
  'locked',
  'failed',
  'unavailable',
]);

const jobStatuses = new Set<TransferJobStatus>([
  'queued',
  'downloading',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'unknown',
]);

function urlFor(path: string) {
  return new URL(path, window.location.href).toString();
}

function csrfToken() {
  return document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '';
}

async function boundedError(response: Response, limit = 8 * 1024) {
  if (!response.body) {
    const text = (await response.text()).slice(0, limit).trim();
    return text || `${response.status} ${response.statusText}`.trim() || 'Transfer request failed.';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - length;
      chunks.push(value.subarray(0, remaining));
      length += Math.min(value.length, remaining);
      if (value.length > remaining) {
        truncated = true;
        break;
      }
    }
    if (length === limit) truncated = true;
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder().decode(joined).trim();
  const fallback = `${response.status} ${response.statusText}`.trim() || 'Transfer request failed.';
  return `${text || fallback}${truncated ? '…' : ''}`;
}

async function requestJSON(path: string, init?: RequestInit) {
  const response = await fetch(urlFor(path), {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.method && init.method !== 'GET' ? { 'x-protopeek-csrf-token': csrfToken() } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await boundedError(response));
  if (response.status === 204) return null;
  return response.json() as Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedString(value: unknown, maximum = 8 * 1024) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function boundedInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? Math.min(value as number, maximum)
    : 0;
}

function boundedNumber(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, maximum)
    : 0;
}

function boundedBoolean(value: unknown) {
  return value === true;
}

function normalizeHealth(input: unknown): TransferHealth {
  const value = record(input);
  const status = boundedString(value.status, 64) as TransferHealthStatus;
  return {
    ready: boundedBoolean(value.ready),
    status: healthStatuses.has(status) ? status : 'unavailable',
    message: boundedString(value.message, 2 * 1024) || 'Downloader state is unavailable.',
    binaryPath: boundedString(value.binaryPath, 4 * 1024),
    engineVersion: boundedString(value.engineVersion, 128),
  };
}

function normalizeConfig(input: unknown): TransferHostConfig {
  const value = record(input);
  return {
    version: boundedInteger(value.version, 64),
    aria2Path: boundedString(value.aria2Path, 4 * 1024),
    downloadDirectory: boundedString(value.downloadDirectory, 4 * 1024),
    maxActiveJobs: boundedInteger(value.maxActiveJobs, 16),
    maxQueuedJobs: boundedInteger(value.maxQueuedJobs, 4096),
    maxTrackedJobs: boundedInteger(value.maxTrackedJobs, 4096),
    maxConnectionsPerHost: boundedInteger(value.maxConnectionsPerHost, 16),
    split: boundedInteger(value.split, 16),
    minSplitSizeBytes: boundedInteger(value.minSplitSizeBytes),
    maxDownloadBytesPerSecond: boundedInteger(value.maxDownloadBytesPerSecond),
    minimumFreeDiskBytes: boundedInteger(value.minimumFreeDiskBytes),
    continuePartialDownloads: boundedBoolean(value.continuePartialDownloads),
    autoRenameConflictingFiles: boundedBoolean(value.autoRenameConflictingFiles),
    allowOverwriteExistingFiles: boundedBoolean(value.allowOverwriteExistingFiles),
    allowInsecureTls: boundedBoolean(value.allowInsecureTls),
    userAgent: boundedString(value.userAgent, 256),
  };
}

function normalizeJob(input: unknown): TransferJob | null {
  const value = record(input);
  const id = boundedString(value.id, 256);
  if (!id) return null;
  const status = boundedString(value.status, 32) as TransferJobStatus;
  const verification = boundedString(value.verificationStatus, 32);
  return {
    id,
    name: boundedString(value.name, 2 * 1024) || 'Unnamed transfer',
    status: jobStatuses.has(status) ? status : 'unknown',
    directory: boundedString(value.directory, 4 * 1024),
    outputPath: boundedString(value.outputPath, 8 * 1024),
    source: boundedString(value.source, 8 * 1024),
    totalBytes: boundedInteger(value.totalBytes),
    completedBytes: boundedInteger(value.completedBytes),
    progressPercent: Math.min(100, boundedNumber(value.progressPercent, 100)),
    bytesPerSecond: boundedInteger(value.bytesPerSecond),
    connections: boundedInteger(value.connections, 64),
    etaSeconds: boundedInteger(value.etaSeconds, 365 * 24 * 60 * 60),
    errorCode: boundedString(value.errorCode, 128),
    errorMessage: boundedString(value.errorMessage, 2 * 1024),
    expectedSha256: boundedString(value.expectedSha256, 64),
    actualSha256: boundedString(value.actualSha256, 64),
    verifiedBytes: boundedInteger(value.verifiedBytes),
    verificationStatus:
      verification === 'pending' ||
      verification === 'verifying' ||
      verification === 'verified' ||
      verification === 'failed' ||
      verification === 'mismatch' ||
      verification === 'unavailable'
        ? verification
        : 'not_requested',
    verificationMessage: boundedString(value.verificationMessage, 2 * 1024),
  };
}

function normalizeMetrics(input: unknown): TransferMetrics {
  const value = record(input);
  return {
    activeCount: boundedInteger(value.activeCount, 4096),
    queuedCount: boundedInteger(value.queuedCount, 4096),
    pausedCount: boundedInteger(value.pausedCount, 4096),
    completedCount: boundedInteger(value.completedCount, 4096),
    failedCount: boundedInteger(value.failedCount, 4096),
    cancelledCount: boundedInteger(value.cancelledCount, 4096),
    totalCount: boundedInteger(value.totalCount, 4096),
    bytesPerSecond: boundedInteger(value.bytesPerSecond),
  };
}

function normalizeMutationResult(input: unknown, requireID = true): TransferMutationResult {
  const value = record(input);
  const id = boundedString(value.id, 64);
  if ((requireID && !id) || (id && !/^[0-9a-fA-F]{1,64}$/.test(id))) {
    throw new Error('ProtoPeek did not return a valid transfer id.');
  }
  return {
    id,
    persistenceWarning: boundedString(value.persistenceWarning, 2 * 1024),
  };
}

export function normalizeTransferSnapshot(input: unknown): TransferSnapshot {
  const value = record(input);
  const rawJobs = Array.isArray(value.jobs) ? value.jobs.slice(0, 4096) : [];
  const jobs = rawJobs.map(normalizeJob).filter((job): job is TransferJob => job !== null);
  const rawObservedAt = boundedString(value.observedAt, 128);
  return {
    observedAt:
      rawObservedAt && Number.isFinite(Date.parse(rawObservedAt))
        ? rawObservedAt
        : new Date(0).toISOString(),
    health: normalizeHealth(value.health),
    config: normalizeConfig(value.config),
    metrics: normalizeMetrics(value.metrics),
    jobs,
  };
}

export async function fetchTransferSnapshot(signal?: AbortSignal) {
  return normalizeTransferSnapshot(
    await requestJSON('api/transfers/snapshot', { method: 'GET', signal })
  );
}

async function mutateTransfer(path: string, body?: unknown, signal?: AbortSignal) {
  const input = await requestJSON(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  return input;
}

export async function startTransferEngine(signal?: AbortSignal) {
  await mutateTransfer('api/transfers/start', undefined, signal);
}

export async function addTransfer(
  source: string,
  options: { outputName?: string; sha256?: string } = {},
  signal?: AbortSignal
) {
  const payload: Record<string, unknown> = { sources: [source] };
  if (options.outputName) payload.outputName = options.outputName;
  if (options.sha256) payload.sha256 = options.sha256;
  return normalizeMutationResult(await mutateTransfer('api/transfers/add', payload, signal));
}

export async function mutateTransferJob(
  action: 'pause' | 'resume' | 'retry' | 'cancel',
  id: string,
  signal?: AbortSignal
) {
  const input = await mutateTransfer(`api/transfers/${action}`, { id }, signal);
  return normalizeMutationResult(input, action === 'retry');
}

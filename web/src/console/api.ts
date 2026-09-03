import {
  type BrowserProtoFolderSelection,
  browserProtoFolderLimits,
  buildBrowserProtoFolderSelection,
} from '@/shared/proto-folder';
import type {
  BootstrapResponse,
  ExampleResponse,
  HealthCheckRequest,
  HealthCheckResponse,
  HealthWatchEvent,
  HealthWatchRequest,
  HTTPRequestInput,
  HTTPResponse,
  InvokeRequest,
  InvokeResponse,
  ProtoCatalogResponse,
  SchemaResponse,
  WorkspaceConnectResponse,
  WorkspaceTargetConfig,
} from '@/shared/types';
import { parseHealthCheckResponse, parseHealthWatchNDJSON } from './health';

function urlFor(path: string) {
  return new URL(path, window.location.href).toString();
}

function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/);
  return match?.[1] ?? '';
}

async function fetchJSON<T>(path: string, init?: RequestInit) {
  const response = await fetch(urlFor(path), {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.method && init.method !== 'GET' ? { 'x-protopeek-csrf-token': csrfToken() } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await boundedResponseError(response));
  }

  return (await response.json()) as T;
}

async function boundedResponseError(response: Response, limit = 8 * 1024) {
  if (!response.body) {
    const text = typeof response.text === 'function' ? (await response.text()).slice(0, limit) : '';
    const fallback = `${response.status ?? ''} ${response.statusText ?? ''}`.trim();
    return text.trim() || fallback || 'Request failed.';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (bytes < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = limit - bytes;
      chunks.push(value.subarray(0, remaining));
      bytes += Math.min(value.length, remaining);
      if (value.length > remaining) {
        truncated = true;
        break;
      }
    }
    if (bytes === limit) truncated = true;
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder().decode(joined).trim();
  return `${text || `${response.status} ${response.statusText}`.trim()}${truncated ? '…' : ''}`;
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function nonNegativeMilliseconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeInvokeTimings(value: unknown): InvokeResponse['timings'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const timings = value as Record<string, unknown>;
  const totalMs = nonNegativeMilliseconds(timings.totalMs);
  if (totalMs === null) return null;
  return {
    headersMs: nonNegativeMilliseconds(timings.headersMs),
    firstMessageMs: nonNegativeMilliseconds(timings.firstMessageMs),
    trailersMs: nonNegativeMilliseconds(timings.trailersMs),
    totalMs,
  };
}

function normalizeInvokeLocalLimit(value: unknown): InvokeResponse['localLimit'] {
  if (value === null || value === undefined) return null;
  const invalid: NonNullable<InvokeResponse['localLimit']> = {
    reason: 'invalid',
    message:
      "ProtoPeek returned malformed local-limit evidence; the server's final gRPC status is not trusted.",
    retainedResponses: 0,
    retainedResponseBytes: 0,
    maxResponses: 0,
    maxResponseBytes: 0,
    maxDurationSeconds: 0,
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid;
  const limit = value as Record<string, unknown>;
  const reason = limit.reason;
  const message = limit.message;
  const retainedResponses = limit.retainedResponses;
  const retainedResponseBytes = limit.retainedResponseBytes;
  const maxResponses = limit.maxResponses;
  const maxResponseBytes = limit.maxResponseBytes;
  const maxDurationSeconds = limit.maxDurationSeconds;
  if (
    (reason !== 'response-count' && reason !== 'response-bytes' && reason !== 'duration') ||
    typeof message !== 'string' ||
    message.length === 0 ||
    message.length > 1024 ||
    !Number.isSafeInteger(retainedResponses) ||
    (retainedResponses as number) < 0 ||
    !Number.isSafeInteger(retainedResponseBytes) ||
    (retainedResponseBytes as number) < 0 ||
    !Number.isSafeInteger(maxResponses) ||
    (maxResponses as number) <= 0 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    (maxResponseBytes as number) <= 0 ||
    typeof maxDurationSeconds !== 'number' ||
    !Number.isFinite(maxDurationSeconds) ||
    maxDurationSeconds <= 0 ||
    maxDurationSeconds > 60 ||
    (retainedResponses as number) > (maxResponses as number) ||
    (retainedResponseBytes as number) > (maxResponseBytes as number)
  ) {
    return invalid;
  }
  return {
    reason,
    message,
    retainedResponses: retainedResponses as number,
    retainedResponseBytes: retainedResponseBytes as number,
    maxResponses: maxResponses as number,
    maxResponseBytes: maxResponseBytes as number,
    maxDurationSeconds,
  };
}

function normalizeInvokeElements(
  value: InvokeResponse['responses'] | null | undefined
): InvokeResponse['responses'] {
  return arrayOrEmpty(value).map((entry, index) => ({
    ...entry,
    sequence: entry.sequence ?? index + 1,
    elapsedMs: nonNegativeMilliseconds(entry.elapsedMs),
  }));
}

export function normalizeBootstrap(input: unknown): BootstrapResponse {
  const bootstrap = (input ?? {}) as BootstrapResponse;
  const defaults = (bootstrap.targetDefaults ?? {}) as WorkspaceTargetConfig;
  return {
    ...bootstrap,
    initialScanTarget: bootstrap.initialScanTarget ?? '',
    defaultMetadata: arrayOrEmpty(bootstrap.defaultMetadata),
    services: arrayOrEmpty(bootstrap.services).map((service) => ({
      ...service,
      methods: arrayOrEmpty(service.methods),
    })),
    targetDefaults: {
      address: defaults.address ?? '',
      plaintext: defaults.plaintext ?? true,
      insecure: defaults.insecure ?? false,
      authority: defaults.authority ?? '',
      cacertPath: defaults.cacertPath ?? '',
      certPath: defaults.certPath ?? '',
      keyPath: defaults.keyPath ?? '',
      schemaSource: defaults.schemaSource ?? 'reflection',
      protoFiles: arrayOrEmpty(defaults.protoFiles),
      importPaths: arrayOrEmpty(defaults.importPaths),
      protosets: arrayOrEmpty(defaults.protosets),
    },
  };
}

export function normalizeInvokeResponse(input: unknown): InvokeResponse {
  const response = (input ?? {}) as InvokeResponse;
  return {
    ...response,
    headers: arrayOrEmpty(response.headers),
    responses: normalizeInvokeElements(response.responses),
    trailers: arrayOrEmpty(response.trailers),
    requests: response.requests ?? null,
    timings: normalizeInvokeTimings(response.timings),
    localLimit: normalizeInvokeLocalLimit(response.localLimit),
    error: response.error
      ? { ...response.error, details: normalizeInvokeElements(response.error.details) }
      : null,
  };
}

function normalizeMessage(
  message: ProtoCatalogResponse['files'][number]['messages'][number]
): ProtoCatalogResponse['files'][number]['messages'][number] {
  return {
    ...message,
    fields: arrayOrEmpty(message.fields),
    messages: arrayOrEmpty(message.messages).map(normalizeMessage),
    enums: arrayOrEmpty(message.enums).map((entry) => ({
      ...entry,
      values: arrayOrEmpty(entry.values),
    })),
  };
}

export function normalizeProtoCatalog(input: unknown): ProtoCatalogResponse {
  const catalog = (input ?? {}) as ProtoCatalogResponse;
  return {
    files: arrayOrEmpty(catalog.files).map((file) => ({
      ...file,
      dependencies: arrayOrEmpty(file.dependencies),
      services: arrayOrEmpty(file.services).map((service) => ({
        ...service,
        methods: arrayOrEmpty(service.methods),
      })),
      messages: arrayOrEmpty(file.messages).map(normalizeMessage),
      enums: arrayOrEmpty(file.enums).map((entry) => ({
        ...entry,
        values: arrayOrEmpty(entry.values),
      })),
    })),
  };
}

export async function fetchBootstrap() {
  return normalizeBootstrap(await fetchJSON<unknown>('api/bootstrap'));
}

export function fetchExamples() {
  return fetchJSON<ExampleResponse[]>('examples');
}

export function fetchSchema(method: string) {
  return fetchJSON<SchemaResponse>(`metadata?method=${encodeURIComponent(method)}`);
}

export async function invokeMethod(method: string, payload: InvokeRequest, signal?: AbortSignal) {
  return normalizeInvokeResponse(
    await fetchJSON<unknown>(`invoke/${encodeURIComponent(method)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    })
  );
}

function healthPath(sessionId: string, operation: 'check' | 'watch') {
  if (!sessionId) return `api/health/${operation}`;
  return `api/workspace/health/${operation}?session_id=${encodeURIComponent(sessionId)}`;
}

export async function checkHealth(
  sessionId: string,
  payload: HealthCheckRequest,
  signal?: AbortSignal
): Promise<HealthCheckResponse> {
  return parseHealthCheckResponse(
    await fetchJSON<unknown>(healthPath(sessionId, 'check'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  );
}

export async function watchHealth(
  sessionId: string,
  payload: HealthWatchRequest,
  onEvent: (event: HealthWatchEvent) => void,
  signal?: AbortSignal
) {
  const response = await fetch(urlFor(healthPath(sessionId, 'watch')), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token': csrfToken(),
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) throw new Error(await boundedResponseError(response));
  const mediaType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/x-ndjson') {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Health Watch relay must return application/x-ndjson.');
  }
  if (!response.body) throw new Error('Health Watch relay returned no response stream.');
  await parseHealthWatchNDJSON(response.body, onEvent, signal);
}

export async function fetchProtoCatalog() {
  return normalizeProtoCatalog(await fetchJSON<unknown>('api/protos'));
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function browserProtoFolderBody(
  target: WorkspaceTargetConfig,
  folder: BrowserProtoFolderSelection | undefined
) {
  if (!folder) throw new Error('Folder required. Choose the proto folder again before connecting.');
  if (target.protoFiles.length || target.importPaths.length || target.protosets.length) {
    throw new Error('Browser folders cannot include host proto or protoset paths.');
  }

  const checked = buildBrowserProtoFolderSelection(
    folder.rootName,
    folder.files,
    folder.ignoredFileCount
  );
  const targetJSON = JSON.stringify(target);
  const manifestJSON = JSON.stringify({
    version: 1,
    files: checked.files.map((entry) => ({ path: entry.path, size: entry.file.size })),
  });
  const targetBytes = byteLength(targetJSON);
  const manifestBytes = byteLength(manifestJSON);
  if (targetBytes > browserProtoFolderLimits.maxTargetJSONBytes) {
    throw new Error('Target configuration exceeds the 64 KiB upload cap.');
  }
  if (manifestBytes > browserProtoFolderLimits.maxManifestJSONBytes) {
    throw new Error('Proto manifest exceeds the 512 KiB upload cap.');
  }

  // Browser boundaries are short, and filenames are fixed below. This intentionally
  // overestimates headers so the 20 MiB server envelope is never the first cap users hit.
  const conservativeEnvelopeBytes =
    checked.totalBytes + targetBytes + manifestBytes + 4096 + (checked.files.length + 2) * 1024;
  if (conservativeEnvelopeBytes > browserProtoFolderLimits.maxEnvelopeBytes) {
    throw new Error('Browser proto upload exceeds the 20 MiB multipart envelope cap.');
  }

  const body = new FormData();
  body.append('target', targetJSON);
  body.append('manifest', manifestJSON);
  for (const [index, entry] of checked.files.entries()) {
    body.append(`file.${index}`, entry.file, 'proto');
  }
  return body;
}

export async function connectWorkspaceTarget(
  target: WorkspaceTargetConfig,
  signal?: AbortSignal,
  browserFolder?: BrowserProtoFolderSelection
) {
  const browserUpload = target.schemaSource === 'browser-proto-folder';
  const response = await fetchJSON<WorkspaceConnectResponse>('api/workspace/connect', {
    method: 'POST',
    ...(browserUpload
      ? { body: browserProtoFolderBody(target, browserFolder) }
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target }),
        }),
    signal,
  });
  return { ...response, bootstrap: normalizeBootstrap(response.bootstrap) };
}

export async function disconnectWorkspaceSession(sessionId: string) {
  const response = await fetch(
    urlFor(`api/workspace/session?session_id=${encodeURIComponent(sessionId)}`),
    {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'x-protopeek-csrf-token': csrfToken() },
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(await response.text());
  }
}

export function fetchWorkspaceSchema(sessionId: string, method: string) {
  return fetchJSON<SchemaResponse>(
    `api/workspace/metadata?session_id=${encodeURIComponent(sessionId)}&method=${encodeURIComponent(method)}`
  );
}

export async function invokeWorkspaceMethod(
  sessionId: string,
  method: string,
  payload: InvokeRequest,
  signal?: AbortSignal
) {
  return normalizeInvokeResponse(
    await fetchJSON<unknown>(
      `api/workspace/invoke/${encodeURIComponent(method)}?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      }
    )
  );
}

export type ScanResult = {
  discoveredAt?: string;
  address: string;
  alive: boolean;
  tcp: boolean;
  grpc: boolean;
  http: boolean;
  protocols: Array<'tcp' | 'grpc' | 'http'> | null;
  reflection: 'available' | 'unavailable' | 'not-checked';
  transport: 'plaintext' | 'tls' | 'auto' | 'none' | '';
  services: string[] | null;
  servicesTruncated: boolean;
  httpTransport: 'plaintext' | 'tls' | '';
  httpProtocol: string;
  httpProtocolTruncated: boolean;
  httpStatus: string;
  httpStatusTruncated: boolean;
  httpStatusCode: number;
  httpServer: string;
  httpServerTruncated: boolean;
  failure:
    | 'unreachable'
    | 'non-grpc'
    | 'blocked'
    | 'request'
    | 'timeout'
    | 'cancelled'
    | 'indeterminate'
    | '';
  error: string | null;
  errorTruncated: boolean;
  details: string[] | null;
  detailsTruncated: boolean;
  latencyMs: number;
};

export type RouteResult = {
  destination: string;
  family: 'ipv4' | 'ipv6';
  status: 'ok' | 'error' | 'unsupported';
  sourceIp: string;
  interfaceIndex: number;
  interfaceName: string;
  nextHop: string;
  onLink: boolean;
  local: boolean;
  prefix: number | null;
  routeMetric: number | null;
  table: number | null;
  backend: string;
  notes: string[];
  error: string;
};

export type RouteLookupResponse = {
  perspective: 'protopeek-process';
  observedAt: string;
  results: RouteResult[];
};

export type NmapServiceHint = {
  name: string;
  product: string;
  version: string;
  extrainfo: string;
  tunnel: string;
  method: string;
  confidence: string;
};

export type NmapPortEvidence = {
  port: number;
  protocol: string;
  state: string;
  reason: string;
  service: NmapServiceHint;
};

export type NmapHostEvidence = {
  id: number;
  status: { state: string; reason: string };
  addresses: Array<{ address: string; type: string; vendor: string }>;
  hostnames: Array<{ name: string; type: string }>;
  ports: NmapPortEvidence[];
};

export type NmapImportResponse = {
  hosts: NmapHostEvidence[];
  hostCount: number;
  portCount: number;
  complete: boolean;
  completion: string;
};

export async function scanAddresses(
  addresses: string[],
  allowPrivateNetwork = false,
  explicit = false,
  signal?: AbortSignal
) {
  const results = await fetchJSON<ScanResult[]>('api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses, allowPrivateNetwork, explicit }),
    signal,
  });
  return arrayOrEmpty(results).map((result) => ({
    ...result,
    servicesTruncated: result.servicesTruncated === true,
    detailsTruncated: result.detailsTruncated === true,
    errorTruncated: result.errorTruncated === true,
    httpProtocolTruncated: result.httpProtocolTruncated === true,
    httpStatusTruncated: result.httpStatusTruncated === true,
    httpServerTruncated: result.httpServerTruncated === true,
  }));
}

export async function lookupRoute(
  destination: string,
  family: 'auto' | 'ipv4' | 'ipv6',
  signal?: AbortSignal
) {
  const response = await fetchJSON<RouteLookupResponse>('api/route/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination, family }),
    signal,
  });
  return {
    ...response,
    results: arrayOrEmpty(response.results).map((result) => ({
      ...result,
      notes: arrayOrEmpty(result.notes),
    })),
  };
}

export async function importNmapXML(xml: Blob, signal?: AbortSignal) {
  const response = await fetchJSON<NmapImportResponse>('api/nmap/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
    signal,
  });
  return {
    ...response,
    complete: response.complete === true,
    completion: response.completion || 'missing',
    hosts: arrayOrEmpty(response.hosts).map((host, index) => ({
      ...host,
      id: Number.isInteger(host.id) && host.id > 0 ? host.id : index + 1,
      addresses: arrayOrEmpty(host.addresses),
      hostnames: arrayOrEmpty(host.hostnames),
      ports: arrayOrEmpty(host.ports),
    })),
  };
}

const httpResponseBodyMaxBytes = 4 << 20;
const httpResponseBase64MaxBytes = Math.ceil(httpResponseBodyMaxBytes / 3) * 4;
const httpResponseHeaderMaxCount = 2_048;
const httpResponseHeaderAggregateMaxBytes = 2 << 20;

function malformedHTTPResponse(): never {
  throw new Error(
    'ProtoPeek returned malformed HTTP response evidence or exceeded browser display limits.'
  );
}

function httpResponseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) malformedHTTPResponse();
  return value as Record<string, unknown>;
}

function httpResponseString(value: unknown, maxBytes: number, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) malformedHTTPResponse();
  if (byteLength(value) > maxBytes) malformedHTTPResponse();
  return value;
}

function httpResponseMilliseconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    malformedHTTPResponse();
  }
  return value;
}

function normalizeHTTPHeaders(value: unknown): HTTPResponse['headers'] {
  if (!Array.isArray(value) || value.length > httpResponseHeaderMaxCount) malformedHTTPResponse();
  let aggregateBytes = 0;
  return value.map((entry) => {
    const header = httpResponseRecord(entry);
    const name = httpResponseString(header.name, 256, false);
    const headerValue = httpResponseString(header.value, 64 << 10);
    aggregateBytes += byteLength(name);
    aggregateBytes += byteLength(headerValue);
    if (aggregateBytes > httpResponseHeaderAggregateMaxBytes) malformedHTTPResponse();
    return { name, value: headerValue };
  });
}

/** Fail closed before rendering target-controlled HTTP relay evidence. */
export function normalizeHTTPResponse(value: unknown): HTTPResponse {
  const response = httpResponseRecord(value);
  const statusCode = response.statusCode;
  const bytes = response.bytes;
  if (!Number.isInteger(statusCode) || (statusCode as number) < 0 || (statusCode as number) > 999) {
    malformedHTTPResponse();
  }
  if (
    !Number.isSafeInteger(bytes) ||
    (bytes as number) < 0 ||
    (bytes as number) > httpResponseBodyMaxBytes
  ) {
    malformedHTTPResponse();
  }
  if (typeof response.truncated !== 'boolean') malformedHTTPResponse();
  if (response.bodyEncoding !== 'text' && response.bodyEncoding !== 'base64') {
    malformedHTTPResponse();
  }
  const body = httpResponseString(
    response.body,
    response.bodyEncoding === 'base64' ? httpResponseBase64MaxBytes : httpResponseBodyMaxBytes
  );

  if (!Array.isArray(response.redirects) || response.redirects.length > 10) {
    malformedHTTPResponse();
  }
  const redirects = response.redirects.map((value) => {
    const redirect = httpResponseRecord(value);
    const redirectStatusCode = redirect.statusCode;
    if (
      !Number.isInteger(redirectStatusCode) ||
      (redirectStatusCode as number) < 0 ||
      (redirectStatusCode as number) > 999
    ) {
      malformedHTTPResponse();
    }
    return {
      url: httpResponseString(redirect.url, 8 << 10, false),
      status: httpResponseString(redirect.status, 512, false),
      statusCode: redirectStatusCode as number,
      location: httpResponseString(redirect.location, 8 << 10),
    };
  });

  const timingValue = httpResponseRecord(response.timings);
  const tlsValue = response.tls;
  let tls: HTTPResponse['tls'] = null;
  if (tlsValue !== null) {
    const evidence = httpResponseRecord(tlsValue);
    if (typeof evidence.verified !== 'boolean') malformedHTTPResponse();
    tls = {
      version: httpResponseString(evidence.version, 64, false),
      cipherSuite: httpResponseString(evidence.cipherSuite, 256),
      serverName: httpResponseString(evidence.serverName, 8 << 10),
      peerSubject: httpResponseString(evidence.peerSubject, 16 << 10),
      peerExpiresAt: httpResponseString(evidence.peerExpiresAt, 256),
      verified: evidence.verified,
    };
  }

  return {
    status: httpResponseString(response.status, 512, false),
    statusCode: statusCode as number,
    proto: httpResponseString(response.proto, 64, false),
    headers: normalizeHTTPHeaders(response.headers),
    body,
    bodyEncoding: response.bodyEncoding,
    bytes: bytes as number,
    truncated: response.truncated,
    redirects,
    remoteIp: httpResponseString(response.remoteIp, 512),
    tls,
    timings: {
      dnsMs: httpResponseMilliseconds(timingValue.dnsMs),
      connectMs: httpResponseMilliseconds(timingValue.connectMs),
      tlsMs: httpResponseMilliseconds(timingValue.tlsMs),
      ttfbMs: httpResponseMilliseconds(timingValue.ttfbMs),
      totalMs: httpResponseMilliseconds(timingValue.totalMs),
    },
  };
}

export async function sendHTTPRequest(input: HTTPRequestInput, signal?: AbortSignal) {
  const response = await fetchJSON<unknown>('api/http/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  return normalizeHTTPResponse(response);
}

export async function fetchWorkspaceProtoCatalog(sessionId: string) {
  return normalizeProtoCatalog(
    await fetchJSON<unknown>(`api/workspace/protos?session_id=${encodeURIComponent(sessionId)}`)
  );
}

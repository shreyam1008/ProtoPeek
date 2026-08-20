import {
  type BrowserProtoFolderSelection,
  browserProtoFolderLimits,
  buildBrowserProtoFolderSelection,
} from '@/shared/proto-folder';
import type {
  BootstrapResponse,
  ExampleResponse,
  HTTPRequestInput,
  HTTPResponse,
  InvokeRequest,
  InvokeResponse,
  ProtoCatalogResponse,
  SchemaResponse,
  WorkspaceConnectResponse,
  WorkspaceTargetConfig,
} from '@/shared/types';

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
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
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
  address: string;
  alive: boolean;
  tcp: boolean;
  grpc: boolean;
  http: boolean;
  protocols: Array<'tcp' | 'grpc' | 'http'> | null;
  reflection: 'available' | 'unavailable' | 'not-checked';
  transport: 'plaintext' | 'tls' | 'auto' | 'none' | '';
  services: string[] | null;
  httpTransport: 'plaintext' | 'tls' | '';
  httpProtocol: string;
  httpStatus: string;
  httpStatusCode: number;
  httpServer: string;
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
  details: string[] | null;
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

export function scanAddresses(
  addresses: string[],
  allowPrivateNetwork = false,
  explicit = false,
  signal?: AbortSignal
) {
  return fetchJSON<ScanResult[]>('api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses, allowPrivateNetwork, explicit }),
    signal,
  });
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

export function sendHTTPRequest(input: HTTPRequestInput, signal?: AbortSignal) {
  return fetchJSON<HTTPResponse>('api/http/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}

export async function fetchWorkspaceProtoCatalog(sessionId: string) {
  return normalizeProtoCatalog(
    await fetchJSON<unknown>(`api/workspace/protos?session_id=${encodeURIComponent(sessionId)}`)
  );
}

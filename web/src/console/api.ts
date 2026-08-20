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
    responses: arrayOrEmpty(response.responses).map((entry, index) => ({
      ...entry,
      sequence: entry.sequence ?? index + 1,
      elapsedMs: entry.elapsedMs ?? 0,
    })),
    trailers: arrayOrEmpty(response.trailers),
    requests: response.requests ?? null,
    error: response.error
      ? { ...response.error, details: arrayOrEmpty(response.error.details) }
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

export async function connectWorkspaceTarget(target: WorkspaceTargetConfig, signal?: AbortSignal) {
  const response = await fetchJSON<WorkspaceConnectResponse>('api/workspace/connect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target }),
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
  grpc: boolean;
  reflection: 'available' | 'unavailable' | 'not-checked';
  transport: 'plaintext' | 'tls' | 'auto' | 'none' | '';
  services: string[] | null;
  failure: 'unreachable' | 'non-grpc' | 'blocked' | 'request' | '';
  error: string | null;
  details: string[] | null;
  latencyMs: number;
};

export function scanAddresses(addresses: string[], allowPrivateNetwork = false, explicit = false) {
  return fetchJSON<ScanResult[]>('api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses, allowPrivateNetwork, explicit }),
  });
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

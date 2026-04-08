import type {
  BootstrapResponse,
  ExampleResponse,
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

export function fetchBootstrap() {
  return fetchJSON<BootstrapResponse>('api/bootstrap');
}

export function fetchExamples() {
  return fetchJSON<ExampleResponse[]>('examples');
}

export function fetchSchema(method: string) {
  return fetchJSON<SchemaResponse>(`metadata?method=${encodeURIComponent(method)}`);
}

export function invokeMethod(method: string, payload: InvokeRequest) {
  return fetchJSON<InvokeResponse>(`invoke/${encodeURIComponent(method)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function fetchProtoCatalog() {
  return fetchJSON<ProtoCatalogResponse>('api/protos');
}

export function connectWorkspaceTarget(target: WorkspaceTargetConfig) {
  return fetchJSON<WorkspaceConnectResponse>('api/workspace/connect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target }),
  });
}

export function fetchWorkspaceSchema(sessionId: string, method: string) {
  return fetchJSON<SchemaResponse>(
    `api/workspace/metadata?session_id=${encodeURIComponent(sessionId)}&method=${encodeURIComponent(method)}`
  );
}

export function invokeWorkspaceMethod(sessionId: string, method: string, payload: InvokeRequest) {
  return fetchJSON<InvokeResponse>(
    `api/workspace/invoke/${encodeURIComponent(method)}?session_id=${encodeURIComponent(sessionId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
}

export type ScanResult = {
  address: string;
  alive: boolean;
  grpc: boolean;
  services: string[] | null;
  error: string | null;
  latencyMs: number;
};

export function scanAddresses(addresses: string[]) {
  return fetchJSON<ScanResult[]>('api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses }),
  });
}

export function fetchWorkspaceProtoCatalog(sessionId: string) {
  return fetchJSON<ProtoCatalogResponse>(
    `api/workspace/protos?session_id=${encodeURIComponent(sessionId)}`
  );
}

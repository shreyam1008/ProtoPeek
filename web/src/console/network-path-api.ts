import {
  normalizePathCapabilities,
  normalizePathTrace,
  type PathCapabilities,
  type PathTrace,
} from './network-path';

export type PathTraceRequest = {
  destination: string;
  family: 'auto' | 'ipv4' | 'ipv6';
  method: 'auto' | 'udp' | 'icmp' | 'tcp';
  destinationPort: number;
  maxHops: number;
  probesPerHop: number;
  perProbeTimeoutMs: number;
  wallTimeoutMs: number;
  consent: {
    activeProbe: true;
    publicTarget: boolean;
  };
};

function endpoint(path: string) {
  return new URL(path, window.location.href).toString();
}

function csrfToken() {
  return document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '';
}

async function boundedError(response: Response, limit = 8 * 1024) {
  if (!response.body) {
    const message = (await response.text()).slice(0, limit).trim();
    return message || `${response.status} ${response.statusText}`.trim() || 'Request failed.';
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
  const message = new TextDecoder().decode(joined).trim();
  const fallback = `${response.status} ${response.statusText}`.trim() || 'Request failed.';
  return `${message || fallback}${truncated ? '…' : ''}`;
}

export async function fetchPathCapabilities(signal?: AbortSignal): Promise<PathCapabilities> {
  const response = await fetch(endpoint('api/path/capabilities'), {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw new Error(await boundedError(response));
  return normalizePathCapabilities((await response.json()) as unknown);
}

export async function traceNetworkPath(
  request: PathTraceRequest,
  signal?: AbortSignal
): Promise<PathTrace> {
  const response = await fetch(endpoint('api/path/trace'), {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token': csrfToken(),
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await boundedError(response));
  return normalizePathTrace((await response.json()) as unknown);
}

import { readBoundedText } from '@/shared/bounded-response';

export type PublishRequest = {
  mode: 'serve' | 'quick' | 'funnel';
  origin: string;
  port: number;
  minutes: number;
};
type Origin = { connected: boolean; durationMs: number };
export type PublishPreview = {
  revision: string;
  expiresAt: string;
  request: PublishRequest;
  audience: string;
  executable: string;
  arguments: string[];
  origin: Origin;
  notice: string;
};
export type PublishSession = {
  id: string;
  mode: PublishRequest['mode'];
  audience: string;
  originUrl: string;
  origin: Origin;
  endpoint: string;
  endpointVerified: boolean;
  endpointStatus: number;
  endpointCheckedAt: string | null;
  endpointError: string;
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  reason: string;
  cleanup: 'pending' | 'confirmed' | 'unconfirmed';
  pid: number;
  startedAt: string;
  expiresAt: string;
  events: { observedAt: string; message: string }[];
};

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;
const date = (value: unknown) => text(value, 64) && Number.isFinite(Date.parse(value));
const origin = (value: Origin) =>
  value &&
  typeof value.connected === 'boolean' &&
  Number.isFinite(value.durationMs) &&
  value.durationMs >= 0;
const mode = (value: unknown) => value === 'serve' || value === 'quick' || value === 'funnel';
function endpoint(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
export function parsePublishSession(value: PublishSession): PublishSession {
  if (
    !value ||
    !/^[a-f0-9]{32}$/.test(value.id) ||
    !mode(value.mode) ||
    !text(value.audience, 64) ||
    !text(value.originUrl, 2048) ||
    !origin(value.origin) ||
    !text(value.endpoint, 320) ||
    !endpoint(value.endpoint) ||
    typeof value.endpointVerified !== 'boolean' ||
    !Number.isInteger(value.endpointStatus) ||
    value.endpointStatus < 0 ||
    value.endpointStatus > 599 ||
    (value.endpointCheckedAt !== null && !date(value.endpointCheckedAt)) ||
    !text(value.endpointError, 512) ||
    (value.endpointVerified &&
      (!value.endpoint ||
        value.endpointStatus < 100 ||
        !value.endpointCheckedAt ||
        value.endpointError)) ||
    !['starting', 'running', 'stopping', 'stopped', 'failed'].includes(value.state) ||
    !['pending', 'confirmed', 'unconfirmed'].includes(value.cleanup) ||
    !text(value.reason, 1024) ||
    !Number.isInteger(value.pid) ||
    value.pid < 0 ||
    !date(value.startedAt) ||
    !date(value.expiresAt) ||
    !Array.isArray(value.events) ||
    value.events.length > 64 ||
    value.events.some((event) => !event || !date(event.observedAt) || !text(event.message, 1024))
  )
    throw new Error('Invalid owned-session evidence.');
  return value;
}
export function parsePublishPreview(value: PublishPreview): PublishPreview {
  if (
    !value ||
    !/^[a-f0-9]{32}$/.test(value.revision) ||
    !date(value.expiresAt) ||
    !value.request ||
    !mode(value.request.mode) ||
    !text(value.request.origin, 2048) ||
    !Number.isInteger(value.request.port) ||
    !Number.isInteger(value.request.minutes) ||
    value.request.minutes < 1 ||
    value.request.minutes > 60 ||
    !text(value.audience, 64) ||
    !text(value.executable, 4096) ||
    !origin(value.origin) ||
    !text(value.notice, 2048) ||
    !Array.isArray(value.arguments) ||
    value.arguments.length > 16 ||
    value.arguments.some((arg) => !text(arg, 4096))
  )
    throw new Error('Invalid publishing preview.');
  return value;
}
export async function publishRequest(
  operation: 'preview' | 'start' | 'stop' | 'status' | 'verify',
  input: unknown,
  signal: AbortSignal
) {
  const response = await fetch(new URL(`api/publish/${operation}`, window.location.href), {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token':
        document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '',
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const body = await readBoundedText(response, 64 * 1024);
  if (body.truncated) throw new Error('Publishing response exceeded 64 KiB.');
  if (!response.ok) throw new Error(body.text.slice(0, 2048) || 'Publishing request failed.');
  return JSON.parse(body.text);
}

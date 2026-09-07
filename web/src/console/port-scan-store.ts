import { type PortScanResponse, portPresets } from './port-scan';

const key = 'protopeek.portScanner.v1';
const limit = 128 * 1024;
function ordinaryHost(host: string) {
  return !/[\s/@?#]/.test(host) && (!host.includes(':') || /^[a-f\d:.]+$/i.test(host));
}
export type PortScannerDraft = {
  host: string;
  ports: string;
  family: string;
  timeout: string;
  result: PortScanResponse | null;
  observedAt: string;
};
const defaults = (): PortScannerDraft => ({
  host: '127.0.0.1',
  ports: portPresets.common,
  family: 'auto',
  timeout: '500',
  result: null,
  observedAt: '',
});

export function parsePortScanResponse(value: unknown): PortScanResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid port scan response.');
  const data = value as Record<string, unknown>;
  if (
    typeof data.host !== 'string' ||
    data.host.length > 253 ||
    typeof data.address !== 'string' ||
    data.address.length > 64 ||
    typeof data.complete !== 'boolean' ||
    typeof data.durationMs !== 'number' ||
    !Number.isFinite(data.durationMs) ||
    data.durationMs < 0 ||
    !Array.isArray(data.results) ||
    data.results.length > 1024
  )
    throw new Error('Invalid port scan response.');
  const seen = new Set<number>();
  for (const row of data.results) {
    if (
      !row ||
      !Number.isInteger(row.port) ||
      row.port < 1 ||
      row.port > 65535 ||
      seen.has(row.port) ||
      !['open', 'closed', 'no-response', 'unreachable', 'not-scanned'].includes(row.state) ||
      typeof row.durationMs !== 'number' ||
      !Number.isFinite(row.durationMs) ||
      row.durationMs < 0
    )
      throw new Error('Invalid port scan result.');
    seen.add(row.port);
  }
  return value as PortScanResponse;
}

export function readPortScannerDraft(): PortScannerDraft {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > limit) return defaults();
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      typeof value.host !== 'string' ||
      value.host.length > 253 ||
      !ordinaryHost(value.host) ||
      typeof value.ports !== 'string' ||
      value.ports.length > 8192 ||
      !['auto', 'ipv4', 'ipv6'].includes(value.family) ||
      !['100', '500', '1000', '2000'].includes(value.timeout) ||
      typeof value.observedAt !== 'string' ||
      value.observedAt.length > 32 ||
      (value.observedAt !== '' && !Number.isFinite(Date.parse(value.observedAt)))
    )
      return defaults();
    return {
      host: value.host,
      ports: value.ports,
      family: value.family,
      timeout: value.timeout,
      observedAt: value.observedAt,
      result: value.result ? parsePortScanResponse(value.result) : null,
    };
  } catch {
    return defaults();
  }
}

export function writePortScannerDraft(draft: PortScannerDraft) {
  try {
    // Invalid in-progress authorities may contain credentials; retain only ordinary host text.
    const host = ordinaryHost(draft.host) ? draft.host : '';
    const value = JSON.stringify({ version: 1, ...draft, host });
    if (new TextEncoder().encode(value).byteLength > limit) {
      localStorage.removeItem(key);
      throw new Error('size');
    }
    localStorage.setItem(key, value);
    return '';
  } catch {
    return 'This scan could not be saved in this browser. Results remain available until you leave.';
  }
}

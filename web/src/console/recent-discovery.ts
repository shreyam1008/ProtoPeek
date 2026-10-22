import { normalizeHandoffProvenance } from './app/handoff-store';
import type { RecentDiscovery } from './ProtocolShellContext';

export const recentDiscoveryLimit = 12;

const recentDiscoveryInspectionLimit = 120;
const protocolValues = new Set(['tcp', 'grpc', 'http']);
const reflectionValues = new Set(['available', 'unavailable', 'not-checked']);
const transportValues = new Set(['plaintext', 'tls', 'auto', 'none', '']);
const httpTransportValues = new Set(['plaintext', 'tls', '']);
const failureValues = new Set([
  'unreachable',
  'non-grpc',
  'blocked',
  'request',
  'timeout',
  'cancelled',
  'indeterminate',
  '',
]);

// Empty fields tagged omitempty on standalone.ScanResult are absent from real scan JSON.
const omittedScanValues: Record<string, unknown> = {
  transport: '',
  services: [],
  httpTransport: '',
  httpProtocol: '',
  httpStatus: '',
  httpStatusCode: 0,
  httpServer: '',
  failure: '',
  error: null,
  details: [],
};

const truncationFields = [
  'servicesTruncated',
  'httpProtocolTruncated',
  'httpStatusTruncated',
  'httpServerTruncated',
  'errorTruncated',
  'detailsTruncated',
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, maxLength: number, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  if (!allowEmpty && value.trim() === '') return null;
  return value;
}

function boundedStrings(value: unknown, maxItems: number, maxLength: number) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const result: string[] = [];
  for (const entry of value) {
    const normalized = boundedString(entry, maxLength);
    if (normalized === null) return undefined;
    result.push(normalized);
  }
  return result;
}

function booleanOrFalse(value: unknown) {
  return value === true;
}

function normalizeRecentDiscovery(value: unknown): RecentDiscovery | null {
  const candidate = record(value);
  if (!candidate) return null;
  const input = { ...candidate };
  for (const [key, empty] of Object.entries(omittedScanValues)) {
    if (input[key] === undefined) input[key] = empty;
  }

  const address = boundedString(input.address, 512, false);
  const discoveredAt = boundedString(input.discoveredAt, 64, false);
  if (
    address === null ||
    discoveredAt === null ||
    !Number.isFinite(Date.parse(discoveredAt)) ||
    typeof input.alive !== 'boolean' ||
    typeof input.tcp !== 'boolean' ||
    typeof input.grpc !== 'boolean' ||
    typeof input.http !== 'boolean'
  ) {
    return null;
  }

  const handoffProvenance =
    input.handoffProvenance === undefined
      ? undefined
      : normalizeHandoffProvenance(input.handoffProvenance);
  if (
    handoffProvenance === null ||
    (handoffProvenance && Date.parse(handoffProvenance.observedAt) !== Date.parse(discoveredAt))
  )
    return null;

  const protocols = boundedStrings(input.protocols, 3, 16);
  const services = boundedStrings(input.services, 64, 1024);
  const details = boundedStrings(input.details, 64, 2048);
  if (
    protocols === undefined ||
    services === undefined ||
    details === undefined ||
    protocols?.some((entry) => !protocolValues.has(entry)) === true ||
    typeof input.reflection !== 'string' ||
    !reflectionValues.has(input.reflection) ||
    typeof input.transport !== 'string' ||
    !transportValues.has(input.transport) ||
    typeof input.httpTransport !== 'string' ||
    !httpTransportValues.has(input.httpTransport) ||
    typeof input.failure !== 'string' ||
    !failureValues.has(input.failure) ||
    truncationFields.some((key) => input[key] !== undefined && typeof input[key] !== 'boolean')
  ) {
    return null;
  }

  const httpProtocol = boundedString(input.httpProtocol, 64);
  const httpStatus = boundedString(input.httpStatus, 512);
  const httpServer = boundedString(input.httpServer, 256);
  const error = input.error === null ? null : boundedString(input.error, 2048);
  if (
    httpProtocol === null ||
    httpStatus === null ||
    httpServer === null ||
    (error === null && input.error !== null) ||
    !Number.isInteger(input.httpStatusCode) ||
    (input.httpStatusCode as number) < 0 ||
    (input.httpStatusCode as number) > 999 ||
    typeof input.latencyMs !== 'number' ||
    !Number.isFinite(input.latencyMs) ||
    input.latencyMs < 0 ||
    input.latencyMs > 60_000
  ) {
    return null;
  }

  return {
    address,
    alive: input.alive,
    tcp: input.tcp,
    grpc: input.grpc,
    http: input.http,
    protocols: protocols as RecentDiscovery['protocols'],
    reflection: input.reflection as RecentDiscovery['reflection'],
    transport: input.transport as RecentDiscovery['transport'],
    services,
    servicesTruncated: booleanOrFalse(input.servicesTruncated),
    httpTransport: input.httpTransport as RecentDiscovery['httpTransport'],
    httpProtocol,
    httpProtocolTruncated: booleanOrFalse(input.httpProtocolTruncated),
    httpStatus,
    httpStatusTruncated: booleanOrFalse(input.httpStatusTruncated),
    httpStatusCode: input.httpStatusCode as number,
    httpServer,
    httpServerTruncated: booleanOrFalse(input.httpServerTruncated),
    failure: input.failure as RecentDiscovery['failure'],
    error,
    errorTruncated: booleanOrFalse(input.errorTruncated),
    details,
    detailsTruncated: booleanOrFalse(input.detailsTruncated),
    latencyMs: input.latencyMs,
    discoveredAt,
    ...(handoffProvenance ? { handoffProvenance } : {}),
  };
}

/** Restores only bounded, render-safe recent scan evidence from browser storage. */
export function normalizeRecentDiscoveries(value: unknown): RecentDiscovery[] {
  if (!Array.isArray(value)) return [];
  const discoveries: RecentDiscovery[] = [];
  for (const candidate of value.slice(0, recentDiscoveryInspectionLimit)) {
    const discovery = normalizeRecentDiscovery(candidate);
    if (discovery) discoveries.push(discovery);
    if (discoveries.length === recentDiscoveryLimit) break;
  }
  return discoveries;
}

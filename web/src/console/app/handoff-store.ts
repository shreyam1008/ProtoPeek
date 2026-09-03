import { appStorageKeys } from '../../shared/runtime';
import {
  type GRPCTargetRef,
  type HandoffDraft,
  type HandoffEnvelope,
  type HandoffEnvelopeFor,
  type HandoffEvidenceQuality,
  type HandoffKind,
  type HandoffProvenance,
  type HTTPURLRef,
  handoffDraftKinds,
  handoffEnvelopeVersion,
  type LocalServiceExposure,
  type LocalServiceProtocol,
  type LocalServiceRef,
  type NextHopTargetRef,
  type PendingHandoffInput,
} from './handoff-types';

export const handoffLimits = {
  envelopeBytes: 8 * 1024,
  idLength: 96,
  sourceLength: 64,
  pathLength: 256,
  evidenceIds: 8,
  evidenceIdLength: 96,
  httpURLLength: 2_048,
  grpcTargetLength: 512,
  networkTargetLength: 253,
} as const;

export const defaultHandoffTTLMilliseconds = 5 * 60 * 1_000;
export const maximumHandoffTTLMilliseconds = 15 * 60 * 1_000;
export const handoffClockSkewMilliseconds = 30 * 1_000;

type HandoffTimeOptions = { now?: number };
export type CreateHandoffOptions = HandoffTimeOptions & { ttlMilliseconds?: number };
export type HandoffValidationResult =
  | { ok: true; value: HandoffEnvelope }
  | { ok: false; error: string };
export type HandoffWriteResult =
  | { ok: true; value: HandoffEnvelope; storage: 'session' | 'memory' }
  | { ok: false; error: string };
export type ConsumedHandoffFor<Kind extends HandoffKind> = HandoffEnvelopeFor<Kind> & {
  storage: 'session' | 'memory';
};

const protocols: readonly LocalServiceProtocol[] = ['http', 'https', 'h2c', 'grpc', 'grpcs', 'tcp'];
const exposures: readonly LocalServiceExposure[] = [
  'loopback-only',
  'interface-bound',
  'all-interfaces',
  'unknown',
];
const qualities: readonly HandoffEvidenceQuality[] = ['observed', 'inferred', 'manual'];
const identifierPattern = /^[a-z0-9][a-z0-9._:-]*$/i;

let memoryRaw: string | null = null;
let memoryLoaded = false;
let memoryOnly = false;
let legacyReads = 0;
let expiryTimer: number | null = null;
let expiryTimerID: string | null = null;

function record(value: unknown, fields?: number): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (fields === undefined || Object.keys(value).length === fields)
  );
}

function bounded(value: unknown, maximum: number) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  const hasControl = [...result].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  return result && result.length <= maximum && !hasControl ? result : null;
}

function identifier(value: unknown, maximum: number) {
  const result = bounded(value, maximum);
  return result && identifierPattern.test(result) ? result : null;
}

function host(value: unknown) {
  let result = bounded(value, handoffLimits.networkTargetLength);
  if (!result || /[\s/?#@]/.test(result)) return null;
  if (result.startsWith('[') && result.endsWith(']')) result = result.slice(1, -1);
  result = result.replace(/\.$/, '').toLowerCase();
  if (!result) return null;
  if (result.includes(':')) {
    const [address, zone, trailing] = result.split('%');
    if (trailing !== undefined || (zone !== undefined && !/^[a-z0-9_.-]+$/i.test(zone))) {
      return null;
    }
    try {
      new URL(`http://[${address}]/`);
      return result;
    } catch {
      return null;
    }
  }
  return result
    .split('.')
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i.test(label)
    )
    ? result
    : null;
}

function numericBindAddress(value: string) {
  const octets = value.split('.');
  if (
    octets.length === 4 &&
    octets.every(
      (octet) => /^\d{1,3}$/.test(octet) && String(Number(octet)) === octet && Number(octet) <= 255
    )
  ) {
    return {
      wildcard: octets.every((octet) => octet === '0'),
      loopback: octets[0] === '127',
    };
  }
  const zoneSeparator = value.indexOf('%');
  const address = zoneSeparator === -1 ? value : value.slice(0, zoneSeparator);
  if (!address.includes(':')) return null;
  try {
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mappedPrefix = normalized.match(/^::ffff:([0-9a-f]{1,4}):/i)?.[1];
    return {
      wildcard: zoneSeparator === -1 && normalized === '::',
      loopback:
        normalized === '::1' ||
        (mappedPrefix !== undefined && Number.parseInt(mappedPrefix, 16) >>> 8 === 127),
    };
  } catch {
    return null;
  }
}

function port(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : null;
}

function hostPort(value: unknown) {
  const input = bounded(value, handoffLimits.grpcTargetLength);
  if (!input || /\s/.test(input)) return null;
  const resolver = input.match(/^(dns|passthrough):\/\/\//i)?.[0].toLowerCase() ?? '';
  const endpoint = input.slice(resolver.length);
  const match = endpoint.startsWith('[')
    ? endpoint.match(/^\[([^\]]+)]:(\d{1,5})$/)
    : endpoint.match(/^([^:]+):(\d{1,5})$/);
  if (!match) return null;
  const normalizedHost = host(match[1]);
  const normalizedPort = port(Number(match[2]));
  return normalizedHost && normalizedPort !== null
    ? `${resolver}${formatHostPort(normalizedHost, normalizedPort)}`
    : null;
}

export function formatHostPort(hostname: string, portNumber: number) {
  return `${hostname.includes(':') ? `[${hostname}]` : hostname}:${portNumber}`;
}

function httpRef(value: unknown): HTTPURLRef | null {
  if (!record(value, 2) || value.kind !== 'http-url') return null;
  const raw = bounded(value.url, handoffLimits.httpURLLength);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    const url = parsed.toString();
    return url.length <= handoffLimits.httpURLLength ? { kind: 'http-url', url } : null;
  } catch {
    return null;
  }
}

function grpcRef(value: unknown): GRPCTargetRef | null {
  if (!record(value, 3) || value.kind !== 'grpc-target' || typeof value.plaintext !== 'boolean') {
    return null;
  }
  const address = hostPort(value.address);
  return address ? { kind: 'grpc-target', address, plaintext: value.plaintext } : null;
}

function nextHopRef(value: unknown): NextHopTargetRef | null {
  if (!record(value, 2) || value.kind !== 'next-hop-target') return null;
  const target = host(value.target);
  return target ? { kind: 'next-hop-target', target } : null;
}

function localService(value: unknown): LocalServiceRef | null {
  if (
    !record(value, 8) ||
    value.kind !== 'local-service' ||
    value.perspective !== 'process-network-namespace' ||
    value.network !== 'tcp' ||
    typeof value.protocol !== 'string' ||
    !protocols.includes(value.protocol as LocalServiceProtocol) ||
    typeof value.exposure !== 'string' ||
    !exposures.includes(value.exposure as LocalServiceExposure) ||
    !record(value.bind, 2) ||
    typeof value.bind.wildcard !== 'boolean'
  ) {
    return null;
  }
  const normalizedHost = host(value.host);
  const address = host(value.bind.address);
  const normalizedPort = port(value.port);
  const exposure = value.exposure as LocalServiceExposure;
  const parsedAddress = address ? numericBindAddress(address) : null;
  const inconsistent =
    !parsedAddress ||
    value.bind.wildcard !== parsedAddress.wildcard ||
    (value.bind.wildcard
      ? exposure !== 'all-interfaces'
      : exposure === 'all-interfaces' || (exposure === 'loopback-only') !== parsedAddress.loopback);
  return normalizedHost &&
    !normalizedHost.includes('%') &&
    address &&
    normalizedPort !== null &&
    !inconsistent
    ? {
        kind: 'local-service',
        perspective: 'process-network-namespace',
        network: 'tcp',
        bind: { address, wildcard: value.bind.wildcard },
        exposure,
        protocol: value.protocol as LocalServiceProtocol,
        host: normalizedHost,
        port: normalizedPort,
      }
    : null;
}

function draft(value: unknown): HandoffDraft | null {
  if (!record(value, 2) || typeof value.kind !== 'string') return null;
  if (value.kind === 'publish-origin-draft') {
    const origin = localService(value.origin);
    return origin ? { kind: value.kind, origin } : null;
  }
  if (!handoffDraftKinds.includes(value.kind as HandoffKind)) {
    return null;
  }
  if (value.kind === 'http-url-draft') {
    const target = httpRef(value.target);
    return target ? { kind: value.kind, target } : null;
  }
  if (value.kind === 'grpc-target-draft') {
    const target = grpcRef(value.target);
    return target ? { kind: value.kind, target } : null;
  }
  if (value.kind === 'next-hop-target-draft') {
    const target = nextHopRef(value.target);
    return target ? { kind: value.kind, target } : null;
  }
  return null;
}

type Timestamp = [value: string, milliseconds: number];

export function normalizeHandoffTimestamp(value: string): Timestamp | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? [new Date(milliseconds).toISOString(), milliseconds]
    : null;
}

function timestamp(value: unknown): Timestamp | null {
  const result = bounded(value, 40);
  if (!result) return null;
  const normalized = normalizeHandoffTimestamp(result);
  return normalized && result === normalized[0] ? normalized : null;
}

function provenance(value: unknown): HandoffProvenance | null {
  if (!record(value)) return null;
  const expectedFields =
    3 + Number(value.path !== undefined) + Number(value.evidenceIds !== undefined);
  if (Object.keys(value).length !== expectedFields) return null;
  const source = bounded(value.source, handoffLimits.sourceLength);
  const observedAt = timestamp(value.observedAt);
  if (
    !source ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(source) ||
    typeof value.quality !== 'string' ||
    !qualities.includes(value.quality as HandoffEvidenceQuality) ||
    !observedAt
  ) {
    return null;
  }
  const path = value.path === undefined ? undefined : bounded(value.path, handoffLimits.pathLength);
  if (value.path !== undefined && (!path || !/^\/[a-z0-9/_-]*$/i.test(path))) return null;
  if (value.evidenceIds !== undefined && !Array.isArray(value.evidenceIds)) return null;
  const rawIDs = value.evidenceIds as unknown[] | undefined;
  if (rawIDs && rawIDs.length > handoffLimits.evidenceIds) return null;
  const evidenceIds: string[] = [];
  for (const entry of rawIDs ?? []) {
    const id = identifier(entry, handoffLimits.evidenceIdLength);
    if (!id) return null;
    if (!evidenceIds.includes(id)) evidenceIds.push(id);
  }
  return {
    source: source.toLowerCase(),
    quality: value.quality as HandoffEvidenceQuality,
    observedAt: observedAt[0],
    ...(path ? { path } : {}),
    ...(evidenceIds.length ? { evidenceIds } : {}),
  };
}

function fail(error: string): HandoffValidationResult {
  return { ok: false, error };
}

export function normalizeHandoffEnvelope(
  value: unknown,
  { now = Date.now() }: HandoffTimeOptions = {}
): HandoffValidationResult {
  if (!record(value, 6)) return fail('The handoff envelope has an invalid shape.');
  if (value.version !== handoffEnvelopeVersion) {
    return fail('The handoff envelope version is unsupported.');
  }
  const id = identifier(value.id, handoffLimits.idLength);
  const createdAt = timestamp(value.createdAt);
  const expiresAt = timestamp(value.expiresAt);
  const normalizedProvenance = provenance(value.provenance);
  const normalizedDraft = draft(value.draft);
  if (!id || !createdAt || !expiresAt || !normalizedProvenance || !normalizedDraft) {
    return fail('The handoff envelope contains invalid values.');
  }
  if (!Number.isFinite(now)) return fail('The handoff clock is invalid.');
  if (createdAt[1] > now + handoffClockSkewMilliseconds) {
    return fail('The handoff creation time is too far in the future.');
  }
  if (expiresAt[1] <= createdAt[1]) {
    return fail('The handoff expiry must be after its creation time.');
  }
  if (expiresAt[1] - createdAt[1] > maximumHandoffTTLMilliseconds) {
    return fail('The handoff lifetime is too long.');
  }
  if (expiresAt[1] <= now) return fail('The handoff has expired.');
  const observedAt = Date.parse(normalizedProvenance.observedAt);
  if (observedAt > createdAt[1] + handoffClockSkewMilliseconds) {
    return fail('The handoff evidence time is too far in the future.');
  }
  if (observedAt < createdAt[1] - defaultHandoffTTLMilliseconds) {
    return fail('The handoff evidence is stale. Inspect again before opening a draft.');
  }
  const normalized: HandoffEnvelope = {
    version: handoffEnvelopeVersion,
    id,
    createdAt: createdAt[0],
    expiresAt: expiresAt[0],
    provenance: normalizedProvenance,
    draft: normalizedDraft,
  };
  return new TextEncoder().encode(JSON.stringify(normalized)).byteLength <=
    handoffLimits.envelopeBytes
    ? { ok: true, value: normalized }
    : fail('The handoff envelope is too large.');
}

function generatedID(now: number) {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? `handoff-${globalThis.crypto.randomUUID()}`
    : `handoff-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createHandoffEnvelope(
  value: PendingHandoffInput,
  options: CreateHandoffOptions = {}
): HandoffValidationResult {
  if (!record(value, 2)) return fail('The handoff input has an invalid shape.');
  const now = options.now ?? Date.now();
  const ttl = options.ttlMilliseconds ?? defaultHandoffTTLMilliseconds;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > maximumHandoffTTLMilliseconds) {
    return fail('The handoff lifetime is invalid.');
  }
  const created = new Date(now);
  const expires = new Date(now + ttl);
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(expires.getTime())) {
    return fail('The handoff clock is invalid.');
  }
  return normalizeHandoffEnvelope(
    {
      version: handoffEnvelopeVersion,
      id: generatedID(now),
      createdAt: created.toISOString(),
      expiresAt: expires.toISOString(),
      provenance: value.provenance,
      draft: value.draft,
    },
    { now }
  );
}

function sessionStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function removePersisted() {
  const storage = sessionStorage();
  if (!storage) return false;
  try {
    storage.removeItem(appStorageKeys.pendingHandoff);
    return true;
  } catch {
    return false;
  }
}

function cancelExpiryTimer() {
  if (expiryTimer !== null && typeof window !== 'undefined') window.clearTimeout(expiryTimer);
  expiryTimer = null;
  expiryTimerID = null;
}

function discard() {
  cancelExpiryTimer();
  memoryRaw = null;
  memoryLoaded = true;
  memoryOnly = false;
  removePersisted();
}

function scheduleExpiry(value: HandoffEnvelope, now: number) {
  if (typeof window === 'undefined' || expiryTimerID === value.id) return;
  cancelExpiryTimer();
  const expectedID = value.id;
  expiryTimerID = expectedID;
  expiryTimer = window.setTimeout(
    () => {
      if (expiryTimerID !== expectedID) return;
      expiryTimer = null;
      expiryTimerID = null;
      if (memoryRaw === null) return;
      try {
        const current = JSON.parse(memoryRaw) as { id?: unknown };
        if (current.id !== expectedID) return;
      } catch {
        // Invalid pending data is discarded under the same bounded lifecycle.
      }
      discard();
    },
    Math.max(0, Date.parse(value.expiresAt) - now)
  );
}

function read(options: HandoffTimeOptions): HandoffEnvelope | null {
  if (!memoryLoaded) {
    try {
      memoryRaw = sessionStorage()?.getItem(appStorageKeys.pendingHandoff) ?? null;
    } catch {
      memoryRaw = null;
    }
    memoryLoaded = true;
    memoryOnly = false;
  }
  if (memoryRaw === null) return null;
  if (new TextEncoder().encode(memoryRaw).byteLength > handoffLimits.envelopeBytes) {
    discard();
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(memoryRaw);
  } catch {
    discard();
    return null;
  }
  const normalized = normalizeHandoffEnvelope(parsed, options);
  if (!normalized.ok) {
    discard();
    return null;
  }
  memoryRaw = JSON.stringify(normalized.value);
  scheduleExpiry(normalized.value, options.now ?? Date.now());
  return normalized.value;
}

export function storePendingHandoff(
  value: PendingHandoffInput,
  options: CreateHandoffOptions = {}
): HandoffWriteResult {
  const created = createHandoffEnvelope(value, options);
  if (!created.ok) return created;
  const serialized = JSON.stringify(created.value);
  memoryRaw = serialized;
  memoryLoaded = true;
  scheduleExpiry(created.value, options.now ?? Date.now());
  const storage = sessionStorage();
  if (!storage) {
    memoryOnly = true;
    return { ok: true, value: created.value, storage: 'memory' };
  }
  try {
    storage.setItem(appStorageKeys.pendingHandoff, serialized);
    memoryOnly = false;
    return { ok: true, value: created.value, storage: 'session' };
  } catch {
    try {
      storage.removeItem(appStorageKeys.pendingHandoff);
    } catch {
      // The memory mirror still prevents an older persisted draft from being read this session.
    }
    memoryOnly = true;
    return { ok: true, value: created.value, storage: 'memory' };
  }
}

export function peekPendingHandoff<Kind extends HandoffKind>(
  expected: Kind | readonly Kind[],
  options: HandoffTimeOptions = {}
): HandoffEnvelopeFor<Kind> | null {
  const kinds = Array.isArray(expected) ? expected : [expected];
  if (!kinds.length || !kinds.every((kind) => handoffDraftKinds.includes(kind))) return null;
  const pending = read(options);
  return pending && kinds.includes(pending.draft.kind)
    ? (pending as HandoffEnvelopeFor<Kind>)
    : null;
}

export function consumePendingHandoff<Kind extends HandoffKind>(
  expected: Kind | readonly Kind[],
  options: HandoffTimeOptions = {}
): ConsumedHandoffFor<Kind> | null {
  const pending = peekPendingHandoff(expected, options);
  if (!pending) return null;
  const consumed = { ...pending, storage: memoryOnly ? ('memory' as const) : ('session' as const) };
  cancelExpiryTimer();
  memoryRaw = null;
  memoryLoaded = true;
  memoryOnly = false;
  removePersisted();
  return consumed;
}

export function clearPendingHandoff() {
  cancelExpiryTimer();
  memoryRaw = null;
  memoryLoaded = !removePersisted();
  memoryOnly = false;
}

type LegacyHandoffKind = 'http-url-draft' | 'grpc-target-draft';

export function consumeLegacyHandoff(
  kind: 'http-url-draft'
): HandoffEnvelopeFor<'http-url-draft'> | null;
export function consumeLegacyHandoff(
  kind: 'grpc-target-draft'
): HandoffEnvelopeFor<'grpc-target-draft'> | null;
export function consumeLegacyHandoff(
  kind: LegacyHandoffKind
): HandoffEnvelopeFor<LegacyHandoffKind> | null {
  if (typeof window === 'undefined') return null;
  const isHTTP = kind === 'http-url-draft';
  const readMask = isHTTP ? 1 : 2;
  if (legacyReads & readMask) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(
      isHTTP ? appStorageKeys.pendingHTTPURL : appStorageKeys.pendingGRPCTarget
    );
  } catch {
    return null;
  }
  if (raw === null) return null;
  legacyReads |= readMask;
  try {
    window.localStorage.removeItem(
      isHTTP ? appStorageKeys.pendingHTTPURL : appStorageKeys.pendingGRPCTarget
    );
  } catch {
    // A legacy value is never live authority after it has been read.
  }
  if (
    raw.length > (isHTTP ? handoffLimits.httpURLLength + 64 : handoffLimits.grpcTargetLength + 128)
  ) {
    return null;
  }
  let legacy: unknown;
  try {
    legacy = JSON.parse(raw);
  } catch {
    return null;
  }
  if (isHTTP ? typeof legacy !== 'string' : !record(legacy, 2)) return null;
  const now = Date.now();
  const created = createHandoffEnvelope(
    {
      provenance: {
        source: isHTTP ? 'legacy-http-handoff' : 'legacy-grpc-handoff',
        quality: 'manual',
        observedAt: new Date(now).toISOString(),
      },
      draft: isHTTP
        ? { kind, target: { kind: 'http-url', url: legacy as string } }
        : {
            kind,
            target: {
              kind: 'grpc-target',
              address: (legacy as Record<string, unknown>).address as string,
              plaintext: (legacy as Record<string, unknown>).plaintext as boolean,
            },
          },
    },
    { now }
  );
  return created.ok ? (created.value as HandoffEnvelopeFor<LegacyHandoffKind>) : null;
}

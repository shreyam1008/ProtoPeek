export type ThisPCScope = 'process-network-namespace';
export type ThisPCStatus = 'ok' | 'partial';
export type ThisPCFamily = 'ipv4' | 'ipv6';

export type ThisPCCapability = {
  supported: boolean;
  reason: string;
};

export type ThisPCCapabilities = {
  schemaVersion: 1;
  scope: ThisPCScope;
  scopeNotice: string;
  snapshot: ThisPCCapability;
  activity: ThisPCCapability & { requiresAcknowledgement: true };
  trafficSample: ThisPCCapability & { durationsMs: Array<500 | 1000 | 2000> };
  publicIdentity: ThisPCCapability & {
    requiresAcknowledgement: true;
    provider: 'ipify';
    bgpOriginProvider: 'Team Cymru';
    dnsResolverDisclosure: string;
  };
};

export type ThisPCTrafficCounters = {
  receivedBytes: string;
  receivedPackets: string;
  receivedErrors: string;
  receivedDropped: string;
  transmittedBytes: string;
  transmittedPackets: string;
  transmittedErrors: string;
  transmittedDropped: string;
};

export type ThisPCInterfaceAddress = {
  address: string;
  prefix: number;
  family: ThisPCFamily;
  scope:
    | 'unspecified'
    | 'loopback'
    | 'link-local'
    | 'private'
    | 'multicast'
    | 'global-unicast'
    | 'other';
};

export type ThisPCInterface = {
  index: number;
  name: string;
  mtu: number;
  flags: string[];
  addresses: ThisPCInterfaceAddress[];
  traffic?: ThisPCTrafficCounters;
};

export type ThisPCSnapshot = {
  schemaVersion: 1;
  status: ThisPCStatus;
  scope: ThisPCScope;
  scopeNotice: string;
  observedAt: string;
  hostname?: string;
  os: string;
  arch: string;
  logicalCpus: number;
  interfaces: ThisPCInterface[];
  linuxSystem?: {
    kernelRelease?: string;
    uptimeSeconds?: string;
    totalMemoryBytes?: string;
    availableMemoryBytes?: string;
  };
  notes: string[];
};

export type ThisPCSocketEndpoint = {
  address: string;
  port: number;
  wildcard: boolean;
};

export type ThisPCSocket = {
  protocol: 'tcp4' | 'tcp6' | 'udp4' | 'udp6';
  state: string;
  local: ThisPCSocketEndpoint;
  remote: ThisPCSocketEndpoint;
  exposure: 'loopback-only' | 'interface-bound' | 'all-interfaces' | 'unknown';
  ownerStatus: 'observed' | 'not-found' | 'restricted' | 'unsupported';
  processes: Array<{ pid: number; comm: string }>;
  ownersTruncated: boolean;
};

export type ThisPCActivity = {
  schemaVersion: 1;
  status: ThisPCStatus;
  scope: ThisPCScope;
  scopeNotice: string;
  observedAt: string;
  listeners: ThisPCSocket[];
  connections: ThisPCSocket[];
  truncated: boolean;
  limits: {
    maxSockets: number;
    maxProcesses: number;
    maxFileDescriptors: number;
    wallTimeMs: number;
  };
  notes: string[];
};

export type ThisPCTrafficInterface = {
  name: string;
  status: 'ok' | 'counter-reset' | 'disappeared' | 'appeared';
  counters?: ThisPCTrafficCounters;
};

export type ThisPCTrafficSample = {
  schemaVersion: 1;
  scope: ThisPCScope;
  scopeNotice: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  interfaces: ThisPCTrafficInterface[];
  notes: string[];
};

export type ThisPCBGPOriginNetwork = {
  label: 'BGP origin network';
  evidence: 'provider-reported';
  provider: 'Team Cymru';
  asn: string;
  prefix: string;
  name?: string;
};

export type ThisPCPublicFamilyResult = {
  family: ThisPCFamily;
  status: 'ok' | 'unavailable';
  address?: string;
  error?: string;
  bgpOriginStatus: 'ok' | 'unavailable' | 'not-attempted' | 'ambiguous';
  bgpOriginError?: string;
  bgpOriginNetwork?: ThisPCBGPOriginNetwork;
};

export type ThisPCPublicIdentity = {
  schemaVersion: 1;
  observedAt: string;
  provider: 'ipify';
  externalRequestDisclosure: string;
  dnsResolverDisclosure: string;
  families: ThisPCPublicFamilyResult[];
};

const responseByteLimit = 1024 * 1024;
const activityResponseByteLimit = 4 * 1024 * 1024;
const errorByteLimit = 8 * 1024;
const maximumInterfaces = 512;
const maximumSockets = 4096;
const maximumNotes = 64;
const allowedDurations = new Set([500, 1000, 2000]);
const socketProtocols = new Set(['tcp4', 'tcp6', 'udp4', 'udp6']);
const trafficStatuses = new Set(['ok', 'counter-reset', 'disappeared', 'appeared']);
const socketExposureValues = new Set([
  'loopback-only',
  'interface-bound',
  'all-interfaces',
  'unknown',
]);
const socketOwnerStatuses = new Set(['observed', 'not-found', 'restricted', 'unsupported']);
const addressScopes = new Set([
  'unspecified',
  'loopback',
  'link-local',
  'private',
  'multicast',
  'global-unicast',
  'other',
]);
const uint64Maximum = BigInt('18446744073709551615');

export class ThisPCAPIError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ThisPCAPIError';
    this.status = status;
  }
}

function csrfToken() {
  return document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, field: string) {
  if (!isRecord(value)) throw new ThisPCAPIError(`ProtoPeek returned malformed ${field}.`);
  return value;
}

function boundedString(value: unknown, maximum: number, field: string, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new ThisPCAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  return value;
}

function optionalString(value: unknown, maximum: number, field: string) {
  if (value === undefined) return undefined;
  return boundedString(value, maximum, field);
}

function boundedInteger(value: unknown, maximum: number, field: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ThisPCAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  return value as number;
}

function decimalString(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,19})$/.test(value)) {
    throw new ThisPCAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  if (BigInt(value) > uint64Maximum) {
    throw new ThisPCAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  return value;
}

function exactBoolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') {
    throw new ThisPCAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  return value;
}

function exactValue<T>(value: unknown, expected: T, field: string): T {
  if (value !== expected) throw new ThisPCAPIError(`ProtoPeek returned unexpected ${field}.`);
  return expected;
}

function enumValue<T extends string>(value: unknown, allowed: Set<string>, field: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new ThisPCAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  return value as T;
}

function timestamp(value: unknown, field: string) {
  const input = boundedString(value, 64, field);
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new ThisPCAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  return parsed.toISOString();
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number, field: string) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new ThisPCAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  return value.map((item) => boundedString(item, maximumLength, field, true));
}

function notes(value: unknown) {
  return stringArray(value, maximumNotes, 2048, 'This PC note');
}

function scope(value: unknown): ThisPCScope {
  return exactValue(value, 'process-network-namespace', 'This PC scope');
}

function schemaVersion(value: unknown): 1 {
  if (value !== 1) {
    throw new ThisPCAPIError('ProtoPeek returned an unsupported This PC schema version.');
  }
  return 1;
}

function status(value: unknown): ThisPCStatus {
  return enumValue(value, new Set(['ok', 'partial']), 'This PC status');
}

function capability(value: unknown, field: string): ThisPCCapability {
  const input = record(value, `${field} capability`);
  const supported = exactBoolean(input.supported, `${field} support state`);
  const reason = optionalString(input.reason, 2048, `${field} support reason`) ?? '';
  if (!supported && !reason) {
    throw new ThisPCAPIError(`ProtoPeek returned ${field} as unsupported without a reason.`);
  }
  return { supported, reason };
}

export function normalizeThisPCCapabilities(input: unknown): ThisPCCapabilities {
  const value = record(input, 'This PC capabilities');
  const snapshot = capability(value.snapshot, 'snapshot');
  const activityInput = record(value.activity, 'activity capability');
  const activity = capability(activityInput, 'activity');
  exactValue(activityInput.requiresAcknowledgement, true, 'activity acknowledgement requirement');
  const trafficInput = record(value.trafficSample, 'traffic-sample capability');
  const trafficSample = capability(trafficInput, 'traffic sample');
  if (!Array.isArray(trafficInput.durationsMs) || trafficInput.durationsMs.length > 3) {
    throw new ThisPCAPIError('ProtoPeek returned malformed traffic sample durations.');
  }
  const durationsMs = trafficInput.durationsMs.map((duration) => {
    if (!allowedDurations.has(duration as number)) {
      throw new ThisPCAPIError('ProtoPeek returned an unsupported traffic sample duration.');
    }
    return duration as 500 | 1000 | 2000;
  });
  if (
    new Set(durationsMs).size !== durationsMs.length ||
    (trafficSample.supported && !durationsMs.length)
  ) {
    throw new ThisPCAPIError('ProtoPeek returned inconsistent traffic sample durations.');
  }

  const publicInput = record(value.publicIdentity, 'public-identity capability');
  const publicIdentity = capability(publicInput, 'public identity');
  exactValue(
    publicInput.requiresAcknowledgement,
    true,
    'public-identity acknowledgement requirement'
  );

  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    scope: scope(value.scope),
    scopeNotice: boundedString(value.scopeNotice, 2048, 'This PC scope notice'),
    snapshot,
    activity: { ...activity, requiresAcknowledgement: true },
    trafficSample: { ...trafficSample, durationsMs },
    publicIdentity: {
      ...publicIdentity,
      requiresAcknowledgement: true,
      provider: exactValue(publicInput.provider, 'ipify', 'public identity provider'),
      bgpOriginProvider: exactValue(
        publicInput.bgpOriginProvider,
        'Team Cymru',
        'BGP origin provider'
      ),
      dnsResolverDisclosure: boundedString(
        publicInput.dnsResolverDisclosure,
        2048,
        'DNS resolver disclosure'
      ),
    },
  };
}

function counters(input: unknown, field: string): ThisPCTrafficCounters {
  const value = record(input, field);
  return {
    receivedBytes: decimalString(value.receivedBytes, 'received bytes'),
    receivedPackets: decimalString(value.receivedPackets, 'received packets'),
    receivedErrors: decimalString(value.receivedErrors, 'received errors'),
    receivedDropped: decimalString(value.receivedDropped, 'received drops'),
    transmittedBytes: decimalString(value.transmittedBytes, 'transmitted bytes'),
    transmittedPackets: decimalString(value.transmittedPackets, 'transmitted packets'),
    transmittedErrors: decimalString(value.transmittedErrors, 'transmitted errors'),
    transmittedDropped: decimalString(value.transmittedDropped, 'transmitted drops'),
  };
}

function normalizeIPv4(value: unknown) {
  const address = boundedString(value, 64, 'IPv4 address');
  const parts = address.split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number.parseInt(part, 10) > 255)
  ) {
    throw new ThisPCAPIError('ProtoPeek returned malformed IPv4 evidence.');
  }
  return parts.map((part) => String(Number.parseInt(part, 10))).join('.');
}

function normalizeIPv6(value: unknown) {
  const address = boundedString(value, 128, 'IPv6 address').toLowerCase();
  if (address.includes('%') || !address.includes(':') || !/^[0-9a-f:.]+$/.test(address)) {
    throw new ThisPCAPIError('ProtoPeek returned malformed IPv6 evidence.');
  }
  try {
    const parsed = new URL(`http://[${address}]/`).hostname;
    return parsed.replace(/^\[|\]$/g, '');
  } catch {
    throw new ThisPCAPIError('ProtoPeek returned malformed IPv6 evidence.');
  }
}

function interfaceAddress(input: unknown): ThisPCInterfaceAddress {
  const value = record(input, 'interface address');
  const family = enumValue<ThisPCFamily>(
    value.family,
    new Set(['ipv4', 'ipv6']),
    'interface address family'
  );
  return {
    family,
    address: family === 'ipv4' ? normalizeIPv4(value.address) : normalizeIPv6(value.address),
    prefix: boundedInteger(value.prefix, family === 'ipv4' ? 32 : 128, 'address prefix'),
    scope: enumValue(value.scope, addressScopes, 'interface address scope'),
  };
}

function networkInterface(input: unknown): ThisPCInterface {
  const value = record(input, 'network interface');
  if (!Array.isArray(value.addresses) || value.addresses.length > 64) {
    throw new ThisPCAPIError('ProtoPeek returned malformed interface addresses.');
  }
  const mtu = value.mtu === -1 ? -1 : boundedInteger(value.mtu, 1_000_000_000, 'interface MTU');
  return {
    index: boundedInteger(value.index, 1_000_000, 'interface index'),
    name: boundedString(value.name, 256, 'interface name'),
    mtu,
    flags: stringArray(value.flags, 64, 64, 'interface flag'),
    addresses: value.addresses.map(interfaceAddress),
    ...(value.traffic === undefined
      ? {}
      : { traffic: counters(value.traffic, 'interface counters') }),
  };
}

export function normalizeThisPCSnapshot(input: unknown): ThisPCSnapshot {
  const value = record(input, 'This PC snapshot');
  if (!Array.isArray(value.interfaces) || value.interfaces.length > maximumInterfaces) {
    throw new ThisPCAPIError('ProtoPeek returned malformed network interfaces.');
  }
  const interfaces = value.interfaces.map(networkInterface);
  if (new Set(interfaces.map((item) => item.index)).size !== interfaces.length) {
    throw new ThisPCAPIError('ProtoPeek returned duplicate network interface indexes.');
  }
  let linuxSystem: ThisPCSnapshot['linuxSystem'];
  if (value.linuxSystem !== undefined) {
    const linux = record(value.linuxSystem, 'Linux system evidence');
    linuxSystem = {
      kernelRelease: optionalString(linux.kernelRelease, 256, 'Linux kernel release'),
      uptimeSeconds:
        linux.uptimeSeconds === undefined
          ? undefined
          : decimalString(linux.uptimeSeconds, 'Linux uptime'),
      totalMemoryBytes:
        linux.totalMemoryBytes === undefined
          ? undefined
          : decimalString(linux.totalMemoryBytes, 'total memory'),
      availableMemoryBytes:
        linux.availableMemoryBytes === undefined
          ? undefined
          : decimalString(linux.availableMemoryBytes, 'available memory'),
    };
  }
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    status: status(value.status),
    scope: scope(value.scope),
    scopeNotice: boundedString(value.scopeNotice, 2048, 'This PC scope notice'),
    observedAt: timestamp(value.observedAt, 'snapshot observation time'),
    hostname: optionalString(value.hostname, 255, 'host name'),
    os: boundedString(value.os, 256, 'operating system'),
    arch: boundedString(value.arch, 64, 'architecture'),
    logicalCpus: boundedInteger(value.logicalCpus, 4096, 'logical CPU count', 1),
    interfaces,
    ...(linuxSystem ? { linuxSystem } : {}),
    notes: notes(value.notes),
  };
}

function socketEndpoint(input: unknown, field: string): ThisPCSocketEndpoint {
  const value = record(input, field);
  return {
    address: boundedString(value.address, 256, `${field} address`, true),
    port: boundedInteger(value.port, 65_535, `${field} port`),
    wildcard: exactBoolean(value.wildcard, `${field} wildcard state`),
  };
}

function socket(input: unknown): ThisPCSocket {
  const value = record(input, 'socket evidence');
  if (!Array.isArray(value.processes) || value.processes.length > 8) {
    throw new ThisPCAPIError('ProtoPeek returned malformed socket owner evidence.');
  }
  const processes = value.processes.map((item) => {
    const processInput = record(item, 'socket owner evidence');
    return {
      pid: boundedInteger(processInput.pid, 4_294_967_295, 'process id', 1),
      comm: boundedString(processInput.comm, 512, 'process command'),
    };
  });
  const ownerStatus = enumValue<ThisPCSocket['ownerStatus']>(
    value.ownerStatus,
    socketOwnerStatuses,
    'socket owner status'
  );
  if ((ownerStatus === 'observed') !== processes.length > 0) {
    throw new ThisPCAPIError('ProtoPeek returned inconsistent socket owner evidence.');
  }
  return {
    protocol: enumValue(value.protocol, socketProtocols, 'socket protocol'),
    state: boundedString(value.state, 64, 'socket state', true),
    local: socketEndpoint(value.local, 'local endpoint'),
    remote: socketEndpoint(value.remote, 'remote endpoint'),
    exposure: enumValue(value.exposure, socketExposureValues, 'socket exposure'),
    ownerStatus,
    processes,
    ownersTruncated:
      value.ownersTruncated === undefined
        ? false
        : exactBoolean(value.ownersTruncated, 'socket owner truncation state'),
  };
}

export function normalizeThisPCActivity(input: unknown): ThisPCActivity {
  const value = record(input, 'This PC activity');
  if (
    !Array.isArray(value.listeners) ||
    value.listeners.length > maximumSockets ||
    !Array.isArray(value.connections) ||
    value.connections.length > maximumSockets
  ) {
    throw new ThisPCAPIError('ProtoPeek returned malformed socket evidence.');
  }
  const limitsInput = record(value.limits, 'activity limits');
  const limits = {
    maxSockets: boundedInteger(limitsInput.maxSockets, maximumSockets, 'socket limit', 1),
    maxProcesses: boundedInteger(limitsInput.maxProcesses, 4096, 'process limit', 1),
    maxFileDescriptors: boundedInteger(
      limitsInput.maxFileDescriptors,
      1_000_000,
      'file descriptor limit',
      1
    ),
    wallTimeMs: boundedInteger(limitsInput.wallTimeMs, 30_000, 'activity wall time', 1),
  };
  if (
    value.listeners.length + value.connections.length > maximumSockets ||
    value.listeners.length + value.connections.length > limits.maxSockets
  ) {
    throw new ThisPCAPIError('ProtoPeek returned socket evidence beyond its advertised limit.');
  }
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    status: status(value.status),
    scope: scope(value.scope),
    scopeNotice: boundedString(value.scopeNotice, 2048, 'This PC scope notice'),
    observedAt: timestamp(value.observedAt, 'activity observation time'),
    listeners: value.listeners.map(socket),
    connections: value.connections.map(socket),
    truncated: exactBoolean(value.truncated, 'socket truncation state'),
    limits,
    notes: notes(value.notes),
  };
}

export function normalizeThisPCTrafficSample(input: unknown): ThisPCTrafficSample {
  const value = record(input, 'This PC traffic sample');
  const durationMs = boundedInteger(value.durationMs, 60_000, 'traffic sample duration', 1);
  if (!Array.isArray(value.interfaces) || value.interfaces.length > maximumInterfaces) {
    throw new ThisPCAPIError('ProtoPeek returned malformed traffic sample interfaces.');
  }
  const interfaces = value.interfaces.map((item): ThisPCTrafficInterface => {
    const entry = record(item, 'traffic sample interface');
    const sampleStatus = enumValue<ThisPCTrafficInterface['status']>(
      entry.status,
      trafficStatuses,
      'traffic sample status'
    );
    const counterKeys = [
      'receivedBytes',
      'receivedPackets',
      'receivedErrors',
      'receivedDropped',
      'transmittedBytes',
      'transmittedPackets',
      'transmittedErrors',
      'transmittedDropped',
    ];
    const hasCounter = counterKeys.some((key) => entry[key] !== undefined);
    if ((sampleStatus === 'ok') !== hasCounter) {
      throw new ThisPCAPIError('ProtoPeek returned inconsistent traffic counter evidence.');
    }
    return {
      name: boundedString(entry.name, 256, 'traffic sample interface name'),
      status: sampleStatus,
      ...(sampleStatus === 'ok' ? { counters: counters(entry, 'traffic sample counters') } : {}),
    };
  });
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    scope: scope(value.scope),
    scopeNotice: boundedString(value.scopeNotice, 2048, 'This PC scope notice'),
    startedAt: timestamp(value.startedAt, 'traffic sample start time'),
    finishedAt: timestamp(value.finishedAt, 'traffic sample finish time'),
    durationMs,
    interfaces,
    notes: notes(value.notes),
  };
}

function bgpOriginNetwork(input: unknown): ThisPCBGPOriginNetwork {
  const value = record(input, 'BGP origin network');
  return {
    label: exactValue(value.label, 'BGP origin network', 'BGP origin label'),
    evidence: exactValue(value.evidence, 'provider-reported', 'BGP evidence kind'),
    provider: exactValue(value.provider, 'Team Cymru', 'BGP origin provider'),
    asn: boundedString(value.asn, 32, 'BGP origin ASN'),
    prefix: boundedString(value.prefix, 128, 'BGP origin prefix'),
    name: optionalString(value.name, 512, 'BGP origin name'),
  };
}

function publicFamily(input: unknown): ThisPCPublicFamilyResult {
  const value = record(input, 'public address-family evidence');
  const family = enumValue<ThisPCFamily>(
    value.family,
    new Set(['ipv4', 'ipv6']),
    'public address family'
  );
  const familyStatus = enumValue<'ok' | 'unavailable'>(
    value.status,
    new Set(['ok', 'unavailable']),
    'public address-family status'
  );
  const originStatus = enumValue<'ok' | 'unavailable' | 'not-attempted' | 'ambiguous'>(
    value.bgpOriginStatus,
    new Set(['ok', 'unavailable', 'not-attempted', 'ambiguous']),
    'BGP origin status'
  );
  if (familyStatus === 'ok' && value.address === undefined) {
    throw new ThisPCAPIError('ProtoPeek returned public address success without an address.');
  }
  if (familyStatus === 'unavailable' && value.address !== undefined) {
    throw new ThisPCAPIError('ProtoPeek returned an address for an unavailable address family.');
  }
  if ((originStatus === 'ok') !== (value.bgpOriginNetwork !== undefined)) {
    throw new ThisPCAPIError('ProtoPeek returned inconsistent BGP origin evidence.');
  }
  return {
    family,
    status: familyStatus,
    ...(familyStatus === 'ok'
      ? { address: family === 'ipv4' ? normalizeIPv4(value.address) : normalizeIPv6(value.address) }
      : { error: optionalString(value.error, 2048, 'public address-family error') }),
    bgpOriginStatus: originStatus,
    bgpOriginError: optionalString(value.bgpOriginError, 2048, 'BGP origin error'),
    ...(originStatus === 'ok'
      ? { bgpOriginNetwork: bgpOriginNetwork(value.bgpOriginNetwork) }
      : {}),
  };
}

export function normalizeThisPCPublicIdentity(input: unknown): ThisPCPublicIdentity {
  const value = record(input, 'public identity evidence');
  if (!Array.isArray(value.families) || value.families.length < 1 || value.families.length > 2) {
    throw new ThisPCAPIError('ProtoPeek returned malformed public address-family evidence.');
  }
  const families = value.families.map(publicFamily);
  if (new Set(families.map((family) => family.family)).size !== families.length) {
    throw new ThisPCAPIError('ProtoPeek returned duplicate public address-family evidence.');
  }
  return {
    schemaVersion: schemaVersion(value.schemaVersion),
    observedAt: timestamp(value.observedAt, 'public identity observation time'),
    provider: exactValue(value.provider, 'ipify', 'public identity provider'),
    externalRequestDisclosure: boundedString(
      value.externalRequestDisclosure,
      2048,
      'external request disclosure'
    ),
    dnsResolverDisclosure: boundedString(
      value.dnsResolverDisclosure,
      2048,
      'DNS resolver disclosure'
    ),
    families,
  };
}

async function boundedText(response: Response, limit: number) {
  if (!response.body) {
    const text = await response.text();
    const encoded = new TextEncoder().encode(text);
    return {
      text: new TextDecoder().decode(encoded.subarray(0, limit)),
      truncated: encoded.length > limit,
    };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  try {
    while (length <= limit) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = limit + 1 - length;
      const accepted = value.subarray(0, Math.max(remaining, 0));
      if (accepted.length) chunks.push(accepted);
      length += accepted.length;
      if (length > limit) {
        truncated = true;
        break;
      }
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const joined = new Uint8Array(Math.min(length, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = joined.length - offset;
    if (remaining <= 0) break;
    const accepted = chunk.subarray(0, remaining);
    joined.set(accepted, offset);
    offset += accepted.length;
  }
  return { text: new TextDecoder().decode(joined), truncated };
}

async function requestJSON(path: string, init: RequestInit, maximumBytes = responseByteLimit) {
  const response = await fetch(new URL(path, window.location.href), {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.method && init.method !== 'GET'
        ? {
            'content-type': 'application/json',
            'x-protopeek-csrf-token': csrfToken(),
          }
        : {}),
      ...(init.headers ?? {}),
    },
  });
  const result = await boundedText(response, response.ok ? maximumBytes : errorByteLimit);
  const text = result.text;
  const truncated = result.truncated;
  if (!response.ok) {
    if (truncated) {
      throw new ThisPCAPIError('ProtoPeek returned an oversized This PC error.', response.status);
    }
    if (response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      try {
        const envelope = record(JSON.parse(text), 'This PC error envelope');
        const keys = Object.keys(envelope).sort();
        if (keys.length !== 2 || keys[0] !== 'error' || keys[1] !== 'schemaVersion') {
          throw new ThisPCAPIError('ProtoPeek returned malformed This PC error.', response.status);
        }
        schemaVersion(envelope.schemaVersion);
        throw new ThisPCAPIError(
          boundedString(envelope.error, 2048, 'This PC error'),
          response.status
        );
      } catch (error) {
        if (error instanceof ThisPCAPIError && error.status === response.status) throw error;
        throw new ThisPCAPIError('ProtoPeek returned malformed This PC error.', response.status);
      }
    }
    const fallback =
      `${response.status} ${response.statusText}`.trim() || 'This PC request failed.';
    throw new ThisPCAPIError(text.trim() || fallback, response.status);
  }
  if (truncated) {
    throw new ThisPCAPIError('ProtoPeek returned an oversized This PC response.', response.status);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ThisPCAPIError('ProtoPeek returned malformed This PC JSON.', response.status);
  }
}

export async function fetchThisPCCapabilities(signal?: AbortSignal) {
  return normalizeThisPCCapabilities(
    await requestJSON('/api/this-pc/capabilities', { method: 'GET', signal })
  );
}

export async function fetchThisPCSnapshot(signal?: AbortSignal) {
  return normalizeThisPCSnapshot(
    await requestJSON('/api/this-pc/snapshot', { method: 'GET', signal })
  );
}

export async function inspectThisPCActivity(signal?: AbortSignal) {
  return normalizeThisPCActivity(
    await requestJSON(
      '/api/this-pc/activity',
      {
        method: 'POST',
        body: JSON.stringify({ acknowledgeLocalInspection: true }),
        signal,
      },
      activityResponseByteLimit
    )
  );
}

export async function sampleThisPCTraffic(durationMs: 500 | 1000 | 2000, signal?: AbortSignal) {
  if (!allowedDurations.has(durationMs)) throw new Error('Unsupported traffic sample duration.');
  return normalizeThisPCTrafficSample(
    await requestJSON('/api/this-pc/traffic/sample', {
      method: 'POST',
      body: JSON.stringify({ durationMs }),
      signal,
    })
  );
}

export async function fetchThisPCPublicIdentity(families: ThisPCFamily[], signal?: AbortSignal) {
  if (
    !families.length ||
    families.length > 2 ||
    new Set(families).size !== families.length ||
    families.some((family) => family !== 'ipv4' && family !== 'ipv6')
  ) {
    throw new Error('Select one or two unique public address families.');
  }
  return normalizeThisPCPublicIdentity(
    await requestJSON('/api/this-pc/public', {
      method: 'POST',
      body: JSON.stringify({ acknowledgeExternalRequest: true, families }),
      signal,
    })
  );
}

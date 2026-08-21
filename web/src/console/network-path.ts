export type PathSample = {
  sequence: number;
  status: 'reply' | 'timeout' | 'unreachable' | 'error';
  responder: string;
  rttMs: number | null;
  icmpType: number | null;
  icmpCode: number | null;
  detail: string;
};

export type PathHop = {
  ttl: number;
  responders: string[];
  samples: PathSample[];
};

export type PathRouteEvidence = {
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

export type PathTrace = {
  perspective: 'protopeek-process';
  observedAt: string;
  status: 'complete' | 'partial' | 'cancelled';
  termination: string;
  reached: boolean;
  resolution: {
    input: string;
    source: string;
    network: string;
    durationMs: number;
    answers: Array<{ address: string; family: 'ipv4' | 'ipv6' }>;
    pinnedAddress: string;
    pinnedFamily: 'ipv4' | 'ipv6';
  };
  route: PathRouteEvidence;
  backend: string;
  method: 'udp' | 'icmp' | 'tcp';
  parameters: {
    family: 'ipv4' | 'ipv6';
    method: 'udp' | 'icmp' | 'tcp';
    destinationPort: number;
    maxHops: number;
    probesPerHop: number;
    perProbeTimeoutMs: number;
    wallTimeoutMs: number;
  };
  hops: PathHop[];
  warnings: string[];
  durationMs: number;
};

export type PathCapability = {
  backend: string;
  method: 'udp' | 'icmp' | 'tcp';
  families: Array<'ipv4' | 'ipv6'>;
  available: boolean;
  privilege: string;
  install: string;
  reason: string;
  limitations: string[];
};

export type PathCapabilities = {
  perspective: 'protopeek-process';
  os: string;
  capabilities: PathCapability[];
  limits: {
    maxDestinationBytes: number;
    maxResolvedAddresses: number;
    defaultMaxHops: number;
    maxHops: number;
    defaultProbesPerHop: number;
    maxProbesPerHop: number;
    maxTotalProbes: number;
    defaultProbeTimeoutMs: number;
    minProbeTimeoutMs: number;
    maxProbeTimeoutMs: number;
    defaultWallTimeoutMs: number;
    maxWallTimeoutMs: number;
    maxProbesPerSecond: number;
    defaultUdpPort: number;
  };
  warnings: string[];
};

export type PathHopRow = PathHop & {
  state: 'responded' | 'silent' | 'mixed';
  rtt: { min: number; median: number; max: number } | null;
  responderRTTs: Array<{
    responder: string;
    rtt: { min: number; median: number; max: number };
  }>;
};

const maxStringBytes = 4 * 1024;
const maxHops = 32;
const maxSamplesPerHop = 4;
const maxRespondersPerHop = 4;
const maxWarnings = 32;
const maxPathWallTimeoutMs = 30_000;
// The Go engine bounds system resolution to two seconds. Returned total duration
// may cross the selected trace wall while that deadline is observed and local
// route/response work unwinds, so validation admits exactly one resolver-sized
// allowance beyond the echoed wall instead of accepting an arbitrary duration.
const pathResolutionReturnAllowanceMs = 2_000;
const utf8 = new TextEncoder();

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maxBytes = maxStringBytes) {
  if (
    typeof value !== 'string' ||
    utf8.encode(value).byteLength > maxBytes ||
    value.includes('\0')
  ) {
    throw new Error(`${label} must be a bounded string.`);
  }
  return value;
}

function nonEmptyString(value: unknown, label: string, maxBytes = maxStringBytes) {
  const result = string(value, label, maxBytes);
  if (!result.trim()) throw new Error(`${label} must not be empty.`);
  return result;
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function number(value: unknown, label: string, minimum = 0, maximum = 120_000) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} through ${maximum}.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  const result = number(value, label, minimum, maximum);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer.`);
  return result;
}

function nullableInteger(value: unknown, label: string, minimum: number, maximum: number) {
  return value === null || value === undefined ? null : integer(value, label, minimum, maximum);
}

function array(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array with at most ${maximum} items.`);
  }
  return value;
}

function stringArray(value: unknown, label: string, maximum: number) {
  return array(value, label, maximum).map((entry, index) =>
    string(entry, `${label}[${index}]`, 2 * 1024)
  );
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new Error(`${label} has an unsupported value.`);
  }
  return value as T;
}

function timestamp(value: unknown, label: string) {
  const result = nonEmptyString(value, label, 128);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a timestamp.`);
  return parsed.toISOString();
}

function normalizeRoute(value: unknown): PathRouteEvidence {
  const route = object(value, 'route');
  return {
    destination: nonEmptyString(route.destination, 'route.destination', 256),
    family: enumValue(route.family, ['ipv4', 'ipv6'], 'route.family'),
    status: enumValue(route.status, ['ok', 'error', 'unsupported'], 'route.status'),
    sourceIp: string(route.sourceIp ?? '', 'route.sourceIp', 256),
    interfaceIndex: integer(route.interfaceIndex ?? 0, 'route.interfaceIndex', 0, 1_000_000),
    interfaceName: string(route.interfaceName ?? '', 'route.interfaceName', 256),
    nextHop: string(route.nextHop ?? '', 'route.nextHop', 256),
    onLink: boolean(route.onLink ?? false, 'route.onLink'),
    local: boolean(route.local ?? false, 'route.local'),
    prefix: nullableInteger(route.prefix, 'route.prefix', 0, 128),
    routeMetric: nullableInteger(route.routeMetric, 'route.routeMetric', 0, 2 ** 31 - 1),
    table: nullableInteger(route.table, 'route.table', 0, 2 ** 31 - 1),
    backend: nonEmptyString(route.backend, 'route.backend', 256),
    notes: stringArray(route.notes ?? [], 'route.notes', 32),
    error: string(route.error ?? '', 'route.error'),
  };
}

function normalizeSample(value: unknown, label: string): PathSample {
  const sample = object(value, label);
  const status = enumValue(
    sample.status,
    ['reply', 'timeout', 'unreachable', 'error'],
    `${label}.status`
  );
  const rttMs =
    sample.rttMs === null || sample.rttMs === undefined
      ? null
      : number(sample.rttMs, `${label}.rttMs`);
  if (status === 'reply' && rttMs === null) {
    throw new Error(`${label}.rttMs is required for a reply.`);
  }
  if (status === 'timeout' && rttMs !== null) {
    throw new Error(`${label}.rttMs must be null for a timeout.`);
  }
  return {
    sequence: integer(sample.sequence, `${label}.sequence`, 1, maxSamplesPerHop),
    status,
    responder: string(sample.responder ?? '', `${label}.responder`, 256),
    rttMs,
    icmpType: nullableInteger(sample.icmpType, `${label}.icmpType`, 0, 255),
    icmpCode: nullableInteger(sample.icmpCode, `${label}.icmpCode`, 0, 255),
    detail: string(sample.detail ?? '', `${label}.detail`, 2 * 1024),
  };
}

function normalizeHop(value: unknown, index: number): PathHop {
  const label = `hops[${index}]`;
  const hop = object(value, label);
  const samples = array(hop.samples, `${label}.samples`, maxSamplesPerHop).map(
    (sample, sampleIndex) => normalizeSample(sample, `${label}.samples[${sampleIndex}]`)
  );
  if (new Set(samples.map((sample) => sample.sequence)).size !== samples.length) {
    throw new Error(`${label}.samples contains duplicate sequences.`);
  }
  const responders = stringArray(hop.responders, `${label}.responders`, maxRespondersPerHop);
  if (new Set(responders).size !== responders.length) {
    throw new Error(`${label}.responders contains duplicates.`);
  }
  for (const sample of samples) {
    if (sample.responder && !responders.includes(sample.responder)) {
      throw new Error(`${label} omits a sample responder.`);
    }
  }
  return {
    ttl: integer(hop.ttl, `${label}.ttl`, 1, maxHops),
    responders,
    samples,
  };
}

export function normalizePathTrace(value: unknown): PathTrace {
  const trace = object(value, 'path trace');
  if (trace.perspective !== 'protopeek-process') {
    throw new Error('path trace perspective must be protopeek-process.');
  }
  const resolution = object(trace.resolution, 'resolution');
  const answers = array(resolution.answers, 'resolution.answers', 8).map((answer, index) => {
    const input = object(answer, `resolution.answers[${index}]`);
    return {
      address: nonEmptyString(input.address, `resolution.answers[${index}].address`, 256),
      family: enumValue(input.family, ['ipv4', 'ipv6'], `resolution.answers[${index}].family`),
    };
  });
  const parameters = object(trace.parameters, 'parameters');
  const hops = array(trace.hops, 'hops', maxHops).map(normalizeHop);
  if (new Set(hops.map((hop) => hop.ttl)).size !== hops.length) {
    throw new Error('hops contains duplicate TTL values.');
  }
  for (let index = 1; index < hops.length; index++) {
    if ((hops[index - 1]?.ttl ?? 0) >= (hops[index]?.ttl ?? 0)) {
      throw new Error('hops must be ordered by increasing TTL.');
    }
  }
  const method = enumValue(trace.method, ['udp', 'icmp', 'tcp'], 'method');
  const parameterMethod = enumValue(parameters.method, ['udp', 'icmp', 'tcp'], 'parameters.method');
  if (method !== parameterMethod) throw new Error('method does not match parameters.method.');
  const normalizedParameters = {
    family: enumValue(parameters.family, ['ipv4', 'ipv6'], 'parameters.family'),
    method: parameterMethod,
    destinationPort: integer(parameters.destinationPort, 'parameters.destinationPort', 1, 65535),
    maxHops: integer(parameters.maxHops, 'parameters.maxHops', 1, maxHops),
    probesPerHop: integer(parameters.probesPerHop, 'parameters.probesPerHop', 1, maxSamplesPerHop),
    perProbeTimeoutMs: integer(
      parameters.perProbeTimeoutMs,
      'parameters.perProbeTimeoutMs',
      100,
      2_000
    ),
    wallTimeoutMs: integer(
      parameters.wallTimeoutMs,
      'parameters.wallTimeoutMs',
      1_000,
      maxPathWallTimeoutMs
    ),
  };
  return {
    perspective: 'protopeek-process',
    observedAt: timestamp(trace.observedAt, 'observedAt'),
    status: enumValue(trace.status, ['complete', 'partial', 'cancelled'], 'status'),
    termination: nonEmptyString(trace.termination, 'termination', 256),
    reached: boolean(trace.reached, 'reached'),
    resolution: {
      input: nonEmptyString(resolution.input, 'resolution.input', 256),
      source: nonEmptyString(resolution.source, 'resolution.source', 128),
      network: nonEmptyString(resolution.network, 'resolution.network', 32),
      durationMs: number(resolution.durationMs, 'resolution.durationMs', 0, 30_000),
      answers,
      pinnedAddress: nonEmptyString(resolution.pinnedAddress, 'resolution.pinnedAddress', 256),
      pinnedFamily: enumValue(resolution.pinnedFamily, ['ipv4', 'ipv6'], 'resolution.pinnedFamily'),
    },
    route: normalizeRoute(trace.route),
    backend: nonEmptyString(trace.backend, 'backend', 256),
    method,
    parameters: normalizedParameters,
    hops,
    warnings: stringArray(trace.warnings, 'warnings', maxWarnings),
    durationMs: number(
      trace.durationMs,
      'durationMs',
      0,
      normalizedParameters.wallTimeoutMs + pathResolutionReturnAllowanceMs
    ),
  };
}

function capabilityLimit(
  limits: Record<string, unknown>,
  key: keyof PathCapabilities['limits'],
  minimum: number,
  maximum: number
) {
  return integer(limits[key], `limits.${key}`, minimum, maximum);
}

export function normalizePathCapabilities(value: unknown): PathCapabilities {
  const response = object(value, 'path capabilities');
  if (response.perspective !== 'protopeek-process') {
    throw new Error('path capability perspective must be protopeek-process.');
  }
  const limits = object(response.limits, 'limits');
  return {
    perspective: 'protopeek-process',
    os: nonEmptyString(response.os, 'os', 64),
    capabilities: array(response.capabilities, 'capabilities', 8).map((entry, index) => {
      const capability = object(entry, `capabilities[${index}]`);
      return {
        backend: nonEmptyString(capability.backend, `capabilities[${index}].backend`, 256),
        method: enumValue(
          capability.method,
          ['udp', 'icmp', 'tcp'],
          `capabilities[${index}].method`
        ),
        families: array(capability.families, `capabilities[${index}].families`, 2).map(
          (family, familyIndex) =>
            enumValue(family, ['ipv4', 'ipv6'], `capabilities[${index}].families[${familyIndex}]`)
        ),
        available: boolean(capability.available, `capabilities[${index}].available`),
        privilege: nonEmptyString(capability.privilege, `capabilities[${index}].privilege`, 128),
        install: nonEmptyString(capability.install, `capabilities[${index}].install`, 256),
        reason: string(capability.reason ?? '', `capabilities[${index}].reason`, 2 * 1024),
        limitations: stringArray(capability.limitations, `capabilities[${index}].limitations`, 16),
      };
    }),
    limits: {
      maxDestinationBytes: capabilityLimit(limits, 'maxDestinationBytes', 1, 253),
      maxResolvedAddresses: capabilityLimit(limits, 'maxResolvedAddresses', 1, 8),
      defaultMaxHops: capabilityLimit(limits, 'defaultMaxHops', 1, 32),
      maxHops: capabilityLimit(limits, 'maxHops', 1, 32),
      defaultProbesPerHop: capabilityLimit(limits, 'defaultProbesPerHop', 1, 4),
      maxProbesPerHop: capabilityLimit(limits, 'maxProbesPerHop', 1, 4),
      maxTotalProbes: capabilityLimit(limits, 'maxTotalProbes', 1, 96),
      defaultProbeTimeoutMs: capabilityLimit(limits, 'defaultProbeTimeoutMs', 100, 2_000),
      minProbeTimeoutMs: capabilityLimit(limits, 'minProbeTimeoutMs', 100, 2_000),
      maxProbeTimeoutMs: capabilityLimit(limits, 'maxProbeTimeoutMs', 100, 2_000),
      defaultWallTimeoutMs: capabilityLimit(
        limits,
        'defaultWallTimeoutMs',
        1_000,
        maxPathWallTimeoutMs
      ),
      maxWallTimeoutMs: capabilityLimit(limits, 'maxWallTimeoutMs', 1_000, maxPathWallTimeoutMs),
      maxProbesPerSecond: capabilityLimit(limits, 'maxProbesPerSecond', 1, 100),
      defaultUdpPort: capabilityLimit(limits, 'defaultUdpPort', 1, 65_535),
    },
    warnings: stringArray(response.warnings, 'warnings', maxWarnings),
  };
}

function median(sorted: number[]) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function buildHopRows(trace: PathTrace): PathHopRow[] {
  return trace.hops.map((hop) => {
    const responderRTTs = hop.responders.flatMap((responder) => {
      const samples = hop.samples
        .filter((sample) => sample.responder === responder)
        .map((sample) => sample.rttMs)
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right);
      return samples.length === 0
        ? []
        : [
            {
              responder,
              rtt: {
                min: samples[0] ?? 0,
                median: median(samples),
                max: samples[samples.length - 1] ?? 0,
              },
            },
          ];
    });
    const timeoutCount = hop.samples.filter((sample) => sample.status === 'timeout').length;
    return {
      ...hop,
      state: responderRTTs.length === 0 ? 'silent' : timeoutCount > 0 ? 'mixed' : 'responded',
      rtt: responderRTTs.length === 1 ? (responderRTTs[0]?.rtt ?? null) : null,
      responderRTTs,
    };
  });
}

export function summarizePathTrace(trace: PathTrace) {
  const rows = buildHopRows(trace);
  const destinationRTTs = trace.reached
    ? (rows
        .at(-1)
        ?.samples.filter(
          (sample) =>
            sample.status === 'reply' &&
            sample.responder === trace.resolution.pinnedAddress &&
            sample.rttMs !== null
        )
        .map((sample) => sample.rttMs as number) ?? [])
    : [];
  return {
    hopSlots: rows.length,
    respondingHopSlots: rows.filter((row) => row.state !== 'silent').length,
    silentHopSlots: rows.filter((row) => row.state === 'silent').length,
    responderCount: new Set(rows.flatMap((row) => row.responders)).size,
    destinationRTT: destinationRTTs.length
      ? median([...destinationRTTs].sort((a, b) => a - b))
      : null,
    reached: trace.reached,
    status: trace.status,
  };
}

export const pathRegionDictionary = {
  SIN: {
    label: 'Singapore',
    kind: 'metro',
    provider: '',
    caveat: 'A metro or airport code does not prove a datacenter or physical hop location.',
  },
  BOM: {
    label: 'Mumbai',
    kind: 'metro',
    provider: '',
    caveat: 'A metro or airport code does not prove a datacenter or physical hop location.',
  },
  IAD: {
    label: 'Northern Virginia / Dulles',
    kind: 'metro',
    provider: '',
    caveat: 'A metro or airport code does not prove a datacenter or physical hop location.',
  },
  'us-east-1': {
    label: 'US East (N. Virginia)',
    kind: 'provider-region',
    provider: 'AWS',
    caveat: 'A provider region is metadata; it does not locate an individual router or cable path.',
  },
} as const;

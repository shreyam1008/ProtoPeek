import {
  type NetworkPort,
  type NetworkProvenance,
  type NetworkService,
  type NetworkSnapshot,
  networkWorkspaceFormat,
  networkWorkspaceLimits,
  networkWorkspaceVersion,
  validateNetworkWorkspaceImport,
} from './network-model';

export type LocalNetworkProfile = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly ports: readonly number[];
  readonly applicationProbePorts: readonly number[];
};

export type LocalNetworkLimits = {
  readonly minimumPrefix: number;
  readonly maxPorts: number;
  readonly maxAttempts: number;
  readonly maxWorkers: number;
  readonly deadlineMs: number;
};

export type LocalNetworkInterface = {
  readonly index: number;
  readonly name: string;
  readonly address: string;
  readonly interfaceCidr: string;
  readonly suggestedCidr: string;
};

export type LocalNetworkCapabilities = {
  readonly perspective: 'protopeek-process';
  readonly activeProbe: false;
  readonly profiles: readonly LocalNetworkProfile[];
  readonly limits: LocalNetworkLimits;
  readonly interfaces: readonly LocalNetworkInterface[];
  readonly warnings: readonly string[];
};

export type LocalNetworkPlanPreview = {
  readonly cidr: string;
  readonly profile: LocalNetworkProfile;
  readonly hostCount: number;
  readonly portCount: number;
  readonly ports: readonly number[];
  readonly applicationProbePorts: readonly number[];
  readonly connectOnlyPorts: readonly number[];
  readonly attempts: number;
  readonly concurrency: number;
  readonly deadlineMs: number;
};

export type LocalNetworkPortEvidence = {
  readonly port: number;
  readonly state: 'open';
  readonly provenance: 'observed';
  readonly protocols: readonly string[];
  readonly grpc: boolean;
  readonly http: boolean;
  readonly reflection: string;
  readonly services: readonly string[];
  readonly httpProtocol: string;
  readonly httpStatus: string;
  readonly httpServer: string;
  readonly probeDurationMs: number;
  readonly evidenceNotes: readonly string[];
};

export type LocalNetworkHostHint = {
  readonly label: string;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly provenance: 'inferred';
  readonly reason: string;
};

export type LocalNetworkDiscoveredHost = {
  readonly address: string;
  readonly ports: readonly LocalNetworkPortEvidence[];
  readonly hints: readonly LocalNetworkHostHint[];
};

export type LocalNetworkDiscovery = {
  readonly perspective: 'protopeek-process';
  readonly observedAt: string;
  readonly cidr: string;
  readonly profile: LocalNetworkProfile;
  readonly hostCount: number;
  readonly attemptsPlanned: number;
  /** Probe calls that returned, including calls whose context was cancelled. */
  readonly attemptsCompleted: number;
  readonly complete: boolean;
  readonly stoppedReason?: string;
  readonly hosts: readonly LocalNetworkDiscoveredHost[];
  readonly warnings: readonly string[];
};

export type LocalNetworkDiscoveryRequest = {
  readonly cidr: string;
  readonly profile: string;
  readonly consent: true;
};

export type LocalNetworkHostMetadata = {
  readonly label: string;
  readonly tags: readonly string[];
};

const contractLimits = {
  maxProfiles: 16,
  maxInterfaces: 32,
  maxWarnings: 32,
  maxStringBytes: 2 * 1024,
  maxPorts: 18,
  maxAttempts: 4_572,
  maxWorkers: 32,
  maxDeadlineMs: 15_000,
  maxDiscoveryHosts: 254,
  maxProtocolsPerPort: 16,
  maxServicesPerPort: 16,
  maxEvidenceNotes: 32,
  maxHintsPerHost: 16,
} as const;

const utf8 = new TextEncoder();

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new Error(`${label}.${key} is not supported.`);
  }
}

function array(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array with at most ${maximum} items.`);
  }
  return value;
}

function string(value: unknown, label: string, maximum = contractLimits.maxStringBytes) {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    utf8.encode(value).byteLength > maximum
  ) {
    throw new Error(`${label} must be a bounded string.`);
  }
  return value;
}

function nonEmptyString(value: unknown, label: string, maximum = contractLimits.maxStringBytes) {
  const result = string(value, label, maximum);
  if (!result.trim()) throw new Error(`${label} must not be empty.`);
  return result;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function normalizeStringArray(
  value: unknown,
  label: string,
  maximum: number,
  maximumStringBytes = contractLimits.maxStringBytes
) {
  return array(value, label, maximum).map((entry, index) =>
    string(entry, `${label}[${index}]`, maximumStringBytes)
  );
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function timestamp(value: unknown, label: string) {
  const result = nonEmptyString(value, label, 128);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a timestamp.`);
  return parsed.toISOString();
}

function truncateUTF8(value: string, maximum: number) {
  if (utf8.encode(value).byteLength <= maximum) return value;
  const suffix = '…';
  const budget = maximum - utf8.encode(suffix).byteLength;
  const result: string[] = [];
  let length = 0;
  for (const character of value) {
    const bytes = utf8.encode(character).byteLength;
    if (length + bytes > budget) break;
    result.push(character);
    length += bytes;
  }
  return `${result.join('')}${suffix}`;
}

type ParsedIPv4CIDR = {
  address: number;
  network: number;
  prefix: number;
  canonical: string;
};

function parseIPv4Address(value: unknown, label: string) {
  const input = nonEmptyString(value, label, 15);
  const octets = input.split('.');
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !/^\d{1,3}$/.test(octet) || String(Number(octet)) !== octet || Number(octet) > 255
    )
  ) {
    throw new Error(`${label} must be a valid IPv4 address.`);
  }
  return octets.reduce((result, octet) => (result * 256 + Number(octet)) >>> 0, 0);
}

function formatIPv4(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function privateIPv4(value: number) {
  const first = value >>> 24;
  const second = (value >>> 16) & 255;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function parseIPv4CIDR(value: unknown, label: string): ParsedIPv4CIDR {
  const input = nonEmptyString(value, label, 32).trim();
  const parts = input.split('/');
  if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1] ?? '')) {
    throw new Error(`${label} must be an explicit IPv4 CIDR.`);
  }
  const address = parseIPv4Address(parts[0], `${label} address`);
  const prefix = Number(parts[1]);
  if (prefix < 0 || prefix > 32) throw new Error(`${label} must use a prefix from /0 through /32.`);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (address & mask) >>> 0;
  return { address, network, prefix, canonical: `${formatIPv4(network)}/${prefix}` };
}

function normalizeProfile(
  value: unknown,
  label: string,
  maximumPorts: number
): LocalNetworkProfile {
  const profile = object(value, label);
  exactKeys(profile, ['id', 'label', 'description', 'ports', 'applicationProbePorts'], label);
  const id = nonEmptyString(profile.id, `${label}.id`, 64);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`${label}.id must use lowercase portable identifier characters.`);
  }
  const ports = array(profile.ports, `${label}.ports`, maximumPorts).map((port, index) =>
    integer(port, `${label}.ports[${index}]`, 1, 65_535)
  );
  if (ports.length === 0) throw new Error(`${label}.ports must not be empty.`);
  if (new Set(ports).size !== ports.length) throw new Error(`${label}.ports contains duplicates.`);
  const applicationProbePorts = array(
    profile.applicationProbePorts,
    `${label}.applicationProbePorts`,
    ports.length
  ).map((port, index) => integer(port, `${label}.applicationProbePorts[${index}]`, 1, 65_535));
  if (new Set(applicationProbePorts).size !== applicationProbePorts.length) {
    throw new Error(`${label}.applicationProbePorts contains duplicates.`);
  }
  if (applicationProbePorts.some((port) => !ports.includes(port))) {
    throw new Error(`${label}.applicationProbePorts must be a subset of ports.`);
  }
  const orderedSubset = ports.filter((port) => applicationProbePorts.includes(port));
  if (orderedSubset.some((port, index) => port !== applicationProbePorts[index])) {
    throw new Error(`${label}.applicationProbePorts must preserve ports order.`);
  }
  return {
    id,
    label: nonEmptyString(profile.label, `${label}.label`, 256),
    description: string(profile.description, `${label}.description`),
    ports,
    applicationProbePorts,
  };
}

export function normalizeLocalNetworkCapabilities(value: unknown): LocalNetworkCapabilities {
  const input = object(value, 'Network capabilities');
  exactKeys(
    input,
    ['perspective', 'activeProbe', 'profiles', 'limits', 'interfaces', 'warnings'],
    'Network capabilities'
  );
  if (input.perspective !== 'protopeek-process') {
    throw new Error('Network capabilities.perspective must be "protopeek-process".');
  }
  if (input.activeProbe !== false) {
    throw new Error('Network capabilities.activeProbe must be false.');
  }
  const rawLimits = object(input.limits, 'Network capabilities.limits');
  exactKeys(
    rawLimits,
    ['minimumPrefix', 'maxPorts', 'maxAttempts', 'maxWorkers', 'deadlineMs'],
    'Network capabilities.limits'
  );
  const limits: LocalNetworkLimits = {
    minimumPrefix: integer(rawLimits.minimumPrefix, 'limits.minimumPrefix', 24, 32),
    maxPorts: integer(rawLimits.maxPorts, 'limits.maxPorts', 1, contractLimits.maxPorts),
    maxAttempts: integer(
      rawLimits.maxAttempts,
      'limits.maxAttempts',
      1,
      contractLimits.maxAttempts
    ),
    maxWorkers: integer(rawLimits.maxWorkers, 'limits.maxWorkers', 1, contractLimits.maxWorkers),
    deadlineMs: integer(
      rawLimits.deadlineMs,
      'limits.deadlineMs',
      100,
      contractLimits.maxDeadlineMs
    ),
  };
  const profiles = array(
    input.profiles,
    'Network capabilities.profiles',
    contractLimits.maxProfiles
  ).map((profile, index) =>
    normalizeProfile(profile, `Network capabilities.profiles[${index}]`, limits.maxPorts)
  );
  if (profiles.length === 0) throw new Error('Network capabilities.profiles must not be empty.');
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new Error('Network capabilities.profiles contains duplicate ids.');
  }
  const interfaces = array(
    input.interfaces,
    'Network capabilities.interfaces',
    contractLimits.maxInterfaces
  ).map((entry, index): LocalNetworkInterface => {
    const label = `Network capabilities.interfaces[${index}]`;
    const candidate = object(entry, label);
    exactKeys(candidate, ['index', 'name', 'address', 'interfaceCidr', 'suggestedCidr'], label);
    const addressText = nonEmptyString(candidate.address, `${label}.address`, 15);
    const address = parseIPv4Address(addressText, `${label}.address`);
    const interfaceCidr = parseIPv4CIDR(candidate.interfaceCidr, `${label}.interfaceCidr`);
    const suggestedCidr = parseIPv4CIDR(candidate.suggestedCidr, `${label}.suggestedCidr`);
    if (
      !privateIPv4(address) ||
      !privateIPv4(interfaceCidr.network) ||
      !privateIPv4(suggestedCidr.network)
    ) {
      throw new Error(`${label} must describe private IPv4 space.`);
    }
    if (suggestedCidr.prefix < limits.minimumPrefix) {
      throw new Error(`${label}.suggestedCidr may be no broader than /${limits.minimumPrefix}.`);
    }
    const suggestedSize = 2 ** (32 - suggestedCidr.prefix);
    if (address < suggestedCidr.network || address >= suggestedCidr.network + suggestedSize) {
      throw new Error(`${label}.suggestedCidr must contain its interface address.`);
    }
    return {
      index: integer(candidate.index, `${label}.index`, 1, 1_000_000),
      name: nonEmptyString(candidate.name, `${label}.name`, 256),
      address: formatIPv4(address),
      interfaceCidr: interfaceCidr.canonical,
      suggestedCidr: suggestedCidr.canonical,
    };
  });
  return {
    perspective: 'protopeek-process',
    activeProbe: false,
    profiles,
    limits,
    interfaces,
    warnings: normalizeStringArray(
      input.warnings,
      'Network capabilities.warnings',
      contractLimits.maxWarnings
    ),
  };
}

export function buildLocalNetworkPlanPreview(
  capabilities: LocalNetworkCapabilities,
  cidr: string,
  profileID: string
): LocalNetworkPlanPreview {
  const parsed = parseIPv4CIDR(cidr, 'Network scope');
  if (!privateIPv4(parsed.network)) throw new Error('Network scope must be a private IPv4 CIDR.');
  if (parsed.prefix < capabilities.limits.minimumPrefix) {
    throw new Error(`Network scope may be no broader than /${capabilities.limits.minimumPrefix}.`);
  }
  const normalizedProfileID = profileID.trim().toLowerCase() || 'quick';
  const profile = capabilities.profiles.find((candidate) => candidate.id === normalizedProfileID);
  if (!profile) throw new Error('Choose a known network discovery profile.');
  const addressCount = 2 ** (32 - parsed.prefix);
  const hostCount = parsed.prefix >= 31 ? addressCount : addressCount - 2;
  const attempts = hostCount * profile.ports.length;
  if (attempts < 1 || attempts > capabilities.limits.maxAttempts) {
    throw new Error(`Network plan exceeds the ${capabilities.limits.maxAttempts}-attempt limit.`);
  }
  return {
    cidr: parsed.canonical,
    profile,
    hostCount,
    portCount: profile.ports.length,
    ports: profile.ports,
    applicationProbePorts: profile.applicationProbePorts,
    connectOnlyPorts: profile.ports.filter((port) => !profile.applicationProbePorts.includes(port)),
    attempts,
    concurrency: Math.min(capabilities.limits.maxWorkers, attempts),
    deadlineMs: capabilities.limits.deadlineMs,
  };
}

function normalizePortEvidence(
  value: unknown,
  label: string,
  allowedPorts: ReadonlySet<number>
): LocalNetworkPortEvidence {
  const input = object(value, label);
  exactKeys(
    input,
    [
      'port',
      'state',
      'provenance',
      'protocols',
      'grpc',
      'http',
      'reflection',
      'services',
      'httpProtocol',
      'httpStatus',
      'httpServer',
      'probeDurationMs',
      'evidenceNotes',
    ],
    label
  );
  const port = integer(input.port, `${label}.port`, 1, 65_535);
  if (!allowedPorts.has(port))
    throw new Error(`${label}.port was not part of the selected profile.`);
  if (input.state !== 'open') throw new Error(`${label}.state must be "open".`);
  if (input.provenance !== 'observed') {
    throw new Error(`${label}.provenance must be "observed".`);
  }
  const protocols = normalizeStringArray(
    input.protocols,
    `${label}.protocols`,
    contractLimits.maxProtocolsPerPort,
    256
  );
  if (new Set(protocols).size !== protocols.length) {
    throw new Error(`${label}.protocols contains duplicates.`);
  }
  const services = normalizeStringArray(
    input.services,
    `${label}.services`,
    contractLimits.maxServicesPerPort,
    networkWorkspaceLimits.maxLabelBytes
  );
  if (new Set(services).size !== services.length) {
    throw new Error(`${label}.services contains duplicates.`);
  }
  return {
    port,
    state: 'open',
    provenance: 'observed',
    protocols,
    grpc: boolean(input.grpc, `${label}.grpc`),
    http: boolean(input.http, `${label}.http`),
    reflection: string(input.reflection, `${label}.reflection`, 256),
    services,
    httpProtocol: string(input.httpProtocol, `${label}.httpProtocol`, 256),
    httpStatus: string(input.httpStatus, `${label}.httpStatus`, 256),
    httpServer: string(input.httpServer, `${label}.httpServer`, 512),
    probeDurationMs: integer(
      input.probeDurationMs,
      `${label}.probeDurationMs`,
      0,
      contractLimits.maxDeadlineMs
    ),
    evidenceNotes: normalizeStringArray(
      input.evidenceNotes,
      `${label}.evidenceNotes`,
      contractLimits.maxEvidenceNotes
    ),
  };
}

function normalizeHostHint(value: unknown, label: string): LocalNetworkHostHint {
  const input = object(value, label);
  exactKeys(input, ['label', 'confidence', 'provenance', 'reason'], label);
  if (input.confidence !== 'low' && input.confidence !== 'medium' && input.confidence !== 'high') {
    throw new Error(`${label}.confidence has an unsupported value.`);
  }
  if (input.provenance !== 'inferred') {
    throw new Error(`${label}.provenance must be "inferred".`);
  }
  return {
    label: nonEmptyString(input.label, `${label}.label`, 512),
    confidence: input.confidence,
    provenance: 'inferred',
    reason: nonEmptyString(input.reason, `${label}.reason`),
  };
}

export function normalizeLocalNetworkDiscovery(value: unknown): LocalNetworkDiscovery {
  const input = object(value, 'Network discovery');
  exactKeys(
    input,
    [
      'perspective',
      'observedAt',
      'cidr',
      'profile',
      'hostCount',
      'attemptsPlanned',
      'attemptsCompleted',
      'complete',
      'stoppedReason',
      'hosts',
      'warnings',
    ],
    'Network discovery'
  );
  if (input.perspective !== 'protopeek-process') {
    throw new Error('Network discovery.perspective must be "protopeek-process".');
  }
  const cidr = parseIPv4CIDR(input.cidr, 'Network discovery.cidr');
  if (!privateIPv4(cidr.network) || cidr.prefix < 24) {
    throw new Error('Network discovery.cidr must be a private IPv4 CIDR no broader than /24.');
  }
  const addressCount = 2 ** (32 - cidr.prefix);
  const expectedHostCount = cidr.prefix >= 31 ? addressCount : addressCount - 2;
  const hostCount = integer(
    input.hostCount,
    'Network discovery.hostCount',
    1,
    contractLimits.maxDiscoveryHosts
  );
  if (hostCount !== expectedHostCount) {
    throw new Error('Network discovery.hostCount does not match its CIDR.');
  }
  const profile = normalizeProfile(
    input.profile,
    'Network discovery.profile',
    contractLimits.maxPorts
  );
  const attemptsPlanned = integer(
    input.attemptsPlanned,
    'Network discovery.attemptsPlanned',
    1,
    contractLimits.maxAttempts
  );
  if (attemptsPlanned !== hostCount * profile.ports.length) {
    throw new Error(
      'Network discovery.attemptsPlanned does not match its exact host and port plan.'
    );
  }
  const attemptsCompleted = integer(
    input.attemptsCompleted,
    'Network discovery.attemptsCompleted',
    0,
    attemptsPlanned
  );
  const complete = boolean(input.complete, 'Network discovery.complete');
  if (complete && attemptsCompleted !== attemptsPlanned) {
    throw new Error('A complete network discovery must complete every planned attempt.');
  }
  const stoppedReason =
    input.stoppedReason === undefined
      ? undefined
      : nonEmptyString(input.stoppedReason, 'Network discovery.stoppedReason', 256);
  if (complete && stoppedReason !== undefined) {
    throw new Error('A complete network discovery must not include stoppedReason.');
  }
  const allowedPorts = new Set(profile.ports);
  const rawHosts = array(input.hosts, 'Network discovery.hosts', contractLimits.maxDiscoveryHosts);
  if (rawHosts.length > hostCount) {
    throw new Error('Network discovery.hosts exceeds hostCount.');
  }
  const hosts = rawHosts.map((entry, index): LocalNetworkDiscoveredHost => {
    const label = `Network discovery.hosts[${index}]`;
    const host = object(entry, label);
    exactKeys(host, ['address', 'ports', 'hints'], label);
    const addressText = nonEmptyString(host.address, `${label}.address`, 15);
    const address = parseIPv4Address(addressText, `${label}.address`);
    const scopeSize = 2 ** (32 - cidr.prefix);
    const offset = address - cidr.network;
    if (
      offset < 0 ||
      offset >= scopeSize ||
      (cidr.prefix < 31 && (offset === 0 || offset === scopeSize - 1))
    ) {
      throw new Error(`${label}.address must be a host candidate inside the discovery CIDR.`);
    }
    const ports = array(host.ports, `${label}.ports`, profile.ports.length).map((port, portIndex) =>
      normalizePortEvidence(port, `${label}.ports[${portIndex}]`, allowedPorts)
    );
    if (ports.length === 0) throw new Error(`${label}.ports must contain observed open evidence.`);
    if (new Set(ports.map((port) => port.port)).size !== ports.length) {
      throw new Error(`${label}.ports contains duplicates.`);
    }
    return {
      address: formatIPv4(address),
      ports,
      hints: array(host.hints, `${label}.hints`, contractLimits.maxHintsPerHost).map(
        (hint, hintIndex) => normalizeHostHint(hint, `${label}.hints[${hintIndex}]`)
      ),
    };
  });
  if (new Set(hosts.map((host) => host.address)).size !== hosts.length) {
    throw new Error('Network discovery.hosts contains duplicate addresses.');
  }
  return {
    perspective: 'protopeek-process',
    observedAt: timestamp(input.observedAt, 'Network discovery.observedAt'),
    cidr: cidr.canonical,
    profile,
    hostCount,
    attemptsPlanned,
    attemptsCompleted,
    complete,
    ...(stoppedReason === undefined ? {} : { stoppedReason }),
    hosts,
    warnings: normalizeStringArray(
      input.warnings,
      'Network discovery.warnings',
      contractLimits.maxWarnings
    ),
  };
}

function endpoint(path: string) {
  return new URL(path, window.location.href).toString();
}

function csrfToken() {
  return document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '';
}

async function boundedError(response: Response, limit = 8 * 1024) {
  const message = (await response.text()).slice(0, limit).trim();
  const fallback = `${response.status} ${response.statusText}`.trim() || 'Request failed.';
  return `${message || fallback}${message.length === limit ? '…' : ''}`;
}

export async function fetchLocalNetworkCapabilities(
  signal?: AbortSignal
): Promise<LocalNetworkCapabilities> {
  const response = await fetch(endpoint('api/network/capabilities'), {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw new Error(await boundedError(response));
  return normalizeLocalNetworkCapabilities((await response.json()) as unknown);
}

export async function discoverLocalNetwork(
  request: LocalNetworkDiscoveryRequest,
  signal?: AbortSignal
): Promise<LocalNetworkDiscovery> {
  if (request.consent !== true) {
    throw new Error('Active private-network discovery requires explicit authorization.');
  }
  const body: LocalNetworkDiscoveryRequest = {
    cidr: nonEmptyString(request.cidr, 'Network discovery request.cidr', 32).trim(),
    profile: nonEmptyString(request.profile, 'Network discovery request.profile', 64)
      .trim()
      .toLowerCase(),
    consent: true,
  };
  const response = await fetch(endpoint('api/network/discover'), {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token': csrfToken(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await boundedError(response));
  const discovery = normalizeLocalNetworkDiscovery((await response.json()) as unknown);
  const requestedCIDR = parseIPv4CIDR(body.cidr, 'Network discovery request.cidr').canonical;
  if (discovery.cidr !== requestedCIDR) {
    throw new Error('Network discovery response did not match the requested CIDR.');
  }
  if (discovery.profile.id !== body.profile) {
    throw new Error('Network discovery response did not match the requested profile.');
  }
  return discovery;
}

function observedProvenance(observedAt: string, detail: string): NetworkProvenance {
  return {
    kind: 'observed',
    source: 'protopeek-probe',
    observedAt,
    detail: truncateUTF8(detail, networkWorkspaceLimits.maxDetailBytes),
  };
}

function inferredProvenance(observedAt: string, detail: string): NetworkProvenance {
  return {
    kind: 'inferred',
    source: 'protopeek-probe',
    observedAt,
    detail: truncateUTF8(detail, networkWorkspaceLimits.maxDetailBytes),
  };
}

function servicesForSnapshot(
  port: LocalNetworkPortEvidence,
  observedAt: string
): readonly NetworkService[] {
  const candidates: Array<{ name: string; product: string; transport: string }> = [];
  if (port.grpc) {
    const names = port.services.length > 0 ? port.services : ['gRPC endpoint'];
    for (const name of names) candidates.push({ name, product: '', transport: 'gRPC' });
  }
  if (port.http) {
    candidates.push({
      name: 'HTTP endpoint',
      product: port.httpServer,
      transport: port.httpProtocol || 'HTTP',
    });
  }
  return candidates.slice(0, networkWorkspaceLimits.maxServicesPerPort).map((service) => ({
    name: service.name,
    product: service.product,
    version: '',
    transport: service.transport,
    provenance: [
      observedProvenance(
        observedAt,
        `Protocol response observed on selected TCP port ${port.port}.`
      ),
    ],
  }));
}

function portForSnapshot(port: LocalNetworkPortEvidence, observedAt: string): NetworkPort {
  const details = [
    port.protocols.length > 0 ? `protocols: ${port.protocols.join(', ')}` : '',
    port.grpc ? `gRPC reflection: ${port.reflection || 'not reported'}` : '',
    port.http
      ? `HTTP: ${[port.httpProtocol, port.httpStatus, port.httpServer].filter(Boolean).join(' · ')}`
      : '',
    `full probe duration: ${port.probeDurationMs} ms`,
    ...port.evidenceNotes,
  ].filter(Boolean);
  return {
    number: port.port,
    protocol: 'tcp',
    state: 'open',
    services: servicesForSnapshot(port, observedAt),
    provenance: [
      observedProvenance(
        observedAt,
        `Open TCP endpoint observed from the ProtoPeek process; ${details.join('; ')}.`
      ),
    ],
  };
}

function workspaceBoundedString(value: unknown, label: string, maximum: number) {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new Error(`${label} must be a string without NUL.`);
  }
  if (utf8.encode(value).byteLength > maximum) {
    throw new Error(`${label} exceeds ${maximum} UTF-8 bytes.`);
  }
  return value;
}

function normalizeSnapshotMetadata(value: unknown, address: string): LocalNetworkHostMetadata {
  if (value === undefined) return { label: address, tags: [] };
  const label = `Host metadata for ${address}`;
  const input = object(value, label);
  exactKeys(input, ['label', 'tags'], label);
  const rawLabel = workspaceBoundedString(
    input.label,
    `${label}.label`,
    networkWorkspaceLimits.maxLabelBytes
  );
  const tags = array(input.tags, `${label}.tags`, networkWorkspaceLimits.maxTags).map(
    (tag, index) => {
      const result = workspaceBoundedString(
        typeof tag === 'string' ? tag.trim() : tag,
        `${label}.tags[${index}]`,
        networkWorkspaceLimits.maxTagBytes
      );
      if (!result) throw new Error(`${label}.tags[${index}] must not be empty.`);
      return result;
    }
  );
  if (new Set(tags).size !== tags.length) throw new Error(`${label}.tags contains duplicates.`);
  return { label: rawLabel.trim() || address, tags };
}

export function localNetworkDiscoveryToSnapshot(
  discovery: LocalNetworkDiscovery,
  metadata: Readonly<Record<string, LocalNetworkHostMetadata>> = {}
): NetworkSnapshot {
  discovery = normalizeLocalNetworkDiscovery(discovery);
  const observedAt = timestamp(discovery.observedAt, 'Network discovery observedAt');
  const stamp = observedAt.replace(/[^0-9A-Za-z]/g, '');
  const prefix = discovery.cidr.split('/')[1] ?? 'scope';
  const network = discovery.cidr.split('/')[0] ?? discovery.cidr;
  const groupID = `subnet:${network}:p${prefix}`;
  const scanDetail = discovery.complete
    ? `All ${discovery.attemptsCompleted} selected endpoint probe calls returned to the ProtoPeek process.`
    : `Partial scan: ${discovery.attemptsCompleted} of ${discovery.attemptsPlanned} selected endpoint probe calls returned to the ProtoPeek process${discovery.stoppedReason ? `; stopped: ${discovery.stoppedReason}` : ''}.`;
  const nodes = discovery.hosts.map((host, index) => {
    const annotations = normalizeSnapshotMetadata(metadata[host.address], host.address);
    const label = annotations.label;
    const tags = annotations.tags;
    const manual = label !== host.address || tags.length > 0;
    const hints = host.hints.map((hint) => `${hint.label} (${hint.confidence}): ${hint.reason}`);
    const provenance: NetworkProvenance[] = [
      observedProvenance(
        observedAt,
        `${host.ports.length} open selected TCP endpoint${host.ports.length === 1 ? '' : 's'} observed from the ProtoPeek process.`
      ),
    ];
    if (hints.length > 0) {
      provenance.push(
        inferredProvenance(observedAt, `Device-role hints only: ${hints.join('; ')}`)
      );
    }
    if (manual) {
      provenance.push({
        kind: 'manual',
        source: 'manual',
        observedAt,
        detail: 'User-edited host label or tags.',
      });
    }
    return {
      id: `host:${host.address}`,
      label,
      tags,
      notes: '',
      deviceType: host.hints[0]?.label ?? '',
      firstSeen: observedAt,
      lastSeen: observedAt,
      identities: [
        {
          kind: 'ipv4' as const,
          value: host.address,
          provenance: [
            observedProvenance(observedAt, 'Address produced positive selected-port evidence.'),
          ],
        },
      ],
      ports: host.ports.map((port) => portForSnapshot(port, observedAt)),
      groupIds: [groupID],
      position: {
        x: (index % 4) * 240,
        y: Math.floor(index / 4) * 160,
        pinned: false,
      },
      provenance,
    };
  });
  const notes = truncateUTF8(
    [scanDetail, ...discovery.warnings].join('\n'),
    networkWorkspaceLimits.maxNotesBytes
  );
  const snapshot: NetworkSnapshot = {
    id: `local-network-${stamp}`,
    label: `${discovery.profile.label} · ${discovery.cidr}`,
    tags: Array.from(new Set(['local-network', discovery.profile.id])),
    notes,
    observedAt,
    nodes,
    edges: [],
    groups: [
      {
        id: groupID,
        kind: 'subnet',
        name: `Subnet ${discovery.cidr}`,
        tags: ['local-network'],
        notes: scanDetail,
        regionCode: '',
        siteCode: '',
        vlanId: null,
        cidr: discovery.cidr,
        position: { x: 0, y: 0, pinned: false },
        provenance: [observedProvenance(observedAt, scanDetail)],
      },
    ],
    provenance: [observedProvenance(observedAt, scanDetail)],
  };
  const validated = validateNetworkWorkspaceImport({
    format: networkWorkspaceFormat,
    version: networkWorkspaceVersion,
    id: `local-network-workspace-${stamp}`,
    name: snapshot.label,
    tags: [],
    notes: '',
    createdAt: observedAt,
    updatedAt: observedAt,
    nodes: [],
    edges: [],
    groups: [],
    snapshots: [snapshot],
  });
  if (validated.error !== null) {
    throw new Error(`Local network snapshot is invalid: ${validated.error}`);
  }
  const result = validated.value.snapshots[0];
  if (!result) throw new Error('Local network snapshot is empty.');
  return result;
}

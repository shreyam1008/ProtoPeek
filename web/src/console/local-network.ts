import {
  type LocalNetworkInventory,
  normalizeLocalNetworkInventory,
} from '../features/network/local-network-inventory';
import {
  array,
  boolean,
  contractLimits,
  exactKeys,
  formatIPv4,
  integer,
  nonEmptyString,
  normalizeStringArray,
  object,
  type ParsedIPv4CIDR,
  parseIPv4Address,
  parseIPv4CIDR,
  privateIPv4,
  string,
  timestamp,
  truncateUTF8,
  utf8,
} from './local-network-values';

export {
  defaultLocalNetworkInterface,
  isAddressInLocalNetworkScope,
  type LocalNetworkDevice,
  type LocalNetworkInventory,
  localNetworkDevicesForInterface,
} from '../features/network/local-network-inventory';

import {
  type NetworkNode,
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
  readonly inventory?: LocalNetworkInventory;
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
  readonly advertisements?: LocalNetworkAdvertisements;
};

export type LocalNetworkAdvertisement = {
  readonly address: string;
  readonly instance: string;
  readonly serviceType: string;
  readonly hostname: string;
  readonly port: number;
  readonly txt: readonly string[];
  readonly source: 'mdns';
};

export type LocalNetworkAdvertisements = {
  readonly status: 'available' | 'partial' | 'unavailable';
  readonly records: readonly LocalNetworkAdvertisement[];
  readonly warnings: readonly string[];
};

export type LocalNetworkDiscoveryRequest = {
  readonly cidr: string;
  readonly profile: string;
  readonly consent: true;
  readonly interfaceIndex?: number;
};

export type LocalNetworkHostMetadata = {
  readonly label: string;
  readonly tags: readonly string[];
};

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
    ['perspective', 'activeProbe', 'profiles', 'limits', 'interfaces', 'warnings', 'inventory'],
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
    ...(input.inventory === undefined
      ? {}
      : { inventory: normalizeLocalNetworkInventory(input.inventory, interfaces) }),
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
      'advertisements',
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
    ...(input.advertisements === undefined
      ? {}
      : { advertisements: normalizeNetworkAdvertisements(input.advertisements, cidr) }),
    warnings: normalizeStringArray(
      input.warnings,
      'Network discovery.warnings',
      contractLimits.maxWarnings
    ),
  };
}

function normalizeNetworkAdvertisements(
  value: unknown,
  cidr: ParsedIPv4CIDR
): LocalNetworkAdvertisements {
  const label = 'Network discovery.advertisements';
  const input = object(value, label);
  exactKeys(input, ['status', 'records', 'warnings'], label);
  if (input.status !== 'available' && input.status !== 'partial' && input.status !== 'unavailable')
    throw new Error(`${label}.status is unsupported.`);
  const records = array(input.records, `${label}.records`, 64).map(
    (entry, index): LocalNetworkAdvertisement => {
      const recordLabel = `${label}.records[${index}]`;
      const record = object(entry, recordLabel);
      exactKeys(
        record,
        ['address', 'instance', 'serviceType', 'hostname', 'port', 'txt', 'source'],
        recordLabel
      );
      const address = parseIPv4Address(record.address, `${recordLabel}.address`);
      if (
        address < cidr.network ||
        address >= cidr.network + 2 ** (32 - cidr.prefix) ||
        (cidr.prefix < 31 &&
          (address === cidr.network || address === cidr.network + 2 ** (32 - cidr.prefix) - 1))
      )
        throw new Error(`${recordLabel}.address must be inside the requested scope.`);
      if (record.source !== 'mdns') throw new Error(`${recordLabel}.source must be mdns.`);
      return {
        address: formatIPv4(address),
        instance: advertisementText(
          nonEmptyString(record.instance, `${recordLabel}.instance`, 253)
        ),
        serviceType: advertisementText(
          nonEmptyString(record.serviceType, `${recordLabel}.serviceType`, 253)
        ),
        hostname: advertisementText(
          nonEmptyString(record.hostname, `${recordLabel}.hostname`, 253)
        ),
        port: integer(record.port, `${recordLabel}.port`, 1, 65535),
        txt: normalizeStringArray(record.txt, `${recordLabel}.txt`, 8, 256).map(advertisementText),
        source: 'mdns',
      };
    }
  );
  return {
    status: input.status,
    records,
    warnings: normalizeStringArray(input.warnings, `${label}.warnings`, contractLimits.maxWarnings),
  };
}

function advertisementText(value: string) {
  if (
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 || code === 0xfffe || code === 0xffff;
    })
  )
    throw new Error('Advertisement text contains unsupported control characters.');
  return value;
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
    ...(request.interfaceIndex === undefined
      ? {}
      : {
          interfaceIndex: integer(
            request.interfaceIndex,
            'Network discovery request.interfaceIndex',
            1,
            1_000_000
          ),
        }),
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
  const nodes: NetworkNode[] = discovery.hosts.map((host, index) => {
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
  for (const advertisement of discovery.advertisements?.records ?? []) {
    const provenance = observedProvenance(
      observedAt,
      `Device-provided mDNS/DNS-SD advertisement: ${advertisement.instance}; ${advertisement.serviceType}; hostname ${advertisement.hostname}; advertised port ${advertisement.port}. This does not establish an open port. ${advertisement.txt.join('; ')}`
    );
    let index = nodes.findIndex((node) => node.id === `host:${advertisement.address}`);
    if (index < 0) {
      index = nodes.length;
      nodes.push({
        id: `host:${advertisement.address}`,
        label: advertisement.hostname,
        tags: [],
        notes: '',
        deviceType: '',
        firstSeen: observedAt,
        lastSeen: observedAt,
        identities: [{ kind: 'ipv4', value: advertisement.address, provenance: [provenance] }],
        ports: [],
        groupIds: [groupID],
        position: { x: (index % 4) * 240, y: Math.floor(index / 4) * 160, pinned: false },
        provenance: [provenance],
      });
    }
    const node = nodes[index];
    if (!node) continue;
    const protocol = advertisement.serviceType.includes('._udp.') ? 'udp' : 'tcp';
    const existing = node.ports.find(
      (port) => port.number === advertisement.port && port.protocol === protocol
    );
    const service: NetworkService = {
      name: advertisement.instance,
      product: '',
      version: '',
      transport: advertisement.serviceType,
      provenance: [provenance],
    };
    const port: NetworkPort = existing
      ? {
          ...existing,
          services: [...existing.services, service].slice(
            0,
            networkWorkspaceLimits.maxServicesPerPort
          ),
          provenance: [...existing.provenance, provenance].slice(
            0,
            networkWorkspaceLimits.maxProvenancePerRecord
          ),
        }
      : {
          number: advertisement.port,
          protocol,
          state: 'unknown',
          services: [service],
          provenance: [provenance],
        };
    nodes[index] = {
      ...node,
      notes: truncateUTF8(
        [
          node.notes,
          `mDNS: ${advertisement.hostname} advertises ${advertisement.serviceType} on ${protocol.toUpperCase()} ${advertisement.port}.`,
        ]
          .filter(Boolean)
          .join('\n'),
        networkWorkspaceLimits.maxNotesBytes
      ),
      ports: existing
        ? node.ports.map((current) => (current === existing ? port : current))
        : [...node.ports, port],
    };
  }
  const notes = truncateUTF8(
    [scanDetail, ...discovery.warnings, ...(discovery.advertisements?.warnings ?? [])].join('\n'),
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

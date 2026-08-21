export const networkWorkspaceFormat = 'protopeek-network' as const;
export const networkWorkspaceVersion = 1 as const;

export const networkWorkspaceLimits = {
  maxJSONBytes: 4 << 20,
  maxNodes: 1_024,
  maxEdges: 4_096,
  maxGroups: 128,
  maxSnapshots: 64,
  maxSnapshotNodes: 8_192,
  maxSnapshotEdges: 16_384,
  maxSnapshotGroups: 1_024,
  maxTags: 32,
  maxIdentitiesPerNode: 32,
  maxPortsPerNode: 256,
  maxServicesPerPort: 16,
  maxProvenancePerRecord: 16,
  maxGroupsPerNode: 32,
  maxIdBytes: 256,
  maxLabelBytes: 512,
  maxTagBytes: 128,
  maxNotesBytes: 16 << 10,
  maxValueBytes: 4 << 10,
  maxDetailBytes: 2 << 10,
  maxCoordinate: 1_000_000,
} as const;

export type NetworkEvidenceKind = 'observed' | 'inferred' | 'manual';
export type NetworkEvidenceSource =
  | 'protopeek-probe'
  | 'nmap-import'
  | 'path-trace'
  | 'graphml-import'
  | 'manual';

export type NetworkProvenance = {
  readonly kind: NetworkEvidenceKind;
  readonly source: NetworkEvidenceSource;
  readonly observedAt: string;
  readonly detail: string;
};

export type NetworkPosition = {
  readonly x: number;
  readonly y: number;
  readonly pinned: boolean;
};

export type NetworkIdentity = {
  readonly kind: 'ipv4' | 'ipv6' | 'hostname' | 'mac' | 'other';
  readonly value: string;
  readonly provenance: readonly NetworkProvenance[];
};

export type NetworkService = {
  readonly name: string;
  readonly product: string;
  readonly version: string;
  readonly transport: string;
  readonly provenance: readonly NetworkProvenance[];
};

export type NetworkPort = {
  readonly number: number;
  readonly protocol: 'tcp' | 'udp' | 'sctp' | 'other';
  readonly state: 'open' | 'closed' | 'filtered' | 'unknown';
  readonly services: readonly NetworkService[];
  readonly provenance: readonly NetworkProvenance[];
};

export type NetworkNode = {
  readonly id: string;
  readonly label: string;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly deviceType: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly identities: readonly NetworkIdentity[];
  readonly ports: readonly NetworkPort[];
  readonly groupIds: readonly string[];
  readonly position: NetworkPosition;
  readonly provenance: readonly NetworkProvenance[];
};

export type NetworkEdge = {
  readonly id: string;
  readonly kind: 'observed' | 'manual' | 'trace';
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly notes: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly traceOrder: number | null;
  readonly provenance: readonly NetworkProvenance[];
};

export type NetworkGroup = {
  readonly id: string;
  readonly kind: 'region' | 'site' | 'vlan' | 'subnet' | 'custom';
  readonly name: string;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly regionCode: string;
  readonly siteCode: string;
  readonly vlanId: number | null;
  readonly cidr: string;
  readonly position: NetworkPosition;
  readonly provenance: readonly NetworkProvenance[];
};

export type NetworkSnapshot = {
  readonly id: string;
  readonly label: string;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly observedAt: string;
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly NetworkEdge[];
  readonly groups: readonly NetworkGroup[];
  readonly provenance: readonly NetworkProvenance[];
};

export type NetworkWorkspaceV1 = {
  readonly format: typeof networkWorkspaceFormat;
  readonly version: typeof networkWorkspaceVersion;
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly NetworkEdge[];
  readonly groups: readonly NetworkGroup[];
  readonly snapshots: readonly NetworkSnapshot[];
};

export type NetworkImportResult =
  | { error: null; value: NetworkWorkspaceV1 }
  | { error: string; value: null };

const utf8 = new TextEncoder();
const graphMLNamespace = 'http://graphml.graphdrawing.org/xmlns';

const evidenceKinds = new Set<NetworkEvidenceKind>(['observed', 'inferred', 'manual']);
const evidenceSources = new Set<NetworkEvidenceSource>([
  'protopeek-probe',
  'nmap-import',
  'path-trace',
  'graphml-import',
  'manual',
]);
const identityKinds = new Set<NetworkIdentity['kind']>([
  'ipv4',
  'ipv6',
  'hostname',
  'mac',
  'other',
]);
const portProtocols = new Set<NetworkPort['protocol']>(['tcp', 'udp', 'sctp', 'other']);
const portStates = new Set<NetworkPort['state']>(['open', 'closed', 'filtered', 'unknown']);
const edgeKinds = new Set<NetworkEdge['kind']>(['observed', 'manual', 'trace']);
const groupKinds = new Set<NetworkGroup['kind']>(['region', 'site', 'vlan', 'subnet', 'custom']);

function byteLength(value: string) {
  return utf8.encode(value).byteLength;
}

function hasInvalidXML10Character(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const allowed =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!allowed) return true;
  }
  return false;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[], label: string) {
  const keys = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!keys.has(key)) throw new Error(`${label}.${key} is not supported.`);
  }
}

function boundedString(
  value: unknown,
  label: string,
  maxBytes: number,
  { nonEmpty = false }: { nonEmpty?: boolean } = {}
) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  if (value.includes('\0')) throw new Error(`${label} must not contain NUL.`);
  if (hasInvalidXML10Character(value)) {
    throw new Error(`${label} contains a character that is not allowed by XML 1.0.`);
  }
  if (nonEmpty && !value.trim()) throw new Error(`${label} must not be empty.`);
  if (byteLength(value) > maxBytes) throw new Error(`${label} exceeds ${maxBytes} UTF-8 bytes.`);
  return value;
}

function id(value: unknown, label: string) {
  const result = boundedString(value, label, networkWorkspaceLimits.maxIdBytes, { nonEmpty: true });
  if (result !== result.trim() || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    throw new Error(`${label} must use portable identifier characters.`);
  }
  if (result === '__proto__' || result === 'constructor' || result === 'prototype') {
    throw new Error(`${label} uses a reserved identifier.`);
  }
  return result;
}

function boundedArray(value: unknown, label: string, max: number) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > max) throw new Error(`${label} exceeds the ${max}-item limit.`);
  return value;
}

function tags(value: unknown, label: string) {
  const input = boundedArray(value, label, networkWorkspaceLimits.maxTags);
  const result = input.map((entry, index) =>
    boundedString(entry, `${label}[${index}]`, networkWorkspaceLimits.maxTagBytes, {
      nonEmpty: true,
    })
  );
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates.`);
  return result;
}

function timestamp(value: unknown, label: string) {
  const input = boundedString(value, label, 128, { nonEmpty: true });
  const parsed = new Date(input);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error(`${label} must be an RFC 3339 timestamp.`);
  return parsed.toISOString();
}

function finiteNumber(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} through ${maximum}.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  const result = finiteNumber(value, label, minimum, maximum);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer.`);
  return result;
}

function enumValue<T extends string>(value: unknown, values: Set<T>, label: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw new Error(`${label} has an unsupported value.`);
  }
  return value as T;
}

function uniqueIDs<T extends { id: string }>(values: readonly T[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new Error(`${label} contains duplicate id ${value.id}.`);
    seen.add(value.id);
  }
  return seen;
}

function uniqueReferences(value: unknown, label: string, max: number) {
  const input = boundedArray(value, label, max);
  const result = input.map((entry, index) => id(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates.`);
  return result;
}

function normalizePosition(value: unknown, label: string): NetworkPosition {
  const input = record(value, label);
  exactKeys(input, ['x', 'y', 'pinned'], label);
  if (typeof input.pinned !== 'boolean') throw new Error(`${label}.pinned must be a boolean.`);
  return {
    x: finiteNumber(
      input.x,
      `${label}.x`,
      -networkWorkspaceLimits.maxCoordinate,
      networkWorkspaceLimits.maxCoordinate
    ),
    y: finiteNumber(
      input.y,
      `${label}.y`,
      -networkWorkspaceLimits.maxCoordinate,
      networkWorkspaceLimits.maxCoordinate
    ),
    pinned: input.pinned,
  };
}

function normalizeProvenance(value: unknown, label: string): NetworkProvenance[] {
  return boundedArray(value, label, networkWorkspaceLimits.maxProvenancePerRecord).map(
    (entry, index) => {
      const path = `${label}[${index}]`;
      const input = record(entry, path);
      exactKeys(input, ['kind', 'source', 'observedAt', 'detail'], path);
      return {
        kind: enumValue(input.kind, evidenceKinds, `${path}.kind`),
        source: enumValue(input.source, evidenceSources, `${path}.source`),
        observedAt: timestamp(input.observedAt, `${path}.observedAt`),
        detail: boundedString(
          input.detail,
          `${path}.detail`,
          networkWorkspaceLimits.maxDetailBytes
        ),
      };
    }
  );
}

function normalizeIdentity(value: unknown, label: string): NetworkIdentity {
  const input = record(value, label);
  exactKeys(input, ['kind', 'value', 'provenance'], label);
  const kind = enumValue(input.kind, identityKinds, `${label}.kind`);
  const identityValue = boundedString(
    input.value,
    `${label}.value`,
    networkWorkspaceLimits.maxValueBytes,
    { nonEmpty: true }
  );
  if (!validIdentity(kind, identityValue)) {
    throw new Error(`${label}.value is not a valid ${kind} identity.`);
  }
  return {
    kind,
    value: identityValue,
    provenance: normalizeProvenance(input.provenance, `${label}.provenance`),
  };
}

function validIdentity(kind: NetworkIdentity['kind'], value: string) {
  if (kind === 'other') return true;
  if (kind === 'ipv4') {
    const octets = value.split('.');
    return (
      octets.length === 4 &&
      octets.every(
        (octet) =>
          /^\d{1,3}$/.test(octet) && String(Number(octet)) === octet && Number(octet) <= 255
      )
    );
  }
  if (kind === 'ipv6') {
    const zoneSeparator = value.indexOf('%');
    const address = zoneSeparator === -1 ? value : value.slice(0, zoneSeparator);
    if (!address.includes(':')) return false;
    if (zoneSeparator !== -1) {
      const zone = value.slice(zoneSeparator + 1);
      if (value.indexOf('%', zoneSeparator + 1) !== -1) return false;
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(zone)) return false;
    }
    try {
      return new URL(`http://[${address}]/`).hostname.startsWith('[');
    } catch {
      return false;
    }
  }
  if (kind === 'mac') return /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value);
  const hostname = value.endsWith('.') ? value.slice(0, -1) : value;
  return (
    hostname.length > 0 &&
    hostname.length <= 253 &&
    hostname
      .split('.')
      .every(
        (part) =>
          part.length > 0 &&
          part.length <= 63 &&
          !part.startsWith('-') &&
          !part.endsWith('-') &&
          /^[A-Za-z0-9-]+$/.test(part)
      )
  );
}

function normalizeService(value: unknown, label: string): NetworkService {
  const input = record(value, label);
  exactKeys(input, ['name', 'product', 'version', 'transport', 'provenance'], label);
  return {
    name: boundedString(input.name, `${label}.name`, networkWorkspaceLimits.maxLabelBytes, {
      nonEmpty: true,
    }),
    product: boundedString(input.product, `${label}.product`, networkWorkspaceLimits.maxValueBytes),
    version: boundedString(input.version, `${label}.version`, networkWorkspaceLimits.maxValueBytes),
    transport: boundedString(
      input.transport,
      `${label}.transport`,
      networkWorkspaceLimits.maxLabelBytes
    ),
    provenance: normalizeProvenance(input.provenance, `${label}.provenance`),
  };
}

function normalizePort(value: unknown, label: string): NetworkPort {
  const input = record(value, label);
  exactKeys(input, ['number', 'protocol', 'state', 'services', 'provenance'], label);
  return {
    number: integer(input.number, `${label}.number`, 1, 65_535),
    protocol: enumValue(input.protocol, portProtocols, `${label}.protocol`),
    state: enumValue(input.state, portStates, `${label}.state`),
    services: boundedArray(
      input.services,
      `${label}.services`,
      networkWorkspaceLimits.maxServicesPerPort
    ).map((entry, index) => normalizeService(entry, `${label}.services[${index}]`)),
    provenance: normalizeProvenance(input.provenance, `${label}.provenance`),
  };
}

function normalizeNode(value: unknown, index: number): NetworkNode {
  const label = `nodes[${index}]`;
  const input = record(value, label);
  exactKeys(
    input,
    [
      'id',
      'label',
      'tags',
      'notes',
      'deviceType',
      'firstSeen',
      'lastSeen',
      'identities',
      'ports',
      'groupIds',
      'position',
      'provenance',
    ],
    label
  );
  const firstSeen = timestamp(input.firstSeen, `${label}.firstSeen`);
  const lastSeen = timestamp(input.lastSeen, `${label}.lastSeen`);
  if (firstSeen > lastSeen) throw new Error(`${label}.firstSeen must not follow lastSeen.`);
  const identities = boundedArray(
    input.identities,
    `${label}.identities`,
    networkWorkspaceLimits.maxIdentitiesPerNode
  ).map((entry, identityIndex) =>
    normalizeIdentity(entry, `${label}.identities[${identityIndex}]`)
  );
  const identityKeys = identities.map(
    (identity) =>
      `${identity.kind}:${identity.kind === 'hostname' || identity.kind === 'mac' ? identity.value.toLowerCase() : identity.value}`
  );
  if (new Set(identityKeys).size !== identityKeys.length) {
    throw new Error(`${label}.identities contains duplicates.`);
  }
  const ports = boundedArray(
    input.ports,
    `${label}.ports`,
    networkWorkspaceLimits.maxPortsPerNode
  ).map((entry, portIndex) => normalizePort(entry, `${label}.ports[${portIndex}]`));
  const portKeys = ports.map((port) => `${port.protocol}:${port.number}`);
  if (new Set(portKeys).size !== portKeys.length) {
    throw new Error(`${label}.ports contains duplicates.`);
  }
  return {
    id: id(input.id, `${label}.id`),
    label: boundedString(input.label, `${label}.label`, networkWorkspaceLimits.maxLabelBytes),
    tags: tags(input.tags, `${label}.tags`),
    notes: boundedString(input.notes, `${label}.notes`, networkWorkspaceLimits.maxNotesBytes),
    deviceType: boundedString(
      input.deviceType,
      `${label}.deviceType`,
      networkWorkspaceLimits.maxLabelBytes
    ),
    firstSeen,
    lastSeen,
    identities,
    ports,
    groupIds: uniqueReferences(
      input.groupIds,
      `${label}.groupIds`,
      networkWorkspaceLimits.maxGroupsPerNode
    ),
    position: normalizePosition(input.position, `${label}.position`),
    provenance: normalizeProvenance(input.provenance, `${label}.provenance`),
  };
}

function normalizeEdge(value: unknown, index: number): NetworkEdge {
  const label = `edges[${index}]`;
  const input = record(value, label);
  exactKeys(
    input,
    [
      'id',
      'kind',
      'source',
      'target',
      'label',
      'notes',
      'firstSeen',
      'lastSeen',
      'traceOrder',
      'provenance',
    ],
    label
  );
  const firstSeen = timestamp(input.firstSeen, `${label}.firstSeen`);
  const lastSeen = timestamp(input.lastSeen, `${label}.lastSeen`);
  if (firstSeen > lastSeen) throw new Error(`${label}.firstSeen must not follow lastSeen.`);
  const kind = enumValue(input.kind, edgeKinds, `${label}.kind`);
  const traceOrder =
    input.traceOrder === null ? null : integer(input.traceOrder, `${label}.traceOrder`, 1, 255);
  if (kind === 'trace' && traceOrder === null) {
    throw new Error(`${label}.traceOrder is required for a trace edge.`);
  }
  if (kind !== 'trace' && traceOrder !== null) {
    throw new Error(`${label}.traceOrder is only valid for a trace edge.`);
  }
  return {
    id: id(input.id, `${label}.id`),
    kind,
    source: id(input.source, `${label}.source`),
    target: id(input.target, `${label}.target`),
    label: boundedString(input.label, `${label}.label`, networkWorkspaceLimits.maxLabelBytes),
    notes: boundedString(input.notes, `${label}.notes`, networkWorkspaceLimits.maxNotesBytes),
    firstSeen,
    lastSeen,
    traceOrder,
    provenance: normalizeProvenance(input.provenance, `${label}.provenance`),
  };
}

function normalizeGroup(value: unknown, index: number): NetworkGroup {
  const label = `groups[${index}]`;
  const input = record(value, label);
  exactKeys(
    input,
    [
      'id',
      'kind',
      'name',
      'tags',
      'notes',
      'regionCode',
      'siteCode',
      'vlanId',
      'cidr',
      'position',
      'provenance',
    ],
    label
  );
  const kind = enumValue(input.kind, groupKinds, `${label}.kind`);
  const vlanId = input.vlanId === null ? null : integer(input.vlanId, `${label}.vlanId`, 1, 4_094);
  if (kind === 'vlan' && vlanId === null) throw new Error(`${label}.vlanId is required.`);
  if (kind !== 'vlan' && vlanId !== null) {
    throw new Error(`${label}.vlanId is only valid for a VLAN group.`);
  }
  return {
    id: id(input.id, `${label}.id`),
    kind,
    name: boundedString(input.name, `${label}.name`, networkWorkspaceLimits.maxLabelBytes),
    tags: tags(input.tags, `${label}.tags`),
    notes: boundedString(input.notes, `${label}.notes`, networkWorkspaceLimits.maxNotesBytes),
    regionCode: boundedString(
      input.regionCode,
      `${label}.regionCode`,
      networkWorkspaceLimits.maxLabelBytes
    ),
    siteCode: boundedString(
      input.siteCode,
      `${label}.siteCode`,
      networkWorkspaceLimits.maxLabelBytes
    ),
    vlanId,
    cidr: boundedString(input.cidr, `${label}.cidr`, networkWorkspaceLimits.maxValueBytes),
    position: normalizePosition(input.position, `${label}.position`),
    provenance: normalizeProvenance(input.provenance, `${label}.provenance`),
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function normalizeSnapshot(value: unknown, index: number): NetworkSnapshot {
  const label = `snapshots[${index}]`;
  const input = record(value, label);
  exactKeys(
    input,
    ['id', 'label', 'tags', 'notes', 'observedAt', 'nodes', 'edges', 'groups', 'provenance'],
    label
  );
  const nodes = boundedArray(input.nodes, `${label}.nodes`, networkWorkspaceLimits.maxNodes).map(
    normalizeNode
  );
  const edges = boundedArray(input.edges, `${label}.edges`, networkWorkspaceLimits.maxEdges).map(
    normalizeEdge
  );
  const groups = boundedArray(
    input.groups,
    `${label}.groups`,
    networkWorkspaceLimits.maxGroups
  ).map(normalizeGroup);
  const nodeIDs = uniqueIDs(nodes, `${label}.nodes`);
  uniqueIDs(edges, `${label}.edges`);
  const groupIDs = uniqueIDs(groups, `${label}.groups`);
  for (const node of nodes) {
    for (const groupID of node.groupIds) {
      if (!groupIDs.has(groupID)) {
        throw new Error(
          `Snapshot ${String(input.id)} node ${node.id} references unknown group ${groupID}.`
        );
      }
    }
  }
  for (const edge of edges) {
    if (!nodeIDs.has(edge.source) || !nodeIDs.has(edge.target)) {
      throw new Error(`Snapshot ${String(input.id)} edge ${edge.id} references an unknown node.`);
    }
    if (edge.source === edge.target) {
      throw new Error(`Snapshot ${String(input.id)} edge ${edge.id} must connect two nodes.`);
    }
  }
  return deepFreeze({
    id: id(input.id, `${label}.id`),
    label: boundedString(input.label, `${label}.label`, networkWorkspaceLimits.maxLabelBytes),
    tags: tags(input.tags, `${label}.tags`),
    notes: boundedString(input.notes, `${label}.notes`, networkWorkspaceLimits.maxNotesBytes),
    observedAt: timestamp(input.observedAt, `${label}.observedAt`),
    nodes,
    edges,
    groups,
    provenance: normalizeProvenance(input.provenance, `${label}.provenance`),
  });
}

function normalizeWorkspace(value: unknown): NetworkWorkspaceV1 {
  const input = record(value, 'Network workspace');
  exactKeys(
    input,
    [
      'format',
      'version',
      'id',
      'name',
      'tags',
      'notes',
      'createdAt',
      'updatedAt',
      'nodes',
      'edges',
      'groups',
      'snapshots',
    ],
    'Network workspace'
  );
  if (input.format !== networkWorkspaceFormat) {
    throw new Error(`Network workspace format must be "${networkWorkspaceFormat}".`);
  }
  if (input.version !== networkWorkspaceVersion) {
    throw new Error(`Network workspace version ${String(input.version)} is not supported.`);
  }
  const createdAt = timestamp(input.createdAt, 'createdAt');
  const updatedAt = timestamp(input.updatedAt, 'updatedAt');
  if (createdAt > updatedAt) throw new Error('createdAt must not follow updatedAt.');
  const nodes = boundedArray(input.nodes, 'nodes', networkWorkspaceLimits.maxNodes).map(
    normalizeNode
  );
  const edges = boundedArray(input.edges, 'edges', networkWorkspaceLimits.maxEdges).map(
    normalizeEdge
  );
  const groups = boundedArray(input.groups, 'groups', networkWorkspaceLimits.maxGroups).map(
    normalizeGroup
  );
  const snapshots = boundedArray(
    input.snapshots,
    'snapshots',
    networkWorkspaceLimits.maxSnapshots
  ).map(normalizeSnapshot);
  const snapshotNodeCount = snapshots.reduce((total, snapshot) => total + snapshot.nodes.length, 0);
  const snapshotEdgeCount = snapshots.reduce((total, snapshot) => total + snapshot.edges.length, 0);
  const snapshotGroupCount = snapshots.reduce(
    (total, snapshot) => total + snapshot.groups.length,
    0
  );
  if (snapshotNodeCount > networkWorkspaceLimits.maxSnapshotNodes) {
    throw new Error(
      `snapshots exceed the ${networkWorkspaceLimits.maxSnapshotNodes}-node aggregate limit.`
    );
  }
  if (snapshotEdgeCount > networkWorkspaceLimits.maxSnapshotEdges) {
    throw new Error(
      `snapshots exceed the ${networkWorkspaceLimits.maxSnapshotEdges}-edge aggregate limit.`
    );
  }
  if (snapshotGroupCount > networkWorkspaceLimits.maxSnapshotGroups) {
    throw new Error(
      `snapshots exceed the ${networkWorkspaceLimits.maxSnapshotGroups}-group aggregate limit.`
    );
  }
  const nodeIDs = uniqueIDs(nodes, 'nodes');
  uniqueIDs(edges, 'edges');
  const groupIDs = uniqueIDs(groups, 'groups');
  uniqueIDs(snapshots, 'snapshots');
  for (const node of nodes) {
    for (const groupID of node.groupIds) {
      if (!groupIDs.has(groupID))
        throw new Error(`Node ${node.id} references unknown group ${groupID}.`);
    }
  }
  for (const edge of edges) {
    if (!nodeIDs.has(edge.source) || !nodeIDs.has(edge.target)) {
      throw new Error(`Edge ${edge.id} references an unknown node.`);
    }
    if (edge.source === edge.target) throw new Error(`Edge ${edge.id} must connect two nodes.`);
  }
  return {
    format: networkWorkspaceFormat,
    version: networkWorkspaceVersion,
    id: id(input.id, 'id'),
    name: boundedString(input.name, 'name', networkWorkspaceLimits.maxLabelBytes),
    tags: tags(input.tags, 'tags'),
    notes: boundedString(input.notes, 'notes', networkWorkspaceLimits.maxNotesBytes),
    createdAt,
    updatedAt,
    nodes,
    edges,
    groups,
    snapshots: Object.freeze(snapshots),
  };
}

export function validateNetworkWorkspaceImport(value: unknown): NetworkImportResult {
  try {
    return { error: null, value: normalizeWorkspace(value) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid ProtoPeek network workspace.',
      value: null,
    };
  }
}

export function parseNetworkWorkspaceJSON(content: string): NetworkImportResult {
  if (utf8.encode(content).byteLength > networkWorkspaceLimits.maxJSONBytes) {
    return { error: 'Network workspace exceeds the 4 MiB import limit.', value: null };
  }
  try {
    return validateNetworkWorkspaceImport(JSON.parse(content));
  } catch {
    return { error: 'Network workspace JSON is malformed.', value: null };
  }
}

export function serializeNetworkWorkspace(workspace: NetworkWorkspaceV1) {
  const validated = validateNetworkWorkspaceImport(workspace);
  if (validated.error !== null) {
    throw new Error(`Network workspace cannot be exported: ${validated.error}`);
  }
  const serialized = JSON.stringify(validated.value, null, 2);
  if (utf8.encode(serialized).byteLength > networkWorkspaceLimits.maxJSONBytes) {
    throw new Error('Network workspace cannot be exported: file exceeds the 4 MiB limit.');
  }
  return serialized;
}

export const networkGraphMLExportLosses = [
  'GraphML omits node identities, ports, services, and original evidence provenance.',
  'GraphML omits immutable network snapshots.',
  'ProtoPeek tags, notes, and grouping metadata use custom GraphML data keys that other tools may discard.',
] as const;

export const networkGraphMLImportLosses = [
  'GraphML has no portable representation for ProtoPeek protocol evidence or immutable snapshots; imported records are marked as graphml-import.',
  'Only one flat directed GraphML graph is accepted; nested graphs, ports, hyperedges, and undirected or mixed edges are rejected rather than reinterpreted.',
] as const;

export type NetworkGraphMLImportResult =
  | { error: null; value: NetworkWorkspaceV1; losses: readonly string[] }
  | { error: string; value: null; losses: readonly string[] };

const graphMLKeys = [
  'pp_record_type',
  'pp_id',
  'pp_label',
  'pp_tags',
  'pp_notes',
  'pp_kind',
  'pp_x',
  'pp_y',
  'pp_pinned',
  'pp_device_type',
  'pp_group_ids',
  'pp_first_seen',
  'pp_last_seen',
  'pp_region_code',
  'pp_site_code',
  'pp_vlan_id',
  'pp_cidr',
  'pp_trace_order',
  'pp_created_at',
  'pp_updated_at',
] as const;

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function graphMLData(key: (typeof graphMLKeys)[number], value: string, indent: string) {
  return `${indent}<data key="${key}">${xml(value)}</data>`;
}

function graphMLCommonData(value: {
  id: string;
  tags: readonly string[];
  notes: string;
  position?: NetworkPosition;
}) {
  const lines = [
    graphMLData('pp_id', value.id, '      '),
    graphMLData('pp_tags', JSON.stringify(value.tags), '      '),
    graphMLData('pp_notes', value.notes, '      '),
  ];
  if (value.position) {
    lines.push(
      graphMLData('pp_x', String(value.position.x), '      '),
      graphMLData('pp_y', String(value.position.y), '      '),
      graphMLData('pp_pinned', String(value.position.pinned), '      ')
    );
  }
  return lines;
}

export function exportNetworkGraphML(workspace: NetworkWorkspaceV1) {
  const validated = validateNetworkWorkspaceImport(workspace);
  if (validated.error !== null) {
    throw new Error(`Network GraphML cannot be exported: ${validated.error}`);
  }
  const value = validated.value;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    ...graphMLKeys.map(
      (key) => `  <key id="${key}" for="all" attr.name="${key}" attr.type="string" />`
    ),
    `  <desc>${xml(networkGraphMLExportLosses.join(' '))}</desc>`,
    `  <graph id="workspace:${xml(value.id)}" edgedefault="directed">`,
    graphMLData('pp_record_type', 'workspace', '    '),
    graphMLData('pp_id', value.id, '    '),
    graphMLData('pp_label', value.name, '    '),
    graphMLData('pp_tags', JSON.stringify(value.tags), '    '),
    graphMLData('pp_notes', value.notes, '    '),
    graphMLData('pp_created_at', value.createdAt, '    '),
    graphMLData('pp_updated_at', value.updatedAt, '    '),
  ];
  for (const group of [...value.groups].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(`    <node id="group:${xml(group.id)}">`);
    lines.push(graphMLData('pp_record_type', 'group', '      '));
    lines.push(...graphMLCommonData(group));
    lines.push(graphMLData('pp_label', group.name, '      '));
    lines.push(graphMLData('pp_kind', group.kind, '      '));
    lines.push(graphMLData('pp_region_code', group.regionCode, '      '));
    lines.push(graphMLData('pp_site_code', group.siteCode, '      '));
    if (group.vlanId !== null) {
      lines.push(graphMLData('pp_vlan_id', String(group.vlanId), '      '));
    }
    lines.push(graphMLData('pp_cidr', group.cidr, '      '));
    lines.push('    </node>');
  }
  for (const node of [...value.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(`    <node id="node:${xml(node.id)}">`);
    lines.push(graphMLData('pp_record_type', 'node', '      '));
    lines.push(...graphMLCommonData(node));
    lines.push(graphMLData('pp_label', node.label, '      '));
    lines.push(graphMLData('pp_device_type', node.deviceType, '      '));
    lines.push(graphMLData('pp_group_ids', JSON.stringify(node.groupIds), '      '));
    lines.push(graphMLData('pp_first_seen', node.firstSeen, '      '));
    lines.push(graphMLData('pp_last_seen', node.lastSeen, '      '));
    lines.push('    </node>');
  }
  for (const edge of [...value.edges].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(
      `    <edge id="edge:${xml(edge.id)}" source="node:${xml(edge.source)}" target="node:${xml(edge.target)}">`
    );
    lines.push(graphMLData('pp_id', edge.id, '      '));
    lines.push(graphMLData('pp_kind', edge.kind, '      '));
    lines.push(graphMLData('pp_label', edge.label, '      '));
    lines.push(graphMLData('pp_notes', edge.notes, '      '));
    lines.push(graphMLData('pp_first_seen', edge.firstSeen, '      '));
    lines.push(graphMLData('pp_last_seen', edge.lastSeen, '      '));
    if (edge.traceOrder !== null) {
      lines.push(graphMLData('pp_trace_order', String(edge.traceOrder), '      '));
    }
    lines.push('    </edge>');
  }
  lines.push('  </graph>', '</graphml>');
  const content = `${lines.join('\n')}\n`;
  if (byteLength(content) > networkWorkspaceLimits.maxJSONBytes) {
    throw new Error('Network GraphML cannot be exported: file exceeds the 4 MiB limit.');
  }
  return { content, losses: networkGraphMLExportLosses };
}

function xmlChildren(element: Element, localName: string) {
  return Array.from(element.children).filter(
    (child) => child.namespaceURI === graphMLNamespace && child.localName === localName
  );
}

function assertGraphMLChildren(element: Element, allowed: ReadonlySet<string>, context: string) {
  for (const child of Array.from(element.children)) {
    if (child.namespaceURI === graphMLNamespace && allowed.has(child.localName)) continue;
    const structure = child.localName === 'graph' ? 'nested graph' : child.localName || 'element';
    throw new Error(`GraphML ${context} contains unsupported ${structure} structure.`);
  }
}

function graphMLDataMap(
  element: Element,
  keyNames: ReadonlyMap<string, string>,
  dataIDs?: Set<string>
) {
  const result = new Map<string, string>();
  for (const data of xmlChildren(element, 'data')) {
    const keyID = data.getAttribute('key');
    if (!keyID) throw new Error('Every GraphML data element requires a key.');
    const dataID = data.getAttribute('id');
    if (data.hasAttribute('id') && !dataID)
      throw new Error('Every GraphML data id must be non-empty.');
    if (dataID && dataIDs?.has(dataID)) {
      throw new Error(`GraphML data id ${dataID} is duplicated.`);
    }
    if (dataID) dataIDs?.add(dataID);
    const key = keyNames.get(keyID) ?? keyID;
    if (result.has(key)) throw new Error(`GraphML data key ${key} is duplicated.`);
    for (const child of Array.from(data.children)) {
      if (child.namespaceURI !== graphMLNamespace) continue;
      const structure = child.localName === 'graph' ? 'nested graph' : child.localName;
      throw new Error(`GraphML data key ${key} contains unsupported ${structure} structure.`);
    }
    if (graphMLKeys.includes(key as (typeof graphMLKeys)[number]) && data.children.length > 0) {
      throw new Error(`GraphML data key ${key} must contain text only.`);
    }
    result.set(key, data.textContent ?? '');
  }
  return result;
}

function graphMLString(data: ReadonlyMap<string, string>, key: string, fallback = '') {
  return data.get(key) ?? fallback;
}

function graphMLNumber(data: ReadonlyMap<string, string>, key: string, fallback: number) {
  const raw = data.get(key);
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number.`);
  return value;
}

function graphMLBoolean(data: ReadonlyMap<string, string>, key: string, fallback: boolean) {
  const raw = data.get(key);
  if (raw === undefined || raw === '') return fallback;
  if (raw !== 'true' && raw !== 'false') throw new Error(`${key} must be true or false.`);
  return raw === 'true';
}

function graphMLStringArray(data: ReadonlyMap<string, string>, key: string) {
  const raw = data.get(key);
  if (raw === undefined || raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${key} must contain a JSON string array.`);
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${key} must contain a JSON string array.`);
  }
  return parsed as string[];
}

function graphMLPosition(data: ReadonlyMap<string, string>): NetworkPosition {
  return {
    x: graphMLNumber(data, 'pp_x', 0),
    y: graphMLNumber(data, 'pp_y', 0),
    pinned: graphMLBoolean(data, 'pp_pinned', false),
  };
}

function graphMLProvenance(importedAt: string): NetworkProvenance[] {
  return [
    {
      kind: 'manual',
      source: 'graphml-import',
      observedAt: importedAt,
      detail: 'Imported from a portable GraphML topology mapping',
    },
  ];
}

export function importNetworkGraphML(
  content: string,
  importedAt = new Date().toISOString()
): NetworkGraphMLImportResult {
  let losses: readonly string[] = networkGraphMLImportLosses;
  if (byteLength(content) > networkWorkspaceLimits.maxJSONBytes) {
    return { error: 'Network GraphML exceeds the 4 MiB import limit.', value: null, losses };
  }
  if (hasInvalidXML10Character(content)) {
    return {
      error: 'Network GraphML contains a character that is not allowed by XML 1.0.',
      value: null,
      losses,
    };
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) {
    return {
      error: 'Network GraphML must not contain DOCTYPE or entity declarations.',
      value: null,
      losses,
    };
  }
  try {
    const normalizedImportedAt = timestamp(importedAt, 'importedAt');
    if (typeof DOMParser === 'undefined') throw new Error('GraphML parsing is unavailable.');
    const document = new DOMParser().parseFromString(content, 'application/xml');
    if (document.getElementsByTagName('parsererror').length > 0) {
      throw new Error('Network GraphML XML is malformed.');
    }
    const root = document.documentElement;
    if (root.localName !== 'graphml' || root.namespaceURI !== graphMLNamespace) {
      throw new Error('Network GraphML root must use the GraphML namespace.');
    }
    assertGraphMLChildren(root, new Set(['key', 'desc', 'graph']), 'root');
    const keyNames = new Map<string, string>();
    for (const key of xmlChildren(root, 'key')) {
      const keyID = key.getAttribute('id');
      if (!keyID) throw new Error('Every GraphML key requires an id.');
      if (keyNames.has(keyID)) throw new Error(`GraphML key id ${keyID} is duplicated.`);
      assertGraphMLChildren(key, new Set(['desc']), `key ${keyID}`);
      keyNames.set(keyID, key.getAttribute('attr.name') || keyID);
    }
    const supportedKeys = new Set<string>(graphMLKeys);
    const hasUnsupportedKey =
      [...keyNames.values()].some((key) => !supportedKeys.has(key)) ||
      Array.from(root.getElementsByTagNameNS('*', 'data')).some((data) => {
        const keyID = data.getAttribute('key') ?? '';
        return !supportedKeys.has(keyNames.get(keyID) ?? keyID);
      });
    if (hasUnsupportedKey) {
      losses = [...networkGraphMLImportLosses, 'Unsupported GraphML data keys were ignored.'];
    }
    const graphs = xmlChildren(root, 'graph');
    if (graphs.length !== 1) throw new Error('Network GraphML must contain one graph.');
    const graph = graphs[0];
    if (!graph) throw new Error('Network GraphML graph is missing.');
    const edgeDefault = graph.getAttribute('edgedefault');
    if (edgeDefault === 'undirected') {
      throw new Error('Undirected GraphML graphs are not supported.');
    }
    if (edgeDefault !== 'directed') {
      throw new Error('GraphML edgedefault must be directed.');
    }
    assertGraphMLChildren(graph, new Set(['data', 'desc', 'node', 'edge']), 'graph');
    const xmlDataIDs = new Set<string>();
    const graphData = graphMLDataMap(graph, keyNames, xmlDataIDs);
    const graphElements = xmlChildren(graph, 'node');
    if (graphElements.length > networkWorkspaceLimits.maxNodes + networkWorkspaceLimits.maxGroups) {
      throw new Error('Network GraphML contains too many node and group records.');
    }
    const provenance = graphMLProvenance(normalizedImportedAt);
    const groups: NetworkGroup[] = [];
    const nodes: NetworkNode[] = [];
    const XMLNodeIDs = new Map<string, string>();
    const xmlElementIDs = new Set<string>();
    for (const element of graphElements) {
      const xmlID = element.getAttribute('id');
      if (!xmlID) throw new Error('Every GraphML node requires an id.');
      if (xmlElementIDs.has(xmlID)) throw new Error(`GraphML node id ${xmlID} is duplicated.`);
      xmlElementIDs.add(xmlID);
      assertGraphMLChildren(element, new Set(['data', 'desc']), `node ${xmlID}`);
      const data = graphMLDataMap(element, keyNames, xmlDataIDs);
      const recordType = graphMLString(data, 'pp_record_type', 'node');
      const modelID = graphMLString(
        data,
        'pp_id',
        xmlID.replace(recordType === 'group' ? /^group:/ : /^node:/, '')
      );
      if (recordType === 'group') {
        groups.push({
          id: modelID,
          kind: graphMLString(data, 'pp_kind', 'custom') as NetworkGroup['kind'],
          name: graphMLString(data, 'pp_label', modelID),
          tags: graphMLStringArray(data, 'pp_tags'),
          notes: graphMLString(data, 'pp_notes'),
          regionCode: graphMLString(data, 'pp_region_code'),
          siteCode: graphMLString(data, 'pp_site_code'),
          vlanId:
            data.has('pp_vlan_id') && graphMLString(data, 'pp_vlan_id') !== ''
              ? graphMLNumber(data, 'pp_vlan_id', 0)
              : null,
          cidr: graphMLString(data, 'pp_cidr'),
          position: graphMLPosition(data),
          provenance,
        });
      } else if (recordType === 'node') {
        XMLNodeIDs.set(xmlID, modelID);
        nodes.push({
          id: modelID,
          label: graphMLString(data, 'pp_label', modelID),
          tags: graphMLStringArray(data, 'pp_tags'),
          notes: graphMLString(data, 'pp_notes'),
          deviceType: graphMLString(data, 'pp_device_type'),
          firstSeen: graphMLString(data, 'pp_first_seen', normalizedImportedAt),
          lastSeen: graphMLString(data, 'pp_last_seen', normalizedImportedAt),
          identities: [],
          ports: [],
          groupIds: graphMLStringArray(data, 'pp_group_ids'),
          position: graphMLPosition(data),
          provenance,
        });
      } else {
        throw new Error(`GraphML node ${xmlID} has unsupported record type ${recordType}.`);
      }
    }
    const edgeElements = xmlChildren(graph, 'edge');
    if (edgeElements.length > networkWorkspaceLimits.maxEdges) {
      throw new Error(`Network GraphML exceeds the ${networkWorkspaceLimits.maxEdges}-edge limit.`);
    }
    const edges = edgeElements.map((element, index): NetworkEdge => {
      const explicitXMLID = element.getAttribute('id');
      if (explicitXMLID && xmlElementIDs.has(explicitXMLID)) {
        throw new Error(`GraphML edge id ${explicitXMLID} is duplicated.`);
      }
      if (explicitXMLID) xmlElementIDs.add(explicitXMLID);
      const directed = element.getAttribute('directed');
      if (directed === 'false') {
        throw new Error(
          'GraphML directed="false" edges would create mixed or undirected topology.'
        );
      }
      if (directed !== null && directed !== 'true') {
        throw new Error(`GraphML edge directed attribute ${directed} is not supported.`);
      }
      if (element.hasAttribute('sourceport') || element.hasAttribute('targetport')) {
        throw new Error('GraphML edge port references are not supported.');
      }
      const xmlID = explicitXMLID || `edge-${index + 1}`;
      assertGraphMLChildren(element, new Set(['data', 'desc']), `edge ${xmlID}`);
      const data = graphMLDataMap(element, keyNames, xmlDataIDs);
      const sourceXML = element.getAttribute('source') ?? '';
      const targetXML = element.getAttribute('target') ?? '';
      const source = XMLNodeIDs.get(sourceXML);
      const target = XMLNodeIDs.get(targetXML);
      if (!source || !target) throw new Error(`GraphML edge ${xmlID} references an unknown node.`);
      const kind = graphMLString(data, 'pp_kind', 'manual') as NetworkEdge['kind'];
      return {
        id: graphMLString(data, 'pp_id', xmlID.replace(/^edge:/, '')),
        kind,
        source,
        target,
        label: graphMLString(data, 'pp_label'),
        notes: graphMLString(data, 'pp_notes'),
        firstSeen: graphMLString(data, 'pp_first_seen', normalizedImportedAt),
        lastSeen: graphMLString(data, 'pp_last_seen', normalizedImportedAt),
        traceOrder:
          data.has('pp_trace_order') && graphMLString(data, 'pp_trace_order') !== ''
            ? graphMLNumber(data, 'pp_trace_order', 0)
            : null,
        provenance,
      };
    });
    const graphID = graph.getAttribute('id')?.replace(/^workspace:/, '') || 'graphml-import';
    const workspace: NetworkWorkspaceV1 = {
      format: networkWorkspaceFormat,
      version: networkWorkspaceVersion,
      id: graphMLString(graphData, 'pp_id', graphID),
      name: graphMLString(graphData, 'pp_label', 'Imported GraphML network'),
      tags: graphMLStringArray(graphData, 'pp_tags'),
      notes: graphMLString(graphData, 'pp_notes'),
      createdAt: graphMLString(graphData, 'pp_created_at', normalizedImportedAt),
      updatedAt: graphMLString(graphData, 'pp_updated_at', normalizedImportedAt),
      nodes,
      edges,
      groups,
      snapshots: [],
    };
    const validated = validateNetworkWorkspaceImport(workspace);
    if (validated.error !== null) throw new Error(validated.error);
    return { error: null, value: validated.value, losses };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid Network GraphML.',
      value: null,
      losses,
    };
  }
}

function csvCell(value: string) {
  let safe = value.replaceAll(/\r\n|\r|\n/g, ' ');
  if (/^[\t ]*[=+\-@]/.test(safe)) safe = `'${safe}`;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportNetworkInventoryCSV(workspace: NetworkWorkspaceV1) {
  const validated = validateNetworkWorkspaceImport(workspace);
  if (validated.error !== null) {
    throw new Error(`Network inventory CSV cannot be exported: ${validated.error}`);
  }
  const value = validated.value;
  const groupNames = new Map(value.groups.map((group) => [group.id, group.name]));
  const rows: string[][] = [
    [
      'id',
      'label',
      'device_type',
      'identities',
      'ports',
      'services',
      'groups',
      'first_seen',
      'last_seen',
      'tags',
      'notes',
    ],
  ];
  for (const node of [...value.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    const identities = [...node.identities]
      .sort((left, right) =>
        `${left.kind}:${left.value}`.localeCompare(`${right.kind}:${right.value}`)
      )
      .map((identity) => `${identity.kind}:${identity.value}`)
      .join('; ');
    const sortedPorts = [...node.ports].sort(
      (left, right) => left.number - right.number || left.protocol.localeCompare(right.protocol)
    );
    const ports = sortedPorts
      .map((port) => `${port.number}/${port.protocol} (${port.state})`)
      .join('; ');
    const services = sortedPorts
      .flatMap((port) =>
        [...port.services]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((service) =>
            [
              `${port.number}/${port.protocol}`,
              service.name,
              service.product,
              service.version,
              service.transport,
            ]
              .filter(Boolean)
              .join(' ')
          )
      )
      .join('; ');
    const groups = [...node.groupIds]
      .sort((left, right) => left.localeCompare(right))
      .map((groupID) => `${groupNames.get(groupID) || groupID} [${groupID}]`)
      .join('; ');
    rows.push([
      node.id,
      node.label,
      node.deviceType,
      identities,
      ports,
      services,
      groups,
      node.firstSeen,
      node.lastSeen,
      node.tags.join('; '),
      node.notes,
    ]);
  }
  const content = `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  if (byteLength(content) > networkWorkspaceLimits.maxJSONBytes) {
    throw new Error('Network inventory CSV cannot be exported: file exceeds the 4 MiB limit.');
  }
  return content;
}

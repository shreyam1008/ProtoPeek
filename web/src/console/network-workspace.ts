import {
  type NetworkEdge,
  type NetworkGroup,
  type NetworkNode,
  type NetworkPort,
  type NetworkProvenance,
  type NetworkService,
  type NetworkSnapshot,
  type NetworkWorkspaceV1,
  networkWorkspaceFormat,
  networkWorkspaceLimits,
  networkWorkspaceVersion,
  validateNetworkWorkspaceImport,
} from './network-model';

function validatedWorkspace(value: unknown, action: string) {
  const result = validateNetworkWorkspaceImport(value);
  if (result.error !== null) throw new Error(`${action}: ${result.error}`);
  return result.value;
}

function portableID(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, networkWorkspaceLimits.maxIdBytes - 'workspace-'.length);
  return normalized || `network-${Date.now()}`;
}

function identityKey(identity: NetworkNode['identities'][number]) {
  const value =
    identity.kind === 'hostname' || identity.kind === 'mac'
      ? identity.value.toLowerCase()
      : identity.value;
  return `${identity.kind}:${value}`;
}

function manualProvenance(provenance: readonly NetworkProvenance[]) {
  return provenance.filter((entry) => entry.kind === 'manual');
}

function provenanceKey(entry: NetworkProvenance) {
  return `${entry.kind}\u0000${entry.source}\u0000${entry.observedAt}\u0000${entry.detail}`;
}

function mergeProvenance(
  observed: readonly NetworkProvenance[],
  preserved: readonly NetworkProvenance[]
) {
  const result = [...observed];
  const keys = new Set(result.map(provenanceKey));
  for (const entry of preserved) {
    const key = provenanceKey(entry);
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(entry);
  }
  return result;
}

function earlierTimestamp(left: string, right: string) {
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function laterTimestamp(left: string, right: string) {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function serviceKey(service: NetworkService) {
  return `${service.name}\u0000${service.product}\u0000${service.version}\u0000${service.transport}`;
}

function hasManualProvenance(value: { provenance: readonly NetworkProvenance[] }) {
  return value.provenance.some((entry) => entry.kind === 'manual');
}

function mergeServices(current: readonly NetworkService[], incoming: readonly NetworkService[]) {
  const currentByKey = new Map(current.map((service) => [serviceKey(service), service]));
  const retained = new Set<string>();
  const services = incoming.map((service) => {
    const key = serviceKey(service);
    retained.add(key);
    const existing = currentByKey.get(key);
    if (!existing) return service;
    return {
      ...service,
      provenance: mergeProvenance(service.provenance, manualProvenance(existing.provenance)),
    };
  });
  for (const service of current) {
    const key = serviceKey(service);
    if (!retained.has(key) && hasManualProvenance(service)) services.push(service);
  }
  return services;
}

function mergeIdentities(current: NetworkNode['identities'], incoming: NetworkNode['identities']) {
  const currentByKey = new Map(current.map((identity) => [identityKey(identity), identity]));
  const retained = new Set<string>();
  const identities = incoming.map((identity) => {
    const key = identityKey(identity);
    retained.add(key);
    const existing = currentByKey.get(key);
    if (!existing) return identity;
    return {
      ...identity,
      provenance: mergeProvenance(identity.provenance, manualProvenance(existing.provenance)),
    };
  });
  for (const identity of current) {
    const key = identityKey(identity);
    if (!retained.has(key) && hasManualProvenance(identity)) identities.push(identity);
  }
  return identities;
}

function portKey(port: NetworkPort) {
  return `${port.protocol}:${port.number}`;
}

function mergePorts(current: readonly NetworkPort[], incoming: readonly NetworkPort[]) {
  const currentByKey = new Map(current.map((port) => [portKey(port), port]));
  const retained = new Set<string>();
  const ports = incoming.map((port) => {
    const key = portKey(port);
    retained.add(key);
    const existing = currentByKey.get(key);
    if (!existing) return port;
    return {
      ...port,
      services: mergeServices(existing.services, port.services),
      provenance: mergeProvenance(port.provenance, manualProvenance(existing.provenance)),
    };
  });
  for (const port of current) {
    const key = portKey(port);
    const hasManualService = port.services.some(hasManualProvenance);
    if (!retained.has(key) && (hasManualProvenance(port) || hasManualService)) ports.push(port);
  }
  return ports;
}

type HistoricalNodeCandidate = {
  readonly node: NetworkNode;
  readonly snapshotIndex: number;
};

function historicalNodeLookup(snapshots: readonly NetworkSnapshot[]) {
  const byID = new Map<string, HistoricalNodeCandidate>();
  const byIdentity = new Map<string, HistoricalNodeCandidate>();
  snapshots.forEach((snapshot, snapshotIndex) => {
    for (const node of snapshot.nodes) {
      const candidate = { node, snapshotIndex };
      byID.set(node.id, candidate);
      for (const identity of node.identities) byIdentity.set(identityKey(identity), candidate);
    }
  });
  return (node: NetworkNode) => {
    let candidate = byID.get(node.id);
    for (const identity of node.identities) {
      const matching = byIdentity.get(identityKey(identity));
      if (matching && (!candidate || matching.snapshotIndex > candidate.snapshotIndex)) {
        candidate = matching;
      }
    }
    return candidate?.node;
  };
}

function equalStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mergeObservedNode(
  current: NetworkNode,
  incoming: NetworkNode,
  historical: NetworkNode | undefined
): NetworkNode {
  const preservedManualProvenance = manualProvenance(current.provenance);
  const preserveAllCurrentFields = !historical;
  const preserveHistoricalManualMetadata = historical ? hasManualProvenance(historical) : false;
  return {
    ...incoming,
    id: current.id,
    label:
      preserveAllCurrentFields ||
      preserveHistoricalManualMetadata ||
      current.label !== historical.label
        ? current.label
        : incoming.label,
    tags:
      preserveAllCurrentFields ||
      preserveHistoricalManualMetadata ||
      !equalStrings(current.tags, historical.tags)
        ? current.tags
        : incoming.tags,
    notes:
      preserveAllCurrentFields || current.notes !== historical.notes
        ? current.notes
        : incoming.notes,
    deviceType:
      preserveAllCurrentFields || current.deviceType !== historical.deviceType
        ? current.deviceType
        : incoming.deviceType,
    firstSeen: earlierTimestamp(current.firstSeen, incoming.firstSeen),
    lastSeen: laterTimestamp(current.lastSeen, incoming.lastSeen),
    identities: mergeIdentities(current.identities, incoming.identities),
    ports: mergePorts(current.ports, incoming.ports),
    groupIds: Array.from(new Set([...current.groupIds, ...incoming.groupIds])),
    position: current.position.pinned ? current.position : incoming.position,
    provenance: mergeProvenance(incoming.provenance, preservedManualProvenance),
  };
}

function mergeObservedNodes(
  current: readonly NetworkNode[],
  incoming: readonly NetworkNode[],
  snapshots: readonly NetworkSnapshot[]
) {
  const claimed = new Set<string>();
  const reservedIDs = new Set(current.map((node) => node.id));
  const outputIDs = new Set<string>();
  const incomingIDMap = new Map<string, string>();
  const historicalNode = historicalNodeLookup(snapshots);
  const nodes = incoming.map((node) => {
    const identities = new Set(node.identities.map(identityKey));
    const matchedByID = current.find(
      (candidate) => !claimed.has(candidate.id) && candidate.id === node.id
    );
    const matched =
      matchedByID ??
      current.find(
        (candidate) =>
          !claimed.has(candidate.id) &&
          candidate.identities.some((identity) => identities.has(identityKey(identity)))
      );
    if (matched) {
      claimed.add(matched.id);
      outputIDs.add(matched.id);
      incomingIDMap.set(node.id, matched.id);
      return mergeObservedNode(matched, node, historicalNode(matched));
    }
    const outputID = availableID(
      node.id,
      new Set([...reservedIDs, ...outputIDs]),
      networkWorkspaceLimits.maxNodes
    );
    outputIDs.add(outputID);
    incomingIDMap.set(node.id, outputID);
    return outputID === node.id ? node : { ...node, id: outputID };
  });
  for (const node of current) {
    if (!claimed.has(node.id)) nodes.push(node);
  }
  return { nodes, incomingIDMap };
}

function availableID(base: string, occupied: ReadonlySet<string>, maximumRecords: number) {
  if (!occupied.has(base)) return base;
  for (let sequence = 2; sequence <= maximumRecords; sequence++) {
    const suffix = `:observation-${sequence}`;
    const candidate = `${base.slice(0, networkWorkspaceLimits.maxIdBytes - suffix.length)}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error('Network observation cannot allocate a unique bounded record id.');
}

function isManualEdge(edge: NetworkEdge) {
  return edge.kind === 'manual' || edge.provenance.some((entry) => entry.kind === 'manual');
}

function mergeObservationEdges(
  current: readonly NetworkEdge[],
  incoming: readonly NetworkEdge[],
  incomingIDMap: ReadonlyMap<string, string>
) {
  const manual = current.filter(isManualEdge);
  const occupiedIDs = new Set(manual.map((edge) => edge.id));
  const observed = incoming.map((edge) => {
    const id = availableID(edge.id, occupiedIDs, networkWorkspaceLimits.maxEdges);
    occupiedIDs.add(id);
    return {
      ...edge,
      id,
      source: incomingIDMap.get(edge.source) ?? edge.source,
      target: incomingIDMap.get(edge.target) ?? edge.target,
    };
  });
  return [...observed, ...manual];
}

function mergeGroup(current: NetworkGroup, incoming: NetworkGroup): NetworkGroup {
  const preservedManualProvenance = manualProvenance(current.provenance);
  if (preservedManualProvenance.length === 0) return incoming;
  return {
    ...current,
    provenance: mergeProvenance(incoming.provenance, preservedManualProvenance),
  };
}

function mergeObservationGroups(
  current: readonly NetworkGroup[],
  incoming: readonly NetworkGroup[]
) {
  const retained = new Set<string>();
  const groups = incoming.map((group) => {
    retained.add(group.id);
    const existing = current.find((candidate) => candidate.id === group.id);
    return existing ? mergeGroup(existing, group) : group;
  });
  for (const group of current) {
    if (!retained.has(group.id)) groups.push(group);
  }
  return groups;
}

export function createWorkspaceFromSnapshot(
  snapshot: NetworkSnapshot,
  metadata: { id?: string; name?: string; tags?: readonly string[]; notes?: string } = {}
) {
  return validatedWorkspace(
    {
      format: networkWorkspaceFormat,
      version: networkWorkspaceVersion,
      id: metadata.id ?? `workspace-${portableID(snapshot.id)}`,
      name: metadata.name ?? snapshot.label,
      tags: metadata.tags ?? snapshot.tags,
      notes: metadata.notes ?? snapshot.notes,
      createdAt: snapshot.observedAt,
      updatedAt: snapshot.observedAt,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      groups: snapshot.groups,
      snapshots: [snapshot],
    },
    'Network snapshot cannot be saved'
  );
}

export function appendNetworkObservation(
  current: NetworkWorkspaceV1,
  observation: NetworkWorkspaceV1
) {
  if (current.snapshots.length >= networkWorkspaceLimits.maxSnapshots) {
    throw new Error(
      `Network history has reached the ${networkWorkspaceLimits.maxSnapshots}-snapshot limit. Export it or start a new workspace; no snapshot was removed.`
    );
  }
  const incoming = observation.snapshots[observation.snapshots.length - 1];
  if (!incoming) throw new Error('Network observation does not contain a snapshot.');
  if (current.snapshots.some((snapshot) => snapshot.id === incoming.id)) {
    throw new Error(`Network snapshot ${incoming.id} already exists.`);
  }
  const updatedAt =
    new Date(observation.updatedAt).getTime() > new Date(current.updatedAt).getTime()
      ? observation.updatedAt
      : current.updatedAt;
  const mergedNodes = mergeObservedNodes(current.nodes, observation.nodes, current.snapshots);
  return validatedWorkspace(
    {
      ...current,
      updatedAt,
      nodes: mergedNodes.nodes,
      edges: mergeObservationEdges(current.edges, observation.edges, mergedNodes.incomingIDMap),
      groups: mergeObservationGroups(current.groups, observation.groups),
      snapshots: [...current.snapshots, incoming],
    },
    'Network observation cannot be appended'
  );
}

export function restoreNetworkSnapshot(
  workspace: NetworkWorkspaceV1,
  snapshotID: string,
  restoredAt = new Date().toISOString()
) {
  const snapshot = workspace.snapshots.find((candidate) => candidate.id === snapshotID);
  if (!snapshot) throw new Error(`Network snapshot ${snapshotID} was not found.`);
  return validatedWorkspace(
    {
      ...workspace,
      updatedAt: restoredAt,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      groups: snapshot.groups,
      snapshots: workspace.snapshots,
    },
    'Network snapshot cannot be restored'
  );
}

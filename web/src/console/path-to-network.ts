import {
  type NetworkEdge,
  type NetworkNode,
  type NetworkProvenance,
  type NetworkWorkspaceV1,
  networkWorkspaceFormat,
  networkWorkspaceVersion,
  validateNetworkWorkspaceImport,
} from './network-model';
import type { PathHop, PathTrace } from './network-path';

export type PathWorkspaceMetadata = {
  id?: string;
  name?: string;
  tags?: string[];
  notes?: string;
};

function portableID(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._:-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 96);
  return normalized || 'target';
}

function identityKind(value: string): 'ipv4' | 'ipv6' | 'hostname' | 'other' {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return 'ipv4';
  if (value.includes(':')) return 'ipv6';
  if (value.includes('.') && !value.includes(' ')) return 'hostname';
  return 'other';
}

function pathProvenance(
  trace: PathTrace,
  detail: string,
  kind: NetworkProvenance['kind'] = 'observed'
): NetworkProvenance[] {
  return [{ kind, source: 'path-trace', observedAt: trace.observedAt, detail }];
}

function sampleDetail(hop: PathHop, responder: string) {
  const values = hop.samples
    .filter((sample) => sample.responder === responder && sample.rttMs !== null)
    .map((sample) => sample.rttMs as number)
    .sort((left, right) => left - right);
  if (!values.length) return `Responder ${responder} observed at TTL ${hop.ttl}.`;
  const median =
    values.length % 2
      ? (values[Math.floor(values.length / 2)] ?? 0)
      : ((values[values.length / 2 - 1] ?? 0) + (values[values.length / 2] ?? 0)) / 2;
  return `Responder ${responder} observed at TTL ${hop.ttl}; median source-to-responder RTT ${median} ms.`;
}

function networkNode(
  trace: PathTrace,
  input: Pick<NetworkNode, 'id' | 'label' | 'deviceType' | 'position'> & {
    identity: { kind: 'ipv4' | 'ipv6' | 'hostname' | 'other'; value: string };
    detail: string;
    evidenceKind?: NetworkProvenance['kind'];
  }
): NetworkNode {
  const provenance = pathProvenance(trace, input.detail, input.evidenceKind);
  return {
    id: input.id,
    label: input.label,
    tags: [],
    notes: '',
    deviceType: input.deviceType,
    firstSeen: trace.observedAt,
    lastSeen: trace.observedAt,
    identities: [{ ...input.identity, provenance }],
    ports: [],
    groupIds: [],
    position: input.position,
    provenance,
  };
}

export function pathTraceToNetworkWorkspace(
  trace: PathTrace,
  metadata: PathWorkspaceMetadata = {}
): NetworkWorkspaceV1 {
  const observedEpoch = new Date(trace.observedAt).getTime();
  const nodes: NetworkNode[] = [];
  const edges: NetworkEdge[] = [];
  const sourceIdentity = trace.route.sourceIp || 'protopeek-process';
  nodes.push(
    networkNode(trace, {
      id: 'source',
      label: 'This ProtoPeek process',
      deviceType: 'process',
      identity: { kind: identityKind(sourceIdentity), value: sourceIdentity },
      detail: `Path observation source${trace.route.interfaceName ? ` on ${trace.route.interfaceName}` : ''}.`,
      position: { x: 0, y: 0, pinned: true },
    })
  );

  let previousPrimary = 'source';
  let traceOrder = 0;
  for (const hop of trace.hops) {
    const values = hop.responders.length ? hop.responders : [''];
    const currentIDs: string[] = [];
    for (const [responderIndex, responder] of values.entries()) {
      const id = responder
        ? `hop-${String(hop.ttl).padStart(2, '0')}-${responderIndex + 1}`
        : `hop-${String(hop.ttl).padStart(2, '0')}-unknown`;
      const destination = trace.reached && responder === trace.resolution.pinnedAddress;
      const gateway = hop.ttl === 1 && responder !== '' && responder === trace.route.nextHop;
      const detail = responder
        ? sampleDetail(hop, responder)
        : `No matching reply was observed at TTL ${hop.ttl}; forwarding may still have occurred.`;
      nodes.push(
        networkNode(trace, {
          id,
          label: destination
            ? `Destination · ${responder}`
            : gateway
              ? `Gateway · ${responder}`
              : responder
                ? `Responder · ${responder}`
                : `Unknown hop ${hop.ttl}`,
          deviceType: destination ? 'destination' : responder ? 'path responder' : 'unknown hop',
          identity: responder
            ? { kind: identityKind(responder), value: responder }
            : { kind: 'other', value: `ttl-${hop.ttl}-no-reply` },
          detail,
          evidenceKind: responder ? 'observed' : 'inferred',
          position: {
            x: hop.ttl * 220,
            y: (responderIndex - (values.length - 1) / 2) * 128,
            pinned: false,
          },
        })
      );
      currentIDs.push(id);
      traceOrder++;
      edges.push({
        id: `trace-${String(traceOrder).padStart(3, '0')}`,
        kind: 'trace',
        source: previousPrimary,
        target: id,
        label: `TTL ${hop.ttl} sequence`,
        notes:
          'Logical adjacency between trace TTL slots; this inferred sequence is not a physical link or cable route.',
        firstSeen: trace.observedAt,
        lastSeen: trace.observedAt,
        traceOrder,
        provenance: pathProvenance(trace, detail, 'inferred'),
      });
    }
    previousPrimary = currentIDs[0] ?? previousPrimary;
  }

  const destinationAlreadyPresent = nodes.some((node) =>
    node.identities.some((identity) => identity.value === trace.resolution.pinnedAddress)
  );
  if (!destinationAlreadyPresent) {
    const destinationID = 'destination';
    nodes.push(
      networkNode(trace, {
        id: destinationID,
        label: `Destination${trace.reached ? '' : ' · not confirmed'} · ${trace.resolution.pinnedAddress}`,
        deviceType: 'destination',
        identity: {
          kind: trace.resolution.pinnedFamily,
          value: trace.resolution.pinnedAddress,
        },
        detail: trace.reached
          ? 'Trace reported the destination reached, but no matching destination responder record was present; this node is inferred from the pinned resolution.'
          : `Destination was not confirmed; trace ended with ${trace.termination}.`,
        evidenceKind: 'inferred',
        position: { x: (trace.hops.length + 1) * 220, y: 0, pinned: false },
      })
    );
    traceOrder++;
    edges.push({
      id: `trace-${String(traceOrder).padStart(3, '0')}`,
      kind: 'trace',
      source: previousPrimary,
      target: destinationID,
      label: 'Destination sequence',
      notes:
        'Logical adjacency after the final trace TTL slot; this inferred sequence is not a physical link or cable route.',
      firstSeen: trace.observedAt,
      lastSeen: trace.observedAt,
      traceOrder,
      provenance: pathProvenance(trace, `Trace ended with ${trace.termination}.`, 'inferred'),
    });
  }

  const workspaceID =
    metadata.id ?? `path-${portableID(trace.resolution.input)}-${String(observedEpoch)}`;
  const snapshotProvenance = pathProvenance(
    trace,
    `Bounded ${trace.method.toUpperCase()} path observation using ${trace.backend}.`
  );
  const workspace: NetworkWorkspaceV1 = {
    format: networkWorkspaceFormat,
    version: networkWorkspaceVersion,
    id: workspaceID,
    name: metadata.name ?? `Path to ${trace.resolution.input}`,
    tags: metadata.tags ?? [],
    notes: metadata.notes ?? '',
    createdAt: trace.observedAt,
    updatedAt: trace.observedAt,
    nodes,
    edges,
    groups: [],
    snapshots: [
      {
        id: `snapshot-${String(observedEpoch)}`,
        label: `Path observed ${trace.observedAt}`,
        tags: metadata.tags ?? [],
        notes: metadata.notes ?? '',
        observedAt: trace.observedAt,
        nodes,
        edges,
        groups: [],
        provenance: snapshotProvenance,
      },
    ],
  };
  const validated = validateNetworkWorkspaceImport(workspace);
  if (validated.error !== null) {
    throw new Error(`Path trace cannot be saved: ${validated.error}`);
  }
  return validated.value;
}

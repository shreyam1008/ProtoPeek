import type { NmapImportResponse } from './api';
import {
  type NetworkNode,
  type NetworkPort,
  type NetworkProvenance,
  networkWorkspaceLimits,
  validIdentity,
} from './network-model';
import { createWorkspaceFromSnapshot } from './network-workspace';

export type NmapTopologyPreview = ReturnType<typeof nmapToNetwork>;

/** Convert imported assertions only; this function performs no probes or persistence. */
export function nmapToNetwork(
  inventory: NmapImportResponse,
  name: string,
  importedAt = new Date().toISOString(),
  identifier: string = crypto.randomUUID()
) {
  if (
    !Array.isArray(inventory.hosts) ||
    inventory.hosts.length > 1024 ||
    inventory.hosts.reduce((sum, host) => sum + host.ports.length, 0) > 16384
  )
    throw new Error('Nmap evidence exceeds the supported host or port limits.');
  const losses = { hosts: 0, identities: 0, ports: 0, services: 0, compositeStates: 0 };
  const evidence = (
    detail: string,
    kind: NetworkProvenance['kind'] = 'observed'
  ): NetworkProvenance[] => [{ source: 'nmap-import', kind, observedAt: importedAt, detail }];
  const nodes: NetworkNode[] = [];
  for (const host of inventory.hosts) {
    const identities: NetworkNode['identities'][number][] = [];
    for (const identity of [
      ...host.addresses.map((address) => ({ kind: address.type, value: address.address })),
      ...host.hostnames.map((hostname) => ({ kind: 'hostname', value: hostname.name })),
    ]) {
      const kind = identity.kind as NetworkNode['identities'][number]['kind'];
      if (
        !['ipv4', 'ipv6', 'mac', 'hostname'].includes(kind) ||
        !validIdentity(kind, identity.value) ||
        identities.some(
          (item) => item.kind === kind && item.value.toLowerCase() === identity.value.toLowerCase()
        )
      ) {
        losses.identities++;
        continue;
      }
      identities.push({
        kind,
        value: identity.value,
        provenance: evidence('Identity from imported XML; not resolved or verified by ProtoPeek.'),
      });
    }
    if (!identities.length) {
      losses.hosts++;
      losses.ports += host.ports.length;
      continue;
    }
    const ports = new Map<string, NetworkPort>();
    for (const port of host.ports) {
      const protocol = port.protocol as NetworkPort['protocol'];
      const key = `${protocol}:${port.port}`;
      if (
        !['tcp', 'udp', 'sctp'].includes(protocol) ||
        !Number.isInteger(port.port) ||
        port.port < 1 ||
        port.port > 65535
      ) {
        losses.ports++;
        continue;
      }
      const previous = ports.get(key);
      if (previous) {
        losses.ports++;
        // Conflicting duplicate assertions must never silently preserve an open state.
        ports.set(key, {
          ...previous,
          state: 'unknown',
          provenance: [
            ...previous.provenance,
            ...evidence(
              `Duplicate ${key}: imported state=${port.state || 'unknown'}; reason=${port.reason || 'not recorded'}. State represented as unknown; duplicate service hints omitted.`
            ),
          ].slice(0, networkWorkspaceLimits.maxProvenancePerRecord),
        });
        continue;
      }
      if (ports.size >= networkWorkspaceLimits.maxPortsPerNode) {
        losses.ports++;
        continue;
      }
      const state = (
        ['open', 'closed', 'filtered'].includes(port.state) ? port.state : 'unknown'
      ) as NetworkPort['state'];
      const service = port.service;
      const serviceDetail = `Unverified Nmap hint; method=${service.method || 'unknown'}, confidence=${service.confidence || 'unknown'}. ${service.extrainfo || ''}`;
      const services = service.name.trim()
        ? [
            {
              name: service.name,
              product: service.product,
              version: service.version,
              transport: service.tunnel,
              provenance: evidence(serviceDetail, 'inferred'),
            },
          ]
        : [];
      if (
        !services.length &&
        [service.product, service.version, service.extrainfo, service.tunnel].some(Boolean)
      )
        losses.services++;
      ports.set(key, {
        number: port.port,
        protocol,
        state,
        services,
        provenance: evidence(
          `Imported state=${port.state || 'unknown'}; reason=${port.reason || 'not recorded'}.`
        ),
      });
    }
    losses.compositeStates += [...ports.values()].filter((port) => port.state === 'unknown').length;
    const identity =
      identities.find((item) => item.kind === 'ipv4' || item.kind === 'ipv6') ?? identities[0];
    nodes.push({
      id: `nmap-${nodes.length + 1}-${identity.value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 180)}`,
      label:
        host.hostnames.find((hostname) => validIdentity('hostname', hostname.name))?.name ||
        identity.value,
      tags: ['nmap-import'],
      notes: `Imported host state=${host.status.state || 'unknown'}; reason=${host.status.reason || 'not recorded'}. Scan completion=${inventory.completion}.`,
      deviceType: '',
      firstSeen: importedAt,
      lastSeen: importedAt,
      identities,
      ports: [...ports.values()],
      groupIds: [],
      position: {
        x: (nodes.length % 5) * 240,
        y: Math.floor(nodes.length / 5) * 140,
        pinned: false,
      },
      provenance: evidence(
        'Imported XML assertion. Observation time records import time; source scan time is not retained.'
      ),
    });
  }
  if (!nodes.length) throw new Error('No supported host identities could be mapped from this XML.');
  const workspace = createWorkspaceFromSnapshot({
    id: `nmap-${identifier}`,
    label: name || 'Imported Nmap evidence',
    tags: ['nmap-import'],
    notes:
      'Host inventory only; no links were inferred. Command arguments, scripts, OS guesses and traces are not retained.',
    observedAt: importedAt,
    nodes,
    edges: [],
    groups: [],
    provenance: evidence(
      `Imported XML; completion=${inventory.completion}. Source scan time is unknown.`
    ),
  });
  const bytes = new TextEncoder().encode(JSON.stringify(workspace)).byteLength;
  if (bytes > networkWorkspaceLimits.maxJSONBytes)
    throw new Error(
      'Converted evidence exceeds the 4 MiB workspace limit. Import a smaller scan; nothing was saved.'
    );
  return { workspace, losses, bytes, complete: inventory.complete };
}

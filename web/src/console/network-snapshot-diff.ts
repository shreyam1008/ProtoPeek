import type { NetworkNode, NetworkProvenance, NetworkSnapshot } from './network-model';

export type SnapshotChange = {
  kind: 'added' | 'not-observed' | 'changed' | 'ambiguous';
  entity: 'node' | 'edge' | 'group';
  label: string;
  details: string[];
  sources: readonly NetworkProvenance[];
};

function identities(node: NetworkNode) {
  return node.identities
    .map(({ kind, value }) => {
      let normalized = value.toLowerCase().replace(/\.$/, '');
      if (kind === 'mac') normalized = normalized.replaceAll('-', ':');
      if (kind === 'ipv6') {
        try {
          normalized = new URL(`http://[${value}]/`).hostname;
        } catch {
          /* validated imports may carry zone IDs */
        }
      }
      return `${kind}:${normalized}`;
    })
    .sort();
}

function identityIndex(nodes: readonly NetworkNode[]) {
  const index = new Map<string, number[]>();
  nodes.forEach((node, i) => {
    for (const key of identities(node)) index.set(key, [...(index.get(key) ?? []), i]);
  });
  return index;
}

function sorted(values: readonly unknown[]) {
  return JSON.stringify(values.map((value) => JSON.stringify(value)).sort());
}

function nodeFields(node: NetworkNode) {
  return {
    Identities: sorted(identities(node)),
    'Port and service evidence': sorted(
      node.ports.map((port) => [
        port.protocol,
        port.number,
        port.state,
        sorted(
          port.services.map((service) => [
            service.name,
            service.product,
            service.version,
            service.transport,
          ])
        ),
      ])
    ),
    Annotations: JSON.stringify([
      node.label,
      sorted(node.tags),
      node.notes,
      node.deviceType,
      sorted(node.groupIds),
    ]),
    'Sourced enrichment': sorted(
      node.provenance
        .filter((entry) => entry.source === 'ip-attribution')
        .map((entry) => [entry.source, entry.kind, entry.detail])
    ),
  };
}

function portChanges(before: NetworkNode, after: NetworkNode) {
  const key = (port: NetworkNode['ports'][number]) => `${port.protocol}:${port.number}`;
  const next = new Map(after.ports.map((port) => [key(port), port]));
  const changes: string[] = [];
  for (const port of before.ports) {
    const other = next.get(key(port));
    if (!other) changes.push(`${key(port)}: not observed in B`);
    else {
      if (port.state !== other.state) changes.push(`${key(port)}: ${port.state} → ${other.state}`);
      const serviceText = (value: typeof port) =>
        value.services
          .map((service) =>
            [service.name, service.product, service.version, service.transport]
              .filter(Boolean)
              .join(' ')
          )
          .sort()
          .join('; ') || 'none';
      if (serviceText(port) !== serviceText(other))
        changes.push(`${key(port)} hints: ${serviceText(port)} → ${serviceText(other)}`);
      next.delete(key(port));
    }
  }
  for (const port of next.values()) changes.push(`${key(port)}: added (${port.state})`);
  return changes;
}

/** Compare immutable observations, never infer an outage from absent evidence. */
export function compareNetworkSnapshots(before: NetworkSnapshot, after: NetworkSnapshot) {
  const changes: SnapshotChange[] = [];
  const left = identityIndex(before.nodes);
  const right = identityIndex(after.nodes);
  const used = new Set<number>();
  const uncertain = new Set<number>();
  const matches = new Map<string, string>();
  const byID = new Map(after.nodes.map((node, i) => [node.id, i]));
  const candidatesByNode = before.nodes.map((node) => {
    const keys = identities(node);
    const candidates = new Set<number>();
    for (const key of keys) for (const index of right.get(key) ?? []) candidates.add(index);
    const sameID = byID.get(node.id);
    if (sameID !== undefined) {
      const otherKeys = identities(after.nodes[sameID]);
      if (!keys.length || !otherKeys.length || keys.some((key) => otherKeys.includes(key)))
        candidates.add(sameID);
    }
    return candidates;
  });
  const incoming = new Map<number, number>();
  for (const candidates of candidatesByNode)
    for (const index of candidates) incoming.set(index, (incoming.get(index) ?? 0) + 1);
  for (const [nodeIndex, node] of before.nodes.entries()) {
    const keys = identities(node);
    const candidates = candidatesByNode[nodeIndex];
    const unique = [...candidates].filter((index) => !used.has(index));
    const duplicatedIdentity = keys.some(
      (key) => (left.get(key)?.length ?? 0) > 1 || (right.get(key)?.length ?? 0) > 1
    );
    if (
      unique.length > 1 ||
      (unique.length &&
        (duplicatedIdentity || unique.some((index) => (incoming.get(index) ?? 0) > 1)))
    ) {
      for (const index of unique) uncertain.add(index);
      changes.push({
        kind: 'ambiguous',
        entity: 'node',
        label: node.label,
        details: ['Shared identities prevent a unique match. No records were merged.'],
        sources: [...node.provenance, ...unique.flatMap((index) => after.nodes[index].provenance)],
      });
      continue;
    }
    const index = unique[0];
    if (index === undefined) {
      changes.push({
        kind: 'not-observed',
        entity: 'node',
        label: node.label,
        details: ['Not recorded in observation B; this does not establish availability.'],
        sources: node.provenance,
      });
      continue;
    }
    used.add(index);
    const next = after.nodes[index];
    matches.set(node.id, next.id);
    const fields = nodeFields(node);
    const nextFields = nodeFields(next);
    const details = (Object.keys(fields) as Array<keyof typeof fields>)
      .filter((field) => fields[field] !== nextFields[field])
      .flatMap((field) =>
        field === 'Port and service evidence'
          ? portChanges(node, next)
          : field === 'Identities'
            ? [`Identities: ${identities(node).join(', ')} → ${identities(next).join(', ')}`]
            : [field]
      );
    if (details.length)
      changes.push({
        kind: 'changed',
        entity: 'node',
        label: next.label,
        details,
        sources: [...node.provenance, ...next.provenance],
      });
  }
  after.nodes.forEach((node, index) => {
    if (!used.has(index) && !uncertain.has(index))
      changes.push({
        kind: 'added',
        entity: 'node',
        label: node.label,
        details: ['Recorded in observation B.'],
        sources: node.provenance,
      });
  });
  for (const entity of ['group', 'edge'] as const) {
    const a = entity === 'group' ? before.groups : before.edges;
    const b = entity === 'group' ? after.groups : after.edges;
    const signature = (value: (typeof a)[number], isBefore: boolean) => {
      if ('source' in value)
        return JSON.stringify([
          value.kind,
          isBefore
            ? [matches.has(value.source), matches.get(value.source) ?? value.source]
            : [true, value.source],
          isBefore
            ? [matches.has(value.target), matches.get(value.target) ?? value.target]
            : [true, value.target],
          value.traceOrder,
        ]);
      return value.id;
    };
    const remaining = new Map<string, Array<(typeof b)[number]>>();
    for (const value of b) {
      const key = signature(value, false);
      remaining.set(key, [...(remaining.get(key) ?? []), value]);
    }
    const original = new Map(remaining);
    const counts = new Map<string, number>();
    for (const value of a) {
      const key = signature(value, true);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const value of a) {
      const key = signature(value, true);
      const candidates = original.get(key) ?? [];
      // Parallel logical edges have no unique identity across observations.
      const ambiguous = candidates.length > 1 || (counts.get(key) ?? 0) > 1;
      const next = candidates[0];
      const label =
        'name' in value ? value.name : value.label || `${value.source} → ${value.target}`;
      if (ambiguous && next) {
        changes.push({
          kind: 'ambiguous',
          entity,
          label,
          details: ['Parallel records cannot be matched uniquely. No records were merged.'],
          sources: [...value.provenance, ...candidates.flatMap((entry) => entry.provenance)],
        });
        remaining.delete(key);
        continue;
      }
      if (!next)
        changes.push({
          kind: 'not-observed',
          entity,
          label,
          details: ['Not recorded in observation B.'],
          sources: value.provenance,
        });
      else {
        if ('name' in value && 'name' in next) {
          const groupFields = (group: typeof value) =>
            JSON.stringify([
              group.name,
              group.kind,
              sorted(group.tags),
              group.notes,
              group.regionCode,
              group.siteCode,
              group.vlanId,
              group.cidr,
            ]);
          if (groupFields(value) !== groupFields(next))
            changes.push({
              kind: 'changed',
              entity,
              label,
              details: ['Group attributes changed.'],
              sources: next.provenance,
            });
        }
        if (
          'source' in value &&
          'source' in next &&
          (value.label !== next.label || value.notes !== next.notes)
        )
          changes.push({
            kind: 'changed',
            entity,
            label,
            details: ['Logical edge annotation changed.'],
            sources: next.provenance,
          });
        remaining.delete(key);
      }
    }
    for (const value of [...remaining.values()].flat())
      changes.push({
        kind: 'added',
        entity,
        label: 'name' in value ? value.name : value.label || `${value.source} → ${value.target}`,
        details: ['Recorded in observation B.'],
        sources: value.provenance,
      });
  }
  // Immutable observations give identical ambiguous records distinct, stable row keys.
  return changes.map((change, index) => ({ ...change, id: `${before.id}:${after.id}:${index}` }));
}

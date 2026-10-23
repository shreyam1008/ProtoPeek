import { describe, expect, it } from 'vitest';
import type { NetworkNode, NetworkSnapshot } from './network-model';
import { compareNetworkSnapshots } from './network-snapshot-diff';

const time = '2026-10-22T12:00:00Z';
function node(id: string, address = '192.0.2.1'): NetworkNode {
  return {
    id,
    label: id,
    tags: [],
    notes: '',
    deviceType: '',
    firstSeen: time,
    lastSeen: time,
    identities: [{ kind: 'ipv4', value: address, provenance: [] }],
    ports: [{ protocol: 'tcp', number: 443, state: 'open', services: [], provenance: [] }],
    groupIds: [],
    position: { x: 0, y: 0, pinned: false },
    provenance: [],
  };
}
function snapshot(nodes: readonly NetworkNode[]): NetworkSnapshot {
  return {
    id: 'a',
    label: 'Observation',
    tags: [],
    notes: '',
    observedAt: time,
    nodes,
    edges: [],
    groups: [],
    provenance: [],
  };
}
describe('immutable observation differences', () => {
  it('ignores layout, ordering and timestamp noise without mutating either observation', () => {
    const a = snapshot([node('host')]);
    const b = {
      ...a,
      id: 'b',
      observedAt: '2026-10-22T13:00:00Z',
      nodes: a.nodes.map((host) => ({
        ...host,
        lastSeen: '2026-10-22T13:00:00Z',
        position: { x: 200, y: 200, pinned: true },
      })),
    };
    const original = JSON.stringify([a, b]);
    expect(compareNetworkSnapshots(a, b)).toEqual([]);
    expect(JSON.stringify([a, b])).toBe(original);
  });
  it('matches unique identities across regenerated IDs and shows actual port state changes', () => {
    const host = node('old');
    const next = { ...host, id: 'new', ports: [{ ...host.ports[0], state: 'closed' as const }] };
    expect(compareNetworkSnapshots(snapshot([host]), snapshot([next]))).toMatchObject([
      { kind: 'changed', details: ['tcp:443: open → closed'] },
    ]);
  });
  it('calls absence not observed and does not imply closed or down', () => {
    const changes = compareNetworkSnapshots(snapshot([node('host')]), snapshot([]));
    expect(changes).toMatchObject([{ kind: 'not-observed', entity: 'node' }]);
    expect(changes[0].details[0]).toContain('does not establish availability');
  });
  it('refuses to merge shared identities even when IDs coincide', () => {
    const changes = compareNetworkSnapshots(
      snapshot([node('one'), node('two')]),
      snapshot([node('one')])
    );
    expect(changes.map((entry) => entry.kind)).toEqual(['ambiguous', 'ambiguous']);
  });
  it('marks many-to-one identity combinations ambiguous before assigning any record', () => {
    const first = node('first');
    const second = node('second', '192.0.2.2');
    const merged = { ...first, identities: [...first.identities, ...second.identities] };
    expect(
      compareNetworkSnapshots(snapshot([first, second]), snapshot([merged])).map(
        (entry) => entry.kind
      )
    ).toEqual(['ambiguous', 'ambiguous']);
  });
  it('retains sourced enrichment changes and provenance', () => {
    const host = node('host');
    const source = {
      source: 'ip-attribution' as const,
      kind: 'inferred' as const,
      observedAt: time,
      detail: 'Locally imported ASN evidence; not physical location.',
    };
    const changes = compareNetworkSnapshots(
      snapshot([host]),
      snapshot([{ ...host, provenance: [source] }])
    );
    expect(changes).toMatchObject([
      { kind: 'changed', details: ['Sourced enrichment'], sources: [source] },
    ]);
  });
  it('does not collapse parallel logical edges into one asserted match', () => {
    const a = snapshot([node('one'), node('two', '192.0.2.2')]);
    const edge = {
      id: 'edge',
      kind: 'manual' as const,
      source: 'one',
      target: 'two',
      label: 'logical',
      notes: '',
      firstSeen: time,
      lastSeen: time,
      traceOrder: null,
      provenance: [],
    };
    const changes = compareNetworkSnapshots(
      { ...a, edges: [edge] },
      { ...a, edges: [edge, { ...edge, id: 'other' }] }
    );
    expect(changes).toMatchObject([{ kind: 'ambiguous', entity: 'edge' }]);
  });
});

import { describe, expect, it } from 'vitest';

import type { NetworkSnapshot, NetworkWorkspaceV1 } from './network-model';
import {
  appendNetworkObservation,
  createWorkspaceFromSnapshot,
  restoreNetworkSnapshot,
} from './network-workspace';

const firstAt = '2026-08-21T10:00:00.000Z';
const secondAt = '2026-08-21T10:05:00.000Z';

function snapshot(id: string, observedAt: string, address: string): NetworkSnapshot {
  const provenance = [
    {
      kind: 'observed' as const,
      source: 'protopeek-probe' as const,
      observedAt,
      detail: 'Selected TCP endpoint replied.',
    },
  ];
  return {
    id,
    label: `Quick scan · ${address}/32`,
    tags: ['local-network'],
    notes: '',
    observedAt,
    nodes: [
      {
        id: `host:${address}`,
        label: address,
        tags: [],
        notes: '',
        deviceType: '',
        firstSeen: observedAt,
        lastSeen: observedAt,
        identities: [{ kind: 'ipv4', value: address, provenance }],
        ports: [],
        groupIds: [],
        position: { x: 0, y: 0, pinned: false },
        provenance,
      },
    ],
    edges: [],
    groups: [],
    provenance,
  };
}

describe('network workspace observations', () => {
  it('creates a current topology plus an immutable snapshot', () => {
    const saved = createWorkspaceFromSnapshot(snapshot('scan-one', firstAt, '192.168.1.10'));

    expect(saved.id).toBe('workspace-scan-one');
    expect(saved.nodes[0]?.label).toBe('192.168.1.10');
    expect(saved.snapshots).toHaveLength(1);
    expect(saved.snapshots[0]?.nodes).not.toBe(saved.nodes);
  });

  it('appends history without mutating old evidence or silently evicting it', () => {
    const first = createWorkspaceFromSnapshot(snapshot('scan-one', firstAt, '192.168.1.10'));
    const second = createWorkspaceFromSnapshot(snapshot('scan-two', secondAt, '192.168.1.11'));
    const merged = appendNetworkObservation(first, second);

    expect(merged.nodes[0]?.label).toBe('192.168.1.11');
    expect(merged.snapshots.map(({ id }) => id)).toEqual(['scan-one', 'scan-two']);
    expect(first.snapshots).toHaveLength(1);
    expect(first.nodes[0]?.label).toBe('192.168.1.10');
  });

  it('refreshes matched observations by stable identity without erasing manual annotations', () => {
    const first = createWorkspaceFromSnapshot(snapshot('scan-one', firstAt, '192.168.1.10'));
    const firstNode = first.nodes[0];
    if (!firstNode) throw new Error('Expected the first observed node.');
    const manual = {
      kind: 'manual' as const,
      source: 'manual' as const,
      observedAt: firstAt,
      detail: 'Named, tagged, grouped, and positioned by the operator.',
    };
    const oldService = {
      name: 'Old service',
      product: '',
      version: '',
      transport: 'HTTP',
      provenance: firstNode.provenance,
    };
    const manualService = {
      name: 'Printer admin',
      product: 'Operator annotation',
      version: '',
      transport: 'HTTP',
      provenance: [manual],
    };
    const current: NetworkWorkspaceV1 = {
      ...first,
      nodes: [
        {
          ...firstNode,
          label: 'Kitchen printer',
          tags: ['printer', 'upstairs'],
          notes: 'Do not move this device.',
          deviceType: 'printer',
          identities: [
            ...firstNode.identities,
            { kind: 'hostname', value: 'printer.lan', provenance: [manual] },
          ],
          groupIds: ['site-home'],
          position: { x: 480, y: -120, pinned: true },
          ports: [
            {
              number: 80,
              protocol: 'tcp',
              state: 'open',
              services: [oldService, manualService],
              provenance: firstNode.provenance,
            },
          ],
          provenance: [...firstNode.provenance, manual],
        },
      ],
      groups: [
        {
          id: 'site-home',
          kind: 'site',
          name: 'Home',
          tags: [],
          notes: '',
          regionCode: '',
          siteCode: 'home',
          vlanId: null,
          cidr: '',
          position: { x: 20, y: 20, pinned: true },
          provenance: [manual],
        },
      ],
    };
    const nextBase = createWorkspaceFromSnapshot(snapshot('scan-two', secondAt, '192.168.1.10'));
    const nextNode = nextBase.nodes[0];
    if (!nextNode) throw new Error('Expected the next observed node.');
    const next: NetworkWorkspaceV1 = {
      ...nextBase,
      nodes: [
        {
          ...nextNode,
          id: 'new-probe-node-id',
          ports: [
            {
              number: 80,
              protocol: 'tcp',
              state: 'open',
              services: [
                {
                  name: 'Current service',
                  product: 'Caddy',
                  version: '',
                  transport: 'HTTP/2',
                  provenance: nextNode.provenance,
                },
              ],
              provenance: nextNode.provenance,
            },
          ],
        },
      ],
    };
    const currentBefore = JSON.stringify(current);
    const nextBefore = JSON.stringify(next);
    const incomingSnapshotBefore = JSON.stringify(next.snapshots[0]);

    const merged = appendNetworkObservation(current, next);

    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]).toMatchObject({
      id: firstNode.id,
      label: 'Kitchen printer',
      tags: ['printer', 'upstairs'],
      notes: 'Do not move this device.',
      deviceType: 'printer',
      firstSeen: firstAt,
      lastSeen: secondAt,
      groupIds: ['site-home'],
      position: { x: 480, y: -120, pinned: true },
    });
    expect(merged.nodes[0]?.ports[0]?.services.map(({ name }) => name)).toEqual([
      'Current service',
      'Printer admin',
    ]);
    expect(merged.nodes[0]?.provenance).toContainEqual(manual);
    expect(merged.nodes[0]?.identities).toContainEqual({
      kind: 'hostname',
      value: 'printer.lan',
      provenance: [manual],
    });
    expect(merged.groups.map(({ id }) => id)).toContain('site-home');
    expect(JSON.stringify(merged.snapshots.at(-1))).toBe(incomingSnapshotBefore);
    expect(JSON.stringify(current)).toBe(currentBefore);
    expect(JSON.stringify(next)).toBe(nextBefore);
  });

  it('detects field-level edits against immutable history when the editor has no manual provenance', () => {
    const first = createWorkspaceFromSnapshot(snapshot('scan-one', firstAt, '192.168.1.10'));
    const firstNode = first.nodes[0];
    if (!firstNode) throw new Error('Expected the first observed node.');
    const current: NetworkWorkspaceV1 = {
      ...first,
      nodes: [
        {
          ...firstNode,
          label: 'Operator label',
          notes: 'Operator note',
        },
      ],
    };
    const secondSnapshot = snapshot('scan-two', secondAt, '192.168.1.10');
    const secondNode = secondSnapshot.nodes[0];
    if (!secondNode) throw new Error('Expected the second observed node.');
    const next = createWorkspaceFromSnapshot({
      ...secondSnapshot,
      nodes: [
        {
          ...secondNode,
          label: 'Scanner label',
          tags: ['scanner-tag'],
          notes: 'Scanner note',
          deviceType: 'printer',
        },
      ],
    });

    const merged = appendNetworkObservation(current, next);

    expect(merged.nodes[0]).toMatchObject({
      label: 'Operator label',
      tags: ['scanner-tag'],
      notes: 'Operator note',
      deviceType: 'printer',
    });
  });

  it('does not let a manual label freeze unrelated observation-derived fields', () => {
    const first = createWorkspaceFromSnapshot(snapshot('scan-one', firstAt, '192.168.1.10'));
    const firstNode = first.nodes[0];
    if (!firstNode) throw new Error('Expected the first observed node.');
    const manual = {
      kind: 'manual' as const,
      source: 'manual' as const,
      observedAt: firstAt,
      detail: 'User-edited host label.',
    };
    const current: NetworkWorkspaceV1 = {
      ...first,
      nodes: [
        {
          ...firstNode,
          label: 'Operator label',
          provenance: [...firstNode.provenance, manual],
        },
      ],
    };
    const secondSnapshot = snapshot('scan-two', secondAt, '192.168.1.10');
    const secondNode = secondSnapshot.nodes[0];
    if (!secondNode) throw new Error('Expected the second observed node.');
    const next = createWorkspaceFromSnapshot({
      ...secondSnapshot,
      nodes: [
        {
          ...secondNode,
          label: 'Scanner label',
          tags: ['scanner-tag'],
          deviceType: 'printer',
        },
      ],
    });

    const merged = appendNetworkObservation(current, next);

    expect(merged.nodes[0]).toMatchObject({
      label: 'Operator label',
      tags: ['scanner-tag'],
      deviceType: 'printer',
    });
    expect(merged.nodes[0]?.provenance).toContainEqual(manual);
  });

  it('retains label and tags authored in an immutable manual observation', () => {
    const firstSnapshot = snapshot('scan-one', firstAt, '192.168.1.10');
    const firstNode = firstSnapshot.nodes[0];
    if (!firstNode) throw new Error('Expected the first observed node.');
    const manual = {
      kind: 'manual' as const,
      source: 'manual' as const,
      observedAt: firstAt,
      detail: 'User-edited host label or tags.',
    };
    const current = createWorkspaceFromSnapshot({
      ...firstSnapshot,
      nodes: [
        {
          ...firstNode,
          label: 'Saved operator label',
          tags: ['saved-tag'],
          provenance: [...firstNode.provenance, manual],
        },
      ],
    });
    const secondSnapshot = snapshot('scan-two', secondAt, '192.168.1.10');
    const secondNode = secondSnapshot.nodes[0];
    if (!secondNode) throw new Error('Expected the second observed node.');
    const next = createWorkspaceFromSnapshot({
      ...secondSnapshot,
      nodes: [{ ...secondNode, deviceType: 'printer' }],
    });

    const merged = appendNetworkObservation(current, next);

    expect(merged.nodes[0]).toMatchObject({
      label: 'Saved operator label',
      tags: ['saved-tag'],
      deviceType: 'printer',
    });
  });

  it('matches a stable node id before identity overlap when observed identity changes', () => {
    const first = createWorkspaceFromSnapshot(snapshot('scan-one', firstAt, '192.168.1.10'));
    const firstNode = first.nodes[0];
    if (!firstNode) throw new Error('Expected the first observed node.');
    const secondSnapshot = snapshot('scan-two', secondAt, '192.168.1.11');
    const secondNode = secondSnapshot.nodes[0];
    if (!secondNode) throw new Error('Expected the second observed node.');
    const next = createWorkspaceFromSnapshot({
      ...secondSnapshot,
      nodes: [{ ...secondNode, id: firstNode.id }],
    });

    const merged = appendNetworkObservation(first, next);

    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]).toMatchObject({ id: firstNode.id, lastSeen: secondAt });
    expect(merged.nodes[0]?.identities).toEqual(next.nodes[0]?.identities);
  });

  it('keeps unseen inventory with its old last-seen time and retains only manual old relationships', () => {
    const first = createWorkspaceFromSnapshot(snapshot('scan-one', firstAt, '192.168.1.10'));
    const observedNode = first.nodes[0];
    if (!observedNode) throw new Error('Expected an observed node.');
    const manual = {
      kind: 'manual' as const,
      source: 'manual' as const,
      observedAt: firstAt,
      detail: 'Created by the operator.',
    };
    const manualNode = {
      id: 'manual:console',
      label: 'Console host',
      tags: ['manual'],
      notes: '',
      deviceType: 'workstation',
      firstSeen: firstAt,
      lastSeen: firstAt,
      identities: [{ kind: 'other' as const, value: 'console-host', provenance: [manual] }],
      ports: [],
      groupIds: ['site-home'],
      position: { x: 320, y: 40, pinned: true },
      provenance: [manual],
    };
    const current: NetworkWorkspaceV1 = {
      ...first,
      nodes: [observedNode, manualNode],
      edges: [
        {
          id: 'operator-link',
          kind: 'manual',
          source: observedNode.id,
          target: manualNode.id,
          label: 'Operator grouping',
          notes: 'Not a physical-link claim.',
          firstSeen: firstAt,
          lastSeen: firstAt,
          traceOrder: null,
          provenance: [manual],
        },
        {
          id: 'old-observed-link',
          kind: 'observed',
          source: observedNode.id,
          target: manualNode.id,
          label: 'Old observation',
          notes: '',
          firstSeen: firstAt,
          lastSeen: firstAt,
          traceOrder: null,
          provenance: observedNode.provenance,
        },
      ],
      groups: [
        {
          id: 'site-home',
          kind: 'site',
          name: 'Home',
          tags: [],
          notes: '',
          regionCode: '',
          siteCode: 'home',
          vlanId: null,
          cidr: '',
          position: { x: 0, y: 0, pinned: true },
          provenance: [manual],
        },
      ],
    };
    const next = createWorkspaceFromSnapshot(snapshot('scan-two', secondAt, '192.168.1.11'));

    const merged = appendNetworkObservation(current, next);

    expect(merged.nodes.map(({ id }) => id)).toEqual([
      'host:192.168.1.11',
      'host:192.168.1.10',
      'manual:console',
    ]);
    expect(merged.nodes.find(({ id }) => id === observedNode.id)?.lastSeen).toBe(firstAt);
    expect(merged.nodes.find(({ id }) => id === manualNode.id)).toEqual(manualNode);
    expect(merged.edges.map(({ id }) => id)).toEqual(['operator-link']);
    expect(merged.groups.map(({ id }) => id)).toEqual(['site-home']);
    expect(merged.snapshots.map(({ id }) => id)).toEqual(['scan-one', 'scan-two']);
  });

  it('restores one historical snapshot as current while keeping the full timeline', () => {
    const first = createWorkspaceFromSnapshot(snapshot('scan-one', firstAt, '192.168.1.10'));
    const second = createWorkspaceFromSnapshot(snapshot('scan-two', secondAt, '192.168.1.11'));
    const merged = appendNetworkObservation(first, second);
    const restored = restoreNetworkSnapshot(merged, 'scan-one', '2026-08-21T10:06:00.000Z');

    expect(restored.nodes[0]?.label).toBe('192.168.1.10');
    expect(restored.snapshots).toHaveLength(2);
    expect(restored.updatedAt).toBe('2026-08-21T10:06:00.000Z');
  });

  it('rejects duplicate or over-capacity history rather than deleting older snapshots', () => {
    const first = createWorkspaceFromSnapshot(snapshot('scan-one', firstAt, '192.168.1.10'));
    expect(() => appendNetworkObservation(first, first)).toThrow(/already exists/i);

    const baseSnapshot = first.snapshots[0];
    if (!baseSnapshot) throw new Error('Expected the fixture snapshot.');
    const full: NetworkWorkspaceV1 = {
      ...first,
      snapshots: Array.from({ length: 64 }, (_, index) => ({
        ...baseSnapshot,
        id: `scan-${index}`,
      })),
    };
    expect(() => appendNetworkObservation(full, first)).toThrow(/64-snapshot limit/i);
  });
});

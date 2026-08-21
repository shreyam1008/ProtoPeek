import { describe, expect, it } from 'vitest';

import type { NetworkGroup, NetworkNode } from './network-model';
import {
  arrangeTopology,
  fitTopologyTransform,
  screenToWorld,
  topologyBounds,
  topologyGroupRects,
  zoomTopologyAt,
} from './topology-layout';

const baseNode: NetworkNode = {
  id: 'node',
  label: 'Node',
  tags: [],
  notes: '',
  deviceType: 'host',
  firstSeen: '2026-08-21T12:00:00.000Z',
  lastSeen: '2026-08-21T12:00:00.000Z',
  identities: [],
  ports: [],
  groupIds: [],
  position: { x: 0, y: 0, pinned: false },
  provenance: [],
};

const group: NetworkGroup = {
  id: 'subnet-a',
  kind: 'subnet',
  name: 'Services subnet',
  tags: [],
  notes: '',
  regionCode: '',
  siteCode: '',
  vlanId: null,
  cidr: '192.168.20.0/24',
  position: { x: 0, y: 0, pinned: false },
  provenance: [],
};

describe('topology geometry', () => {
  it('arranges deterministically by group and preserves pinned positions', () => {
    const nodes: NetworkNode[] = [
      { ...baseNode, id: 'z', label: 'Zulu', groupIds: ['subnet-a'] },
      { ...baseNode, id: 'a', label: 'Alpha', groupIds: ['subnet-a'] },
      { ...baseNode, id: 'free', label: 'Free' },
      {
        ...baseNode,
        id: 'pinned',
        label: 'Pinned',
        position: { x: 777, y: -44, pinned: true },
      },
    ];
    const first = arrangeTopology(nodes, [group]);
    const second = arrangeTopology([...nodes].reverse(), [group]);

    expect(first.nodes.find((node) => node.id === 'pinned')?.position).toEqual({
      x: 777,
      y: -44,
      pinned: true,
    });
    expect(Object.fromEntries(first.nodes.map((node) => [node.id, node.position]))).toEqual(
      Object.fromEntries(second.nodes.map((node) => [node.id, node.position]))
    );
    expect(first.nodes.find((node) => node.id === 'a')?.position.x).toBeLessThan(
      first.nodes.find((node) => node.id === 'z')?.position.x ?? 0
    );
    expect(first.groups[0]?.position).toEqual({ x: 0, y: 0, pinned: false });

    const rect = topologyGroupRects(first.nodes, first.groups).get('subnet-a');
    for (const node of first.nodes.filter((candidate) => candidate.groupIds.includes('subnet-a'))) {
      expect(node.position.x).toBeGreaterThanOrEqual(rect?.x ?? Number.POSITIVE_INFINITY);
      expect(node.position.y).toBeGreaterThanOrEqual(rect?.y ?? Number.POSITIVE_INFINITY);
      expect(node.position.x + 180).toBeLessThanOrEqual((rect?.x ?? 0) + (rect?.width ?? 0));
      expect(node.position.y + 76).toBeLessThanOrEqual((rect?.y ?? 0) + (rect?.height ?? 0));
    }
  });

  it('includes rendered node and group extents in fit bounds', () => {
    const bounds = topologyBounds([
      { ...baseNode, position: { x: -200, y: -100, pinned: false } },
      { ...baseNode, id: 'two', position: { x: 600, y: 300, pinned: false } },
    ]);
    expect(bounds).toEqual({ minX: -200, minY: -100, maxX: 780, maxY: 376 });
    expect(
      topologyBounds([], [{ ...group, position: { x: -300, y: -200, pinned: false } }])
    ).toEqual({ minX: -300, minY: -200, maxX: 100, maxY: 40 });
  });

  it('fits bounds and keeps the same world point beneath focal zoom', () => {
    expect(
      fitTopologyTransform(
        { minX: -200, minY: -100, maxX: 600, maxY: 300 },
        { width: 1000, height: 600 },
        80
      )
    ).toEqual({
      x: 300,
      y: 200,
      scale: 1,
    });

    const before = { x: 40, y: 70, scale: 1 };
    const focal = { x: 320, y: 240 };
    const world = screenToWorld(focal, before);
    const after = zoomTopologyAt(before, focal, 1.75);
    expect(screenToWorld(focal, after)).toEqual(world);
  });

  it('clamps zoom and survives empty topologies', () => {
    expect(topologyBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(zoomTopologyAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 99).scale).toBe(2.5);
    expect(zoomTopologyAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 0).scale).toBe(0.25);
  });
});

import type { NetworkGroup, NetworkNode } from './network-model';

export type TopologyPoint = { x: number; y: number };
export type TopologyViewport = { width: number; height: number };
export type TopologyTransform = { x: number; y: number; scale: number };
export type TopologyBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type TopologyRect = { x: number; y: number; width: number; height: number };
export type ArrangedTopology = { nodes: NetworkNode[]; groups: NetworkGroup[] };

export const topologyScaleLimits = { minimum: 0.25, maximum: 2.5 } as const;
export const topologyNodeSize = { width: 180, height: 76 } as const;
export const topologyGroupMinimumSize = { width: 400, height: 240 } as const;

const groupPadding = 24;
const groupHeaderHeight = 52;
const nodeColumnGap = 24;
const nodeRowGap = 24;
const groupGap = 80;
const maximumNodeColumns = 3;

const groupKindOrder: Record<NetworkGroup['kind'], number> = {
  region: 0,
  site: 1,
  vlan: 2,
  subnet: 3,
  custom: 4,
};

function orderedTopologyGroups(groups: readonly NetworkGroup[]) {
  return [...groups].sort(
    (left, right) =>
      groupKindOrder[left.kind] - groupKindOrder[right.kind] || left.id.localeCompare(right.id)
  );
}

function groupLayoutSize(nodeCount: number) {
  const columns = Math.max(1, Math.min(maximumNodeColumns, nodeCount));
  const rows = Math.max(1, Math.ceil(nodeCount / columns));
  return {
    columns,
    width: Math.max(
      topologyGroupMinimumSize.width,
      groupPadding * 2 + columns * topologyNodeSize.width + (columns - 1) * nodeColumnGap
    ),
    height: Math.max(
      topologyGroupMinimumSize.height,
      groupHeaderHeight + groupPadding + rows * topologyNodeSize.height + (rows - 1) * nodeRowGap
    ),
  };
}

function primaryGroupID(node: NetworkNode, groupOrder: ReadonlyMap<string, number>) {
  return node.groupIds
    .filter((id) => groupOrder.has(id))
    .sort((left, right) => (groupOrder.get(left) ?? 0) - (groupOrder.get(right) ?? 0))[0];
}

/**
 * Arrange unpinned nodes inside deterministic group lanes. Group positions move
 * with their primary members; pinned nodes and pinned group origins remain
 * untouched. Secondary group memberships are represented by overlapping hulls.
 */
export function arrangeTopology(
  nodes: readonly NetworkNode[],
  groups: readonly NetworkGroup[]
): ArrangedTopology {
  const orderedGroups = orderedTopologyGroups(groups);
  const groupOrder = new Map(orderedGroups.map((group, index) => [group.id, index]));
  const groupedNodes = new Map<string, NetworkNode[]>();
  const ungroupedNodes: NetworkNode[] = [];

  for (const node of nodes) {
    const groupID = primaryGroupID(node, groupOrder);
    if (!groupID) {
      ungroupedNodes.push(node);
      continue;
    }
    const members = groupedNodes.get(groupID) ?? [];
    members.push(node);
    groupedNodes.set(groupID, members);
  }

  const groupPositions = new Map<string, TopologyPoint>();
  const groupSizes = new Map<string, ReturnType<typeof groupLayoutSize>>();
  let cursorX = 0;
  for (const group of orderedGroups) {
    const members = groupedNodes.get(group.id) ?? [];
    const size = groupLayoutSize(members.length);
    const position = group.position.pinned ? group.position : { x: cursorX, y: 0 };
    groupPositions.set(group.id, position);
    groupSizes.set(group.id, size);
    cursorX = Math.max(cursorX, position.x + size.width + groupGap);
  }

  const positions = new Map<string, TopologyPoint>();
  for (const group of orderedGroups) {
    const position = groupPositions.get(group.id);
    const size = groupSizes.get(group.id);
    if (!position || !size) continue;
    const members = [...(groupedNodes.get(group.id) ?? [])].sort(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
    );
    let arrangedIndex = 0;
    for (const node of members) {
      if (node.position.pinned) continue;
      positions.set(node.id, {
        x:
          position.x +
          groupPadding +
          (arrangedIndex % size.columns) * (topologyNodeSize.width + nodeColumnGap),
        y:
          position.y +
          groupHeaderHeight +
          Math.floor(arrangedIndex / size.columns) * (topologyNodeSize.height + nodeRowGap),
      });
      arrangedIndex++;
    }
  }

  const orderedUngrouped = [...ungroupedNodes].sort(
    (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
  );
  let ungroupedIndex = 0;
  for (const node of orderedUngrouped) {
    if (node.position.pinned) continue;
    positions.set(node.id, {
      x: cursorX + (ungroupedIndex % maximumNodeColumns) * (topologyNodeSize.width + nodeColumnGap),
      y: Math.floor(ungroupedIndex / maximumNodeColumns) * (topologyNodeSize.height + nodeRowGap),
    });
    ungroupedIndex++;
  }

  return {
    nodes: nodes.map((node) => {
      const position = positions.get(node.id);
      return position
        ? { ...node, position: { x: position.x, y: position.y, pinned: false } }
        : node;
    }),
    groups: groups.map((group) => {
      const position = groupPositions.get(group.id);
      return position && !group.position.pinned
        ? { ...group, position: { x: position.x, y: position.y, pinned: false } }
        : group;
    }),
  };
}

/** Return rendered group hulls, expanding them to contain every member node. */
export function topologyGroupRects(
  nodes: readonly Pick<NetworkNode, 'groupIds' | 'position'>[],
  groups: readonly Pick<NetworkGroup, 'id' | 'position'>[]
) {
  const membersByGroup = new Map<string, Array<Pick<NetworkNode, 'groupIds' | 'position'>>>();
  for (const node of nodes) {
    for (const groupID of node.groupIds) {
      const members = membersByGroup.get(groupID) ?? [];
      members.push(node);
      membersByGroup.set(groupID, members);
    }
  }

  return new Map(
    groups.map((group) => {
      const members = membersByGroup.get(group.id) ?? [];
      let minX = group.position.x;
      let minY = group.position.y;
      let maxX = group.position.x + topologyGroupMinimumSize.width;
      let maxY = group.position.y + topologyGroupMinimumSize.height;
      for (const member of members) {
        minX = Math.min(minX, member.position.x - groupPadding);
        minY = Math.min(minY, member.position.y - groupHeaderHeight);
        maxX = Math.max(maxX, member.position.x + topologyNodeSize.width + groupPadding);
        maxY = Math.max(maxY, member.position.y + topologyNodeSize.height + groupPadding);
      }
      return [
        group.id,
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY } satisfies TopologyRect,
      ];
    })
  );
}

export function topologyBounds(
  nodes: readonly Pick<NetworkNode, 'groupIds' | 'position'>[],
  groups: readonly Pick<NetworkGroup, 'id' | 'position'>[] = []
): TopologyBounds {
  const rects: TopologyRect[] = nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: topologyNodeSize.width,
    height: topologyNodeSize.height,
  }));
  rects.push(...topologyGroupRects(nodes, groups).values());
  if (!rects.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return rects.reduce<TopologyBounds>(
    (bounds, rect) => ({
      minX: Math.min(bounds.minX, rect.x),
      minY: Math.min(bounds.minY, rect.y),
      maxX: Math.max(bounds.maxX, rect.x + rect.width),
      maxY: Math.max(bounds.maxY, rect.y + rect.height),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  );
}

export function fitTopologyTransform(
  bounds: TopologyBounds,
  viewport: TopologyViewport,
  padding = 64
): TopologyTransform {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const scale = Math.min(
    1,
    Math.max(
      topologyScaleLimits.minimum,
      Math.min(availableWidth / width, availableHeight / height)
    )
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
    scale,
  };
}

export function screenToWorld(point: TopologyPoint, transform: TopologyTransform): TopologyPoint {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  };
}

export function zoomTopologyAt(
  transform: TopologyTransform,
  focalPoint: TopologyPoint,
  requestedScale: number
): TopologyTransform {
  const scale = Math.min(
    topologyScaleLimits.maximum,
    Math.max(topologyScaleLimits.minimum, requestedScale)
  );
  const world = screenToWorld(focalPoint, transform);
  return {
    x: focalPoint.x - world.x * scale,
    y: focalPoint.y - world.y * scale,
    scale,
  };
}

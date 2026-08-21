import { Focus, LayoutGrid, List, Map as MapIcon, Minus, Pin, Plus } from 'lucide-react';
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { classNames } from '@/shared/runtime';

import type { NetworkEdge, NetworkGroup, NetworkNode, NetworkWorkspaceV1 } from './network-model';
import {
  arrangeTopology,
  fitTopologyTransform,
  type TopologyTransform,
  topologyBounds,
  topologyGroupRects,
  topologyNodeSize,
  zoomTopologyAt,
} from './topology-layout';

type TopologyView = 'map' | 'list';

const defaultTransform: TopologyTransform = { x: 120, y: 100, scale: 1 };
const inventoryPageSize = 100;

export const interactiveTopologyLimits = {
  maxNodes: 160,
  maxEdges: 640,
  maxGroups: 64,
} as const;

export function TopologyCanvas({
  workspace,
  onChange,
}: {
  workspace: NetworkWorkspaceV1;
  onChange: (workspace: NetworkWorkspaceV1) => void;
}) {
  const interactiveMapAvailable =
    workspace.nodes.length <= interactiveTopologyLimits.maxNodes &&
    workspace.edges.length <= interactiveTopologyLimits.maxEdges &&
    workspace.groups.length <= interactiveTopologyLimits.maxGroups;
  const [view, setView] = useState<TopologyView>(() =>
    !interactiveMapAvailable ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 760px)').matches)
      ? 'list'
      : 'map'
  );
  const [selectedID, setSelectedID] = useState('');
  const [transform, setTransform] = useState(defaultTransform);
  const [dragPreview, setDragPreview] = useState<{
    nodeID: string;
    x: number;
    y: number;
  } | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const fittedWorkspaceRef = useRef('');
  const focusInspectorRef = useRef(false);
  const inspectorID = useId();
  const panRef = useRef<{
    pointerID: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const nodeDragRef = useRef<{
    pointerID: number;
    nodeID: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressNodeClickRef = useRef(false);
  const activeView = interactiveMapAvailable ? view : 'list';
  const selected = useMemo(
    () => workspace.nodes.find((node) => node.id === selectedID) ?? null,
    [selectedID, workspace.nodes]
  );
  const displayNodes = useMemo(
    () =>
      activeView === 'map'
        ? workspace.nodes.map((node) =>
            dragPreview?.nodeID === node.id
              ? { ...node, position: { ...node.position, x: dragPreview.x, y: dragPreview.y } }
              : node
          )
        : [],
    [activeView, dragPreview, workspace.nodes]
  );
  const positions = useMemo(
    () => new Map(displayNodes.map((node) => [node.id, node.position])),
    [displayNodes]
  );
  const groupRects = useMemo(
    () => topologyGroupRects(displayNodes, workspace.groups),
    [displayNodes, workspace.groups]
  );
  const selectNode = useCallback((node: NetworkNode) => {
    focusInspectorRef.current = true;
    setSelectedID(node.id);
  }, []);

  useEffect(() => {
    if (!focusInspectorRef.current || activeView !== 'list' || !selected) return;
    focusInspectorRef.current = false;
    inspectorRef.current?.focus();
  }, [activeView, selected]);

  useEffect(() => {
    if (
      activeView !== 'map' ||
      fittedWorkspaceRef.current === workspace.id ||
      (workspace.nodes.length === 0 && workspace.groups.length === 0)
    ) {
      return;
    }
    const rect = surfaceRef.current?.getBoundingClientRect();
    setTransform(
      fitTopologyTransform(
        topologyBounds(workspace.nodes, workspace.groups),
        { width: rect?.width || 900, height: rect?.height || 600 },
        72
      )
    );
    fittedWorkspaceRef.current = workspace.id;
  }, [activeView, workspace.groups, workspace.id, workspace.nodes]);

  function updateNode(nodeID: string, change: Partial<NetworkNode>) {
    onChange({
      ...workspace,
      updatedAt: new Date().toISOString(),
      nodes: workspace.nodes.map((node) => (node.id === nodeID ? { ...node, ...change } : node)),
      // Snapshots are historical deep copies and deliberately remain untouched.
      snapshots: workspace.snapshots,
    });
  }

  function fitMap() {
    const rect = surfaceRef.current?.getBoundingClientRect();
    setTransform(
      fitTopologyTransform(
        topologyBounds(workspace.nodes, workspace.groups),
        { width: rect?.width || 900, height: rect?.height || 600 },
        96
      )
    );
  }

  function zoom(factor: number) {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const focal = { x: (rect?.width || 900) / 2, y: (rect?.height || 600) / 2 };
    setTransform((current) => zoomTopologyAt(current, focal, current.scale * factor));
  }

  function arrange() {
    const arranged = arrangeTopology(workspace.nodes, workspace.groups);
    onChange({
      ...workspace,
      updatedAt: new Date().toISOString(),
      nodes: arranged.nodes,
      groups: arranged.groups,
      snapshots: workspace.snapshots,
    });
  }

  return (
    <section className="pp-topology-workspace" aria-label="Saved network topology">
      <header className="pp-topology-toolbar">
        <fieldset className="pp-map-view-toggle">
          <legend className="sr-only">Topology view</legend>
          <button
            type="button"
            aria-label="Map view"
            aria-pressed={activeView === 'map'}
            aria-describedby={!interactiveMapAvailable ? 'pp-topology-map-limit' : undefined}
            disabled={!interactiveMapAvailable}
            onClick={() => setView('map')}
          >
            <MapIcon aria-hidden="true" /> Map
          </button>
          <button
            type="button"
            aria-label="List view"
            aria-pressed={activeView === 'list'}
            onClick={() => setView('list')}
          >
            <List aria-hidden="true" /> List
          </button>
        </fieldset>
        {activeView === 'map' ? (
          <div className="pp-map-tools">
            <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)}>
              <Minus aria-hidden="true" />
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>
              <Plus aria-hidden="true" />
            </button>
            <button type="button" aria-label="Fit map" onClick={fitMap}>
              <Focus aria-hidden="true" /> Fit
            </button>
            <button type="button" aria-label="Arrange nodes" onClick={arrange}>
              <LayoutGrid aria-hidden="true" /> Arrange
            </button>
          </div>
        ) : null}
        <p>
          {activeView === 'map'
            ? 'Logical evidence map · Ctrl/⌘ + wheel zooms · lines are not physical cable claims'
            : 'Accessible node, group, and logical relationship inventory'}
        </p>
      </header>

      {!interactiveMapAvailable ? (
        <p id="pp-topology-map-limit" className="pp-topology-limit-notice" role="status">
          Interactive map disabled for this {workspace.nodes.length.toLocaleString()}-node,{' '}
          {workspace.edges.length.toLocaleString()}-relationship,{' '}
          {workspace.groups.length.toLocaleString()}-group workspace to keep ProtoPeek responsive.
          The paged inventory below preserves every record.
        </p>
      ) : null}

      {!workspace.nodes.length && !workspace.groups.length ? (
        <div className="pp-topology-empty">
          <MapIcon aria-hidden="true" />
          <p>
            No saved nodes yet. Scan a local network, save a path trace, or import a network file.
          </p>
        </div>
      ) : activeView === 'map' ? (
        <div className="pp-topology-layout">
          <section
            ref={surfaceRef}
            className="pp-topology-surface"
            aria-label="Network topology map"
            aria-describedby="pp-topology-map-description"
            onWheel={(event) => {
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const focal = { x: event.clientX - rect.left, y: event.clientY - rect.top };
              setTransform((current) =>
                zoomTopologyAt(current, focal, current.scale * (event.deltaY > 0 ? 0.9 : 1.1))
              );
            }}
            onPointerDown={(event) => {
              const target = event.target as Element;
              if (
                event.button !== 0 ||
                target.closest('button, input, select, textarea, [data-topology-interactive]')
              ) {
                return;
              }
              panRef.current = {
                pointerID: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                originX: transform.x,
                originY: transform.y,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              const pan = panRef.current;
              if (!pan || pan.pointerID !== event.pointerId) return;
              setTransform((current) => ({
                ...current,
                x: pan.originX + event.clientX - pan.startX,
                y: pan.originY + event.clientY - pan.startY,
              }));
            }}
            onPointerUp={(event) => {
              if (panRef.current?.pointerID === event.pointerId) panRef.current = null;
            }}
            onPointerCancel={() => {
              panRef.current = null;
            }}
          >
            <p id="pp-topology-map-description" className="sr-only">
              Logical map. Open List view for complete keyboard-accessible node, group, and
              relationship tables.
            </p>
            <div
              className="pp-topology-world"
              style={{
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              }}
            >
              <svg className="pp-topology-edges" aria-hidden="true">
                <defs>
                  <marker
                    id="pp-map-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" />
                  </marker>
                </defs>
                {workspace.edges.map((edge) => {
                  const source = positions.get(edge.source);
                  const target = positions.get(edge.target);
                  if (!source || !target) return null;
                  return (
                    <line
                      key={edge.id}
                      className={`is-${edge.kind}`}
                      x1={source.x + topologyNodeSize.width / 2}
                      y1={source.y + topologyNodeSize.height / 2}
                      x2={target.x + topologyNodeSize.width / 2}
                      y2={target.y + topologyNodeSize.height / 2}
                      markerEnd="url(#pp-map-arrow)"
                    />
                  );
                })}
              </svg>
              {workspace.groups.map((group) => {
                const rect = groupRects.get(group.id);
                if (!rect) return null;
                return (
                  <div
                    key={group.id}
                    className={`pp-topology-group is-${group.kind}`}
                    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                  >
                    <span>{group.name || group.id}</span>
                    <small>
                      {group.kind}
                      {group.cidr ? ` · ${group.cidr}` : ''}
                    </small>
                  </div>
                );
              })}
              {workspace.nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={classNames(
                    'pp-topology-node',
                    `is-${primaryEvidence(node)}`,
                    node.id === selectedID && 'is-selected'
                  )}
                  style={{
                    left: dragPreview?.nodeID === node.id ? dragPreview.x : node.position.x,
                    top: dragPreview?.nodeID === node.id ? dragPreview.y : node.position.y,
                  }}
                  aria-label={`${node.label || node.id} · ${identityLabel(node)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (suppressNodeClickRef.current) {
                      suppressNodeClickRef.current = false;
                      return;
                    }
                    setSelectedID(node.id);
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    setSelectedID(node.id);
                    nodeDragRef.current = {
                      pointerID: event.pointerId,
                      nodeID: node.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      originX: node.position.x,
                      originY: node.position.y,
                      moved: false,
                    };
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const drag = nodeDragRef.current;
                    if (!drag || drag.pointerID !== event.pointerId || drag.nodeID !== node.id)
                      return;
                    const x = drag.originX + (event.clientX - drag.startX) / transform.scale;
                    const y = drag.originY + (event.clientY - drag.startY) / transform.scale;
                    if (Math.abs(x - drag.originX) > 2 || Math.abs(y - drag.originY) > 2) {
                      drag.moved = true;
                    }
                    setDragPreview({ nodeID: node.id, x, y });
                  }}
                  onPointerUp={(event) => {
                    const drag = nodeDragRef.current;
                    if (!drag || drag.pointerID !== event.pointerId || drag.nodeID !== node.id)
                      return;
                    if (drag.moved && dragPreview?.nodeID === node.id) {
                      suppressNodeClickRef.current = true;
                      updateNode(node.id, {
                        position: { x: dragPreview.x, y: dragPreview.y, pinned: true },
                      });
                    }
                    nodeDragRef.current = null;
                    setDragPreview(null);
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                  }}
                  onPointerCancel={() => {
                    nodeDragRef.current = null;
                    setDragPreview(null);
                  }}
                >
                  <span>{deviceGlyph(node.deviceType)}</span>
                  <strong>{node.label || node.id}</strong>
                  <code>{identityLabel(node)}</code>
                  <small>
                    {node.ports.length} port{node.ports.length === 1 ? '' : 's'} ·{' '}
                    {primaryEvidence(node)}
                  </small>
                </button>
              ))}
            </div>
          </section>
          {selected ? (
            <NodeInspector
              node={selected}
              groups={workspace.groups}
              onChange={(change) => updateNode(selected.id, change)}
            />
          ) : (
            <aside className="pp-node-inspector is-empty" aria-label="Selected network node">
              <p>Select a node to inspect identities, ports, and evidence provenance.</p>
            </aside>
          )}
        </div>
      ) : (
        <div className="pp-inventory-layout">
          <TopologyInventory
            workspace={workspace}
            onSelect={selectNode}
            inspectorID={inspectorID}
          />
          {selected ? (
            <NodeInspector
              id={inspectorID}
              inspectorRef={inspectorRef}
              node={selected}
              groups={workspace.groups}
              onChange={(change) => updateNode(selected.id, change)}
            />
          ) : (
            <aside
              ref={inspectorRef}
              id={inspectorID}
              className="pp-node-inspector is-empty"
              aria-label="Selected network node"
              tabIndex={-1}
            >
              <p>Select a node from the inventory to inspect and edit its evidence record.</p>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}

const TopologyInventory = memo(function TopologyInventory({
  workspace,
  onSelect,
  inspectorID,
}: {
  workspace: NetworkWorkspaceV1;
  onSelect: (node: NetworkNode) => void;
  inspectorID: string;
}) {
  return (
    <div className="pp-inventory-collections">
      <NodeInventoryTable workspace={workspace} onSelect={onSelect} inspectorID={inspectorID} />
      <GroupInventoryTable workspace={workspace} />
      <RelationshipInventoryTable workspace={workspace} />
    </div>
  );
});

function NodeInventoryTable({
  workspace,
  onSelect,
  inspectorID,
}: {
  workspace: NetworkWorkspaceV1;
  onSelect: (node: NetworkNode) => void;
  inspectorID: string;
}) {
  const page = useInventoryPage(workspace.nodes);
  const groupNames = new Map(
    workspace.groups.map((group) => [group.id, group.name || group.id] as const)
  );
  return (
    <section className="pp-inventory-section" aria-label="Nodes">
      <InventoryHeading label="Nodes" count={workspace.nodes.length} />
      <div className="pp-inventory-table-wrap">
        <table className="pp-inventory-table" aria-label="Network inventory">
          <thead>
            <tr>
              <th scope="col">Device / endpoint</th>
              <th scope="col">Identity</th>
              <th scope="col">Observed ports</th>
              <th scope="col">Groups</th>
              <th scope="col">Evidence</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {page.items.length ? (
              page.items.map((node) => (
                <tr key={node.id}>
                  <th scope="row">
                    <button
                      type="button"
                      aria-controls={inspectorID}
                      onClick={() => onSelect(node)}
                    >
                      {node.label || node.id}
                    </button>
                  </th>
                  <td>{identityLabel(node)}</td>
                  <td>
                    {node.ports.length
                      ? node.ports.map((port) => `${port.number}/${port.protocol}`).join(', ')
                      : 'None observed'}
                  </td>
                  <td>
                    {node.groupIds.map((id) => groupNames.get(id) ?? id).join(', ') || 'Ungrouped'}
                  </td>
                  <td>{primaryEvidence(node)}</td>
                  <td>{new Date(node.lastSeen).toLocaleString()}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>No nodes in this workspace.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <InventoryPager label="nodes" {...page} />
    </section>
  );
}

function GroupInventoryTable({ workspace }: { workspace: NetworkWorkspaceV1 }) {
  const page = useInventoryPage(workspace.groups);
  const memberCounts = new Map<string, number>();
  for (const node of workspace.nodes) {
    for (const groupID of node.groupIds) {
      memberCounts.set(groupID, (memberCounts.get(groupID) ?? 0) + 1);
    }
  }
  return (
    <section className="pp-inventory-section" aria-label="Organizational groups">
      <InventoryHeading label="Organizational groups" count={workspace.groups.length} />
      <div className="pp-inventory-table-wrap">
        <table className="pp-inventory-table" aria-label="Organizational group inventory">
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Kind</th>
              <th scope="col">Detail</th>
              <th scope="col">Members</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {page.items.length ? (
              page.items.map((group) => (
                <tr key={group.id}>
                  <th scope="row">{group.name || group.id}</th>
                  <td>{group.kind}</td>
                  <td>{groupDetail(group)}</td>
                  <td>{memberCounts.get(group.id) ?? 0}</td>
                  <td>{primaryEvidence(group)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>No organizational groups in this workspace.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <InventoryPager label="groups" {...page} />
    </section>
  );
}

function RelationshipInventoryTable({ workspace }: { workspace: NetworkWorkspaceV1 }) {
  const page = useInventoryPage(workspace.edges);
  const nodeNames = new Map(
    workspace.nodes.map((node) => [node.id, node.label || node.id] as const)
  );
  return (
    <section className="pp-inventory-section" aria-label="Logical relationships">
      <InventoryHeading label="Logical relationships" count={workspace.edges.length} />
      <p className="pp-inventory-caveat">
        These records express observed, trace-sequence, or manual logical relationships—not physical
        cabling.
      </p>
      <div className="pp-inventory-table-wrap">
        <table className="pp-inventory-table" aria-label="Logical relationship inventory">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Target</th>
              <th scope="col">Kind</th>
              <th scope="col">Label</th>
              <th scope="col">Evidence</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {page.items.length ? (
              page.items.map((edge) => (
                <RelationshipRow key={edge.id} edge={edge} nodeNames={nodeNames} />
              ))
            ) : (
              <tr>
                <td colSpan={6}>No logical relationships in this workspace.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <InventoryPager label="relationships" {...page} />
    </section>
  );
}

function RelationshipRow({
  edge,
  nodeNames,
}: {
  edge: NetworkEdge;
  nodeNames: ReadonlyMap<string, string>;
}) {
  return (
    <tr>
      <th scope="row">{nodeNames.get(edge.source) ?? edge.source}</th>
      <td>{nodeNames.get(edge.target) ?? edge.target}</td>
      <td>{edge.kind}</td>
      <td>{edge.label || 'Unlabelled relationship'}</td>
      <td>{primaryEvidence(edge)}</td>
      <td>{new Date(edge.lastSeen).toLocaleString()}</td>
    </tr>
  );
}

function InventoryHeading({ label, count }: { label: string; count: number }) {
  return (
    <header className="pp-inventory-heading">
      <h3>{label}</h3>
      <span>{count.toLocaleString()} records</span>
    </header>
  );
}

function useInventoryPage<T>(records: readonly T[]) {
  const [requestedPage, setRequestedPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(records.length / inventoryPageSize));
  const page = Math.min(requestedPage, pageCount - 1);
  const start = page * inventoryPageSize;
  return {
    items: records.slice(start, start + inventoryPageSize),
    page,
    pageCount,
    total: records.length,
    setPage: setRequestedPage,
  };
}

function InventoryPager({
  label,
  page,
  pageCount,
  total,
  setPage,
}: {
  label: string;
  page: number;
  pageCount: number;
  total: number;
  setPage: (page: number) => void;
}) {
  if (total <= inventoryPageSize) return null;
  const start = page * inventoryPageSize + 1;
  const end = Math.min(total, (page + 1) * inventoryPageSize);
  return (
    <nav className="pp-inventory-pager" aria-label={`${label} pages`}>
      <span>
        {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
      </span>
      <button type="button" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>
        Previous
      </button>
      <span>
        Page {page + 1} / {pageCount}
      </span>
      <button
        type="button"
        disabled={page + 1 >= pageCount}
        onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
      >
        Next
      </button>
    </nav>
  );
}

function groupDetail(group: NetworkGroup) {
  if (group.cidr) return group.cidr;
  if (group.vlanId !== null) return `VLAN ${group.vlanId}`;
  if (group.regionCode) return group.regionCode;
  if (group.siteCode) return group.siteCode;
  return 'No code';
}

function NodeInspector({
  id,
  inspectorRef,
  node,
  groups,
  onChange,
}: {
  id?: string;
  inspectorRef?: RefObject<HTMLElement | null>;
  node: NetworkNode;
  groups: readonly NetworkGroup[];
  onChange: (change: Partial<NetworkNode>) => void;
}) {
  return (
    <aside
      ref={inspectorRef}
      id={id}
      className="pp-node-inspector"
      aria-label="Selected network node"
      tabIndex={-1}
    >
      <span className={`pp-evidence-kind is-${primaryEvidence(node)}`}>
        {capitalize(primaryEvidence(node))}
      </span>
      <label>
        Device label
        <input value={node.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>
      <label>
        Tags
        <input
          value={node.tags.join(', ')}
          onChange={(event) =>
            onChange({
              tags: Array.from(
                new Set(
                  event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                )
              ).slice(0, 32),
            })
          }
          placeholder="gateway, production"
        />
      </label>
      <label>
        Notes
        <textarea
          value={node.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </label>
      <button
        type="button"
        className="pp-pin-node"
        aria-pressed={node.position.pinned}
        onClick={() => onChange({ position: { ...node.position, pinned: !node.position.pinned } })}
      >
        <Pin aria-hidden="true" /> {node.position.pinned ? 'Pinned position' : 'Pin position'}
      </button>
      <section>
        <h3>Organizational groups</h3>
        {groups.length ? (
          <div className="pp-node-group-list">
            {groups.map((group) => (
              <label key={group.id}>
                <input
                  type="checkbox"
                  aria-label={group.name || group.id}
                  checked={node.groupIds.includes(group.id)}
                  onChange={(event) =>
                    onChange({
                      groupIds: event.target.checked
                        ? [...node.groupIds, group.id]
                        : node.groupIds.filter((id) => id !== group.id),
                    })
                  }
                />
                <span>{group.name || group.id}</span>
                <small>{group.kind}</small>
              </label>
            ))}
          </div>
        ) : (
          <p>No organizational groups have been created.</p>
        )}
      </section>
      <section>
        <h3>Identities</h3>
        <ul>
          {node.identities.map((identity) => (
            <li key={`${identity.kind}:${identity.value}`}>
              <span>{identity.kind}</span>
              <code>{identity.value}</code>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Ports and services</h3>
        {node.ports.length ? (
          <ul>
            {node.ports.map((port) => (
              <li key={`${port.protocol}:${port.number}`}>
                <strong>
                  {port.protocol.toUpperCase()} {port.number}
                </strong>
                <span>{port.state}</span>
                {port.services.map((service) => (
                  <small key={`${service.name}:${service.product}`}>
                    {service.name}
                    {service.product ? ` · ${service.product}` : ''}
                  </small>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p>No port evidence stored for this node.</p>
        )}
      </section>
      <section>
        <h3>Evidence trail</h3>
        <ul>
          {node.provenance.map((entry) => (
            <li key={`${entry.kind}:${entry.source}:${entry.observedAt}:${entry.detail}`}>
              <strong>{capitalize(entry.kind)}</strong>
              <span>{entry.source}</span>
              <small>{entry.detail}</small>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function identityLabel(node: NetworkNode) {
  return node.identities.map((identity) => identity.value).join(' · ') || 'No identity';
}

function primaryEvidence(record: Pick<NetworkNode, 'provenance'>) {
  if (record.provenance.some((entry) => entry.kind === 'observed')) return 'observed';
  if (record.provenance.some((entry) => entry.kind === 'manual')) return 'manual';
  return 'inferred';
}

function deviceGlyph(deviceType: string) {
  const value = deviceType.toLowerCase();
  if (value.includes('gateway') || value.includes('router')) return 'GW';
  if (value.includes('unknown')) return '?';
  if (value.includes('process')) return 'PP';
  return 'IP';
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

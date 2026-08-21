import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NetworkWorkspaceV1 } from './network-model';
import { interactiveTopologyLimits, TopologyCanvas } from './TopologyCanvas';

const observedAt = '2026-08-21T12:00:00.000Z';
const provenance = [
  {
    kind: 'observed' as const,
    source: 'protopeek-probe' as const,
    observedAt,
    detail: 'HTTP responded',
  },
];

function workspace(): NetworkWorkspaceV1 {
  return {
    format: 'protopeek-network',
    version: 1,
    id: 'lab',
    name: 'Lab network',
    tags: ['lab'],
    notes: '',
    createdAt: observedAt,
    updatedAt: observedAt,
    groups: [
      {
        id: 'lab-site',
        kind: 'site',
        name: 'Lab site',
        tags: [],
        notes: '',
        regionCode: '',
        siteCode: 'LAB',
        vlanId: null,
        cidr: '',
        position: { x: -40, y: -40, pinned: false },
        provenance,
      },
    ],
    nodes: [
      {
        id: 'gateway',
        label: 'Gateway',
        tags: ['router'],
        notes: '',
        deviceType: 'gateway',
        firstSeen: observedAt,
        lastSeen: observedAt,
        identities: [{ kind: 'ipv4', value: '192.168.1.1', provenance }],
        ports: [],
        groupIds: [],
        position: { x: 0, y: 0, pinned: true },
        provenance,
      },
      {
        id: 'catalog',
        label: 'Catalog API',
        tags: ['grpc'],
        notes: 'local target',
        deviceType: 'server',
        firstSeen: observedAt,
        lastSeen: observedAt,
        identities: [{ kind: 'ipv4', value: '192.168.1.20', provenance }],
        ports: [
          {
            number: 50051,
            protocol: 'tcp',
            state: 'open',
            services: [
              {
                name: 'gRPC',
                product: 'catalog.v1.Catalog',
                version: '',
                transport: 'plaintext',
                provenance,
              },
            ],
            provenance,
          },
        ],
        groupIds: [],
        position: { x: 260, y: 80, pinned: false },
        provenance,
      },
    ],
    edges: [
      {
        id: 'gateway-catalog',
        kind: 'manual',
        source: 'gateway',
        target: 'catalog',
        label: 'Logical route',
        notes: '',
        firstSeen: observedAt,
        lastSeen: observedAt,
        traceOrder: null,
        provenance,
      },
    ],
    snapshots: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TopologyCanvas', () => {
  it('renders an accessible dependency-free map, inspector, arrange, and immutable-snapshot-safe edits', () => {
    const onChange = vi.fn();
    render(<TopologyCanvas workspace={workspace()} onChange={onChange} />);

    const map = screen.getByRole('region', { name: 'Network topology map' });
    expect(within(map).getByRole('button', { name: /Gateway.*192\.168\.1\.1/i })).toBeVisible();
    fireEvent.click(within(map).getByRole('button', { name: /Catalog API.*192\.168\.1\.20/i }));

    const inspector = screen.getByRole('complementary', { name: 'Selected network node' });
    expect(within(inspector).getByText('TCP 50051')).toBeVisible();
    expect(within(inspector).getByText(/gRPC.*catalog\.v1\.Catalog/)).toBeVisible();
    expect(within(inspector).getAllByText('Observed')[0]).toBeVisible();
    fireEvent.change(within(inspector).getByLabelText('Device label'), {
      target: { value: 'Catalog production' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'catalog', label: 'Catalog production' }),
        ]),
        snapshots: [],
      })
    );

    fireEvent.click(within(inspector).getByLabelText('Lab site'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'catalog', groupIds: ['lab-site'] }),
        ]),
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Arrange nodes' }));
    const arranged = onChange.mock.calls.at(-1)?.[0] as NetworkWorkspaceV1;
    expect(arranged.nodes.find((node) => node.id === 'gateway')?.position).toEqual({
      x: 0,
      y: 0,
      pinned: true,
    });
    expect(arranged.groups[0]?.position).toEqual({ x: 0, y: 0, pinned: false });
  });

  it('commits a dragged node as a pinned manual position without rewriting snapshots', () => {
    const onChange = vi.fn();
    render(<TopologyCanvas workspace={workspace()} onChange={onChange} />);
    const node = screen.getByRole('button', { name: /Catalog API.*192\.168\.1\.20/i });

    fireEvent.pointerDown(node, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(node, { pointerId: 4, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(node, { pointerId: 4, clientX: 160, clientY: 140 });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: 'catalog',
            position: { x: 320, y: 120, pinned: true },
          }),
        ]),
        snapshots: [],
      })
    );
  });

  it('provides a complete inventory-list alternative and defaults to it on narrow screens', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 760px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<TopologyCanvas workspace={workspace()} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const table = screen.getByRole('table', { name: 'Network inventory' });
    expect(within(table).getByText('Catalog API')).toBeVisible();
    expect(within(table).getByText('192.168.1.20')).toBeVisible();
    expect(within(table).getByText('50051/tcp')).toBeVisible();
    const groups = screen.getByRole('table', { name: 'Organizational group inventory' });
    expect(within(groups).getByText('Lab site')).toBeVisible();
    expect(within(groups).getByText('LAB')).toBeVisible();
    const relationships = screen.getByRole('table', { name: 'Logical relationship inventory' });
    expect(within(relationships).getByText('Gateway')).toBeVisible();
    expect(within(relationships).getByText('Catalog API')).toBeVisible();
    expect(within(relationships).getByText('Logical route')).toBeVisible();
    const catalog = within(table).getByRole('button', { name: 'Catalog API' });
    fireEvent.click(catalog);
    const inspector = screen.getByRole('complementary', { name: 'Selected network node' });
    expect(inspector).toHaveFocus();
    expect(catalog).toHaveAttribute('aria-controls', inspector.id);

    fireEvent.click(screen.getByRole('button', { name: 'Map view' }));
    expect(screen.getByRole('region', { name: 'Network topology map' })).toBeVisible();
  });

  it('uses a paged, truthful list fallback instead of an oversized interactive canvas', () => {
    const base = workspace();
    const template = base.nodes[1];
    if (!template) throw new Error('fixture node missing');
    const nodes = Array.from({ length: interactiveTopologyLimits.maxNodes + 1 }, (_, index) => ({
      ...template,
      id: `node-${String(index).padStart(3, '0')}`,
      label: `Node ${String(index).padStart(3, '0')}`,
      identities: [],
      ports: [],
      position: { x: index * 20, y: index * 10, pinned: false },
    }));
    render(
      <TopologyCanvas workspace={{ ...base, nodes, edges: [], groups: [] }} onChange={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Map view' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByText(/Interactive map disabled for this 161-node/)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Network topology map' })).not.toBeInTheDocument();

    const pager = screen.getByRole('navigation', { name: 'nodes pages' });
    expect(within(pager).getByText('1–100 of 161')).toBeVisible();
    fireEvent.click(within(pager).getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'Node 160' })).toBeVisible();
  });

  it('states exactly what an empty map needs', () => {
    render(
      <TopologyCanvas
        workspace={{ ...workspace(), nodes: [], edges: [], groups: [] }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/No saved nodes yet.*scan.*trace.*import/i)).toBeVisible();
  });
});

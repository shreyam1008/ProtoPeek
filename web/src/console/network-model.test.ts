import { describe, expect, it } from 'vitest';

import {
  exportNetworkGraphML,
  exportNetworkInventoryCSV,
  importNetworkGraphML,
  type NetworkWorkspaceV1,
  networkWorkspaceLimits,
  parseNetworkWorkspaceJSON,
  serializeNetworkWorkspace,
  validateNetworkWorkspaceImport,
} from './network-model';

const observedAt = '2026-08-21T10:00:00.000Z';

function minimalWorkspace(): NetworkWorkspaceV1 {
  return {
    format: 'protopeek-network',
    version: 1,
    id: 'home-lab',
    name: 'Home lab',
    tags: ['lab'],
    notes: 'Local evidence',
    createdAt: observedAt,
    updatedAt: observedAt,
    nodes: [],
    edges: [],
    groups: [],
    snapshots: [],
  };
}

function richWorkspace(): NetworkWorkspaceV1 {
  const observed = {
    kind: 'observed' as const,
    source: 'protopeek-probe' as const,
    observedAt,
    detail: 'Bounded TCP and protocol probe',
  };
  const traced = {
    kind: 'observed' as const,
    source: 'path-trace' as const,
    observedAt,
    detail: 'TTL 1 responder',
  };
  const manual = {
    kind: 'manual' as const,
    source: 'manual' as const,
    observedAt,
    detail: 'Named by the operator',
  };
  const inventory = {
    groups: [
      {
        id: 'site-bom',
        kind: 'site',
        name: 'Mumbai lab',
        tags: ['india'],
        notes: 'Operator-defined site',
        regionCode: 'BOM',
        siteCode: 'bom-lab',
        vlanId: null,
        cidr: '',
        position: { x: -240, y: 80, pinned: true },
        provenance: [manual],
      },
      {
        id: 'vlan-20',
        kind: 'vlan',
        name: 'Services',
        tags: [],
        notes: '',
        regionCode: '',
        siteCode: 'bom-lab',
        vlanId: 20,
        cidr: '192.168.20.0/24',
        position: { x: 120, y: 80, pinned: false },
        provenance: [manual],
      },
    ],
    nodes: [
      {
        id: 'gateway',
        label: 'Lab gateway',
        tags: ['gateway'],
        notes: '',
        deviceType: 'router',
        firstSeen: observedAt,
        lastSeen: observedAt,
        identities: [{ kind: 'ipv4', value: '192.168.20.1', provenance: [traced] }],
        ports: [],
        groupIds: ['site-bom', 'vlan-20'],
        position: { x: 0, y: 0, pinned: true },
        provenance: [traced, manual],
      },
      {
        id: 'catalog',
        label: 'Catalog service',
        tags: ['grpc'],
        notes: 'Primary local target',
        deviceType: 'server',
        firstSeen: observedAt,
        lastSeen: observedAt,
        identities: [
          { kind: 'hostname', value: 'catalog.local', provenance: [observed] },
          { kind: 'ipv4', value: '192.168.20.12', provenance: [observed] },
        ],
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
                provenance: [observed],
              },
            ],
            provenance: [observed],
          },
        ],
        groupIds: ['site-bom', 'vlan-20'],
        position: { x: 240, y: 0, pinned: false },
        provenance: [observed, manual],
      },
    ],
    edges: [
      {
        id: 'gateway-catalog',
        kind: 'trace',
        source: 'gateway',
        target: 'catalog',
        label: 'Observed path',
        notes: 'Logical trace sequence, not a physical cable',
        firstSeen: observedAt,
        lastSeen: observedAt,
        traceOrder: 1,
        provenance: [traced],
      },
    ],
  } satisfies Pick<NetworkWorkspaceV1, 'groups' | 'nodes' | 'edges'>;
  return {
    ...minimalWorkspace(),
    ...inventory,
    tags: ['production-like', 'lab'],
    snapshots: [
      {
        id: 'snapshot-1',
        label: 'Initial observation',
        tags: ['baseline'],
        notes: '',
        observedAt,
        nodes: inventory.nodes,
        edges: inventory.edges,
        groups: inventory.groups,
        provenance: [observed],
      },
    ],
  };
}

describe('ProtoPeek network JSON', () => {
  it('round-trips the bounded canonical v1 envelope deterministically', () => {
    const first = serializeNetworkWorkspace(minimalWorkspace());
    const parsed = parseNetworkWorkspaceJSON(first);

    expect(parsed).toEqual({ error: null, value: minimalWorkspace() });
    if (parsed.error !== null) throw new Error(parsed.error);
    expect(serializeNetworkWorkspace(parsed.value)).toBe(first);
    expect(JSON.parse(first)).toMatchObject({ format: 'protopeek-network', version: 1 });
  });

  it('retains identities, services, provenance, groups, positions, edges, and snapshots', () => {
    const parsed = parseNetworkWorkspaceJSON(JSON.stringify(richWorkspace()));

    expect(parsed.error).toBeNull();
    if (parsed.error !== null) throw new Error(parsed.error);
    expect(parsed.value).toEqual(richWorkspace());
    expect(Object.isFrozen(parsed.value.snapshots[0])).toBe(true);
    expect(Object.isFrozen(parsed.value.snapshots[0]?.nodes)).toBe(true);
    expect(Object.isFrozen(parsed.value.snapshots[0]?.nodes[0])).toBe(true);
  });

  it('keeps snapshot evidence isolated from later inventory mutation', () => {
    const parsed = parseNetworkWorkspaceJSON(JSON.stringify(richWorkspace()));
    if (parsed.error !== null) throw new Error(parsed.error);
    const mutableNodes = parsed.value.nodes as unknown as Array<{
      label: string;
      ports: unknown[];
    }>;
    mutableNodes[0].label = 'Changed current label';
    mutableNodes[1].ports = [];

    expect(parsed.value.snapshots[0]?.nodes[0]?.label).toBe('Lab gateway');
    expect(parsed.value.snapshots[0]?.nodes[1]?.ports).toHaveLength(1);
    expect(() => {
      const snapshotNodes = parsed.value.snapshots[0]?.nodes as unknown as Array<{ label: string }>;
      if (snapshotNodes[0]) snapshotNodes[0].label = 'Mutation attempt';
    }).toThrow();
  });

  it('fails closed for malformed, unbounded, secret-bearing, or inconsistent evidence', () => {
    const malformed = parseNetworkWorkspaceJSON('{');
    expect(malformed.error).toMatch(/malformed/i);

    const oversized = validateNetworkWorkspaceImport({
      ...minimalWorkspace(),
      nodes: Array.from({ length: networkWorkspaceLimits.maxNodes + 1 }, () => ({})),
    });
    expect(oversized.error).toMatch(/1024-item limit/i);

    const cases: Array<[string, unknown]> = [
      ['credentials', { ...minimalWorkspace(), authorization: 'Bearer secret' }],
      [
        'request body',
        {
          ...richWorkspace(),
          nodes: [
            { ...richWorkspace().nodes[0], requestBody: '{"secret":true}' },
            richWorkspace().nodes[1],
          ],
        },
      ],
      [
        'raw XML',
        {
          ...richWorkspace(),
          nodes: [{ ...richWorkspace().nodes[0], rawXML: '<nmaprun />' }, richWorkspace().nodes[1]],
        },
      ],
      [
        'invalid IP identity',
        {
          ...richWorkspace(),
          nodes: [
            {
              ...richWorkspace().nodes[0],
              identities: [
                {
                  ...richWorkspace().nodes[0]?.identities[0],
                  kind: 'ipv4',
                  value: '999.1.2.3',
                },
              ],
            },
            richWorkspace().nodes[1],
          ],
        },
      ],
      [
        'VLAN without an id',
        {
          ...richWorkspace(),
          groups: richWorkspace().groups.map((group) =>
            group.id === 'vlan-20' ? { ...group, vlanId: null } : group
          ),
        },
      ],
      [
        'trace without order',
        {
          ...richWorkspace(),
          edges: [{ ...richWorkspace().edges[0], traceOrder: null }],
        },
      ],
      [
        'duplicate port',
        {
          ...richWorkspace(),
          nodes: richWorkspace().nodes.map((node) =>
            node.id === 'catalog' ? { ...node, ports: [node.ports[0], node.ports[0]] } : node
          ),
        },
      ],
      [
        'broken reference',
        {
          ...richWorkspace(),
          edges: [{ ...richWorkspace().edges[0], target: 'missing' }],
        },
      ],
      [
        'snapshot self-loop',
        {
          ...richWorkspace(),
          snapshots: richWorkspace().snapshots.map((snapshot) => ({
            ...snapshot,
            edges: snapshot.edges.map((edge) => ({ ...edge, target: edge.source })),
          })),
        },
      ],
    ];

    for (const [label, value] of cases) {
      expect(validateNetworkWorkspaceImport(value).error, label).not.toBeNull();
    }
  });

  it('rejects XML 1.0-invalid characters before model acceptance or interchange', () => {
    const invalid = { ...minimalWorkspace(), notes: 'invalid\u0001control' };

    expect(validateNetworkWorkspaceImport(invalid).error).toMatch(/XML 1\.0/i);
    expect(() => exportNetworkGraphML(invalid)).toThrow(/XML 1\.0/i);
    expect(
      importNetworkGraphML(
        `<graphml xmlns="http://graphml.graphdrawing.org/xmlns"><graph id="x" edgedefault="directed"><data key="pp_notes">invalid\u0001control</data></graph></graphml>`,
        observedAt
      ).error
    ).toMatch(/XML 1\.0/i);
    expect(
      validateNetworkWorkspaceImport({ ...minimalWorkspace(), name: 'Lab 🛰️' }).error
    ).toBeNull();
  });

  it('accepts bounded scoped IPv6 identities and rejects unsafe zones', () => {
    const workspace = richWorkspace();
    const withIPv6Identity = (value: string) => ({
      ...workspace,
      nodes: workspace.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              identities: [{ ...node.identities[0], kind: 'ipv6' as const, value }],
            }
          : node
      ),
    });

    expect(validateNetworkWorkspaceImport(withIPv6Identity('fe80::1%eth0')).error).toBeNull();
    expect(validateNetworkWorkspaceImport(withIPv6Identity('fe80::1%12')).error).toBeNull();
    for (const value of [
      'fe80::1%',
      'fe80::1%eth0%extra',
      'fe80::1%zone with space',
      'fe80::1%../../escape',
      `fe80::1%${'a'.repeat(65)}`,
      'not-an-ipv6%eth0',
    ]) {
      expect(validateNetworkWorkspaceImport(withIPv6Identity(value)).error, value).toMatch(
        /valid ipv6 identity/i
      );
    }
  });
});

describe('GraphML interchange', () => {
  it('round-trips nodes, edges, groups, and positions with explicit loss notices', () => {
    const exported = exportNetworkGraphML(richWorkspace());

    expect(exported.losses).toEqual([
      'GraphML omits node identities, ports, services, and original evidence provenance.',
      'GraphML omits immutable network snapshots.',
      'ProtoPeek tags, notes, and grouping metadata use custom GraphML data keys that other tools may discard.',
    ]);
    expect(exportNetworkGraphML(richWorkspace()).content).toBe(exported.content);
    expect(exported.content).toContain('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">');
    expect(exported.content).toContain('<node id="group:site-bom">');
    expect(exported.content).toContain('<node id="node:catalog">');
    expect(exported.content).toContain(
      '<edge id="edge:gateway-catalog" source="node:gateway" target="node:catalog">'
    );

    const imported = importNetworkGraphML(exported.content, observedAt);
    expect(imported.error).toBeNull();
    if (imported.error !== null) throw new Error(imported.error);
    expect(imported.losses).toEqual([
      'GraphML has no portable representation for ProtoPeek protocol evidence or immutable snapshots; imported records are marked as graphml-import.',
      'Only one flat directed GraphML graph is accepted; nested graphs, ports, hyperedges, and undirected or mixed edges are rejected rather than reinterpreted.',
    ]);
    expect(imported.value.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'catalog',
          label: 'Catalog service',
          tags: ['grpc'],
          notes: 'Primary local target',
          deviceType: 'server',
          groupIds: ['site-bom', 'vlan-20'],
          position: { x: 240, y: 0, pinned: false },
          identities: [],
          ports: [],
        }),
      ])
    );
    expect(imported.value.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'vlan-20',
          kind: 'vlan',
          vlanId: 20,
          cidr: '192.168.20.0/24',
          position: { x: 120, y: 80, pinned: false },
        }),
      ])
    );
    expect(imported.value.edges).toEqual([
      expect.objectContaining({
        id: 'gateway-catalog',
        kind: 'trace',
        source: 'gateway',
        target: 'catalog',
        label: 'Observed path',
        traceOrder: 1,
      }),
    ]);
    expect(imported.value.snapshots).toEqual([]);
  });

  it('rejects declarations and unbounded XML while disclosing ignored third-party keys', () => {
    const withDoctype = `<?xml version="1.0"?>
      <!DOCTYPE graphml [<!ENTITY secret "leak">]>
      <graphml xmlns="http://graphml.graphdrawing.org/xmlns"><graph id="x" /></graphml>`;
    expect(importNetworkGraphML(withDoctype, observedAt).error).toMatch(/DOCTYPE|entity/i);
    expect(importNetworkGraphML('<graphml>', observedAt).error).toMatch(/malformed/i);

    const tooManyNodes = Array.from(
      { length: networkWorkspaceLimits.maxNodes + networkWorkspaceLimits.maxGroups + 1 },
      (_, index) => `<node id="n${index}" />`
    ).join('');
    expect(
      importNetworkGraphML(
        `<graphml xmlns="http://graphml.graphdrawing.org/xmlns"><graph id="x" edgedefault="directed">${tooManyNodes}</graph></graphml>`,
        observedAt
      ).error
    ).toMatch(/too many/i);

    const thirdParty = `<?xml version="1.0"?>
      <graphml xmlns="http://graphml.graphdrawing.org/xmlns">
        <key id="color" for="node" attr.name="vendor:color" attr.type="string" />
        <graph id="imported" edgedefault="directed">
          <data key="pp_id">imported</data>
          <node id="node-1">
            <data key="pp_id">node-1</data>
            <data key="pp_label">Imported node</data>
            <data key="color">red</data>
          </node>
        </graph>
      </graphml>`;
    const imported = importNetworkGraphML(thirdParty, observedAt);
    expect(imported.error).toBeNull();
    expect(imported.losses).toContain('Unsupported GraphML data keys were ignored.');
  });

  it('rejects ambiguous direction, unsupported topology structure, and duplicate XML identifiers', () => {
    const graphML = (body: string, attributes = 'edgedefault="directed"', keys = '') => `
      <graphml xmlns="http://graphml.graphdrawing.org/xmlns">
        ${keys}
        <graph id="imported" ${attributes}>${body}</graph>
      </graphml>`;
    const node = (identifier: string) => `<node id="${identifier}" />`;
    const cases: Array<[string, string, RegExp]> = [
      ['missing edge default', graphML(node('n1'), ''), /edgedefault.*directed/i],
      ['undirected graph', graphML(node('n1'), 'edgedefault="undirected"'), /undirected/i],
      [
        'mixed edge direction',
        graphML(
          `${node('n1')}${node('n2')}<edge id="e1" source="n1" target="n2" directed="false" />`
        ),
        /mixed|undirected|directed="false"/i,
      ],
      [
        'nested graph',
        graphML(`<node id="n1"><graph id="nested" edgedefault="directed" /></node>`),
        /nested graph/i,
      ],
      [
        'nested graph in data',
        graphML(
          '<node id="n1"><data key="vendor"><graph id="nested" edgedefault="directed" /></data></node>'
        ),
        /nested graph/i,
      ],
      ['hyperedge', graphML(`${node('n1')}<hyperedge id="h1" />`), /hyperedge/i],
      ['port', graphML(`<node id="n1"><port name="p1" /></node>`), /port/i],
      ['unknown structure', graphML(`${node('n1')}<vendor-topology />`), /unsupported.*structure/i],
      [
        'duplicate node/group XML id',
        graphML(`
          <node id="same">
            <data key="pp_record_type">group</data>
            <data key="pp_id">group-a</data>
          </node>
          <node id="same">
            <data key="pp_record_type">node</data>
            <data key="pp_id">node-a</data>
          </node>`),
        /node id same.*duplicated/i,
      ],
      [
        'duplicate key id',
        graphML(node('n1'), 'edgedefault="directed"', '<key id="dup" /><key id="dup" />'),
        /key id dup.*duplicated/i,
      ],
      [
        'duplicate data key',
        graphML(
          '<node id="n1"><data key="pp_label">first</data><data key="pp_label">second</data></node>'
        ),
        /data key pp_label.*duplicated/i,
      ],
      [
        'duplicate data id',
        graphML(
          '<node id="n1"><data id="datum" key="pp_label">first</data></node><node id="n2"><data id="datum" key="pp_label">second</data></node>'
        ),
        /data id datum.*duplicated/i,
      ],
    ];

    for (const [label, content, expected] of cases) {
      expect(importNetworkGraphML(content, observedAt).error, label).toMatch(expected);
    }
  });
});

describe('CSV inventory export', () => {
  it('is deterministic and neutralizes hostile spreadsheet cells and embedded rows', () => {
    const workspace = richWorkspace();
    const nodes = workspace.nodes.map((node) =>
      node.id === 'catalog'
        ? {
            ...node,
            label: '=HYPERLINK("https://attacker.invalid")',
            tags: ['+execute'],
            notes: ' @SUM(1,1)\nsecond row',
          }
        : node
    );
    const hostile = { ...workspace, nodes };

    const csv = exportNetworkInventoryCSV(hostile);

    expect(exportNetworkInventoryCSV(hostile)).toBe(csv);
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(csv).toContain('"\'=HYPERLINK(""https://attacker.invalid"")"');
    expect(csv).toContain('"\'+execute"');
    expect(csv).toContain('"\' @SUM(1,1) second row"');
    expect(csv).not.toMatch(/,"[\t ]*[=+\-@]/);
    expect(csv).toContain('"50051/tcp (open)"');
    expect(csv).toContain('"50051/tcp gRPC catalog.v1.Catalog plaintext"');
  });
});

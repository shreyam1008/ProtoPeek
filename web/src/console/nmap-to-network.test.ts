import { describe, expect, it } from 'vitest';
import type { NmapImportResponse } from './api';
import { parseNetworkWorkspaceJSON } from './network-model';
import { nmapToNetwork } from './nmap-to-network';

const time = '2026-10-22T12:00:00.000Z';
function inventory(): NmapImportResponse {
  return {
    hosts: [
      {
        id: 1,
        status: { state: 'up', reason: 'echo-reply' },
        addresses: [{ type: 'ipv4', address: '192.0.2.1', vendor: '' }],
        hostnames: [],
        ports: [
          {
            port: 443,
            protocol: 'tcp',
            state: 'open|filtered',
            reason: 'no-response',
            service: {
              name: 'https',
              product: '',
              version: '',
              extrainfo: '',
              tunnel: 'ssl',
              method: 'table',
              confidence: '3',
            },
          },
        ],
      },
    ],
    hostCount: 1,
    portCount: 1,
    complete: false,
    completion: 'missing',
  };
}
describe('Nmap inventory to network preview', () => {
  it('retains source assertions, unknown composite states and unverified hints without inventing links', () => {
    const preview = nmapToNetwork(inventory(), 'Imported', time, 'fixture');
    expect(preview.complete).toBe(false);
    expect(preview.losses.compositeStates).toBe(1);
    expect(preview.workspace.edges).toEqual([]);
    const host = preview.workspace.nodes[0];
    expect(host.firstSeen).toBe(time);
    expect(host.ports[0]).toMatchObject({
      state: 'unknown',
      services: [{ name: 'https', provenance: [{ kind: 'inferred', source: 'nmap-import' }] }],
    });
    expect(host.ports[0].provenance[0].detail).toContain('open|filtered');
    expect(host.provenance[0].detail).toContain('source scan time is not retained');
    expect(parseNetworkWorkspaceJSON(JSON.stringify(preview.workspace)).error).toBeNull();
    expect(Object.isFrozen(preview.workspace.snapshots[0].nodes[0])).toBe(true);
  });
  it('reports exact losses at the existing 256-port workspace bound', () => {
    const input = inventory();
    input.hosts[0].ports = Array.from({ length: 260 }, (_, index) => ({
      ...input.hosts[0].ports[0],
      port: index + 1,
    }));
    input.hosts[0].addresses.push({ type: 'ipv4', address: 'bad', vendor: '' });
    const preview = nmapToNetwork(input, 'Ports', time, 'fixture');
    expect(preview.workspace.nodes[0].ports).toHaveLength(256);
    expect(preview.losses).toMatchObject({ ports: 4, identities: 1, hosts: 0 });
  });
  it('marks duplicated port assertions unknown instead of silently selecting the first open claim', () => {
    const input = inventory();
    input.hosts[0].ports[0].state = 'open';
    input.hosts[0].ports.push({ ...input.hosts[0].ports[0], state: 'closed' });
    const preview = nmapToNetwork(input, 'Duplicate', time, 'fixture');
    expect(preview.losses.ports).toBe(1);
    expect(preview.workspace.nodes[0].ports[0].state).toBe('unknown');
    expect(
      preview.workspace.nodes[0].ports[0].provenance.map((source) => source.detail).join(' ')
    ).toContain('state=open');
    expect(
      preview.workspace.nodes[0].ports[0].provenance.map((source) => source.detail).join(' ')
    ).toContain('state=closed');
    expect(preview.losses.compositeStates).toBe(1);
  });
  it('omits unmappable hosts and rejects empty or excessive evidence', () => {
    const input = inventory();
    input.hosts.push({ ...input.hosts[0], id: 2, addresses: [], hostnames: [] });
    expect(nmapToNetwork(input, 'Partial', time, 'fixture').losses).toMatchObject({
      hosts: 1,
      ports: 1,
    });
    expect(() => nmapToNetwork({ ...input, hosts: [] }, 'Empty', time, 'fixture')).toThrow(
      'No supported host'
    );
    expect(() =>
      nmapToNetwork(
        { ...input, hosts: Array.from({ length: 1025 }, () => input.hosts[0]) },
        'Large',
        time,
        'fixture'
      )
    ).toThrow('limits');
  });
});

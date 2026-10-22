import { expect, it } from 'vitest';
import { packetConversationKey, packetRelativeTime } from './packet-analysis';
import type { PacketRow } from './packet-api';
import { summarizeConversations } from './packet-conversations';

const packet: PacketRow = {
  number: 1,
  timestamp: '2026-09-27T07:00:00Z',
  interface: 0,
  length: 90,
  captured: 90,
  source: '192.0.2.1',
  sourcePort: 50000,
  destination: '198.51.100.1',
  destinationPort: 443,
  protocol: 'TCP',
  info: 'SYN',
  truncated: false,
};

it('groups both directions and application signatures for each endpoint pair', () => {
  const reply = {
    ...packet,
    number: 2,
    source: packet.destination,
    sourcePort: packet.destinationPort,
    destination: packet.source,
    destinationPort: packet.sourcePort,
    protocol: 'TLS',
    length: 200,
  };
  const result = summarizeConversations([packet, reply]);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    first: '192.0.2.1:50000',
    second: '198.51.100.1:443',
    packets: 2,
    forward: 1,
    reverse: 1,
    bytes: 290,
    protocols: ['TCP', 'TLS'],
  });
  expect(packetConversationKey(packet)).toBe(packetConversationKey(reply));
});

it('keeps distinct capture interfaces and local ports separate', () => {
  const result = summarizeConversations([
    packet,
    { ...packet, number: 2, sourcePort: 50001 },
    { ...packet, number: 3, interface: 1 },
    { ...packet, number: 4, source: '2001:db8::1', length: 100 },
  ]);
  expect(result).toHaveLength(4);
  expect(result[0].first).toBe('[2001:db8::1]:50000');
  expect(summarizeConversations([])).toEqual([]);
});

it('keeps equal TCP/UDP tuples and PCAPNG section-local interfaces separate', () => {
  const packets = [
    { ...packet, transport: 'TCP' as const, section: 0 },
    { ...packet, number: 2, transport: 'UDP' as const, protocol: 'DNS', section: 0 },
    { ...packet, number: 3, transport: 'TCP' as const, section: 1 },
  ];
  expect(summarizeConversations(packets)).toHaveLength(3);
});

it('reports the actual timestamp span across out-of-order capture records', () => {
  const result = summarizeConversations([
    packet,
    { ...packet, number: 2, timestamp: '2026-09-27T06:59:59Z' },
  ]);
  expect(result[0]).toMatchObject({
    firstTime: '2026-09-27T06:59:59Z',
    lastTime: packet.timestamp,
  });
});

it('shows recorded time offsets without inventing missing timestamps', () => {
  expect(
    packetRelativeTime({ ...packet, timestamp: '2026-09-27T07:00:00.250Z' }, packet.timestamp)
  ).toBe('0.250 s');
  expect(packetRelativeTime({ ...packet, timestamp: undefined }, packet.timestamp)).toBe('—');
});

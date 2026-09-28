import type { PacketRow } from './packet-api';

export type PacketConversation = {
  key: string;
  first: string;
  second: string;
  packets: number;
  bytes: number;
  forward: number;
  reverse: number;
  protocols: string[];
};

function endpoint(address: string, port: number | undefined) {
  const host = address || 'Unknown';
  return port === undefined ? host : `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

function endpoints(row: PacketRow) {
  return [endpoint(row.source, row.sourcePort), endpoint(row.destination, row.destinationPort)];
}

export function packetConversationKey(row: PacketRow) {
  // Keep separate capture interfaces separate even if their endpoint addresses overlap.
  const pair = endpoints(row).sort();
  return JSON.stringify([row.interface, ...pair]);
}

export function summarizeConversations(packets: PacketRow[]): PacketConversation[] {
  const conversations = new Map<string, PacketConversation>();
  for (const row of packets) {
    const key = packetConversationKey(row);
    const [source, destination] = endpoints(row);
    let conversation = conversations.get(key);
    if (!conversation) {
      conversation = {
        key,
        first: source,
        second: destination,
        packets: 0,
        bytes: 0,
        forward: 0,
        reverse: 0,
        protocols: [],
      };
      conversations.set(key, conversation);
    }
    conversation.packets++;
    conversation.bytes += row.length;
    if (source === conversation.first) conversation.forward++;
    else conversation.reverse++;
    if (!conversation.protocols.includes(row.protocol)) conversation.protocols.push(row.protocol);
  }
  return [...conversations.values()].sort((a, b) => b.bytes - a.bytes || b.packets - a.packets);
}

export function packetRelativeTime(row: PacketRow, origin: string | undefined) {
  if (!row.timestamp || !origin) return '—';
  return `${((Date.parse(row.timestamp) - Date.parse(origin)) / 1000).toFixed(3)} s`;
}

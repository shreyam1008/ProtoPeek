import { packetConversationKey, packetEndpoints, packetTransport } from './packet-analysis';
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
  transport: string;
  section: number;
  interface: number;
  firstTime?: string;
  lastTime?: string;
};

export function summarizeConversations(packets: PacketRow[]): PacketConversation[] {
  const conversations = new Map<string, PacketConversation>();
  for (const row of packets) {
    const key = packetConversationKey(row);
    const [source, destination] = packetEndpoints(row);
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
        transport: packetTransport(row),
        section: row.section ?? 0,
        interface: row.interface,
      };
      conversations.set(key, conversation);
    }
    conversation.packets++;
    conversation.bytes += row.length;
    if (source === conversation.first) conversation.forward++;
    else conversation.reverse++;
    if (!conversation.protocols.includes(row.protocol)) conversation.protocols.push(row.protocol);
    if (row.timestamp) {
      if (!conversation.firstTime || Date.parse(row.timestamp) < Date.parse(conversation.firstTime))
        conversation.firstTime = row.timestamp;
      if (!conversation.lastTime || Date.parse(row.timestamp) > Date.parse(conversation.lastTime))
        conversation.lastTime = row.timestamp;
    }
  }
  return [...conversations.values()].sort((a, b) => b.bytes - a.bytes || b.packets - a.packets);
}

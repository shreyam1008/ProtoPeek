import type { PacketRow } from './packet-api';

function endpoint(address: string, port: number | undefined) {
  const host = address || 'Unknown';
  return port === undefined ? host : `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export function packetEndpoints(row: PacketRow) {
  return [endpoint(row.source, row.sourcePort), endpoint(row.destination, row.destinationPort)];
}

export function packetConversationKey(row: PacketRow) {
  // Sections and transports have independent address/port namespaces.
  const pair = packetEndpoints(row).sort();
  return JSON.stringify([row.section ?? 0, row.interface, packetTransport(row), ...pair]);
}

export function packetTransport(row: PacketRow) {
  return (
    row.transport ??
    (['TCP', 'TLS', 'HTTP', 'HTTP/2'].includes(row.protocol)
      ? 'TCP'
      : row.protocol === 'UDP'
        ? 'UDP'
        : `Unspecified (${row.protocol})`)
  );
}

export function packetRelativeTime(row: PacketRow, origin: string | undefined) {
  if (!row.timestamp || !origin) return '—';
  return `${((Date.parse(row.timestamp) - Date.parse(origin)) / 1000).toFixed(3)} s`;
}

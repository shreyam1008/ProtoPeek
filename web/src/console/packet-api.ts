import { readBoundedText } from '@/shared/bounded-response';

export type PacketRow = {
  number: number;
  timestamp?: string;
  interface: number;
  length: number;
  captured: number;
  source: string;
  destination: string;
  sourcePort?: number;
  destinationPort?: number;
  protocol: string;
  info: string;
  truncated: boolean;
};
export type PacketReport = {
  format: string;
  packets: PacketRow[];
  packetCount: number;
  wireBytes: number;
  capturedBytes: number;
  protocols: Record<string, number>;
  limited: boolean;
  warnings: string[];
};
export type CaptureInterface = { name: string; label: string };

export async function packetRequest(path: string, input: unknown, signal: AbortSignal) {
  const response = await fetch(new URL(`api/packets/${path}`, window.location.href), {
    method: input === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': input instanceof File ? 'application/octet-stream' : 'application/json',
      'x-protopeek-csrf-token':
        document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '',
    },
    body: input instanceof File ? input : input === undefined ? undefined : JSON.stringify(input),
  });
  const body = await readBoundedText(response, 2 * 1024 * 1024);
  if (body.truncated) throw new Error('Packet report exceeded its size limit.');
  if (!response.ok) throw new Error(body.text || `Request failed (${response.status}).`);
  return JSON.parse(body.text);
}

export function parsePacketReport(value: unknown): PacketReport {
  const result = value as PacketReport;
  if (
    !result ||
    !['PCAP', 'PCAPNG'].includes(result.format) ||
    !Array.isArray(result.packets) ||
    result.packets.length > 2000 ||
    !Number.isInteger(result.packetCount) ||
    result.packetCount < result.packets.length ||
    result.packetCount > 20000 ||
    !Array.isArray(result.warnings) ||
    result.warnings.length > 12 ||
    result.warnings.some((item) => typeof item !== 'string' || item.length > 512) ||
    !result.protocols ||
    typeof result.protocols !== 'object'
  )
    throw new Error('Invalid packet report.');
  for (const row of result.packets) {
    if (
      !row ||
      !Number.isInteger(row.number) ||
      row.number < 1 ||
      row.number > 20000 ||
      !Number.isInteger(row.captured) ||
      row.captured < 0 ||
      row.captured > 16 * 1024 * 1024 ||
      !Number.isInteger(row.length) ||
      row.length < row.captured ||
      row.length > 0xffffffff ||
      !Number.isInteger(row.interface) ||
      row.interface < 0 ||
      row.interface > 63 ||
      typeof row.truncated !== 'boolean'
    )
      throw new Error('Invalid packet record.');
    for (const key of ['source', 'destination', 'protocol', 'info'] as const)
      if (typeof row[key] !== 'string' || row[key].length > 1024)
        throw new Error('Invalid packet metadata.');
    for (const port of [row.sourcePort, row.destinationPort])
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535))
        throw new Error('Invalid packet port.');
    if (
      row.timestamp !== undefined &&
      (row.timestamp.length > 40 || !Number.isFinite(Date.parse(row.timestamp)))
    )
      throw new Error('Invalid packet timestamp.');
  }
  for (const count of [result.wireBytes, result.capturedBytes, ...Object.values(result.protocols)])
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid packet totals.');
  return result;
}

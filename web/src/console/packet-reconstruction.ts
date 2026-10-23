export type TCPSpan = { start: number; end: number };
export type TCPSegment = {
  packet: number;
  sequence: number;
  offset: number;
  data: string;
  bytes: Uint8Array;
};
export type TCPDirection = {
  source: string;
  destination: string;
  startObserved: boolean;
  endObserved: boolean;
  sequenceAmbiguous: boolean;
  conflictsLimited: boolean;
  segments: TCPSegment[];
  gaps: TCPSpan[];
  conflicts: TCPSpan[];
};
export type TCPFlow = {
  id: string;
  section: number;
  interface: number;
  firstPacket: number;
  lastPacket: number;
  directions: TCPDirection[];
  limited: boolean;
};
export type TCPReconstruction = {
  flows: TCPFlow[];
  retainedBytes: number;
  limited: boolean;
  skippedFragments: number;
};

function fail(): never {
  throw new Error('Invalid or excessive TCP reconstruction evidence.');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function integer(value: unknown, max: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) fail();
  return value;
}
function bool(value: unknown) {
  if (typeof value !== 'boolean') fail();
  return value;
}
function text(value: unknown, max = 1024) {
  if (typeof value !== 'string' || !value || value.length > max) fail();
  return value;
}
function array(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length > max) fail();
  return value;
}
function spans(value: unknown, max: number): TCPSpan[] {
  let previous = -1;
  return array(value, max).map((value) => {
    const item = record(value);
    const start = integer(item.start, 3 << 20),
      end = integer(item.end, 3 << 20);
    if (end <= start || start <= previous) fail();
    previous = end;
    return { start, end };
  });
}

/** Validate only when explicitly opening payload detail; default metadata stays lightweight. */
export function parseTCPReconstruction(value: unknown): TCPReconstruction {
  const root = record(value);
  let total = 0,
    count = 0;
  const ids = new Set<string>();
  const packets = new Set<number>();
  const flows = array(root.flows, 32).map((value): TCPFlow => {
    const flow = record(value);
    const id = text(flow.id);
    if (ids.has(id)) fail();
    ids.add(id);
    let flowBytes = 0;
    const firstPacket = integer(flow.firstPacket, 20000),
      lastPacket = integer(flow.lastPacket, 20000);
    if (!firstPacket || lastPacket < firstPacket) fail();
    const directions = array(flow.directions, 2).map((value): TCPDirection => {
      const d = record(value);
      const segments = array(d.segments, 512).map((value): TCPSegment => {
        const s = record(value);
        const data = text(s.data, 87384);
        if (
          data.length > 87384 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
        )
          fail();
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        total += bytes.length;
        flowBytes += bytes.length;
        count++;
        if (!bytes.length || total > 256 << 10 || flowBytes > 64 << 10 || count > 512) fail();
        const packet = integer(s.packet, lastPacket);
        if (packet < firstPacket || packets.has(packet)) fail();
        packets.add(packet);
        return {
          packet,
          sequence: integer(s.sequence, 0xffffffff),
          offset: integer(s.offset, 2 << 20),
          data,
          bytes,
        };
      });
      return {
        source: text(d.source),
        destination: text(d.destination),
        segments,
        gaps: spans(d.gaps, 512),
        conflicts: spans(d.conflicts, 128),
        startObserved: bool(d.startObserved),
        endObserved: bool(d.endObserved),
        sequenceAmbiguous: bool(d.sequenceAmbiguous),
        conflictsLimited: bool(d.conflictsLimited),
      };
    });
    if (directions.length !== 2) fail();
    return {
      id,
      section: integer(flow.section, 63),
      interface: integer(flow.interface, 63),
      firstPacket,
      lastPacket,
      directions,
      limited: bool(flow.limited),
    };
  });
  if (integer(root.retainedBytes, 256 << 10) !== total) fail();
  return {
    flows,
    retainedBytes: total,
    limited: bool(root.limited),
    skippedFragments: integer(root.skippedFragments, 20000),
  };
}

/** Only emit contiguous unambiguous captured bytes. Never fill gaps or choose an overlap winner. */
export function reconstructDirection(direction: TCPDirection) {
  if (direction.conflictsLimited) return [];
  const bytes = new Map<number, number>();
  const contradictory = new Set<number>();
  for (const segment of direction.segments)
    segment.bytes.forEach((value, index) => {
      const offset = segment.offset + index;
      if (
        direction.conflicts.some((span) => offset >= span.start && offset < span.end) ||
        contradictory.has(offset)
      )
        return;
      const previous = bytes.get(offset);
      if (previous !== undefined && previous !== value) {
        contradictory.add(offset);
        bytes.delete(offset);
      } else bytes.set(offset, value);
    });
  const positions = [...bytes.entries()].sort((a, b) => a[0] - b[0]);
  const blocks: { start: number; bytes: number[] }[] = [];
  for (const [offset, value] of positions) {
    let block = blocks.at(-1);
    if (!block || offset !== block.start + block.bytes.length) {
      block = { start: offset, bytes: [] };
      blocks.push(block);
    }
    block.bytes.push(value);
  }
  return blocks;
}

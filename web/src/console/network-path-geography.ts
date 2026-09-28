import type { IPAttributionEntry } from './ip-attribution';
import { buildHopRows, type PathTrace } from './network-path';

export type GeographicHop = {
  key: string;
  ttl: number;
  address: string;
  x: number;
  y: number;
  medianRTT: number | null;
  label: IPAttributionEntry;
};

export function pathGeography(trace: PathTrace) {
  const rows = buildHopRows(trace);
  const points: GeographicHop[] = [];
  const unplaced: Array<{ ttl: number; address: string; reason: string }> = [];
  for (const row of rows) {
    if (!row.responders.length) unplaced.push({ ttl: row.ttl, address: '', reason: 'No reply' });
    for (const address of row.responders) {
      const label = trace.attribution?.entries.find((entry) => entry.ip === address);
      if (
        label?.status !== 'observed' ||
        label.latitude === undefined ||
        label.longitude === undefined
      ) {
        unplaced.push({ ttl: row.ttl, address, reason: label?.note || 'No provider coordinates' });
        continue;
      }
      points.push({
        key: `${row.ttl}:${address}`,
        ttl: row.ttl,
        address,
        x: label.longitude + 180,
        y: 90 - label.latitude,
        medianRTT:
          row.responderRTTs.find((value) => value.responder === address)?.rtt.median ?? null,
        label,
      });
    }
  }
  const connections: Array<{ from: GeographicHop; to: GeographicHop }> = [];
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (
      !previous ||
      !current ||
      current.ttl !== previous.ttl + 1 ||
      previous.responders.length !== 1 ||
      current.responders.length !== 1
    )
      continue;
    const from = points.find((point) => point.ttl === previous.ttl);
    const to = points.find((point) => point.ttl === current.ttl);
    // Do not draw across an unknown hop, multipath branch, or the map's seam.
    if (from && to && Math.abs(from.x - to.x) <= 180) connections.push({ from, to });
  }
  return { points, unplaced, connections };
}

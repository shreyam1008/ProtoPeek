import { expect, it } from 'vitest';
import type { PathTrace } from './network-path';
import { pathGeography } from './network-path-geography';

function fixture(
  responders: string[][],
  entries: Array<{ ip: string; latitude?: number; longitude?: number }>
) {
  return {
    hops: responders.map((addresses, index) => ({
      ttl: index + 1,
      responders: addresses,
      samples: addresses.map((responder, sequence) => ({
        sequence: sequence + 1,
        status: 'reply',
        responder,
        rttMs: 10 + index,
      })),
    })),
    attribution: { entries: entries.map((entry) => ({ ...entry, status: 'observed' })) },
  } as PathTrace;
}

it('places provider coordinates and retains timing without connecting unknown or multipath hops', () => {
  const geography = pathGeography(
    fixture(
      [['1.1.1.1'], ['8.8.8.8'], [], ['9.9.9.9'], ['4.4.4.4', '5.5.5.5']],
      [
        { ip: '1.1.1.1', latitude: 27.7, longitude: 85.3 },
        { ip: '8.8.8.8', latitude: 19.1, longitude: 72.9 },
        { ip: '9.9.9.9', latitude: 1.3, longitude: 103.8 },
        { ip: '4.4.4.4', latitude: 0, longitude: 0 },
      ]
    )
  );
  expect(geography.points[0]).toMatchObject({ x: 265.3, y: 62.3, medianRTT: 10 });
  expect(geography.points[3]).toMatchObject({ x: 180, y: 90 });
  expect(geography.connections.map(({ from, to }) => [from.ttl, to.ttl])).toEqual([[1, 2]]);
  expect(geography.unplaced).toEqual([
    { ttl: 3, address: '', reason: 'No reply' },
    { ttl: 5, address: '5.5.5.5', reason: 'No provider coordinates' },
  ]);
});

it('does not draw a misleading line across the world seam or invent coordinates for older traces', () => {
  expect(
    pathGeography(
      fixture(
        [['1.1.1.1'], ['8.8.8.8']],
        [
          { ip: '1.1.1.1', latitude: 0, longitude: 179 },
          { ip: '8.8.8.8', latitude: 0, longitude: -179 },
        ]
      )
    ).connections
  ).toEqual([]);
  expect(pathGeography(fixture([['1.1.1.1']], [{ ip: '1.1.1.1' }])).points).toEqual([]);
});

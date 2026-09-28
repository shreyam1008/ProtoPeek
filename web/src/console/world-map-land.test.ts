import { expect, it } from 'vitest';
import { worldLandPaths } from './world-map-land';

const polygons = worldLandPaths.map((path) =>
  [...path.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(
    (match) => [Number(match[1]), Number(match[2])] as const
  )
);

it('retains closed, bounded continent and island outlines in the offline map', () => {
  expect(polygons).toHaveLength(78);
  for (const polygon of polygons) {
    expect(polygon.length).toBeGreaterThanOrEqual(4);
    expect(polygon.at(-1)).toEqual(polygon[0]);
    for (const [x, y] of polygon) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(360);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(180);
    }
  }
});

it.each([
  ['North America', -100, 40],
  ['South America', -60, -15],
  ['Europe', 10, 50],
  ['Africa', 20, 0],
  ['Asia', 100, 40],
  ['Australia', 135, -25],
  ['Antarctica', 0, -85],
])('keeps %s recognizable around its continental interior', (_name, longitude, latitude) => {
  const x = Number(longitude) + 180;
  const y = 90 - Number(latitude);
  const onLand = polygons.some((polygon) => {
    let inside = false;
    for (const [index, current] of polygon.entries()) {
      const previous = polygon[index - 1];
      if (!previous) continue;
      const [ax, ay] = previous;
      const [bx, by] = current;
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
        inside = !inside;
      }
    }
    return inside;
  });
  expect(onLand).toBe(true);
});

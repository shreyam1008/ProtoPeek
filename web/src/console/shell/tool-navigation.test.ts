import { afterEach, describe, expect, it, vi } from 'vitest';
import { featureRegistry } from '../app/feature-registry';
import { readDestinationRoutes, saveDestinationRoutes, toolGroups } from './tool-navigation';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});
describe('destination navigation', () => {
  it('gives every concrete tool one place under its owning destination', () => {
    const ids = Object.values(toolGroups).flatMap((groups) =>
      groups.flatMap((group) => [...group.ids])
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(
      featureRegistry
        .filter((feature) => feature.id !== 'network')
        .map((feature) => feature.id)
        .sort()
    );
    for (const [destination, groups] of Object.entries(toolGroups)) {
      for (const id of groups.flatMap((group) => [...group.ids]))
        expect(featureRegistry.find((feature) => feature.id === id)?.destination).toBe(destination);
    }
  });
  it('restores only known routes in the correct destination', () => {
    sessionStorage.setItem(
      'protopeek.navigation.destinations.v1',
      JSON.stringify({
        network: '/network/ports',
        inspect: '/settings',
        files: 'https://example.com',
        settings: '/missing',
        home: 23,
      })
    );
    expect(readDestinationRoutes()).toEqual({ network: '/network/ports' });
    saveDestinationRoutes({ inspect: '/protocols/http', network: '/this-pc' });
    expect(readDestinationRoutes()).toEqual({ inspect: '/protocols/http', network: '/this-pc' });
  });
  it.each([
    'null',
    '[]',
    'broken',
    'x'.repeat(2049),
  ])('ignores malformed or oversized state', (value) => {
    sessionStorage.setItem('protopeek.navigation.destinations.v1', value);
    expect(readDestinationRoutes()).toEqual({});
  });
  it('keeps navigation usable when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(readDestinationRoutes()).toEqual({});
    expect(() => saveDestinationRoutes({ network: '/this-pc' })).not.toThrow();
  });
});

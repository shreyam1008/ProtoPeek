import { describe, expect, it } from 'vitest';
import {
  extensionCatalog,
  extensionIds,
  parseExtensionSnapshot,
  setupPlatform,
} from './extension-catalog';

const fixture = () => ({
  schemaVersion: 1,
  platform: 'linux',
  architecture: 'amd64',
  observedAt: '2026-09-28T00:00:00Z',
  extensions: extensionIds.map((id) => ({
    id,
    status: 'missing',
    source: 'none',
    path: '',
    message: 'Not found.',
    bundled: false,
    bundledBytes: 0,
  })),
});

describe('extension observations', () => {
  it('accepts one bounded observation for each supported integration', () => {
    expect(parseExtensionSnapshot(fixture()).extensions.map(({ id }) => id)).toEqual(extensionIds);
  });
  it.each([
    null,
    { ...fixture(), schemaVersion: 2 },
    { ...fixture(), observedAt: 'not a date' },
    { ...fixture(), extensions: [] },
    { ...fixture(), extensions: Array(5).fill(fixture().extensions[0]) },
    {
      ...fixture(),
      extensions: fixture().extensions.map((entry) => ({ ...entry, status: 'ready' })),
    },
    {
      ...fixture(),
      extensions: fixture().extensions.map((entry) => ({ ...entry, path: 'x'.repeat(4097) })),
    },
    {
      ...fixture(),
      extensions: fixture().extensions.map((entry) => ({ ...entry, bundledBytes: -1 })),
    },
  ])('rejects malformed or misleading observations', (value) => {
    expect(() => parseExtensionSnapshot(value)).toThrow('Could not read local tool status');
  });
  it('uses the host platform only when supported', () => {
    expect(setupPlatform('windows')).toBe('windows');
    expect(setupPlatform('darwin')).toBe('darwin');
    expect(setupPlatform('linux')).toBe('linux');
    expect(setupPlatform('freebsd')).toBeUndefined();
    expect(setupPlatform(undefined)).toBeUndefined();
  });
  it('lists actual workbenches with official HTTPS setup links', () => {
    expect(extensionCatalog.map(({ id }) => id)).toEqual(extensionIds);
    expect(
      extensionCatalog.filter(({ group }) => group === 'Connect & publish').map(({ id }) => id)
    ).toEqual(['tailscale', 'cloudflared', 'netbird']);
    for (const entry of extensionCatalog) {
      expect(new URL(entry.download).protocol).toBe('https:');
      expect(new URL(entry.guide).protocol).toBe('https:');
      expect(Object.keys(entry.setup).sort()).toEqual(['darwin', 'linux', 'windows']);
    }
  });
});

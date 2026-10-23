import { afterEach, expect, it, vi } from 'vitest';
import {
  extensionPreferencesKey,
  readExtensionPreferences,
  saveExtensionPreferences,
} from './extension-preferences';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it('stores only selected IDs and a manual platform, without installing or probing tools', () => {
  expect(saveExtensionPreferences({ pinned: ['codex', 'docker'], platform: 'windows' })).toBe(true);
  expect(readExtensionPreferences()).toEqual({ pinned: ['codex', 'docker'], platform: 'windows' });
  localStorage.setItem(
    extensionPreferencesKey,
    JSON.stringify({ pinned: ['codex', 'unknown', 'codex', '../../evil'], platform: 'unknown' })
  );
  expect(readExtensionPreferences()).toEqual({ pinned: ['codex'], platform: undefined });
});
it.each([
  'null',
  '[]',
  'broken',
  'x'.repeat(2049),
])('recovers from malformed preferences %s', (value) => {
  localStorage.setItem(extensionPreferencesKey, value);
  expect(readExtensionPreferences()).toEqual({ pinned: [] });
});
it('reports a failed write while reads remain safe without browser storage', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readExtensionPreferences()).toEqual({ pinned: [] });
  expect(saveExtensionPreferences({ pinned: ['docker'] })).toBe(false);
});

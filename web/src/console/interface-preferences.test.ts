import { afterEach, describe, expect, it } from 'vitest';

import {
  applyInterfacePreferences,
  defaultInterfacePreferences,
  interfacePreferencesStorageKey,
  persistInterfacePreferences,
  readInterfacePreferences,
} from './interface-preferences';

afterEach(() => {
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-keyboard-hints');
});

describe('interface preferences', () => {
  it('uses stable defaults for missing, malformed, and unknown stored values', () => {
    expect(readInterfacePreferences(null)).toEqual(defaultInterfacePreferences);
    expect(
      readInterfacePreferences({
        getItem: () => '{not-json',
        setItem: () => {},
      })
    ).toEqual(defaultInterfacePreferences);
    expect(
      readInterfacePreferences({
        getItem: () => JSON.stringify({ version: 2, density: 'tiny', showKeyboardHints: 'yes' }),
        setItem: () => {},
      })
    ).toEqual(defaultInterfacePreferences);
  });

  it('round-trips the versioned payload and applies semantic root attributes', () => {
    let stored = '';
    const storage = {
      getItem: (key: string) => (key === interfacePreferencesStorageKey ? stored : null),
      setItem: (key: string, value: string) => {
        expect(key).toBe(interfacePreferencesStorageKey);
        stored = value;
      },
    };
    const preferences = { density: 'compact' as const, showKeyboardHints: false };

    persistInterfacePreferences(preferences, storage);

    expect(JSON.parse(stored)).toEqual({ version: 1, ...preferences });
    expect(readInterfacePreferences(storage)).toEqual(preferences);

    applyInterfacePreferences(preferences);
    expect(document.documentElement).toHaveAttribute('data-density', 'compact');
    expect(document.documentElement).toHaveAttribute('data-keyboard-hints', 'hidden');
  });

  it('keeps the live interface usable when browser storage is denied', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    };

    expect(readInterfacePreferences(storage)).toEqual(defaultInterfacePreferences);
    expect(() => persistInterfacePreferences(defaultInterfacePreferences, storage)).not.toThrow();
  });
});

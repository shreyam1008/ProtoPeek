import { describe, expect, it } from 'vitest';

import { applyTheme, persistThemePreference, readThemePreference, themeStorageKey } from './theme';

describe('theme preference', () => {
  it('defaults to light and only accepts the current version', () => {
    expect(readThemePreference(null)).toBe('light');
    const stale = { getItem: () => JSON.stringify({ version: 0, theme: 'dark' }), setItem() {} };
    expect(readThemePreference(stale)).toBe('light');
  });

  it('persists a versioned preference and applies it to the document', () => {
    persistThemePreference('dark', window.localStorage);
    expect(JSON.parse(window.localStorage.getItem(themeStorageKey) ?? '')).toEqual({
      version: 1,
      theme: 'dark',
    });
    expect(readThemePreference(window.localStorage)).toBe('dark');
    applyTheme('dark', document.documentElement);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('guards storage failures', () => {
    const denied = {
      getItem(): string | null {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem(): void {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    expect(readThemePreference(denied)).toBe('light');
    expect(() => persistThemePreference('dark', denied)).not.toThrow();
  });
});

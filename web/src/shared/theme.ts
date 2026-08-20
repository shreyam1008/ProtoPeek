export type ProtoPeekTheme = 'light' | 'dark';

export const themeStorageKey = 'protopeek.theme.v1';
const themePreferenceVersion = 1;

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readThemePreference(storage?: ThemeStorage | null): ProtoPeekTheme {
  if (storage === undefined && typeof window !== 'undefined') {
    try {
      storage = window.localStorage;
    } catch {
      return 'light';
    }
  }
  if (!storage) return 'light';

  try {
    const parsed = JSON.parse(storage.getItem(themeStorageKey) ?? '') as {
      version?: unknown;
      theme?: unknown;
    };
    if (
      parsed.version === themePreferenceVersion &&
      (parsed.theme === 'light' || parsed.theme === 'dark')
    ) {
      return parsed.theme;
    }
  } catch {
    // Missing, malformed, or denied storage all use the light first-run default.
  }
  return 'light';
}

export function persistThemePreference(theme: ProtoPeekTheme, storage?: ThemeStorage | null) {
  if (storage === undefined && typeof window !== 'undefined') {
    try {
      storage = window.localStorage;
    } catch {
      return;
    }
  }
  if (!storage) return;
  try {
    storage.setItem(themeStorageKey, JSON.stringify({ version: themePreferenceVersion, theme }));
  } catch {
    // The selected theme remains active for this session even when persistence fails.
  }
}

export function applyTheme(theme: ProtoPeekTheme, root?: HTMLElement | null) {
  root?.setAttribute('data-theme', theme);
}

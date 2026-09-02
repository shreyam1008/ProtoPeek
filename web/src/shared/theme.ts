export const appearanceModes = ['system', 'light', 'dark'] as const;
export const appearancePalettes = [
  'protopeek',
  'graphite',
  'nord',
  'solarized',
  'high-contrast',
] as const;

export type AppearanceMode = (typeof appearanceModes)[number];
export type AppearancePalette = (typeof appearancePalettes)[number];
export type ProtoPeekTheme = 'light' | 'dark';

export type AppearancePreference = {
  version: 2;
  mode: AppearanceMode;
  palette: AppearancePalette;
};

export type ResolvedAppearance = AppearancePreference & { theme: ProtoPeekTheme };

export const appearanceStorageKey = 'protopeek.appearance.v2';
export const themeStorageKey = 'protopeek.theme.v1';
export const defaultAppearancePreference: AppearancePreference = {
  version: 2,
  mode: 'system',
  palette: 'graphite',
};

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return appearanceModes.some((mode) => mode === value);
}

function isAppearancePalette(value: unknown): value is AppearancePalette {
  return appearancePalettes.some((palette) => palette === value);
}

export function parseAppearancePreference(value: unknown): AppearancePreference | null {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    !isAppearanceMode(value.mode) ||
    !isAppearancePalette(value.palette)
  ) {
    return null;
  }
  return { version: 2, mode: value.mode, palette: value.palette };
}

function parseStoredValue(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveStorage(storage?: ThemeStorage | null): ThemeStorage | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function fallbackAppearance(): AppearancePreference {
  return { ...defaultAppearancePreference };
}

export function readAppearancePreference(storage?: ThemeStorage | null): AppearancePreference {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return fallbackAppearance();

  let current: AppearancePreference | null;
  try {
    current = parseAppearancePreference(
      parseStoredValue(resolvedStorage.getItem(appearanceStorageKey))
    );
  } catch {
    return fallbackAppearance();
  }
  if (current) return current;

  let legacy: unknown;
  try {
    legacy = parseStoredValue(resolvedStorage.getItem(themeStorageKey));
  } catch {
    return fallbackAppearance();
  }
  if (
    !isRecord(legacy) ||
    legacy.version !== 1 ||
    (legacy.theme !== 'light' && legacy.theme !== 'dark')
  ) {
    return fallbackAppearance();
  }

  const migrated: AppearancePreference = {
    version: 2,
    mode: legacy.theme,
    palette: 'graphite',
  };
  persistAppearancePreference(migrated, resolvedStorage);
  return migrated;
}

export function persistAppearancePreference(
  preference: AppearancePreference,
  storage?: ThemeStorage | null
) {
  const normalized = parseAppearancePreference(preference);
  if (!normalized) return;
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.setItem(appearanceStorageKey, JSON.stringify(normalized));
  } catch {
    // The selected appearance remains active for this session when persistence is denied.
  }
}

export function resolveAppearanceTheme(mode: AppearanceMode, prefersDark: boolean): ProtoPeekTheme {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
}

export function resolveAppearance(
  preference: AppearancePreference,
  prefersDark: boolean
): ResolvedAppearance {
  return {
    ...preference,
    theme: resolveAppearanceTheme(preference.mode, prefersDark),
  };
}

export function applyAppearance(
  preference: AppearancePreference,
  prefersDark: boolean,
  root?: HTMLElement | null
) {
  if (!root) return;
  const resolved = resolveAppearance(preference, prefersDark);
  root.setAttribute('data-theme', resolved.theme);
  root.setAttribute('data-theme-mode', resolved.mode);
  root.setAttribute('data-palette', resolved.palette);
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

// Compatibility helpers for callers that still consume the original two-theme API.
export function readThemePreference(storage?: ThemeStorage | null): ProtoPeekTheme {
  const preference = readAppearancePreference(storage);
  return resolveAppearanceTheme(preference.mode, systemPrefersDark());
}

export function persistThemePreference(theme: ProtoPeekTheme, storage?: ThemeStorage | null) {
  const current = readAppearancePreference(storage);
  persistAppearancePreference({ ...current, mode: theme }, storage);
}

export function applyTheme(theme: ProtoPeekTheme, root?: HTMLElement | null) {
  const palette = root?.getAttribute('data-palette');
  applyAppearance(
    {
      version: 2,
      mode: theme,
      palette: isAppearancePalette(palette) ? palette : 'graphite',
    },
    theme === 'dark',
    root
  );
}

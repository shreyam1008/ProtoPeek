export type InterfaceDensity = 'comfortable' | 'compact';

export type InterfacePreferences = {
  density: InterfaceDensity;
  showKeyboardHints: boolean;
};

export const interfacePreferencesStorageKey = 'protopeek.interface.v1';
export const defaultInterfacePreferences: InterfacePreferences = {
  density: 'comfortable',
  showKeyboardHints: true,
};

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readInterfacePreferences(storage?: PreferenceStorage | null): InterfacePreferences {
  if (storage === undefined && typeof window !== 'undefined') {
    try {
      storage = window.localStorage;
    } catch {
      return defaultInterfacePreferences;
    }
  }
  if (!storage) return defaultInterfacePreferences;

  try {
    const parsed = JSON.parse(storage.getItem(interfacePreferencesStorageKey) ?? '') as {
      version?: unknown;
      density?: unknown;
      showKeyboardHints?: unknown;
    };
    if (
      parsed.version === 1 &&
      (parsed.density === 'comfortable' || parsed.density === 'compact') &&
      typeof parsed.showKeyboardHints === 'boolean'
    ) {
      return {
        density: parsed.density,
        showKeyboardHints: parsed.showKeyboardHints,
      };
    }
  } catch {
    // Missing, malformed, or denied browser storage uses the stable defaults.
  }
  return defaultInterfacePreferences;
}

export function persistInterfacePreferences(
  preferences: InterfacePreferences,
  storage?: PreferenceStorage | null
) {
  if (storage === undefined && typeof window !== 'undefined') {
    try {
      storage = window.localStorage;
    } catch {
      return false;
    }
  }
  if (!storage) return false;

  try {
    storage.setItem(interfacePreferencesStorageKey, JSON.stringify({ version: 1, ...preferences }));
    return true;
  } catch {
    return false;
  }
}

export function applyInterfacePreferences(
  preferences: InterfacePreferences,
  root?: HTMLElement | null
) {
  if (root === undefined && typeof document !== 'undefined') root = document.documentElement;
  root?.setAttribute('data-density', preferences.density);
  root?.setAttribute('data-keyboard-hints', preferences.showKeyboardHints ? 'shown' : 'hidden');
}

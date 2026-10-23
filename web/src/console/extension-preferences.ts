import {
  type ExtensionId,
  isExtensionId,
  type SetupPlatform,
  setupPlatform,
} from './extension-catalog';
export const extensionPreferencesKey = 'protopeek.extensions.preferences.v1';
export type ExtensionPreferences = { pinned: ExtensionId[]; platform?: SetupPlatform };
export function readExtensionPreferences(): ExtensionPreferences {
  try {
    const raw = localStorage.getItem(extensionPreferencesKey);
    if (!raw || raw.length > 2048) return { pinned: [] };
    const value = JSON.parse(raw) as Partial<ExtensionPreferences> | null;
    if (!value || typeof value !== 'object' || !Array.isArray(value.pinned)) return { pinned: [] };
    return {
      pinned: [...new Set(value.pinned.filter(isExtensionId))].slice(0, 20),
      platform: setupPlatform(value.platform),
    };
  } catch {
    return { pinned: [] };
  }
}
export function saveExtensionPreferences(value: ExtensionPreferences): boolean {
  try {
    localStorage.setItem(extensionPreferencesKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

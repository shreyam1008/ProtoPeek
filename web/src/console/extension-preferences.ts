import {
  type ExtensionId,
  isExtensionId,
  type SetupPlatform,
  setupPlatform,
} from './extension-catalog';
import { type MediaPack, mediaPacks } from './MediaPacks';
export type PinnedToolId = ExtensionId | MediaPack['id'];
function isPinnedToolId(value: unknown): value is PinnedToolId {
  return isExtensionId(value) || mediaPacks.some((tool) => tool.id === value);
}
export const extensionPreferencesKey = 'protopeek.extensions.preferences.v1';
export type ExtensionPreferences = { pinned: PinnedToolId[]; platform?: SetupPlatform };
export function readExtensionPreferences(): ExtensionPreferences {
  try {
    const raw = localStorage.getItem(extensionPreferencesKey);
    if (!raw || raw.length > 2048) return { pinned: [] };
    const value = JSON.parse(raw) as Partial<ExtensionPreferences> | null;
    if (!value || typeof value !== 'object' || !Array.isArray(value.pinned)) return { pinned: [] };
    return {
      pinned: [...new Set(value.pinned.filter(isPinnedToolId))],
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

import { loadStoredValue, storeValue } from '@/shared/runtime';

export const sidebarCollapsedStorageKey = 'protopeek.navigation.sidebarCollapsed.v1';

export function readSidebarCollapsed() {
  return loadStoredValue<unknown>(sidebarCollapsedStorageKey, false) === true;
}

export function persistSidebarCollapsed(collapsed: boolean) {
  return storeValue(sidebarCollapsedStorageKey, collapsed);
}

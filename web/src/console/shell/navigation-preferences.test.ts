import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  persistSidebarCollapsed,
  readSidebarCollapsed,
  sidebarCollapsedStorageKey,
} from './navigation-preferences';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('sidebar preference', () => {
  it('defaults to expanded and restores either saved choice', () => {
    expect(readSidebarCollapsed()).toBe(false);
    expect(persistSidebarCollapsed(true)).toEqual({ ok: true });
    expect(readSidebarCollapsed()).toBe(true);
    persistSidebarCollapsed(false);
    expect(readSidebarCollapsed()).toBe(false);
  });

  it.each(['null', '[]', '{}', '"true"', '1', 'broken'])('ignores invalid state %s', (value) => {
    localStorage.setItem(sidebarCollapsedStorageKey, value);
    expect(readSidebarCollapsed()).toBe(false);
  });

  it('tolerates denied reads and failed writes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(readSidebarCollapsed()).toBe(false);
    expect(persistSidebarCollapsed(true)).toEqual({ ok: false, error: 'full' });
  });
});

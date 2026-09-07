import { afterEach, expect, it, vi } from 'vitest';
import { readWebsiteTargets, rememberWebsiteTarget } from './website-draft';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it('retains only an origin/domain and permits forgetting each independently', () => {
  expect(rememberWebsiteTarget('origin', 'https://example.com/private/path')).toBe(true);
  expect(rememberWebsiteTarget('domain', 'WWW.EXAMPLE.COM.')).toBe(true);
  expect(readWebsiteTargets()).toEqual({
    origin: 'https://example.com',
    domain: 'www.example.com',
  });
  expect(localStorage.getItem('protopeek.website.targets.v1')).not.toContain('private');
  rememberWebsiteTarget('origin', '');
  expect(readWebsiteTargets().domain).toBe('www.example.com');
  rememberWebsiteTarget('domain', '');
  expect(localStorage.getItem('protopeek.website.targets.v1')).toBeNull();
});
it('rejects credentials and survives invalid or blocked storage', () => {
  expect(rememberWebsiteTarget('origin', 'https://user:secret@example.com')).toBe(false);
  localStorage.setItem('protopeek.website.targets.v1', '{');
  expect(readWebsiteTargets()).toEqual({});
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage denied');
  });
  expect(rememberWebsiteTarget('domain', 'example.com')).toBe(false);
});

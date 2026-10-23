import { afterEach, expect, it, vi } from 'vitest';
import { clearPendingHandoff, peekPendingHandoff } from './app/handoff-store';
import {
  normalizePathDestination,
  preparePathTarget,
  takePathHandoff,
  takePathTarget,
} from './network-path-draft';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  takePathTarget();
  clearPendingHandoff();
});

it('migrates an existing legacy target once as a manual unsent draft', () => {
  sessionStorage.setItem('protopeek.network.path-target.v1', 'legacy.example.test');
  expect(takePathHandoff()).toMatchObject({
    provenance: { source: 'legacy-path-handoff', quality: 'manual' },
    draft: { kind: 'path-target-draft', target: { target: 'legacy.example.test' } },
  });
  expect(sessionStorage.getItem('protopeek.network.path-target.v1')).toBeNull();
  sessionStorage.setItem('protopeek.network.path-target.v1', 'obsolete.example.test');
  expect(takePathHandoff()).toBeNull();
});

it('extracts only the hostname from a website URL and consumes the draft once', () => {
  sessionStorage.setItem('protopeek.network.path-target.v1', 'obsolete.example.test');
  expect(preparePathTarget('https://example.com/private/path?session=secret')).toBe(true);
  expect(sessionStorage.getItem('protopeek.network.path-target.v1')).toBeNull();
  expect(peekPendingHandoff('path-target-draft')?.draft.target.target).toBe('example.com');
  expect(takePathTarget()).toBe('example.com');
  expect(sessionStorage.getItem('protopeek.network.path-target.v1')).toBeNull();
  expect(takePathTarget()).toBe('');
  expect(normalizePathDestination('https://[2001:db8::1]:8443/')).toBe('2001:db8::1');
  for (const input of [
    'https://user:secret@example.com/',
    'file:///etc/hosts',
    'example.com/path',
    'example.com\nother',
  ])
    expect(() => normalizePathDestination(input)).toThrow();
});

it('keeps a one-use same-tab draft when browser storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  preparePathTarget('example.com');
  expect(takePathTarget()).toBe('example.com');
  expect(takePathTarget()).toBe('');
});

import { afterEach, expect, it, vi } from 'vitest';
import {
  forgetCanonicalPlan,
  recoverCanonicalPlan,
  rememberCanonicalPlan,
} from './canonical-plan-store';

const key = 'protopeek.canonical-rollback.v1';
const plan = () => ({
  id: 'private-plan',
  path: '/fixture/config.yml',
  beforeRevision: 'a'.repeat(64),
  afterRevision: 'b'.repeat(64),
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  applied: false,
  route: {
    hostname: 'PRIVATE_ROUTE',
    path: '/PRIVATE_PATH',
    service: 'http://PRIVATE_ORIGIN:8080',
  },
});
afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('retains only a bounded rollback reference and requires the freshly observed applied hash', () => {
  const value = plan();
  expect(rememberCanonicalPlan(value)).toBe(true);
  const stored = sessionStorage.getItem(key) ?? '';
  expect(stored).not.toMatch(/PRIVATE|route|service|hostname/);
  expect(recoverCanonicalPlan(value.path, value.beforeRevision)).toBeNull();
  expect(recoverCanonicalPlan('/other/config.yml', value.afterRevision)).toBeNull();
  expect(recoverCanonicalPlan(value.path, value.afterRevision)).toMatchObject({
    id: value.id,
    applied: true,
  });
  forgetCanonicalPlan(value.id);
  expect(recoverCanonicalPlan(value.path, value.afterRevision)).toBeNull();
});

it('expires references, rejects malformed or oversized storage and keeps at most four files', () => {
  vi.useFakeTimers();
  const value = plan();
  for (let index = 0; index < 6; index++)
    rememberCanonicalPlan({ ...value, path: `/fixture/${index}.yml` });
  expect(JSON.parse(sessionStorage.getItem(key) ?? '[]')).toHaveLength(4);
  expect(recoverCanonicalPlan('/fixture/0.yml', value.afterRevision)).toBeNull();
  vi.advanceTimersByTime(10 * 60 * 1000 + 1);
  expect(recoverCanonicalPlan('/fixture/5.yml', value.afterRevision)).toBeNull();
  for (const raw of [
    '{',
    JSON.stringify([{ ...plan(), afterRevision: 'not-a-hash' }]),
    'x'.repeat(24 * 1024 + 1),
  ]) {
    sessionStorage.setItem(key, raw);
    expect(recoverCanonicalPlan(value.path, value.afterRevision)).toBeNull();
  }
});

it('reports unavailable session storage without preventing host-side guards', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(rememberCanonicalPlan(plan())).toBe(false);
  expect(recoverCanonicalPlan(plan().path, plan().afterRevision)).toBeNull();
});

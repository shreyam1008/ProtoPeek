import type { CanonicalPlan } from './canonical-api';

const key = 'protopeek.canonical-rollback.v1';
type Reference = Pick<
  CanonicalPlan,
  'id' | 'path' | 'beforeRevision' | 'afterRevision' | 'expiresAt'
>;
function references(): Reference[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 24 * 1024) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 4) return [];
    const now = Date.now();
    return value
      .filter((entry): entry is Reference => {
        if (!entry || typeof entry !== 'object') return false;
        const { id, path, beforeRevision, afterRevision, expiresAt } = entry;
        const expires = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
        return (
          typeof id === 'string' &&
          /^[\w-]{1,64}$/.test(id) &&
          typeof path === 'string' &&
          path.length > 0 &&
          path.length <= 4096 &&
          ![...path].some((character) => character.charCodeAt(0) < 32) &&
          typeof beforeRevision === 'string' &&
          /^[a-f0-9]{64}$/.test(beforeRevision) &&
          typeof afterRevision === 'string' &&
          /^[a-f0-9]{64}$/.test(afterRevision) &&
          expires > now &&
          expires <= now + 11 * 60 * 1000
        );
      })
      .map(({ id, path, beforeRevision, afterRevision, expiresAt }) => ({
        id,
        path,
        beforeRevision,
        afterRevision,
        expiresAt,
      }));
  } catch {
    return [];
  }
}

// Only references are retained here. YAML, route contents and rollback bytes stay on the host.
export function rememberCanonicalPlan(plan: CanonicalPlan): boolean {
  try {
    const { id, path, beforeRevision, afterRevision, expiresAt } = plan;
    const next = { id, path, beforeRevision, afterRevision, expiresAt };
    sessionStorage.setItem(
      key,
      JSON.stringify([next, ...references().filter((entry) => entry.path !== path)].slice(0, 4))
    );
    return true;
  } catch {
    return false;
  }
}

export function recoverCanonicalPlan(path: string, revision: string): CanonicalPlan | null {
  const reference = references().find(
    (entry) => entry.path === path && entry.afterRevision === revision
  );
  return reference
    ? { ...reference, applied: true, route: { hostname: '', path: '', service: '' } }
    : null;
}

export function forgetCanonicalPlan(id: string) {
  try {
    sessionStorage.setItem(key, JSON.stringify(references().filter((entry) => entry.id !== id)));
  } catch {
    /* The native expiry and hash guards still apply when storage is unavailable. */
  }
}

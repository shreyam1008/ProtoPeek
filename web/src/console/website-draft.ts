import { normalizeDomainHost, normalizeWebsiteURL } from './security-api';

const key = 'protopeek.website.targets.v1';
type Targets = { origin?: string; domain?: string };

export function readWebsiteTargets(): Targets {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 4096) return {};
    const value = JSON.parse(raw) as Targets;
    if (!value || typeof value !== 'object') return {};
    return {
      origin:
        typeof value.origin === 'string'
          ? new URL(normalizeWebsiteURL(value.origin)).origin
          : undefined,
      domain: typeof value.domain === 'string' ? normalizeDomainHost(value.domain) : undefined,
    };
  } catch {
    return {};
  }
}

// Save only the origin/domain, never URL paths, queries, credentials, results, or consent.
export function rememberWebsiteTarget(type: 'origin' | 'domain', input: string): boolean {
  try {
    const current = readWebsiteTargets();
    current[type] = input
      ? type === 'origin'
        ? new URL(normalizeWebsiteURL(input)).origin
        : normalizeDomainHost(input)
      : undefined;
    if (!current.origin && !current.domain) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

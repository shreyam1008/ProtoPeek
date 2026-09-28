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

// A host trace does not carry scheme or port. Preserve the website origin when it matches.
export function rememberPathWebsiteTarget(destination: string): boolean {
  const hostname = destination
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  const origin = readWebsiteTargets().origin;
  if (origin && new URL(origin).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '') === hostname)
    return true;
  return rememberWebsiteTarget(
    'origin',
    `https://${hostname.includes(':') ? `[${hostname}]` : hostname}`
  );
}

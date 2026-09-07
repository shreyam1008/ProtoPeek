import { csrfToken, normalizeWebsiteURL, readBoundedText } from './security-api';

export const websitePaths = [
  '/robots.txt',
  '/sitemap.xml',
  '/.well-known/security.txt',
  '/security.txt',
  '/.__protopeek_missing_resource__',
] as const;
export type WebsitePathEvidence = {
  path: string;
  statusCode?: number;
  contentType?: string;
  contentLength?: string;
  redirectLocation?: string;
  totalMs: number;
  error?: string;
};
export type WebsitePathsResult = {
  origin: string;
  observedAt: string;
  partial: boolean;
  paths: WebsitePathEvidence[];
};

export async function fetchWebsitePaths(
  url: string,
  signal: AbortSignal
): Promise<WebsitePathsResult> {
  const origin = new URL(normalizeWebsiteURL(url)).origin;
  const response = await fetch(new URL('api/security/paths', window.location.href), {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-protopeek-csrf-token': csrfToken() },
    body: JSON.stringify({ url: origin, acknowledgePublicRequest: true }),
  });
  const { text, truncated } = await readBoundedText(response, 64 * 1024);
  if (truncated) throw new Error('Website path evidence exceeded 64 KiB.');
  if (!response.ok) throw new Error(text.slice(0, 1024) || 'Website path checks failed.');
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object') throw new Error('Malformed website path evidence.');
  const value = data as WebsitePathsResult;
  if (
    value.origin !== origin ||
    typeof value.observedAt !== 'string' ||
    value.observedAt.length > 64 ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    typeof value.partial !== 'boolean' ||
    !Array.isArray(value.paths) ||
    value.paths.length !== websitePaths.length
  )
    throw new Error('Inconsistent website path evidence.');
  for (const [index, entry] of value.paths.entries()) {
    if (
      !entry ||
      entry.path !== websitePaths[index] ||
      !Number.isFinite(entry.totalMs) ||
      entry.totalMs < 0 ||
      entry.totalMs > 30_000 ||
      (entry.statusCode !== undefined &&
        (!Number.isInteger(entry.statusCode) || entry.statusCode < 100 || entry.statusCode > 599))
    )
      throw new Error('Malformed website path response.');
    for (const key of ['contentType', 'contentLength', 'redirectLocation', 'error'] as const) {
      if (entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > 8192))
        throw new Error('Malformed website path detail.');
    }
    if (!entry.statusCode && !entry.error) throw new Error('Missing website path outcome.');
  }
  return value;
}

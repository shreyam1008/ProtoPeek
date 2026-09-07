export const attributionSource = 'https://ipwhois.io/documentation';
export type IPAttributionEntry = {
  ip: string;
  status: 'observed' | 'failed' | 'skipped';
  country: string;
  region: string;
  city: string;
  asn: number;
  organization: string;
  isp: string;
  observedAt: string;
  cached: boolean;
  note: string;
};
export type IPAttribution = { source: string; entries: IPAttributionEntry[] };

function text(value: unknown, max: number): string {
  if (value === undefined) return '';
  if (
    typeof value !== 'string' ||
    value.length > max ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('Malformed IP attribution text.');
  return value;
}

function canonicalIP(value: string) {
  const zone = value.indexOf('%');
  const scope = zone >= 0 ? value.slice(zone) : '';
  if (scope && !/^%[\w.-]{1,64}$/.test(scope)) throw new Error('Malformed IP attribution scope.');
  if (zone >= 0) value = value.slice(0, zone);
  if (!/^[\da-fA-F:.]+$/.test(value)) throw new Error('Malformed IP attribution address.');
  const host = value.includes(':') ? `[${value}]` : value;
  const normalized = new URL(`http://${host}/`).hostname.replace(/^\[|\]$/g, '');
  const mapped = normalized.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  if (mapped) {
    const high = Number.parseInt(mapped[1] ?? '', 16);
    const low = Number.parseInt(mapped[2] ?? '', 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return normalized + scope;
}

export function normalizeIPAttribution(value: unknown, addresses: string[]): IPAttribution {
  if (!value || typeof value !== 'object') throw new Error('Malformed IP attribution.');
  const data = value as Record<string, unknown>;
  if (data.source !== attributionSource || !Array.isArray(data.entries) || data.entries.length > 32)
    throw new Error('Unexpected attribution source or size.');
  const allowed = new Set(addresses.map(canonicalIP));
  const seen = new Set<string>();
  const entries = data.entries.map((input): IPAttributionEntry => {
    if (!input || typeof input !== 'object') throw new Error('Malformed IP attribution entry.');
    const entry = input as Record<string, unknown>;
    const ip = canonicalIP(text(entry.ip, 256));
    if (
      !allowed.has(ip) ||
      seen.has(ip) ||
      !['observed', 'failed', 'skipped'].includes(String(entry.status))
    )
      throw new Error('IP attribution does not match the requested addresses.');
    seen.add(ip);
    const observedAt = text(entry.observedAt, 64);
    if (!Number.isFinite(Date.parse(observedAt)) || typeof entry.cached !== 'boolean')
      throw new Error('Malformed attribution observation time.');
    const asn = entry.asn ?? 0;
    if (typeof asn !== 'number' || !Number.isInteger(asn) || asn < 0 || asn > 4294967295)
      throw new Error('Malformed ASN.');
    return {
      ip,
      status: entry.status as IPAttributionEntry['status'],
      country: text(entry.country, 128),
      region: text(entry.region, 128),
      city: text(entry.city, 128),
      organization: text(entry.organization, 256),
      isp: text(entry.isp, 256),
      asn,
      observedAt: new Date(observedAt).toISOString(),
      cached: entry.cached,
      note: text(entry.note, 256),
    };
  });
  return { source: attributionSource, entries };
}

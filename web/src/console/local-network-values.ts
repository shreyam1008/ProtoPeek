export const contractLimits = {
  maxProfiles: 16,
  maxInterfaces: 32,
  maxWarnings: 32,
  maxStringBytes: 2 * 1024,
  maxPorts: 18,
  maxAttempts: 4_572,
  maxWorkers: 32,
  maxDeadlineMs: 15_000,
  maxDiscoveryHosts: 254,
  maxProtocolsPerPort: 16,
  maxServicesPerPort: 16,
  maxEvidenceNotes: 32,
  maxHintsPerHost: 16,
} as const;

export const utf8 = new TextEncoder();

export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
) {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new Error(`${label}.${key} is not supported.`);
  }
}

export function array(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array with at most ${maximum} items.`);
  }
  return value;
}

export function string(value: unknown, label: string, maximum = contractLimits.maxStringBytes) {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    utf8.encode(value).byteLength > maximum
  ) {
    throw new Error(`${label} must be a bounded string.`);
  }
  return value;
}

export function nonEmptyString(
  value: unknown,
  label: string,
  maximum = contractLimits.maxStringBytes
) {
  const result = string(value, label, maximum);
  if (!result.trim()) throw new Error(`${label} must not be empty.`);
  return result;
}

export function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export function normalizeStringArray(
  value: unknown,
  label: string,
  maximum: number,
  maximumStringBytes = contractLimits.maxStringBytes
) {
  return array(value, label, maximum).map((entry, index) =>
    string(entry, `${label}[${index}]`, maximumStringBytes)
  );
}

export function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

export function timestamp(value: unknown, label: string) {
  const result = nonEmptyString(value, label, 128);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a timestamp.`);
  return parsed.toISOString();
}

export function truncateUTF8(value: string, maximum: number) {
  if (utf8.encode(value).byteLength <= maximum) return value;
  const suffix = '…';
  const budget = maximum - utf8.encode(suffix).byteLength;
  const result: string[] = [];
  let length = 0;
  for (const character of value) {
    const bytes = utf8.encode(character).byteLength;
    if (length + bytes > budget) break;
    result.push(character);
    length += bytes;
  }
  return `${result.join('')}${suffix}`;
}

export type ParsedIPv4CIDR = {
  address: number;
  network: number;
  prefix: number;
  canonical: string;
};

export function parseIPv4Address(value: unknown, label: string) {
  const input = nonEmptyString(value, label, 15);
  const octets = input.split('.');
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !/^\d{1,3}$/.test(octet) || String(Number(octet)) !== octet || Number(octet) > 255
    )
  ) {
    throw new Error(`${label} must be a valid IPv4 address.`);
  }
  return octets.reduce((result, octet) => (result * 256 + Number(octet)) >>> 0, 0);
}

export function formatIPv4(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

export function privateIPv4(value: number) {
  const first = value >>> 24;
  const second = (value >>> 16) & 255;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function parseIPv4CIDR(value: unknown, label: string): ParsedIPv4CIDR {
  const input = nonEmptyString(value, label, 32).trim();
  const parts = input.split('/');
  if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1] ?? '')) {
    throw new Error(`${label} must be an explicit IPv4 CIDR.`);
  }
  const address = parseIPv4Address(parts[0], `${label} address`);
  const prefix = Number(parts[1]);
  if (prefix < 0 || prefix > 32) throw new Error(`${label} must use a prefix from /0 through /32.`);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (address & mask) >>> 0;
  return { address, network, prefix, canonical: `${formatIPv4(network)}/${prefix}` };
}

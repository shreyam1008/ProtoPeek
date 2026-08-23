export type DomainCandidate = {
  name: string;
  wildcard: boolean;
};

export type DomainCandidatesResult = {
  apex: string;
  source: string;
  observedAt: string;
  candidates: DomainCandidate[];
  discarded: number;
  truncated: boolean;
  cached: boolean;
};

export type WebsiteTLSEvidence = {
  version: string;
  cipherSuite: string;
  negotiatedProtocol: string;
  serverName: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  dnsNames: string[];
  verifiedChains: number;
};

export type WebsiteObservationResult = {
  observedAt: string;
  url: string;
  method: 'HEAD';
  dns: {
    hostname: string;
    pinnedAddresses: string[];
    resolutionMs: number;
  };
  http: {
    statusCode: number;
    status: string;
    protocol: string;
    headers: Record<string, string[]>;
    redirectLocation: string;
  };
  tls: WebsiteTLSEvidence | null;
  timings: {
    connectMs: number | null;
    tlsHandshakeMs: number | null;
    firstByteMs: number | null;
    totalMs: number;
  };
};

const responseByteLimit = 256 * 1024;
const websiteResponseByteLimit = 512 * 1024;
const errorByteLimit = 8 * 1024;
const maximumCandidates = 256;
const maximumInputBytes = 1024;
const maximumWebsiteURLBytes = 8 * 1024;
const fixedSourceOrigin = 'https://crt.name';
const fixedSourcePath = '/v1/search';

const retainedWebsiteHeaders = new Map(
  [
    'Age',
    'Cache-Control',
    'Content-Length',
    'Content-Security-Policy',
    'Content-Type',
    'Date',
    'ETag',
    'Expires',
    'Last-Modified',
    'Permissions-Policy',
    'Referrer-Policy',
    'Server',
    'Strict-Transport-Security',
    'Vary',
    'Via',
    'X-Content-Type-Options',
    'X-Frame-Options',
  ].map((name) => [name.toLowerCase(), name])
);

const ipv4Pattern = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const hostnameLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export class SecurityAPIError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'SecurityAPIError';
    this.status = status;
  }
}

function csrfToken() {
  return document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function inputByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

// normalizeDomainHost accepts a DNS host/apex, not a URL or IP address. URL's
// native IDNA implementation provides the same ASCII form sent to the server.
export function normalizeDomainHost(input: string) {
  const value = input.trim();
  if (!value) throw new Error('Enter a domain or host first.');
  if (inputByteLength(value) > maximumInputBytes) throw new Error('The host is too long.');
  if (value.includes('://')) throw new Error('Enter only a domain or host, without a URL scheme.');
  if (/[/?#]/.test(value)) throw new Error('Enter only a domain or host, without a path or query.');
  if (value.includes(':')) throw new Error('Enter a host without a port.');

  let parsed: URL;
  try {
    parsed = new URL(`https://${value}`);
  } catch {
    throw new Error('Enter a valid domain or host.');
  }
  if (parsed.username || parsed.password) throw new Error('Credentials are not allowed.');
  if (parsed.port) throw new Error('Enter a host without a port.');

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !hostname ||
    hostname.length > 253 ||
    !hostname.includes('.') ||
    hostname.includes(':') ||
    hostname.startsWith('[') ||
    ipv4Pattern.test(hostname)
  ) {
    throw new Error('Enter a registrable domain name, not an IP or single-label host.');
  }
  const labels = hostname.split('.');
  if (labels.some((label) => !hostnameLabelPattern.test(label))) {
    throw new Error('Enter a valid domain or host.');
  }
  return hostname;
}

export function normalizeWebsiteURL(input: string) {
  const value = input.trim();
  if (!value) throw new Error('Enter a public website URL first.');
  if (inputByteLength(value) > maximumWebsiteURLBytes) throw new Error('The URL is too long.');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Enter a complete HTTP or HTTPS URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS website URLs are supported.');
  }
  if (parsed.username || parsed.password) throw new Error('Credentials are not allowed.');
  if (!parsed.hostname) throw new Error('Enter a URL with a hostname.');
  if (parsed.search) throw new Error('Remove the URL query before observing the website.');
  if (parsed.hash) throw new Error('Remove the URL fragment before observing the website.');
  return parsed.toString();
}

function normalizeSource(value: unknown, apex: string) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new SecurityAPIError('ProtoPeek returned malformed source evidence.');
  }
  let source: URL;
  try {
    source = new URL(value);
  } catch {
    throw new SecurityAPIError('ProtoPeek returned malformed source evidence.');
  }
  if (
    source.origin !== fixedSourceOrigin ||
    source.pathname !== fixedSourcePath ||
    source.searchParams.get('apex') !== apex
  ) {
    throw new SecurityAPIError('ProtoPeek returned unexpected source evidence.');
  }
  return source.toString();
}

function normalizeObservedAt(value: unknown) {
  if (typeof value !== 'string' || value.length > 64) {
    throw new SecurityAPIError('ProtoPeek returned a malformed observation time.');
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new SecurityAPIError('ProtoPeek returned a malformed observation time.');
  }
  return timestamp.toISOString();
}

function normalizeNonNegativeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SecurityAPIError(`ProtoPeek returned a malformed ${field}.`);
  }
  return Math.min(value as number, 1_000_000);
}

function normalizeCandidate(value: unknown, apex: string): DomainCandidate {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.wildcard !== 'boolean') {
    throw new SecurityAPIError('ProtoPeek returned a malformed certificate-name candidate.');
  }
  if (value.name.length > 255) {
    throw new SecurityAPIError('ProtoPeek returned an oversized certificate-name candidate.');
  }
  const wildcardPrefix = value.name.startsWith('*.');
  if (wildcardPrefix !== value.wildcard || value.name.slice(2).includes('*')) {
    throw new SecurityAPIError('ProtoPeek returned inconsistent wildcard evidence.');
  }
  let candidateHost: string;
  try {
    candidateHost = normalizeDomainHost(wildcardPrefix ? value.name.slice(2) : value.name);
  } catch {
    throw new SecurityAPIError('ProtoPeek returned a malformed certificate-name candidate.');
  }
  if (candidateHost !== apex && !candidateHost.endsWith(`.${apex}`)) {
    throw new SecurityAPIError('ProtoPeek returned an out-of-scope certificate name.');
  }
  return {
    name: wildcardPrefix ? `*.${candidateHost}` : candidateHost,
    wildcard: value.wildcard,
  };
}

export function normalizeDomainCandidatesResult(input: unknown): DomainCandidatesResult {
  if (!isRecord(input)) throw new SecurityAPIError('ProtoPeek returned malformed domain evidence.');
  if (typeof input.apex !== 'string') {
    throw new SecurityAPIError('ProtoPeek returned a malformed registrable domain.');
  }
  let apex: string;
  try {
    apex = normalizeDomainHost(input.apex);
  } catch {
    throw new SecurityAPIError('ProtoPeek returned a malformed registrable domain.');
  }
  if (!Array.isArray(input.candidates) || input.candidates.length > maximumCandidates) {
    throw new SecurityAPIError('ProtoPeek returned too many certificate-name candidates.');
  }

  const seen = new Set<string>();
  const candidates: DomainCandidate[] = [];
  for (const entry of input.candidates) {
    const candidate = normalizeCandidate(entry, apex);
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    candidates.push(candidate);
  }
  candidates.sort((left, right) => left.name.localeCompare(right.name));

  if (typeof input.cached !== 'boolean' || typeof input.truncated !== 'boolean') {
    throw new SecurityAPIError('ProtoPeek returned malformed result bounds.');
  }
  return {
    apex,
    source: normalizeSource(input.source, apex),
    observedAt: normalizeObservedAt(input.observedAt),
    candidates,
    discarded: normalizeNonNegativeInteger(input.discarded, 'discard count'),
    truncated: input.truncated,
    cached: input.cached,
  };
}

function boundedString(value: unknown, maximum: number, field: string) {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new SecurityAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  return value;
}

function boundedNumber(value: unknown, field: string, maximum = 30_000) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new SecurityAPIError(`ProtoPeek returned malformed ${field}.`);
  }
  return value;
}

function optionalTiming(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  return boundedNumber(value, field);
}

function normalizePinnedAddress(value: unknown) {
  const address = boundedString(value, 64, 'pinned address').trim().toLowerCase();
  if (!address || address.includes('%')) {
    throw new SecurityAPIError('ProtoPeek returned a malformed pinned address.');
  }
  if (address.includes(':')) {
    if (!/^[0-9a-f:.]+$/.test(address)) {
      throw new SecurityAPIError('ProtoPeek returned a malformed pinned address.');
    }
    try {
      const hostname = new URL(`http://[${address}]/`).hostname;
      return hostname.replace(/^\[|\]$/g, '');
    } catch {
      throw new SecurityAPIError('ProtoPeek returned a malformed pinned address.');
    }
  }
  const octets = address.split('.');
  if (
    octets.length !== 4 ||
    octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number.parseInt(octet, 10) > 255)
  ) {
    throw new SecurityAPIError('ProtoPeek returned a malformed pinned address.');
  }
  return octets.map((octet) => String(Number.parseInt(octet, 10))).join('.');
}

function normalizeWebsiteHeaders(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length > retainedWebsiteHeaders.size) {
    throw new SecurityAPIError('ProtoPeek returned malformed selected headers.');
  }
  const headers: Record<string, string[]> = {};
  for (const [inputName, inputValues] of Object.entries(value)) {
    const name = retainedWebsiteHeaders.get(inputName.toLowerCase());
    if (!name || !Array.isArray(inputValues) || inputValues.length > 8) {
      throw new SecurityAPIError('ProtoPeek returned malformed selected headers.');
    }
    headers[name] = inputValues.map((entry) => boundedString(entry, 2048, 'header evidence'));
  }
  return headers;
}

function normalizeTLS(value: unknown): WebsiteTLSEvidence | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !Array.isArray(value.dnsNames) || value.dnsNames.length > 64) {
    throw new SecurityAPIError('ProtoPeek returned malformed TLS evidence.');
  }
  const verifiedChains = normalizeNonNegativeInteger(value.verifiedChains, 'verified chain count');
  if (verifiedChains > 16) {
    throw new SecurityAPIError('ProtoPeek returned malformed TLS evidence.');
  }
  return {
    version: boundedString(value.version, 32, 'TLS version'),
    cipherSuite: boundedString(value.cipherSuite, 128, 'TLS cipher suite'),
    negotiatedProtocol: boundedString(value.negotiatedProtocol ?? '', 64, 'negotiated protocol'),
    serverName: boundedString(value.serverName, 253, 'TLS server name'),
    subject: boundedString(value.subject, 2048, 'certificate subject'),
    issuer: boundedString(value.issuer, 2048, 'certificate issuer'),
    notBefore: normalizeObservedAt(value.notBefore),
    notAfter: normalizeObservedAt(value.notAfter),
    dnsNames: value.dnsNames.map((name) => boundedString(name, 253, 'certificate DNS name')),
    verifiedChains,
  };
}

export function normalizeWebsiteObservationResult(input: unknown): WebsiteObservationResult {
  if (!isRecord(input))
    throw new SecurityAPIError('ProtoPeek returned malformed website evidence.');
  const rawURL = boundedString(input.url, maximumWebsiteURLBytes, 'website URL');
  let normalizedURL: string;
  try {
    normalizedURL = normalizeWebsiteURL(rawURL);
  } catch {
    throw new SecurityAPIError('ProtoPeek returned a malformed website URL.');
  }
  if (input.method !== 'HEAD' || !isRecord(input.dns) || !isRecord(input.http)) {
    throw new SecurityAPIError('ProtoPeek returned malformed website evidence.');
  }
  const parsedURL = new URL(normalizedURL);
  const dnsHostname = boundedString(input.dns.hostname, 253, 'DNS hostname').toLowerCase();
  const urlHostname = parsedURL.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (dnsHostname !== urlHostname) {
    throw new SecurityAPIError('ProtoPeek returned inconsistent DNS evidence.');
  }
  if (!Array.isArray(input.dns.pinnedAddresses) || input.dns.pinnedAddresses.length > 16) {
    throw new SecurityAPIError('ProtoPeek returned malformed pinned addresses.');
  }
  const pinnedAddresses = [
    ...new Set(input.dns.pinnedAddresses.map(normalizePinnedAddress)),
  ].sort();
  if (pinnedAddresses.length === 0) {
    throw new SecurityAPIError('ProtoPeek returned no pinned address evidence.');
  }
  const statusCode = normalizeNonNegativeInteger(input.http.statusCode, 'HTTP status code');
  if (statusCode < 100 || statusCode > 599) {
    throw new SecurityAPIError('ProtoPeek returned a malformed HTTP status code.');
  }
  const rawRedirect = input.http.redirectLocation ?? '';
  const redirectLocation = boundedString(rawRedirect, maximumWebsiteURLBytes, 'redirect location');
  if (redirectLocation) {
    try {
      normalizeWebsiteURL(redirectLocation);
    } catch {
      throw new SecurityAPIError('ProtoPeek returned a malformed redirect location.');
    }
  }
  if (!isRecord(input.timings)) {
    throw new SecurityAPIError('ProtoPeek returned malformed website timings.');
  }
  return {
    observedAt: normalizeObservedAt(input.observedAt),
    url: normalizedURL,
    method: 'HEAD',
    dns: {
      hostname: dnsHostname,
      pinnedAddresses,
      resolutionMs: boundedNumber(input.dns.resolutionMs, 'DNS timing'),
    },
    http: {
      statusCode,
      status: boundedString(input.http.status, 128, 'HTTP status'),
      protocol: boundedString(input.http.protocol, 32, 'HTTP protocol'),
      headers: normalizeWebsiteHeaders(input.http.headers),
      redirectLocation,
    },
    tls: normalizeTLS(input.tls),
    timings: {
      connectMs: optionalTiming(input.timings.connectMs, 'connect timing'),
      tlsHandshakeMs: optionalTiming(input.timings.tlsHandshakeMs, 'TLS handshake timing'),
      firstByteMs: optionalTiming(input.timings.firstByteMs, 'first-byte timing'),
      totalMs: boundedNumber(input.timings.totalMs, 'total timing'),
    },
  };
}

async function readBoundedText(response: Response, limit: number) {
  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, limit), truncated: text.length > limit };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - length;
      chunks.push(value.subarray(0, remaining));
      length += Math.min(value.length, remaining);
      if (value.length > remaining) {
        truncated = true;
        break;
      }
    }
    if (length === limit && !truncated) {
      const { done } = await reader.read();
      truncated = !done;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(joined), truncated };
}

async function responseError(response: Response) {
  const { text, truncated } = await readBoundedText(response, errorByteLimit);
  const fallback = `${response.status} ${response.statusText}`.trim() || 'Domain lookup failed.';
  const message = text.trim() || fallback;
  return `${message}${truncated ? '…' : ''}`;
}

export async function fetchDomainCandidates(host: string, signal?: AbortSignal) {
  const normalizedHost = normalizeDomainHost(host);
  const response = await fetch(new URL('api/domain/candidates', window.location.href), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token': csrfToken(),
    },
    body: JSON.stringify({
      host: normalizedHost,
      acknowledgeThirdParty: true,
    }),
    signal,
  });
  if (!response.ok) throw new SecurityAPIError(await responseError(response), response.status);
  const { text, truncated } = await readBoundedText(response, responseByteLimit);
  if (truncated) throw new SecurityAPIError('ProtoPeek domain evidence exceeded 256 KiB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SecurityAPIError('ProtoPeek returned malformed domain evidence.');
  }
  return normalizeDomainCandidatesResult(parsed);
}

export async function fetchWebsiteObservation(url: string, signal?: AbortSignal) {
  const normalizedURL = normalizeWebsiteURL(url);
  const response = await fetch(new URL('api/security/web', window.location.href), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token': csrfToken(),
    },
    body: JSON.stringify({
      url: normalizedURL,
      acknowledgePublicRequest: true,
    }),
    signal,
  });
  if (!response.ok) throw new SecurityAPIError(await responseError(response), response.status);
  const { text, truncated } = await readBoundedText(response, websiteResponseByteLimit);
  if (truncated) throw new SecurityAPIError('ProtoPeek website evidence exceeded 512 KiB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SecurityAPIError('ProtoPeek returned malformed website evidence.');
  }
  return normalizeWebsiteObservationResult(parsed);
}

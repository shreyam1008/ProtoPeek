export const diagnosticModes = [
  [
    'diagnose',
    'Connection check',
    'Resolve once, connect to a pinned address, and optionally verify TLS.',
  ],
  ['dns', 'DNS records', 'Inspect records through the system resolver or an explicit DNS server.'],
  [
    'dns-compare',
    'Compare resolvers',
    'Compare the observed answer sets from the system and a chosen DNS server.',
  ],
  [
    'tls',
    'TLS certificates',
    'Verify trust, server identity and negotiated TLS without an application request.',
  ],
  [
    'ip-compare',
    'IPv4 / IPv6 reachability',
    'Compare TCP connections to the resolved addresses in each family.',
  ],
  [
    'availability',
    'Connection samples',
    'Take a finite set of connection timings to one pinned address.',
  ],
  ['tcp-exchange', 'TCP exchange', 'Send up to 4 KiB and inspect a bounded reply.'],
  [
    'udp-exchange',
    'UDP exchange',
    'Send one datagram and inspect one reply. Silence is inconclusive.',
  ],
  ['http-proxy', 'HTTP proxy', 'Test a CONNECT handshake to a locally resolved destination.'],
  ['socks5-proxy', 'SOCKS5 proxy', 'Test a SOCKS5 handshake to a locally resolved destination.'],
  ['http2', 'Cleartext HTTP/2', 'Exchange SETTINGS and PING using h2c prior knowledge.'],
  [
    'http3',
    'HTTP/3 over QUIC',
    'Verify QUIC and send one HEAD / request. No fallback or redirects.',
  ],
  ['subnet', 'Subnet planner', 'Calculate an exact IPv4 or IPv6 address range locally.'],
] as const;

export type DiagnosticMode = (typeof diagnosticModes)[number][0];
/** A diagnostic draft never carries URL credentials, paths, query values or fragments. */
export function diagnosticDraftTarget(value: string): string | undefined {
  try {
    if (value.length > 1024) return undefined;
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname
      ? `${parsed.protocol}//${parsed.host}`
      : undefined;
  } catch {
    return undefined;
  }
}
export const isDiagnosticMode = (value: unknown): value is DiagnosticMode =>
  diagnosticModes.some(([id]) => id === value);
export type DiagnosticCheck = {
  stage: string;
  address: string;
  local?: string;
  outcome: string;
  durationMs: number;
  detail?: string;
};
export type DiagnosticCertificate = {
  limited?: boolean;
  subject: string;
  issuer: string;
  dnsNames: string[] | null;
  ipAddresses: string[];
  notBefore: string;
  notAfter: string;
  sha256: string;
  serial: string;
};
export type DiagnosticResult = {
  mode: DiagnosticMode;
  target: string;
  observedAt: string;
  durationMs: number;
  complete: boolean;
  summary: string;
  outcome: string;
  addresses: string[];
  checks: DiagnosticCheck[];
  warnings: string[];
  samples: DiagnosticCheck[];
  comparison?: string;
  dns: {
    resolver: string;
    transport: string;
    question: string;
    recordType: string;
    outcome: string;
    responseCode?: string;
    authoritative: boolean;
    records: { name: string; type: string; value: string; ttlSeconds?: number }[];
    limited: boolean;
    durationMs: number;
    detail?: string;
  }[];
  tls?: {
    limited?: boolean;
    address: string;
    serverName: string;
    version: string;
    cipher: string;
    alpn: string;
    verified: boolean;
    verifier: string;
    verifyError?: string;
    receivedChain: DiagnosticCertificate[];
    verifiedChain: DiagnosticCertificate[];
    durationMs: number;
  };
  statistics?: {
    requested: number;
    completed: number;
    connected: number;
    refused: number;
    timeouts: number;
    minMs?: number;
    medianMs?: number;
    p95Ms?: number;
  };
  exchange?: {
    protocol: string;
    sentBytes: number;
    receivedBytes: number;
    replyHex: string;
    replyText: string;
    limited: boolean;
    outcome: string;
    detail?: string;
  };
  proxy?: {
    protocol: string;
    address: string;
    destination: string;
    resolution: string;
    outcome: string;
    status: number;
    detail: string;
  };
  http2?: { protocol: string; settings: string[]; pingAck: boolean; detail: string };
  http3?: {
    address: string;
    local: string;
    quicVersion: string;
    tlsVersion: string;
    alpn: string;
    status: number;
    handshakeMs: number;
    detail: string;
  };
  subnet?: {
    prefix: string;
    family: string;
    network: string;
    first: string;
    last: string;
    totalAddresses: string;
    usableHosts: string;
    firstUsable: string;
    lastUsable: string;
    discoveryEligible: boolean;
    detail: string;
  };
};

/** The server returns a normalized authority. Transport intent survives failed trust checks. */
export function diagnosticHandoff(
  result: DiagnosticResult,
  protocol: 'http' | 'grpc',
  tlsRequested: boolean
): PendingHandoffInput {
  const secure = tlsRequested || Boolean(result.tls) || result.mode === 'http3';
  if (!/^(?:\[[^\]]+\]|[^:[\]\s/?#@]+):\d{1,5}$/.test(result.target))
    throw new Error('The diagnostic did not return a normalized target. Run it again.');
  if (protocol === 'http' && result.target.includes('%'))
    throw new Error(
      'HTTP drafts cannot represent an IPv6 interface zone. Use a routable address or DNS name.'
    );
  return {
    provenance: {
      source: 'network-diagnostics',
      quality: 'inferred',
      observedAt: new Date(result.observedAt).toISOString(),
      path: '/network/diagnostics',
    },
    draft:
      protocol === 'http'
        ? {
            kind: 'http-url-draft',
            target: {
              kind: 'http-url',
              url: new URL(`${secure ? 'https' : 'http'}://${result.target}/`).href,
            },
          }
        : {
            kind: 'grpc-target-draft',
            target: { kind: 'grpc-target', address: result.target, plaintext: !secure },
          },
  };
}

export function diagnosticsSearch(search: Record<string, unknown>): {
  mode?: DiagnosticMode;
  target?: string;
} {
  return {
    mode: isDiagnosticMode(search.mode) ? search.mode : undefined,
    target:
      typeof search.target === 'string' &&
      search.target.length <= 1024 &&
      !Array.from(search.target).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
        ? search.target
        : undefined,
  };
}

import type { PendingHandoffInput } from './app/handoff-types';

import type { ScanResult } from '../api';
import type { TunnelRoute } from '../tunnels-api';

export type PlannedTunnelRoute = TunnelRoute & { planned: true };

const supportedOriginProtocols = new Set([
  'http',
  'https',
  'h2c',
  'tcp',
  'ssh',
  'rdp',
  'unix',
  'unix+tls',
  'smb',
]);

export function protocolFromService(service: string) {
  const match = service.trim().match(/^([a-z][a-z0-9+.-]*):/i);
  return match?.[1]?.toLowerCase().slice(0, 24) || 'unknown';
}

export function validateTunnelRoutePlan(hostname: string, path: string, service: string) {
  const host = hostname.trim();
  if (!host) return 'Enter the public hostname for this route.';
  if (host.includes('://') || host.includes('/') || host.length > 253)
    return 'Enter a hostname without a scheme or path.';
  if (
    !/^(\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
      host
    )
  )
    return 'Enter a valid DNS hostname, such as api.example.com.';

  const pathValue = path.trim();
  if (pathValue.includes('/*'))
    return 'cloudflared path values are regular expressions. Try ^/api/.* instead of /api/*.';
  if (pathValue && !pathValue.startsWith('/') && !pathValue.startsWith('^/'))
    return 'A path regular expression must begin with / or ^/.';
  if (pathValue) {
    try {
      new RegExp(pathValue);
    } catch {
      return 'Enter a valid path regular expression, such as ^/api/.*.';
    }
  }

  const protocol = protocolFromService(service);
  if (!supportedOriginProtocols.has(protocol))
    return 'Use a supported cloudflared origin scheme, such as http, https, h2c, tcp, or ssh.';
  try {
    const parsed = new URL(service.trim());
    if (!parsed.hostname && protocol !== 'unix' && protocol !== 'unix+tls')
      return 'The origin service needs a host.';
  } catch {
    return 'Enter a complete origin URL, such as http://localhost:8080.';
  }
  return '';
}

export function routeSupportsWorkbench(route: TunnelRoute | null, kind: 'http' | 'grpc') {
  if (!route || route.catchAll) return false;
  if (kind === 'http') return route.protocol === 'http' || route.protocol === 'https';
  return route.protocol === 'h2c' || route.protocol === 'grpc' || route.protocol === 'grpcs';
}

export function scanResultFromTunnelRoute(
  route: TunnelRoute,
  kind: 'http' | 'grpc'
): ScanResult | null {
  try {
    const parsed = new URL(route.service);
    if (!parsed.host || !routeSupportsWorkbench(route, kind)) return null;
    const tls = route.protocol === 'https' || route.protocol === 'grpcs';
    return {
      address: parsed.host,
      alive: true,
      tcp: true,
      grpc: kind === 'grpc',
      http: kind === 'http',
      protocols: kind === 'grpc' ? ['tcp', 'grpc'] : ['tcp', 'http'],
      reflection: 'not-checked',
      transport: tls ? 'tls' : 'plaintext',
      services: null,
      servicesTruncated: false,
      httpTransport: kind === 'http' ? (tls ? 'tls' : 'plaintext') : '',
      httpProtocol: '',
      httpProtocolTruncated: false,
      httpStatus: '',
      httpStatusTruncated: false,
      httpStatusCode: 0,
      httpServer: '',
      httpServerTruncated: false,
      failure: '',
      error: null,
      errorTruncated: false,
      details: ['Opened from a locally observed cloudflared ingress route.'],
      detailsTruncated: false,
      latencyMs: 0,
    };
  } catch {
    return null;
  }
}

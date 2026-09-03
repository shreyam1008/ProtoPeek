import { describe, expect, it } from 'vitest';

import type { TunnelRoute } from '../tunnels-api';
import {
  type PlannedTunnelRoute,
  protocolFromService,
  routeSupportsWorkbench,
  scanResultFromTunnelRoute,
  validateTunnelRoutePlan,
} from './route-plan';

describe('tunnel route plan model', () => {
  it('accepts cloudflared path regular expressions', () => {
    expect(validateTunnelRoutePlan('api.example.test', '^/api/.*', 'http://localhost:8080')).toBe(
      ''
    );
  });

  it('rejects a shell-glob-looking path with an actionable correction', () => {
    expect(
      validateTunnelRoutePlan('api.example.test', '/api/*', 'http://localhost:8080')
    ).toContain('^/api/.*');
  });

  it('rejects malformed regular expressions and unsupported origins', () => {
    expect(validateTunnelRoutePlan('api.example.test', '^/[', 'http://localhost:8080')).toContain(
      'valid path regular expression'
    );
    expect(validateTunnelRoutePlan('api.example.test', '', 'ftp://localhost:21')).toContain(
      'supported cloudflared origin scheme'
    );
  });

  it('keeps protocol workbench eligibility explicit', () => {
    const route: TunnelRoute = {
      id: 'grpc',
      hostname: 'grpc.example.test',
      path: '',
      service: 'h2c://localhost:50051',
      protocol: protocolFromService('h2c://localhost:50051'),
      catchAll: false,
    };
    expect(routeSupportsWorkbench(route, 'grpc')).toBe(true);
    expect(routeSupportsWorkbench(route, 'http')).toBe(false);
    expect(scanResultFromTunnelRoute(route, 'grpc', '2026-09-03T11:59:00Z')).toMatchObject({
      discoveredAt: '2026-09-03T11:59:00Z',
      address: 'localhost:50051',
      grpc: true,
    });
    expect(routeSupportsWorkbench({ ...route, catchAll: true }, 'grpc')).toBe(false);
    const plannedRoute: PlannedTunnelRoute = {
      ...route,
      planned: true,
    };
    expect(routeSupportsWorkbench(plannedRoute, 'grpc')).toBe(false);
    expect(
      routeSupportsWorkbench(
        { ...plannedRoute, service: 'http://localhost:8080', protocol: 'http' },
        'http'
      )
    ).toBe(false);
    expect(scanResultFromTunnelRoute(plannedRoute, 'grpc')).toBeNull();
    expect(
      scanResultFromTunnelRoute(
        { ...plannedRoute, service: 'http://localhost:8080', protocol: 'http' },
        'http'
      )
    ).toBeNull();
  });
});

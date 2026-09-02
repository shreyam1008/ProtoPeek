import { describe, expect, it } from 'vitest';

import type { TunnelRoute } from '../tunnels-api';
import { protocolFromService, routeSupportsWorkbench, validateTunnelRoutePlan } from './route-plan';

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
    expect(routeSupportsWorkbench({ ...route, catchAll: true }, 'grpc')).toBe(false);
  });
});

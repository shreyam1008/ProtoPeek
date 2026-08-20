import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScanResult } from './api';
import { DiscoveryScanner, ScanResultCard } from './DiscoveryScanner';

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    address: 'localhost:50051',
    alive: true,
    tcp: true,
    grpc: true,
    http: false,
    protocols: ['tcp', 'grpc'],
    reflection: 'available',
    transport: 'plaintext',
    services: ['catalog.v1.Catalog', 'grpc.health.v1.Health'],
    servicesTruncated: false,
    httpTransport: '',
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
    details: ['reflection available'],
    detailsTruncated: false,
    latencyMs: 2,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiscoveryScanner relay evidence limits', () => {
  it('marks retained card evidence when any relay field was truncated', () => {
    render(
      <ScanResultCard
        result={scanResult({
          servicesTruncated: true,
          httpStatusTruncated: true,
          detailsTruncated: true,
        })}
      />
    );

    expect(screen.getByText('2 retained service(s)')).toBeInTheDocument();
    expect(screen.getByText('Evidence truncated by relay limits')).toHaveAttribute(
      'title',
      expect.stringMatching(/service names, HTTP status, probe details/i)
    );
  });

  it('discloses truncation inside collapsed routine loopback failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json([
          scanResult({
            address: 'localhost:50051',
            alive: false,
            tcp: false,
            grpc: false,
            protocols: [],
            reflection: 'not-checked',
            transport: '',
            services: [],
            failure: 'unreachable',
            error: 'connection refused',
            errorTruncated: true,
            details: ['dial failed'],
            detailsTruncated: true,
          }),
        ])
      )
    );
    render(<DiscoveryScanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Scan loopback' }));
    const failures = await screen.findByText('1 routine loopback probes were not reachable');
    fireEvent.click(failures);

    const list = failures.closest('details');
    expect(list).not.toBeNull();
    expect(
      within(list as HTMLElement).getByText('Evidence truncated by relay limits')
    ).toHaveAttribute('title', expect.stringMatching(/error text, probe details/i));
  });
});

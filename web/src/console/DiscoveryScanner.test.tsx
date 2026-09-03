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
  it('discloses the fixed common-local candidates and guides an empty result', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([])
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<DiscoveryScanner />);

    expect(screen.getByText(/six fixed local endpoints/i)).toHaveTextContent(
      /50051.*9090.*6565.*7000.*8080/i
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scan common local' }));

    expect(
      await screen.findByText(/No reachable services found on the common local candidates/i)
    ).toBeVisible();
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toEqual({
      addresses: [
        'localhost:50051',
        'localhost:9090',
        'localhost:6565',
        'localhost:7000',
        'localhost:8080',
        '127.0.0.1:50051',
      ],
      allowPrivateNetwork: false,
      explicit: false,
    });
  });

  it('does not describe an empty explicit result as a common-local scan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([]))
    );
    render(<DiscoveryScanner />);

    fireEvent.change(screen.getByLabelText('Scan target'), {
      target: { value: 'api.example.test:50051' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Scan target' }));

    expect(await screen.findByText(/No service evidence was returned for/i)).toHaveTextContent(
      /api\.example\.test:50051/
    );
    expect(screen.queryByText(/common local candidates/i)).not.toBeInTheDocument();
  });

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

  it('surfaces a rejected workbench handoff beside the evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([scanResult()]))
    );
    render(
      <DiscoveryScanner
        onOpenGRPC={() => ({
          ok: false,
          error: 'The handoff evidence is stale. Inspect again before opening a draft.',
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Scan common local' }));
    fireEvent.click(await screen.findByRole('button', { name: 'gRPC' }));

    expect(screen.getByRole('status')).toHaveTextContent(/handoff evidence is stale/i);
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

    fireEvent.click(screen.getByRole('button', { name: 'Scan common local' }));
    const failures = await screen.findByText('1 routine loopback probes were not reachable');
    fireEvent.click(failures);

    const list = failures.closest('details');
    expect(list).not.toBeNull();
    expect(
      within(list as HTMLElement).getByText('Evidence truncated by relay limits')
    ).toHaveAttribute('title', expect.stringMatching(/error text, probe details/i));
  });
});

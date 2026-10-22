import { fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScanResult } from './api';
import { storePendingHandoff } from './app/handoff-store';
import { clearOperationReceipts, readOperationReceipts } from './app/operation-receipts';
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
  vi.useRealTimers();
  clearOperationReceipts();
});

describe('DiscoveryScanner relay evidence limits', () => {
  it('records only settled operations and reuses the original observation time when opening old evidence', async () => {
    const fetchMock = vi.fn(async () => Response.json([scanResult()]));
    vi.stubGlobal('fetch', fetchMock);
    const onResults = vi.fn();
    const onOpenGRPC = vi.fn();
    render(<DiscoveryScanner onResults={onResults} onOpenGRPC={onOpenGRPC} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readOperationReceipts()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Scan common local' }));
    const open = await screen.findByRole('button', { name: 'gRPC' });
    const original = onResults.mock.calls[0]?.[1];
    expect(original).toMatchObject({ source: 'bounded-discovery', quality: 'observed' });
    expect(Number.isFinite(Date.parse(original.observedAt))).toBe(true);
    expect(readOperationReceipts()).toMatchObject([
      { operation: 'discovery', outcome: 'success', count: 1 },
    ]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(original.observedAt) + 3600000);
    fireEvent.click(open);
    expect(onOpenGRPC.mock.calls[0]?.[1]).toBe(original);
    expect(onOpenGRPC.mock.calls[0]?.[1]?.observedAt).toBe(original.observedAt);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readOperationReceipts()).toHaveLength(1);
  });
  it('runs an automatic explicit CLI target only once during StrictMode effect replay', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([])
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <StrictMode>
        <DiscoveryScanner autoStart initialTarget="api.internal:8443" />
      </StrictMode>
    );
    await screen.findByText(/No service evidence was returned/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      addresses: ['api.internal:8443'],
      explicit: true,
    });
  });
  it('uses the authority from a pasted URL and never relays its path or query', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([])
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<DiscoveryScanner />);
    fireEvent.change(screen.getByLabelText('Scan target'), {
      target: { value: 'https://api.example.test:8443/private?token=secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Scan target' }));
    await screen.findByText(/No service evidence was returned/);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).addresses).toEqual([
      'https://api.example.test:8443',
    ]);
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain('secret');
  });

  it('rejects credentials before any discovery request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<DiscoveryScanner />);
    fireEvent.change(screen.getByLabelText('Scan target'), {
      target: { value: 'https://user:secret@api.example.test/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Scan target' }));
    expect(await screen.findByText(/Remove credentials/)).not.toHaveTextContent('secret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

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

  it('surfaces real broker staleness with a scan recovery instead of renewing old evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([scanResult()]))
    );
    render(
      <DiscoveryScanner
        onOpenGRPC={(result, provenance) => {
          if (!provenance) throw new Error('Scan must retain its observation provenance.');
          return storePendingHandoff({
            provenance,
            draft: {
              kind: 'grpc-target-draft',
              target: { kind: 'grpc-target', address: result.address, plaintext: true },
            },
          });
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Scan common local' }));
    const open = await screen.findByRole('button', { name: 'gRPC' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    fireEvent.click(open);

    expect(screen.getByRole('status')).toHaveTextContent(/handoff evidence is stale/i);
    expect(screen.getByRole('status')).toHaveTextContent(/Use Scan target or Scan common local/i);
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

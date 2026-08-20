import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NmapImportPanel } from './NmapImportPanel';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel() {
  return render(<NmapImportPanel onResults={vi.fn()} onOpenGRPC={vi.fn()} onOpenHTTP={vi.fn()} />);
}

function selectXML(container: HTMLElement, file = new File(['<nmaprun/>'], 'evidence.xml')) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input is missing');
  fireEvent.change(input, { target: { files: [file] } });
}

describe('NmapImportPanel', () => {
  it('keeps imported hostnames display-only and never verifies them', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        hosts: [
          {
            status: { state: 'up', reason: 'echo-reply' },
            addresses: [],
            hostnames: [{ name: 'internal.example', type: 'user' }],
            ports: [
              {
                port: 50051,
                protocol: 'tcp',
                state: 'open',
                reason: 'syn-ack',
                service: {
                  name: 'grpc',
                  product: '',
                  version: '',
                  extrainfo: '',
                  tunnel: '',
                  method: 'table',
                  confidence: '3',
                },
              },
            ],
          },
        ],
        hostCount: 1,
        portCount: 1,
        complete: true,
        completion: 'success',
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderPanel();
    selectXML(container);
    fireEvent.click(screen.getByRole('button', { name: 'Import evidence' }));

    expect(await screen.findAllByText(/internal\.example/)).toHaveLength(2);
    expect(
      screen.getByText('Bounded verification supports open TCP endpoints.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Verify .* with ProtoPeek/ })
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('brackets a validated IPv6 literal and sends one exact verification target', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      return Response.json(
        path.endsWith('/api/nmap/import')
          ? {
              hosts: [
                {
                  status: { state: 'up', reason: 'syn-ack' },
                  addresses: [{ address: '2001:db8::10', type: 'ipv6', vendor: '' }],
                  hostnames: [],
                  ports: [
                    {
                      port: 443,
                      protocol: 'tcp',
                      state: 'open',
                      reason: 'syn-ack',
                      service: {
                        name: 'https',
                        product: '',
                        version: '',
                        extrainfo: '',
                        tunnel: 'ssl',
                        method: 'probed',
                        confidence: '10',
                      },
                    },
                  ],
                },
              ],
              hostCount: 1,
              portCount: 1,
              complete: true,
              completion: 'success',
            }
          : []
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderPanel();
    selectXML(container);
    fireEvent.click(screen.getByRole('button', { name: 'Import evidence' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Verify [2001:db8::10]:443 with ProtoPeek',
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      addresses: ['[2001:db8::10]:443'],
      allowPrivateNetwork: false,
      explicit: true,
    });
  });

  it('rejects oversized files before fetch and clears selected evidence', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderPanel();
    selectXML(
      container,
      new File([new Uint8Array((8 << 20) + 1)], 'oversized.xml', {
        type: 'application/xml',
      })
    );

    expect(screen.getByRole('alert')).toHaveTextContent('exceeds the 8 MiB import limit');
    expect(screen.getByRole('button', { name: 'Import evidence' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No file selected · limit 8 MiB')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks reports without a successful completion record as partial', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          hosts: [],
          hostCount: 0,
          portCount: 0,
          complete: false,
          completion: 'missing',
        })
      )
    );
    const { container } = renderPanel();
    selectXML(container);
    fireEvent.click(screen.getByRole('button', { name: 'Import evidence' }));
    expect(await screen.findByText(/Treat every result as partial evidence/)).toBeInTheDocument();
  });

  it('cancels an in-flight ProtoPeek verification', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/api/nmap/import')) {
        return Promise.resolve(
          Response.json({
            hosts: [
              {
                id: 1,
                status: { state: 'up', reason: 'syn-ack' },
                addresses: [{ address: '127.0.0.1', type: 'ipv4', vendor: '' }],
                hostnames: [],
                ports: [
                  {
                    port: 50051,
                    protocol: 'tcp',
                    state: 'open',
                    reason: 'syn-ack',
                    service: {
                      name: 'grpc',
                      product: '',
                      version: '',
                      extrainfo: '',
                      tunnel: '',
                      method: 'probed',
                      confidence: '10',
                    },
                  },
                ],
              },
            ],
            hostCount: 1,
            portCount: 1,
            complete: true,
            completion: 'success',
          })
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderPanel();
    selectXML(container);
    fireEvent.click(screen.getByRole('button', { name: 'Import evidence' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Verify 127.0.0.1:50051 with ProtoPeek' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancel verification of 127.0.0.1:50051' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('verification cancelled');
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  });
});

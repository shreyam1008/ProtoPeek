import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScanTargetDialog } from './ScanTargetDialog';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ScanTargetDialog', () => {
  it('moves focus inside, traps keyboard focus, closes on Escape, and restores focus', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Open scan';
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(
      <ScanTargetDialog
        open
        onClose={onClose}
        onResults={vi.fn()}
        onOpenGRPC={vi.fn()}
        onOpenHTTP={vi.fn()}
      />
    );

    const input = screen.getByRole('textbox', { name: 'Scan target' });
    await waitFor(() => expect(input).toHaveFocus());

    const closeButton = screen.getAllByRole('button', { name: 'Close scan target dialog' })[1];
    const privateToggle = screen.getByRole('checkbox', {
      name: 'Allow this target to reach private or link-local IPs',
    });
    closeButton.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(privateToggle).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(
      <ScanTargetDialog
        open={false}
        onClose={onClose}
        onResults={vi.fn()}
        onOpenGRPC={vi.fn()}
        onOpenHTTP={vi.fn()}
      />
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('cancels the active scan request from the dialog', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=test-token; path=/';
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ScanTargetDialog
        open
        onClose={vi.fn()}
        onResults={vi.fn()}
        onOpenGRPC={vi.fn()}
        onOpenHTTP={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Scan target' }), {
      target: { value: 'localhost:50051' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Scan target' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel scan' });
    fireEvent.click(cancel);

    expect(await screen.findByText('Scan cancelled.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('imports Nmap XML as hints and requires ProtoPeek verification before opening', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=test-token; path=/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const body = path.endsWith('/api/nmap/import')
        ? {
            hosts: [
              {
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
                      product: 'untrusted fixture',
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
          }
        : [
            {
              address: '127.0.0.1:50051',
              alive: true,
              tcp: true,
              grpc: true,
              http: false,
              protocols: ['tcp', 'grpc'],
              reflection: 'available',
              transport: 'plaintext',
              services: ['fixture.Service'],
              httpTransport: '',
              httpProtocol: '',
              httpStatus: '',
              httpStatusCode: 0,
              httpServer: '',
              failure: '',
              error: '',
              details: ['reflection available'],
              latencyMs: 2,
            },
          ];
      return {
        ok: true,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const onOpenGRPC = vi.fn();
    const { container } = render(
      <ScanTargetDialog
        open
        onClose={vi.fn()}
        onResults={vi.fn()}
        onOpenGRPC={onOpenGRPC}
        onOpenHTTP={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Import Nmap XML' }));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File(['<nmaprun/>'], 'evidence.xml', { type: 'application/xml' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import evidence' }));

    expect(await screen.findByText('grpc')).toBeInTheDocument();
    expect(screen.getByText('table · confidence 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gRPC/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify 127.0.0.1:50051 with ProtoPeek' }));
    const open = await screen.findByRole('button', { name: 'gRPC' });
    expect(onOpenGRPC).not.toHaveBeenCalled();
    fireEvent.click(open);
    expect(onOpenGRPC).toHaveBeenCalledOnce();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe('/api/nmap/import');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/xml',
      'x-protopeek-csrf-token': 'test-token',
    });
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).pathname).toBe('/api/scan');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      addresses: ['127.0.0.1:50051'],
      explicit: true,
    });
  });
});

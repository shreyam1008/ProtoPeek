import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { appStorageKeys } from '@/shared/runtime';

import { clearPendingHandoff, storePendingHandoff } from './app/handoff-store';
import { protocolShellEvents } from './ProtocolShellContext';
import { RoutesWorkbench } from './RoutesWorkbench';

afterEach(() => {
  vi.unstubAllGlobals();
  clearPendingHandoff();
  window.sessionStorage.clear();
});

function routeHandoff(target: string) {
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  return {
    provenance: {
      source: 'this-device',
      quality: 'inferred' as const,
      observedAt,
      path: '/this-pc',
    },
    draft: {
      kind: 'next-hop-target-draft' as const,
      target: { kind: 'next-hop-target' as const, target },
    },
  };
}

it('consumes a route draft without resolving or looking it up', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(storePendingHandoff(routeHandoff('shreyam1008.com.np')).ok).toBe(true);

  render(
    <StrictMode>
      <RoutesWorkbench />
    </StrictMode>
  );

  expect(screen.getByRole('textbox', { name: 'Route destination' })).toHaveValue(
    'shreyam1008.com.np'
  );
  expect(screen.getByRole('textbox', { name: 'Route destination' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent(/draft from this device/i);
  expect(screen.getByRole('status')).toHaveTextContent(/no DNS resolution or route lookup/i);
  expect(window.sessionStorage.getItem(appStorageKeys.pendingHandoff)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole('textbox', { name: 'Route destination' }), {
    target: { value: 'edited.example.test' },
  });
  expect(screen.queryByText(/draft from this device/i)).not.toBeInTheDocument();
});

it('applies a same-route draft and retires stale lookup work without starting another lookup', async () => {
  let signal: AbortSignal | undefined;
  let resolveRequest: ((value: Response) => void) | undefined;
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        signal = init?.signal ?? undefined;
        resolveRequest = resolve;
      })
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<RoutesWorkbench />);

  fireEvent.change(screen.getByRole('textbox', { name: 'Route destination' }), {
    target: { value: 'old.example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Look up route' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

  expect(storePendingHandoff(routeHandoff('new.example.test')).ok).toBe(true);
  fireEvent(window, new Event(protocolShellEvents.pendingHandoff));

  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Route destination' })).toHaveValue(
    'new.example.test'
  );
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Route destination' })).toHaveFocus()
  );
  expect(screen.getByRole('button', { name: 'Look up route' })).toBeVisible();
  expect(fetchMock).toHaveBeenCalledOnce();

  await act(async () => {
    resolveRequest?.({
      ok: true,
      json: async () => ({
        perspective: 'protopeek-process',
        observedAt: new Date().toISOString(),
        results: [
          {
            destination: 'old.example.test',
            family: 'ipv4',
            status: 'error',
            sourceIp: '',
            interfaceIndex: 0,
            interfaceName: '',
            nextHop: '',
            onLink: false,
            local: false,
            prefix: null,
            routeMetric: null,
            table: null,
            backend: 'stale-backend',
            notes: [],
            error: 'stale result',
          },
        ],
      }),
      text: async () => '',
    } as Response);
    await Promise.resolve();
  });
  expect(screen.queryByText('stale-backend')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Route destination' })).toHaveValue(
    'new.example.test'
  );
});

it('retires a never-settling lookup immediately when the operator cancels', async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>(() => {
          signal = init?.signal ?? undefined;
        })
    )
  );
  render(<RoutesWorkbench />);

  fireEvent.change(screen.getByRole('textbox', { name: 'Route destination' }), {
    target: { value: 'slow.example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Look up route' }));
  await screen.findByRole('button', { name: 'Cancel lookup' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel lookup' }));

  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole('button', { name: 'Look up route' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Route lookup cancelled.');
});

it('renders exact process-perspective next-hop evidence and its permanent uncertainty', async () => {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
  document.cookie = '_protopeek_csrf_token=route-token; path=/';
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const body = {
      perspective: 'protopeek-process',
      observedAt: '2026-08-20T12:00:00Z',
      results: [
        {
          destination: '192.0.2.80',
          family: 'ipv4',
          status: 'ok',
          sourceIp: '192.0.2.25',
          interfaceIndex: 7,
          interfaceName: 'eth0',
          nextHop: '192.0.2.1',
          onLink: false,
          local: false,
          prefix: 24,
          routeMetric: 42,
          table: 254,
          backend: 'linux-netlink',
          notes: [],
          error: '',
        },
      ],
    };
    return {
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<RoutesWorkbench />);

  expect(screen.getByText(/not traceroute/i)).toBeInTheDocument();
  expect(screen.getAllByText(/no route probes/i).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole('textbox', { name: 'Route destination' }), {
    target: { value: 'example.test' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Resolution family' }), {
    target: { value: 'ipv4' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Look up route' }));

  expect(await screen.findAllByText('192.0.2.1')).not.toHaveLength(0);
  expect(screen.getByText('linux-netlink')).toBeInTheDocument();
  expect(screen.getByText('/24')).toBeInTheDocument();
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(screen.getByText('254')).toBeInTheDocument();
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    destination: 'example.test',
    family: 'ipv4',
  });
});

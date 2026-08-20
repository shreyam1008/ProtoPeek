import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { RoutesWorkbench } from './RoutesWorkbench';

afterEach(() => {
  vi.unstubAllGlobals();
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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalNetworkPanel } from './LocalNetworkPanel';

const capabilities = {
  perspective: 'protopeek-process',
  activeProbe: false,
  profiles: [
    {
      id: 'quick',
      label: 'Quick services',
      description: 'HTTP, HTTPS, gRPC, and a common local API port.',
      ports: [80, 443, 50051, 8080],
      applicationProbePorts: [80, 443, 50051, 8080],
    },
    {
      id: 'grpc',
      label: 'gRPC common',
      description: 'Ports frequently used by gRPC services.',
      ports: [443, 50051],
      applicationProbePorts: [443, 50051],
    },
  ],
  limits: {
    minimumPrefix: 24,
    maxPorts: 18,
    maxAttempts: 4572,
    maxWorkers: 32,
    deadlineMs: 15000,
  },
  interfaces: [
    {
      index: 4,
      name: 'en0',
      address: '192.168.44.19',
      interfaceCidr: '192.168.0.0/16',
      suggestedCidr: '192.168.44.0/24',
    },
  ],
  warnings: ['Loading capabilities does not send network probes.'],
};

const discovery = {
  perspective: 'protopeek-process',
  observedAt: '2026-08-21T04:30:00Z',
  cidr: '192.168.44.0/24',
  profile: capabilities.profiles[0],
  hostCount: 254,
  attemptsPlanned: 1016,
  attemptsCompleted: 1016,
  complete: true,
  hosts: [
    {
      address: '192.168.44.1',
      ports: [
        {
          port: 50051,
          state: 'open',
          provenance: 'observed',
          protocols: ['tcp', 'grpc'],
          grpc: true,
          http: false,
          reflection: 'available',
          services: ['catalog.v1.Catalog'],
          httpProtocol: '',
          httpStatus: '',
          httpServer: '',
          probeDurationMs: 3,
          evidenceNotes: ['gRPC reflection listed one service'],
        },
      ],
      hints: [
        {
          label: 'gRPC endpoint',
          confidence: 'low',
          provenance: 'inferred',
          reason: 'gRPC responded on TCP 50051',
        },
      ],
    },
  ],
  warnings: ['An absent host is not evidence that the device is offline.'],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LocalNetworkPanel', () => {
  it('loads no-probe defaults, previews the exact plan, and cannot POST before authorization', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=network-panel-token; path=/';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        new URL(String(input)).pathname.endsWith('/capabilities') ? capabilities : discovery
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);

    const cidr = await screen.findByRole('textbox', { name: 'Private IPv4 CIDR' });
    expect(cidr).toHaveValue('192.168.44.0/24');
    expect(screen.getByRole('combobox', { name: 'Scan profile' })).toHaveValue('quick');
    const plan = screen.getByRole('region', { name: 'Exact scan plan' });
    expect(within(plan).getByText('254 hosts')).toBeInTheDocument();
    expect(within(plan).getByText('4 ports')).toBeInTheDocument();
    expect(within(plan).getByText('1,016 endpoint probes')).toBeInTheDocument();
    expect(within(plan).getByText('32 concurrent')).toBeInTheDocument();
    expect(within(plan).getByText('15 s deadline')).toBeInTheDocument();
    expect(within(plan).getByText(/gRPC reflection \+ HTTP HEAD/)).toHaveTextContent(
      '80, 443, 50051, 8080'
    );
    expect(within(plan).getByText('None in this profile')).toBeVisible();
    expect(
      screen.getByText(/may send bounded gRPC reflection and HTTP HEAD \/ requests/i)
    ).toBeVisible();
    const boundaries = screen.getByText('Safety boundaries · 1').closest('details');
    expect(boundaries).not.toBeNull();
    expect(boundaries).not.toHaveAttribute('open');

    const scan = screen.getByRole('button', { name: 'Scan network' });
    expect(scan).toBeDisabled();
    fireEvent.click(scan);
    expect(fetchMock).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I am authorized to probe this private CIDR/i,
      })
    );
    fireEvent.click(scan);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ cidr: '192.168.44.0/24', profile: 'quick', consent: true }),
      headers: {
        'Content-Type': 'application/json',
        'x-protopeek-csrf-token': 'network-panel-token',
      },
    });
  });

  it('cancels an in-flight active probe through its AbortSignal', async () => {
    const scanSignals: AbortSignal[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith('/capabilities')) {
        return Promise.resolve(Response.json(capabilities));
      }
      if (init?.signal) scanSignals.push(init.signal);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);
    const authorization = await screen.findByRole('checkbox', {
      name: /I am authorized to probe this private CIDR/i,
    });
    fireEvent.click(authorization);
    fireEvent.click(screen.getByRole('button', { name: 'Scan network' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel scan' }));

    expect(scanSignals).toHaveLength(1);
    expect(scanSignals[0]?.aborted).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Scan cancelled. No result was saved.'
    );
  });

  it('keeps observed and inferred roles explicit and saves edited bounded provenance', async () => {
    const onSaveSnapshot = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          new URL(String(input)).pathname.endsWith('/capabilities') ? capabilities : discovery
        )
      )
    );

    render(<LocalNetworkPanel onSaveSnapshot={onSaveSnapshot} />);
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: /I am authorized to probe this private CIDR/i,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scan network' }));

    expect(
      await screen.findByRole('heading', { name: 'Observed endpoint evidence' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Observed means the ProtoPeek process received positive/)
    ).toHaveTextContent(
      'Inferred device-role hints are hypotheses, not verified device identities.'
    );
    expect(screen.getByText(/Inferred · low confidence · gRPC endpoint/)).toBeInTheDocument();
    expect(screen.getByText(/3 ms application probe/)).toBeInTheDocument();
    expect(
      screen.getByLabelText('Evidence plan: 192.168.44.0/24, Quick services')
    ).toBeInTheDocument();
    expect(
      screen.getByText('An absent host is not evidence that the device is offline.')
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Label for 192.168.44.1' }), {
      target: { value: 'Catalog edge' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Tags for 192.168.44.1' }), {
      target: { value: 'grpc, lab' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }));

    expect(onSaveSnapshot).toHaveBeenCalledOnce();
    const snapshot = onSaveSnapshot.mock.calls[0]?.[0];
    expect(snapshot.nodes[0]).toMatchObject({
      label: 'Catalog edge',
      tags: ['grpc', 'lab'],
      deviceType: 'gRPC endpoint',
      identities: [expect.objectContaining({ kind: 'ipv4', value: '192.168.44.1' })],
      ports: [expect.objectContaining({ number: 50051, state: 'open' })],
    });
    expect(snapshot.nodes[0].provenance.map((entry: { kind: string }) => entry.kind)).toEqual([
      'observed',
      'inferred',
      'manual',
    ]);
    expect(snapshot.nodes[0].ports[0].provenance[0]).toMatchObject({
      kind: 'observed',
      source: 'protopeek-probe',
    });
  });

  it('binds displayed and saveable evidence to the exact authorized scope and profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          new URL(String(input)).pathname.endsWith('/capabilities') ? capabilities : discovery
        )
      )
    );

    render(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);
    const authorization = await screen.findByRole('checkbox', {
      name: /I am authorized to probe this private CIDR/i,
    });
    fireEvent.click(authorization);
    fireEvent.click(screen.getByRole('button', { name: 'Scan network' }));
    expect(
      await screen.findByLabelText('Evidence plan: 192.168.44.0/24, Quick services')
    ).toBeVisible();

    fireEvent.change(screen.getByRole('combobox', { name: 'Scan profile' }), {
      target: { value: 'grpc' },
    });

    expect(authorization).not.toBeChecked();
    expect(screen.queryByRole('heading', { name: 'Observed endpoint evidence' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save snapshot' })).toBeNull();
  });

  it('describes partial empty evidence without claiming devices are offline', async () => {
    const partial = {
      ...discovery,
      attemptsCompleted: 400,
      complete: false,
      stoppedReason: 'deadline',
      hosts: [],
      warnings: ['Only positive selected-port evidence is retained.'],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          new URL(String(input)).pathname.endsWith('/capabilities') ? capabilities : partial
        )
      )
    );

    render(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: /I am authorized to probe this private CIDR/i,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scan network' }));

    expect(
      await screen.findByText(/Partial result: 400 of 1,016 endpoint probe calls returned/)
    ).toHaveTextContent('stopped: deadline');
    expect(
      screen.getByText(/No open endpoints were observed on the selected ports/)
    ).toHaveTextContent('This does not mean devices are offline.');
    expect(screen.queryByText(/no devices found/i)).not.toBeInTheDocument();
    expect(
      screen.getByText('Only positive selected-port evidence is retained.')
    ).toBeInTheDocument();
  });
});

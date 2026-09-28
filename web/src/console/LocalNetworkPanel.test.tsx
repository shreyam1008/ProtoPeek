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
  it('starts with a device list on narrow screens and preserves a manually selected map', async () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === '(max-width: 640px)' }));
    vi.stubGlobal('matchMedia', matchMedia);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...capabilities,
          inventory: {
            observedAt: '2026-09-27T12:00:00Z',
            status: 'available',
            source: 'os-neighbor-cache',
            defaultInterfaceIndex: 4,
            defaultGateway: '',
            warnings: [],
            devices: [
              {
                address: '192.168.44.19',
                interfaceIndex: 4,
                interfaceName: 'en0',
                mac: '',
                hostname: 'My computer',
                kind: 'self',
                state: 'local',
                source: 'local-interface',
              },
            ],
          },
        })
      )
    );
    const { rerender } = render(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);

    expect(await screen.findByRole('region', { name: 'Known devices' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'false');
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 640px)');

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Known devices' })).not.toBeInTheDocument();
    rerender(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Inspect My computer (192.168.44.19)' })
    ).toBeVisible();
  });

  it('opens on the routed network with cached devices, then enriches the map with advertised services', async () => {
    const inventory = {
      observedAt: '2026-09-27T12:00:00Z',
      status: 'available',
      source: 'os-neighbor-cache',
      defaultInterfaceIndex: 4,
      defaultGateway: '192.168.44.1',
      warnings: ['The cache may be stale.'],
      devices: [
        {
          address: '192.168.44.19',
          interfaceIndex: 4,
          interfaceName: 'en0',
          mac: '',
          hostname: 'My computer',
          kind: 'self',
          state: 'local',
          source: 'local-interface',
        },
        {
          address: '192.168.44.1',
          interfaceIndex: 4,
          interfaceName: 'en0',
          mac: '52:54:00:12:34:56',
          hostname: '',
          kind: 'neighbor',
          state: 'cached',
          source: 'os-neighbor-cache',
        },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      Response.json(
        new URL(String(input)).pathname.endsWith('/capabilities')
          ? { ...capabilities, inventory }
          : {
              ...discovery,
              complete: false,
              attemptsCompleted: 400,
              stoppedReason: 'deadline',
              hosts: [...discovery.hosts, { ...discovery.hosts[0], address: '192.168.44.3' }],
              advertisements: {
                status: 'available',
                warnings: [],
                records: [
                  {
                    address: '192.168.44.2',
                    instance: 'Office._ipp._tcp.local',
                    serviceType: '_ipp._tcp.local',
                    hostname: 'printer.local',
                    port: 631,
                    txt: ['ty=Office printer'],
                    source: 'mdns',
                  },
                ],
              },
            }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);

    expect(await screen.findByRole('combobox', { name: 'Your network' })).toHaveValue(
      '4:192.168.44.19'
    );
    expect(await screen.findByRole('heading', { name: 'My computer' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Gateway (192.168.44.1)' }));
    const gateway = screen.getByRole('article', { name: 'Device details for 192.168.44.1' });
    expect(gateway).toHaveTextContent('MAC 52:54:00:12:34:56');
    expect(within(gateway).getByRole('link', { name: 'Inspect ports' })).toHaveAttribute(
      'href',
      '#/network/ports?host=192.168.44.1'
    );
    expect(within(gateway).getByRole('link', { name: 'Inspect traffic' })).toHaveAttribute(
      'href',
      '#/network/packets?mode=live&host=192.168.44.1'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Scan network' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect printer.local (192.168.44.2)' })
    );
    const printer = screen.getByRole('article', { name: 'Device details for 192.168.44.2' });
    expect(printer).toHaveTextContent('Printer service · advertised via IPP');
    expect(printer).toHaveTextContent('advertised TCP 631');
    expect(printer).toHaveTextContent('No open selected TCP ports were observed');
    expect(printer).toHaveTextContent('partial scan. Some probes may not have completed.');
    expect(
      screen.queryByRole('button', { name: 'Inspect 192.168.44.3 (192.168.44.3)' })
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Observed hosts' })).getByRole('button', {
        name: /192\.168\.44\.3/,
      })
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes without probing, preserves the selected network and clears results if it disappears', async () => {
    const withTwoNetworks = {
      ...capabilities,
      interfaces: [
        ...capabilities.interfaces,
        { ...capabilities.interfaces[0], index: 8, name: 'en1', address: '192.168.44.20' },
      ],
    };
    let reads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname.endsWith('/capabilities')) {
        reads += 1;
        return Response.json(reads < 3 ? withTwoNetworks : capabilities);
      }
      return Response.json(discovery);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Your network' }), {
      target: { value: '8:192.168.44.20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Scan network' }));
    await screen.findByRole('heading', { name: 'Observed endpoint evidence' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    expect(await screen.findByRole('combobox', { name: 'Your network' })).toHaveValue(
      '8:192.168.44.20'
    );
    expect(screen.getByRole('heading', { name: 'Observed endpoint evidence' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    expect(await screen.findByRole('combobox', { name: 'Your network' })).toHaveValue(
      '4:192.168.44.19'
    );
    expect(
      screen.queryByRole('heading', { name: 'Observed endpoint evidence' })
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

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

    const scope = await screen.findByRole('combobox', { name: 'Your network' });
    expect(scope).toHaveValue('4:192.168.44.19');
    expect(screen.queryByRole('textbox', { name: 'Private IPv4 CIDR' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Scan settings/));
    expect(screen.getByRole('combobox', { name: 'Scan profile' })).toHaveValue('quick');
    fireEvent.change(scope, { target: { value: '' } });
    const cidr = screen.getByRole('textbox', { name: 'Private IPv4 CIDR' });
    expect(cidr).toHaveValue('');
    fireEvent.change(cidr, { target: { value: '10.10.4.0/24' } });
    expect(screen.getByRole('region', { name: 'Exact scan plan' })).toHaveTextContent(
      '10.10.4.0/24'
    );
    fireEvent.change(scope, { target: { value: '4:192.168.44.19' } });
    expect(screen.queryByRole('textbox', { name: 'Private IPv4 CIDR' })).not.toBeInTheDocument();
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
    expect(screen.getByText(/Scanning starts only when you choose Scan network/)).toBeVisible();
    const disclosure = screen.getByText(/Application ports: bounded gRPC reflection/);
    expect(disclosure).toBeVisible();
    expect(disclosure).toHaveTextContent('HTTP HEAD /, no redirects');
    expect(disclosure).toHaveTextContent('TCP connect only');
    expect(disclosure).toHaveTextContent('mDNS: two seconds on the selected interface');
    expect(disclosure).toHaveTextContent('within this range only');
    expect(disclosure).toHaveTextContent('VPNs and overlapping networks');
    const boundaries = screen.getByText('Safety boundaries · 1').closest('details');
    expect(boundaries).not.toBeNull();
    expect(boundaries).not.toHaveAttribute('open');

    const scan = screen.getByRole('button', { name: 'Scan network' });
    expect(scan).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(screen.queryByRole('checkbox', { name: /I am authorized/ })).not.toBeInTheDocument();
    fireEvent.click(scan);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({
        cidr: '192.168.44.0/24',
        profile: 'quick',
        consent: true,
        interfaceIndex: 4,
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-protopeek-csrf-token': 'network-panel-token',
      },
    });
  });

  it('offers a retry when the local scan service returns an unreadable setup response', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts += 1;
      return attempts === 1
        ? new Response('<!doctype html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        : Response.json(capabilities);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Scan setup could not load')).toBeInTheDocument();
    expect(within(alert).getByText(/No probes were sent/)).toBeInTheDocument();
    const technicalDetails = within(alert).getByText('Technical details').closest('details');
    expect(technicalDetails).not.toBeNull();
    expect(technicalDetails).not.toHaveAttribute('open');

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('combobox', { name: 'Your network' })).toHaveValue(
      '4:192.168.44.19'
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    await screen.findByRole('button', { name: 'Scan network' });
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
    await screen.findByRole('button', { name: 'Scan network' });
    fireEvent.click(screen.getByRole('button', { name: 'Scan network' }));

    expect(
      await screen.findByRole('heading', { name: 'Observed endpoint evidence' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Observed means the ProtoPeek process received positive/)
    ).toHaveTextContent('Device-role hints are unverified.');
    expect(screen.getByText(/Inferred · low confidence · gRPC endpoint/)).toBeInTheDocument();
    expect(screen.getByText(/3 ms application probe/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scan ports on 192.168.44.1' })).toHaveAttribute(
      'href',
      '#/network/ports?host=192.168.44.1'
    );
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

  it('browses a host list and exposes the selected host probe evidence', async () => {
    const firstHost = discovery.hosts[0];
    if (!firstHost) throw new Error('The discovery fixture needs one host.');
    const firstPort = firstHost.ports[0];
    if (!firstPort) throw new Error('The discovery fixture host needs one observed port.');
    const withHTTPHost = {
      ...discovery,
      hosts: [
        firstHost,
        {
          address: '192.168.44.2',
          ports: [
            {
              ...firstPort,
              port: 8080,
              protocols: ['tcp', 'http'],
              grpc: false,
              http: true,
              reflection: '',
              services: ['development-api'],
              httpProtocol: 'HTTP/1.1',
              httpStatus: '200 OK',
              httpServer: 'Caddy',
              probeDurationMs: 9,
              evidenceNotes: ['HTTP HEAD / returned 200 without following redirects'],
            },
          ],
          hints: [],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          new URL(String(input)).pathname.endsWith('/capabilities') ? capabilities : withHTTPHost
        )
      )
    );

    render(<LocalNetworkPanel onSaveSnapshot={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scan network' }));

    expect(await screen.findByRole('heading', { name: '192.168.44.1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /192\.168\.44\.2/ }));
    expect(screen.getByRole('heading', { name: '192.168.44.2' })).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Filter by address, port, service, or hint' }),
      { target: { value: 'Caddy' } }
    );
    expect(screen.getByText('1 of 2 hosts')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Probe evidence'));
    expect(screen.getByText('HTTP status')).toBeInTheDocument();
    expect(screen.getByText('200 OK')).toBeInTheDocument();
    expect(screen.getByText('Caddy')).toBeInTheDocument();
    expect(
      screen.getByText('HTTP HEAD / returned 200 without following redirects')
    ).toBeInTheDocument();
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
    await screen.findByRole('button', { name: 'Scan network' });
    fireEvent.click(screen.getByRole('button', { name: 'Scan network' }));
    expect(
      await screen.findByLabelText('Evidence plan: 192.168.44.0/24, Quick services')
    ).toBeVisible();

    fireEvent.click(screen.getByText(/Scan settings/));
    fireEvent.change(screen.getByRole('combobox', { name: 'Scan profile' }), {
      target: { value: 'grpc' },
    });

    expect(screen.getByRole('button', { name: 'Scan network' })).toBeEnabled();
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
    await screen.findByRole('button', { name: 'Scan network' });
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

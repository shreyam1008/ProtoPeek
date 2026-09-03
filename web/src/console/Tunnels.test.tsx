import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProtocolShellContext, type ProtocolShellValue } from './ProtocolShellContext';
import { Tunnels } from './Tunnels';

const capabilities = {
  schemaVersion: 1,
  scope: 'local-host',
  scopeNotice: 'Secrets are never returned.',
  platform: 'linux',
  serviceManager: 'systemd',
  install: {
    platform: 'linux',
    architecture: 'amd64',
    processElevated: false,
    elevationMechanism: 'sudo',
    downloadsUrl:
      'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    releasesUrl: 'https://github.com/cloudflare/cloudflared/releases',
    serviceDocsUrl:
      'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/as-a-service/linux/',
    elevationNotice: 'sudo may request your password in your terminal.',
    commands: [
      {
        id: 'apt',
        label: 'Install with apt',
        command: 'sudo apt-get install cloudflared',
        requiresElevation: true,
      },
    ],
  },
  manualRefresh: { supported: true, reason: '' },
  serviceObservation: { supported: true, reason: '' },
  configInspection: { supported: true, reason: '' },
  routePlanPreview: { supported: true, reason: 'Plans stay in the browser.' },
  serviceControl: { supported: true, reason: '' },
  configMutation: { supported: false, reason: 'Config mutation is read-only in this beta.' },
  accountConnection: { supported: false, reason: 'Account access is not connected.' },
  backgroundPolling: { supported: false, reason: 'Manual refresh only.' },
};

const release = {
  schemaVersion: 1,
  checkedAt: '2026-09-02T09:35:00Z',
  installedVersion: '2026.8.1',
  latestVersion: '2026.9.0',
  status: 'update-available',
  supportStatus: 'supported',
  publishedAt: '2026-09-01T17:00:00Z',
  releaseUrl: 'https://github.com/cloudflare/cloudflared/releases/tag/2026.9.0',
  downloadsUrl:
    'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  note: 'A newer stable release is available.',
};

const snapshot = {
  schemaVersion: 1,
  scope: 'local-host',
  scopeNotice: 'Secrets are never returned.',
  observedAt: '2026-09-02T09:30:00Z',
  status: 'ok',
  cloudflared: {
    found: true,
    path: '/usr/bin/cloudflared',
    version: 'cloudflared version 2026.8.1',
    note: '',
  },
  wrangler: { found: true, path: '/usr/bin/wrangler', version: '', note: '' },
  docker: { found: true, path: '/usr/bin/docker', version: '', note: 'CLI only' },
  service: {
    manager: 'systemd',
    label: 'cloudflared.service',
    present: true,
    state: 'running',
    detail: 'active (running)',
    pid: 2184,
    executablePath: '/usr/bin/cloudflared',
  },
  configSources: [
    {
      id: 'config-main',
      path: '/etc/cloudflared/config.yml',
      source: 'service-argument',
      exists: true,
      readable: true,
      regular: true,
      symlink: false,
      valid: true,
      effective: true,
      boundToCanonicalService: true,
      serviceBinding: 'service-argument',
      managementMode: 'local',
      tunnel: 'homelab-main',
      credentialsPath: '/etc/cloudflared/invalid-test.json',
      revision: 'a'.repeat(64),
      catchAllPresent: true,
      routeCount: 3,
      warnings: [],
    },
    {
      id: 'config-dev',
      path: '/home/test/.cloudflared/config.yml',
      source: 'user-default',
      exists: true,
      readable: true,
      regular: true,
      symlink: false,
      valid: true,
      effective: false,
      boundToCanonicalService: false,
      serviceBinding: 'none',
      managementMode: 'local',
      tunnel: 'stale-local',
      credentialsPath: '',
      revision: 'b'.repeat(64),
      catchAllPresent: true,
      routeCount: 1,
      warnings: [],
    },
  ],
  deployments: [
    {
      id: 'homelab-main',
      name: 'homelab-main',
      driver: 'system-service',
      managementMode: 'local',
      configurationAuthority: 'Local YAML',
      status: 'running',
      statusDetail: 'active (running)',
      configPath: '/etc/cloudflared/config.yml',
      configRevision: 'a'.repeat(64),
      credentialSource: 'credentials file: /etc/cloudflared/invalid-test.json',
      configSourceId: 'config-main',
      boundToCanonicalService: true,
      serviceBinding: 'service-argument',
      routes: [
        {
          id: 'http-route',
          hostname: 'api.example.test',
          path: '',
          service: 'http://localhost:8080',
          protocol: 'http',
          catchAll: false,
        },
        {
          id: 'grpc-route',
          hostname: 'grpc.example.test',
          path: '',
          service: 'h2c://localhost:50051',
          protocol: 'h2c',
          catchAll: false,
        },
        {
          id: 'catch-all',
          hostname: '',
          path: '',
          service: 'http_status:404',
          protocol: 'http_status',
          catchAll: true,
        },
      ],
      runtime: {
        manager: 'systemd',
        label: 'cloudflared.service',
        present: true,
        state: 'running',
        detail: 'active (running)',
        pid: 2184,
        executablePath: '/usr/bin/cloudflared',
      },
      warnings: [],
    },
    {
      id: 'dev-preview',
      name: 'dev-preview',
      driver: 'config-only',
      managementMode: 'local',
      configurationAuthority: 'Local YAML',
      status: 'observed',
      statusDetail: 'Config only',
      configPath: '/home/test/.cloudflared/config.yml',
      configRevision: 'b'.repeat(64),
      credentialSource: 'none observed',
      configSourceId: 'config-dev',
      boundToCanonicalService: false,
      serviceBinding: 'none',
      routes: [],
      runtime: {
        manager: '',
        label: '',
        present: false,
        state: 'not-applicable',
        detail: '',
        pid: 0,
        executablePath: '',
      },
      warnings: [],
    },
  ],
  notes: [],
};

const elevationResult = {
  schemaVersion: 1,
  action: 'restart',
  status: 'elevation-required',
  message: 'systemd requires administrator authorization.',
  elevationRequired: true,
  elevationMechanism: 'sudo',
  manualCommand: 'sudo systemctl restart cloudflared.service',
  service: snapshot.service,
  observedAt: '2026-09-02T09:36:00Z',
};

const unavailableSnapshot = {
  ...snapshot,
  status: 'unavailable',
  cloudflared: {
    found: false,
    path: '',
    version: '',
    note: 'cloudflared was not found on PATH.',
  },
  wrangler: { found: false, path: '', version: '', note: 'Wrangler was not found on PATH.' },
  docker: { found: false, path: '', version: '', note: 'Docker CLI was not found on PATH.' },
  service: {
    manager: 'windows-service',
    label: 'Cloudflared',
    present: false,
    state: 'not-installed',
    detail: 'The canonical Windows service is not registered.',
    pid: 0,
    executablePath: '',
  },
  configSources: [
    {
      ...snapshot.configSources[0],
      path: 'C:\\ProgramData\\cloudflared\\config.yml',
      id: 'windows-system-default',
      source: 'system-default',
      exists: false,
      readable: false,
      regular: false,
      valid: false,
      effective: false,
      boundToCanonicalService: false,
      serviceBinding: 'none',
      tunnel: '',
      credentialsPath: '',
      revision: '',
      catchAllPresent: false,
      routeCount: 0,
    },
    {
      ...snapshot.configSources[0],
      path: 'C:\\Users\\test\\.cloudflared\\config.yml',
      id: 'windows-user-default',
      source: 'user-default',
      exists: false,
      readable: false,
      regular: false,
      valid: false,
      effective: false,
      boundToCanonicalService: false,
      serviceBinding: 'none',
      tunnel: '',
      credentialsPath: '',
      revision: '',
      catchAllPresent: false,
      routeCount: 0,
    },
  ],
  deployments: [],
  notes: ['No canonical cloudflared service or configuration was observed.'],
};

const remoteManagedSnapshot = {
  ...snapshot,
  configSources: [
    {
      ...snapshot.configSources[1],
      id: 'unrelated-local-config',
      path: '/home/test/.cloudflared/config.yml',
      boundToCanonicalService: false,
      serviceBinding: 'none',
    },
  ],
  deployments: [
    {
      ...snapshot.deployments[0],
      id: 'edge-api',
      name: 'edge-api',
      managementMode: 'remote',
      configurationAuthority: 'Cloudflare account',
      configPath: '',
      configRevision: '',
      configSourceId: '',
      boundToCanonicalService: true,
      serviceBinding: 'service-definition',
      credentialSource: 'service token (redacted)',
      routes: [],
    },
  ],
};

function renderTunnels() {
  const shell: ProtocolShellValue = {
    appearance: { version: 2, mode: 'light', palette: 'graphite' },
    resolvedAppearance: { version: 2, mode: 'light', palette: 'graphite', theme: 'light' },
    setAppearance: vi.fn(),
    interfacePreferences: { density: 'comfortable', showKeyboardHints: true },
    setInterfacePreferences: vi.fn(),
    discoveries: [],
    openScan: vi.fn(),
    openGRPCDiscovery: vi.fn(),
    openHTTPDiscovery: vi.fn(),
  };
  render(
    <ProtocolShellContext.Provider value={shell}>
      <Tunnels />
    </ProtocolShellContext.Provider>
  );
  return shell;
}

function stubTunnelAPI(
  options: {
    capabilities?: unknown;
    snapshot?: unknown;
    release?: unknown;
    serviceAction?: unknown | Promise<unknown>;
  } = {}
) {
  const request = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/api/tunnels/capabilities'))
      return Response.json(options.capabilities ?? capabilities);
    if (path.endsWith('/api/tunnels/snapshot')) return Response.json(options.snapshot ?? snapshot);
    if (path.endsWith('/api/tunnels/release')) return Response.json(options.release ?? release);
    if (path.endsWith('/api/tunnels/service-action'))
      return Response.json(await (options.serviceAction ?? elevationResult));
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', request);
  return request;
}

async function inspectLocalHost() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Inspect this host' })[0]);
  await screen.findByText('api.example.test');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tunnels', () => {
  it('renders selected split-console evidence and filters deployments', async () => {
    const request = stubTunnelAPI();
    renderTunnels();

    expect(await screen.findByRole('heading', { name: 'Tunnel operations' })).toBeVisible();
    expect(screen.getByText('Inspect this host for cloudflared')).toBeVisible();
    expect(screen.queryByText('No deployment observed')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tunnel deployments')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tunnel workspace pane' })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    await inspectLocalHost();
    expect(screen.getByText('grpc.example.test')).toBeVisible();
    expect(screen.getByText('/etc/cloudflared/config.yml')).toBeVisible();
    expect(screen.getByText(/PID 2184/)).toBeVisible();

    const deploymentList = screen.getByLabelText('Tunnel deployments');
    fireEvent.click(screen.getByRole('button', { name: /Not running 1/ }));
    expect(within(deploymentList).getByText('dev-preview')).toBeVisible();
    expect(within(deploymentList).queryByText('homelab-main')).not.toBeInTheDocument();
  });

  it('creates an in-view route draft without issuing a mutation request', async () => {
    const request = stubTunnelAPI();
    renderTunnels();
    await inspectLocalHost();

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Tunnel controls' });
    const trigger = within(toolbar).getByRole('button', { name: 'Draft ingress route' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Draft ingress route' });
    fireEvent.change(within(dialog).getByLabelText('Public hostname'), {
      target: { value: 'status.example.test' },
    });
    fireEvent.change(within(dialog).getByLabelText('Origin service'), {
      target: { value: 'http://localhost:9090' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Path regular expression/), {
      target: { value: '/api/*' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Review plan/ }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/regular expressions/i);
    fireEvent.change(within(dialog).getByLabelText(/Path regular expression/), {
      target: { value: '^/api/.*' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Review plan/ }));

    expect(await within(dialog).findByText('Apply is intentionally unavailable')).toBeVisible();
    expect(within(dialog).getByText('Browser-validated draft')).toBeVisible();
    expect(within(dialog).getByText(/cloudflared has not validated this draft/i)).toBeVisible();
    expect(within(dialog).getByText('No change')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: /Keep as draft/ }));

    const draftedRoute = await screen.findByRole('button', {
      name: /status\.example\.test\^\/api\/\.\*/,
    });
    expect(draftedRoute).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('tab', { name: 'Routes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Draft origin · not observed')).toBeVisible();
    expect(screen.getByText(/No file, service, or Cloudflare account was changed/)).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('does not hand a browser-only route draft to a protocol workbench', async () => {
    const request = stubTunnelAPI();
    const shell = renderTunnels();
    await inspectLocalHost();

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Tunnel controls' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Draft ingress route' }));
    const dialog = await screen.findByRole('dialog', { name: 'Draft ingress route' });
    fireEvent.change(within(dialog).getByLabelText('Public hostname'), {
      target: { value: 'draft.example.test' },
    });
    fireEvent.change(within(dialog).getByLabelText('Origin service'), {
      target: { value: 'http://localhost:9090' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Review plan/ }));
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: /Keep as draft/,
      })
    );

    expect(await screen.findByText('Draft origin · not observed')).toBeVisible();
    const httpHandoff = screen.getByRole('button', { name: 'Open in HTTP' });
    const grpcHandoff = screen.getByRole('button', { name: 'Open in gRPC' });
    expect(httpHandoff).toBeDisabled();
    expect(grpcHandoff).toBeDisabled();
    expect(httpHandoff).toHaveAttribute(
      'title',
      'Browser-only drafts are not observed host evidence.'
    );
    expect(grpcHandoff).toHaveAttribute(
      'title',
      'Browser-only drafts are not observed host evidence.'
    );
    fireEvent.click(httpHandoff);
    fireEvent.click(grpcHandoff);
    expect(shell.openHTTPDiscovery).not.toHaveBeenCalled();
    expect(shell.openGRPCDiscovery).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('hands an observed HTTP origin to the existing HTTP workbench contract', async () => {
    stubTunnelAPI();
    const shell = renderTunnels();
    await inspectLocalHost();

    fireEvent.click(screen.getByRole('button', { name: 'Open in HTTP' }));
    await waitFor(() => expect(shell.openHTTPDiscovery).toHaveBeenCalledTimes(1));
    expect(vi.mocked(shell.openHTTPDiscovery).mock.calls[0][0]).toMatchObject({
      address: 'localhost:8080',
      http: true,
      httpTransport: 'plaintext',
    });
  });

  it('shows completed real-host checks and useful setup when cloudflared is unavailable', async () => {
    const windowsCapabilities = {
      ...capabilities,
      platform: 'windows',
      serviceManager: 'windows-service',
      install: {
        ...capabilities.install,
        platform: 'windows',
        elevationMechanism: 'UAC',
        elevationNotice: 'Windows may show a UAC administrator prompt.',
        commands: [
          {
            id: 'winget',
            label: 'Install with winget',
            command: 'winget install --id Cloudflare.cloudflared',
            requiresElevation: false,
          },
        ],
      },
    };
    stubTunnelAPI({ capabilities: windowsCapabilities, snapshot: unavailableSnapshot });
    renderTunnels();

    fireEvent.click(screen.getAllByRole('button', { name: 'Inspect this host' })[0]);
    expect(await screen.findByRole('heading', { name: 'Host inspection complete' })).toBeVisible();
    expect(screen.getByText(/Actual checks completed on this windows host/)).toBeVisible();
    expect(screen.queryByLabelText('Tunnel deployments')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tunnel workspace pane' })).not.toBeInTheDocument();
    const installHeading = screen.getByRole('heading', { name: 'Install cloudflared' });
    expect(installHeading).toBeVisible();

    const tools = screen.getByRole('heading', { name: 'Local tool checks' }).closest('section');
    expect(tools).not.toBeNull();
    expect(installHeading.compareDocumentPosition(tools as HTMLElement) & 4).toBeTruthy();
    expect(within(tools as HTMLElement).getAllByText('Not found')).toHaveLength(3);
    expect(screen.getByText('The canonical Windows service is not registered.')).toBeVisible();
    const configSummary = screen.getByText('Configuration evidence').closest('summary');
    expect(configSummary).not.toBeNull();
    fireEvent.click(configSummary as HTMLElement);
    expect(screen.getByText('C:\\ProgramData\\cloudflared\\config.yml')).toBeVisible();
    expect(screen.getByText('C:\\Users\\test\\.cloudflared\\config.yml')).toBeVisible();
    expect(screen.getAllByText('Checked · not found')).toHaveLength(2);
    expect(screen.getByText(/never asks for, receives, or stores your password/i)).toBeVisible();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('checks the latest version only after an explicit click and renders safe official links', async () => {
    const request = stubTunnelAPI();
    renderTunnels();

    expect(request).not.toHaveBeenCalled();
    await inspectLocalHost();
    expect(request).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByText(/Contacts GitHub Releases only when you click/)).toBeVisible();
    expect(screen.getAllByText('Not checked').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Check latest version' }));
    expect(await screen.findByText('2026.9.0')).toBeVisible();
    expect(screen.getByText('Update available')).toBeVisible();
    expect(request).toHaveBeenCalledTimes(3);

    const releaseRequest = request.mock.calls[2];
    expect(new URL(String(releaseRequest[0])).pathname).toBe('/api/tunnels/release');
    expect(releaseRequest[1]).toMatchObject({ method: 'POST' });
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noreferrer');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('requires confirmation, sends the exact service action, and explains elevation', async () => {
    const request = stubTunnelAPI({ serviceAction: elevationResult });
    renderTunnels();
    await inspectLocalHost();

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm restart' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      within(dialog).getByText(/never asks for, receives, or stores your password/i)
    ).toBeVisible();
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm restart' }));
    expect(await screen.findByText('sudo systemctl restart cloudflared.service')).toBeVisible();
    expect(screen.getByText('OS authorization required')).toBeVisible();

    const serviceRequest = request.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith('/api/tunnels/service-action')
    );
    expect(serviceRequest).toBeDefined();
    const init = serviceRequest?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-protopeek-csrf-token': '',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'restart',
      expectedState: 'running',
      confirmed: true,
    });
  });

  it('refreshes real host evidence after a completed service action', async () => {
    const request = stubTunnelAPI({
      serviceAction: {
        ...elevationResult,
        status: 'completed',
        message: 'cloudflared.service restarted.',
        elevationRequired: false,
        elevationMechanism: '',
        manualCommand: '',
      },
    });
    renderTunnels();
    await inspectLocalHost();

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Confirm restart' })).getByRole('button', {
        name: 'Confirm restart',
      })
    );

    expect(await screen.findByText('Service action completed')).toBeVisible();
    await waitFor(() => {
      const snapshotRequests = request.mock.calls.filter(([input]) =>
        new URL(String(input)).pathname.endsWith('/api/tunnels/snapshot')
      );
      expect(snapshotRequests).toHaveLength(2);
    });
  });

  it('does not attribute a deferred service action result to another deployment', async () => {
    let resolveServiceAction!: (value: typeof elevationResult) => void;
    const serviceAction = new Promise<typeof elevationResult>((resolve) => {
      resolveServiceAction = resolve;
    });
    const request = stubTunnelAPI({
      serviceAction,
    });
    renderTunnels();
    await inspectLocalHost();

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Confirm restart' })).getByRole('button', {
        name: 'Confirm restart',
      })
    );
    await waitFor(() =>
      expect(
        request.mock.calls.some(([input]) =>
          new URL(String(input)).pathname.endsWith('/api/tunnels/service-action')
        )
      ).toBe(true)
    );
    const actionRequest = request.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith('/api/tunnels/service-action')
    );
    const actionSignal = (actionRequest?.[1] as RequestInit | undefined)?.signal;

    fireEvent.click(screen.getByRole('button', { name: /dev-previewUnmanaged config/ }));
    expect(await screen.findByRole('heading', { name: 'dev-preview' })).toBeVisible();
    expect(actionSignal?.aborted).toBe(false);

    resolveServiceAction({
      ...elevationResult,
      status: 'completed',
      message: 'cloudflared.service restarted.',
      elevationRequired: false,
      elevationMechanism: '',
      manualCommand: '',
    });

    await waitFor(() =>
      expect(
        request.mock.calls.filter(([input]) =>
          new URL(String(input)).pathname.endsWith('/api/tunnels/snapshot')
        )
      ).toHaveLength(2)
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restart' })).toHaveAttribute(
        'title',
        expect.stringContaining('Configuration-only')
      )
    );
    expect(actionSignal?.aborted).toBe(false);
    expect(screen.queryByText('Service action completed')).not.toBeInTheDocument();
    expect(screen.queryByText('cloudflared.service restarted.')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'dev-preview' })).toBeVisible();
  });

  it('clears host-service feedback and actions when an unbound config deployment is selected', async () => {
    stubTunnelAPI({ serviceAction: elevationResult });
    renderTunnels();
    await inspectLocalHost();

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Confirm restart' })).getByRole('button', {
        name: 'Confirm restart',
      })
    );
    expect(await screen.findByText('OS authorization required')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /dev-previewUnmanaged config/ }));
    await waitFor(() =>
      expect(screen.queryByText('OS authorization required')).not.toBeInTheDocument()
    );
    expect(screen.queryByText(/PID 2184/)).not.toBeInTheDocument();
    expect(screen.getByText(/Configuration-only deployment/)).toBeVisible();
    for (const name of ['Start', 'Stop', 'Restart']) {
      const control = screen.getByRole('button', { name });
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute('title', expect.stringContaining('Configuration-only'));
    }
    expect(screen.getByText('/home/test/.cloudflared/config.yml')).toBeVisible();
    expect(screen.queryByText('/etc/cloudflared/config.yml')).not.toBeInTheDocument();
  });

  it('keeps remote-managed authority separate from unrelated local YAML', async () => {
    stubTunnelAPI({ snapshot: remoteManagedSnapshot });
    renderTunnels();

    fireEvent.click(screen.getByRole('button', { name: 'Inspect this host' }));
    expect(await screen.findByRole('heading', { name: 'edge-api' })).toBeVisible();
    expect(
      screen.getByText('No local YAML source is attributed to this remote-managed deployment.')
    ).toBeVisible();
    expect(screen.queryByText('/home/test/.cloudflared/config.yml')).not.toBeInTheDocument();

    const toolbar = screen.getByRole('toolbar', { name: 'Tunnel controls' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Draft ingress route' }));
    const dialog = await screen.findByRole('dialog', { name: 'Draft ingress route' });
    expect(within(dialog).getByText('Cloudflare account authority')).toBeVisible();
    expect(within(dialog).getByText(/No local YAML destination is assumed/)).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText('Public hostname'), {
      target: { value: 'edge.example.test' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Review plan/ }));
    expect(within(dialog).getByText('Portable draft · Cloudflare account authority')).toBeVisible();
  });

  it('labels diagnostics truthfully without duplicating host evidence', async () => {
    stubTunnelAPI();
    renderTunnels();
    await inspectLocalHost();

    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }));
    expect(screen.getAllByText('Not queried')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Local tool checks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Logs/ })).not.toBeInTheDocument();
  });

  it('disables service mutations while the observed state is transitional or unknown', async () => {
    stubTunnelAPI({
      snapshot: {
        ...snapshot,
        service: { ...snapshot.service, state: 'starting' },
      },
    });
    renderTunnels();
    await inspectLocalHost();

    for (const name of ['Start', 'Stop', 'Restart']) {
      const control = screen.getByRole('button', { name });
      expect(control).toBeDisabled();
      expect(control.getAttribute('title')).toContain('stable state');
    }
  });

  it('keeps the deployment and detail pane semantics for narrow layouts', async () => {
    stubTunnelAPI();
    renderTunnels();

    expect(screen.queryByRole('group', { name: 'Tunnel workspace pane' })).not.toBeInTheDocument();
    await inspectLocalHost();
    expect(screen.getByRole('button', { name: /Deployments 2/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('button', { name: 'Details' })).toBeEnabled();
  });
});

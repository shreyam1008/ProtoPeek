import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TunnelDeployment } from '@/console/tunnels-api';
import { CloudflareOperations } from './CloudflareOperations';

const before = 'a'.repeat(64);
const after = 'b'.repeat(64);
const deployment = {
  id: 'canonical',
  name: 'Local',
  boundToCanonicalService: true,
  managementMode: 'local',
  configPath: '/fixture/config.yml',
  configRevision: before,
} as TunnelDeployment;
const plan = {
  id: 'private-plan',
  path: deployment.configPath,
  beforeRevision: before,
  afterRevision: after,
  route: { hostname: 'new.test', path: '/api', service: 'http://127.0.0.1:8080' },
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  applied: false,
};
const response = (operation: string, extra = {}) => ({
  operation,
  status: 'completed',
  message: 'Observed native operation.',
  observedAt: '2026-10-22T12:00:00Z',
  ...extra,
});
afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('stays quiet until an explicit operation and sends the canonical revision with CSRF', async () => {
  const fetch = vi.fn(async () => Response.json(response('validate')));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('_protopeek_csrf_token=fixture');
  render(<CloudflareOperations deployment={deployment} writable onRefresh={vi.fn()} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Validate ingress' }));
  await screen.findByText('validate: completed');
  const [url, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.pathname).toBe('/api/tunnels/operation');
  expect(options.headers).toMatchObject({ 'x-protopeek-csrf-token': 'fixture' });
  expect(JSON.parse(String(options.body))).toMatchObject({
    operation: 'validate',
    configPath: deployment.configPath,
    revision: before,
    confirmed: false,
  });
});

it('previews before consent and preserves private rollback through the refreshed observation', async () => {
  const requests: Record<string, unknown>[] = [];
  const refresh = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: URL, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      requests.push(request);
      if (request.operation === 'plan')
        return Response.json(response('plan', { status: 'planned', plan }));
      return Response.json(
        response(request.operation, {
          plan: { ...plan, applied: request.operation === 'apply' },
          receipt: {
            id: 'receipt',
            status: 'completed',
            beforeRevision: request.revision,
            afterRevision: request.operation === 'apply' ? after : before,
          },
        })
      );
    })
  );
  const view = render(
    <CloudflareOperations deployment={deployment} writable onRefresh={refresh} />
  );
  fireEvent.click(screen.getByText('Add a route to this canonical config'));
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'new.test' } });
  fireEvent.change(screen.getByLabelText('Path expression (optional)'), {
    target: { value: '/api' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview validated change' }));
  const apply = await screen.findByRole('button', { name: 'Apply reviewed change' });
  expect(apply).toBeDisabled();
  expect(requests).toHaveLength(1);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(apply);
  await screen.findByRole('button', { name: 'Roll back this change' });
  expect(requests[1]).toMatchObject({
    operation: 'apply',
    planId: plan.id,
    revision: before,
    confirmed: true,
  });
  view.rerender(
    <CloudflareOperations
      deployment={{ ...deployment, configRevision: after }}
      writable
      onRefresh={refresh}
    />
  );
  expect(screen.getByRole('button', { name: 'Roll back this change' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Roll back this change' }));
  await screen.findByText('rollback: completed');
  expect(requests[2]).toMatchObject({
    operation: 'rollback',
    planId: plan.id,
    revision: after,
    confirmed: true,
  });
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('invalidates the preview when edited inputs change', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(response('plan', { status: 'planned', plan })))
  );
  render(<CloudflareOperations deployment={deployment} writable onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByText('Add a route to this canonical config'));
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'new.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview validated change' }));
  await screen.findByRole('button', { name: 'Apply reviewed change' });
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'other.test' } });
  expect(screen.queryByRole('button', { name: 'Apply reviewed change' })).not.toBeInTheDocument();
});

it('keeps Cancel reachable and ignores a late result after cancellation', async () => {
  let resolve!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_url: URL, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise<Response>((done) => {
      resolve = done;
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(<CloudflareOperations deployment={deployment} writable onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Metrics snapshot' }));
  expect(screen.getByRole('button', { name: 'Validate ingress' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel waiting' }));
  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent('may already have completed');
  await act(async () => {
    resolve(Response.json(response('metrics', { message: 'LATE_RESULT' })));
  });
  expect(screen.queryByText('LATE_RESULT')).not.toBeInTheDocument();
});

it('refuses controls for remote-managed or unbound configurations without requests', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(
    <CloudflareOperations
      deployment={{ ...deployment, managementMode: 'remote' }}
      writable
      onRefresh={vi.fn()}
    />
  );
  expect(screen.queryByRole('button', { name: 'Validate ingress' })).not.toBeInTheDocument();
  expect(screen.getByText(/require an observed locally managed/)).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it('does not export a report until the explicit sanitized operation completes', async () => {
  const fetch = vi.fn(async () =>
    Response.json(
      response('report', { data: { format: 'protopeek-cloudflare-evidence', version: 1 } })
    )
  );
  vi.stubGlobal('fetch', fetch);
  render(<CloudflareOperations deployment={deployment} writable={false} onRefresh={vi.fn()} />);
  expect(
    screen.queryByRole('button', { name: 'Download sanitized report' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare sanitized report' }));
  await screen.findByRole('button', { name: 'Download sanitized report' });
  expect((screen.getByLabelText('Operation evidence') as HTMLTextAreaElement).value).toContain(
    'protopeek-cloudflare-evidence'
  );
});

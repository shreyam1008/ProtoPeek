import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PublishingWorkbench } from './PublishingWorkbench';
import {
  type PublishPreview,
  type PublishRequest,
  type PublishSession,
  parsePublishSession,
} from './publish-sessions';

afterEach(() => vi.unstubAllGlobals());
const identity = 'a'.repeat(32);
const preview = (request: PublishRequest): PublishPreview => ({
  revision: identity,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  request,
  audience: request.mode === 'serve' ? 'private tailnet' : 'public internet',
  executable: '/fixture/installed-client',
  arguments:
    request.mode === 'quick'
      ? ['tunnel', '--url', request.origin]
      : [request.mode, '--https=443', request.origin],
  origin: { connected: true, durationMs: 1 },
  notice: 'Only the owned foreground process is stopped.',
});
const session = (state: PublishSession['state'] = 'running'): PublishSession => ({
  id: identity,
  mode: 'quick',
  audience: 'public internet',
  originUrl: 'http://127.0.0.1:3000',
  origin: { connected: true, durationMs: 1 },
  endpoint: 'https://fixture.trycloudflare.com',
  endpointVerified: false,
  endpointStatus: 0,
  endpointCheckedAt: null,
  endpointError: '',
  state,
  reason: state === 'failed' ? 'Native process failed.' : '',
  cleanup: state === 'stopped' ? 'confirmed' : 'pending',
  pid: 1234,
  startedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  events: [],
});

it('is quiet until asked and requires reviewed public consent before starting', async () => {
  const calls: { operation: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      const operation = url.pathname.split('/').at(-1) ?? '';
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ operation, body });
      return Response.json(operation === 'preview' ? preview(body) : session('starting'));
    })
  );
  render(<PublishingWorkbench />);
  expect(calls).toHaveLength(0);
  expect(screen.getByLabelText('Who can reach it?')).toHaveValue('serve');
  fireEvent.change(screen.getByLabelText('Who can reach it?'), { target: { value: 'quick' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review session' }));
  await screen.findByLabelText('Publishing preview');
  expect(calls.map((call) => call.operation)).toEqual(['preview']);
  expect(screen.getByRole('heading', { name: 'Review · public internet' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Start reviewed session' })).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText('I understand this service will be reachable from the public internet.')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start reviewed session' }));
  await screen.findByLabelText('Owned publishing session');
  expect(calls[1]).toEqual({ operation: 'start', body: { revision: identity, confirmed: true } });
  expect(screen.getByText(/Leaving this page keeps it running/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Publishing preview')).not.toBeInTheDocument();
});

it('invalidates preview and consent when the origin or audience changes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: URL, options: RequestInit) =>
      Response.json(preview(JSON.parse(String(options.body))))
    )
  );
  render(<PublishingWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Review session' }));
  await screen.findByLabelText('Publishing preview');
  fireEvent.click(screen.getByLabelText('I confirm this service may be shared with my tailnet.'));
  fireEvent.change(screen.getByLabelText('Local origin URL'), {
    target: { value: 'http://127.0.0.1:4000' },
  });
  expect(screen.queryByLabelText('Publishing preview')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review session' }));
  await screen.findByLabelText('Publishing preview');
  expect(screen.getByRole('button', { name: 'Start reviewed session' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Who can reach it?'), { target: { value: 'funnel' } });
  expect(screen.queryByLabelText('Publishing preview')).not.toBeInTheDocument();
});

it('recovers an accepted but locally cancelled start and stops only its owned identity', async () => {
  let resolveStart!: (value: Response) => void;
  let startSignal: AbortSignal | null | undefined;
  const calls: { operation: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) => {
      const operation = url.pathname.split('/').at(-1) ?? '';
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ operation, body });
      if (operation === 'preview') return Response.json(preview(body));
      if (operation === 'start') {
        startSignal = options.signal;
        return new Promise<Response>((resolve) => {
          resolveStart = resolve;
        });
      }
      return Response.json(operation === 'status' ? { session: session() } : session('stopped'));
    })
  );
  render(<PublishingWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Review session' }));
  await screen.findByLabelText('Publishing preview');
  fireEvent.click(screen.getByLabelText('I confirm this service may be shared with my tailnet.'));
  fireEvent.click(screen.getByRole('button', { name: 'Start reviewed session' }));
  await screen.findByRole('button', { name: 'Cancel request' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
  expect(startSignal?.aborted).toBe(true);
  expect(screen.getByRole('button', { name: 'Review session' })).toBeDisabled();
  resolveStart(Response.json(session('starting')));
  fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
  await screen.findByLabelText('Owned publishing session');
  fireEvent.click(screen.getByRole('button', { name: 'Stop owned session' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'public internet · stopped' })).toBeInTheDocument()
  );
  expect(calls.find((call) => call.operation === 'stop')?.body).toEqual({ id: identity });
  expect(
    screen.getByText(/Published endpoint reachability has not been verified/)
  ).toBeInTheDocument();
});

it('surfaces native prerequisite failure without offering a start', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response('Existing native Serve rules were preserved.', { status: 409 })
      )
  );
  render(<PublishingWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Review session' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('preserved');
  expect(screen.queryByRole('button', { name: 'Start reviewed session' })).not.toBeInTheDocument();
});

it('blocks another session until an explicit native cleanup recheck confirms recovery', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        session: {
          ...session('failed'),
          cleanup: 'unconfirmed',
          reason: 'Native cleanup is unconfirmed; external rules were preserved.',
        },
      })
    )
    .mockResolvedValueOnce(Response.json({ session: session('stopped') }));
  vi.stubGlobal('fetch', fetchMock);
  render(<PublishingWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
  await screen.findByLabelText('Owned publishing session');
  expect(screen.getByRole('button', { name: 'Review session' })).toBeDisabled();
  expect(screen.getByText(/Resolve any remaining native rules/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review session' })).toBeEnabled());
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('checks only the reported owned endpoint after an explicit action and shows HTTP failure separately', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      const operation = url.pathname.split('/').at(-1) ?? '';
      calls.push(operation);
      return Response.json(
        operation === 'status'
          ? { session: session() }
          : {
              ...session(),
              endpointVerified: true,
              endpointStatus: 503,
              endpointCheckedAt: new Date().toISOString(),
            }
      );
    })
  );
  render(<PublishingWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
  await screen.findByLabelText('Owned publishing session');
  expect(calls).toEqual(['status']);
  fireEvent.click(screen.getByRole('button', { name: 'Check endpoint HTTPS' }));
  await screen.findByText(/verified HTTPS peer responded · HTTP 503/);
  expect(calls).toEqual(['status', 'verify']);
  expect(screen.getByText(/application behavior was not checked/)).toBeInTheDocument();
});

it('rejects a claimed verified endpoint or oversized native evidence', () => {
  expect(() => parsePublishSession({ ...session(), endpointVerified: true })).toThrow();
  expect(() =>
    parsePublishSession({
      ...session(),
      events: Array.from({ length: 65 }, () => ({
        observedAt: new Date().toISOString(),
        message: 'event',
      })),
    })
  ).toThrow();
  expect(() => parsePublishSession({ ...session(), endpoint: 'javascript:alert(1)' })).toThrow();
});

it('renders repeated reviewed arguments and identical operational events without key collisions', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const duplicate = { observedAt: new Date().toISOString(), message: 'Connection registered.' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options: RequestInit) =>
      Response.json(
        url.pathname.endsWith('/preview')
          ? { ...preview(JSON.parse(String(options.body))), arguments: ['serve', '443', '443'] }
          : { session: { ...session(), events: [duplicate, duplicate] } }
      )
    )
  );
  try {
    render(<PublishingWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Review session' }));
    const review = await screen.findByLabelText('Publishing preview');
    expect(within(review).getAllByText('443')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
    const owned = await screen.findByLabelText('Owned publishing session');
    expect(within(owned).getAllByText(/Connection registered/)).toHaveLength(2);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique.*key/i);
  } finally {
    errors.mockRestore();
  }
});

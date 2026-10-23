import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { agentFetch } from './agent-api';
import { agentClientIds } from './agent-client-kind';
import { createProtoPeekRouter } from './router';

vi.mock('./agent-api', () => ({ agentFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it('validates the local agent client deep-link allowlist on route load', async () => {
  for (const client of agentClientIds) {
    const router = createProtoPeekRouter(
      createMemoryHistory({ initialEntries: [`/agents?client=${client}`] })
    );
    await router.load();
    expect(router.state.matches.at(-1)?.search).toEqual({ client });
  }
  for (const client of ['chatgpt-web', 'bad-client', 'codex ', ['codex'], 1]) {
    const encoded = encodeURIComponent(
      typeof client === 'string' ? client : JSON.stringify(client)
    );
    const router = createProtoPeekRouter(
      createMemoryHistory({ initialEntries: [`/agents?client=${encoded}`] })
    );
    await router.load();
    expect(router.state.matches.at(-1)?.search).toEqual({ client: undefined });
  }
});

it('opens and changes actual client deep links without enabling or running tools', async () => {
  vi.mocked(agentFetch).mockImplementation(async (path, signal) => {
    if (path.startsWith('state?')) {
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      );
    }
    return {
      executable: '/usr/bin/protopeek',
      connectionFile: '/tmp/pair.json',
      enabled: false,
      allowWrites: false,
      instance: 'qa',
      revision: 1,
      records: [],
      tools: [],
    } as never;
  });
  const router = createProtoPeekRouter(
    createMemoryHistory({ initialEntries: ['/agents?client=codex'] })
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('combobox', { name: 'Agent client' })).toHaveValue('codex');
  fireEvent.change(screen.getByRole('combobox', { name: 'Agent client' }), {
    target: { value: 'generic' },
  });
  await act(async () => {
    await router.navigate({ to: '/agents', search: { client: 'opencode' } });
  });
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Agent client' })).toHaveValue('opencode')
  );
  expect(screen.getByLabelText('MCP configuration')).toHaveTextContent('"type": "local"');
  expect(vi.mocked(agentFetch).mock.calls.every(([path]) => path.startsWith('state'))).toBe(true);
});

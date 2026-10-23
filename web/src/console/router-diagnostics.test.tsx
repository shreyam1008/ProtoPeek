import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearOperationReceipts, readOperationReceipts } from './app/operation-receipts';
import { createProtoPeekRouter } from './router';

const evidence = {
  mode: 'availability',
  target: '127.0.0.1:8443',
  observedAt: '2026-10-23T11:00:00Z',
  durationMs: 20,
  complete: true,
  summary: 'Earlier connection evidence',
  outcome: 'success',
  addresses: ['127.0.0.1'],
  checks: [],
  dns: [],
  samples: [],
  warnings: [],
};

beforeEach(() => clearOperationReceipts());
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearOperationReceipts();
});

it('restarts an identical diagnostics command after local edits without putting an invocation in the URL', async () => {
  const fetchMock = vi.fn(async () => Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
  const router = createProtoPeekRouter(
    createMemoryHistory({ initialEntries: ['/network/diagnostics?mode=dns'] })
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('combobox', { name: 'Diagnostic' })).toHaveValue('dns');
  for (let invocation = 1; invocation <= 2; invocation++) {
    fireEvent.change(screen.getByLabelText('Diagnostic'), { target: { value: 'tls' } });
    const trust = screen.getByLabelText('Private CA certificate (optional)');
    fireEvent.change(trust, { target: { value: 'Draft trust input' } });
    expect(screen.getByLabelText('Diagnostic')).toHaveValue('tls');
    expect(trust).toHaveValue('Draft trust input');
    fireEvent.click(screen.getByRole('button', { name: 'Open global command menu' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Diagnose: DNS records' }));
    await waitFor(() => expect(screen.getByLabelText('Diagnostic')).toHaveValue('dns'));
    expect(router.state.location.search).toEqual({ mode: 'dns', target: undefined });
    expect(router.state.location.state.diagnosticInvocation).toBe(invocation);
    expect(screen.queryByLabelText('Private CA certificate (optional)')).not.toBeInTheDocument();
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it('retains search remounting, aborts the previous run and rejects its late evidence', async () => {
  let finish: (response: Response) => void = () => {};
  let submittedSignal: AbortSignal | undefined;
  const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    submittedSignal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const router = createProtoPeekRouter(
    createMemoryHistory({
      initialEntries: ['/network/diagnostics?mode=availability&target=https://127.0.0.1:8443'],
    })
  );
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run diagnostic' }));
  expect(submittedSignal?.aborted).toBe(false);
  await act(async () => {
    await router.navigate({
      to: '/network/diagnostics',
      search: { mode: 'tls', target: 'https://different.test:9443' },
    });
  });
  await waitFor(() => expect(screen.getByLabelText('Diagnostic')).toHaveValue('tls'));
  expect(screen.getByLabelText('Target')).toHaveValue('https://different.test:9443');
  expect(submittedSignal?.aborted).toBe(true);
  await act(async () => finish(Response.json(evidence)));
  expect(screen.queryByRole('region', { name: 'Diagnostic result' })).not.toBeInTheDocument();
  expect(screen.queryByText(evidence.summary)).not.toBeInTheDocument();
  expect(readOperationReceipts()).toEqual([
    expect.objectContaining({ operation: 'diagnostics', outcome: 'cancelled' }),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

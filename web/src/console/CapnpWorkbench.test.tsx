import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CapnpWorkbench } from './CapnpWorkbench';
import { callCapnp, readCapnpFiles } from './capnp-api';

afterEach(() => vi.unstubAllGlobals());
it('reports a failed compiler check instead of checking forever', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<CapnpWorkbench />);
  await screen.findByText(/Could not check the source compiler/);
  expect(screen.queryByText(/Checking local compiler/)).not.toBeInTheDocument();
});

it('rejects invalid UTF-8 source without silently replacing bytes', async () => {
  const file = {
    name: 'test.capnp',
    size: 2,
    arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer,
  } as File;
  await expect(readCapnpFiles([file])).rejects.toThrow();
});
const method = {
  interfaceId: '0xb1529bf8e102de33',
  interfaceName: 'example.capnp:Workbench',
  ordinal: 1,
  name: 'add',
  paramsId: '0x1',
  resultsId: '0x2',
  fields: [{ name: 'a', type: 'int64', union: false }],
};
const schema = { schemaBase64: 'AAAA', nodeCount: 4, methods: [method] };
const response = {
  address: 'localhost:7000',
  remoteAddress: '127.0.0.1:7000',
  transport: 'tcp',
  durationMs: 3,
  observedAt: '2026-09-06T12:00:00Z',
  result: { sum: '9007199254740993' },
};

it('loads a schema without connecting and preserves exact numeric input on call', async () => {
  const calls: { path: string; body: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options?: RequestInit) => {
      calls.push({ path: url.pathname, body: String(options?.body ?? '') });
      if (url.pathname.endsWith('capabilities')) return Response.json({ available: true });
      return Response.json(url.pathname.endsWith('schema') ? schema : response);
    })
  );
  render(<CapnpWorkbench />);
  fireEvent.click(screen.getByText('Paste a source schema'));
  fireEvent.change(screen.getByLabelText('Cap’n Proto schema source'), {
    target: { value: '@0xabcdefabcdefabcd; interface Test {}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Compile pasted schema' }));
  await screen.findByRole('button', { name: /example.capnp:Workbench add/ });
  expect(calls.some((call) => call.path.endsWith('/call'))).toBe(false);
  fireEvent.change(screen.getByLabelText('Cap’n Proto request JSON'), {
    target: { value: '{"a":9007199254740993}' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Call method' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Cap’n Proto response JSON')).toHaveValue(
      JSON.stringify(response.result, null, 2)
    )
  );
  expect(calls.find((call) => call.path.endsWith('/call'))?.body).toContain(
    '"params":{"a":9007199254740993}'
  );
});

it('cancels a call and ignores a late result', async () => {
  let finish!: (value: Response) => void;
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, options?: RequestInit) => {
      if (url.pathname.endsWith('capabilities')) return Response.json({ available: false });
      if (url.pathname.endsWith('schema')) return Response.json(schema);
      signal = options?.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    })
  );
  render(<CapnpWorkbench />);
  fireEvent.click(screen.getByText('Paste a source schema'));
  fireEvent.change(screen.getByLabelText('Cap’n Proto schema source'), {
    target: { value: 'schema' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Compile pasted schema' }));
  await screen.findByRole('button', { name: /example.capnp:Workbench add/ });
  fireEvent.click(screen.getByRole('button', { name: 'Call method' }));
  await screen.findByRole('button', { name: 'Cancel calling' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel calling' }));
  expect(signal?.aborted).toBe(true);
  finish(Response.json(response));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Cancelled'));
  expect(screen.queryByLabelText('Cap’n Proto response JSON')).not.toBeInTheDocument();
});

it('rejects malformed JSON before fetch', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    callCapnp(
      {
        schemaBase64: 'AAAA',
        address: 'localhost:7000',
        transport: 'tcp',
        serverName: '',
        rootCaPem: '',
        interfaceId: method.interfaceId,
        ordinal: 1,
        timeoutMs: 1000,
        params: '{bad}',
      },
      new AbortController().signal
    )
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

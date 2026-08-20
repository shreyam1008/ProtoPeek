import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HTTPResponse } from '@/shared/types';

import { HTTPResponsePanel } from './HTTPResponsePanel';

const response: HTTPResponse = {
  status: '200 OK',
  statusCode: 200,
  proto: 'HTTP/1.1',
  headers: [{ name: 'content-type', value: 'text/plain' }],
  body: 'hello',
  bodyEncoding: 'text',
  bytes: 5,
  truncated: false,
  redirects: [],
  remoteIp: '127.0.0.1:8080',
  tls: null,
  timings: { dnsMs: 0, connectMs: 1, tlsMs: 0, ttfbMs: 2, totalMs: 3 },
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('HTTPResponsePanel', () => {
  it('reports clipboard rejection instead of claiming response evidence was copied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    render(<HTTPResponsePanel response={response} loading={false} error={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy response body' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not copy response body/i)
    );
    expect(screen.queryByText(/^Copied$/)).not.toBeInTheDocument();
  });

  it('does not attribute a deferred copy to newer response evidence', async () => {
    let resolveCopy: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        })
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { rerender } = render(
      <HTTPResponsePanel response={response} loading={false} error={null} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy response body' }));

    rerender(
      <HTTPResponsePanel
        response={{ ...response, status: '201 Created', statusCode: 201, body: 'new evidence' }}
        loading={false}
        error={null}
      />
    );
    resolveCopy?.();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('hello'));
    expect(screen.getByRole('button', { name: 'Copy response body' })).toHaveTextContent('Copy');
    expect(screen.queryByText('Response body copied.')).not.toBeInTheDocument();
  });

  it('does not reread large immutable response evidence on unrelated parent commits', () => {
    let bodyReads = 0;
    const observed = { ...response };
    Object.defineProperty(observed, 'body', {
      configurable: true,
      enumerable: true,
      get: () => {
        bodyReads += 1;
        return response.body;
      },
    });
    const { rerender } = render(
      <HTTPResponsePanel response={observed} loading={false} error={null} />
    );
    const readsAfterInitialRender = bodyReads;

    rerender(<HTTPResponsePanel response={observed} loading={false} error={null} />);

    expect(readsAfterInitialRender).toBeGreaterThan(0);
    expect(bodyReads).toBe(readsAfterInitialRender);
  });
});

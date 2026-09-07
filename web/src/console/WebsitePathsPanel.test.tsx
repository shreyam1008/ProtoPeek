import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WebsitePathsPanel from './WebsitePathsPanel';
import { fetchWebsitePaths, websitePaths } from './website-paths-api';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
const evidence = {
  origin: 'https://example.com',
  observedAt: '2026-09-06T12:00:00Z',
  partial: true,
  paths: websitePaths.map((path, index) =>
    index === 1
      ? { path, totalMs: 0, error: 'Connection timed out' }
      : { path, statusCode: 200, contentType: 'text/html', totalMs: 42 }
  ),
};

it('runs the fixed plan at the origin and reports partial evidence and fallback ambiguity', async () => {
  const fetchMock = vi.fn(async () => Response.json(evidence));
  vi.stubGlobal('fetch', fetchMock);
  render(<WebsitePathsPanel active />);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Website for path checks' }), {
    target: { value: 'https://example.com/ignored/path' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Check five paths' }));
  expect(await screen.findByText('Connection timed out')).toBeVisible();
  expect(screen.getByText(/missing-path comparison also returned 200/)).toBeVisible();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  const options = (fetchMock.mock.calls as unknown as [unknown, RequestInit][])[0]?.[1];
  expect(JSON.parse(String(options?.body))).toEqual({
    url: 'https://example.com',
    acknowledgePublicRequest: true,
  });
});

it('aborts on leaving the section and ignores a late response', async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn(
    (_url: unknown, _options?: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<WebsitePathsPanel active />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Check five paths' }));
  view.rerender(<WebsitePathsPanel active={false} />);
  expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  finish(Response.json(evidence));
  await waitFor(() => expect(screen.getByText(/cancelled when leaving/)).toBeInTheDocument());
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('rejects credentials before network I/O and inconsistent response origins', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ ...evidence, origin: 'https://unexpected.example' })
  );
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    fetchWebsitePaths('https://user:secret@example.com', new AbortController().signal)
  ).rejects.toThrow('Credentials');
  expect(fetchMock).not.toHaveBeenCalled();
  await expect(
    fetchWebsitePaths('https://example.com', new AbortController().signal)
  ).rejects.toThrow('Inconsistent');
});

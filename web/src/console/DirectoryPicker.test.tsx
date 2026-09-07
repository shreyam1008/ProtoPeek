import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectoryPicker } from './DirectoryPicker';

afterEach(() => vi.unstubAllGlobals());

it('only reads on demand and chooses the displayed directory', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      path: '/downloads',
      parent: '/',
      directories: [{ name: 'Projects', path: '/downloads/Projects' }],
      truncated: false,
    })
  );
  vi.stubGlobal('fetch', fetch);
  const choose = vi.fn();
  render(<DirectoryPicker initialPath="/downloads" onChoose={choose} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
  await screen.findByRole('button', { name: 'Projects' });
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
  expect(choose).toHaveBeenCalledWith('/downloads');
  expect(screen.queryByRole('region', { name: 'Choose download folder' })).not.toBeInTheDocument();
});

it('aborts on close and ignores late folder results', async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    })
  );
  render(<DirectoryPicker initialPath="/downloads" onChoose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close folders' }));
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    finish(Response.json({ path: '/late', parent: '/', directories: [], truncated: false }))
  );
  expect(screen.queryByText('/late')).not.toBeInTheDocument();
});

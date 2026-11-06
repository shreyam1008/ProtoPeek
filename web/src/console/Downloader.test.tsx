import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProtoPeekRouter } from './router';

vi.mock('./FileDownloader', () => ({ default: () => <h1>File transfer queue</h1> }));
vi.mock('./MediaDownloader', () => ({ default: () => <h1>Media download queue</h1> }));

afterEach(() => vi.restoreAllMocks());

describe('Download workspace', () => {
  it('opens files first and loads the selected independent view', async () => {
    render(
      <RouterProvider
        router={createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/downloader'] }))}
      />
    );
    await screen.findByRole('heading', { name: 'File transfer queue' });
    expect(screen.queryByRole('heading', { name: 'Media download queue' })).not.toBeInTheDocument();
    const files = screen.getByRole('button', { name: 'Files', pressed: true });
    fireEvent.click(screen.getByRole('button', { name: 'Media, galleries & webpages' }));
    await screen.findByRole('heading', { name: 'Media download queue' });
    expect(files).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('heading', { name: 'File transfer queue' })).not.toBeInTheDocument();
    fireEvent.click(files);
    await screen.findByRole('heading', { name: 'File transfer queue' });
  });
  it('adapts help to tab changes without changing the route', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/downloader'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'File transfer queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Media, galleries & webpages' }));
    await screen.findByRole('heading', { name: 'Media download queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Open ProtoPeek help' }));
    const help = await screen.findByRole('dialog', { name: 'Help for this tool' });
    expect(within(help).getByRole('heading', { name: 'Media downloader' })).toBeVisible();
    expect(within(help).getByText(/Choose the media type/)).toBeVisible();
    expect(router.state.location.pathname).toBe('/downloader');
    fireEvent.click(within(help).getByRole('button', { name: 'Close help' }));
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    await screen.findByRole('heading', { name: 'File transfer queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Open ProtoPeek help' }));
    const filesHelp = await screen.findByRole('dialog', { name: 'Help for this tool' });
    expect(within(filesHelp).getByText(/Enter a download URL/)).toBeVisible();
    expect(router.state.location.pathname).toBe('/downloader');
  });
});

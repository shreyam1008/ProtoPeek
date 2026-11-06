import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createProtoPeekRouter } from './router';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('guides a gallery handoff through media setup, link, queue and results without installing', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
  const fetch = vi.fn(async () =>
    Response.json({
      directory: 'C:/fixture',
      jobs: [],
      tools: [
        {
          name: 'gallery-dl',
          path: '',
          version: '',
          installBytes: 100,
          canInstall: true,
          help: 'Install when needed.',
        },
      ],
    })
  );
  vi.stubGlobal('fetch', fetch);
  const router = createProtoPeekRouter(
    createMemoryHistory({ initialEntries: ['/downloader?mediaTool=gallery-dl'] })
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole('button', { name: /Install gallery-dl/ });
  const calls = fetch.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Open ProtoPeek help' }));
  const help = await screen.findByRole('dialog', { name: 'Help for this tool' });
  expect(within(help).getByRole('heading', { name: 'Media downloader' })).toBeVisible();
  fireEvent.click(within(help).getByRole('button', { name: 'Start guided steps' }));
  const guide = await screen.findByRole('region', { name: 'Media downloader guided steps' });
  const choice = screen.getByRole('button', { name: /Images & galleries/ });
  await waitFor(() => expect(choice).toHaveClass('pp-tour-target'));
  fireEvent.click(within(guide).getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Engine setup' })).toHaveClass('pp-tour-target')
  );
  fireEvent.click(within(guide).getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByLabelText('Link to save')).toHaveClass('pp-tour-target'));
  fireEvent.click(within(guide).getByRole('button', { name: 'Next' }));
  expect(within(guide).getByText(/Choose and set up an available engine/)).toBeVisible();
  fireEvent.click(within(guide).getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Media queue' })).toHaveClass('pp-tour-target')
  );
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(router.state.location.search).toMatchObject({ mediaTool: 'gallery-dl' });
  fireEvent.keyDown(guide, { key: 'Escape' });
  await waitFor(() => expect(guide).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Start guide for this tool' }));
  expect(
    await screen.findByRole('region', { name: 'Media downloader guided steps' })
  ).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(calls);
});

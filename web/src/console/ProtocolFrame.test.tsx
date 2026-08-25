import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProtoPeekRouter } from './router';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-keyboard-hints');
  document.documentElement.removeAttribute('data-theme');
});

describe('ProtocolFrame', () => {
  it('keeps seven exact primary destinations and Roadmap secondary', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose the API workbench.' });

    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(primary)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim())
    ).toEqual(['Overview', 'APIs', 'Network', 'This PC', 'Downloader', 'Security', 'Settings']);
    expect(within(primary).queryByText('Roadmap')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Roadmap' })).toBeVisible();
  });

  it('traps and restores focus in the mobile drawer, then navigates without a horizontal rail', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose the API workbench.' });

    const menu = screen.getByRole('button', { name: 'Open navigation menu' });
    menu.focus();
    fireEvent.click(menu);
    const drawer = await screen.findByRole('dialog', { name: 'ProtoPeek' });
    const close = within(drawer).getByRole('button', { name: 'Close navigation menu' });
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(within(drawer).getByRole('button', { name: 'Help' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek' })).not.toBeInTheDocument();
    expect(menu).toHaveFocus();

    fireEvent.click(menu);
    const reopened = await screen.findByRole('dialog', { name: 'ProtoPeek' });
    fireEvent.click(within(reopened).getByRole('link', { name: 'Settings' }));
    expect(
      await screen.findByRole('heading', { name: "Shape this browser's console." })
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/settings');
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek' })).not.toBeInTheDocument();
  });
});

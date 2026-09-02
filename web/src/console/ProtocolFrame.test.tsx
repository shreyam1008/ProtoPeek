import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProtoPeekRouter } from './router';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-keyboard-hints');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-mode');
  document.documentElement.removeAttribute('data-palette');
});

describe('ProtocolFrame', () => {
  it('follows system color changes without changing the selected palette or leaking a listener', async () => {
    let matches = false;
    let changeListener: ((event: MediaQueryListEvent) => void) | undefined;
    const media = {
      get matches() {
        return matches;
      },
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        changeListener = listener;
      }),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media)
    );

    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    const view = render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose the API workbench.' });

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement).toHaveAttribute('data-theme-mode', 'system');
    expect(document.documentElement).toHaveAttribute('data-palette', 'graphite');

    matches = true;
    act(() => changeListener?.({ matches: true } as MediaQueryListEvent));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement).toHaveAttribute('data-theme-mode', 'system');
    expect(document.documentElement).toHaveAttribute('data-palette', 'graphite');

    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', changeListener);
  });

  it('keeps eight exact primary destinations and Roadmap secondary', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose the API workbench.' });

    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(primary)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim())
    ).toEqual([
      'Overview',
      'APIs',
      'Network',
      'This PC',
      'Tunnels',
      'Downloader',
      'Security',
      'Settings',
    ]);
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

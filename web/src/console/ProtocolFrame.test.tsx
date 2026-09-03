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
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });

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

  it('renders only the six permanent destinations in product order', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });

    const primary = screen.getByRole('navigation', { name: 'Destinations' });
    const links = within(primary).getAllByRole('link');
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Home',
      'Inspect',
      'Network',
      'Publish',
      'Files',
      'Settings',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/protocols',
      '/network',
      '/tunnels',
      '/downloader',
      '/settings',
    ]);
    expect(within(primary).getAllByRole('link', { current: 'page' })).toEqual([
      within(primary).getByRole('link', { name: 'Open Inspect' }),
    ]);
    expect(screen.queryByRole('link', { name: /Roadmap/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open ProtoPeek help' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open ProtoPeek Home' })).toBeVisible();
  });

  it('marks the owning destination instead of relying on route prefixes', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    const navigation = screen.getByRole('navigation', { name: 'Destinations' });

    for (const [route, label] of [
      ['/security', 'Inspect'],
      ['/this-pc', 'Network'],
      ['/tunnels', 'Publish'],
      ['/downloader', 'Files'],
      ['/roadmap', 'Settings'],
    ] as const) {
      await act(async () => {
        await router.navigate({ to: route });
      });
      await waitFor(() =>
        expect(within(navigation).getAllByRole('link', { current: 'page' })).toEqual([
          within(navigation).getByRole('link', { name: `Open ${label}` }),
        ])
      );
    }
  });

  it('does not claim a destination for an unmatched route', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/networking'] }));
    render(<RouterProvider router={router} />);

    const navigation = await screen.findByRole('navigation', { name: 'Destinations' });
    expect(within(navigation).queryAllByRole('link', { current: 'page' })).toHaveLength(0);
  });

  it('uses registered route labels and keywords in the command menu', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });

    const trigger = screen.getByRole('button', { name: 'Open global command menu' });
    trigger.focus();
    fireEvent.click(trigger);
    const commands = screen.getByRole('dialog', { name: 'ProtoPeek commands' });
    expect(within(commands).getByRole('option', { name: 'Open Downloader' })).toBeVisible();
    expect(
      within(commands).getByRole('option', { name: 'Open Cloudflare tunnel operations' })
    ).toBeVisible();
    expect(within(commands).getByRole('option', { name: 'Open product roadmap' })).toBeVisible();
    expect(within(commands).getByRole('option', { name: 'Open protocol checklist' })).toBeVisible();

    fireEvent.change(within(commands).getByRole('combobox', { name: 'Search commands' }), {
      target: { value: 'trailers' },
    });
    expect(within(commands).getByRole('option', { name: 'Open gRPC workbench' })).toBeVisible();
    expect(within(commands).queryByRole('option', { name: 'Open HTTP workbench' })).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek commands' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(screen.getByRole('combobox', { name: 'Search commands' })).toHaveValue('');
  });

  it('traps and restores focus in the mobile drawer, then navigates without a horizontal rail', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });

    const menu = screen.getByRole('button', { name: 'Open navigation menu' });
    menu.focus();
    fireEvent.click(menu);
    const drawer = await screen.findByRole('dialog', { name: 'ProtoPeek' });
    const close = within(drawer).getByRole('button', { name: 'Close navigation menu' });
    await waitFor(() => expect(close).toHaveFocus());

    const mobileDestinations = within(drawer).getByRole('navigation', {
      name: 'Mobile destinations',
    });
    expect(
      within(mobileDestinations)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim())
    ).toEqual(['Home', 'Inspect', 'Network', 'Publish', 'Files', 'Settings']);
    expect(within(drawer).queryByText('Roadmap')).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Help' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(within(drawer).getByRole('button', { name: 'Inspect target' })).toHaveFocus();
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

  it('tracks bounded route sessions, keeps Home out, and focuses ordinary destination headings', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });

    const sessions = screen.getByRole('tablist', { name: 'Open workbench sessions' });
    expect(within(sessions).getAllByRole('tab')).toHaveLength(1);
    expect(within(sessions).getByRole('tab', { name: 'Inspect' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(sessions).queryByRole('tab', { name: 'Home' })).toBeNull();

    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('link', {
        name: 'Open Settings',
      })
    );
    const settingsHeading = await screen.findByRole('heading', {
      name: "Shape this browser's console.",
    });
    await waitFor(() => expect(settingsHeading).toHaveFocus());
    expect(within(sessions).getAllByRole('tab')).toHaveLength(2);

    fireEvent.click(within(sessions).getByRole('tab', { name: 'Inspect' }));
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    await waitFor(() =>
      expect(within(sessions).getByRole('tab', { name: 'Inspect' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close Inspect session' }));
    expect(
      await screen.findByRole('heading', { name: "Shape this browser's console." })
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/settings');
    expect(within(sessions).queryByRole('tab', { name: 'Inspect' })).toBeNull();
  });

  it('keeps only one global modal focus owner open at a time', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(await screen.findByRole('dialog', { name: 'ProtoPeek' })).toBeVisible();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const palette = await screen.findByRole('dialog', { name: 'ProtoPeek commands' });
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toEqual([palette]);

    fireEvent.click(within(palette).getByRole('option', { name: 'Open protocol checklist' }));
    const help = await screen.findByRole('dialog', {
      name: 'Debug what is actually on the wire.',
    });
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek commands' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toEqual([help]);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'ProtoPeek commands' })).toBeVisible();
    expect(
      screen.queryByRole('dialog', { name: 'Debug what is actually on the wire.' })
    ).toBeNull();
  });
});

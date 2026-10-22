import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearPendingHandoff, storePendingHandoff } from './app/handoff-store';
import { createProtoPeekRouter } from './router';
import { sidebarCollapsedStorageKey } from './shell/navigation-preferences';

afterEach(() => {
  vi.unstubAllGlobals();
  clearPendingHandoff();
  window.sessionStorage.clear();
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
      'Extensions',
      'Files',
      'Settings',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/protocols',
      '/network',
      '/extensions',
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

  it('keeps Network tools present across sibling routes and resumes the last tool', async () => {
    const router = createProtoPeekRouter(
      createMemoryHistory({ initialEntries: ['/network/path'] })
    );
    render(<RouterProvider router={router} />);
    const tools = await screen.findByRole('navigation', { name: 'Network tools' });
    const hrefs = within(tools)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    await act(async () => {
      await router.navigate({ to: '/network/ports' });
    });
    await waitFor(() =>
      expect(within(tools).getByRole('link', { name: 'Port scanner' })).toHaveAttribute(
        'aria-current',
        'page'
      )
    );
    expect(
      within(tools)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
    ).toEqual(hrefs);
    await act(async () => {
      await router.navigate({ to: '/protocols' });
    });
    const resume = screen.getByRole('link', { name: 'Open Network' });
    expect(resume).toHaveAttribute('href', '/network/ports');
    fireEvent.click(resume);
    await waitFor(() => expect(router.state.location.pathname).toBe('/network/ports'));
    expect(await screen.findByRole('navigation', { name: 'Network tools' })).toBeInTheDocument();
  });

  it('marks the owning destination instead of relying on route prefixes', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    const navigation = screen.getByRole('navigation', { name: 'Destinations' });

    for (const [route, label] of [
      ['/security', 'Inspect'],
      ['/this-pc', 'Network'],
      ['/tunnels', 'Extensions'],
      ['/network/tailnet', 'Extensions'],
      ['/network/nmap', 'Extensions'],
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
    const commands = await screen.findByRole('dialog', { name: 'ProtoPeek commands' });
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
    ).toEqual(['Home', 'Inspect', 'Network', 'Extensions', 'Files', 'Settings']);
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
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/settings');
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek' })).not.toBeInTheDocument();
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('button', { name: 'Find commands' }));
    expect(await screen.findByRole('dialog', { name: 'ProtoPeek commands' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek' })).not.toBeInTheDocument();
  });

  it('keeps recent tools as links and removes a reference without leaving its route', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });

    fireEvent.click(screen.getByText('Recent tools', { selector: 'summary' }));
    const recent = screen.getByRole('navigation', { name: 'Recent tools' });
    expect(within(recent).getAllByRole('link')).toHaveLength(1);
    expect(within(recent).getByRole('link', { name: 'Inspect' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(recent).queryByRole('link', { name: 'Home' })).toBeNull();

    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('link', {
        name: 'Open Settings',
      })
    );
    const settingsHeading = await screen.findByRole('heading', {
      name: 'Settings',
    });
    await waitFor(() => expect(settingsHeading).toHaveFocus());
    expect(within(recent).getAllByRole('link')).toHaveLength(2);

    fireEvent.click(within(recent).getByRole('link', { name: 'Inspect' }));
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    await waitFor(() =>
      expect(within(recent).getByRole('link', { name: 'Inspect' })).toHaveAttribute(
        'aria-current',
        'page'
      )
    );
    const remove = screen.getByRole('button', { name: 'Remove Inspect from recent tools' });
    remove.focus();
    fireEvent.click(remove);
    expect(screen.getByRole('heading', { name: 'Choose an inspection workbench.' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/protocols');
    expect(within(recent).queryByRole('link', { name: 'Inspect' })).toBeNull();
    expect(within(recent).getByRole('link', { name: 'Settings' })).toHaveFocus();
    expect(screen.queryByRole('tablist', { name: 'Open workbench sessions' })).toBeNull();
  });

  it('collapses the tool sidebar without losing focus, commands, or inspect controls', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    const command = screen.getByRole('button', { name: 'Open global command menu' });
    command.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Hide tool sidebar' }));

    const toggle = screen.getByRole('button', { name: 'Show tool sidebar' });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('protopeek-tool-sidebar')).toHaveAttribute('hidden');
    expect(localStorage.getItem(sidebarCollapsedStorageKey)).toBe('true');
    expect(
      within(screen.getByRole('navigation', { name: 'Destinations' })).getAllByRole('link')
    ).toHaveLength(6);

    fireEvent.click(screen.getByRole('button', { name: 'Open global command menu' }));
    expect(await screen.findByRole('dialog', { name: 'ProtoPeek commands' })).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Inspect target' }));
    expect(await screen.findByRole('dialog', { name: 'Scan target' })).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'ProtoPeek commands' })).toBeVisible();
  });

  it('restores sidebar collapse after remount while keeping the mobile drawer independent', async () => {
    localStorage.setItem(sidebarCollapsedStorageKey, 'true');
    let router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    const view = render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    expect(screen.getByRole('button', { name: 'Show tool sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const drawer = await screen.findByRole('dialog', { name: 'ProtoPeek' });
    expect(within(drawer).getByRole('navigation', { name: 'Inspect tools' })).toBeVisible();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close navigation menu' }));
    expect(screen.getByRole('button', { name: 'Show tool sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show tool sidebar' }));
    expect(localStorage.getItem(sidebarCollapsedStorageKey)).toBe('false');
    view.unmount();
    router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    expect(screen.getByRole('button', { name: 'Hide tool sidebar' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek' })).toBeNull();
  });

  it('preserves focus placed by a destination while applying a route draft', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('fetch', vi.fn());
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    expect(
      storePendingHandoff({
        provenance: {
          source: 'this-device',
          quality: 'inferred',
          observedAt: new Date().toISOString(),
          path: '/this-pc',
        },
        draft: {
          kind: 'http-url-draft',
          target: { kind: 'http-url', url: 'http://127.0.0.1:8080/' },
        },
      }).ok
    ).toBe(true);

    await act(async () => {
      await router.navigate({ to: '/protocols/http' });
    });

    const url = await screen.findByRole('textbox', { name: 'Request URL' });
    await waitFor(() => expect(url).toHaveFocus());
    expect(url).toHaveValue('http://127.0.0.1:8080/');
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

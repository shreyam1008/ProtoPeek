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
  it('opens the current guide in one action and restores focus without executing a tool', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    const trigger = screen.getByRole('button', { name: 'Start guide for this tool' });
    trigger.focus();
    fireEvent.click(trigger);
    const guide = await screen.findByRole('region', { name: 'Inspect guided steps' });
    expect(screen.queryByRole('dialog', { name: 'Help for this tool' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.keyDown(guide, { key: 'Escape' });
    await waitFor(() => expect(guide).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('replaces a current tour with command search using the keyboard shortcut', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    fireEvent.click(screen.getByRole('button', { name: 'Start guide for this tool' }));
    await screen.findByRole('region', { name: 'Inspect guided steps' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'ProtoPeek commands' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /guided steps/i })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Search commands' })).toHaveFocus()
    );
  });
  it('anchors disconnected gRPC guidance to the address and schema controls', async () => {
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue({ length: 1 } as DOMRectList);
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(
        pathname.endsWith('/api/bootstrap')
          ? {
              appName: 'ProtoPeek',
              version: 'test',
              target: 'Choose a gRPC target',
              launcherMode: true,
              services: [],
              targetDefaults: {},
            }
          : []
      );
    });
    vi.stubGlobal('fetch', fetch);
    const router = createProtoPeekRouter(
      createMemoryHistory({ initialEntries: ['/protocols/grpc'] })
    );
    render(<RouterProvider router={router} />);
    const form = await screen.findByRole('form', { name: 'gRPC target connection' });
    const address = within(form).getByRole('textbox', { name: 'Address' });
    const before = fetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Open ProtoPeek help' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start guided steps' }));
    const guide = await screen.findByRole('region', { name: 'gRPC guided steps' });
    await waitFor(() => expect(address).toHaveClass('pp-tour-target'));
    address.setAttribute('disabled', '');
    await within(guide).findByRole('button', { name: 'Find this step' });
    expect(address).not.toHaveClass('pp-tour-target');
    address.removeAttribute('disabled');
    await waitFor(() => expect(address).toHaveClass('pp-tour-target'));
    fireEvent.click(within(guide).getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(within(form).getByRole('combobox', { name: 'Schema source' })).toHaveClass(
        'pp-tour-target'
      )
    );
    expect(fetch).toHaveBeenCalledTimes(before);
    rects.mockRestore();
  });
  it('opens a selected help topic directly into its guide without taking a tool action', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    fireEvent.click(screen.getByRole('button', { name: 'Open ProtoPeek help' }));
    const help = await screen.findByRole('dialog', { name: 'Help for this tool' });
    fireEvent.change(within(help).getByRole('combobox', { name: 'Help topic' }), {
      target: { value: 'roadmap' },
    });
    fireEvent.click(
      within(help).getByRole('button', { name: 'Open Roadmap and start guided steps' })
    );
    expect(await screen.findByRole('region', { name: 'Roadmap guided steps' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Help for this tool' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('opens guided steps without taking a tool action and closes them on navigation', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue({ length: 1 } as DOMRectList);
    const scroll = vi.fn();
    const priorScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    fireEvent.click(screen.getByRole('button', { name: 'Open ProtoPeek help' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start guided steps' }));
    const guide = await screen.findByRole('region', { name: /guided steps/i });
    const startingControl = screen.getByRole('link', { name: /^gRPC Reflection/ });
    await waitFor(() => expect(startingControl).toHaveClass('pp-tour-target'));
    fireEvent.click(within(guide).getByRole('button', { name: 'Go to highlighted area' }));
    expect(startingControl).toHaveFocus();
    expect(scroll).toHaveBeenCalled();
    expect(within(guide).getByText(/guide never runs a tool/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    await act(() => router.navigate({ to: '/extensions' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /guided steps/i })).not.toBeInTheDocument()
    );
    rects.mockRestore();
    HTMLElement.prototype.scrollIntoView = priorScroll;
  });

  it('moves the HTTP guide between real controls and closes from the focused target', async () => {
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue({ length: 1 } as DOMRectList);
    const priorScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const router = createProtoPeekRouter(
      createMemoryHistory({ initialEntries: ['/protocols/http'] })
    );
    render(<RouterProvider router={router} />);
    const url = await screen.findByRole('textbox', { name: 'Request URL' });
    const help = screen.getByRole('button', { name: 'Open ProtoPeek help' });
    help.focus();
    fireEvent.click(help);
    fireEvent.click(await screen.findByRole('button', { name: 'Start guided steps' }));
    const guide = await screen.findByRole('region', { name: /guided steps/i });
    await waitFor(() => expect(url).toHaveClass('pp-tour-target'));
    fireEvent.click(within(guide).getByRole('button', { name: 'Next' }));
    const send = screen.getByRole('button', { name: /^Send/ });
    await waitFor(() => expect(send).toHaveClass('pp-tour-target'));
    expect(url).not.toHaveClass('pp-tour-target');
    fireEvent.click(within(guide).getByRole('button', { name: 'Go to highlighted area' }));
    expect(send).toHaveFocus();
    fireEvent.keyDown(send, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /guided steps/i })).not.toBeInTheDocument()
    );
    expect(send).not.toHaveClass('pp-tour-target');
    expect(help).toHaveFocus();
    rects.mockRestore();
    HTMLElement.prototype.scrollIntoView = priorScroll;
  });

  it('highlights the initial Cloudflare host inspection without starting it', async () => {
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue({ length: 1 } as DOMRectList);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/tunnels'] }));
    render(<RouterProvider router={router} />);
    const inspect = await screen.findByRole('button', { name: 'Inspect this host' });
    fireEvent.click(screen.getByRole('button', { name: 'Open ProtoPeek help' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start guided steps' }));
    await waitFor(() => expect(inspect).toHaveClass('pp-tour-target'));
    expect(fetch).not.toHaveBeenCalled();
    rects.mockRestore();
  });
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
    expect(screen.getByRole('button', { name: 'Open ProtoPeek help' })).toBeVisible();
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

    const trigger = screen.getByRole('button', { name: /^Find anything/ });
    trigger.focus();
    fireEvent.click(trigger);
    const commands = await screen.findByRole('dialog', { name: 'ProtoPeek commands' });
    expect(within(commands).getByRole('option', { name: 'Open Downloader' })).toBeVisible();
    expect(
      within(commands).getByRole('option', { name: 'Open Cloudflare tunnel operations' })
    ).toBeVisible();
    expect(within(commands).getByRole('option', { name: 'Open product roadmap' })).toBeVisible();
    expect(within(commands).getByRole('option', { name: 'Open tool help' })).toBeVisible();

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
      Array.from(mobileDestinations.querySelectorAll('.pp-mobile-destination-row > a')).map(
        (link) => link.textContent?.trim()
      )
    ).toEqual(['Home', 'Inspect', 'Network', 'Extensions', 'Files', 'Settings']);
    fireEvent.click(within(drawer).getByRole('button', { name: 'Browse Network tools' }));
    expect(within(drawer).getByRole('link', { name: 'Port scanner' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/protocols');
    expect(within(drawer).queryByText('Roadmap')).not.toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Help' })).toBeVisible();

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
    const command = screen.getByRole('button', { name: /^Find anything/ });
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

    fireEvent.click(screen.getByRole('button', { name: 'Search tools' }));
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
    expect(screen.getByRole('button', { name: 'Open ProtoPeek help' })).toBeVisible();

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

  it('opens contextual guidance without starting a check and restores focus', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'Choose an inspection workbench.' });
    const trigger = screen.getByRole('button', { name: 'Open ProtoPeek help' });
    trigger.focus();
    fireEvent.click(trigger);
    const help = await screen.findByRole('dialog', { name: 'Help for this tool' });
    const topic = within(help).getByRole('combobox', { name: 'Help topic' });
    expect(topic).toHaveValue('protocols');
    fireEvent.change(topic, { target: { value: 'network-nmap' } });
    expect(
      within(help).getByText(/scanner runs the separately installed Nmap only on request/)
    ).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Help for this tool' })).toBeNull()
    );
    expect(trigger).toHaveFocus();
    await act(async () => {
      await router.navigate({ to: '/roadmap' });
    });
    await screen.findByRole('heading', { name: 'Product roadmap' });
    fireEvent.click(trigger);
    const nextHelp = await screen.findByRole('dialog', { name: 'Help for this tool' });
    expect(within(nextHelp).getByRole('combobox', { name: 'Help topic' })).toHaveValue('roadmap');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens help from mobile navigation without keeping two dialogs open', async () => {
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
    const navigation = await screen.findByRole('dialog', { name: 'ProtoPeek' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Help' }));
    const help = await screen.findByRole('dialog', { name: 'Help for this tool' });
    expect(screen.getAllByRole('dialog')).toEqual([help]);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Help for this tool' })).toBeNull()
    );
    expect(menu).toHaveFocus();
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

    fireEvent.click(within(palette).getByRole('option', { name: 'Open tool help' }));
    const help = await screen.findByRole('dialog', {
      name: 'Help for this tool',
    });
    expect(screen.queryByRole('dialog', { name: 'ProtoPeek commands' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toEqual([help]);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'ProtoPeek commands' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Help for this tool' })).toBeNull();
  });
});

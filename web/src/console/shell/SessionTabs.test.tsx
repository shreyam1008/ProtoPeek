import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SessionTabs } from './SessionTabs';
import type { SessionReference } from './shell-state';

const references: readonly SessionReference[] = [
  {
    id: 'inspect:/protocols/grpc',
    destination: 'inspect',
    route: '/protocols/grpc',
    label: 'gRPC',
    lastFocused: 1,
    dirty: false,
    running: false,
  },
  {
    id: 'inspect:/protocols/http',
    destination: 'inspect',
    route: '/protocols/http',
    label: 'HTTP',
    lastFocused: 2,
    dirty: false,
    running: false,
  },
  {
    id: 'network:/network/path',
    destination: 'network',
    route: '/network/path',
    label: 'Path',
    lastFocused: 3,
    dirty: false,
    running: false,
  },
];

async function renderTabs({
  sessions = references,
  activeId = references[1].id,
}: {
  sessions?: readonly SessionReference[];
  activeId?: string | null;
} = {}) {
  const onActivate = vi.fn();
  const onRemove = vi.fn();
  const root = createRootRoute({
    component: () => (
      <SessionTabs
        references={sessions}
        activeId={activeId}
        onActivate={onActivate}
        onRemove={onRemove}
      />
    ),
  });
  const routeTree = root.addChildren(
    ['/', ...references.map((reference) => reference.route)].map((path) =>
      createRoute({ getParentRoute: () => root, path, component: () => null })
    )
  );
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [references.find((reference) => reference.id === activeId)?.route ?? '/'],
    }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('navigation', { name: 'Recent tools' });
  return { onActivate, onRemove, router };
}

describe('recent tools', () => {
  it('offers real links and arrow, Home, and End focus convenience without navigating', async () => {
    const { onActivate } = await renderTabs();
    const grpc = screen.getByRole('link', { name: 'gRPC' });
    const http = screen.getByRole('link', { name: 'HTTP' });
    const path = screen.getByRole('link', { name: 'Path' });

    expect(http).toHaveAttribute('aria-current', 'page');
    expect(http).toHaveAttribute('href', '/protocols/http');
    http.focus();

    expect(screen.queryByRole('tablist')).toBeNull();
    fireEvent.keyDown(http, { key: 'ArrowDown' });
    expect(path).toHaveFocus();
    fireEvent.keyDown(path, { key: 'ArrowUp' });
    expect(http).toHaveFocus();

    fireEvent.keyDown(http, { key: 'ArrowRight' });
    expect(path).toHaveFocus();
    expect(http).toHaveAttribute('aria-current', 'page');

    fireEvent.keyDown(path, { key: 'ArrowRight' });
    expect(grpc).toHaveFocus();

    fireEvent.keyDown(grpc, { key: 'End' });
    expect(path).toHaveFocus();

    fireEvent.keyDown(path, { key: 'Home' });
    expect(grpc).toHaveFocus();

    fireEvent.keyDown(grpc, { key: 'ArrowLeft' });
    expect(path).toHaveFocus();
    fireEvent.keyDown(path, { key: 'ArrowUp', altKey: true });
    expect(path).toHaveFocus();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('activates only the clicked route reference', async () => {
    const { onActivate, onRemove } = await renderTabs();

    fireEvent.click(screen.getByRole('link', { name: 'gRPC' }));

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith(references[0]);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('keeps every recent link keyboard-reachable when Home has no current tool', async () => {
    await renderTabs({ activeId: null });
    const links = screen.getAllByRole('link');

    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.tabIndex).toBe(0);
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it('removes route references without implying a running or unsaved workspace', async () => {
    const sessions = [
      { ...references[0], dirty: true },
      { ...references[1], running: true },
      references[2],
    ] satisfies readonly SessionReference[];
    const { onRemove } = await renderTabs({ sessions, activeId: sessions[2].id });

    expect(screen.queryByText('Unsaved')).toBeNull();
    expect(screen.queryByText('Running')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove gRPC from recent tools' }));
    expect(onRemove).toHaveBeenCalledWith(sessions[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove HTTP from recent tools' }));
    expect(onRemove).toHaveBeenCalledWith(sessions[1]);
  });
});

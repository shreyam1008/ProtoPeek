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

function renderTabs({
  sessions = references,
  activeId = references[1].id,
}: {
  sessions?: readonly SessionReference[];
  activeId?: string | null;
} = {}) {
  const onActivate = vi.fn();
  const onClose = vi.fn();
  render(
    <SessionTabs
      references={sessions}
      activeId={activeId}
      onActivate={onActivate}
      onClose={onClose}
    />
  );
  return { onActivate, onClose };
}

describe('SessionTabs', () => {
  it('moves focus with arrows, Home, and End without activating a route', () => {
    const { onActivate } = renderTabs();
    const grpc = screen.getByRole('tab', { name: 'gRPC' });
    const http = screen.getByRole('tab', { name: 'HTTP' });
    const path = screen.getByRole('tab', { name: 'Path' });

    expect(http).toHaveAttribute('aria-selected', 'true');
    expect(http).toHaveAttribute('tabindex', '0');
    http.focus();

    fireEvent.keyDown(http, { key: 'ArrowRight' });
    expect(path).toHaveFocus();
    expect(http).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(path, { key: 'ArrowRight' });
    expect(grpc).toHaveFocus();

    fireEvent.keyDown(grpc, { key: 'End' });
    expect(path).toHaveFocus();

    fireEvent.keyDown(path, { key: 'Home' });
    expect(grpc).toHaveFocus();

    fireEvent.keyDown(grpc, { key: 'ArrowLeft' });
    expect(path).toHaveFocus();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('activates only the clicked route reference', () => {
    const { onActivate, onClose } = renderTabs();

    fireEvent.click(screen.getByRole('tab', { name: 'gRPC' }));

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith(references[0]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the first tab keyboard-reachable when Home has no active session', () => {
    renderTabs({ activeId: null });
    const tabs = screen.getAllByRole('tab');

    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(tabs[2]).toHaveAttribute('tabindex', '-1');
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-selected', 'false');
  });

  it('offers close only for safe references and reports guarded state', () => {
    const sessions = [
      { ...references[0], dirty: true },
      { ...references[1], running: true },
      references[2],
    ] satisfies readonly SessionReference[];
    const { onClose } = renderTabs({ sessions, activeId: sessions[2].id });

    expect(screen.getByText('Unsaved')).toBeVisible();
    expect(screen.getByText('Running')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Close gRPC session' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close HTTP session' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close Path session' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(sessions[2]);
  });
});

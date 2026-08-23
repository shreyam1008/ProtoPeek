import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { interfacePreferencesStorageKey } from './interface-preferences';
import { createProtoPeekRouter } from './router';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-keyboard-hints');
  document.documentElement.removeAttribute('data-theme');
});

describe('Settings', () => {
  it('persists browser-local appearance and presentation choices', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/settings'] }));
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { name: "Shape this browser's console." })
    ).toBeVisible();
    expect(screen.getByText('Browser-local')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /^Dark/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Compact/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Show keyboard shortcut hints/i }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
      expect(document.documentElement).toHaveAttribute('data-density', 'compact');
      expect(document.documentElement).toHaveAttribute('data-keyboard-hints', 'hidden');
    });
    expect(JSON.parse(window.localStorage.getItem(interfacePreferencesStorageKey) ?? '{}')).toEqual(
      {
        version: 1,
        density: 'compact',
        showKeyboardHints: false,
      }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Restore interface defaults' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Interface defaults restored.');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement).toHaveAttribute('data-density', 'comfortable');
    expect(document.documentElement).toHaveAttribute('data-keyboard-hints', 'shown');
    expect(screen.getByText(/CPU, memory, scan authorization, TLS verification/i)).toBeVisible();
  });
});

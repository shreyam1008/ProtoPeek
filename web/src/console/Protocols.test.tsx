import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createProtoPeekRouter } from './router';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-keyboard-hints');
  document.documentElement.removeAttribute('data-theme');
});

describe('Protocols chooser', () => {
  it('opens shipped API-native workbenches and truthfully gates future research', async () => {
    const router = createProtoPeekRouter(createMemoryHistory({ initialEntries: ['/protocols'] }));
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Choose the API workbench.' })).toBeVisible();
    const available = screen.getByRole('region', { name: 'API-native consoles' });
    expect(within(available).getByRole('link', { name: /gRPC/i })).toHaveAttribute(
      'href',
      '/protocols/grpc'
    );
    expect(within(available).getByRole('link', { name: /HTTP/i })).toHaveAttribute(
      'href',
      '/protocols/http'
    );

    const future = screen.getByRole('region', { name: 'Future protocol research' });
    expect(within(future).getByText("Cap'n Proto")).toBeVisible();
    expect(within(future).getByText('Exploring')).toBeVisible();
    expect(within(future).getByText('WebSocket + SSE')).toBeVisible();
    expect(within(future).getByText('Research')).toBeVisible();
    expect(within(future).queryByRole('link')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Inspect a target/i })).toBeEnabled();
  });
});

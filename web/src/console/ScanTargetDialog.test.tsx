import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScanTargetDialog } from './ScanTargetDialog';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ScanTargetDialog', () => {
  it('moves focus inside, traps keyboard focus, closes on Escape, and restores focus', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Open scan';
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(
      <ScanTargetDialog
        open
        onClose={onClose}
        onResults={vi.fn()}
        onOpenGRPC={vi.fn()}
        onOpenHTTP={vi.fn()}
      />
    );

    const input = screen.getByRole('textbox', { name: 'Scan target' });
    await waitFor(() => expect(input).toHaveFocus());

    const closeButton = screen.getAllByRole('button', { name: 'Close scan target dialog' })[1];
    const privateToggle = screen.getByRole('checkbox', { name: 'Allow this explicit private IP' });
    closeButton.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(privateToggle).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(
      <ScanTargetDialog
        open={false}
        onClose={onClose}
        onResults={vi.fn()}
        onOpenGRPC={vi.fn()}
        onOpenHTTP={vi.fn()}
      />
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('cancels the active scan request from the dialog', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: jsdom does not implement the Cookie Store API
    document.cookie = '_protopeek_csrf_token=test-token; path=/';
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ScanTargetDialog
        open
        onClose={vi.fn()}
        onResults={vi.fn()}
        onOpenGRPC={vi.fn()}
        onOpenHTTP={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Scan target' }), {
      target: { value: 'localhost:50051' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Scan target' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel scan' });
    fireEvent.click(cancel);

    expect(await screen.findByText('Scan cancelled.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

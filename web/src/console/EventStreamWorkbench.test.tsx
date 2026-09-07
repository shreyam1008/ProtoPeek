import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventStreamWorkbench } from './EventStreamWorkbench';
import { connectEventStream, sendStreamMessage } from './event-stream-api';

vi.mock('./event-stream-api', async (original) => ({
  ...(await original<typeof import('./event-stream-api')>()),
  connectEventStream: vi.fn(),
  sendStreamMessage: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function liveConnection() {
  vi.mocked(connectEventStream).mockImplementation(async (_request, signal, emit) => {
    emit({ kind: 'open', sessionId: 'test-session', elapsedMs: 0, status: 101 });
    emit({ kind: 'message', data: 'hello', elapsedMs: 2, encoding: 'text' });
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true })
    );
  });
}

describe('event stream workbench', () => {
  it('does no traffic on mount, sends only on request, and disconnects cleanly', async () => {
    liveConnection();
    render(<EventStreamWorkbench />);
    expect(connectEventStream).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('hello')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Message', { exact: true }), {
      target: { value: '{"ping":true}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() =>
      expect(sendStreamMessage).toHaveBeenCalledWith(
        'test-session',
        '{"ping":true}',
        'text',
        expect.any(AbortSignal)
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected by you');
    expect(connectEventStream).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('closes upstream when unmounted and allows inspecting and clearing received events', async () => {
    liveConnection();
    const view = render(<EventStreamWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect event 2' }));
    expect(
      within(screen.getByRole('complementary', { name: 'Selected event' })).getByText('hello')
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear events' }));
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
    const signal = vi.mocked(connectEventStream).mock.calls[0][1];
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
  it('shows failures, supports retry, and hides sends for SSE', async () => {
    vi.mocked(connectEventStream).mockRejectedValueOnce(new Error('Connection refused'));
    render(<EventStreamWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection refused');
    fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'sse' } });
    expect(screen.getByLabelText('Endpoint URL')).toHaveValue('http://localhost:8080/');
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    vi.mocked(connectEventStream).mockResolvedValueOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(connectEventStream).toHaveBeenCalledTimes(2));
  });
});

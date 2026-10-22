import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  BootstrapMethod,
  InvokeResponse,
  MetadataEntry,
  SchemaResponse,
} from '@/shared/types';

import { CallWorkspace } from './CallWorkspace';

const method: BootstrapMethod = {
  name: 'Watch',
  fullName: 'grpc.health.v1.Health/Watch',
  description: '',
  clientStreaming: false,
  serverStreaming: true,
  requestType: 'grpc.health.v1.HealthCheckRequest',
  responseType: 'grpc.health.v1.HealthCheckResponse',
};

const schema: SchemaResponse = {
  requestType: method.requestType,
  requestStream: false,
  messageTypes: {},
  enumTypes: {},
};

const response: InvokeResponse = {
  headers: [{ name: 'content-type', value: 'application/grpc' }],
  responses: [
    { isError: false, sequence: 1, elapsedMs: 18, message: { status: 'SERVING' } },
    { isError: false, sequence: 2, elapsedMs: 42, message: { status: 'NOT_SERVING' } },
  ],
  trailers: [{ name: 'grpc-status', value: '0' }],
  error: null,
  requests: { total: 1, sent: 1 },
  timings: { headersMs: 7, firstMessageMs: 18, trailersMs: 47, totalMs: 49 },
  localLimit: null,
};

function props(overrides: Partial<Parameters<typeof CallWorkspace>[0]> = {}) {
  return {
    method,
    schema,
    requestText: '{\n  "service": ""\n}',
    onRequestChange: vi.fn(),
    metadata: [] as MetadataEntry[],
    onMetadataChange: vi.fn(),
    onAddMetadata: vi.fn(),
    onRemoveMetadata: vi.fn(),
    timeoutSeconds: 15,
    onTimeoutChange: vi.fn(),
    onInvoke: vi.fn(),
    onCancel: vi.fn(),
    onSaveRequest: vi.fn(),
    onResetRequest: vi.fn(),
    invokeState: { loading: false, error: null, result: response, latencyMs: 51 },
    ...overrides,
  };
}

describe('CallWorkspace', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.unstubAllGlobals();
  });

  it('shows conversion relay errors with retained evidence and an unobserved final status', async () => {
    const relayError = 'Request message 1 could not be converted to protobuf: expected an integer.';
    render(
      <CallWorkspace
        {...props({
          invokeState: {
            loading: false,
            error: relayError,
            latencyMs: 2,
            result: {
              ...response,
              finalStatusObserved: false,
              responses: [],
              headers: [],
              trailers: [],
              requests: { total: 1, sent: 0 },
              timings: { headersMs: null, firstMessageMs: null, trailersMs: null, totalMs: 1 },
              relayError,
            },
          },
        })}
      />
    );
    expect(screen.getByRole('status', { name: 'RPC status ERROR' })).toBeVisible();
    expect(screen.getByText(relayError)).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Status' }));
    expect(await screen.findByText('Not observed')).toBeVisible();
    expect(screen.getAllByText(relayError).some((element) => element.tagName === 'STRONG')).toBe(
      true
    );
    expect(screen.getByText('0/1 sent')).toBeVisible();
    expect(screen.queryByText('OK (0)')).not.toBeInTheDocument();
  });

  it('shows live partial messages and keeps selection and evidence after local cancellation', async () => {
    const timings = response.timings;
    const secondMessage = response.responses[1];
    if (!timings || !secondMessage) throw new Error('Response fixture missing');
    const partial = {
      ...response,
      finalStatusObserved: false,
      trailers: [],
      error: null,
      timings: { ...timings, trailersMs: null },
    };
    const { rerender } = render(
      <CallWorkspace
        {...props({ invokeState: { loading: true, result: partial, error: null, latencyMs: 40 } })}
      />
    );
    const second = await screen.findByRole('button', { name: /2.*Message 2/ });
    expect(screen.getByRole('status', { name: 'RPC status STREAMING' })).toBeInTheDocument();
    fireEvent.click(second);
    const appended = {
      ...partial,
      responses: [...partial.responses, { ...secondMessage, sequence: 3, elapsedMs: 50 }],
    };
    rerender(
      <CallWorkspace
        {...props({ invokeState: { loading: true, result: appended, error: null, latencyMs: 50 } })}
      />
    );
    expect(screen.getByRole('button', { name: /2.*Message 2/ })).toHaveClass('is-active');
    rerender(
      <CallWorkspace
        {...props({
          invokeState: {
            loading: false,
            cancelled: true,
            result: appended,
            error: 'Invocation cancelled.',
            latencyMs: 55,
          },
        })}
      />
    );
    expect(screen.getByRole('status', { name: 'RPC status CANCELLED' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2.*Message 2/ })).toHaveClass('is-active');
    expect(screen.getByText(/Retained messages remain available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Status' }));
    expect(await screen.findByText('Not observed')).toBeInTheDocument();
    expect(screen.queryByText('OK (0)')).toBeNull();
    expect(screen.queryByText('RPC completed successfully.')).toBeNull();
  });

  it('runs shortcuts only inside request controls and ignores repeats, composition, and modal ownership', () => {
    const onInvoke = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<CallWorkspace {...props({ onInvoke, onCancel })} />);
    const editor = screen.getByLabelText('Request JSON');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(onInvoke).toHaveBeenCalledOnce();
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, repeat: true });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, altKey: true });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, metaKey: true });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(screen.getByLabelText('Filter responses'), { key: 'Enter', ctrlKey: true });
    expect(onInvoke).toHaveBeenCalledOnce();
    const modal = document.createElement('section');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    document.body.appendChild(modal);
    try {
      fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
      expect(onInvoke).toHaveBeenCalledOnce();
    } finally {
      modal.remove();
    }
    rerender(
      <CallWorkspace
        {...props({
          onInvoke,
          onCancel,
          invokeState: { loading: true, error: null, result: null, latencyMs: 0 },
        })}
      />
    );
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, repeat: true });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('reveals and focuses mobile Response only at invocation start and exposes cancellation there', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }))
    );
    const onCancel = vi.fn();
    const { rerender } = render(
      <CallWorkspace
        {...props({
          onCancel,
          invokeState: { loading: false, error: null, result: null, latencyMs: 0 },
        })}
      />
    );
    const responseTab = document.getElementById('grpc-mobile-pane-tab-response');
    const requestTab = document.getElementById('grpc-mobile-pane-tab-request');
    expect(requestTab).toHaveAttribute('aria-selected', 'true');
    rerender(
      <CallWorkspace
        {...props({
          onCancel,
          invokeState: { loading: true, error: null, result: null, latencyMs: 0 },
        })}
      />
    );
    await waitFor(() => expect(responseTab).toHaveFocus());
    expect(responseTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel RPC' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByText('Leaving this tool cancels the call.')).toBeInTheDocument();
    if (!requestTab) throw new Error('Request tab missing');
    fireEvent.click(requestTab);
    const editor = screen.getByLabelText('Request JSON');
    editor.focus();
    rerender(<CallWorkspace {...props({ onCancel })} />);
    expect(requestTab).toHaveAttribute('aria-selected', 'true');
    expect(editor).toHaveFocus();
  });

  it('validates invalid JSON on the shortcut and shows the error in the request pane', () => {
    const onInvoke = vi.fn();
    const { rerender } = render(
      <CallWorkspace {...props({ onInvoke, requestText: '{ broken' })} />
    );
    fireEvent.keyDown(screen.getByLabelText('Request JSON'), { key: 'Enter', ctrlKey: true });
    expect(onInvoke).toHaveBeenCalledOnce();
    rerender(
      <CallWorkspace
        {...props({
          onInvoke,
          requestText: '{ broken',
          invokeState: {
            loading: false,
            error: null,
            validationError: 'Invalid request JSON.',
            result: null,
            latencyMs: 0,
          },
        })}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid request JSON.');
    expect(document.getElementById('grpc-mobile-pane-panel-request')).toContainElement(
      screen.getByRole('alert')
    );
    expect(document.getElementById('grpc-mobile-pane-tab-request')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('status', { name: 'RPC status READY' })).toBeInTheDocument();
    expect(screen.queryByText('Invocation failed')).toBeNull();
  });

  it('keeps local shape feedback visible while editing request metadata', () => {
    render(
      <CallWorkspace
        {...props({
          requestText: '[]',
          invokeState: {
            loading: false,
            error: null,
            validationError: 'Unary RPCs need a single object.',
            result: null,
            latencyMs: 0,
          },
        })}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /^Metadata/ }));
    const alert = screen.getByRole('alert');
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent('Unary RPCs need a single object.');
    expect(document.getElementById('grpc-mobile-pane-panel-request')).toContainElement(alert);
    expect(screen.getByRole('status', { name: 'RPC status READY' })).toBeInTheDocument();
  });

  it('reveals mobile Request for a new validation error without trapping later tab navigation', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }))
    );
    const { rerender } = render(<CallWorkspace {...props()} />);
    const responseTab = document.getElementById('grpc-mobile-pane-tab-response');
    const requestTab = document.getElementById('grpc-mobile-pane-tab-request');
    if (!responseTab || !requestTab) throw new Error('Mobile tabs missing');
    fireEvent.click(responseTab);
    responseTab.focus();
    expect(responseTab).toHaveAttribute('aria-selected', 'true');
    const rejected = props({
      requestText: '[]',
      invokeState: {
        loading: false,
        error: null,
        validationError: 'Unary RPCs need a single object.',
        result: null,
        latencyMs: 0,
      },
    });
    rerender(<CallWorkspace {...rejected} />);
    await waitFor(() => expect(requestTab).toHaveAttribute('aria-selected', 'true'));
    expect(requestTab).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Unary RPCs need a single object.');
    expect(document.getElementById('grpc-mobile-pane-panel-request')).not.toHaveClass(
      'pp-mobile-pane-hidden'
    );
    fireEvent.click(responseTab);
    responseTab.focus();
    rerender(<CallWorkspace {...rejected} />);
    expect(responseTab).toHaveAttribute('aria-selected', 'true');
    expect(responseTab).toHaveFocus();
  });

  it('preserves editor focus when a new mobile validation error is already in Request', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }))
    );
    const { rerender } = render(<CallWorkspace {...props()} />);
    const editor = screen.getByLabelText('Request JSON');
    editor.focus();
    rerender(
      <CallWorkspace
        {...props({
          requestText: '[]',
          invokeState: {
            loading: false,
            error: null,
            validationError: 'Unary RPCs need a single object.',
            result: null,
            latencyMs: 0,
          },
        })}
      />
    );
    expect(editor).toHaveFocus();
    expect(document.getElementById('grpc-mobile-pane-tab-request')).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it.each([
    'Copy response JSON',
    'Copy JSON',
  ])('reports %s failure and allows a successful retry', async (button) => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('Denied'))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CallWorkspace {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy response');
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(await screen.findByText('Response JSON copied.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores an old clipboard completion after the response changes', async () => {
    let complete: () => void = () => {};
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { rerender } = render(<CallWorkspace {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy response JSON' }));
    rerender(
      <CallWorkspace
        {...props({ invokeState: { loading: true, error: null, result: null, latencyMs: 0 } })}
      />
    );
    complete();
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Response JSON copied.')).not.toBeInTheDocument();
  });

  it('shows the final gRPC error code while retaining preceding stream messages', () => {
    render(
      <CallWorkspace
        {...props({
          invokeState: {
            loading: false,
            error: null,
            latencyMs: 51,
            result: {
              ...response,
              error: { name: 'InvalidArgument', code: 3, message: 'Bad input', details: [] },
            },
          },
        })}
      />
    );
    expect(screen.getByRole('status', { name: 'RPC status INVALID_ARGUMENT' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Messages 2' })).toBeVisible();
  });
  it('advertises the ordinary invoke wall at the deadline control', () => {
    render(<CallWorkspace {...props()} />);

    expect(screen.getByLabelText('Deadline in seconds')).toHaveAttribute('max', '60');
    expect(screen.getByLabelText('Deadline in seconds')).toHaveAttribute(
      'title',
      expect.stringMatching(/local default and maximum: 60 seconds/i)
    );
  });

  it('keeps request work and timed streaming evidence in one view', () => {
    const onInvoke = vi.fn();
    render(<CallWorkspace {...props({ onInvoke })} />);

    expect(screen.getByRole('textbox', { name: 'Request JSON' })).toHaveValue(
      '{\n  "service": ""\n}'
    );
    expect(screen.getByText('Server stream')).toBeInTheDocument();
    expect(screen.getByText('2 messages')).toBeInTheDocument();
    expect(screen.getByText('Observed / +gap')).toHaveAttribute(
      'title',
      expect.stringMatching(/callback-observed.*not packet arrival or TTFB/i)
    );
    expect(screen.getAllByText('Message 1')).toHaveLength(2);
    expect(screen.getAllByText('18 ms')).toHaveLength(1);

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter responses' }), {
      target: { value: 'not_serving' },
    });
    expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
    expect(screen.getAllByText('Message 2')).toHaveLength(2);
    const secondMessage = screen.getByRole('button', { name: /Message 2/ });
    expect(within(secondMessage).getByText('42 ms')).toBeVisible();
    expect(within(secondMessage).getByText('+24 ms')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /^Invoke/ }));
    expect(onInvoke).toHaveBeenCalledOnce();
  });

  it('adds a prepared authorization field and exposes active cancellation', () => {
    const onAddMetadata = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<CallWorkspace {...props({ onAddMetadata, onCancel })} />);

    fireEvent.click(screen.getByRole('tab', { name: /Metadata/ }));
    fireEvent.click(screen.getByRole('button', { name: /Bearer auth/ }));
    expect(onAddMetadata).toHaveBeenCalledWith({ name: 'authorization', value: 'Bearer ' });

    rerender(
      <CallWorkspace
        {...props({
          onAddMetadata,
          onCancel,
          invokeState: { loading: true, error: null, result: null, latencyMs: 0 },
        })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel RPC' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByText(/Use Cancel to stop the RPC/)).toBeInTheDocument();
  });

  it('labels callback-observed handler boundaries separately from console round trip', () => {
    render(<CallWorkspace {...props()} />);

    expect(screen.getByText('Handler 49 ms')).toBeVisible();
    expect(screen.queryByText('RPC 49 ms')).not.toBeInTheDocument();
    expect(screen.getByText('Console 51 ms')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Status' }));
    const timings = screen.getByLabelText('gRPC timing evidence');
    expect(within(timings).getByText('Headers observed').nextSibling).toHaveTextContent('7 ms');
    expect(within(timings).getByText('First message observed').nextSibling).toHaveTextContent(
      '18 ms'
    );
    expect(within(timings).getByText('Final status observed').nextSibling).toHaveTextContent(
      '47 ms'
    );
    expect(within(timings).getByText('Invoke returned').nextSibling).toHaveTextContent('49 ms');
    expect(within(timings).getByText('Console round trip').nextSibling).toHaveTextContent('51 ms');
    const note = screen.getByText(/Callback-observed lifecycle boundaries/i);
    expect(note).toHaveTextContent(/Unary callbacks can cluster after transport completion/i);
    expect(note).toHaveTextContent(/not packet arrival, server processing, or TTFB measurements/i);
    expect(note).toHaveTextContent(/JSON\/protobuf conversion and callbacks/i);
  });

  it('shows unavailable message timing honestly instead of spacing messages across console time', () => {
    render(
      <CallWorkspace
        {...props({
          invokeState: {
            loading: false,
            error: null,
            latencyMs: 51,
            result: {
              ...response,
              timings: null,
              responses: response.responses.map((entry) => ({ ...entry, elapsedMs: null })),
            },
          },
        })}
      />
    );

    const firstMessage = screen.getByRole('button', { name: /Message 1/ });
    expect(within(firstMessage).getByText('—')).toBeVisible();
    expect(within(firstMessage).getByText('+—')).toBeVisible();
    expect(screen.queryByText('26 ms')).not.toBeInTheDocument();
    expect(screen.queryByText('51 ms', { selector: '.pp-message-time *' })).not.toBeInTheDocument();
  });

  it('discloses retained partial evidence without fabricating a final gRPC status', () => {
    const message =
      "ProtoPeek stopped this RPC after retaining 512 response messages; the server's final gRPC status was not observed.";
    render(
      <CallWorkspace
        {...props({
          invokeState: {
            loading: false,
            error: null,
            latencyMs: 51,
            result: {
              ...response,
              trailers: [],
              timings: { headersMs: 7, firstMessageMs: 18, trailersMs: null, totalMs: 49 },
              localLimit: {
                reason: 'response-count',
                message,
                retainedResponses: 512,
                retainedResponseBytes: 4096,
                maxResponses: 512,
                maxResponseBytes: 8_388_608,
                maxDurationSeconds: 60,
              },
            },
          },
        })}
      />
    );

    expect(screen.getByRole('status', { name: 'RPC status LOCAL LIMIT' })).toBeVisible();
    const disclosure = screen.getByRole('alert');
    expect(within(disclosure).getByText('Partial response evidence')).toBeVisible();
    expect(within(disclosure).getByText(message)).toBeVisible();
    expect(screen.getAllByText('Message 1')).toHaveLength(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Status' }));
    expect(screen.getByText('Not observed (local limit)')).toBeVisible();
    expect(screen.queryByText('OK (0)')).not.toBeInTheDocument();
    expect(screen.queryByText('RPC completed successfully.')).not.toBeInTheDocument();
  });

  it('announces only an atomic current or final status when a stream has many messages', () => {
    const manyResponses = Array.from({ length: 200 }, (_, index) => ({
      isError: false,
      sequence: index + 1,
      elapsedMs: index + 1,
      message: { sequence: index + 1 },
    }));
    const { container, rerender } = render(
      <CallWorkspace
        {...props({
          invokeState: {
            loading: false,
            error: null,
            latencyMs: 205,
            result: { ...response, responses: manyResponses },
          },
        })}
      />
    );

    const timeline = screen.getByLabelText('Response message timeline');
    const status = screen.getByRole('status', { name: 'RPC status OK' });
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(timeline.closest('[aria-live]')).toBeNull();
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);

    rerender(
      <CallWorkspace
        {...props({
          invokeState: { loading: true, error: null, latencyMs: 0, result: null },
        })}
      />
    );
    expect(screen.getByRole('status', { name: 'RPC status STREAMING' })).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });
});

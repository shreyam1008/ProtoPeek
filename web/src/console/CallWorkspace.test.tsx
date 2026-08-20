import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/ }));
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

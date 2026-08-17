import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getAllByText('Message 1')).toHaveLength(2);
    expect(screen.getByText('18 ms')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter responses' }), {
      target: { value: 'not_serving' },
    });
    expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
    expect(screen.getAllByText('Message 2')).toHaveLength(2);

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
});

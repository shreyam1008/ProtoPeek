import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeMethod, invokeWorkspaceMethod } from '@/console/api';
import type { InvokeResponse } from '@/shared/types';
import { type InvokeState, useGrpcInvoke } from './useGrpcInvoke';

vi.mock('@/console/api', () => ({ invokeMethod: vi.fn(), invokeWorkspaceMethod: vi.fn() }));

const method = {
  name: 'Echo',
  fullName: 'demo.Echo/Echo',
  description: '',
  clientStreaming: false,
  serverStreaming: false,
  requestType: 'demo.Request',
  responseType: 'demo.Response',
};
const response: InvokeResponse = {
  headers: [],
  trailers: [],
  responses: [{ isError: false, sequence: 1, elapsedMs: 1, message: { reply: 'retained' } }],
  requests: { sent: 1, total: 1 },
  error: null,
  timings: null,
  localLimit: null,
};

function options(requestText: string, requestStream = false) {
  return {
    schema: { requestType: method.requestType, requestStream, messageTypes: {}, enumTypes: {} },
    service: { name: 'demo.Echo', description: '', methods: [method] },
    method,
    workspaceSessionId: '',
    requestText,
    timeoutSeconds: 15,
    metadata: [],
    assertionRules: [],
    replayScope: { targetAddress: 'localhost:50051' },
    setHistory: vi.fn(),
    setOperationMessage: vi.fn(),
    setActiveView: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(invokeMethod).mockReset().mockResolvedValue(response);
  vi.mocked(invokeWorkspaceMethod).mockReset().mockResolvedValue(response);
});

describe('local gRPC request validation', () => {
  it.each([
    'complete',
    'cancel',
  ] as const)('keeps an active RPC coherent when invalid edited input is run again, then %s', async (outcome) => {
    let signal: AbortSignal | undefined;
    let complete: (value: InvokeResponse) => void = () => {};
    vi.mocked(invokeMethod).mockImplementationOnce(
      (_method, _payload, currentSignal) =>
        new Promise((resolve, reject) => {
          signal = currentSignal;
          complete = resolve;
          currentSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    const shared = options('{"sent":true}');
    const { result, rerender } = renderHook(
      ({ requestText }) => useGrpcInvoke({ ...shared, requestText }),
      { initialProps: { requestText: '{"sent":true}' } }
    );
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.run();
    });
    expect(result.current.state.loading).toBe(true);
    rerender({ requestText: '{ broken' });
    await act(() => result.current.run());
    expect(result.current.state).toMatchObject({ loading: true, error: null, result: null });
    expect(result.current.state.validationError).toBeUndefined();
    expect(result.current.isActive()).toBe(true);
    expect(signal?.aborted).toBe(false);
    expect(invokeMethod).toHaveBeenCalledOnce();
    expect(vi.mocked(invokeMethod).mock.calls[0]?.[1].data).toEqual([{ sent: true }]);
    await act(async () => {
      if (outcome === 'complete') complete(response);
      else result.current.cancel();
      await pending;
    });
    expect(result.current.isActive()).toBe(false);
    if (outcome === 'complete') {
      expect(result.current.state).toMatchObject({ loading: false, error: null, result: response });
      expect(shared.setHistory).toHaveBeenCalledOnce();
    } else {
      expect(signal?.aborted).toBe(true);
      expect(result.current.state).toMatchObject({
        loading: false,
        cancelled: true,
        error: 'Invocation cancelled.',
        result: null,
      });
      expect(shared.setHistory).not.toHaveBeenCalled();
    }
    rerender({ requestText: '{"next":true}' });
    await act(() => result.current.run());
    expect(invokeMethod).toHaveBeenCalledTimes(2);
    expect(result.current.state.result).toBe(response);
  });

  it.each([
    ['{ broken', false, /JSON|property|position|Unexpected/i],
    ['[]', false, /Unary RPCs need a single object/],
    ['{}', true, /Streaming RPCs need a JSON array/],
  ] as const)('rejects %s locally without entering transport loading', async (text, stream, error) => {
    const states: InvokeState[] = [];
    const { result, rerender } = renderHook(
      ({ requestText }) => {
        const invoke = useGrpcInvoke(options(requestText, stream));
        states.push(invoke.state);
        return invoke;
      },
      { initialProps: { requestText: text as string } }
    );
    await act(() => result.current.run());
    expect(result.current.state).toMatchObject({
      validationError: expect.stringMatching(error),
      error: null,
      result: null,
      loading: false,
      latencyMs: 0,
    });
    expect(states.every((state) => !state.loading)).toBe(true);
    expect(invokeMethod).not.toHaveBeenCalled();
    expect(invokeWorkspaceMethod).not.toHaveBeenCalled();
    rerender({ requestText: stream ? '[]' : '{}' });
    await waitFor(() => expect(result.current.state.validationError).toBeNull());
    expect(result.current.state.error).toBeNull();
  });

  it('clears previous displayed response evidence on a rejected local attempt without adding history', async () => {
    const sharedOptions = options('{}');
    const { result, rerender } = renderHook(
      ({ requestText }) => useGrpcInvoke({ ...sharedOptions, requestText }),
      { initialProps: { requestText: '{}' } }
    );
    await act(() => result.current.run());
    expect(result.current.state.result).toBe(response);
    expect(sharedOptions.setHistory).toHaveBeenCalledOnce();
    rerender({ requestText: '{ broken' });
    expect(result.current.state.result).toBe(response);
    await act(() => result.current.run());
    expect(result.current.state).toMatchObject({
      result: null,
      error: null,
      loading: false,
      validationError: expect.any(String),
      latencyMs: 0,
    });
    expect(result.current.assertionResults).toEqual([]);
    expect(invokeMethod).toHaveBeenCalledOnce();
    expect(sharedOptions.setHistory).toHaveBeenCalledOnce();
  });

  it('keeps an actual transport failure separate when editing the draft', async () => {
    vi.mocked(invokeMethod).mockRejectedValueOnce(new Error('Connection refused'));
    const { result, rerender } = renderHook(
      ({ requestText }) => useGrpcInvoke(options(requestText)),
      { initialProps: { requestText: '{}' } }
    );
    await act(() => result.current.run());
    expect(result.current.state.error).toBe('Connection refused');
    expect(result.current.state.validationError).toBeUndefined();
    rerender({ requestText: '{"changed":true}' });
    expect(result.current.state.error).toBe('Connection refused');
  });
});

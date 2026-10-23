import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('incremental invocation lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('surfaces a local conversion relay error without inventing status or adding successful history', async () => {
    const shared = options('{}');
    const failed = {
      ...response,
      finalStatusObserved: false,
      responses: [],
      requests: { total: 1, sent: 0 },
      relayError: 'Request message 1 could not be converted to protobuf: expected an integer.',
    };
    vi.mocked(invokeMethod).mockResolvedValueOnce(failed);
    const { result } = renderHook(() => useGrpcInvoke(shared));
    await act(() => result.current.run());
    expect(result.current.state).toMatchObject({
      loading: false,
      error: failed.relayError,
      result: failed,
    });
    expect(result.current.state.result?.error).toBeNull();
    expect(shared.setHistory).not.toHaveBeenCalled();
  });

  it.each([
    'cancel',
    'truncated',
    'complete',
    'workspace',
  ] as const)('retains bounded partial evidence during %s', async (outcome) => {
    vi.useFakeTimers();
    let publish: (value: InvokeResponse) => void = () => {};
    let resolve: (value: InvokeResponse) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const transport = (signal?: AbortSignal, onPartial?: (value: InvokeResponse) => void) =>
      new Promise<InvokeResponse>((done, fail) => {
        publish =
          onPartial ??
          (() => {
            throw new Error('Streaming callback missing');
          });
        resolve = done;
        reject = fail;
        signal?.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      });
    vi.mocked(invokeMethod).mockImplementationOnce((_method, _payload, signal, onPartial) =>
      transport(signal, onPartial)
    );
    vi.mocked(invokeWorkspaceMethod).mockImplementationOnce(
      (_session, _method, _payload, signal, onPartial) => transport(signal, onPartial)
    );
    const shared = {
      ...options('{}'),
      method: { ...method, serverStreaming: true },
      workspaceSessionId: outcome === 'workspace' ? 'fixture-session' : '',
    };
    const states: InvokeState[] = [];
    const { result } = renderHook(() => {
      const value = useGrpcInvoke(shared);
      states.push(value.state);
      return value;
    });
    let pending = Promise.resolve();
    act(() => {
      pending = result.current.run();
    });
    const partial = { ...response, trailers: [], finalStatusObserved: false };
    const retainedMessage = response.responses[0];
    if (!retainedMessage) throw new Error('Message fixture missing');
    const rendersBeforeMessages = states.length;
    act(() => {
      for (let index = 0; index < 100; index++)
        publish({
          ...partial,
          responses: Array.from({ length: index + 1 }, (_, sequence) => ({
            ...retainedMessage,
            sequence: sequence + 1,
          })),
        });
    });
    expect(states).toHaveLength(rendersBeforeMessages);
    expect(result.current.state.result).toBeNull();
    act(() => vi.advanceTimersByTime(50));
    expect(states).toHaveLength(rendersBeforeMessages + 1);
    expect(result.current.state.loading).toBe(true);
    expect(result.current.state.result?.responses).toHaveLength(100);
    expect(result.current.state.result?.finalStatusObserved).toBe(false);
    expect(shared.setHistory).not.toHaveBeenCalled();
    await act(async () => {
      if (outcome === 'cancel') result.current.cancel();
      else if (outcome === 'truncated') reject(new Error('Completion was not received'));
      else resolve({ ...response, finalStatusObserved: true });
      await pending;
    });
    expect(result.current.state.loading).toBe(false);
    expect(result.current.isActive()).toBe(false);
    if (outcome === 'cancel' || outcome === 'truncated') {
      expect(result.current.state.result?.responses).toHaveLength(100);
      expect(result.current.state.result).toMatchObject({
        finalStatusObserved: false,
        error: null,
        trailers: [],
      });
      expect(result.current.state.cancelled).toBe(outcome === 'cancel');
      expect(shared.setHistory).not.toHaveBeenCalled();
    } else {
      expect(result.current.state.result?.finalStatusObserved).toBe(true);
      expect(shared.setHistory).toHaveBeenCalledOnce();
    }
  });

  it('invalidates pending batch updates and late callbacks when silently cancelled', async () => {
    vi.useFakeTimers();
    let publish: (value: InvokeResponse) => void = () => {};
    vi.mocked(invokeMethod).mockImplementationOnce(
      (_method, _payload, signal, onPartial) =>
        new Promise((_done, reject) => {
          publish = onPartial ?? (() => {});
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    const { result } = renderHook(() =>
      useGrpcInvoke({ ...options('{}'), method: { ...method, serverStreaming: true } })
    );
    let pending = Promise.resolve();
    act(() => {
      pending = result.current.run();
    });
    act(() => {
      publish({ ...response, finalStatusObserved: false });
      result.current.cancelSilently();
      result.current.reset();
    });
    await act(async () => {
      publish(response);
      vi.advanceTimersByTime(100);
      await pending;
    });
    expect(result.current.state).toMatchObject({ loading: false, result: null, error: null });
  });
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

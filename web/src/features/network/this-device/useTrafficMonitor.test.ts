import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { sampleThisPCTraffic, type ThisPCTrafficSample } from '@/console/this-pc-api';
import { useTrafficMonitor } from './useTrafficMonitor';

vi.mock('@/console/this-pc-api', () => ({ sampleThisPCTraffic: vi.fn() }));
const result = {
  durationMs: 1000,
  interfaces: [],
  finishedAt: '2026-09-06T12:00:00Z',
} as unknown as ThisPCTrafficSample;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(sampleThisPCTraffic).mockReset();
});

it('starts only explicitly, keeps requests sequential, and stops after two minutes', async () => {
  vi.useFakeTimers();
  vi.mocked(sampleThisPCTraffic).mockResolvedValue(result);
  const hook = renderHook(() => useTrafficMonitor(1000));
  expect(sampleThisPCTraffic).not.toHaveBeenCalled();
  await act(async () => hook.result.current.start());
  expect(sampleThisPCTraffic).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(sampleThisPCTraffic).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(hook.result.current.running).toBe(false);
  const count = vi.mocked(sampleThisPCTraffic).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(sampleThisPCTraffic).toHaveBeenCalledTimes(count);
});

it('aborts an in-flight sample on Stop and ignores its late response', async () => {
  vi.useFakeTimers();
  let resolve!: (value: ThisPCTrafficSample) => void;
  vi.mocked(sampleThisPCTraffic).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const hook = renderHook(() => useTrafficMonitor(1000));
  act(() => hook.result.current.start());
  const signal = vi.mocked(sampleThisPCTraffic).mock.calls[0][1];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(sampleThisPCTraffic).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.stop());
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(result));
  expect(hook.result.current.value).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops on hidden-page transition and never resumes without another Start', async () => {
  vi.useFakeTimers();
  vi.mocked(sampleThisPCTraffic).mockResolvedValue(result);
  const hook = renderHook(() => useTrafficMonitor(500));
  await act(async () => hook.result.current.start());
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(hook.result.current.running).toBe(false);
  expect(hook.result.current.value).toBe(result);
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(sampleThisPCTraffic).toHaveBeenCalledTimes(1);
});

it('aborts and removes timers on unmount', () => {
  vi.useFakeTimers();
  vi.mocked(sampleThisPCTraffic).mockImplementation(() => new Promise(() => {}));
  const hook = renderHook(() => useTrafficMonitor(2000));
  act(() => hook.result.current.start());
  const signal = vi.mocked(sampleThisPCTraffic).mock.calls[0][1];
  hook.unmount();
  expect(signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

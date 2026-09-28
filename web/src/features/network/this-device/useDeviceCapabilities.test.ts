import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchThisPCCapabilities,
  fetchThisPCSnapshot,
  type ThisPCCapabilities,
  type ThisPCSnapshot,
} from '@/console/this-pc-api';
import { useDeviceCapabilities } from './useDeviceCapabilities';

vi.mock('@/console/this-pc-api', async (original) => ({
  ...(await original<typeof import('@/console/this-pc-api')>()),
  fetchThisPCCapabilities: vi.fn(),
  fetchThisPCSnapshot: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

const capability = { schemaVersion: 1 } as ThisPCCapabilities;
const snapshot = { schemaVersion: 1, hostname: 'current-device' } as ThisPCSnapshot;

it('recovers from a temporary capability failure without reloading the page', async () => {
  vi.mocked(fetchThisPCCapabilities)
    .mockRejectedValueOnce(new Error('Local API not ready'))
    .mockResolvedValue(capability);
  vi.mocked(fetchThisPCSnapshot).mockResolvedValue(snapshot);
  const { result } = renderHook(() => useDeviceCapabilities());
  await waitFor(() => expect(result.current.capabilities.status).toBe('error'));
  act(() => result.current.loadCapabilities());
  await waitFor(() =>
    expect(result.current.capabilities).toEqual({ status: 'ready', value: capability })
  );
  expect(fetchThisPCCapabilities).toHaveBeenCalledTimes(2);
  expect(fetchThisPCSnapshot).toHaveBeenCalledTimes(1);
});

it('ignores an old snapshot that settles after a newer refresh', async () => {
  let oldResult!: (value: ThisPCSnapshot) => void;
  vi.mocked(fetchThisPCCapabilities).mockResolvedValue(capability);
  vi.mocked(fetchThisPCSnapshot)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldResult = resolve;
        })
    )
    .mockResolvedValue(snapshot);
  const { result } = renderHook(() => useDeviceCapabilities());
  const oldSignal = vi.mocked(fetchThisPCSnapshot).mock.calls[0][0];
  act(() => result.current.loadSnapshot());
  expect(oldSignal?.aborted).toBe(true);
  await waitFor(() =>
    expect(result.current.snapshot).toEqual({ status: 'ready', value: snapshot })
  );
  await act(async () => oldResult({ ...snapshot, hostname: 'old-device' }));
  expect(result.current.snapshot).toEqual({ status: 'ready', value: snapshot });
});

import { afterEach, expect, it, vi } from 'vitest';
import { previewPorts } from './port-scan';
import { scanHostPorts } from './port-scan-api';
import { scanPortBatches } from './port-scan-batches';

vi.mock('./port-scan-api', () => ({ scanHostPorts: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const input = { host: 'example.test', family: 'auto', timeoutMs: 100 };
function mockBatches() {
  vi.mocked(scanHostPorts).mockImplementation(async (request) => ({
    host: request.host,
    address: '192.0.2.1',
    durationMs: 1,
    complete: true,
    results: previewPorts(request.ports).map((port) => ({ port, state: 'closed', durationMs: 1 })),
  }));
}
it('covers every TCP port exactly once and pins later batches to the first IP', async () => {
  mockBatches();
  const result = await scanPortBatches(
    input,
    previewPorts('1-65535', 65535),
    new AbortController().signal,
    vi.fn()
  );
  expect(result.complete).toBe(true);
  expect(result.results.map((row) => row.port)).toEqual(
    Array.from({ length: 65535 }, (_, i) => i + 1)
  );
  expect(scanHostPorts).toHaveBeenCalledTimes(256);
  for (const [request] of vi.mocked(scanHostPorts).mock.calls.slice(1)) {
    expect(request.host).toBe('192.0.2.1');
    expect(previewPorts(request.ports).length).toBeLessThanOrEqual(256);
  }
  expect(() => previewPorts('1-65535')).toThrow(); // Nmap keeps its separate limit.
});
it('stops after cancellation and leaves completed batches available', async () => {
  mockBatches();
  const controller = new AbortController();
  const progress = vi.fn<Parameters<typeof scanPortBatches>[3]>(() => controller.abort());
  await expect(
    scanPortBatches(input, previewPorts('1-2048', 65535), controller.signal, progress)
  ).rejects.toThrow();
  expect(scanHostPorts).toHaveBeenCalledTimes(1);
  expect(progress.mock.calls[0][0].results.filter((row) => row.state === 'closed')).toHaveLength(
    256
  );
});
it('does not claim completion when a batch hits its time limit', async () => {
  vi.mocked(scanHostPorts).mockResolvedValue({
    host: input.host,
    address: '192.0.2.1',
    durationMs: 30000,
    complete: false,
    results: [{ port: 80, state: 'not-scanned', durationMs: 0 }],
  });
  const result = await scanPortBatches(input, [80], new AbortController().signal, vi.fn());
  expect(result.complete).toBe(false);
});

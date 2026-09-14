import type { PortScanResponse } from './port-scan';
import { scanHostPorts } from './port-scan-api';

export async function scanPortBatches(
  input: { host: string; family: string; timeoutMs: number },
  ports: number[],
  signal: AbortSignal,
  onProgress: (result: PortScanResponse, checked: number) => void
) {
  const started = performance.now();
  let address = '';
  let checked = 0;
  const results: PortScanResponse['results'] = ports.map((port) => ({
    port,
    state: 'not-scanned',
    durationMs: 0,
  }));
  const batchSize = ports.length <= 1024 ? ports.length : 256;
  for (let offset = 0; offset < ports.length; offset += batchSize) {
    signal.throwIfAborted();
    const batch = ports.slice(offset, offset + batchSize);
    const response = await scanHostPorts(
      { ...input, host: address || input.host, ports: batch.join(',') },
      signal
    );
    signal.throwIfAborted();
    if (
      (address && address !== response.address) ||
      response.results.length !== batch.length ||
      response.results.some((row, index) => row.port !== batch[index])
    ) {
      throw new Error('Scan response did not match the selected address and ports.');
    }
    address = response.address;
    results.splice(offset, batch.length, ...response.results);
    checked += response.results.filter((row) => row.state !== 'not-scanned').length;
    const snapshot = {
      host: input.host,
      address,
      results: [...results],
      durationMs: performance.now() - started,
      complete: checked === ports.length,
    };
    onProgress(snapshot, checked);
    if (!response.complete || checked === ports.length) return snapshot;
  }
  throw new Error('No ports selected.');
}

import { fetchJSON } from './api';
import { parsePortScanResponse } from './port-scan-store';

export async function scanHostPorts(
  input: { host: string; ports: string; family: string; timeoutMs: number },
  signal: AbortSignal
) {
  return parsePortScanResponse(
    await fetchJSON<unknown>('api/ports/scan', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

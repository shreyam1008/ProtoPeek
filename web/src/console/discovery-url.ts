import type { ScanResult } from './api';

export function scanResultHTTPURL(result: ScanResult) {
  return `${result.httpTransport === 'tls' ? 'https' : 'http'}://${result.address}/`;
}

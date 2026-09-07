import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parsePortScanResponse,
  readPortScannerDraft,
  writePortScannerDraft,
} from './port-scan-store';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('port scanner recovery', () => {
  it('restores settings and the last bounded observation', () => {
    const draft = {
      ...readPortScannerDraft(),
      host: 'localhost',
      ports: '80-90',
      result: {
        host: 'localhost',
        address: '127.0.0.1',
        complete: true,
        durationMs: 10,
        results: [{ port: 80, state: 'open' as const, durationMs: 2 }],
      },
      observedAt: '2026-09-06T12:00:00Z',
    };
    expect(writePortScannerDraft(draft)).toBe('');
    expect(readPortScannerDraft()).toEqual(draft);
    writePortScannerDraft({ ...draft, result: null });
    expect(readPortScannerDraft().result).toBeNull();
  });
  it('does not retain an in-progress credential authority and reports denied writes', () => {
    writePortScannerDraft({ ...readPortScannerDraft(), host: 'user:secret@host' });
    expect(localStorage.getItem('protopeek.portScanner.v1')).not.toContain('secret');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(writePortScannerDraft(readPortScannerDraft())).toContain('could not be saved');
  });
  it('rejects corrupt, oversized, duplicate and invalid observations', () => {
    for (const raw of ['null', '{', 'x'.repeat(140000), '{"version":999}']) {
      localStorage.setItem('protopeek.portScanner.v1', raw);
      expect(readPortScannerDraft().result).toBeNull();
    }
    const response = {
      host: 'localhost',
      address: '127.0.0.1',
      complete: true,
      durationMs: 10,
      results: [{ port: 80, state: 'open', durationMs: 2 }],
    };
    for (const results of [
      [null],
      [...response.results, ...response.results],
      [{ port: 0, state: 'open', durationMs: 1 }],
      Array(1025).fill(response.results[0]),
    ])
      expect(() => parsePortScanResponse({ ...response, results })).toThrow();
  });
});

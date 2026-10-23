import { describe, expect, it } from 'vitest';
import { safeDownloadMessage } from './download-source';

describe('Download message display', () => {
  it.each([
    [
      'Get "https://name:password@example.org/file?token=private#part": connection refused',
      'Get "https://example.org/file": connection refused',
    ],
    [
      'ERROR: Unable to download https://cdn.example.org/media?Signature=private (HTTP 403)',
      'ERROR: Unable to download https://cdn.example.org/media (HTTP 403)',
    ],
    [
      "fetch('http://[::1]:8080/file?secret=one'); source https://example.org/second?token=two failed",
      "fetch('http://[::1]:8080/file'); source https://example.org/second failed",
    ],
    [
      'Source returned HTTP 403; partial files remain.',
      'Source returned HTTP 403; partial files remain.',
    ],
  ])('redacts embedded URLs without changing the stored message', (message, expected) => {
    expect(safeDownloadMessage(message)).toBe(expected);
  });
});

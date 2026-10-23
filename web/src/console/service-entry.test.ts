import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingHandoff,
  consumePendingHandoff,
  storePendingHandoff,
} from './app/handoff-store';
import { prepareServiceEntry } from './service-entry';

afterEach(clearPendingHandoff);

describe('manual service entry', () => {
  it.each([
    ['https://api.example.com/a?q=one%20two', 'https://api.example.com/a?q=one%20two'],
    ['localhost:8080/health?ready=1', 'http://localhost:8080/health?ready=1'],
    ['[::1]:8080/health', 'http://[::1]:8080/health'],
    ['https://例え.テスト/health', 'https://xn--r8jz45g.xn--zckzah/health'],
  ])('preserves the complete HTTP address %s through the real consume-once broker', (input, url) => {
    const prepared = prepareServiceEntry(input, 'http');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(storePendingHandoff(prepared.handoff, { memoryOnly: true }).ok).toBe(true);
    expect(consumePendingHandoff('http-url-draft')?.draft.target).toEqual({
      kind: 'http-url',
      url,
    });
    expect(consumePendingHandoff('http-url-draft')).toBeNull();
  });
  it.each([
    ['localhost:50051', 'grpc-plaintext', 'localhost:50051', true],
    ['[::1]:50051', 'grpc-tls', '[::1]:50051', false],
    ['https://例え.テスト', 'grpc-tls', 'xn--r8jz45g.xn--zckzah:443', false],
    ['http://localhost', 'grpc-plaintext', 'localhost:80', true],
  ] as const)('keeps the selected gRPC transport for %s', (input, mode, address, plaintext) => {
    const prepared = prepareServiceEntry(input, mode);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(storePendingHandoff(prepared.handoff).ok).toBe(true);
    expect(consumePendingHandoff('grpc-target-draft')?.draft.target).toEqual({
      kind: 'grpc-target',
      address,
      plaintext,
    });
  });
  it.each([
    ['https://user:secret@example.com/', 'http'],
    ['javascript://example.com', 'http'],
    ['api.example.com:8080', 'http'],
    ['//localhost:8080', 'http'],
    ['https://example.com/a b', 'http'],
    ['https://example.com/a\nB', 'http'],
    ['https://example.com/\\private', 'http'],
    ['https://example.com/', 'grpc-plaintext'],
    ['http://example.com/', 'grpc-tls'],
    ['localhost:0', 'grpc-plaintext'],
    ['localhost:99999', 'grpc-tls'],
    ['localhost', 'grpc-tls'],
    ['localhost:50051/method', 'grpc-plaintext'],
    ['localhost:50051?q=secret', 'grpc-plaintext'],
    ['localhost:50051#fragment', 'grpc-tls'],
    [`https://example.com/${'x'.repeat(2048)}`, 'http'],
  ] as const)('rejects ambiguous or unsafe %s without echoing credentials', (input, mode) => {
    const prepared = prepareServiceEntry(input, mode);
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.error).not.toContain('secret');
  });
});

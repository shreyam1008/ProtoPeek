import { describe, expect, it } from 'vitest';
import { prepareDiscoveryTarget } from './discovery-target';

describe('Home discovery target', () => {
  it.each([
    'localhost',
    'localhost:8080',
    'example.com:80',
    '127.0.0.1:50051',
    '[::1]:8080',
  ])('preserves explicit host scope: %s', (target) => {
    expect(prepareDiscoveryTarget(` ${target} `)).toEqual({ ok: true, target });
  });
  it('uses only a pasted URL authority, keeping paths, query values and fragments out of discovery', () => {
    expect(
      prepareDiscoveryTarget('https://api.example.com:8443/users?token=private#section')
    ).toEqual({ ok: true, target: 'https://api.example.com:8443' });
  });
  it.each([
    ['http://example.com:80/health', 'http://example.com'],
    ['https://example.com:443/health', 'https://example.com'],
    ['http://[::1]:8080/health', 'http://[::1]:8080'],
  ])('keeps the URL scheme and effective port for %s', (input, target) => {
    expect(prepareDiscoveryTarget(input)).toEqual({ ok: true, target });
  });
  it.each([
    'https://user:secret@example.com/path',
    'user:secret@example.com:8080',
  ])('rejects credentials before opening a scan: %s', (target) => {
    const result = prepareDiscoveryTarget(target);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it.each([
    'ftp://example.com',
    'localhost/path',
    'localhost?token=private',
    'localhost:8080/',
    'localhost:8080?',
    'localhost:8080#',
    'localhost:',
    '[::1]:',
    'localhost\\path',
    'localhost:8080\\health',
    '@example.com',
    'not an address',
    'https://',
  ])('rejects unsupported or ambiguous addresses: %s', (target) => {
    expect(prepareDiscoveryTarget(target).ok).toBe(false);
  });
  it('keeps empty submission available for discovery setup and bounds bytes', () => {
    expect(prepareDiscoveryTarget('  ')).toEqual({ ok: true, target: '' });
    expect(prepareDiscoveryTarget('a'.repeat(513)).ok).toBe(false);
    expect(prepareDiscoveryTarget('é'.repeat(257)).ok).toBe(false);
  });
});

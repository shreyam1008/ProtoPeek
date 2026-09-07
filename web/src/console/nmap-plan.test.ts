import { expect, it } from 'vitest';
import { previewNmapPlan } from './nmap-plan';

it('previews the exact masked subnet, including Nmap -Pn endpoint addresses', () => {
  expect(previewNmapPlan('192.168.1.47/28', '443,80,80')).toEqual({
    target: '192.168.1.32/28',
    hosts: 16,
    ports: [80, 443],
    pairs: 32,
  });
  expect(previewNmapPlan('::1', '80').hosts).toBe(1);
  expect(previewNmapPlan('10.0.0.1/24', '1-16').pairs).toBe(4096);
});

it.each([
  'example.com',
  '--script=all',
  '192.168.1.1/23',
  '1.1.1.1/24',
  '10.0.0.1/33',
  '256.0.0.1',
  '010.0.0.1',
  '0.0.0.0',
  '224.0.0.1',
  'fe80::1%1',
  'ff02::1',
  '::',
])('rejects invalid target %s', (target) => {
  expect(() => previewNmapPlan(target, '80')).toThrow();
});

it('rejects an oversized host-port plan', () => {
  expect(() => previewNmapPlan('10.0.0.1/24', '1-17')).toThrow('4,096');
});

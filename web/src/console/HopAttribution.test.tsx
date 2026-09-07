import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import HopAttribution from './HopAttribution';
import { attributionSource, normalizeIPAttribution } from './ip-attribution';

afterEach(() => vi.unstubAllGlobals());
const entry = {
  ip: '1.1.1.1',
  status: 'observed',
  country: 'Australia',
  asn: 13335,
  isp: 'Cloudflare',
  observedAt: '2026-09-06T12:00:00Z',
  cached: false,
};
const response = { source: attributionSource, entries: [entry] };

it('runs only after consent and preserves the attribution source', async () => {
  const fetchMock = vi.fn(async (_url: unknown, _options?: RequestInit) => Response.json(response));
  vi.stubGlobal('fetch', fetchMock);
  const onResult = vi.fn();
  render(<HopAttribution addresses={['1.1.1.1', '1.1.1.1']} onResult={onResult} />);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Look up hop labels' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Look up hop labels' }));
  await waitFor(() => expect(onResult).toHaveBeenCalledOnce());
  expect(onResult.mock.calls[0]?.[0].source).toBe(attributionSource);
  expect(onResult.mock.calls[0]?.[0].entries[0].asn).toBe(13335);
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    addresses: ['1.1.1.1'],
    acknowledgeThirdParty: true,
  });
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

it('cancel aborts transport and a late response cannot add labels', async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn(
    (_url: unknown, _options?: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', fetchMock);
  const onResult = vi.fn();
  render(<HopAttribution addresses={['1.1.1.1']} onResult={onResult} />);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Look up hop labels' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel attribution' }));
  expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  finish(Response.json(response));
  await waitFor(() => expect(screen.getByText(/Attribution cancelled/)).toBeVisible());
  expect(onResult).not.toHaveBeenCalled();
});

it('rejects provider, identity, size and number mismatches while accepting mapped addresses', () => {
  expect(normalizeIPAttribution(response, ['::ffff:1.1.1.1']).entries[0]?.ip).toBe('1.1.1.1');
  for (const value of [
    { ...response, source: 'https://unexpected.example' },
    { ...response, entries: [{ ...entry, ip: '8.8.8.8' }] },
    { ...response, entries: [{ ...entry, asn: -1 }] },
    { ...response, entries: [{ ...entry, country: 'x'.repeat(129) }] },
  ]) {
    expect(() => normalizeIPAttribution(value, ['1.1.1.1'])).toThrow();
  }
});

it('retains distinct local IPv6 scopes in skipped labels', () => {
  const addresses = ['fe80::1%3', 'fe80::1%4'];
  const result = normalizeIPAttribution(
    {
      source: attributionSource,
      entries: addresses.map((ip) => ({ ...entry, ip, status: 'skipped' })),
    },
    addresses
  );
  expect(result.entries.map((item) => item.ip)).toEqual(addresses);
});

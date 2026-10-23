import { afterEach, expect, it, vi } from 'vitest';
import { performTailnetAction } from './tailnet-action';

afterEach(() => vi.unstubAllGlobals());
const input = {
  action: 'disconnect' as const,
  target: '',
  path: '',
  revision: 'observed',
  consent: true,
};
it('accepts only recognized typed409 failures and never reflects arbitrary error bodies', async () => {
  for (const value of [
    { error: 'https://auth.test/sentinel' },
    { action: 'logout', outcome: 'failed', output: 'sentinel' },
    { action: 'disconnect', outcome: 'completed', output: 'sentinel' },
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(value, { status: 409 }))
    );
    await expect(performTailnetAction(input, new AbortController().signal)).rejects.toThrow(
      'Tailscale operation was rejected (409)'
    );
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          action: 'disconnect',
          outcome: 'failed',
          output: 'Permission restriction.',
          observedAt: '2026-10-22T12:00:00Z',
        },
        { status: 409 }
      )
    )
  );
  const result = await performTailnetAction(input, new AbortController().signal);
  expect(result.outcome).toBe('failed');
  expect(result.snapshot).toBeUndefined();
});

it.each([
  403, 409, 429, 500,
])('treats plain-text HTTP%s as a rejection without reflecting its body', async (status) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response('Tailscale operation was not started. sentinel-secret', { status })
    )
  );
  await expect(performTailnetAction(input, new AbortController().signal)).rejects.toEqual(
    new Error(
      `Tailscale operation was rejected (${status}). Refresh the client state and review again.`
    )
  );
});

it.each([
  403, 409, 500,
])('rejects unknown or malformed JSON HTTP%s with status-specific recovery', async (status) => {
  for (const body of [
    { error: 'https://auth.test/sentinel-secret' },
    null,
    { action: input.action, outcome: 'failed', output: { secret: 'sentinel-secret' } },
    {
      action: input.action,
      outcome: 'failed',
      output: 'sentinel-secret',
      snapshot: { available: true },
    },
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(body, { status }))
    );
    await expect(performTailnetAction(input, new AbortController().signal)).rejects.toEqual(
      new Error(
        `Tailscale operation was rejected (${status}). Refresh the client state and review again.`
      )
    );
  }
});

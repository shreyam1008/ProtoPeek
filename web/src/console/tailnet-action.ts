import { readBoundedText } from '@/shared/bounded-response';
import type { TailAction, TailSnapshot } from './tailnet-api';

type ActionInput = {
  action: TailAction;
  target: string;
  path: string;
  revision: string;
  consent: boolean;
};
export type TailActionResult = {
  output: string;
  observedAt: string;
  outcome?: 'completed' | 'failed' | 'cancelled';
  snapshot?: TailSnapshot;
  previousProfileId?: string;
};
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
export async function performTailnetAction(
  input: ActionInput,
  signal: AbortSignal
): Promise<TailActionResult> {
  const response = await fetch(new URL('api/tailnet/action', window.location.href).toString(), {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token':
        document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '',
    },
    body: JSON.stringify(input),
  });
  const rejection = `Tailscale operation was rejected (${response.status}). Refresh the client state and review again.`;
  const body = await readBoundedText(response, 5 * 1024 * 1024);
  if (body.truncated)
    throw new Error('Tailscale response exceeded its safety limit. Refresh the client state.');
  let value: unknown;
  try {
    value = JSON.parse(body.text);
  } catch {
    throw new Error(
      response.ok
        ? 'Tailscale operation returned an invalid response. Refresh the client state.'
        : rejection
    );
  }
  const failed =
    response.status === 409 &&
    record(value) &&
    value.action === input.action &&
    (value.outcome === 'failed' || value.outcome === 'cancelled');
  if (!response.ok && !failed) throw new Error(rejection);
  if (
    !record(value) ||
    typeof value.output !== 'string' ||
    value.output.length > 16 * 1024 ||
    (value.observedAt !== undefined &&
      (typeof value.observedAt !== 'string' || value.observedAt.length > 64)) ||
    (value.outcome !== undefined &&
      !['completed', 'failed', 'cancelled'].includes(String(value.outcome))) ||
    (value.previousProfileId !== undefined &&
      (typeof value.previousProfileId !== 'string' || value.previousProfileId.length > 128))
  )
    throw new Error(
      response.ok ? 'Invalid Tailscale operation result. Refresh the client state.' : rejection
    );
  if (value.snapshot !== undefined && value.snapshot !== null) {
    const next = value.snapshot;
    if (
      !record(next) ||
      typeof next.available !== 'boolean' ||
      typeof next.state !== 'string' ||
      typeof next.revision !== 'string' ||
      !Array.isArray(next.peers) ||
      next.peers.length > 1024 ||
      !Array.isArray(next.profiles) ||
      next.profiles.length > 64 ||
      !Array.isArray(next.warnings)
    )
      throw new Error(
        response.ok ? 'Invalid reobserved Tailscale state. Refresh the client state.' : rejection
      );
  }
  return {
    ...value,
    observedAt: value.observedAt ?? '',
    snapshot: value.snapshot ?? undefined,
  } as TailActionResult;
}

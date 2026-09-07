import { readBoundedText } from '@/shared/bounded-response';
import { normalizeIPAttribution } from './ip-attribution';

export async function fetchIPAttribution(addresses: string[], signal: AbortSignal) {
  const response = await fetch(new URL('api/network/attribution', window.location.href), {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token':
        document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '',
    },
    body: JSON.stringify({ addresses, acknowledgeThirdParty: true }),
  });
  const body = await readBoundedText(response, 64 * 1024);
  if (body.truncated) throw new Error('Attribution response exceeded 64 KiB.');
  if (!response.ok) throw new Error(body.text.slice(0, 1024) || 'IP attribution unavailable.');
  return normalizeIPAttribution(JSON.parse(body.text), addresses);
}

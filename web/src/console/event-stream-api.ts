export type EventProtocol = 'websocket' | 'sse';
export type EventStreamRequest = {
  protocol: EventProtocol;
  url: string;
  headers: { name: string; value: string }[];
  subprotocols: string[];
  timeoutMs: number;
};
export type StreamEvent = {
  kind: 'open' | 'message' | 'closed' | 'limit';
  elapsedMs: number;
  sessionId?: string;
  data?: string;
  encoding?: 'text' | 'base64';
  event?: string;
  id?: string;
  detail?: string;
  status?: number;
  subprotocol?: string;
};

async function post(path: string, value: unknown, signal: AbortSignal) {
  const response = await fetch(new URL(path, window.location.href), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'x-protopeek-csrf-token':
        document.cookie.match(/(?:^|;\s*)_protopeek_csrf_token=([^;]+)/)?.[1] ?? '',
    },
    body: JSON.stringify(value),
    signal,
  });
  if (!response.ok) {
    const reader = response.body?.getReader();
    let message = '';
    try {
      if (reader) {
        const chunk = await reader.read();
        message = new TextDecoder().decode(chunk.value?.subarray(0, 8192)).trim();
      }
    } finally {
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
    }
    throw new Error(message || `Request failed (${response.status})`);
  }
  return response;
}

export async function connectEventStream(
  request: EventStreamRequest,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void
) {
  const response = await post('api/events/connect', request, signal);
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    await response.body?.cancel();
    throw new Error(
      'The server did not return an event stream. Update the local ProtoPeek server.'
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let bytes = 0;
  let count = 0;
  const consume = (line: string) => {
    if (!line.trim()) return;
    if (++count > 502 || line.length > 512 * 1024) throw new Error('Event stream limit exceeded.');
    const event: unknown = JSON.parse(line);
    if (
      !event ||
      typeof event !== 'object' ||
      !('kind' in event) ||
      !['open', 'message', 'closed', 'limit'].includes(String(event.kind)) ||
      !('elapsedMs' in event) ||
      typeof event.elapsedMs !== 'number'
    )
      throw new Error('The server returned an invalid stream event.');
    const fields = event as Record<string, unknown>;
    if (
      !Number.isFinite(fields.elapsedMs) ||
      ['sessionId', 'data', 'event', 'id', 'detail', 'subprotocol'].some(
        (key) => fields[key] !== undefined && typeof fields[key] !== 'string'
      ) ||
      (fields.status !== undefined && !Number.isInteger(fields.status)) ||
      (fields.encoding !== undefined && fields.encoding !== 'text' && fields.encoding !== 'base64')
    )
      throw new Error('The server returned invalid event data.');
    onEvent(event as StreamEvent);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      // JSON escaping can expand a bounded 2 MiB wire payload sixfold.
      if (bytes > 14 * 1024 * 1024) throw new Error('Event stream byte limit exceeded.');
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
      if (pending.length > 512 * 1024) throw new Error('Event exceeds the display limit.');
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function sendStreamMessage(
  sessionId: string,
  data: string,
  encoding: 'text' | 'base64',
  signal: AbortSignal
) {
  await post('api/events/send', { sessionId, data, encoding }, signal);
}

export function parseStreamHeaders(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const separator = line.indexOf(':');
      if (separator <= 0) throw new Error('Enter each header as Name: value on its own line.');
      return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
    });
}

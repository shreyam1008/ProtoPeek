import { readBoundedText } from '@/shared/bounded-response';
import type {
  InvokeRequest,
  InvokeResponse,
  InvokeResponseElement,
  InvokeStreamEvent,
  MetadataEntry,
} from '@/shared/types';

const messageLimit = 512;
const responseByteLimit = 8 << 20;
const streamByteLimit = responseByteLimit + (4 << 20);
const lineByteLimit = responseByteLimit + (256 << 10);
const encoder = new TextEncoder();

function malformed(detail: string): never {
  throw new Error(`Invalid gRPC response stream: ${detail}`);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) malformed('expected an object.');
  return value as Record<string, unknown>;
}

function number(value: unknown, maximum = 120_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum)
    malformed('invalid numeric evidence.');
  return value;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || encoder.encode(value).length > maximum)
    malformed('oversized or invalid text.');
  return value;
}

function metadata(value: unknown): MetadataEntry[] {
  if (!Array.isArray(value) || value.length > 1024) malformed('invalid metadata.');
  let bytes = 0;
  return value.map((item) => {
    const entry = record(item);
    const name = text(entry.name, 1024);
    const value = text(entry.value, 64 << 10);
    bytes += encoder.encode(name + value).length;
    if (bytes > 128 << 10) malformed('metadata exceeds its byte limit.');
    return { name, value };
  });
}

function message(value: unknown, sequence: number): InvokeResponseElement {
  const entry = record(value);
  if (
    entry.sequence !== sequence ||
    typeof entry.isError !== 'boolean' ||
    !Object.hasOwn(entry, 'message')
  )
    malformed('invalid message sequence or contents.');
  return {
    message: entry.message,
    isError: entry.isError,
    sequence,
    elapsedMs: number(entry.elapsedMs),
  };
}

export async function parseInvokeStream(
  stream: ReadableStream<Uint8Array>,
  onPartial: (result: InvokeResponse) => void,
  signal?: AbortSignal
): Promise<InvokeResponse> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let fragments: Uint8Array[] = [];
  let pendingBytes = 0;
  let totalBytes = 0;
  let responseBytes = 0;
  let started = false;
  let headersSeen = false;
  let complete = false;
  let lastElapsed = 0;
  let result: InvokeResponse = {
    finalStatusObserved: false,
    headers: [],
    responses: [],
    trailers: [],
    requests: null,
    error: null,
    localLimit: null,
    timings: null,
  };
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Invocation cancelled.', 'AbortError');
  };
  signal?.addEventListener('abort', abort, { once: true });

  function line(bytes: Uint8Array) {
    if (!bytes.length) return;
    if (bytes.length > lineByteLimit) malformed('line exceeds its byte limit.');
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(bytes));
    } catch {
      malformed('invalid JSON or UTF-8.');
    }
    const event = record(value) as Record<string, unknown> & { type: InvokeStreamEvent['type'] };
    if (complete) malformed('data followed completion.');
    if (!started && event.type !== 'started') malformed('missing start frame.');
    switch (event.type) {
      case 'started': {
        if (started) malformed('duplicate start frame.');
        const total = number(event.totalRequests ?? 0, 4 << 20);
        if (!Number.isSafeInteger(total)) malformed('invalid request count.');
        result.requests = { total, sent: 0 };
        started = true;
        break;
      }
      case 'headers': {
        if (headersSeen || result.responses.length) malformed('headers arrived out of order.');
        headersSeen = true;
        lastElapsed = Math.floor(number(event.elapsedMs));
        result = {
          ...result,
          headers: metadata(event.headers ?? []),
          timings: {
            headersMs: lastElapsed,
            firstMessageMs: null,
            trailersMs: null,
            totalMs: lastElapsed,
          },
        };
        break;
      }
      case 'message': {
        if (result.responses.length >= messageLimit) malformed('message count exceeds its limit.');
        const entry = message(event.response, result.responses.length + 1);
        if ((entry.elapsedMs ?? 0) < lastElapsed) malformed('message timings moved backwards.');
        lastElapsed = entry.elapsedMs ?? 0;
        responseBytes += encoder.encode(JSON.stringify(entry.message)).length;
        if (responseBytes > responseByteLimit) malformed('response bytes exceed their limit.');
        result = {
          ...result,
          responses: [...result.responses, entry],
          timings: {
            headersMs: result.timings?.headersMs ?? null,
            firstMessageMs: result.timings?.firstMessageMs ?? entry.elapsedMs,
            trailersMs: null,
            totalMs: lastElapsed,
          },
        };
        break;
      }
      case 'complete': {
        const end = record(event.result);
        if (
          typeof end.finalStatusObserved !== 'boolean' ||
          (end.responses !== null && (!Array.isArray(end.responses) || end.responses.length))
        )
          malformed('invalid completion evidence.');
        const timings = record(end.timings);
        const totalMs = number(timings.totalMs);
        if (totalMs < lastElapsed) malformed('completion timing moved backwards.');
        const nullableTime = (value: unknown) => (value === null ? null : number(value));
        const requests = record(end.requests);
        const total = number(requests.total, 4 << 20);
        const sent = number(requests.sent, total);
        if (
          !Number.isSafeInteger(total) ||
          !Number.isSafeInteger(sent) ||
          total !== result.requests?.total
        )
          malformed('request counts changed.');
        let error: InvokeResponse['error'] = null;
        if (end.error !== null) {
          const status = record(end.error);
          const code = number(status.code, 16);
          if (!Number.isSafeInteger(code) || code === 0) malformed('invalid final status.');
          if (!Array.isArray(status.details) || status.details.length > 64)
            malformed('invalid status details.');
          error = {
            code,
            name: text(status.name, 128),
            message: text(status.message, 64 << 10),
            details: status.details.map((value, index) => {
              const detail = record(value);
              return {
                message: detail.message,
                isError: Boolean(detail.isError),
                sequence: index + 1,
                elapsedMs: null,
              };
            }),
          };
        }
        let localLimit: InvokeResponse['localLimit'] = null;
        if (end.localLimit !== null) {
          const limit = record(end.localLimit);
          if (
            !['response-count', 'response-bytes', 'duration'].includes(String(limit.reason)) ||
            limit.retainedResponses !== result.responses.length ||
            limit.maxResponses !== messageLimit ||
            limit.maxResponseBytes !== responseByteLimit
          )
            malformed('invalid local limit.');
          localLimit = {
            reason: limit.reason as NonNullable<InvokeResponse['localLimit']>['reason'],
            message: text(limit.message, 1024),
            retainedResponses: result.responses.length,
            retainedResponseBytes: number(limit.retainedResponseBytes, responseByteLimit),
            maxResponses: messageLimit,
            maxResponseBytes: responseByteLimit,
            maxDurationSeconds: number(limit.maxDurationSeconds, 60),
          };
        }
        const trailers = metadata(end.trailers);
        if (!end.finalStatusObserved && (error || trailers.length || timings.trailersMs !== null))
          malformed('unobserved final status contains terminal evidence.');
        if (end.finalStatusObserved && localLimit)
          malformed('local limit claims final server status.');
        const relayError =
          event.relayError === undefined ? undefined : text(event.relayError, 1024);
        result = {
          ...result,
          headers: result.headers, // Header frames remain authoritative; completion need not repeat them.
          trailers,
          requests: { total, sent },
          error,
          localLimit,
          finalStatusObserved: end.finalStatusObserved,
          ...(relayError ? { relayError } : {}),
          timings: {
            headersMs: nullableTime(timings.headersMs),
            firstMessageMs: nullableTime(timings.firstMessageMs),
            trailersMs: nullableTime(timings.trailersMs),
            totalMs,
          },
        };
        complete = true;
        break;
      }
      default:
        malformed('unknown frame type.');
    }
    onPartial(result);
  }

  try {
    checkAbort();
    while (true) {
      const { value, done } = await reader.read();
      checkAbort();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > streamByteLimit) malformed('stream exceeds its byte limit.');
      let start = 0;
      for (let index = 0; index < value.length; index++) {
        if ((index & 1023) === 0) checkAbort();
        if (value[index] !== 10) continue;
        const tail = value.subarray(start, index);
        const bytes = new Uint8Array(pendingBytes + tail.length);
        let offset = 0;
        for (const fragment of fragments) {
          bytes.set(fragment, offset);
          offset += fragment.length;
        }
        bytes.set(tail, offset);
        line(bytes);
        checkAbort();
        fragments = [];
        pendingBytes = 0;
        start = index + 1;
      }
      if (start < value.length) {
        const tail = value.slice(start);
        fragments.push(tail);
        pendingBytes += tail.length;
      }
      if (pendingBytes > lineByteLimit) malformed('line exceeds its byte limit.');
    }
    if (pendingBytes) malformed('truncated final line.');
    if (!complete) malformed('completion was not received; partial evidence remains available.');
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function invokeStream(
  url: string,
  csrf: string,
  payload: InvokeRequest,
  onPartial: (result: InvokeResponse) => void,
  signal?: AbortSignal
) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
      'x-protopeek-csrf-token': csrf,
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const { text: detail, truncated } = await readBoundedText(response, 2048);
    throw new Error(
      `RPC relay returned HTTP ${response.status}.${detail.trim() ? ` ${detail.trim()}${truncated ? '…' : ''}` : ''}`
    );
  }
  if (
    response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !==
      'application/x-ndjson' ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('RPC relay did not return an NDJSON stream.');
  }
  return parseInvokeStream(response.body, onPartial, signal);
}

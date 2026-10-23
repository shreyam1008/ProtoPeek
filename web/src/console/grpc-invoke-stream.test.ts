import { describe, expect, it, vi } from 'vitest';
import { invokeStream, parseInvokeStream } from './grpc-invoke-stream';

const encoder = new TextEncoder();
const started = { type: 'started', totalRequests: 1 };
const headers = { type: 'headers', elapsedMs: 0.9, headers: [{ name: 'test', value: 'observed' }] };
const message = (sequence = 1) => ({
  type: 'message',
  response: { sequence, elapsedMs: sequence, isError: false, message: { text: 'hello ✓' } },
});
const complete = () => ({
  type: 'complete',
  result: {
    finalStatusObserved: true,
    headers: headers.headers,
    responses: null,
    requests: { total: 1, sent: 1 },
    trailers: [{ name: 'last', value: 'observed' }],
    timings: { headersMs: 0.9, firstMessageMs: 1, trailersMs: 3, totalMs: 4 },
    error: null,
    localLimit: null,
  },
});
const encode = (...frames: unknown[]) =>
  encoder.encode(`${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`);
function stream(...frames: unknown[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(...frames));
      controller.close();
    },
  });
}

describe('incremental gRPC NDJSON', () => {
  it('delivers headers and a message before terminal response and retains exact evidence', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const updates = vi.fn();
    let settled = false;
    const pending = parseInvokeStream(body, updates).then((value) => {
      settled = true;
      return value;
    });
    controller.enqueue(encode(started, headers, message()));
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(3));
    expect(settled).toBe(false);
    expect(updates.mock.lastCall?.[0]).toMatchObject({
      finalStatusObserved: false,
      headers: headers.headers,
      responses: [{ sequence: 1, message: { text: 'hello ✓' } }],
      trailers: [],
    });
    controller.enqueue(encode(complete()));
    controller.close();
    expect(await pending).toMatchObject({
      finalStatusObserved: true,
      responses: [{ sequence: 1 }],
      trailers: [{ name: 'last', value: 'observed' }],
    });
  });

  it('accepts backend null completion headers while retaining authoritative header frames', async () => {
    const end = complete();
    const result = await parseInvokeStream(
      stream(started, headers, message(), { ...end, result: { ...end.result, headers: null } }),
      () => {}
    );
    expect(result.headers).toEqual(headers.headers);
    expect(result.responses).toHaveLength(1);
    expect(result.finalStatusObserved).toBe(true);
  });

  it('accepts backend null completion headers when conversion fails before headers or sends', async () => {
    const end = complete();
    const result = await parseInvokeStream(
      stream(started, {
        type: 'complete',
        relayError: 'Request message 1 could not be converted to protobuf.',
        result: {
          ...end.result,
          finalStatusObserved: false,
          headers: null,
          requests: { total: 1, sent: 0 },
          trailers: [],
          timings: { headersMs: null, firstMessageMs: null, trailersMs: null, totalMs: 0 },
        },
      }),
      () => {}
    );
    expect(result).toMatchObject({
      finalStatusObserved: false,
      headers: [],
      responses: [],
      trailers: [],
      requests: { total: 1, sent: 0 },
      error: null,
      relayError: expect.stringContaining('could not be converted'),
    });
  });

  it('handles split UTF-8, CRLF, and header/message submillisecond rounding', async () => {
    const bytes = encoder.encode(
      `${[started, { ...headers, elapsedMs: 1.9 }, message(), complete()]
        .map((frame) => JSON.stringify(frame))
        .join('\r\n')}\r\n`
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const result = await parseInvokeStream(body, () => {});
    expect(result.responses[0]?.message).toEqual({ text: 'hello ✓' });
  });

  it.each([
    ['missing start', [message(), complete()]],
    ['duplicate start', [started, started, complete()]],
    ['missing completion', [started, headers, message()]],
    ['message sequence', [started, headers, message(2), complete()]],
    ['late headers', [started, message(), headers, complete()]],
    ['after completion', [started, complete(), message()]],
    ['unknown frame', [started, { type: 'pretend-success' }]],
    [
      'invented server status',
      [started, { ...complete(), result: { ...complete().result, finalStatusObserved: false } }],
    ],
    [
      'request count mismatch',
      [
        started,
        { ...complete(), result: { ...complete().result, requests: { total: 2, sent: 1 } } },
      ],
    ],
  ])('rejects %s and keeps earlier callbacks available', async (_label, frames) => {
    await expect(parseInvokeStream(stream(...(frames as unknown[])), () => {})).rejects.toThrow(
      /Invalid gRPC response stream/
    );
  });

  it('rejects truncated lines, invalid UTF-8 and excessive retained messages', async () => {
    for (const bytes of [
      encoder.encode(' {"type":"started"'),
      Uint8Array.of(255, 10),
      encode(started, ...Array.from({ length: 513 }, (_, index) => message(index + 1))),
    ]) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      await expect(parseInvokeStream(body, () => {})).rejects.toThrow(
        /Invalid gRPC response stream/
      );
    }
  });

  it('rejects oversized wire input before parsing or retaining it', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array((9 << 20) + 1));
        controller.close();
      },
    });
    await expect(parseInvokeStream(body, () => {})).rejects.toThrow(/byte limit/);
  });

  it('cancels a pending read while keeping prior messages explicitly partial', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const updates = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        value.enqueue(encode(started, headers, message()));
      },
      cancel,
    });
    const pending = parseInvokeStream(body, updates, controller.signal);
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(3));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(updates.mock.lastCall?.[0]).toMatchObject({
      finalStatusObserved: false,
      responses: [{ sequence: 1 }],
      trailers: [],
    });
  });

  it('negotiates explicitly, sends CSRF, and rejects a buffered response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(encode(started, headers, message(), complete()), {
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    );
    try {
      const payload = { timeout_seconds: 15, metadata: [], data: [{}] };
      await invokeStream('http://localhost/invoke/demo.Watch', 'csrf-value', payload, () => {});
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost/invoke/demo.Watch',
        expect.objectContaining({
          credentials: 'same-origin',
          headers: expect.objectContaining({
            Accept: 'application/x-ndjson',
            'x-protopeek-csrf-token': 'csrf-value',
          }),
        })
      );
      fetchMock.mockResolvedValueOnce(
        new Response('{}', { headers: { 'Content-Type': 'application/json' } })
      );
      await expect(invokeStream('http://localhost', '', payload, () => {})).rejects.toThrow(
        /did not return an NDJSON/
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});

it('retains observed headers when completion omits redundant header metadata', async () => {
  const end = complete();
  end.result.headers = [];
  const result = await parseInvokeStream(stream(started, headers, message(), end), () => {});
  expect(result.headers).toEqual(headers.headers);
  expect(result.finalStatusObserved).toBe(true);
});

it('shows a bounded local request conversion failure without inventing final server status', async () => {
  const failure = {
    ...complete(),
    relayError: 'Request message 1 could not be converted to protobuf: expected a string.',
    result: {
      ...complete().result,
      finalStatusObserved: false,
      headers: [],
      responses: null,
      trailers: [],
      requests: { total: 1, sent: 0 },
      timings: { headersMs: null, firstMessageMs: null, trailersMs: null, totalMs: 1 },
    },
  };
  const result = await parseInvokeStream(stream(started, failure), () => {});
  expect(result).toMatchObject({
    finalStatusObserved: false,
    error: null,
    responses: [],
    requests: { total: 1, sent: 0 },
    relayError: failure.relayError,
  });
});

it('keeps bounded server rejection guidance and cancels excessive error output', async () => {
  const cancel = vi.fn();
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  const payload = { timeout_seconds: 1, metadata: [], data: [{}] };
  try {
    fetchMock.mockResolvedValueOnce(
      new Response('Streaming capacity is busy; retry shortly.', { status: 429 })
    );
    await expect(invokeStream('http://localhost', '', payload, () => {})).rejects.toThrow(
      'HTTP 429. Streaming capacity is busy; retry shortly.'
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('server reason '.repeat(1000)));
          },
          cancel,
        }),
        { status: 400 }
      )
    );
    const failure = await invokeStream('http://localhost', '', payload, () => {}).catch(
      (error: Error) => error
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('HTTP 400. server reason');
    expect((failure as Error).message.length).toBeLessThan(2100);
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    fetchMock.mockRestore();
  }
});

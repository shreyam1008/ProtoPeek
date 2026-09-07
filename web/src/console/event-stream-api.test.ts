import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectEventStream, parseStreamHeaders, sendStreamMessage } from './event-stream-api';

const request = {
  protocol: 'sse' as const,
  url: 'http://localhost/events',
  headers: [],
  subprotocols: [],
  timeoutMs: 1000,
};
afterEach(() => vi.unstubAllGlobals());

describe('event stream transport', () => {
  it('decodes split UTF-8 and multiple frames without losing empty messages', async () => {
    const bytes = new TextEncoder().encode(
      '{"kind":"open","elapsedMs":0}\n{"kind":"message","elapsedMs":1,"data":"🌍"}\n{"kind":"message","elapsedMs":2}\n'
    );
    const body = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
      );
    vi.stubGlobal('fetch', fetcher);
    document.cookie = '_protopeek_csrf_token=stream-token; path=/';
    const events = vi.fn();
    await connectEventStream(request, new AbortController().signal, events);
    expect(events.mock.calls.map(([event]) => event.data)).toEqual([undefined, '🌍', undefined]);
    expect(fetcher.mock.calls[0][1].headers['x-protopeek-csrf-token']).toBe('stream-token');
  });
  it('rejects invalid and oversized frames and cancels the stream', async () => {
    for (const text of [
      '{"kind":"oops","elapsedMs":0}\n',
      '{"kind":"message","elapsedMs":0,"data":{}}\n',
      'x'.repeat(513 * 1024),
    ]) {
      const cancel = vi.fn();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
        },
        cancel,
      });
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
          )
      );
      await expect(
        connectEventStream(request, new AbortController().signal, vi.fn())
      ).rejects.toThrow();
      expect(cancel).toHaveBeenCalled();
    }
  });
  it('reports a connection error and sends binary with its encoding', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('Invalid base64 message', { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      sendStreamMessage('session', '?', 'base64', new AbortController().signal)
    ).rejects.toThrow('Invalid base64');
    await sendStreamMessage('session', 'aGk=', 'base64', new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      sessionId: 'session',
      data: 'aGk=',
      encoding: 'base64',
    });
  });
  it('parses header values containing colons and rejects unnamed headers', () => {
    expect(parseStreamHeaders('Authorization: Bearer a:b\n\nX-Test: yes')).toEqual([
      { name: 'Authorization', value: 'Bearer a:b' },
      { name: 'X-Test', value: 'yes' },
    ]);
    expect(() => parseStreamHeaders(': bad')).toThrow('Name: value');
  });
});

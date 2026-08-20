import { describe, expect, it, vi } from 'vitest';

import {
  appendHealthTransition,
  type HealthTransitionState,
  hasCanonicalHealthDescriptor,
  healthTransitionRetention,
  healthWatchLineLimitBytes,
  healthWatchObservationLimit,
  parseHealthCheckResponse,
  parseHealthWatchEvent,
  parseHealthWatchNDJSON,
} from './health';

const encoder = new TextEncoder();

function byteStream(chunks: Uint8Array[], stayOpen = false) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (!stayOpen) controller.close();
    },
  });
}

function watchTranscript(service = '') {
  const startedAt = '2026-08-20T12:00:00.000Z';
  return [
    JSON.stringify({
      type: 'started',
      service,
      startedAt,
      observedOffsetMs: 0,
      durationSeconds: 60,
      metadataCount: 2,
    }),
    JSON.stringify({
      type: 'status-observed',
      service,
      startedAt,
      sequence: 1,
      observedOffsetMs: 4.5,
      servingStatus: { code: 1, name: 'SERVING' },
    }),
    JSON.stringify({
      type: 'ended',
      service,
      startedAt,
      observedOffsetMs: 12,
      reason: 'completed',
      observationCount: 1,
      grpcStatus: { code: 0, name: 'OK', message: '', messageTruncated: false },
      trailers: [],
      trailersTruncated: false,
    }),
  ].join('\n');
}

describe('Health Watch NDJSON parser', () => {
  it('parses fragmented and multiple events incrementally', async () => {
    const transcript = `${watchTranscript()}\n`;
    const bytes = encoder.encode(transcript);
    const events: unknown[] = [];

    await parseHealthWatchNDJSON(
      byteStream([bytes.slice(0, 11), bytes.slice(11, 73), bytes.slice(73)]),
      (event) => events.push(event)
    );

    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({
      type: 'status-observed',
      servingStatus: { code: 1, name: 'SERVING' },
    });
  });

  it('survives every byte split, including multibyte UTF-8 and newline boundaries', async () => {
    const bytes = encoder.encode(watchTranscript('café.Inventory'));
    for (let split = 1; split < bytes.length; split++) {
      const events: unknown[] = [];
      await parseHealthWatchNDJSON(
        byteStream([bytes.slice(0, split), bytes.slice(split)]),
        (event) => events.push(event)
      );
      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject({ service: 'café.Inventory' });
    }
  });

  it('accepts a complete terminal line without a final newline', async () => {
    const events: unknown[] = [];
    await parseHealthWatchNDJSON(byteStream([encoder.encode(watchTranscript())]), (event) =>
      events.push(event)
    );
    expect(events.at(-1)).toMatchObject({ type: 'ended', reason: 'completed' });
  });

  it('rejects malformed, truncated, non-terminal, and oversized streams', async () => {
    await expect(
      parseHealthWatchNDJSON(byteStream([encoder.encode('{"type":\n')]), () => undefined)
    ).rejects.toThrow(/invalid JSON|truncated/i);

    const utf8Line = encoder.encode(
      `${JSON.stringify({
        type: 'started',
        service: 'café.Inventory',
        startedAt: '2026-08-20T12:00:00.000Z',
        observedOffsetMs: 0,
        durationSeconds: 60,
        metadataCount: 0,
      })}\n`
    );
    const continuationIndex = utf8Line.indexOf(0xa9);
    const partialUTF8 = utf8Line.slice(0, continuationIndex);
    expect(utf8Line[continuationIndex - 1]).toBe(0xc3);
    await expect(
      parseHealthWatchNDJSON(byteStream([partialUTF8]), () => undefined)
    ).rejects.toThrow(/truncated|invalid/i);

    const withoutEnd = `${watchTranscript().split('\n').slice(0, 2).join('\n')}\n`;
    await expect(
      parseHealthWatchNDJSON(byteStream([encoder.encode(withoutEnd)]), () => undefined)
    ).rejects.toThrow(/without a terminal/i);

    const oversized = encoder.encode(
      `{"type":"started","padding":"${'x'.repeat(healthWatchLineLimitBytes)}"}\n`
    );
    await expect(parseHealthWatchNDJSON(byteStream([oversized]), () => undefined)).rejects.toThrow(
      /64 KiB/i
    );
  });

  it('cancels a pending stream after preserving already-delivered events', async () => {
    const controller = new AbortController();
    const started = `${watchTranscript().split('\n')[0]}\n`;
    const events: unknown[] = [];
    const parsing = parseHealthWatchNDJSON(
      byteStream([encoder.encode(started)], true),
      (event) => {
        events.push(event);
        controller.abort();
      },
      controller.signal
    );

    await expect(parsing).rejects.toMatchObject({ name: 'AbortError' });
    expect(events).toHaveLength(1);
  });

  it('rejects duplicate, out-of-order, noncanonical, and trailing frames', async () => {
    const [started, status, ended] = watchTranscript().split('\n');
    const headers = JSON.stringify({
      type: 'headers-observed',
      service: '',
      startedAt: '2026-08-20T12:00:00.000Z',
      observedOffsetMs: 2,
      headers: [],
      headersTruncated: false,
    });

    for (const invalidTranscript of [
      `${started}\n${started}\n${ended}\n`,
      `${started}\n${headers}\n${headers}\n${ended}\n`,
      `${started}\n${status}\n${headers}\n${ended}\n`,
      `${started}\n${ended}\n${status}\n`,
      `${started}\n${status.replace('"sequence":1', '"sequence":2')}\n${ended}\n`,
      `${started}\n${status.replace('"SERVING"', '"UNKNOWN"')}\n${ended}\n`,
      `${started}\n${status}\n${ended.replace('"observationCount":1', '"observationCount":0')}\n`,
    ]) {
      await expect(
        parseHealthWatchNDJSON(byteStream([encoder.encode(invalidTranscript)]), () => undefined)
      ).rejects.toThrow(/invalid grpc health evidence/i);
    }
  });

  it('cancels the response reader when protocol validation fails', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":}\n'));
      },
      cancel,
    });

    await expect(parseHealthWatchNDJSON(stream, () => undefined)).rejects.toThrow(/invalid JSON/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('validates finite offsets and bounded frozen attribution fields', () => {
    expect(() =>
      parseHealthWatchEvent({
        type: 'started',
        service: '',
        startedAt: '2026-08-20T12:00:00.000Z',
        observedOffsetMs: Number.POSITIVE_INFINITY,
        durationSeconds: 60,
        metadataCount: 0,
      })
    ).toThrow(/finite/i);
    expect(() =>
      parseHealthWatchEvent({
        type: 'started',
        service: 'x'.repeat(1025),
        startedAt: '2026-08-20T12:00:00.000Z',
        observedOffsetMs: 0,
        durationSeconds: 601,
        metadataCount: 65,
      })
    ).toThrow(/service.*1024-byte/i);
    expect(() =>
      parseHealthWatchEvent({
        type: 'status-observed',
        service: '',
        startedAt: '2026-08-20T12:00:00.000Z',
        observedOffsetMs: 1,
        sequence: healthWatchObservationLimit + 1,
        servingStatus: { code: 1, name: 'SERVING' },
      })
    ).toThrow(/sequence.*512/i);
    expect(() =>
      parseHealthWatchEvent({
        ...JSON.parse(watchTranscript().split('\n')[2]),
        observationCount: healthWatchObservationLimit + 1,
      })
    ).toThrow(/observationCount.*512/i);
  });

  it('keeps Check status and Watch terminal semantics internally consistent', () => {
    const check = {
      service: '',
      startedAt: '2026-08-20T12:00:00.000Z',
      handlerInvokeMs: 1,
      servingStatus: null,
      grpcStatus: {
        code: 5,
        name: 'NotFound',
        message: 'service not registered',
        messageTruncated: false,
      },
      headers: [],
      trailers: [],
      headersTruncated: false,
      trailersTruncated: false,
    };
    expect(parseHealthCheckResponse(check)).toMatchObject({
      servingStatus: null,
      grpcStatus: { name: 'NotFound' },
    });
    expect(() =>
      parseHealthCheckResponse({
        ...check,
        grpcStatus: { code: 0, name: 'OK', message: '', messageTruncated: false },
      })
    ).toThrow(/OK.*servingStatus/i);
    expect(() =>
      parseHealthCheckResponse({
        ...check,
        servingStatus: { code: 1, name: 'SERVING' },
      })
    ).toThrow(/non-OK.*servingStatus/i);
    expect(() =>
      parseHealthCheckResponse({
        ...check,
        servingStatus: { code: 3, name: 'SERVICE_UNKNOWN' },
        grpcStatus: { code: 0, name: 'OK', message: '', messageTruncated: false },
      })
    ).toThrow(/SERVICE_UNKNOWN.*Watch/i);

    const ended = JSON.parse(watchTranscript().split('\n')[2]);
    expect(() =>
      parseHealthWatchEvent({
        ...ended,
        reason: 'unsupported',
        grpcStatus: { code: 0, name: 'OK', message: '', messageTruncated: false },
      })
    ).toThrow(/unsupported.*Unimplemented/i);
    expect(
      parseHealthWatchEvent({
        ...ended,
        reason: 'unsupported',
        grpcStatus: {
          code: 12,
          name: 'Unimplemented',
          message: 'Watch is not implemented',
          messageTruncated: false,
        },
      })
    ).toMatchObject({ reason: 'unsupported', grpcStatus: { code: 12, name: 'Unimplemented' } });
    expect(() =>
      parseHealthWatchEvent({
        ...ended,
        reason: 'duration-limit',
        grpcStatus: {
          code: 0,
          name: 'OK',
          message: '',
          messageTruncated: false,
        },
      })
    ).toThrow(/duration-limit.*DeadlineExceeded/i);
    expect(
      parseHealthWatchEvent({
        ...ended,
        reason: 'rpc-error',
        grpcStatus: {
          code: 4,
          name: 'DeadlineExceeded',
          message: 'server deadline',
          messageTruncated: false,
        },
      })
    ).toMatchObject({ reason: 'rpc-error', grpcStatus: { name: 'DeadlineExceeded' } });
  });

  it('accepts only terminal reasons that agree with the final gRPC status', () => {
    const ended = JSON.parse(watchTranscript().split('\n')[2]);
    const status = (code: number, name: string) => ({
      code,
      name,
      message: '',
      messageTruncated: false,
    });

    for (const [reason, grpcStatus] of [
      ['completed', status(0, 'OK')],
      ['unsupported', status(12, 'Unimplemented')],
      ['duration-limit', status(4, 'DeadlineExceeded')],
      ['observation-limit', status(1, 'Canceled')],
      ['canceled', status(1, 'Canceled')],
      ['rpc-error', status(1, 'Canceled')],
      ['rpc-error', status(4, 'DeadlineExceeded')],
      ['rpc-error', status(14, 'Unavailable')],
    ] as const) {
      expect(parseHealthWatchEvent({ ...ended, reason, grpcStatus })).toMatchObject({
        reason,
        grpcStatus,
      });
    }

    for (const [reason, grpcStatus] of [
      ['completed', status(14, 'Unavailable')],
      ['unsupported', status(0, 'OK')],
      ['duration-limit', status(0, 'OK')],
      ['observation-limit', status(0, 'OK')],
      ['observation-limit', status(4, 'DeadlineExceeded')],
      ['canceled', status(0, 'OK')],
      ['canceled', status(4, 'DeadlineExceeded')],
      ['rpc-error', status(0, 'OK')],
      ['rpc-error', status(12, 'Unimplemented')],
    ] as const) {
      expect(() => parseHealthWatchEvent({ ...ended, reason, grpcStatus })).toThrow(
        /Invalid gRPC Health evidence/i
      );
    }
  });
});

describe('Health transition retention', () => {
  it('keeps only the latest 200 transitions and counts every dropped observation', () => {
    let state: HealthTransitionState = { transitions: [], droppedTransitions: 0 };
    for (let sequence = 1; sequence <= healthTransitionRetention + 7; sequence++) {
      state = appendHealthTransition(state, {
        type: 'status-observed',
        service: '',
        startedAt: '2026-08-20T12:00:00.000Z',
        sequence,
        observedOffsetMs: sequence,
        servingStatus: { code: sequence % 2, name: sequence % 2 ? 'SERVING' : 'UNKNOWN' },
      });
    }

    expect(state.transitions).toHaveLength(healthTransitionRetention);
    expect(state.transitions[0].sequence).toBe(8);
    expect(state.transitions.at(-1)?.sequence).toBe(healthTransitionRetention + 7);
    expect(state.droppedTransitions).toBe(7);
  });
});

describe('canonical Health descriptor detection', () => {
  const check = {
    name: 'Check',
    fullName: 'grpc.health.v1.Health/Check',
    description: '',
    clientStreaming: false,
    serverStreaming: false,
    requestType: 'grpc.health.v1.HealthCheckRequest',
    responseType: 'grpc.health.v1.HealthCheckResponse',
  };
  const watch = {
    ...check,
    name: 'Watch',
    fullName: 'grpc.health.v1.Health/Watch',
    serverStreaming: true,
  };

  it('requires the exact canonical Check and Watch shapes while allowing extra methods', () => {
    expect(
      hasCanonicalHealthDescriptor([
        {
          name: 'grpc.health.v1.Health',
          description: '',
          methods: [
            check,
            watch,
            { ...check, name: 'List', fullName: 'grpc.health.v1.Health/List' },
          ],
        },
      ])
    ).toBe(true);
    expect(
      hasCanonicalHealthDescriptor([
        {
          name: 'grpc.health.v1.Health',
          description: '',
          methods: [
            { ...check, fullName: 'grpc.health.v1.Health.Check' },
            { ...watch, fullName: 'grpc.health.v1.Health.Watch' },
          ],
        },
      ])
    ).toBe(true);
    expect(
      hasCanonicalHealthDescriptor([
        {
          name: 'grpc.health.v1.Health',
          description: '',
          methods: [check, { ...watch, clientStreaming: true }],
        },
      ])
    ).toBe(false);
    expect(
      hasCanonicalHealthDescriptor([
        {
          name: 'grpc.health.v1.Healthish',
          description: '',
          methods: [check, watch],
        },
      ])
    ).toBe(false);
  });
});

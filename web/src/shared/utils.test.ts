import { describe, expect, it } from 'vitest';

import {
  commandPreview,
  evaluateAssertions,
  generateRequestTemplate,
  matchesMethodFilter,
  percentile,
  safeParseJson,
  simulationSummary,
} from './utils';

describe('safeParseJson', () => {
  it('returns a parse error for invalid JSON', () => {
    const result = safeParseJson('{');
    expect(result.error).toBeTruthy();
    expect(result.value).toBeNull();
  });
});

describe('generateRequestTemplate', () => {
  it('creates nested payloads from schema metadata', () => {
    const schema = {
      requestType: 'demo.Request',
      requestStream: false,
      enumTypes: {
        'demo.Status': [{ num: 0, name: 'STATUS_UNKNOWN' }],
      },
      messageTypes: {
        'demo.Request': [
          {
            name: 'id',
            protoName: 'id',
            type: 'string',
            oneOfFields: [],
            isMessage: false,
            isEnum: false,
            isArray: false,
            isMap: false,
            isRequired: false,
            defaultVal: null,
            description: '',
          },
          {
            name: 'child',
            protoName: 'child',
            type: 'demo.Child',
            oneOfFields: [],
            isMessage: true,
            isEnum: false,
            isArray: false,
            isMap: false,
            isRequired: false,
            defaultVal: null,
            description: '',
          },
        ],
        'demo.Child': [
          {
            name: 'status',
            protoName: 'status',
            type: 'demo.Status',
            oneOfFields: [],
            isMessage: false,
            isEnum: true,
            isArray: false,
            isMap: false,
            isRequired: false,
            defaultVal: null,
            description: '',
          },
        ],
      },
    };

    expect(generateRequestTemplate(schema)).toEqual({
      child: {
        status: 'STATUS_UNKNOWN',
      },
      id: '',
    });
  });
});

describe('percentile', () => {
  it('returns the correct percentile for a sorted window', () => {
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
  });
});

describe('simulationSummary', () => {
  it('computes throughput and tail latencies', () => {
    const summary = simulationSummary(
      'demo.Service.Echo',
      { runs: 5, concurrency: 2, thinkTimeMs: 0 },
      [10, 20, 30, 40, 50],
      5,
      0,
      100
    );

    expect(summary.p95).toBe(50);
    expect(summary.successCount).toBe(5);
    expect(summary.throughputRps).toBe(50);
  });
});

describe('commandPreview', () => {
  it('builds a grpcurl command preview', () => {
    expect(
      commandPreview({
        target: 'localhost:50051',
        method: 'demo.Service.Echo',
        metadata: [{ name: 'authorization', value: 'Bearer token' }],
        timeoutSeconds: 5,
        requestText: '{"id":"123"}',
        grpcurlOptions: '-plaintext',
      })
    ).toContain('grpcurl -plaintext -max-time 5');
  });
});

describe('matchesMethodFilter', () => {
  const bidiMethod = {
    name: 'Watch',
    fullName: 'demo.Service.Watch',
    description: '',
    clientStreaming: true,
    serverStreaming: true,
    requestType: 'demo.Request',
    responseType: 'demo.Response',
  };

  it('matches bidirectional streams correctly', () => {
    expect(matchesMethodFilter(bidiMethod, 'bidirectional')).toBe(true);
    expect(matchesMethodFilter(bidiMethod, 'unary')).toBe(false);
  });
});

describe('evaluateAssertions', () => {
  it('checks status, latency, and payload assertions', () => {
    const assertions = evaluateAssertions({
      rules: [
        {
          id: '1',
          name: 'Status OK',
          kind: 'status',
          comparator: 'equals',
          target: '',
          value: 'OK',
        },
        {
          id: '2',
          name: 'Latency under 250 ms',
          kind: 'latency_ms',
          comparator: 'lte',
          target: '',
          value: '250',
        },
        {
          id: '3',
          name: 'Payload mentions pong',
          kind: 'body_text',
          comparator: 'contains',
          target: '',
          value: 'pong',
        },
      ],
      latencyMs: 120,
      result: {
        headers: [{ name: 'content-type', value: 'application/grpc' }],
        error: null,
        responses: [{ isError: false, message: { text: 'pong' } }],
        requests: null,
        trailers: [],
      },
    });

    expect(assertions.every((item) => item.passed)).toBe(true);
  });
});

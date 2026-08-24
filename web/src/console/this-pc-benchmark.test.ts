import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const speedtestMock = vi.hoisted(() => {
  const instances: FakeSpeedTest[] = [];

  class FakeSpeedTest {
    config: unknown;
    pause = vi.fn();
    play = vi.fn(() => this.onRunningChange(true));
    onRunningChange = (_running: boolean) => {};
    onResultsChange = (_payload: { type: 'download' }) => {};
    onFinish: (results: FakeSpeedTest['results']) => void = () => {};
    onError: (message: string) => void = () => {};
    summary: Record<string, number> = {};
    results = { getSummary: () => this.summary };

    constructor(config: unknown) {
      this.config = config;
      instances.push(this);
    }
  }

  return { FakeSpeedTest, instances };
});

vi.mock('@cloudflare/speedtest', () => ({ default: speedtestMock.FakeSpeedTest }));

import {
  assertThisPCBenchmarkPayloadLimit,
  createThisPCBenchmarkConfig,
  startThisPCBenchmark,
  thisPCBenchmarkHardPayloadLimitBytes,
  thisPCBenchmarkMeasurements,
  thisPCBenchmarkPayloadBytes,
  thisPCBenchmarkProfiles,
} from './this-pc-benchmark';

beforeEach(() => {
  speedtestMock.instances.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('This PC benchmark plans', () => {
  it.each([
    ['quick', false, 7_200_000],
    ['quick', true, 8_300_000],
    ['standard', false, 47_000_000],
    ['standard', true, 59_000_000],
  ] as const)('bounds the %s profile with upload=%s at %i bytes', (profile, upload, expected) => {
    const measurements = thisPCBenchmarkMeasurements(profile, upload);
    const config = createThisPCBenchmarkConfig(profile, upload);

    expect(thisPCBenchmarkPayloadBytes(profile, upload)).toBe(expected);
    expect(expected).toBeLessThanOrEqual(thisPCBenchmarkHardPayloadLimitBytes);
    expect(measurements.some((measurement) => measurement.type === 'packetLoss')).toBe(false);
    expect(measurements.some((measurement) => measurement.type === 'upload')).toBe(upload);
    expect(config).toMatchObject({
      autoStart: false,
      downloadApiUrl: 'https://speed.cloudflare.com/__down',
      uploadApiUrl: 'https://speed.cloudflare.com/__up',
      includeCredentials: false,
      logMeasurementApiUrl: null,
      logAimApiUrl: null,
      measureUploadLoadedLatency: upload,
    });
  });

  it('hard rejects any planned payload above 64,000,000 bytes', () => {
    expect(() => assertThisPCBenchmarkPayloadLimit(64_000_000)).not.toThrow();
    expect(() => assertThisPCBenchmarkPayloadLimit(64_000_001)).toThrow(/64,000,000-byte/i);
    expect(() => assertThisPCBenchmarkPayloadLimit(Number.NaN)).toThrow(/64,000,000-byte/i);
  });

  it('keeps the reviewed profile wall and largest-item limits explicit', () => {
    expect(thisPCBenchmarkProfiles.quick).toMatchObject({
      wallLimitMs: 20_000,
      largestItemBytes: 5_000_000,
      latencyPackets: 5,
    });
    expect(thisPCBenchmarkProfiles.standard).toMatchObject({
      wallLimitMs: 45_000,
      largestItemBytes: 25_000_000,
      latencyPackets: 10,
    });
  });
});

describe('This PC benchmark lifecycle', () => {
  it('treats a measurement error as a warning and still permits progress and finish', async () => {
    const events: string[] = [];
    await startThisPCBenchmark('quick', false, {
      onRunningChange: () => events.push('running'),
      onProgress: () => events.push('progress'),
      onFinish: () => events.push('finish'),
      onError: () => events.push('warning'),
      onWallLimit: () => events.push('wall'),
    });
    const instance = speedtestMock.instances[0];
    if (!instance) throw new Error('Fake speed test was not created.');

    instance.onError('one request failed');
    instance.summary = { download: 12_000_000 };
    instance.onResultsChange({ type: 'download' });
    instance.onFinish(instance.results);

    expect(events).toEqual(['running', 'warning', 'progress', 'finish']);
  });

  it('suppresses late progress, errors, and finish after a user stop', async () => {
    const events: string[] = [];
    const control = await startThisPCBenchmark('quick', false, {
      onRunningChange: () => events.push('running'),
      onProgress: () => events.push('progress'),
      onFinish: () => events.push('finish'),
      onError: () => events.push('warning'),
      onWallLimit: () => events.push('wall'),
    });
    const instance = speedtestMock.instances[0];
    if (!instance) throw new Error('Fake speed test was not created.');

    control.pause();
    instance.onError('late');
    instance.onResultsChange({ type: 'download' });
    instance.onFinish(instance.results);

    expect(instance.pause).toHaveBeenCalledOnce();
    expect(events).toEqual(['running']);
  });

  it('pauses once at the profile wall and suppresses callbacks that arrive afterward', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    await startThisPCBenchmark('quick', false, {
      onRunningChange: () => events.push('running'),
      onProgress: () => events.push('progress'),
      onFinish: () => events.push('finish'),
      onError: () => events.push('warning'),
      onWallLimit: () => events.push('wall'),
    });
    const instance = speedtestMock.instances[0];
    if (!instance) throw new Error('Fake speed test was not created.');

    vi.advanceTimersByTime(20_000);
    instance.onError('late');
    instance.onResultsChange({ type: 'download' });
    instance.onFinish(instance.results);

    expect(instance.pause).toHaveBeenCalledOnce();
    expect(events).toEqual(['running', 'wall']);
  });

  it('honors an abort before or after the lazy engine import without late callbacks', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      startThisPCBenchmark('quick', false, {
        signal: controller.signal,
        onRunningChange: vi.fn(),
        onProgress: vi.fn(),
        onFinish: vi.fn(),
        onError: vi.fn(),
        onWallLimit: vi.fn(),
      })
    ).rejects.toMatchObject({ name: 'AbortError' });

    const events: string[] = [];
    const liveController = new AbortController();
    await startThisPCBenchmark('quick', false, {
      signal: liveController.signal,
      onRunningChange: () => events.push('running'),
      onProgress: () => events.push('progress'),
      onFinish: () => events.push('finish'),
      onError: () => events.push('warning'),
      onWallLimit: () => events.push('wall'),
    });
    const instance = speedtestMock.instances.at(-1);
    if (!instance) throw new Error('Fake speed test was not created.');
    liveController.abort();
    instance.onResultsChange({ type: 'download' });
    instance.onFinish(instance.results);

    expect(events).toEqual(['running']);
  });
});

import type {
  ConfigOptions,
  MeasurementConfig,
  MeasurementSummary,
  MeasurementType,
} from '@cloudflare/speedtest';

export type ThisPCBenchmarkProfileID = 'quick' | 'standard';

export const thisPCBenchmarkRequestLimitMs = 5_000;
export const thisPCBenchmarkHardPayloadLimitBytes = 64_000_000;

export const thisPCBenchmarkProfiles = {
  quick: {
    id: 'quick',
    label: 'Quick',
    latencyPackets: 5,
    wallLimitMs: 20_000,
    largestItemBytes: 5_000_000,
    confidence:
      'Low-confidence warning: a 5 MB largest sample can finish too quickly on fast paths.',
    download: [
      { type: 'download', bytes: 100_000, count: 2, bypassMinDuration: true },
      { type: 'download', bytes: 1_000_000, count: 2 },
      { type: 'download', bytes: 5_000_000, count: 1 },
    ],
    upload: [
      { type: 'upload', bytes: 100_000, count: 1, bypassMinDuration: true },
      { type: 'upload', bytes: 1_000_000, count: 1 },
    ],
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    latencyPackets: 10,
    wallLimitMs: 45_000,
    largestItemBytes: 25_000_000,
    confidence:
      'A larger sample improves confidence, but this remains a single-flow path sample rather than line speed.',
    download: [
      { type: 'download', bytes: 1_000_000, count: 2, bypassMinDuration: true },
      { type: 'download', bytes: 10_000_000, count: 2 },
      { type: 'download', bytes: 25_000_000, count: 1 },
    ],
    upload: [
      { type: 'upload', bytes: 1_000_000, count: 2, bypassMinDuration: true },
      { type: 'upload', bytes: 5_000_000, count: 2 },
    ],
  },
} as const satisfies Record<
  ThisPCBenchmarkProfileID,
  {
    id: ThisPCBenchmarkProfileID;
    label: string;
    latencyPackets: number;
    wallLimitMs: number;
    largestItemBytes: number;
    confidence: string;
    download: readonly MeasurementConfig[];
    upload: readonly MeasurementConfig[];
  }
>;

export type ThisPCBenchmarkSummary = {
  download?: number;
  upload?: number;
  latency?: number;
  jitter?: number;
  downLoadedLatency?: number;
  downLoadedJitter?: number;
  upLoadedLatency?: number;
  upLoadedJitter?: number;
  totalDurationMs?: number;
};

export type ThisPCBenchmarkControl = {
  pause: () => void;
};

export function thisPCBenchmarkMeasurements(
  profileID: ThisPCBenchmarkProfileID,
  uploadEnabled: boolean
): MeasurementConfig[] {
  const profile = thisPCBenchmarkProfiles[profileID];
  return [
    { type: 'latency', numPackets: profile.latencyPackets },
    ...profile.download,
    ...(uploadEnabled ? profile.upload : []),
  ];
}

export function thisPCBenchmarkPayloadBytes(
  profileID: ThisPCBenchmarkProfileID,
  uploadEnabled: boolean
) {
  return thisPCBenchmarkMeasurements(profileID, uploadEnabled).reduce((total, measurement) => {
    if (measurement.type !== 'download' && measurement.type !== 'upload') return total;
    return total + measurement.bytes * measurement.count;
  }, 0);
}

export function assertThisPCBenchmarkPayloadLimit(payloadBytes: number) {
  if (
    !Number.isSafeInteger(payloadBytes) ||
    payloadBytes < 0 ||
    payloadBytes > thisPCBenchmarkHardPayloadLimitBytes
  ) {
    throw new Error('This PC benchmark plan exceeds the 64,000,000-byte hard limit.');
  }
}

export function createThisPCBenchmarkConfig(
  profileID: ThisPCBenchmarkProfileID,
  uploadEnabled: boolean
): ConfigOptions {
  const payloadBytes = thisPCBenchmarkPayloadBytes(profileID, uploadEnabled);
  assertThisPCBenchmarkPayloadLimit(payloadBytes);
  return {
    autoStart: false,
    downloadApiUrl: 'https://speed.cloudflare.com/__down',
    uploadApiUrl: 'https://speed.cloudflare.com/__up',
    includeCredentials: false,
    measurements: thisPCBenchmarkMeasurements(profileID, uploadEnabled),
    measureDownloadLoadedLatency: true,
    measureUploadLoadedLatency: uploadEnabled,
    loadedLatencyThrottle: 500,
    bandwidthFinishRequestDuration: 1500,
    bandwidthAbortRequestDuration: thisPCBenchmarkRequestLimitMs,
    logMeasurementApiUrl: null,
    logAimApiUrl: null,
  };
}

function finiteMetric(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function normalizeThisPCBenchmarkSummary(input: MeasurementSummary): ThisPCBenchmarkSummary {
  const summary = {
    download: finiteMetric(input.download),
    upload: finiteMetric(input.upload),
    latency: finiteMetric(input.latency),
    jitter: finiteMetric(input.jitter),
    downLoadedLatency: finiteMetric(input.downLoadedLatency),
    downLoadedJitter: finiteMetric(input.downLoadedJitter),
    upLoadedLatency: finiteMetric(input.upLoadedLatency),
    upLoadedJitter: finiteMetric(input.upLoadedJitter),
    totalDurationMs: finiteMetric(input.totalDurationMs),
  };
  return Object.fromEntries(
    Object.entries(summary).filter((entry): entry is [string, number] => entry[1] !== undefined)
  ) as ThisPCBenchmarkSummary;
}

export async function startThisPCBenchmark(
  profileID: ThisPCBenchmarkProfileID,
  uploadEnabled: boolean,
  callbacks: {
    signal?: AbortSignal;
    onRunningChange: (running: boolean) => void;
    onProgress: (summary: ThisPCBenchmarkSummary, phase: MeasurementType) => void;
    onFinish: (summary: ThisPCBenchmarkSummary) => void;
    onError: (message: string) => void;
    onWallLimit: (summary: ThisPCBenchmarkSummary) => void;
  }
): Promise<ThisPCBenchmarkControl> {
  const config = createThisPCBenchmarkConfig(profileID, uploadEnabled);
  const { default: SpeedTest } = await import('@cloudflare/speedtest');
  if (callbacks.signal?.aborted) {
    throw new DOMException('Benchmark start cancelled.', 'AbortError');
  }
  const engine = new SpeedTest(config);
  let stopped = false;
  let finished = false;
  const summary = () => normalizeThisPCBenchmarkSummary(engine.results.getSummary());
  const detachAbort = () => callbacks.signal?.removeEventListener('abort', stopSilently);
  const stopSilently = () => {
    if (finished || stopped) return;
    stopped = true;
    window.clearTimeout(wallTimer);
    engine.pause();
    detachAbort();
  };
  const wallTimer = window.setTimeout(() => {
    if (finished || stopped) return;
    stopped = true;
    engine.pause();
    detachAbort();
    callbacks.onWallLimit(summary());
  }, thisPCBenchmarkProfiles[profileID].wallLimitMs);
  callbacks.signal?.addEventListener('abort', stopSilently, { once: true });

  engine.onRunningChange = (running) => {
    if (!stopped) callbacks.onRunningChange(running);
  };
  engine.onResultsChange = ({ type }) => {
    if (!stopped) callbacks.onProgress(summary(), type);
  };
  engine.onError = (message) => {
    if (!stopped) callbacks.onError(String(message).slice(0, 2048));
  };
  engine.onFinish = (results) => {
    finished = true;
    window.clearTimeout(wallTimer);
    detachAbort();
    if (stopped) return;
    callbacks.onFinish(normalizeThisPCBenchmarkSummary(results.getSummary()));
  };
  engine.play();

  return {
    pause() {
      stopSilently();
    },
  };
}

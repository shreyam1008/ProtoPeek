import type {
  BootstrapService,
  HealthCheckResponse,
  HealthGRPCStatus,
  HealthServingStatus,
  HealthWatchEndedEvent,
  HealthWatchEndReason,
  HealthWatchEvent,
  HealthWatchHeadersEvent,
  HealthWatchStartedEvent,
  HealthWatchStatusEvent,
  MetadataEntry,
} from '@/shared/types';

export function hasCanonicalHealthDescriptor(services: BootstrapService[]) {
  const health = services.find((service) => service.name === 'grpc.health.v1.Health');
  if (!health) return false;
  const canonicalMethod = (name: 'Check' | 'Watch') =>
    health.methods.find(
      (method) =>
        method.name === name &&
        method.requestType === 'grpc.health.v1.HealthCheckRequest' &&
        method.responseType === 'grpc.health.v1.HealthCheckResponse'
    );
  const check = canonicalMethod('Check');
  const watch = canonicalMethod('Watch');
  return Boolean(
    check &&
      !check.clientStreaming &&
      !check.serverStreaming &&
      watch &&
      !watch.clientStreaming &&
      watch.serverStreaming
  );
}

export const healthWatchLineLimitBytes = 64 * 1024;
export const healthTransitionRetention = 200;
export const healthWatchObservationLimit = 512;

export type HealthTransitionState = {
  transitions: HealthWatchStatusEvent[];
  droppedTransitions: number;
};

export type HealthRunEndReason =
  | 'check-completed'
  | HealthWatchEndReason
  | 'user-cancelled'
  | 'navigation'
  | 'context-changed'
  | 'relay-error'
  | 'protocol-error';

export type HealthRun = HealthTransitionState & {
  operation: 'check' | 'watch';
  phase: 'running' | 'ended';
  contextKey: string;
  target: string;
  service: string;
  startedAt: string;
  metadataCount: number;
  checkDeadlineSeconds: number | null;
  watchDurationSeconds: number | null;
  handlerInvokeMs: number | null;
  latestStatus: HealthServingStatus | null;
  headers: MetadataEntry[];
  trailers: MetadataEntry[];
  headersTruncated: boolean;
  trailersTruncated: boolean;
  grpcStatus: HealthGRPCStatus | null;
  endReason: HealthRunEndReason | null;
  observationCount: number;
  error: string;
};

export function applyHealthCheckResult(run: HealthRun, response: HealthCheckResponse): HealthRun {
  if (run.operation !== 'check' || run.service !== response.service) {
    throw protocolError('Health Check response attribution does not match the active run.');
  }
  return {
    ...run,
    phase: 'ended',
    startedAt: response.startedAt,
    handlerInvokeMs: response.handlerInvokeMs,
    latestStatus: response.servingStatus,
    headers: response.headers,
    trailers: response.trailers,
    headersTruncated: response.headersTruncated,
    trailersTruncated: response.trailersTruncated,
    grpcStatus: response.grpcStatus,
    endReason: 'check-completed',
    observationCount: response.servingStatus ? 1 : 0,
    error: '',
  };
}

export function applyHealthWatchEvent(run: HealthRun, event: HealthWatchEvent): HealthRun {
  if (run.operation !== 'watch' || run.service !== event.service) {
    throw protocolError('Health Watch event attribution does not match the active run.');
  }
  switch (event.type) {
    case 'started':
      if (
        run.watchDurationSeconds !== event.durationSeconds ||
        run.metadataCount !== event.metadataCount
      ) {
        throw protocolError('Health Watch frozen configuration changed at the relay boundary.');
      }
      return { ...run, startedAt: event.startedAt };
    case 'headers-observed':
      return {
        ...run,
        headers: event.headers,
        headersTruncated: event.headersTruncated,
      };
    case 'status-observed': {
      const retained = appendHealthTransition(run, event);
      return {
        ...run,
        ...retained,
        latestStatus: event.servingStatus,
        observationCount: event.sequence,
      };
    }
    case 'ended':
      return {
        ...run,
        phase: 'ended',
        trailers: event.trailers,
        trailersTruncated: event.trailersTruncated,
        grpcStatus: event.grpcStatus,
        endReason: event.reason,
        observationCount: event.observationCount,
      };
  }
}

export function finishHealthRun(
  run: HealthRun,
  reason: Extract<
    HealthRunEndReason,
    'user-cancelled' | 'navigation' | 'context-changed' | 'relay-error' | 'protocol-error'
  >,
  error = ''
): HealthRun {
  return { ...run, phase: 'ended', endReason: reason, error };
}

function protocolError(message: string) {
  return new Error(`Invalid gRPC Health evidence: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw protocolError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, label: string) {
  if (typeof value !== 'string') throw protocolError(`${label} must be a string.`);
  return value;
}

function boundedString(value: unknown, label: string, maxBytes: number) {
  const result = stringField(value, label);
  if (new TextEncoder().encode(result).byteLength > maxBytes) {
    throw protocolError(`${label} exceeds its ${maxBytes}-byte limit.`);
  }
  return result;
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw protocolError(`${label} must be a finite number.`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, label: string) {
  const number = finiteNumber(value, label);
  if (number < 0) throw protocolError(`${label} must not be negative.`);
  return number;
}

function nonNegativeInteger(value: unknown, label: string) {
  const number = nonNegativeNumber(value, label);
  if (!Number.isInteger(number)) throw protocolError(`${label} must be an integer.`);
  return number;
}

function booleanField(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw protocolError(`${label} must be a boolean.`);
  return value;
}

function metadata(value: unknown, label: string): MetadataEntry[] {
  if (!Array.isArray(value)) throw protocolError(`${label} must be an array.`);
  if (value.length > 2048) throw protocolError(`${label} has too many entries.`);
  let aggregateBytes = 0;
  const result = value.map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    const parsed = {
      name: boundedString(item.name, `${label}[${index}].name`, 256),
      value: boundedString(item.value, `${label}[${index}].value`, 32 * 1024),
    };
    aggregateBytes += new TextEncoder().encode(parsed.name).byteLength;
    aggregateBytes += new TextEncoder().encode(parsed.value).byteLength;
    return parsed;
  });
  if (aggregateBytes > 32 * 1024) {
    throw protocolError(`${label} exceeds its 32 KiB aggregate limit.`);
  }
  return result;
}

const servingStatusNames = ['UNKNOWN', 'SERVING', 'NOT_SERVING', 'SERVICE_UNKNOWN'] as const;

function servingStatus(value: unknown): HealthServingStatus {
  const status = record(value, 'servingStatus');
  const code = nonNegativeInteger(status.code, 'servingStatus.code');
  const name = boundedString(status.name, 'servingStatus.name', 32);
  if (code >= servingStatusNames.length || name !== servingStatusNames[code]) {
    throw protocolError('servingStatus code and name are not a canonical health status.');
  }
  return { code, name };
}

const grpcStatusNames = [
  'OK',
  'Canceled',
  'Unknown',
  'InvalidArgument',
  'DeadlineExceeded',
  'NotFound',
  'AlreadyExists',
  'PermissionDenied',
  'ResourceExhausted',
  'FailedPrecondition',
  'Aborted',
  'OutOfRange',
  'Unimplemented',
  'Internal',
  'Unavailable',
  'DataLoss',
  'Unauthenticated',
] as const;

function grpcStatus(value: unknown): HealthGRPCStatus {
  const status = record(value, 'grpcStatus');
  const code = nonNegativeInteger(status.code, 'grpcStatus.code');
  const name = boundedString(status.name, 'grpcStatus.name', 32);
  if (code >= grpcStatusNames.length || name !== grpcStatusNames[code]) {
    throw protocolError('grpcStatus code and name are not canonical.');
  }
  return {
    code,
    name,
    message: boundedString(status.message, 'grpcStatus.message', 2 * 1024),
    messageTruncated: booleanField(status.messageTruncated, 'grpcStatus.messageTruncated'),
  };
}

export function parseHealthCheckResponse(value: unknown): HealthCheckResponse {
  const response = record(value, 'Health Check response');
  const startedAt = boundedString(response.startedAt, 'startedAt', 128);
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) {
    throw protocolError('startedAt must be an RFC 3339 timestamp.');
  }
  const parsedServingStatus =
    response.servingStatus === null ? null : servingStatus(response.servingStatus);
  const parsedGRPCStatus = grpcStatus(response.grpcStatus);
  if (parsedGRPCStatus.code === 0) {
    if (!parsedServingStatus) {
      throw protocolError('an OK Health Check must include servingStatus.');
    }
    if (parsedServingStatus.code === 3) {
      throw protocolError('SERVICE_UNKNOWN is a Watch status, not a valid Check response.');
    }
  } else if (parsedServingStatus) {
    throw protocolError('a non-OK Health Check must not include servingStatus.');
  }
  return {
    service: boundedString(response.service, 'service', 1024),
    startedAt,
    handlerInvokeMs: nonNegativeNumber(response.handlerInvokeMs, 'handlerInvokeMs'),
    servingStatus: parsedServingStatus,
    grpcStatus: parsedGRPCStatus,
    headers: metadata(response.headers, 'headers'),
    trailers: metadata(response.trailers, 'trailers'),
    headersTruncated: booleanField(response.headersTruncated, 'headersTruncated'),
    trailersTruncated: booleanField(response.trailersTruncated, 'trailersTruncated'),
  };
}

function commonFields(value: Record<string, unknown>) {
  const startedAt = boundedString(value.startedAt, 'startedAt', 128);
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) {
    throw protocolError('startedAt must be an RFC 3339 timestamp.');
  }
  return {
    service: boundedString(value.service, 'service', 1024),
    startedAt,
    observedOffsetMs: nonNegativeNumber(value.observedOffsetMs, 'observedOffsetMs'),
  };
}

const healthWatchEndReasons = new Set([
  'completed',
  'rpc-error',
  'unsupported',
  'duration-limit',
  'observation-limit',
  'canceled',
]);

export function parseHealthWatchEvent(value: unknown): HealthWatchEvent {
  const event = record(value, 'event');
  const type = stringField(event.type, 'type');
  const common = commonFields(event);
  switch (type) {
    case 'started':
      return {
        type,
        ...common,
        durationSeconds: (() => {
          const duration = finiteNumber(event.durationSeconds, 'durationSeconds');
          if (duration < 1 || duration > 600) {
            throw protocolError('durationSeconds must be between 1 and 600.');
          }
          return duration;
        })(),
        metadataCount: (() => {
          const count = nonNegativeInteger(event.metadataCount, 'metadataCount');
          if (count > 64) throw protocolError('metadataCount must not exceed 64.');
          return count;
        })(),
      } satisfies HealthWatchStartedEvent;
    case 'headers-observed':
      return {
        type,
        ...common,
        headers: metadata(event.headers, 'headers'),
        headersTruncated: booleanField(event.headersTruncated, 'headersTruncated'),
      } satisfies HealthWatchHeadersEvent;
    case 'status-observed':
      if (nonNegativeInteger(event.sequence, 'sequence') > healthWatchObservationLimit) {
        throw protocolError(`sequence must not exceed ${healthWatchObservationLimit}.`);
      }
      return {
        type,
        ...common,
        sequence: event.sequence as number,
        servingStatus: servingStatus(event.servingStatus),
      } satisfies HealthWatchStatusEvent;
    case 'ended': {
      const reason = stringField(event.reason, 'reason');
      if (!healthWatchEndReasons.has(reason)) {
        throw protocolError(`unknown end reason ${JSON.stringify(reason)}.`);
      }
      const parsedGRPCStatus = grpcStatus(event.grpcStatus);
      switch (reason) {
        case 'completed':
          if (parsedGRPCStatus.code !== 0) {
            throw protocolError('completed must correspond to gRPC OK.');
          }
          break;
        case 'unsupported':
          if (parsedGRPCStatus.code !== 12) {
            throw protocolError('unsupported must correspond to gRPC Unimplemented.');
          }
          break;
        case 'duration-limit':
          if (parsedGRPCStatus.code !== 4) {
            throw protocolError('duration-limit must correspond to gRPC DeadlineExceeded.');
          }
          break;
        case 'observation-limit':
        case 'canceled':
          if (parsedGRPCStatus.code !== 1) {
            throw protocolError(`${reason} must correspond to gRPC Canceled.`);
          }
          break;
        case 'rpc-error':
          if (parsedGRPCStatus.code === 0 || parsedGRPCStatus.code === 12) {
            throw protocolError('rpc-error must be non-OK and not gRPC Unimplemented.');
          }
          break;
      }
      const observationCount = nonNegativeInteger(event.observationCount, 'observationCount');
      if (observationCount > healthWatchObservationLimit) {
        throw protocolError(`observationCount must not exceed ${healthWatchObservationLimit}.`);
      }
      return {
        type,
        ...common,
        reason: reason as HealthWatchEndedEvent['reason'],
        observationCount,
        grpcStatus: parsedGRPCStatus,
        trailers: metadata(event.trailers, 'trailers'),
        trailersTruncated: booleanField(event.trailersTruncated, 'trailersTruncated'),
      } satisfies HealthWatchEndedEvent;
    }
    default:
      throw protocolError(`unknown event type ${JSON.stringify(type)}.`);
  }
}

function abortError() {
  return new DOMException('Health Watch was cancelled.', 'AbortError');
}

/**
 * Parses a bounded NDJSON Health Watch response and emits only structurally valid events.
 * A successful return requires exactly one terminal `ended` event.
 */
export async function parseHealthWatchNDJSON(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: HealthWatchEvent) => void,
  signal?: AbortSignal
) {
  if (signal?.aborted) throw abortError();

  const reader = stream.getReader();
  const line: number[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let started: HealthWatchStartedEvent | null = null;
  let ended = false;
  let lastSequence = 0;
  let lastOffset = 0;
  let headersSeen = false;

  const onAbort = () => {
    void reader.cancel(abortError()).catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const emitLine = () => {
    if (line.at(-1) === 13) line.pop();
    if (line.length === 0) return;

    let text: string;
    try {
      text = decoder.decode(Uint8Array.from(line));
    } catch {
      throw protocolError('truncated or invalid UTF-8 in an NDJSON line.');
    } finally {
      line.length = 0;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw protocolError('invalid JSON or a truncated NDJSON line.');
    }
    const event = parseHealthWatchEvent(decoded);
    if (ended) throw protocolError('received a frame after the terminal ended event.');
    if (!started) {
      if (event.type !== 'started') throw protocolError('first event must be started.');
      started = event;
    } else {
      if (event.type === 'started') throw protocolError('received duplicate started event.');
      if (event.service !== started.service || event.startedAt !== started.startedAt) {
        throw protocolError('event attribution changed during the stream.');
      }
      if (event.observedOffsetMs < lastOffset) {
        throw protocolError('observed offsets must not move backwards.');
      }
    }
    if (event.type === 'status-observed') {
      if (event.sequence !== lastSequence + 1) {
        throw protocolError('status sequence must increase contiguously from 1.');
      }
      lastSequence = event.sequence;
    }
    if (event.type === 'headers-observed') {
      if (headersSeen) throw protocolError('received duplicate headers event.');
      if (lastSequence > 0) throw protocolError('headers arrived after a status event.');
      headersSeen = true;
    }
    if (event.type === 'ended' && event.observationCount !== lastSequence) {
      throw protocolError('terminal observationCount does not match delivered statuses.');
    }
    lastOffset = event.observedOffsetMs;
    ended = event.type === 'ended';
    onEvent(event);
    if (signal?.aborted) throw abortError();
  };

  try {
    while (true) {
      if (signal?.aborted) throw abortError();
      const { value, done } = await reader.read();
      if (signal?.aborted) throw abortError();
      if (done) break;

      for (let index = 0; index < value.length; index++) {
        if ((index & 1023) === 0 && signal?.aborted) throw abortError();
        const byte = value[index];
        if (byte === 10) {
          emitLine();
          continue;
        }
        if (line.length >= healthWatchLineLimitBytes) {
          throw protocolError('an NDJSON line exceeds the 64 KiB limit.');
        }
        line.push(byte);
      }
    }
    if (line.length > 0) emitLine();
    if (!ended) throw protocolError('stream ended without a terminal ended event.');
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The stream may already be errored or canceled. The original error is authoritative.
    }
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

export function appendHealthTransition(
  state: HealthTransitionState,
  transition: HealthWatchStatusEvent
): HealthTransitionState {
  const next = [...state.transitions, transition];
  const overflow = Math.max(0, next.length - healthTransitionRetention);
  return {
    transitions: overflow ? next.slice(overflow) : next,
    droppedTransitions: state.droppedTransitions + overflow,
  };
}

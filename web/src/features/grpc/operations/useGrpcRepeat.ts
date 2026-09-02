import { useEffect, useRef, useState } from 'react';
import { invokeMethod, invokeWorkspaceMethod } from '@/console/api';
import type { WorkbenchView } from '@/console/ServiceNavigator';
import type {
  BootstrapMethod,
  BootstrapResponse,
  InvokeRequest,
  MetadataEntry,
  RepeatAttempt,
  RepeatConfig,
  RepeatRun,
  SchemaResponse,
} from '@/shared/types';
import {
  buildRepeatRun,
  filterMetadataForInvoke,
  safeParseJson,
  serializeRepeatRun,
  sparklinePath,
  validateRepeatConfig,
} from '@/shared/utils';
import { downloadFile, type OperationMessage } from '../workspace/model';
import {
  type ActiveRepeat,
  awaitWithAbort,
  boundedRepeatError,
  defaultRepeat,
  repeatAggregateLimitMs,
  repeatErrorMessageLimit,
  waitForRepeatDelay,
} from './repeat-model';

type UseGrpcRepeatOptions = {
  bootstrap: BootstrapResponse | null;
  schema: SchemaResponse | null;
  method: BootstrapMethod | null;
  workspaceSessionId: string;
  requestText: string;
  metadata: MetadataEntry[];
  setOperationMessage: React.Dispatch<React.SetStateAction<OperationMessage | null>>;
  setActiveView: React.Dispatch<React.SetStateAction<WorkbenchView>>;
  cancelInvokeSilently: () => void;
  resetInvoke: () => void;
};

export function useGrpcRepeat({
  bootstrap,
  schema,
  method,
  workspaceSessionId,
  requestText,
  metadata,
  setOperationMessage,
  setActiveView,
  cancelInvokeSilently,
  resetInvoke,
}: UseGrpcRepeatOptions) {
  const [config, setConfig] = useState<RepeatConfig>(defaultRepeat);
  const [run, setRun] = useState<RepeatRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ attempted: 0, requested: 0 });
  const activeRef = useRef<ActiveRepeat | null>(null);

  useEffect(
    () => () => {
      const active = activeRef.current;
      activeRef.current = null;
      active?.controller.abort();
    },
    []
  );

  function invalidate(preserveCompleted = false) {
    const active = activeRef.current;
    if (!active && preserveCompleted) return;
    activeRef.current = null;
    active?.controller.abort();
    setBusy(false);
    setError(null);
    setRun(null);
    setProgress({ attempted: 0, requested: 0 });
  }

  function cancel() {
    const active = activeRef.current;
    if (!active || active.controller.signal.aborted) return;
    active.stopReason = 'user-cancelled';
    active.controller.abort();
  }

  async function start() {
    if (!schema || !method || !bootstrap || activeRef.current) return;
    if (method.clientStreaming || method.serverStreaming || schema.requestStream) {
      setError('Unary Repeat is available only when request and response are both unary.');
      return;
    }
    const parsed = safeParseJson(requestText);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    if (Array.isArray(parsed.value)) {
      setError('Unary RPCs need a single JSON object.');
      return;
    }
    const validated = validateRepeatConfig(config);
    if (validated.error || !validated.value) {
      setError(validated.error || 'Repeat settings are invalid.');
      return;
    }

    cancelInvokeSilently();
    resetInvoke();
    const repeatConfig = validated.value;
    const payload: InvokeRequest = {
      timeout_seconds: repeatConfig.deadlineSeconds,
      metadata: filterMetadataForInvoke(metadata),
      data: [parsed.value],
    };
    if (payload.metadata.length < metadata.filter((entry) => entry.name.trim()).length) {
      setOperationMessage({
        tone: 'info',
        title: 'Sensitive metadata omitted',
        description:
          'Blank or [redacted] sensitive metadata was not sent. Re-enter the value to include it in a later RPC.',
      });
    }

    const methodName = method.fullName;
    const target = bootstrap.target;
    const sessionId = workspaceSessionId;
    const active: ActiveRepeat = { controller: new AbortController(), stopReason: null };
    const { signal } = active.controller;
    activeRef.current = active;
    setBusy(true);
    setError(null);
    setRun(null);
    setProgress({ attempted: 0, requested: repeatConfig.count });
    setActiveView('tests');
    const attempts: RepeatAttempt[] = [];
    const createdAt = new Date().toISOString();
    const startedAt = performance.now();
    const aggregateTimer = window.setTimeout(() => {
      if (activeRef.current !== active || signal.aborted) return;
      active.stopReason = 'aggregate-limit';
      active.controller.abort();
    }, repeatAggregateLimitMs);

    try {
      for (let index = 0; index < repeatConfig.count; index++) {
        if (signal.aborted) break;
        const attemptStartedAt = performance.now();
        const common = {
          sequence: index + 1,
          startedOffsetMs: attemptStartedAt - startedAt,
        };
        try {
          const invocation = sessionId
            ? invokeWorkspaceMethod(sessionId, methodName, payload, signal)
            : invokeMethod(methodName, payload, signal);
          const result = await awaitWithAbort(invocation, signal);
          if (activeRef.current !== active) return;
          attempts.push({
            ...common,
            consoleRoundTripMs: performance.now() - attemptStartedAt,
            handlerInvokeMs: result.timings?.totalMs ?? null,
            outcome: result.localLimit ? 'local-limit' : result.error ? 'grpc-error' : 'ok',
            responseCount: result.responses.length,
            headerCount: result.headers.length,
            trailerCount: result.trailers.length,
            grpcStatus: result.error
              ? {
                  code: result.error.code,
                  name: result.error.name.slice(0, repeatErrorMessageLimit),
                  message: result.error.message.slice(0, repeatErrorMessageLimit),
                }
              : null,
            error: result.localLimit?.message.slice(0, repeatErrorMessageLimit) ?? '',
          });
        } catch (caught) {
          if (activeRef.current !== active) return;
          const cancelled = signal.aborted;
          attempts.push({
            ...common,
            consoleRoundTripMs: performance.now() - attemptStartedAt,
            handlerInvokeMs: null,
            outcome: cancelled ? 'cancelled' : 'relay-transport-error',
            responseCount: 0,
            headerCount: 0,
            trailerCount: 0,
            grpcStatus: null,
            error: cancelled
              ? active.stopReason === 'aggregate-limit'
                ? 'The 60 second Repeat limit was reached.'
                : 'Repeat cancelled.'
              : boundedRepeatError(caught, 'ProtoPeek could not complete the request.'),
          });
        }

        setProgress({ attempted: attempts.length, requested: repeatConfig.count });
        if (signal.aborted) break;
        if (index < repeatConfig.count - 1 && repeatConfig.thinkTimeMs > 0) {
          try {
            await waitForRepeatDelay(repeatConfig.thinkTimeMs, signal);
          } catch {
            if (activeRef.current !== active) return;
            break;
          }
        }
      }

      if (activeRef.current !== active) return;
      setError(null);
      setRun(
        buildRepeatRun({
          createdAt,
          method: methodName,
          target,
          config: repeatConfig,
          attempts,
          totalMs: performance.now() - startedAt,
          stopReason: active.stopReason ?? 'completed',
        })
      );
      setProgress({ attempted: attempts.length, requested: repeatConfig.count });
    } finally {
      window.clearTimeout(aggregateTimer);
      if (activeRef.current === active) {
        activeRef.current = null;
        setBusy(false);
      }
    }
  }

  function exportRun() {
    if (!run || busy) return;
    const methodName =
      run.method
        .split('/')
        .pop()
        ?.replaceAll(/[^a-z0-9_-]/gi, '-') || 'rpc';
    const timestamp = run.createdAt.replaceAll(/[:.]/g, '-');
    downloadFile(
      `protopeek-repeat-${methodName}-${timestamp}.json`,
      serializeRepeatRun(run),
      'application/json'
    );
  }

  const latencySparkline = sparklinePath(
    run?.attempts
      .filter(
        (attempt) =>
          (attempt.outcome === 'ok' || attempt.outcome === 'grpc-error') &&
          (run.latency.source === 'console-round-trip' || attempt.handlerInvokeMs !== null)
      )
      .map((attempt) =>
        run.latency.source === 'handler-invoke'
          ? (attempt.handlerInvokeMs ?? 0)
          : attempt.consoleRoundTripMs
      ) ?? [],
    200,
    48
  );

  return {
    busy,
    config,
    error,
    latencySparkline,
    progress,
    run,
    setConfig,
    setError,
    cancel,
    exportRun,
    invalidate,
    isActive: () => Boolean(activeRef.current),
    start,
  };
}

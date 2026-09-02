import { useEffect, useRef, useState } from 'react';
import { checkHealth, watchHealth } from '@/console/api';
import {
  applyHealthCheckResult,
  applyHealthWatchEvent,
  finishHealthRun,
  type HealthRun,
  type HealthRunEndReason,
} from '@/console/health';
import type { BootstrapResponse, MetadataEntry } from '@/shared/types';
import { filterMetadataForInvoke } from '@/shared/utils';

type LocalHealthStopReason = Extract<
  HealthRunEndReason,
  'user-cancelled' | 'navigation' | 'context-changed' | 'relay-error' | 'protocol-error'
>;

type ActiveHealth = {
  controller: AbortController;
  generation: number;
};

type UseGrpcHealthOptions = {
  bootstrap: BootstrapResponse | null;
  workspaceSessionId: string;
  workspaceBusy: boolean;
  metadata: MetadataEntry[];
  contextKey: string;
  isRepeatActive: () => boolean;
  isInvokeActive: () => boolean;
};

function healthFailureReason(error: unknown): 'relay-error' | 'protocol-error' {
  return error instanceof Error && /Invalid gRPC Health evidence/i.test(error.message)
    ? 'protocol-error'
    : 'relay-error';
}

export function useGrpcHealth({
  bootstrap,
  workspaceSessionId,
  workspaceBusy,
  metadata,
  contextKey,
  isRepeatActive,
  isInvokeActive,
}: UseGrpcHealthOptions) {
  const [service, setService] = useState('');
  const [checkDeadlineSeconds, setCheckDeadlineSeconds] = useState(5);
  const [watchDurationSeconds, setWatchDurationSeconds] = useState(60);
  const [run, setRun] = useState<HealthRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<ActiveHealth | null>(null);
  const generationRef = useRef(0);

  useEffect(
    () => () => {
      generationRef.current++;
      const active = activeRef.current;
      activeRef.current = null;
      active?.controller.abort();
    },
    []
  );

  function cancel(reason: LocalHealthStopReason) {
    const active = activeRef.current;
    if (!active) return;
    generationRef.current++;
    activeRef.current = null;
    active.controller.abort();
    setBusy(false);
    setError(null);
    setRun((current) =>
      current?.phase === 'running' ? finishHealthRun(current, reason) : current
    );
  }

  async function start(operation: 'check' | 'watch') {
    if (!bootstrap || activeRef.current) return;
    if (isRepeatActive()) {
      setError('Cancel Repeat first, then start a Health operation.');
      return;
    }
    if (isInvokeActive()) {
      setError('Cancel the active RPC first, then start a Health operation.');
      return;
    }
    if (workspaceBusy) {
      setError('Wait for the target connection to settle before starting Health.');
      return;
    }

    const serviceName = service.trim();
    if (new TextEncoder().encode(serviceName).byteLength > 1024) {
      setError('Health service exceeds the 1024-byte limit.');
      return;
    }
    if (
      operation === 'check' &&
      (!Number.isFinite(checkDeadlineSeconds) ||
        checkDeadlineSeconds < 0.1 ||
        checkDeadlineSeconds > 30)
    ) {
      setError('Check deadline must be between 0.1 and 30 seconds.');
      return;
    }
    if (
      operation === 'watch' &&
      (!Number.isFinite(watchDurationSeconds) ||
        watchDurationSeconds < 1 ||
        watchDurationSeconds > 600)
    ) {
      setError('Watch duration must be between 1 and 600 seconds.');
      return;
    }

    const sendableMetadata = filterMetadataForInvoke(metadata);
    if (sendableMetadata.length > 64) {
      setError('Health accepts at most 64 sendable metadata entries.');
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const active: ActiveHealth = {
      controller: new AbortController(),
      generation,
    };
    activeRef.current = active;
    let evidence: HealthRun = {
      operation,
      phase: 'running',
      contextKey,
      target: bootstrap.target,
      service: serviceName,
      startedAt: new Date().toISOString(),
      metadataCount: sendableMetadata.length,
      checkDeadlineSeconds: operation === 'check' ? checkDeadlineSeconds : null,
      watchDurationSeconds: operation === 'watch' ? watchDurationSeconds : null,
      handlerInvokeMs: null,
      latestStatus: null,
      transitions: [],
      droppedTransitions: 0,
      headers: [],
      trailers: [],
      headersTruncated: false,
      trailersTruncated: false,
      grpcStatus: null,
      endReason: null,
      observationCount: 0,
      error: '',
    };
    const sessionId = workspaceSessionId;
    setRun(evidence);
    setBusy(true);
    setError(null);

    try {
      if (operation === 'check') {
        const result = await checkHealth(
          sessionId,
          {
            service: serviceName,
            timeout_seconds: checkDeadlineSeconds,
            metadata: sendableMetadata,
          },
          active.controller.signal
        );
        if (activeRef.current !== active || generationRef.current !== generation) return;
        evidence = applyHealthCheckResult(evidence, result);
        setRun(evidence);
      } else {
        await watchHealth(
          sessionId,
          {
            service: serviceName,
            duration_seconds: watchDurationSeconds,
            metadata: sendableMetadata,
          },
          (event) => {
            if (activeRef.current !== active || generationRef.current !== generation) return;
            evidence = applyHealthWatchEvent(evidence, event);
            setRun(evidence);
          },
          active.controller.signal
        );
      }
    } catch (caught) {
      if (activeRef.current !== active || generationRef.current !== generation) return;
      const message =
        caught instanceof Error ? caught.message.slice(0, 2048) : 'Health operation failed.';
      evidence = finishHealthRun(evidence, healthFailureReason(caught), message);
      setRun(evidence);
    } finally {
      if (activeRef.current === active && generationRef.current === generation) {
        activeRef.current = null;
        setBusy(false);
        setError(null);
      }
    }
  }

  return {
    busy,
    checkDeadlineSeconds,
    error,
    run,
    service,
    watchDurationSeconds,
    setCheckDeadlineSeconds,
    setError,
    setService,
    setWatchDurationSeconds,
    cancel,
    isActive: () => Boolean(activeRef.current),
    start,
  };
}

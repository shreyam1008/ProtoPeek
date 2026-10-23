import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeMethod, invokeWorkspaceMethod } from '@/console/api';
import { type ReceiptOutcome, recordOperationReceipt } from '@/console/app/operation-receipts';
import type { WorkbenchView } from '@/console/ServiceNavigator';
import type {
  AssertionResult,
  AssertionRule,
  BootstrapMethod,
  BootstrapService,
  InvokeRequest,
  InvokeResponse,
  MetadataEntry,
  RequestHistoryEntry,
  SchemaResponse,
} from '@/shared/types';
import {
  evaluateAssertions,
  filterMetadataForInvoke,
  safeParseJson,
  toHistoryEntry,
} from '@/shared/utils';
import type { OperationMessage } from '../workspace/model';

export type InvokeState = {
  loading: boolean;
  cancelled?: boolean;
  validationError?: string | null;
  error: string | null;
  result: InvokeResponse | null;
  latencyMs: number;
};

const idleInvokeState: InvokeState = {
  loading: false,
  error: null,
  result: null,
  latencyMs: 0,
};

type UseGrpcInvokeOptions = {
  schema: SchemaResponse | null;
  service: BootstrapService | null;
  method: BootstrapMethod | null;
  workspaceSessionId: string;
  requestText: string;
  timeoutSeconds: number;
  metadata: MetadataEntry[];
  assertionRules: AssertionRule[];
  replayScope: { targetId?: string; targetAddress: string };
  setHistory: React.Dispatch<React.SetStateAction<RequestHistoryEntry[]>>;
  setOperationMessage: React.Dispatch<React.SetStateAction<OperationMessage | null>>;
  setActiveView: React.Dispatch<React.SetStateAction<WorkbenchView>>;
};

export function useGrpcInvoke({
  schema,
  service,
  method,
  workspaceSessionId,
  requestText,
  timeoutSeconds,
  metadata,
  assertionRules,
  replayScope,
  setHistory,
  setOperationMessage,
  setActiveView,
}: UseGrpcInvokeOptions) {
  const [state, setState] = useState<InvokeState>(idleInvokeState);
  const [assertionResults, setAssertionResults] = useState<AssertionResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const previousRequestText = useRef(requestText);
  const partialRef = useRef<InvokeResponse | null>(null);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopBatch = useCallback(() => {
    if (batchTimer.current !== null) clearTimeout(batchTimer.current);
    batchTimer.current = null;
  }, []);

  useEffect(() => {
    if (requestText === previousRequestText.current) return;
    previousRequestText.current = requestText;
    setState((current) =>
      current.validationError ? { ...current, validationError: null } : current
    );
  }, [requestText]);

  useEffect(
    () => () => {
      const active = abortRef.current;
      abortRef.current = null;
      stopBatch();
      active?.abort();
    },
    [stopBatch]
  );

  function cancelSilently() {
    const active = abortRef.current;
    abortRef.current = null;
    stopBatch();
    active?.abort();
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function reset() {
    stopBatch();
    partialRef.current = null;
    setState(idleInvokeState);
    setAssertionResults([]);
  }

  function clearResult() {
    stopBatch();
    partialRef.current = null;
    setState(idleInvokeState);
  }

  async function run() {
    if (abortRef.current || !schema || !service || !method) return;
    const parsed = safeParseJson(requestText);
    const validationError =
      parsed.error ||
      (schema.requestStream !== Array.isArray(parsed.value)
        ? schema.requestStream
          ? 'Streaming RPCs need a JSON array.'
          : 'Unary RPCs need a single object.'
        : null);
    if (validationError) {
      setAssertionResults([]);
      setState({ ...idleInvokeState, validationError });
      setActiveView('compose');
      return;
    }

    const payload: InvokeRequest = {
      timeout_seconds: timeoutSeconds,
      metadata: filterMetadataForInvoke(metadata),
      data: schema.requestStream ? (parsed.value as unknown[]) : [parsed.value],
    };
    if (payload.metadata.length < metadata.filter((entry) => entry.name.trim()).length) {
      setOperationMessage({
        tone: 'info',
        title: 'Sensitive metadata omitted',
        description:
          'Blank or [redacted] sensitive metadata was not sent. Re-enter the value to include it in a later RPC.',
      });
    }

    const controller = new AbortController();
    abortRef.current = controller;
    partialRef.current = null;
    setAssertionResults([]);
    setState({ loading: true, error: null, result: null, latencyMs: 0 });
    setActiveView('compose');
    const startedAt = performance.now();
    let receiptCount = 0;
    const onPartial = method.serverStreaming
      ? (result: InvokeResponse) => {
          receiptCount = result.responses.length;
          if (abortRef.current !== controller || controller.signal.aborted) return;
          partialRef.current = result;
          if (batchTimer.current !== null) return;
          batchTimer.current = setTimeout(() => {
            batchTimer.current = null;
            if (abortRef.current !== controller || controller.signal.aborted) return;
            setState({
              loading: true,
              error: null,
              result: partialRef.current,
              latencyMs: performance.now() - startedAt,
            });
          }, 50);
        }
      : undefined;
    let receiptOutcome: ReceiptOutcome = 'failed';
    let receiptGRPCCode: number | undefined;
    try {
      const result = workspaceSessionId
        ? await invokeWorkspaceMethod(
            workspaceSessionId,
            method.fullName,
            payload,
            controller.signal,
            onPartial
          )
        : await invokeMethod(method.fullName, payload, controller.signal, onPartial);
      receiptCount = result.responses.length;
      receiptOutcome = controller.signal.aborted
        ? 'cancelled'
        : result.finalStatusObserved === false || result.localLimit
          ? 'partial'
          : result.error
            ? 'failed'
            : 'success';
      receiptGRPCCode =
        result.finalStatusObserved === false ? undefined : (result.error?.code ?? 0);
      if (abortRef.current !== controller) {
        if (!controller.signal.aborted) receiptOutcome = 'stale';
        return;
      }
      if (controller.signal.aborted) throw new DOMException('Invocation cancelled.', 'AbortError');
      const latencyMs = performance.now() - startedAt;
      stopBatch();
      setState({ loading: false, error: result.relayError ?? null, result, latencyMs });
      if (result.finalStatusObserved === false) return;
      setAssertionResults(evaluateAssertions({ rules: assertionRules, result, latencyMs }));
      setHistory((current) =>
        [
          toHistoryEntry({
            service: service.name,
            method: method.fullName,
            latencyMs,
            success: !result.error && !result.localLimit,
            requestText,
            response:
              result.responses[0]?.message ?? result.error ?? result.localLimit?.message ?? null,
            metadata,
            timeoutSeconds,
            ...replayScope,
          }),
          ...current,
        ].slice(0, 50)
      );
    } catch (error) {
      receiptOutcome = controller.signal.aborted ? 'cancelled' : 'failed';
      if (abortRef.current !== controller) return;
      setAssertionResults([]);
      stopBatch();
      const partial = partialRef.current as InvokeResponse | null;
      setState({
        loading: false,
        cancelled: controller.signal.aborted,
        error:
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Invocation cancelled.'
            : error instanceof Error
              ? error.message
              : 'Invocation failed.',
        result: partial
          ? {
              ...partial,
              finalStatusObserved: false,
              trailers: [],
              error: null,
              timings: partial.timings ? { ...partial.timings, trailersMs: null } : null,
            }
          : null,
        latencyMs: partial ? performance.now() - startedAt : 0,
      });
    } finally {
      recordOperationReceipt({
        operation: 'grpc',
        outcome: receiptOutcome,
        durationMs: performance.now() - startedAt,
        grpcCode: receiptGRPCCode,
        count: receiptCount,
      });
      if (abortRef.current === controller) {
        stopBatch();
        abortRef.current = null;
      }
    }
  }

  return {
    assertionResults,
    isActive: () => Boolean(abortRef.current),
    state,
    cancel,
    cancelSilently,
    clearResult,
    reset,
    run,
  };
}
